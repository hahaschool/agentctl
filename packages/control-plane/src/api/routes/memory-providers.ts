import { createHmac, timingSafeEqual } from 'node:crypto';
import { hostname } from 'node:os';

import {
  ControlPlaneError,
  EMBEDDING_MODEL_CATALOG,
  type EmbeddingProvider,
  type EmbeddingProviderKind,
  validateCatalog,
} from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import { ZodError, z } from 'zod';

import type { Database } from '../../db/index.js';
import { EmbeddingClient } from '../../memory/embedding-client.js';
import { MemoryOpsAuditLogger } from '../../memory/ops/audit-logger.js';
import { providerInvalidationBus } from '../../memory/provider-invalidation-bus.js';
import { decryptCredential, encryptCredential } from '../../utils/credential-crypto.js';
import { readRateLimitEnv } from '../rate-limit.js';

validateCatalog();

const TOKEN_TTL_MS = 5 * 60 * 1000;
const SAFE_PROVIDER_ID = /^[0-9a-fA-F-]{36}$/u;
const MEMORY_PROVIDER_RATE_LIMIT = {
  max: 20,
  timeWindow: 60_000,
} as const;

const providerKindSchema = z.enum(['openai', 'gemini']);

const recentTestResultSchema = z
  .object({
    signedToken: z.string().min(1),
    apiKey: z.string().min(1),
  })
  .strict();

const createProviderSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    provider: providerKindSchema,
    model: z.string().trim().min(1).max(160),
    apiKey: z.string().min(1),
    active: z.boolean().optional().default(false),
    recentTestResult: recentTestResultSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const entry = findVerifiedCatalogEntry(value.provider, value.model);
    if (!entry) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'provider/model is not verified for embeddings',
      });
    }
  });

const patchProviderSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    apiKey: z.string().min(1).optional(),
    active: z.boolean().optional(),
    recentTestResult: recentTestResultSchema.optional(),
  })
  .strict();

const testEphemeralSchema = z
  .object({
    provider: providerKindSchema,
    model: z.string().trim().min(1).max(160),
    apiKey: z.string().min(1),
  })
  .strict();

export type MemoryProvidersRouteOptions = {
  db: Database;
  pool: Pool;
  encryptionKey: string;
  logger: Logger;
};

