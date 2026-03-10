import type {
  ExportHandoffSnapshotRequest,
  HandoffManagedSessionRequest,
  HandoffSnapshot,
  HandoffStrategy,
  NativeImportPreflightRequest,
  RuntimeHandoffSummaryResponse,
  StartHandoffRequest,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

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
    workerPort = 9000,
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
    async (request): Promise<RuntimeHandoffSummaryResponse> => {
      const limit = request.query.limit ? Number(request.query.limit) : 100;
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
    async (request) => {
      const limit = request.query.limit ? Number(request.query.limit) : 20;
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

      const targetMachineId = request.query.targetMachineId ?? source.machineId;
      const targetWorkerBaseUrl = await resolveWorker(targetMachineId, dbRegistry, workerPort);

      const result = await proxyWorkerRequest({
        workerBaseUrl: targetWorkerBaseUrl,
        path: '/api/runtime-sessions/handoff/preflight',
        method: 'POST',
        body: {
          targetRuntime: request.query.targetRuntime,
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

      const targetMachineId = request.body.targetMachineId ?? source.machineId;
      const sourceWorkerBaseUrl = await resolveWorker(source.machineId, dbRegistry, workerPort);
      const targetWorkerBaseUrl = await resolveWorker(targetMachineId, dbRegistry, workerPort);

      await managedSessionStore.updateStatus(source.id, 'handing_off', {
        lastHeartbeat: new Date(),
      });

      const exportResult = await proxyWorkerRequest({
        workerBaseUrl: sourceWorkerBaseUrl,
        path: `/api/runtime-sessions/${encodeURIComponent(source.nativeSessionId)}/handoff/export`,
        method: 'POST',
        body: buildExportRequest(source, request.body),
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
        runtime: request.body.targetRuntime,
        nativeSessionId: null,
        machineId: targetMachineId,
        agentId: source.agentId,
        projectPath: source.projectPath,
        worktreePath: source.worktreePath,
        status: 'starting',
        configRevision,
        handoffStrategy: 'snapshot-handoff',
        handoffSourceSessionId: source.id,
        metadata: { reason: request.body.reason, sourceRuntime: source.runtime },
      });

      const handoffResult = await proxyWorkerRequest({
        workerBaseUrl: targetWorkerBaseUrl,
        path: '/api/runtime-sessions/handoff',
        method: 'POST',
        body: {
          targetRuntime: request.body.targetRuntime,
          agentId: source.agentId ?? 'adhoc',
          projectPath: source.projectPath,
          prompt: request.body.prompt ?? null,
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
          targetRuntime: request.body.targetRuntime,
          reason: request.body.reason,
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
        targetRuntime: request.body.targetRuntime,
        reason: request.body.reason,
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
