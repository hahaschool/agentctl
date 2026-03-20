import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import { rcSessions } from '../../db/schema.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { WORKER_REQUEST_TIMEOUT_MS } from '../constants.js';
import { proxyWorkerRequest, replyWithProxyResult } from '../proxy-worker-request.js';
import { resolveWorkerUrlByMachineIdOrThrow } from '../resolve-worker-url.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TakeoverStatus = {
  active: boolean;
  terminalId?: string;
  machineId?: string;
  startedAt?: string;
  releasedAt?: string;
};

export type SessionTakeoverRoutesOptions = {
  db: Database;
  dbRegistry: DbAgentRegistry;
  workerPort?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SessionRow = {
  id: string;
  machineId: string;
  metadata: Record<string, unknown>;
};

async function requireSession(
  db: Database,
  sessionId: string,
  reply: {
    code: (statusCode: number) => { send: (payload: Record<string, string>) => unknown };
  },
): Promise<SessionRow | null> {
  const [row] = await db
    .select({
      id: rcSessions.id,
      machineId: rcSessions.machineId,
      metadata: rcSessions.metadata,
    })
    .from(rcSessions)
    .where(eq(rcSessions.id, sessionId));

  if (!row) {
    reply.code(404).send({
      error: 'SESSION_NOT_FOUND',
      message: `Session '${sessionId}' does not exist`,
    });
    return null;
  }

  if (!row.machineId) {
    reply.code(400).send({
      error: 'SESSION_NO_MACHINE',
      message: `Session '${sessionId}' has no associated machineId`,
    });
    return null;
  }

  return {
    id: row.id,
    machineId: row.machineId,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

async function resolveWorker(
  machineId: string,
  dbRegistry: DbAgentRegistry,
  workerPort: number,
): Promise<string> {
  return resolveWorkerUrlByMachineIdOrThrow(machineId, {
    dbRegistry,
    workerPort,
  });
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin for proxying Terminal Takeover operations to workers.
 *
 * Mounted at `/api/sessions`. Provides:
 *   - POST /:sessionId/takeover  — initiate interactive takeover
 *   - POST /:sessionId/release   — release an active takeover
 *   - GET  /:sessionId/takeover  — read current takeover state
 */
export const sessionTakeoverRoutes: FastifyPluginAsync<SessionTakeoverRoutesOptions> = async (
  app,
  opts,
) => {
  const { db, dbRegistry, workerPort = 9000 } = opts;

  // -------------------------------------------------------------------------
  // POST /:sessionId/takeover — initiate interactive takeover
  // -------------------------------------------------------------------------

  app.post<{ Params: { sessionId: string } }>(
    '/:sessionId/takeover',
    {
      schema: {
        tags: ['sessions'],
        summary: 'Initiate interactive terminal takeover for a session',
      },
    },
    async (request, reply) => {
      const session = await requireSession(db, request.params.sessionId, reply);
      if (!session) {
        return reply;
      }

      const workerBaseUrl = await resolveWorker(session.machineId, dbRegistry, workerPort);
      const result = await proxyWorkerRequest({
        workerBaseUrl,
        path: `/api/sessions/${encodeURIComponent(session.id)}/takeover`,
        method: 'POST',
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      // Extract terminalId from worker response for metadata storage
      const workerData = result.data as Record<string, unknown> | null;
      const terminalId =
        typeof workerData?.terminalId === 'string' ? workerData.terminalId : undefined;

      const takeoverStatus: TakeoverStatus = {
        active: true,
        terminalId,
        machineId: session.machineId,
        startedAt: new Date().toISOString(),
      };

      await db
        .update(rcSessions)
        .set({
          metadata: sql`COALESCE(${rcSessions.metadata}, '{}'::jsonb) || ${JSON.stringify({ takeoverStatus })}::jsonb`,
        })
        .where(eq(rcSessions.id, session.id));

      // Return worker response enriched with machineId
      return reply.status(result.status).send({
        ...(typeof workerData === 'object' && workerData !== null ? workerData : {}),
        machineId: session.machineId,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /:sessionId/release — release an active takeover
  // -------------------------------------------------------------------------

  app.post<{ Params: { sessionId: string } }>(
    '/:sessionId/release',
    {
      schema: {
        tags: ['sessions'],
        summary: 'Release an active terminal takeover',
      },
    },
    async (request, reply) => {
      const session = await requireSession(db, request.params.sessionId, reply);
      if (!session) {
        return reply;
      }

      const workerBaseUrl = await resolveWorker(session.machineId, dbRegistry, workerPort);
      const result = await proxyWorkerRequest({
        workerBaseUrl,
        path: `/api/sessions/${encodeURIComponent(session.id)}/release`,
        method: 'POST',
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      const takeoverStatus: TakeoverStatus = {
        active: false,
        releasedAt: new Date().toISOString(),
      };

      await db
        .update(rcSessions)
        .set({
          metadata: sql`COALESCE(${rcSessions.metadata}, '{}'::jsonb) || ${JSON.stringify({ takeoverStatus })}::jsonb`,
        })
        .where(eq(rcSessions.id, session.id));

      return replyWithProxyResult(reply, result);
    },
  );

  // -------------------------------------------------------------------------
  // GET /:sessionId/takeover — read takeover state
  // -------------------------------------------------------------------------

  app.get<{ Params: { sessionId: string } }>(
    '/:sessionId/takeover',
    {
      schema: {
        tags: ['sessions'],
        summary: 'Read current terminal takeover state for a session',
      },
    },
    async (request, reply) => {
      const session = await requireSession(db, request.params.sessionId, reply);
      if (!session) {
        return reply;
      }

      const workerBaseUrl = await resolveWorker(session.machineId, dbRegistry, workerPort);
      const result = await proxyWorkerRequest({
        workerBaseUrl,
        path: `/api/sessions/${encodeURIComponent(session.id)}/takeover`,
        method: 'GET',
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      return replyWithProxyResult(reply, result);
    },
  );
};
