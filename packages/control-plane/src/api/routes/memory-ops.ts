import {
  ControlPlaneError,
  MEMORY_OPS_JOB_KINDS,
  type MemoryOpsJobKind,
  type MemoryOpsJobStatus,
  REQUIRES_PROVIDER,
} from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync, preHandlerHookHandler } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { z } from 'zod';

import type { Database } from '../../db/index.js';
import { MemoryOpsAuditLogger } from '../../memory/ops/audit-logger.js';
import { readMemoryOpsConfig } from '../../memory/ops/config.js';
import { JobEventsRepository } from '../../memory/ops/job-events-repository.js';
import { JobsRepository } from '../../memory/ops/jobs-repository.js';
import {
  buildEgressPreview,
  isPreviewableJobKind,
  signEgressSnapshot,
  verifyEgressToken,
} from '../../memory/ops/preview.js';
import type { MemoryOpsQueue } from '../../memory/ops/queue.js';
import { streamJobEvents } from '../../memory/ops/sse-stream.js';
import { readRateLimitEnv } from '../rate-limit.js';

const JOB_STATUSES = [
  'queued',
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
] as const;
const MEMORY_OPS_RATE_LIMIT = {
  max: 60,
  timeWindow: 60_000,
} as const;

const createJobBodySchema = z.object({
  kind: z.enum(MEMORY_OPS_JOB_KINDS),
  params: z.record(z.unknown()).optional(),
  egressToken: z.string().optional(),
  egressConfirmedBy: z.string().min(1).max(128).optional(),
  credentialId: z.string().uuid().optional(),
});

const previewBodySchema = z.object({
  kind: z.enum(MEMORY_OPS_JOB_KINDS),
  params: z.record(z.unknown()).optional(),
  credentialId: z.string().uuid().optional(),
});

export type MemoryOpsRoutesOptions = {
  db: Database;
  pool: Pool;
  queue?: MemoryOpsQueue | null;
  encryptionKey: string;
  logger: Logger;
  machineId: string;
};