type ProviderRow = {
  id: string;
  name: string;
  provider: string;
  credential?: string;
  credential_iv?: string;
  credential_last4: string | null;
  is_active: boolean;
  metadata: Record<string, unknown> | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

type RecentTestPayload = {
  provider: string;
  model: string;
  apiKeyFingerprint: string;
  dim: number;
  ok: true;
  testedAt: number;
  latencyMs: number;
  costUsd: number;
};

export const memoryProvidersRoutes: FastifyPluginAsync<MemoryProvidersRouteOptions> = async (
  app,
  opts,
) => {
  const audit = new MemoryOpsAuditLogger(opts.pool);
  const providerRateLimitMax = readRateLimitEnv(
    'MEMORY_PROVIDER_RATE_LIMIT_MAX',
    MEMORY_PROVIDER_RATE_LIMIT.max,
  );
  const providerRateLimitWindowMs = readRateLimitEnv(
    'MEMORY_PROVIDER_RATE_LIMIT_WINDOW_MS',
    MEMORY_PROVIDER_RATE_LIMIT.timeWindow,
  );
  const providerRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many memory provider requests',
  });
  const providerFastifyRateLimit = {
    max: providerRateLimitMax,
    timeWindow: providerRateLimitWindowMs,
    errorResponseBuilder: providerRateLimitError,
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) =>
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown'),
    errorResponseBuilder: providerRateLimitError,
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error.statusCode === 429) {
      return reply.code(429).send(providerRateLimitError());
    }
    if (error instanceof ControlPlaneError) {
      request.log.warn({ err: error, code: error.code }, 'Memory providers route error');
      return reply.code(memoryOpsStatus(error.code)).send({
        error: error.code,
        message: error.message,
        ...(error.context ? { details: error.context } : {}),
      });
    }
    if (error instanceof ZodError) {
      return reply.code(422).send({
        error: 'VALIDATION_ERROR',
        message: 'Invalid memory provider request',
        details: { issues: error.issues },
      });
    }
    request.log.error({ err: error }, 'Unhandled memory providers route error');
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unexpected memory providers error',
    });
  });

  app.get('/', async () => {
    const rows = await listProviderRows(opts.pool);
    return { providers: rows.map(rowToProvider) };
  });

  app.post(
    '/test-ephemeral',
    {
      config: { rateLimit: providerFastifyRateLimit },
      preHandler: [app.rateLimit(providerFastifyRateLimit)],
    },
    // @fastify/rate-limit is registered above; CodeQL only models legacy fastify-rate-limit.
    // codeql[js/missing-rate-limiting]
    async (request) => {
      const signingSecret = readSigningSecret();
      if (!signingSecret) {
        throw new ControlPlaneError(
          'SIGNING_SECRET_MISSING',
          'MEMORY_OPS_SIGNING_SECRET is not configured',
        );
      }
      const body = testEphemeralSchema.parse(request.body);
      const entry = findVerifiedCatalogEntry(body.provider, body.model);
      if (!entry) {
        throw new ControlPlaneError('VALIDATION_ERROR', 'provider/model is not verified', {
          provider: body.provider,
          model: body.model,
        });
      }

      const startedAt = Date.now();
      const client = new EmbeddingClient({
        baseUrl: entry.baseUrl,
        model: entry.model,
        apiKey: body.apiKey,
        embeddingsPath: entry.embeddingsPath,
        extraBody: entry.extraBody,
        logger: opts.logger.child({ component: 'memory-provider-test', provider: body.provider }),
      });

      let result: Awaited<ReturnType<EmbeddingClient['embedBatchWithUsage']>>;
      try {
        result = await client.embedBatchWithUsage(['ping']);
      } catch (error) {
        await audit.write({
          actor: actorFromRequest(request.headers),
          action: 'provider.test-failed',
          target: `${body.provider}/${body.model}`,
          context: { error: error instanceof Error ? error.message : String(error) },
        });
        throw new ControlPlaneError('PROVIDER_AUTH_FAILED', 'Embedding provider test failed');
      }

      const latencyMs = Date.now() - startedAt;
      const dim = result.vectors[0]?.length ?? 0;
      const costUsd = (result.usage.promptTokens / 1_000_000) * entry.pricePerMtoken;
      const payload: RecentTestPayload = {
        provider: body.provider,
        model: body.model,
        // HMAC binds the tested provider key to this short-lived token; it is
        // not a password verifier or stored credential hash.
        // codeql[js/insufficient-password-hash]
        apiKeyFingerprint: fingerprintApiKey(body.apiKey, signingSecret),
        dim,
        ok: true,
        testedAt: Date.now(),
        latencyMs,
        costUsd,
      };

      await audit.write({
        actor: actorFromRequest(request.headers),
        action: 'provider.test-ephemeral',
        target: `${body.provider}/${body.model}`,
        context: { dim, latencyMs, costUsd },
      });

      return {
        ok: true,
        dim,
        model: result.model,
        latencyMs,
        costUsd,
        signedToken: signRecentTestPayload(payload, signingSecret),
      };
    },
  );

  app.post(
    '/',
    {
      config: { rateLimit: providerFastifyRateLimit },
      preHandler: [app.rateLimit(providerFastifyRateLimit)],
    },
    // @fastify/rate-limit is registered above; CodeQL only models legacy fastify-rate-limit.
    // codeql[js/missing-rate-limiting]
    async (request, reply) => {
      const body = createProviderSchema.parse(request.body);
      if (body.active) {
        await checkNoActiveEmbeddingProvider(opts.pool);
        await checkModelLock(opts.pool, body.model);
      }

      const metadata = buildProviderMetadata(body.provider, body.model, body.recentTestResult);
      const encrypted = encryptCredential(body.apiKey, opts.encryptionKey);
      const row = await insertProvider(opts.pool, {
        name: body.name,
        provider: body.provider,
        encryptedCredential: encrypted.encrypted,
        credentialIv: encrypted.iv,
        apiKeyLast4: last4(body.apiKey),
        active: body.active,
        metadata,
      });

      providerInvalidationBus.emit('provider.changed', body.active ? 'active' : row.id);
      await audit.write({
        actor: actorFromRequest(request.headers),
        action: 'provider.create',
        target: `${body.provider}/${body.model}`,
        context: { providerId: row.id, active: body.active },
      });

      return reply.code(201).send({ provider: rowToProvider(row) });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/:id',
    {
      config: { rateLimit: providerFastifyRateLimit },
      preHandler: [app.rateLimit(providerFastifyRateLimit)],
    },
    // @fastify/rate-limit is registered above; CodeQL only models legacy fastify-rate-limit.
    // codeql[js/missing-rate-limiting]
    async (request) => {
      const providerId = normalizeProviderId(request.params.id);
      const body = patchProviderSchema.parse(request.body);
      if (body.active) {
        await checkModelLockForExistingProvider(opts.pool, providerId);
      }

      const row = await withTransaction(opts.pool, async (client) => {
        if (body.active) {
          await client.query(
            `UPDATE api_accounts
              SET is_active = false, updated_at = now()
            WHERE credential_kind = 'embedding'
              AND is_active = true
              AND id <> $1`,
            [providerId],
          );
        }

        const existing = await loadProviderRow(client, providerId);
        if (!existing) {
          throw new ControlPlaneError('PROVIDER_NOT_FOUND', 'Embedding provider not found', {
            providerId,
          });
        }

        const updates: string[] = ['updated_at = now()'];
        const params: unknown[] = [providerId];
        const metadata = parseMetadata(existing.metadata);

        if (body.name !== undefined) {
          params.push(body.name);
          updates.push(`name = $${params.length}`);
        }
        if (body.active !== undefined) {
          params.push(body.active);
          updates.push(`is_active = $${params.length}`);
        }
        if (body.apiKey !== undefined) {
          const encrypted = encryptCredential(body.apiKey, opts.encryptionKey);
          params.push(encrypted.encrypted);
          updates.push(`credential = $${params.length}`);
          params.push(encrypted.iv);
          updates.push(`credential_iv = $${params.length}`);
          params.push(last4(body.apiKey));
          updates.push(`credential_last4 = $${params.length}`);

          const verified = body.recentTestResult
            ? verifyRecentTestResult(
                body.recentTestResult,
                existing.provider,
                parseProviderModel(metadata),
              )
            : null;
          metadata.lastTestOk = verified ? true : null;
          metadata.lastTestError = null;
          metadata.lastTestedAt = verified ? new Date(verified.testedAt).toISOString() : null;
          metadata.dim = verified?.dim ?? null;
          metadata.latencyMs = verified?.latencyMs ?? null;
          metadata.costUsd = verified?.costUsd ?? null;
        }

        params.push(JSON.stringify(metadata));
        updates.push(`metadata = $${params.length}::jsonb`);

        const result = await client.query<ProviderRow>(
          `UPDATE api_accounts
            SET ${updates.join(', ')}
          WHERE id = $1
            AND credential_kind = 'embedding'
          RETURNING id, name, provider, credential_last4, is_active, metadata, created_at, updated_at`,
          params,
        );
        return requiredRow(result.rows[0], 'PROVIDER_NOT_FOUND', 'Embedding provider not found');
      });

      providerInvalidationBus.emit('provider.changed', body.active ? 'active' : providerId);
      await audit.write({
        actor: actorFromRequest(request.headers),
        action: body.apiKey ? 'provider.rotate-key' : 'provider.update',
        target: providerId,
        context: { active: body.active ?? null, nameUpdated: body.name !== undefined },
      });
      return { provider: rowToProvider(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/:id/test',
    {
      config: { rateLimit: providerFastifyRateLimit },
      preHandler: [app.rateLimit(providerFastifyRateLimit)],
    },
    // @fastify/rate-limit is registered above; CodeQL only models legacy fastify-rate-limit.
    // codeql[js/missing-rate-limiting]
    async (request) => {
      const providerId = normalizeProviderId(request.params.id);
      const signingSecret = readSigningSecret();
      if (!signingSecret) {
        throw new ControlPlaneError(
          'SIGNING_SECRET_MISSING',
          'MEMORY_OPS_SIGNING_SECRET is not configured',
        );
      }
      const row = await loadProviderRow(opts.pool, providerId);
      if (!row?.credential || !row.credential_iv) {
        throw new ControlPlaneError('PROVIDER_NOT_FOUND', 'Embedding provider not found', {
          providerId,
        });
      }
      const metadata = parseMetadata(row.metadata);
      const model = parseProviderModel(metadata);
      const entry = findVerifiedCatalogEntry(row.provider as EmbeddingProviderKind, model);
      if (!entry) {
        throw new ControlPlaneError('VALIDATION_ERROR', 'provider/model is not verified');
      }
      const apiKey = decryptCredential(row.credential, row.credential_iv, opts.encryptionKey);
      const startedAt = Date.now();
      const client = new EmbeddingClient({
        baseUrl: entry.baseUrl,
        model,
        apiKey,
        embeddingsPath: entry.embeddingsPath,
        extraBody: entry.extraBody,
        logger: opts.logger.child({ component: 'memory-provider-test', providerId }),
      });
      const result = await client.embedBatchWithUsage(['ping']);
      const latencyMs = Date.now() - startedAt;
      const dim = result.vectors[0]?.length ?? 0;
      const costUsd = (result.usage.promptTokens / 1_000_000) * entry.pricePerMtoken;
      return { ok: true, dim, model: result.model, latencyMs, costUsd };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      config: { rateLimit: providerFastifyRateLimit },
      preHandler: [app.rateLimit(providerFastifyRateLimit)],
    },
    // @fastify/rate-limit is registered above; CodeQL only models legacy fastify-rate-limit.
    // codeql[js/missing-rate-limiting]
    async (request, reply) => {
      const providerId = normalizeProviderId(request.params.id);
      await assertProviderHasNoActiveJobs(opts.pool, providerId);
      const result = await opts.pool.query<ProviderRow>(
        `DELETE FROM api_accounts
        WHERE id = $1
          AND credential_kind = 'embedding'
        RETURNING id, name, provider, credential_last4, is_active, metadata, created_at, updated_at`,
        [providerId],
      );
      const row = requiredRow(result.rows[0], 'PROVIDER_NOT_FOUND', 'Embedding provider not found');
      providerInvalidationBus.emit('provider.changed', row.is_active ? 'active' : providerId);
      await audit.write({
        actor: actorFromRequest(request.headers),
        action: 'provider.delete',
        target: providerId,
        context: { provider: row.provider, model: parseProviderModel(parseMetadata(row.metadata)) },
      });
      return reply.code(204).send();
    },
  );
};

async function listProviderRows(pool: Pool): Promise<ProviderRow[]> {
  const result = await pool.query<ProviderRow>(
    `SELECT id, name, provider, credential_last4, is_active, metadata, created_at, updated_at
       FROM api_accounts
      WHERE credential_kind = 'embedding'
      ORDER BY created_at ASC, id ASC`,
  );
  return result.rows;
}

async function checkNoActiveEmbeddingProvider(pool: Pool): Promise<void> {
  const result = await pool.query(
    `SELECT id FROM api_accounts
      WHERE credential_kind = 'embedding'
        AND is_active = true
      LIMIT 1`,
  );
  if (result.rows.length > 0) {
    throw new ControlPlaneError(
      'DUPLICATE_ACTIVE_EMBEDDING',
      'An active embedding provider already exists',
    );
  }
}

async function checkModelLockForExistingProvider(pool: Pool, providerId: string): Promise<void> {
  const row = await loadProviderRow(pool, providerId);
  if (!row) {
    throw new ControlPlaneError('PROVIDER_NOT_FOUND', 'Embedding provider not found', {
      providerId,
    });
  }
  await checkModelLock(pool, parseProviderModel(parseMetadata(row.metadata)));
}

async function checkModelLock(pool: Pool, incomingModel: string): Promise<void> {
  const result = await pool.query<{ table_name: string; model: string; count: number | string }>(
    `SELECT 'memory_facts' AS table_name, content_model AS model, COUNT(*)::int AS count
       FROM memory_facts
      WHERE embedding IS NOT NULL
      GROUP BY content_model
     UNION ALL
     SELECT 'memory_drawers' AS table_name, embedding_model AS model, COUNT(*)::int AS count
       FROM memory_drawers
      WHERE embedding IS NOT NULL
      GROUP BY embedding_model`,
  );
  const mismatches = result.rows.filter((row) => row.model !== incomingModel);
  if (mismatches.length > 0) {
    throw new ControlPlaneError('MODEL_MISMATCH', 'Existing embeddings use a different model', {
      incomingModel,
      existingModels: mismatches.map((row) => ({
        table: row.table_name,
        model: row.model,
        count: Number(row.count),
      })),
    });
  }
}

async function insertProvider(
  pool: Pool,
  input: {
    name: string;
    provider: EmbeddingProviderKind;
    encryptedCredential: string;
    credentialIv: string;
    apiKeyLast4: string;
    active: boolean;
    metadata: Record<string, unknown>;
  },
): Promise<ProviderRow> {
  try {
    return await withTransaction(pool, async (client) => {
      const result = await client.query<ProviderRow>(
        `INSERT INTO api_accounts (
           name, provider, credential, credential_iv, credential_kind,
           credential_last4, is_active, metadata
         )
         VALUES ($1, $2, $3, $4, 'embedding', $5, $6, $7::jsonb)
         RETURNING id, name, provider, credential_last4, is_active, metadata, created_at, updated_at`,
        [
          input.name,
          input.provider,
          input.encryptedCredential,
          input.credentialIv,
          input.apiKeyLast4,
          input.active,
          JSON.stringify(input.metadata),
        ],
      );
      return requiredRow(result.rows[0], 'PROVIDER_NOT_FOUND', 'Provider insert returned no row');
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error, 'api_accounts_one_active_embedding')) {
      throw new ControlPlaneError(
        'DUPLICATE_ACTIVE_EMBEDDING',
        'An active embedding provider already exists',
      );
    }
    throw error;
  }
}

async function assertProviderHasNoActiveJobs(pool: Pool, providerId: string): Promise<void> {
  const result = await pool.query(
    `SELECT id
       FROM memory_ops_jobs
      WHERE credential_id = $1
        AND status IN ('queued', 'running', 'cancelling')
      LIMIT 1`,
    [providerId],
  );
  if (result.rows.length > 0) {
    throw new ControlPlaneError(
      'PROVIDER_HAS_ACTIVE_JOBS',
      'Provider is referenced by active memory operations jobs',
      { providerId },
    );
  }
}

async function loadProviderRow(client: Pick<Pool | PoolClient, 'query'>, providerId: string) {
  const result = await client.query<ProviderRow>(
    `SELECT id, name, provider, credential, credential_iv, credential_last4, is_active,
            metadata, created_at, updated_at
       FROM api_accounts
      WHERE id = $1
        AND credential_kind = 'embedding'
      LIMIT 1`,
    [providerId],
  );
  return result.rows[0] ?? null;
}

async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function buildProviderMetadata(
  provider: string,
  model: string,
  recentTestResult?: z.infer<typeof recentTestResultSchema>,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    model,
    lastTestOk: null,
    lastTestError: null,
    lastTestedAt: null,
    dim: null,
    latencyMs: null,
    costUsd: null,
  };
  if (!recentTestResult) {
    return metadata;
  }
  const verified = verifyRecentTestResult(recentTestResult, provider, model);
  metadata.lastTestOk = true;
  metadata.lastTestedAt = new Date(verified.testedAt).toISOString();
  metadata.dim = verified.dim;
  metadata.latencyMs = verified.latencyMs;
  metadata.costUsd = verified.costUsd;
  return metadata;
}

function verifyRecentTestResult(
  recentTestResult: z.infer<typeof recentTestResultSchema>,
  expectedProvider: string,
  expectedModel: string,
): RecentTestPayload {
  const signingSecret = readSigningSecret();
  if (!signingSecret) {
    throw new ControlPlaneError(
      'SIGNING_SECRET_MISSING',
      'MEMORY_OPS_SIGNING_SECRET is not configured',
    );
  }
  const [payloadB64, signature] = recentTestResult.signedToken.split('.');
  if (!payloadB64 || !signature) {
    throw invalidRecentTestResult();
  }
  const expectedSignature = createHmac('sha256', signingSecret).update(payloadB64).digest('hex');
  if (!timingSafeEqualHex(signature, expectedSignature)) {
    throw invalidRecentTestResult();
  }
  let payload: RecentTestPayload | undefined;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as
      | RecentTestPayload
      | undefined;
  } catch {
    throw invalidRecentTestResult();
  }
  if (!payload?.ok || payload.provider !== expectedProvider || payload.model !== expectedModel) {
    throw invalidRecentTestResult();
  }
  if (Date.now() - payload.testedAt > TOKEN_TTL_MS) {
    throw invalidRecentTestResult();
  }
  // Recompute the short-lived token binding HMAC for equality only; it is not
  // used as a stored password hash.
  // codeql[js/insufficient-password-hash]
  const fingerprint = fingerprintApiKey(recentTestResult.apiKey, signingSecret);
  if (!timingSafeEqualHex(fingerprint, payload.apiKeyFingerprint)) {
    throw invalidRecentTestResult();
  }
  return payload;
}

function signRecentTestPayload(payload: RecentTestPayload, signingSecret: string): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', signingSecret).update(payloadB64).digest('hex');
  return `${payloadB64}.${signature}`;
}

