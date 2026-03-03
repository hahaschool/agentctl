import * as crypto from 'node:crypto';

import { ControlPlaneError } from '@agentctl/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import { rcSessions } from '../../db/schema.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_WORKER_PORT = 9000;
const DISCOVER_TIMEOUT_MS = 5_000;
const CONTENT_TIMEOUT_MS = 10_000;

const RC_SESSION_STATUSES = ['starting', 'active', 'paused', 'ended', 'error'] as const;
type RcSessionStatus = (typeof RC_SESSION_STATUSES)[number];

type DiscoveredSessionFromWorker = {
  sessionId: string;
  projectPath: string;
  summary: string;
  messageCount: number;
  lastActivity: string;
  branch: string | null;
};

type WorkerDiscoverResponse = {
  sessions: DiscoveredSessionFromWorker[];
  count: number;
  machineId: string;
};

type AggregatedDiscoveredSession = DiscoveredSessionFromWorker & {
  machineId: string;
  hostname: string;
};

export type SessionRoutesOptions = {
  db: Database;
  dbRegistry: DbAgentRegistry;
  workerPort?: number;
};

/**
 * Fastify plugin for managing Claude Code Remote Control sessions across the fleet.
 *
 * Mounted at `/api/sessions`. Provides CRUD endpoints that the mobile app uses
 * to discover, create, resume, and interact with sessions on worker machines.
 */