export const memoryOpsRoutes: FastifyPluginAsync<MemoryOpsRoutesOptions> = async (app, opts) => {
  const jobs = new JobsRepository(opts.pool);
  const events = new JobEventsRepository(opts.pool);
  const audit = new MemoryOpsAuditLogger(opts.pool);
  const memoryOpsRateLimitMax = readRateLimitEnv(
    'MEMORY_OPS_RATE_LIMIT_MAX',
    MEMORY_OPS_RATE_LIMIT.max,
  );
  const memoryOpsRateLimitWindowMs = readRateLimitEnv(
    'MEMORY_OPS_RATE_LIMIT_WINDOW_MS',
    MEMORY_OPS_RATE_LIMIT.timeWindow,
  );
  const memoryOpsRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many memory operation requests',
  });
  const memoryOpsFastifyRateLimit = {
    max: memoryOpsRateLimitMax,
    timeWindow: memoryOpsRateLimitWindowMs,
    errorResponseBuilder: memoryOpsRateLimitError,
  } as const;

  await app.register(rateLimit, {
    global: false,
    max: memoryOpsRateLimitMax,
    timeWindow: memoryOpsRateLimitWindowMs,
    keyGenerator: (request) =>
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown'),
    errorResponseBuilder: memoryOpsRateLimitError,
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    if (error.statusCode === 429) {
      return reply.code(429).send(memoryOpsRateLimitError());
    }
    if (error instanceof ControlPlaneError) {
      return reply.code(memoryOpsStatus(error.code)).send({
        error: error.code,
        message: error.message,
        details: error.context ?? {},
      });
    }
    throw error;
  });

  const sendCapabilities: preHandlerHookHandler = async (_request, reply) => {
    const config = readMemoryOpsConfig();
    const [provider, activeJobs] = await Promise.all([
      loadActiveEmbeddingProvider(opts.pool),
      jobs.countActiveByKindScope(),
    ]);

    return reply.send({
      enabled: config.enabled,
      enabledKinds: [...config.enabledJobKinds],
      machineId: opts.machineId,
      queueAvailable: Boolean(opts.queue),
      activeProvider: provider,
      activeProviderLastTestOk: provider?.lastTestOk ?? null,
      activeJobs,
    });
  };

  app.get(
    '/capabilities',
    {
      config: { rateLimit: memoryOpsFastifyRateLimit },
      preHandler: [app.rateLimit(memoryOpsFastifyRateLimit), sendCapabilities],
    },
    async () => undefined,
  );

  app.post(
    '/jobs/preview',
    {
      config: { rateLimit: memoryOpsFastifyRateLimit },
      preHandler: [app.rateLimit(memoryOpsFastifyRateLimit)],
    },
    // @fastify/rate-limit is registered above; CodeQL only models legacy fastify-rate-limit.
    // codeql[js/missing-rate-limiting]
    async (request, reply) => {
      const config = readMemoryOpsConfig();
      if (!config.signingSecret) {
        throw new ControlPlaneError(
          'SIGNING_SECRET_MISSING',
          'MEMORY_OPS_SIGNING_SECRET is required for egress previews',
        );
      }

      const parsed = previewBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ControlPlaneError(
          'VALIDATION_ERROR',
          'Invalid memory operation preview request',
          {
            issues: parsed.error.issues,
          },
        );
      }
      if (!isPreviewableJobKind(parsed.data.kind)) {
        throw new ControlPlaneError(
          'VALIDATION_ERROR',
          'Job kind does not require egress preview',
          {
            kind: parsed.data.kind,
          },
        );
      }

      const preview = await buildEgressPreview(
        {
          kind: parsed.data.kind,
          params: parsed.data.params,
          credentialId: parsed.data.credentialId,
        },
        {
          pool: opts.pool,
          db: opts.db,
          encryptionKey: opts.encryptionKey,
          logger: opts.logger,
        },
      );
      const token = signEgressSnapshot(preview.snapshot, config.signingSecret);
      return reply.send({ ok: true, snapshot: preview.snapshot, egressToken: token });
    },
  );

  app.post(
    '/jobs',
    {
      config: { rateLimit: memoryOpsFastifyRateLimit },
      preHandler: [app.rateLimit(memoryOpsFastifyRateLimit)],
    },
    // @fastify/rate-limit is registered above; CodeQL only models legacy fastify-rate-limit.
    // codeql[js/missing-rate-limiting]
    async (request, reply) => {
      const config = readMemoryOpsConfig();
      if (!config.enabled) {
        throw new ControlPlaneError('FEATURE_DISABLED', 'Memory operations are disabled');
      }

      const parsed = createJobBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ControlPlaneError('VALIDATION_ERROR', 'Invalid memory operation job request', {
          issues: parsed.error.issues,
        });
      }

      const { kind, params = {}, credentialId, egressToken } = parsed.data;
      if (!config.enabledJobKinds.has(kind)) {
        throw new ControlPlaneError(
          'JOB_KIND_NOT_ENABLED',
          'Memory operation kind is not enabled',
          {
            kind,
          },
        );
      }
      if (!opts.queue) {
        throw new ControlPlaneError(
          'QUEUE_ENQUEUE_FAILED',
          'Memory operations queue is unavailable',
        );
      }

      const providerInput = await resolveProviderInput(kind, {
        db: opts.db,
        pool: opts.pool,
        encryptionKey: opts.encryptionKey,
        logger: opts.logger,
        params,
        credentialId,
        egressToken,
        egressConfirmedBy: parsed.data.egressConfirmedBy,
      });

      const job = await jobs.insert({
        kind,
        params,
        originMachineId: opts.machineId,
        executorMachineId: opts.machineId,
        ...providerInput,
      });

      try {
        await opts.queue.add(kind, { dbJobId: job.id }, { jobId: job.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await jobs.transition(job.id, 'failed', {
          error: message,
          errorCode: 'QUEUE_ENQUEUE_FAILED',
        });
        throw new ControlPlaneError('QUEUE_ENQUEUE_FAILED', 'Failed to enqueue memory operation', {
          jobId: job.id,
          cause: message,
        });
      }

      await writeEventQuietly(events, opts.logger, {
        jobId: job.id,
        eventType: 'log',
        level: 'info',
        message: 'Job queued',
      });
      await writeAuditQuietly(audit, opts.logger, {
        actor: parsed.data.egressConfirmedBy ?? 'api',
        action: 'job.create',
        target: job.id,
        context: { kind, params },
      });

      return reply.code(202).send({ ok: true, job });
    },
  );

  app.get<{
    Querystring: {
      kind?: string;
      status?: string;
      localOnly?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/jobs',
    {
      config: { rateLimit: memoryOpsFastifyRateLimit },
      preHandler: [app.rateLimit(memoryOpsFastifyRateLimit)],
    },
    // @fastify/rate-limit is registered above; CodeQL only models legacy fastify-rate-limit.
    // codeql[js/missing-rate-limiting]
    async (request) => {
      const kinds = splitFilter<MemoryOpsJobKind>(request.query.kind, MEMORY_OPS_JOB_KINDS);
      const statuses = splitFilter<MemoryOpsJobStatus>(request.query.status, JOB_STATUSES);
      const limit = parseBoundedInt(request.query.limit, 50, 1, 200);
      const offset = parseBoundedInt(request.query.offset, 0, 0, 10_000);
      const localOnly = request.query.localOnly === 'true';
      const items = await jobs.list({
        kinds,
        statuses,
        localOnlyMachineId: localOnly ? opts.machineId : undefined,
        limit,
        offset,
      });
      return { jobs: items, limit, offset };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/jobs/:id',
    {
      config: { rateLimit: memoryOpsFastifyRateLimit },
      preHandler: [app.rateLimit(memoryOpsFastifyRateLimit)],
    },
    // @fastify/rate-limit is registered above; CodeQL only models legacy fastify-rate-limit.
    // codeql[js/missing-rate-limiting]
    async (request) => {
      const job = await jobs.findById(request.params.id);
      if (!job) {
        throw new ControlPlaneError(
          'JOB_NOT_FOUND',
          `Memory operation job '${request.params.id}' was not found`,
          { id: request.params.id },
        );
      }
      return { job };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/jobs/:id/cancel',
    {
      config: { rateLimit: memoryOpsFastifyRateLimit },
      preHandler: [app.rateLimit(memoryOpsFastifyRateLimit)],
    },
    // @fastify/rate-limit is registered above; CodeQL only models legacy fastify-rate-limit.
    // codeql[js/missing-rate-limiting]
    async (request) => {
      const existing = await jobs.findById(request.params.id);
      if (!existing) {
        throw new ControlPlaneError(
          'JOB_NOT_FOUND',
          `Memory operation job '${request.params.id}' was not found`,
          { id: request.params.id },
        );
      }
      if (
        existing.originMachineId !== opts.machineId &&
        existing.executorMachineId !== opts.machineId
      ) {
        throw new ControlPlaneError('REMOTE_PEER_JOB', 'Job belongs to a remote peer', {
          id: existing.id,
          originMachineId: existing.originMachineId,
          executorMachineId: existing.executorMachineId,
          machineId: opts.machineId,
        });
      }

      const job = await jobs.requestCancel(request.params.id);
      await writeEventQuietly(events, opts.logger, {
        jobId: job.id,
        eventType: job.status === 'cancelled' ? 'cancelled' : 'cancelling',
        level: 'info',
        message:
          job.status === 'cancelled' ? 'Job cancelled before start' : 'Cancellation requested',
      });
      await writeAuditQuietly(audit, opts.logger, {
        actor: 'api',
        action: 'job.cancel',
        target: job.id,
        context: { kind: job.kind, status: job.status },
      });
      return { ok: true, job };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/jobs/:id/stream',
    {
      config: { rateLimit: memoryOpsFastifyRateLimit },
      preHandler: [app.rateLimit(memoryOpsFastifyRateLimit)],
    },
    // @fastify/rate-limit is registered above; CodeQL only models legacy fastify-rate-limit.
    // codeql[js/missing-rate-limiting]
    async (request, reply) => {
      await streamJobEvents({
        request,
        requestRaw: request.raw,
        reply,
        pool: opts.pool,
        jobsRepository: jobs,
        jobId: request.params.id,
        machineId: opts.machineId,
        afterEventId: request.query.after,
      });
    },
  );
};

async function resolveProviderInput(
  kind: MemoryOpsJobKind,
  input: {
    db: Database;
    pool: Pool;
    encryptionKey: string;
    logger: Logger;
    params: Record<string, unknown>;
    credentialId?: string;
    egressToken?: string;
    egressConfirmedBy?: string;
  },
): Promise<{
  credentialId?: string | null;
  providerKind?: string | null;
  providerModel?: string | null;
  providerHost?: string | null;
  priceUsdPerMtoken?: number | null;
  egressConfirmedAt?: Date | null;
  egressConfirmedBy?: string | null;
  egressSnapshot?: Record<string, unknown> | null;
}> {
  if (!REQUIRES_PROVIDER[kind]) {
    return {};
  }
  if (!isPreviewableJobKind(kind)) {
    throw new ControlPlaneError('VALIDATION_ERROR', 'Job kind does not require egress preview', {
      kind,
    });
  }
  if (!input.egressToken) {
    throw new ControlPlaneError('EGRESS_NOT_CONFIRMED', 'Egress preview confirmation is required', {
      kind,
    });
  }

  const preview = await buildEgressPreview(
    { kind, params: input.params, credentialId: input.credentialId },
    {
      pool: input.pool,
      db: input.db,
      encryptionKey: input.encryptionKey,
      logger: input.logger,
    },
  );
  const signingSecret = readMemoryOpsConfig().signingSecret;
  if (!signingSecret) {
    throw new ControlPlaneError(
      'SIGNING_SECRET_MISSING',
      'MEMORY_OPS_SIGNING_SECRET is required for egress previews',
    );
  }
  const tokenPayload = verifyEgressToken(input.egressToken, preview.snapshot, signingSecret);

  return {
    credentialId: preview.credentialId,
    providerKind: preview.snapshot.providerKind,
    providerModel: preview.snapshot.providerModel,
    providerHost: preview.snapshot.providerHost,
    priceUsdPerMtoken: preview.snapshot.priceUsdPerMtoken,
    egressConfirmedAt: new Date(tokenPayload.issuedAt),
    egressConfirmedBy: input.egressConfirmedBy ?? 'api',
    egressSnapshot: tokenPayload.snapshot,
  };
}

async function loadActiveEmbeddingProvider(pool: Pool): Promise<{
  id: string;
  provider: string;
  model: string | null;
  credentialLast4: string | null;
  lastTestOk: boolean | null;
} | null> {
  const result = await pool.query<{
    id: string;
    provider: string;
    credential_last4: string | null;
    metadata: unknown;
  }>(
    `SELECT id, provider, credential_last4, metadata
       FROM api_accounts
      WHERE credential_kind = 'embedding'
        AND is_active = true
      LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const metadata = parseRecord(row.metadata);
  return {
    id: row.id,
    provider: row.provider,
    model: typeof metadata.model === 'string' ? metadata.model : null,
    credentialLast4: row.credential_last4,
    lastTestOk: typeof metadata.lastTestOk === 'boolean' ? metadata.lastTestOk : null,
  };
}

function splitFilter<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T[] | undefined {
  if (!value) {
    return undefined;
  }
  const allowedSet = new Set<string>(allowed);
  const parsed = value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is T => allowedSet.has(item));
  return parsed.length > 0 ? parsed : undefined;
}

function parseBoundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function writeEventQuietly(
  events: JobEventsRepository,
  logger: Logger,
  input: Parameters<JobEventsRepository['insert']>[0],
): Promise<void> {
  try {
    await events.insert(input);
  } catch (error) {
    logger.warn({ err: error, jobId: input.jobId }, 'Failed to write memory ops job event');
  }
}

async function writeAuditQuietly(
  audit: MemoryOpsAuditLogger,
  logger: Logger,
  input: Parameters<MemoryOpsAuditLogger['write']>[0],
): Promise<void> {
  try {
    await audit.write(input);
  } catch (error) {
    logger.warn({ err: error, target: input.target }, 'Failed to write memory ops audit row');
  }
}

function memoryOpsStatus(code: string): number {
  const status = new Map<string, number>([
    ['VALIDATION_ERROR', 422],
    ['FEATURE_DISABLED', 403],
    ['JOB_KIND_NOT_ENABLED', 403],
    ['JOB_NOT_FOUND', 404],
    ['JOB_NOT_CANCELLABLE', 409],
    ['REMOTE_PEER_JOB', 403],
    ['CONCURRENT_JOB_REQUEST', 409],
    ['JOB_ALREADY_RUNNING', 409],
    ['EGRESS_NOT_CONFIRMED', 409],
    ['EGRESS_SNAPSHOT_STALE', 409],
    ['SIGNING_SECRET_MISSING', 503],
    ['QUEUE_ENQUEUE_FAILED', 503],
    ['EMBEDDING_NO_PROVIDER', 503],
    ['EMBEDDING_CREDENTIAL_NOT_FOUND', 404],
    ['EMBEDDING_CREDENTIAL_DECRYPT_FAILED', 503],
    ['CATALOG_INVALID', 500],
  ]).get(code);
  return status ?? 500;
}
