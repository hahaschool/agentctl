import type {
  ManualTakeoverResponse,
  ManualTakeoverState,
  StartManualTakeoverRequest,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import type {
  ManagedSessionRecord,
  ManagedSessionStore,
} from '../../runtime-management/managed-session-store.js';
import { WORKER_REQUEST_TIMEOUT_MS } from '../constants.js';
import { proxyWorkerRequest } from '../proxy-worker-request.js';
import { resolveWorkerUrlByMachineIdOrThrow } from '../resolve-worker-url.js';

export type ManualTakeoverRoutesOptions = {
  managedSessionStore: Pick<ManagedSessionStore, 'get' | 'patchMetadata'>;
  dbRegistry?: DbAgentRegistry;
  workerPort?: number;
};

export const manualTakeoverRoutes: FastifyPluginAsync<ManualTakeoverRoutesOptions> = async (
  app,
  opts,
) => {
  const { managedSessionStore, dbRegistry, workerPort = 9000 } = opts;

  app.post<{
    Params: { id: string };
    Body: StartManualTakeoverRequest;
  }>(
    '/:id/manual-takeover',
    {
      schema: {
        tags: ['runtime-sessions'],
        summary: 'Start or reuse a manual Claude Remote Control takeover for a managed session',
      },
    },
    async (request, reply) => {
      const session = await requireManualTakeoverSession(
        managedSessionStore,
        request.params.id,
        reply,
      );
      if (!session) {
        return reply;
      }
      const nativeSessionId = session.nativeSessionId;
      if (!nativeSessionId) {
        return reply;
      }

      const workerBaseUrl = await resolveWorker(session.machineId, dbRegistry, workerPort);
      const result = await proxyWorkerRequest({
        workerBaseUrl,
        path: `/api/runtime-sessions/${encodeURIComponent(nativeSessionId)}/manual-takeover`,
        method: 'POST',
        body: {
          agentId: session.agentId ?? session.id,
          projectPath: session.projectPath,
          permissionMode: request.body.permissionMode ?? null,
        },
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      const manualTakeover = extractManualTakeover(result.data);
      if (manualTakeover) {
        await managedSessionStore.patchMetadata(session.id, { manualTakeover });
      }

      return reply.status(result.status).send(result.data);
    },
  );

  app.get<{
    Params: { id: string };
  }>(
    '/:id/manual-takeover',
    {
      schema: {
        tags: ['runtime-sessions'],
        summary: 'Read manual Claude Remote Control takeover state for a managed session',
      },
    },
    async (request, reply) => {
      const session = await requireManualTakeoverSession(
        managedSessionStore,
        request.params.id,
        reply,
      );
      if (!session) {
        return reply;
      }
      const nativeSessionId = session.nativeSessionId;
      if (!nativeSessionId) {
        return reply;
      }

      const workerBaseUrl = await resolveWorker(session.machineId, dbRegistry, workerPort);
      const result = await proxyWorkerRequest({
        workerBaseUrl,
        path: `/api/runtime-sessions/${encodeURIComponent(nativeSessionId)}/manual-takeover`,
        method: 'GET',
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      const manualTakeover = extractManualTakeover(result.data);
      if (manualTakeover) {
        await managedSessionStore.patchMetadata(session.id, { manualTakeover });
        return reply.status(result.status).send(result.data);
      }

      const storedManualTakeover = readStoredManualTakeover(session.metadata);
      if (!storedManualTakeover) {
        return reply.status(result.status).send(result.data);
      }

      const reconciled = reconcileMissingManualTakeover(storedManualTakeover);
      await managedSessionStore.patchMetadata(session.id, { manualTakeover: reconciled });
      return reply.status(result.status).send({
        ok: true,
        manualTakeover: reconciled,
      } satisfies ManualTakeoverResponse);
    },
  );

  app.delete<{
    Params: { id: string };
  }>(
    '/:id/manual-takeover',
    {
      schema: {
        tags: ['runtime-sessions'],
        summary: 'Revoke a manual Claude Remote Control takeover for a managed session',
      },
    },
    async (request, reply) => {
      const session = await requireManualTakeoverSession(
        managedSessionStore,
        request.params.id,
        reply,
      );
      if (!session) {
        return reply;
      }
      const nativeSessionId = session.nativeSessionId;
      if (!nativeSessionId) {
        return reply;
      }

      const workerBaseUrl = await resolveWorker(session.machineId, dbRegistry, workerPort);
      const result = await proxyWorkerRequest({
        workerBaseUrl,
        path: `/api/runtime-sessions/${encodeURIComponent(nativeSessionId)}/manual-takeover`,
        method: 'DELETE',
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      const manualTakeover =
        extractManualTakeover(result.data) ??
        reconcileMissingManualTakeover(readStoredManualTakeover(session.metadata));
      if (manualTakeover) {
        await managedSessionStore.patchMetadata(session.id, { manualTakeover });
      }

      return reply.status(result.status).send(
        manualTakeover
          ? ({
              ok: true,
              manualTakeover,
            } satisfies ManualTakeoverResponse)
          : result.data,
      );
    },
  );
};

async function requireManualTakeoverSession(
  managedSessionStore: Pick<ManagedSessionStore, 'get'>,
  sessionId: string,
  reply: {
    code: (statusCode: number) => { send: (payload: Record<string, string>) => unknown };
  },
): Promise<ManagedSessionRecord | null> {
  const session = await managedSessionStore.get(sessionId);

  if (!session) {
    reply.code(404).send({
      error: 'MANAGED_SESSION_NOT_FOUND',
      message: `Managed session '${sessionId}' was not found`,
    });
    return null;
  }

  if (session.runtime !== 'claude-code') {
    reply.code(400).send({
      error: 'INVALID_MANUAL_TAKEOVER_RUNTIME',
      message: 'Manual takeover is only available for Claude Code managed sessions',
    });
    return null;
  }

  if (!session.nativeSessionId) {
    reply.code(400).send({
      error: 'MISSING_NATIVE_SESSION_ID',
      message: 'Manual takeover requires a native session id',
    });
    return null;
  }

  return session;
}

async function resolveWorker(
  machineId: string,
  dbRegistry: DbAgentRegistry | undefined,
  workerPort: number,
): Promise<string> {
  if (!dbRegistry) {
    throw new Error('DbAgentRegistry is required to resolve worker URLs for manual takeover');
  }

  return resolveWorkerUrlByMachineIdOrThrow(machineId, {
    dbRegistry,
    workerPort,
  });
}

function extractManualTakeover(data: unknown): ManualTakeoverState | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const candidate = (data as { manualTakeover?: unknown }).manualTakeover;
  return isRecord(candidate) ? (candidate as ManualTakeoverState) : null;
}

function readStoredManualTakeover(metadata: Record<string, unknown>): ManualTakeoverState | null {
  const candidate = metadata.manualTakeover;
  return isRecord(candidate) ? (candidate as ManualTakeoverState) : null;
}

function reconcileMissingManualTakeover(
  manualTakeover: ManualTakeoverState | null,
): ManualTakeoverState | null {
  if (!manualTakeover) {
    return null;
  }

  return {
    ...manualTakeover,
    status: manualTakeover.status === 'error' ? 'error' : 'stopped',
    sessionUrl: null,
    lastVerifiedAt: new Date().toISOString(),
    error:
      manualTakeover.status === 'error'
        ? (manualTakeover.error ?? 'Worker no longer owns this manual takeover session')
        : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
