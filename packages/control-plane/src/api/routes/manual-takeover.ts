import type {
  ManualTakeoverResponse,
  ManualTakeoverState,
  ManualTakeoverStatus,
  StartManualTakeoverRequest,
} from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
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

/**
 * Outcome of a follow-up relay/worker re-check after a missing manual-takeover
 * response. Drives the status decision in `reconcileMissingManualTakeover`.
 */
type RelayReverificationResult =
  | { kind: 'confirmed-missing' }
  | { kind: 'still-active'; manualTakeover: ManualTakeoverState }
  | { kind: 'unreachable'; reason: string };

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

      // The first worker GET reported no manual takeover, but the worker may
      // have been mid-restart or briefly partitioned from the relay. Re-verify
      // before flipping a previously-online takeover to a terminal `stopped`
      // state.
      const reverification = await reverifyMissingManualTakeover({
        workerBaseUrl,
        nativeSessionId,
      });

      if (reverification.kind === 'still-active') {
        app.log.info(
          {
            agentId: session.agentId,
            sessionId: session.id,
            machineId: session.machineId,
            nativeSessionId,
            relayCheck: 'still-active',
          },
          'Manual takeover reappeared on re-verification; keeping live state',
        );
        await managedSessionStore.patchMetadata(session.id, {
          manualTakeover: reverification.manualTakeover,
        });
        return reply.status(result.status).send({
          ok: true,
          manualTakeover: reverification.manualTakeover,
        } satisfies ManualTakeoverResponse);
      }

      if (reverification.kind === 'unreachable') {
        app.log.warn(
          {
            agentId: session.agentId,
            sessionId: session.id,
            machineId: session.machineId,
            nativeSessionId,
            relayCheck: 'unreachable',
            reason: reverification.reason,
          },
          'Worker unreachable on manual-takeover re-verification; marking session as reconnecting',
        );
      } else {
        app.log.info(
          {
            agentId: session.agentId,
            sessionId: session.id,
            machineId: session.machineId,
            nativeSessionId,
            relayCheck: 'confirmed-missing',
          },
          'Manual takeover confirmed missing on re-verification; marking stopped',
        );
      }

      const reconciled = reconcileMissingManualTakeover(storedManualTakeover, reverification);
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
        reconcileMissingManualTakeover(readStoredManualTakeover(session.metadata), {
          kind: 'confirmed-missing',
        });
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

/**
 * Re-poll the worker once with a short timeout to confirm whether the manual
 * takeover is genuinely gone before we transition to a terminal `stopped`
 * status. This guards against a single transient miss (worker mid-restart,
 * relay flap) producing a hollow reconciliation.
 *
 * Failures here are intentionally non-fatal — they bubble up as the
 * `unreachable` outcome so the caller can flip to a non-terminal
 * `reconnecting` state instead of `stopped`.
 */
async function reverifyMissingManualTakeover(opts: {
  workerBaseUrl: string;
  nativeSessionId: string;
}): Promise<RelayReverificationResult> {
  try {
    const result = await proxyWorkerRequest({
      workerBaseUrl: opts.workerBaseUrl,
      path: `/api/runtime-sessions/${encodeURIComponent(opts.nativeSessionId)}/manual-takeover`,
      method: 'GET',
      timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
    });

    if (!result.ok) {
      return {
        kind: 'unreachable',
        reason: `${result.error}: ${result.message}`,
      };
    }

    const manualTakeover = extractManualTakeover(result.data);
    if (manualTakeover && manualTakeover.status !== 'stopped') {
      return { kind: 'still-active', manualTakeover };
    }

    return { kind: 'confirmed-missing' };
  } catch (err) {
    // proxyWorkerRequest already converts network errors into a typed result,
    // so reaching this branch means an unexpected programmer error. Surface it
    // as `unreachable` rather than letting it crash the request.
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'unreachable', reason: message };
  }
}

function reconcileMissingManualTakeover(
  manualTakeover: ManualTakeoverState | null,
  reverification: RelayReverificationResult,
): ManualTakeoverState | null {
  if (!manualTakeover) {
    return null;
  }

  if (reverification.kind === 'still-active') {
    // Defensive — caller should have used the live state directly. Use the
    // typed error to avoid a bare throw and to keep the failure observable.
    throw new ControlPlaneError(
      'INVALID_RECONCILIATION_STATE',
      'reconcileMissingManualTakeover called with a still-active relay result',
      { workerSessionId: manualTakeover.workerSessionId },
    );
  }

  const nextStatus: ManualTakeoverStatus =
    manualTakeover.status === 'error'
      ? 'error'
      : reverification.kind === 'unreachable'
        ? 'reconnecting'
        : 'stopped';

  const nextError =
    manualTakeover.status === 'error'
      ? (manualTakeover.error ?? 'Worker no longer owns this manual takeover session')
      : reverification.kind === 'unreachable'
        ? `Worker unreachable during manual takeover re-verification: ${reverification.reason}`
        : null;

  return {
    ...manualTakeover,
    status: nextStatus,
    // Preserve the existing sessionUrl while we are still trying to reach the
    // worker — the link may still be valid once connectivity returns.
    sessionUrl: nextStatus === 'reconnecting' ? manualTakeover.sessionUrl : null,
    lastVerifiedAt: new Date().toISOString(),
    error: nextError,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
