import {
  DEFAULT_WORKER_PORT,
  type ExportHandoffSnapshotRequest,
  HANDOFF_REASONS,
  type HandoffManagedSessionRequest,
  type HandoffSnapshot,
  type HandoffStrategy,
  MANAGED_RUNTIMES,
  type NativeImportPreflightRequest,
  type RuntimeHandoffSummaryResponse,
  type StartHandoffRequest,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import type { HandoffStore, SessionHandoffRecord } from '../../runtime-management/handoff-store.js';
import type {
  ManagedSessionRecord,
  ManagedSessionStore,
} from '../../runtime-management/managed-session-store.js';
import type { RuntimeConfigStore } from '../../runtime-management/runtime-config-store.js';
import { WORKER_REQUEST_TIMEOUT_MS } from '../constants.js';
import { proxyWorkerRequest } from '../proxy-worker-request.js';
import { resolveWorkerUrlByMachineIdOrThrow } from '../resolve-worker-url.js';

// Handoff bodies/queries drive cross-machine worker RPCs with strings baked
// into URLs and worker payloads. Caps guard against unbounded prompts/reasons
// being persisted in handoff history and keep pagination limits in a safe
// range — callers cannot DoS the summary query by requesting millions of rows.
const MAX_HANDOFF_ID_LENGTH = 128;
const MAX_HANDOFF_PROMPT_LENGTH = 8_192;
const MAX_HANDOFF_LIMIT = 500;

const handoffSummaryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_HANDOFF_LIMIT).optional(),
});

const handoffListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_HANDOFF_LIMIT).optional(),
});

const handoffPreflightQuerySchema = z.object({
  targetRuntime: z.enum(MANAGED_RUNTIMES),
  targetMachineId: z.string().min(1).max(MAX_HANDOFF_ID_LENGTH).optional(),
});

const handoffRequestBodySchema = z.object({
  targetRuntime: z.enum(MANAGED_RUNTIMES),
  targetMachineId: z.string().min(1).max(MAX_HANDOFF_ID_LENGTH).nullable().optional(),
  reason: z.enum(HANDOFF_REASONS),
  prompt: z.string().max(MAX_HANDOFF_PROMPT_LENGTH).nullable().optional(),
});

function mapHandoffQueryIssue(issue: z.ZodIssue | undefined): {
  error: string;
  message: string;
} {
  const field = issue?.path[0];
  if (field === 'limit') {
    return {
      error: 'INVALID_LIMIT',
      message: `"limit" must be a positive integer ≤ ${MAX_HANDOFF_LIMIT}`,
    };
  }
  if (field === 'targetRuntime') {
    return {
      error: 'INVALID_TARGET_RUNTIME',
      message: `targetRuntime must be one of: ${MANAGED_RUNTIMES.join(', ')}`,
    };
  }
  if (field === 'targetMachineId') {
    return {
      error: 'INVALID_TARGET_MACHINE_ID',
      message: `"targetMachineId" must be a non-empty string of at most ${MAX_HANDOFF_ID_LENGTH} characters`,
    };
  }
  return { error: 'INVALID_HANDOFF_QUERY', message: 'Invalid handoff query parameters' };
}

function mapHandoffBodyIssue(issue: z.ZodIssue | undefined): { error: string; message: string } {
  const field = issue?.path[0];
  switch (field) {
    case 'targetRuntime':
      return {
        error: 'INVALID_TARGET_RUNTIME',
        message: `targetRuntime must be one of: ${MANAGED_RUNTIMES.join(', ')}`,
      };
    case 'targetMachineId':
      return {
        error: 'INVALID_TARGET_MACHINE_ID',
        message: `"targetMachineId" must be a non-empty string of at most ${MAX_HANDOFF_ID_LENGTH} characters`,
      };
    case 'reason':
      return {
        error: 'INVALID_REASON',
        message: `reason must be one of: ${HANDOFF_REASONS.join(', ')}`,
      };
    case 'prompt':
      return {
        error: 'INVALID_PROMPT',
        message: `"prompt" must be a string of at most ${MAX_HANDOFF_PROMPT_LENGTH} characters when provided`,
      };
    default:
      return { error: 'INVALID_HANDOFF_BODY', message: 'Invalid handoff body' };
  }
}

