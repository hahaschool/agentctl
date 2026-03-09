import type {
  CreateManagedSessionRequest,
  ForkManagedSessionRequest,
  ManagedRuntime,
  ResumeManagedSessionRequest,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import type {
  ManagedSessionRecord,
  ManagedSessionStore,
} from '../../runtime-management/managed-session-store.js';
import type { RuntimeConfigStore } from '../../runtime-management/runtime-config-store.js';
import { WORKER_REQUEST_TIMEOUT_MS } from '../constants.js';
import { proxyWorkerRequest } from '../proxy-worker-request.js';
import { resolveWorkerUrlByMachineIdOrThrow } from '../resolve-worker-url.js';

export type RuntimeSessionRoutesOptions = {
  managedSessionStore: Pick<ManagedSessionStore, 'list' | 'create' | 'get' | 'updateStatus'>;
  runtimeConfigStore?: Pick<RuntimeConfigStore, 'getLatestRevision'>;
  dbRegistry?: DbAgentRegistry;
  workerPort?: number;
};

export const runtimeSessionRoutes: FastifyPluginAsync<RuntimeSessionRoutesOptions> = async (
  app,
  opts,
) => {
  const { managedSessionStore, runtimeConfigStore, dbRegistry, workerPort = 9000 } = opts;

  app.get<{
    Querystring: { machineId?: string; runtime?: ManagedRuntime; status?: string; limit?: string };
  }>(
    '/',
    {
      schema: {
        tags: ['runtime-sessions'],
        summary: 'List unified runtime sessions across Claude Code and Codex',
      },
    },
    async (request) => {
      const sessions = await managedSessionStore.list({
        machineId: request.query.machineId,
        runtime: request.query.runtime,
        status: request.query.status as never,
        limit: request.query.limit ? Number(request.query.limit) : 20,
      });

      return {
        sessions,
        count: sessions.length,
      };
    },
  );

  app.post<{ Body: CreateManagedSessionRequest }>(
    '/',
    {
      schema: {
        tags: ['runtime-sessions'],
        summary: 'Create a unified runtime session on a target worker',
      },
    },
    async (request, reply) => {
      const configRevision = await getActiveConfigRevision(runtimeConfigStore);
      const session = await managedSessionStore.create({
        runtime: request.body.runtime,
        nativeSessionId: null,
        machineId: request.body.machineId,
        agentId: request.body.agentId ?? null,
        projectPath: request.body.projectPath,
        worktreePath: null,
        status: 'starting',
        configRevision,
        handoffStrategy: null,
        handoffSourceSessionId: null,
        metadata: {},
      });

      const workerBaseUrl = await resolveWorker(request.body.machineId, dbRegistry, workerPort);
      const result = await proxyWorkerRequest({
        workerBaseUrl,
        path: '/api/runtime-sessions',
        method: 'POST',
        body: {
          runtime: request.body.runtime,
          agentId: request.body.agentId ?? 'adhoc',
          projectPath: request.body.projectPath,
          prompt: request.body.prompt,
          model: request.body.model ?? null,
        },
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!result.ok) {
        await managedSessionStore.updateStatus(session.id, 'error', { endedAt: new Date() });
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      const workerSession = extractWorkerSession(result.data);
      const updated = await managedSessionStore.updateStatus(
        session.id,
        workerSession.status ?? 'active',
        {
          nativeSessionId: workerSession.nativeSessionId ?? null,
          lastHeartbeat: new Date(),
        },
      );

      return reply.code(201).send({ ok: true, session: updated });
    },
  );

  app.post<{
    Params: { id: string };
    Body: ResumeManagedSessionRequest;
  }>(
    '/:id/resume',
    {
      schema: {
        tags: ['runtime-sessions'],
        summary: 'Resume a unified runtime session',
      },
    },
    async (request, reply) => {
      const existing = await managedSessionStore.get(request.params.id);
      if (!existing) {
        return reply.code(404).send({
          error: 'MANAGED_SESSION_NOT_FOUND',
          message: `Managed session '${request.params.id}' was not found`,
        });
      }

      const nativeSessionId = request.body.nativeSessionId ?? existing.nativeSessionId;
      if (!nativeSessionId) {
        return reply.code(400).send({
          error: 'MISSING_NATIVE_SESSION_ID',
          message: 'Resume requires a native session id',
        });
      }

      const workerBaseUrl = await resolveWorker(existing.machineId, dbRegistry, workerPort);
      const result = await proxyWorkerRequest({
        workerBaseUrl,
        path: `/api/runtime-sessions/${encodeURIComponent(nativeSessionId)}/resume`,
        method: 'POST',
        body: {
          runtime: existing.runtime,
          agentId: existing.agentId ?? 'adhoc',
          projectPath: existing.projectPath,
          prompt: request.body.prompt,
          model: request.body.model ?? null,
        },
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      const workerSession = extractWorkerSession(result.data);
      const updated = await managedSessionStore.updateStatus(
        existing.id,
        workerSession.status ?? 'active',
        {
          nativeSessionId: workerSession.nativeSessionId ?? nativeSessionId,
          lastHeartbeat: new Date(),
        },
      );

      return { ok: true, session: updated };
    },
  );

  app.post<{
    Params: { id: string };
    Body: ForkManagedSessionRequest;
  }>(
    '/:id/fork',
    {
      schema: {
        tags: ['runtime-sessions'],
        summary: 'Fork a unified runtime session within the same runtime',
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
          message: 'Fork requires a source native session id',
        });
      }

      const targetMachineId = request.body.targetMachineId ?? source.machineId;
      const configRevision = await getActiveConfigRevision(runtimeConfigStore);
      const forked = await managedSessionStore.create({
        runtime: source.runtime,
        nativeSessionId: null,
        machineId: targetMachineId,
        agentId: source.agentId,
        projectPath: source.projectPath,
        worktreePath: source.worktreePath,
        status: 'starting',
        configRevision,
        handoffStrategy: null,
        handoffSourceSessionId: source.id,
        metadata: {},
      });

      const workerBaseUrl = await resolveWorker(targetMachineId, dbRegistry, workerPort);
      const result = await proxyWorkerRequest({
        workerBaseUrl,
        path: `/api/runtime-sessions/${encodeURIComponent(source.nativeSessionId)}/fork`,
        method: 'POST',
        body: {
          runtime: source.runtime,
          agentId: source.agentId ?? 'adhoc',
          projectPath: source.projectPath,
          prompt: request.body.prompt ?? null,
          model: request.body.model ?? null,
        },
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!result.ok) {
        await managedSessionStore.updateStatus(forked.id, 'error', { endedAt: new Date() });
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      const workerSession = extractWorkerSession(result.data);
      const updated = await managedSessionStore.updateStatus(
        forked.id,
        workerSession.status ?? 'active',
        {
          nativeSessionId: workerSession.nativeSessionId ?? null,
          lastHeartbeat: new Date(),
        },
      );

      return { ok: true, session: updated };
    },
  );
};

async function getActiveConfigRevision(
  runtimeConfigStore?: Pick<RuntimeConfigStore, 'getLatestRevision'>,
): Promise<number> {
  const latest = await runtimeConfigStore?.getLatestRevision();
  return latest?.version ?? 1;
}

async function resolveWorker(
  machineId: string,
  dbRegistry: DbAgentRegistry | undefined,
  workerPort: number,
): Promise<string> {
  if (!dbRegistry) {
    throw new Error('Runtime session routes require dbRegistry to resolve worker addresses');
  }

  return resolveWorkerUrlByMachineIdOrThrow(machineId, { dbRegistry, workerPort });
}

function extractWorkerSession(
  data: unknown,
): { nativeSessionId?: string | null; status?: ManagedSessionRecord['status'] } {
  const record = (data ?? {}) as {
    session?: { nativeSessionId?: string | null; status?: ManagedSessionRecord['status'] };
  };
  return record.session ?? {};
}