function invalidRecentTestResult(): ControlPlaneError {
  return new ControlPlaneError('VALIDATION_ERROR', 'recentTestResult is expired or invalid');
}

function fingerprintApiKey(apiKey: string, signingSecret: string): string {
  // This keyed HMAC is a non-reversible token-binding fingerprint for
  // test-before-save, not password storage.
  // codeql[js/insufficient-password-hash]
  return createHmac('sha256', signingSecret).update(apiKey).digest('hex');
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  if (!/^[a-f0-9]+$/iu.test(left) || !/^[a-f0-9]+$/iu.test(right)) {
    return false;
  }
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function findVerifiedCatalogEntry(provider: EmbeddingProviderKind, model: string) {
  return EMBEDDING_MODEL_CATALOG.find(
    (entry) => entry.provider === provider && entry.model === model && entry.verified,
  );
}

function rowToProvider(row: ProviderRow): EmbeddingProvider {
  const metadata = parseMetadata(row.metadata);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as EmbeddingProviderKind,
    model: parseProviderModel(metadata),
    apiKeyLast4: row.credential_last4,
    isActive: Boolean(row.is_active),
    metadata: {
      lastTestOk: readNullableBoolean(metadata.lastTestOk),
      lastTestError: readNullableString(metadata.lastTestError),
      lastTestedAt: readNullableString(metadata.lastTestedAt),
      dim: readNullableNumber(metadata.dim),
      latencyMs: readNullableNumber(metadata.latencyMs),
      costUsd: readNullableNumber(metadata.costUsd),
    },
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function parseMetadata(value: ProviderRow['metadata']): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (value ?? {}) as Record<string, unknown>;
}

function parseProviderModel(metadata: Record<string, unknown>): string {
  const model = metadata.model;
  if (typeof model !== 'string' || model.length === 0) {
    throw new ControlPlaneError('CATALOG_INVALID', 'Embedding provider metadata has no model');
  }
  return model;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toIsoString(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return new Date(0).toISOString();
}

function normalizeProviderId(id: string): string {
  if (!SAFE_PROVIDER_ID.test(id)) {
    throw new ControlPlaneError('VALIDATION_ERROR', 'Invalid provider id');
  }
  return id;
}

function requiredRow<T>(row: T | undefined, code: string, message: string): T {
  if (!row) {
    throw new ControlPlaneError(code, message);
  }
  return row;
}

function isUniqueConstraintViolation(error: unknown, constraintName: string): boolean {
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === constraintName;
}

function last4(value: string): string {
  return value.slice(-4);
}

function actorFromRequest(headers: Record<string, string | string[] | undefined>): string {
  const header = headers['x-agentctl-actor'];
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim().slice(0, 200);
  }
  return `local:${hostname()}`;
}

function readSigningSecret(): string {
  return process.env.MEMORY_OPS_SIGNING_SECRET ?? '';
}

function memoryOpsStatus(code: string): number {
  const status = new Map<string, number>([
    ['VALIDATION_ERROR', 422],
    ['SIGNING_SECRET_MISSING', 503],
    ['DUPLICATE_ACTIVE_EMBEDDING', 409],
    ['MODEL_MISMATCH', 409],
    ['PROVIDER_HAS_ACTIVE_JOBS', 409],
    ['PROVIDER_NOT_FOUND', 404],
    ['PROVIDER_AUTH_FAILED', 401],
    ['CATALOG_INVALID', 500],
  ]).get(code);
  return status ?? 500;
}