export type HandoffRoutesOptions = {
  managedSessionStore: Pick<ManagedSessionStore, 'get' | 'create' | 'updateStatus'>;
  handoffStore: Pick<
    HandoffStore,
    'create' | 'listForSession' | 'recordNativeImportAttempt' | 'summarizeRecent'
  >;
  runtimeConfigStore?: Pick<RuntimeConfigStore, 'getLatestRevision'>;
  dbRegistry?: DbAgentRegistry;
  workerPort?: number;
};

export const handoffRoutes: FastifyPluginAsync<HandoffRoutesOptions> = async (app, opts) => {
  const {
    managedSessionStore,
    handoffStore,
    runtimeConfigStore,
    dbRegistry,
    workerPort = DEFAULT_WORKER_PORT,
  } = opts;

  app.get<{
    Querystring: { limit?: string };
  }>(
    '/handoffs/summary',
    {
      schema: {
        tags: ['runtime-sessions'],
        summary: 'Summarize recent runtime handoff outcomes across the fleet',
      },
    },
    async (request, reply): Promise<RuntimeHandoffSummaryResponse | undefined> => {
      const parsed = handoffSummaryQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        reply.code(400).send(mapHandoffQueryIssue(parsed.error.issues[0]));
        return undefined;
      }
      const limit = parsed.data.limit ?? 100;
      const summary = await handoffStore.summarizeRecent(limit);
      return {
        ok: true,
        summary,
        limit,
      };
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>(
    '/:id/handoffs',
    {
      schema: {
        tags: ['runtime-sessions'],
        summary: 'List handoff history for a managed runtime session',
      },
    },
    async (request, reply) => {
      const parsed = handoffListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        reply.code(400).send(mapHandoffQueryIssue(parsed.error.issues[0]));
        return;
      }
      const limit = parsed.data.limit ?? 20;
      const handoffs = await handoffStore.listForSession(request.params.id, limit);
      return {
        handoffs,
        count: handoffs.length,
      };
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { targetRuntime: ManagedSessionRecord['runtime']; targetMachineId?: string };
  }>(
    '/:id/handoff/preflight',
    {
      schema: {
        tags: ['runtime-sessions'],
        summary: 'Probe whether native import is available before a cross-runtime handoff',
      },
    },
    async (request, reply) => {
      const parsedQuery = handoffPreflightQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.code(400).send(mapHandoffQueryIssue(parsedQuery.error.issues[0]));
      }
      const source = await managedSessionStore.get(request.params.id);
      if (!source) {
        return reply.code(404).send({
          error: 'MANAGED_SESSION_NOT_FOUND',
          message: `Managed session '${request.params.id}' was not found`,
        });
      }

      if (!source.nativeSessionId) {
        return reply.code(400).send({
          error: 'MISSING_NATIVE_SESSION_ID',
          message: 'Preflight requires a source native session id',
        });
      }

      const targetMachineId = parsedQuery.data.targetMachineId ?? source.machineId;
      const targetWorkerBaseUrl = await resolveWorker(targetMachineId, dbRegistry, workerPort);

      const result = await proxyWorkerRequest({
        workerBaseUrl: targetWorkerBaseUrl,
        path: '/api/runtime-sessions/handoff/preflight',
        method: 'POST',
        body: {
          targetRuntime: parsedQuery.data.targetRuntime as ManagedSessionRecord['runtime'],
          projectPath: source.projectPath,
          snapshot: buildPreflightSnapshot(source),
        } satisfies NativeImportPreflightRequest,
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!result.ok) {
        return reply.status(result.status).send({
          error: result.error,
          message: result.message,
        });
      }

      return result.data;
    },
  );

  app.post<{
    Params: { id: string };
    Body: HandoffManagedSessionRequest;
  }>(
    '/:id/handoff',
    {
      schema: {
        tags: ['runtime-sessions'],
        summary: 'Hand off a managed runtime session to another runtime using a snapshot',
      },
    },
    async (request, reply) => {
      const parsedBody = handoffRequestBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send(mapHandoffBodyIssue(parsedBody.error.issues[0]));
      }
      const { targetRuntime, reason, prompt } = parsedBody.data;
      const source = await managedSessionStore.get(request.params.id);
      if (!source) {
        return reply.code(404).send({
          error: 'MANAGED_SESSION_NOT_FOUND',
          message: `Managed session '${request.params.id}' was not found`,
        });
      }

      if (!source.nativeSessionId) {
        return reply.code(400).send({
          error: 'MISSING_NATIVE_SESSION_ID',
          message: 'Handoff requires a source native session id',
        });
      }

      const targetMachineId = parsedBody.data.targetMachineId ?? source.machineId;
      const sourceWorkerBaseUrl = await resolveWorker(source.machineId, dbRegistry, workerPort);
      const targetWorkerBaseUrl = await resolveWorker(targetMachineId, dbRegistry, workerPort);

      await managedSessionStore.updateStatus(source.id, 'handing_off', {
        lastHeartbeat: new Date(),
      });

      const exportResult = await proxyWorkerRequest({
        workerBaseUrl: sourceWorkerBaseUrl,
        path: `/api/runtime-sessions/${encodeURIComponent(source.nativeSessionId)}/handoff/export`,
        method: 'POST',
        body: buildExportRequest(source, parsedBody.data),
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!exportResult.ok) {
        await managedSessionStore.updateStatus(source.id, 'active', {
          lastHeartbeat: new Date(),
        });
        return reply.status(exportResult.status).send({
          error: exportResult.error,
          message: exportResult.message,
        });
      }

      const snapshot = extractSnapshot(exportResult.data);
      const configRevision = await getActiveConfigRevision(runtimeConfigStore);
      const target = await managedSessionStore.create({
        runtime: targetRuntime,
        nativeSessionId: null,
        machineId: targetMachineId,
        agentId: source.agentId,
        projectPath: source.projectPath,
        worktreePath: source.worktreePath,
        status: 'starting',
        configRevision,
        handoffStrategy: 'snapshot-handoff',
        handoffSourceSessionId: source.id,
        metadata: { reason, sourceRuntime: source.runtime },
      });

      const handoffResult = await proxyWorkerRequest({
        workerBaseUrl: targetWorkerBaseUrl,
        path: '/api/runtime-sessions/handoff',
        method: 'POST',
        body: {
          targetRuntime,
          agentId: source.agentId ?? 'adhoc',
          projectPath: source.projectPath,
          prompt: prompt ?? null,
          snapshot,
        } satisfies StartHandoffRequest,
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!handoffResult.ok) {
        await managedSessionStore.updateStatus(source.id, 'active', {
          lastHeartbeat: new Date(),
        });
        await managedSessionStore.updateStatus(target.id, 'error', {
          endedAt: new Date(),
        });
        const failed = await handoffStore.create({
          sourceSessionId: source.id,
          targetSessionId: target.id,
          sourceRuntime: source.runtime,
          targetRuntime,
          reason,
          strategy: 'snapshot-handoff',
          status: 'failed',
          snapshot,
          errorMessage: handoffResult.message,
          completedAt: new Date(),
        });
        return reply.status(handoffResult.status).send({
          error: handoffResult.error,
          message: handoffResult.message,
          handoffId: failed.id,
        });
      }

      const execution = extractExecution(handoffResult.data);
      await managedSessionStore.updateStatus(source.id, 'paused', {
        lastHeartbeat: new Date(),
      });
      const updatedTarget = await managedSessionStore.updateStatus(
        target.id,
        execution.session.status ?? 'active',
        {
          nativeSessionId: execution.session.nativeSessionId ?? null,
          handoffStrategy: execution.strategy ?? 'snapshot-handoff',
          lastHeartbeat: new Date(),
        },
      );

      const handoff = await handoffStore.create({
        sourceSessionId: source.id,
        targetSessionId: updatedTarget.id,
        sourceRuntime: source.runtime,
        targetRuntime,
        reason,
        strategy: execution.strategy ?? 'snapshot-handoff',
        status: 'succeeded',
        snapshot,
        errorMessage: null,
        completedAt: new Date(),
      });
      await recordNativeImportAttempt(handoffStore, handoff, source, updatedTarget, execution);

      return reply.code(202).send({
        ok: true,
        handoffId: handoff.id,
        strategy: handoff.strategy,
        attemptedStrategies: execution.attemptedStrategies ?? ['snapshot-handoff'],
        nativeImportAttempt: execution.nativeImportAttempt,
        snapshot,
        session: updatedTarget,
      });
    },
  );
};

async function getActiveConfigRevision(
  runtimeConfigStore?: Pick<RuntimeConfigStore, 'getLatestRevision'>,
): Promise<number> {
  const latest = await runtimeConfigStore?.getLatestRevision();
  return latest?.version ?? 1;
}

function buildExportRequest(
  source: ManagedSessionRecord,
  input: HandoffManagedSessionRequest,
): ExportHandoffSnapshotRequest {
  return {
    sourceRuntime: source.runtime,
    sourceSessionId: source.id,
    projectPath: source.projectPath,
    worktreePath: source.worktreePath,
    activeConfigRevision: source.configRevision,
    reason: input.reason,
    prompt: input.prompt ?? null,
    activeMcpServers: [],
    activeSkills: [],
  };
}

function buildPreflightSnapshot(source: ManagedSessionRecord): HandoffSnapshot {
  return {
    sourceRuntime: source.runtime,
    sourceSessionId: source.id,
    sourceNativeSessionId: source.nativeSessionId,
    projectPath: source.projectPath,
    worktreePath: source.worktreePath,
    branch: null,
    headSha: null,
    dirtyFiles: [],
    diffSummary: '',
    conversationSummary: '',
    openTodos: [],
    nextSuggestedPrompt: 'Continue from the handoff snapshot.',
    activeConfigRevision: source.configRevision,
    activeMcpServers: [],
    activeSkills: [],
    reason: 'manual',
  };
}

async function resolveWorker(
  machineId: string,
  dbRegistry: DbAgentRegistry | undefined,
  workerPort: number,
): Promise<string> {
  if (!dbRegistry) {
    throw new Error('Handoff routes require dbRegistry to resolve worker addresses');
  }

  return resolveWorkerUrlByMachineIdOrThrow(machineId, { dbRegistry, workerPort });
}

function extractSnapshot(data: unknown): HandoffSnapshot {
  const record = data as { snapshot?: HandoffSnapshot };
  if (!record?.snapshot) {
    throw new Error('Worker handoff export did not return a snapshot');
  }
  return record.snapshot;
}

function extractExecution(data: unknown): {
  strategy?: HandoffStrategy;
  attemptedStrategies?: HandoffStrategy[];
  nativeImportAttempt?: {
    ok?: boolean;
    sourceRuntime?: ManagedSessionRecord['runtime'];
    targetRuntime?: ManagedSessionRecord['runtime'];
    reason?: string;
    metadata?: Record<string, unknown>;
  };
  session: { nativeSessionId?: string | null; status?: ManagedSessionRecord['status'] };
} {
  const record = data as {
    strategy?: HandoffStrategy;
    attemptedStrategies?: HandoffStrategy[];
    nativeImportAttempt?: {
      ok?: boolean;
      sourceRuntime?: ManagedSessionRecord['runtime'];
      targetRuntime?: ManagedSessionRecord['runtime'];
      reason?: string;
      metadata?: Record<string, unknown>;
    };
    session?: { nativeSessionId?: string | null; status?: ManagedSessionRecord['status'] };
  };

  return {
    strategy: record?.strategy,
    attemptedStrategies: record?.attemptedStrategies,
    nativeImportAttempt: record?.nativeImportAttempt,
    session: record?.session ?? {},
  };
}

async function recordNativeImportAttempt(
  handoffStore: Pick<HandoffStore, 'recordNativeImportAttempt'>,
  handoff: SessionHandoffRecord,
  source: ManagedSessionRecord,
  target: ManagedSessionRecord,
  execution: ReturnType<typeof extractExecution>,
): Promise<void> {
  if (!execution.nativeImportAttempt) {
    return;
  }

  await handoffStore.recordNativeImportAttempt({
    handoffId: handoff.id,
    sourceSessionId: source.id,
    targetSessionId: target.id,
    sourceRuntime: execution.nativeImportAttempt.sourceRuntime ?? source.runtime,
    targetRuntime: execution.nativeImportAttempt.targetRuntime ?? target.runtime,
    status: execution.nativeImportAttempt.ok ? 'succeeded' : 'failed',
    metadata: execution.nativeImportAttempt.metadata ?? {},
    errorMessage: execution.nativeImportAttempt.ok
      ? null
      : (execution.nativeImportAttempt.reason ?? 'native import failed'),
  });
}