export const sessionRoutes: FastifyPluginAsync<SessionRoutesOptions> = async (app, opts) => {
  const { db, dbRegistry, workerPort = DEFAULT_WORKER_PORT } = opts;

  // ---------------------------------------------------------------------------
  // GET /discover — fan-out session discovery across all online workers
  // ---------------------------------------------------------------------------

  app.get<{
    Querystring: { projectPath?: string };
  }>(
    '/discover',
    { schema: { tags: ['sessions'], summary: 'Discover Claude Code sessions across all workers' } },
    async (request) => {
      const { projectPath } = request.query;

      const allMachines = await dbRegistry.listMachines();
      const onlineMachines = allMachines.filter((m) => m.status !== 'offline');

      const results: AggregatedDiscoveredSession[] = [];
      let machinesFailed = 0;

      const settledResults = await Promise.allSettled(
        onlineMachines.map(async (machine) => {
          const workerBaseUrl = `http://${machine.tailscaleIp}:${String(workerPort)}`;
          const discoverUrl = projectPath
            ? `${workerBaseUrl}/api/sessions/discover?projectPath=${encodeURIComponent(projectPath)}`
            : `${workerBaseUrl}/api/sessions/discover`;

          const response = await fetch(discoverUrl, {
            signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS),
          });

          if (!response.ok) {
            throw new Error(`Worker returned HTTP ${String(response.status)}`);
          }

          const body = (await response.json()) as WorkerDiscoverResponse;

          return {
            machine,
            sessions: body.sessions,
          };
        }),
      );

      for (const result of settledResults) {
        if (result.status === 'fulfilled') {
          const { machine, sessions } = result.value;
          for (const session of sessions) {
            results.push({
              ...session,
              machineId: machine.id,
              hostname: machine.hostname,
            });
          }
        } else {
          machinesFailed += 1;
          app.log.warn(
            {
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            },
            'Failed to discover sessions from worker',
          );
        }
      }

      // Sort by lastActivity descending (most recent first)
      results.sort((a, b) => {
        const dateA = new Date(a.lastActivity).getTime();
        const dateB = new Date(b.lastActivity).getTime();
        return dateB - dateA;
      });

      return {
        sessions: results,
        count: results.length,
        machinesQueried: onlineMachines.length,
        machinesFailed,
      };
    },
  );

  // ---------------------------------------------------------------------------
  // GET /content/:sessionId — proxy session content from a worker
  // ---------------------------------------------------------------------------

  app.get<{
    Params: { sessionId: string };
    Querystring: { machineId?: string; projectPath?: string; limit?: string };
  }>(
    '/content/:sessionId',
    { schema: { tags: ['sessions'], summary: 'Read conversation history for a session' } },
    async (request, reply) => {
      const { sessionId } = request.params;
      const { machineId, projectPath, limit } = request.query;

      if (!machineId || typeof machineId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_MACHINE_ID',
          message: 'A non-empty "machineId" query parameter is required',
        });
      }

      const machine = await dbRegistry.getMachine(machineId);

      if (!machine) {
        return reply.code(404).send({
          error: 'MACHINE_NOT_FOUND',
          message: `Machine '${machineId}' is not registered`,
        });
      }

      if (machine.status === 'offline') {
        return reply.code(503).send({
          error: 'MACHINE_OFFLINE',
          message: `Machine '${machineId}' (${machine.hostname}) is offline`,
        });
      }

      const workerBaseUrl = `http://${machine.tailscaleIp}:${String(workerPort)}`;
      const queryParams = new URLSearchParams();

      if (projectPath) {
        queryParams.set('projectPath', projectPath);
      }
      if (limit) {
        queryParams.set('limit', limit);
      }

      const queryString = queryParams.toString();
      const contentUrl = `${workerBaseUrl}/api/sessions/content/${encodeURIComponent(sessionId)}${queryString ? `?${queryString}` : ''}`;

      try {
        const workerResponse = await fetch(contentUrl, {
          signal: AbortSignal.timeout(CONTENT_TIMEOUT_MS),
        });

        if (!workerResponse.ok) {
          if (workerResponse.status === 404) {
            const errorBody = await workerResponse.json().catch(() => null);
            return reply.code(404).send({
              error: 'SESSION_CONTENT_NOT_FOUND',
              message:
                errorBody && typeof errorBody === 'object' && 'error' in errorBody
                  ? String((errorBody as Record<string, unknown>).error)
                  : `Session content not found for '${sessionId}'`,
            });
          }

          const errorText = await workerResponse.text().catch(() => 'Unknown error');
          return reply.code(502).send({
            error: 'WORKER_ERROR',
            message: `Worker returned HTTP ${String(workerResponse.status)}: ${errorText}`,
          });
        }

        const body: unknown = await workerResponse.json();
        return body;
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'WORKER_UNREACHABLE',
          `Failed to fetch session content from worker at ${workerBaseUrl}: ${errMessage}`,
          { sessionId, machineId },
        );
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET / — list sessions across the fleet
  // ---------------------------------------------------------------------------

  app.get<{
    Querystring: {
      machineId?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/',
    { schema: { tags: ['sessions'], summary: 'List all sessions across the fleet' } },
    async (request, reply) => {
      const { machineId, status } = request.query;

      const rawLimit = request.query.limit;
      const rawOffset = request.query.offset;

      let limit = DEFAULT_LIMIT;
      if (rawLimit !== undefined) {
        const parsed = Number(rawLimit);
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT) {
          limit = parsed;
        }
      }

      let offset = 0;
      if (rawOffset !== undefined) {
        const parsed = Number(rawOffset);
        if (Number.isInteger(parsed) && parsed >= 0) {
          offset = parsed;
        }
      }

      const conditions = [];

      if (machineId) {
        conditions.push(eq(rcSessions.machineId, machineId));
      }

      if (status) {
        if (!RC_SESSION_STATUSES.includes(status as RcSessionStatus)) {
          return reply.code(400).send({
            error: 'INVALID_STATUS',
            message: `Invalid status filter. Must be one of: ${RC_SESSION_STATUSES.join(', ')}`,
          });
        }
        conditions.push(eq(rcSessions.status, status));
      }

      const query =
        conditions.length > 0
          ? db
              .select()
              .from(rcSessions)
              .where(and(...conditions))
          : db.select().from(rcSessions);

      const rows = await query.orderBy(desc(rcSessions.startedAt)).limit(limit).offset(offset);

      return rows;
    },
  );

  // ---------------------------------------------------------------------------
  // GET /:sessionId — get a single session by ID
  // ---------------------------------------------------------------------------

  app.get<{ Params: { sessionId: string } }>(
    '/:sessionId',
    { schema: { tags: ['sessions'], summary: 'Get session by ID' } },
    async (request, reply) => {
      const { sessionId } = request.params;

      const rows = await db.select().from(rcSessions).where(eq(rcSessions.id, sessionId));

      if (rows.length === 0) {
        return reply.code(404).send({
          error: 'SESSION_NOT_FOUND',
          message: `Session '${sessionId}' does not exist`,
        });
      }

      return rows[0];
    },
  );

  // ---------------------------------------------------------------------------
  // POST / — create a new session
  // ---------------------------------------------------------------------------

  app.post<{
    Body: {
      agentId: string;
      machineId: string;
      projectPath: string;
      model?: string;
      prompt?: string;
    };
  }>(
    '/',
    { schema: { tags: ['sessions'], summary: 'Create a new session' } },
    async (request, reply) => {
      const { agentId, machineId, projectPath, model, prompt } = request.body;

      if (!agentId || typeof agentId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_AGENT_ID',
          message: 'A non-empty "agentId" string is required',
        });
      }

      if (!machineId || typeof machineId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_MACHINE_ID',
          message: 'A non-empty "machineId" string is required',
        });
      }

      if (!projectPath || typeof projectPath !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_PROJECT_PATH',
          message: 'A non-empty "projectPath" string is required',
        });
      }

      // Verify the agent exists
      const agent = await dbRegistry.getAgent(agentId);
      if (!agent) {
        return reply.code(404).send({
          error: 'AGENT_NOT_FOUND',
          message: `Agent '${agentId}' does not exist`,
        });
      }

      // Verify the machine exists
      const machine = await dbRegistry.getMachine(machineId);
      if (!machine) {
        return reply.code(404).send({
          error: 'MACHINE_NOT_FOUND',
          message: `Machine '${machineId}' is not registered`,
        });
      }

      if (machine.status === 'offline') {
        return reply.code(503).send({
          error: 'MACHINE_OFFLINE',
          message: `Machine '${machineId}' (${machine.hostname}) is offline`,
        });
      }

      const sessionId = crypto.randomUUID();

      const [inserted] = await db
        .insert(rcSessions)
        .values({
          id: sessionId,
          agentId,
          machineId,
          status: 'starting',
          projectPath,
          metadata: { model: model ?? null, initialPrompt: prompt ?? null },
        })
        .returning();

      // Dispatch start command to the worker machine.
      const workerBaseUrl = `http://${machine.tailscaleIp}:${String(workerPort)}`;

      try {
        const workerResponse = await fetch(`${workerBaseUrl}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            agentId,
            projectPath,
            model: model ?? null,
            prompt: prompt ?? null,
          }),
        });

        if (!workerResponse.ok) {
          app.log.warn(
            {
              sessionId,
              machineId,
              workerStatus: workerResponse.status,
            },
            'Worker returned non-OK for session start — session created but dispatch failed',
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        app.log.warn(
          { sessionId, machineId, err: message },
          'Failed to dispatch session start to worker — session created but worker unreachable',
        );
      }

      return reply.code(201).send({
        ok: true,
        sessionId,
        session: inserted,
      });
    },
  );

  // ---------------------------------------------------------------------------
  // POST /:sessionId/resume — resume a paused/ended session
  // ---------------------------------------------------------------------------

  app.post<{
    Params: { sessionId: string };
    Body: { prompt: string };
  }>(
    '/:sessionId/resume',
    { schema: { tags: ['sessions'], summary: 'Resume a paused or ended session' } },
    async (request, reply) => {
      const { sessionId } = request.params;
      const { prompt } = request.body;

      if (!prompt || typeof prompt !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_PROMPT',
          message: 'A non-empty "prompt" string is required',
        });
      }

      const rows = await db.select().from(rcSessions).where(eq(rcSessions.id, sessionId));

      if (rows.length === 0) {
        return reply.code(404).send({
          error: 'SESSION_NOT_FOUND',
          message: `Session '${sessionId}' does not exist`,
        });
      }

      const session = rows[0];

      if (session.status === 'active') {
        return reply.code(409).send({
          error: 'SESSION_ALREADY_ACTIVE',
          message: `Session '${sessionId}' is already active. Use POST /message to send messages.`,
        });
      }

      // Update status to active
      const [updated] = await db
        .update(rcSessions)
        .set({ status: 'active', endedAt: null })
        .where(eq(rcSessions.id, sessionId))
        .returning();

      // Dispatch resume command to the worker
      const machine = await dbRegistry.getMachine(session.machineId);

      if (machine && machine.status !== 'offline') {
        const workerBaseUrl = `http://${machine.tailscaleIp}:${String(workerPort)}`;

        try {
          await fetch(`${workerBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/resume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          app.log.warn(
            { sessionId, machineId: session.machineId, err: message },
            'Failed to dispatch resume to worker',
          );
        }
      }

      return { ok: true, session: updated };
    },
  );

  // ---------------------------------------------------------------------------
  // POST /:sessionId/message — send message to an active session
  // ---------------------------------------------------------------------------

  app.post<{
    Params: { sessionId: string };
    Body: { message: string };
  }>(
    '/:sessionId/message',
    { schema: { tags: ['sessions'], summary: 'Send a message to an active session' } },
    async (request, reply) => {
      const { sessionId } = request.params;
      const { message } = request.body;

      if (!message || typeof message !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_MESSAGE',
          message: 'A non-empty "message" string is required',
        });
      }

      const rows = await db.select().from(rcSessions).where(eq(rcSessions.id, sessionId));

      if (rows.length === 0) {
        return reply.code(404).send({
          error: 'SESSION_NOT_FOUND',
          message: `Session '${sessionId}' does not exist`,
        });
      }

      const session = rows[0];

      if (session.status !== 'active' && session.status !== 'starting') {
        return reply.code(409).send({
          error: 'SESSION_NOT_ACTIVE',
          message: `Session '${sessionId}' is not active (status: ${session.status}). Resume first.`,
        });
      }

      // Forward message to the worker
      const machine = await dbRegistry.getMachine(session.machineId);

      if (!machine) {
        return reply.code(404).send({
          error: 'MACHINE_NOT_FOUND',
          message: `Machine '${session.machineId}' for session '${sessionId}' is not registered`,
        });
      }

      if (machine.status === 'offline') {
        return reply.code(503).send({
          error: 'MACHINE_OFFLINE',
          message: `Machine '${machine.id}' (${machine.hostname}) is offline`,
        });
      }

      const workerBaseUrl = `http://${machine.tailscaleIp}:${String(workerPort)}`;

      try {
        const workerResponse = await fetch(
          `${workerBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/message`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
          },
        );

        if (!workerResponse.ok) {
          const errorText = await workerResponse.text().catch(() => 'Unknown error');
          return reply.code(502).send({
            error: 'WORKER_ERROR',
            message: `Worker returned HTTP ${String(workerResponse.status)}: ${errorText}`,
          });
        }

        let workerBody: unknown;
        try {
          workerBody = await workerResponse.json();
        } catch {
          workerBody = { ok: true };
        }

        return { ok: true, sessionId, workerResponse: workerBody };
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'WORKER_UNREACHABLE',
          `Failed to forward message to worker at ${workerBaseUrl}: ${errMessage}`,
          { sessionId, machineId: session.machineId },
        );
      }
    },
  );

  // ---------------------------------------------------------------------------
  // DELETE /:sessionId — end/close a session
  // ---------------------------------------------------------------------------

  app.delete<{ Params: { sessionId: string } }>(
    '/:sessionId',
    { schema: { tags: ['sessions'], summary: 'End/close a session' } },
    async (request, reply) => {
      const { sessionId } = request.params;

      const rows = await db.select().from(rcSessions).where(eq(rcSessions.id, sessionId));

      if (rows.length === 0) {
        return reply.code(404).send({
          error: 'SESSION_NOT_FOUND',
          message: `Session '${sessionId}' does not exist`,
        });
      }

      const session = rows[0];

      if (session.status === 'ended') {
        return { ok: true, sessionId, message: 'Session was already ended' };
      }

      const [updated] = await db
        .update(rcSessions)
        .set({ status: 'ended', endedAt: new Date() })
        .where(eq(rcSessions.id, sessionId))
        .returning();

      // Best-effort: notify worker to clean up the session
      const machine = await dbRegistry.getMachine(session.machineId);

      if (machine && machine.status !== 'offline') {
        const workerBaseUrl = `http://${machine.tailscaleIp}:${String(workerPort)}`;

        try {
          await fetch(`${workerBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE',
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          app.log.warn(
            { sessionId, machineId: session.machineId, err: message },
            'Failed to notify worker of session end — session marked ended in control plane',
          );
        }
      }

      return { ok: true, sessionId, session: updated };
    },
  );
};
