import * as crypto from 'node:crypto';

import { ControlPlaneError, DEFAULT_WORKER_PORT } from '@agentctl/shared';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import { agents as agentsTable, apiAccounts, rcSessions, settings } from '../../db/schema.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { decryptCredential } from '../../utils/credential-crypto.js';
import { resolveAccountId } from '../../utils/resolve-account.js';
import { clampLimit, PAGINATION, SESSION_DISCOVER_TIMEOUT_MS, WORKER_REQUEST_TIMEOUT_MS } from '../constants.js';
import { proxyWorkerRequest, replyWithProxyResult } from '../proxy-worker-request.js';
/** Matches a valid UUID v4 string. Used to skip non-UUID agentIds like 'adhoc'. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How long a session can stay in 'starting' or 'active' without a heartbeat before being reaped. */
const STALE_SESSION_TIMEOUT_MS = Number(process.env.STALE_SESSION_TIMEOUT_MS) || 2 * 60 * 1000;
/** How often the stale session reaper runs. */
const REAPER_INTERVAL_MS = Number(process.env.REAPER_INTERVAL_MS) || 60 * 1000;

const RC_SESSION_STATUSES = ['starting', 'active', 'paused', 'ended', 'error'] as const;
type RcSessionStatus = (typeof RC_SESSION_STATUSES)[number];

/** Get the best address for a machine, preferring tailscaleIp with hostname fallback. */
function machineAddress(machine: { tailscaleIp?: string | null; hostname: string }): string {
  return machine.tailscaleIp ?? machine.hostname;
}

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
  encryptionKey?: string;
};

/**
 * Fastify plugin for managing Claude Code Remote Control sessions across the fleet.
 *
 * Mounted at `/api/sessions`. Provides CRUD endpoints that the mobile app uses
 * to discover, create, resume, and interact with sessions on worker machines.
 */
export const sessionRoutes: FastifyPluginAsync<SessionRoutesOptions> = async (app, opts) => {
  const { db, dbRegistry, workerPort = DEFAULT_WORKER_PORT, encryptionKey = '' } = opts;

  // ---------------------------------------------------------------------------
  // Stale session reaper — periodically mark stuck sessions as 'error'
  //
  // Sessions can get stuck in 'starting' when the worker fails to start the
  // CLI process and the status callback also fails. This reaper is a safety
  // net that cleans up sessions that have been in transient states too long.
  // ---------------------------------------------------------------------------

  async function reapStaleSessions(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - STALE_SESSION_TIMEOUT_MS);

      // Find sessions in 'starting' or 'active' that have no heartbeat or a
      // heartbeat older than the cutoff.  This catches:
      //   - Sessions stuck in 'starting' when the worker fails to respond
      //   - Sessions stuck in 'active' after a worker restart (heartbeats stop)
      const staleRows = await db
        .select({ id: rcSessions.id, status: rcSessions.status })
        .from(rcSessions)
        .where(
          and(
            inArray(rcSessions.status, ['starting', 'active']),
            or(isNull(rcSessions.lastHeartbeat), lt(rcSessions.lastHeartbeat, cutoff)),
            lt(rcSessions.startedAt, cutoff),
          ),
        );

      if (staleRows.length > 0) {
        const ids = staleRows.map((r) => r.id);
        await db
          .update(rcSessions)
          .set({
            status: 'error',
            endedAt: new Date(),
            metadata: sql`COALESCE(${rcSessions.metadata}, '{}'::jsonb) || '{"errorMessage":"Session timed out — no heartbeat from worker","errorHint":"Try resuming or forking this session to continue."}'::jsonb`,
          })
          .where(inArray(rcSessions.id, ids));

        app.log.warn(
          { count: ids.length, sessionIds: ids },
          'Reaped stale sessions with no heartbeat',
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.error({ err: message }, 'Stale session reaper failed');
    }
  }

  const reaperTimer = setInterval(reapStaleSessions, REAPER_INTERVAL_MS);

  // Clean up on server close
  app.addHook('onClose', async () => {
    clearInterval(reaperTimer);
  });

  // Run once immediately at startup to clean up any sessions stuck from before restart
  void reapStaleSessions();

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
          const workerBaseUrl = `http://${machineAddress(machine)}:${String(workerPort)}`;
          const discoverUrl = projectPath
            ? `${workerBaseUrl}/api/sessions/discover?projectPath=${encodeURIComponent(projectPath)}`
            : `${workerBaseUrl}/api/sessions/discover`;

          const response = await fetch(discoverUrl, {
            signal: AbortSignal.timeout(SESSION_DISCOVER_TIMEOUT_MS),
          });

          if (!response.ok) {
            throw new ControlPlaneError(
              'WORKER_HTTP_ERROR',
              `Worker returned HTTP ${String(response.status)}`,
              { machineId: machine.id, status: response.status },
            );
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

      const workerBaseUrl = `http://${machineAddress(machine)}:${String(workerPort)}`;
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
          signal: AbortSignal.timeout(WORKER_REQUEST_TIMEOUT_MS),
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
            sessionId,
            machineId,
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
      agentId?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/',
    { schema: { tags: ['sessions'], summary: 'List all sessions across the fleet' } },
    async (request, reply) => {
      const { machineId, agentId, status } = request.query;

      const rawLimit = request.query.limit;
      const rawOffset = request.query.offset;

      let limit = PAGINATION.sessions.defaultLimit;
      if (rawLimit !== undefined) {
        limit = clampLimit(Number(rawLimit), PAGINATION.sessions);
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

      if (agentId) {
        conditions.push(eq(rcSessions.agentId, agentId));
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

      const baseQuery =
        conditions.length > 0
          ? db
              .select()
              .from(rcSessions)
              .where(and(...conditions))
          : db.select().from(rcSessions);

      const countQuery =
        conditions.length > 0
          ? db
              .select({ count: sql<number>`count(*)::int` })
              .from(rcSessions)
              .where(and(...conditions))
          : db.select({ count: sql<number>`count(*)::int` }).from(rcSessions);

      const [sessionRows, countRows] = await Promise.all([
        baseQuery.orderBy(desc(rcSessions.startedAt)).limit(limit).offset(offset),
        countQuery,
      ]);

      // Resolve agent names in a single batch query (skip non-UUID values like 'adhoc')
      const agentIds = [
        ...new Set(sessionRows.map((s) => s.agentId).filter((id) => id && UUID_RE.test(id))),
      ] as string[];
      const agentNameMap = new Map<string, string>();
      if (agentIds.length > 0) {
        const agentRows = await db
          .select({ id: agentsTable.id, name: agentsTable.name })
          .from(agentsTable)
          .where(inArray(agentsTable.id, agentIds));
        for (const a of agentRows) {
          agentNameMap.set(a.id, a.name);
        }
      }

      const rows = sessionRows.map((s) => ({
        ...s,
        agentName: agentNameMap.get(s.agentId) ?? null,
      }));

      const total = countRows[0]?.count ?? 0;

      return {
        sessions: rows,
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      };
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

      const session = rows[0];

      // Resolve agent name (skip non-UUID values like 'adhoc')
      let agentName: string | null = null;
      if (session.agentId && UUID_RE.test(session.agentId)) {
        const [agentRow] = await db
          .select({ name: agentsTable.name })
          .from(agentsTable)
          .where(eq(agentsTable.id, session.agentId));
        agentName = agentRow?.name ?? null;
      }

      return { ...session, agentName };
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
      resumeSessionId?: string;
      accountId?: string;
    };
  }>(
    '/',
    { schema: { tags: ['sessions'], summary: 'Create a new session' } },
    async (request, reply) => {
      const { agentId, machineId, projectPath, model, prompt, resumeSessionId, accountId } =
        request.body;

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

      if (projectPath && !projectPath.startsWith('/')) {
        return reply.code(400).send({
          error: 'INVALID_PROJECT_PATH',
          message: 'projectPath must be an absolute path starting with /',
        });
      }

      // Verify the agent exists (skip for adhoc sessions)
      if (agentId !== 'adhoc') {
        const agent = await dbRegistry.getAgent(agentId);
        if (!agent) {
          return reply.code(404).send({
            error: 'AGENT_NOT_FOUND',
            message: `Agent '${agentId}' does not exist`,
          });
        }
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

      // Resolve the API account credential for this session
      let accountCredential: string | null = null;
      let accountProvider: string | null = null;

      // Look up the agent's own accountId if needed
      let agentAccountId: string | null = null;
      if (agentId !== 'adhoc') {
        const [agentRow] = await db
          .select({ accountId: agentsTable.accountId })
          .from(agentsTable)
          .where(eq(agentsTable.id, agentId));
        agentAccountId = agentRow?.accountId ?? null;
      }

      const resolvedAccountId = await resolveAccountId(
        {
          sessionAccountId: accountId ?? null,
          agentAccountId,
          projectPath,
        },
        db,
        app.log,
      );

      if (resolvedAccountId && encryptionKey) {
        const [account] = await db
          .select()
          .from(apiAccounts)
          .where(eq(apiAccounts.id, resolvedAccountId));

        if (account) {
          accountCredential = decryptCredential(
            account.credential,
            account.credentialIv,
            encryptionKey,
          );
          accountProvider = account.provider;
        }
      }

      const [inserted] = await db
        .insert(rcSessions)
        .values({
          id: sessionId,
          agentId,
          machineId,
          status: 'starting',
          projectPath,
          model: model ?? null,
          accountId: resolvedAccountId ?? null,
          metadata: { initialPrompt: prompt ?? null },
        })
        .returning();

      // Dispatch start command to the worker machine.
      const workerBaseUrl = `http://${machineAddress(machine)}:${String(workerPort)}`;

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
            resumeSessionId: resumeSessionId ?? null,
            accountCredential,
            accountProvider,
          }),
          signal: AbortSignal.timeout(WORKER_REQUEST_TIMEOUT_MS),
        });

        if (workerResponse.ok) {
          // Worker accepted the session — update status to 'active'
          await db
            .update(rcSessions)
            .set({ status: 'active', lastHeartbeat: new Date() })
            .where(eq(rcSessions.id, sessionId));
        } else {
          // Worker rejected the session — mark as error
          const errorText = await workerResponse.text().catch(() => 'Unknown error');
          app.log.warn(
            {
              sessionId,
              machineId,
              workerStatus: workerResponse.status,
              errorText,
            },
            'Worker returned non-OK for session start — marking session as error',
          );
          await db
            .update(rcSessions)
            .set({
              status: 'error',
              endedAt: new Date(),
              metadata: sql`COALESCE(${rcSessions.metadata}, '{}'::jsonb) || ${JSON.stringify({ errorMessage: errorText, errorHint: 'Check that the worker is running and the machine is online.' })}::jsonb`,
            })
            .where(eq(rcSessions.id, sessionId));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        app.log.warn(
          { sessionId, machineId, err: message },
          'Failed to dispatch session start to worker — marking session as error',
        );
        await db
          .update(rcSessions)
          .set({
            status: 'error',
            endedAt: new Date(),
            metadata: sql`COALESCE(${rcSessions.metadata}, '{}'::jsonb) || ${JSON.stringify({ errorMessage: message, errorHint: 'Check that the worker is running and the machine is online.' })}::jsonb`,
          })
          .where(eq(rcSessions.id, sessionId));
      }

      // Re-read the session to return the updated status
      const [updatedSession] = await db
        .select()
        .from(rcSessions)
        .where(eq(rcSessions.id, sessionId));

      const finalSession = updatedSession ?? inserted;
      const failed = finalSession.status === 'error';

      return reply.code(failed ? 502 : 201).send({
        ok: !failed,
        sessionId,
        session: finalSession,
        ...(failed && {
          error: 'DISPATCH_FAILED',
          message: 'Session created but worker dispatch failed',
        }),
      });
    },
  );

  // ---------------------------------------------------------------------------
  // POST /:sessionId/resume — resume a paused/ended session
  // ---------------------------------------------------------------------------

  app.post<{
    Params: { sessionId: string };
    Body: { prompt: string; model?: string };
  }>(
    '/:sessionId/resume',
    { schema: { tags: ['sessions'], summary: 'Resume a paused or ended session' } },
    async (request, reply) => {
      const { sessionId } = request.params;
      const { prompt, model: newModel } = request.body;

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

      // Check machine is online before making any DB changes
      const machine = await dbRegistry.getMachine(session.machineId);

      if (!machine || machine.status === 'offline') {
        return reply.code(503).send({
          error: 'MACHINE_OFFLINE',
          message: `Machine '${session.machineId}' is offline — cannot resume session`,
        });
      }

      // Machine is confirmed online — set to 'starting' (will be promoted to
      // 'active' once the worker confirms the CLI process is actually running)
      const [updated] = await db
        .update(rcSessions)
        .set({
          status: 'starting',
          endedAt: null,
          lastHeartbeat: new Date(),
          ...(newModel !== undefined ? { model: newModel || null } : {}),
        })
        .where(eq(rcSessions.id, sessionId))
        .returning();

      // Resolve account credentials for the resumed session
      let accountCredential: string | null = null;
      let accountProvider: string | null = null;

      if (session.accountId && encryptionKey) {
        const [account] = await db
          .select()
          .from(apiAccounts)
          .where(eq(apiAccounts.id, session.accountId));

        if (account) {
          accountCredential = decryptCredential(
            account.credential,
            account.credentialIv,
            encryptionKey,
          );
          accountProvider = account.provider;
        }
      }

      // Dispatch resume command to the worker
      {
        const workerBaseUrl = `http://${machineAddress(machine)}:${String(workerPort)}`;

        // The worker looks up sessions by its internal ID or claudeSessionId
        const workerSessionRef = session.claudeSessionId ?? sessionId;

        try {
          const workerResponse = await fetch(
            `${workerBaseUrl}/api/sessions/${encodeURIComponent(workerSessionRef)}/resume`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prompt,
                claudeSessionId: session.claudeSessionId,
                projectPath: session.projectPath,
                agentId: session.agentId,
                model: newModel ?? session.model ?? null,
                cpSessionId: sessionId,
                accountCredential,
                accountProvider,
              }),
              signal: AbortSignal.timeout(WORKER_REQUEST_TIMEOUT_MS),
            },
          );

          if (!workerResponse.ok) {
            let workerError: { error?: string; code?: string; hint?: string } = {};
            try {
              workerError = (await workerResponse.json()) as {
                error?: string;
                code?: string;
                hint?: string;
              };
            } catch {
              /* ignore parse errors */
            }

            const code = workerError.code ?? 'WORKER_ERROR';
            const msg =
              workerError.error ?? `Worker returned HTTP ${String(workerResponse.status)}`;
            const hint = workerError.hint;

            // If the worker lost the session (e.g. after restart) and also
            // couldn't resume via the Claude session ID, revert the DB status.
            if (workerResponse.status === 404 || code === 'SESSION_NOT_FOUND') {
              app.log.warn(
                { sessionId, machineId: session.machineId, workerError: msg },
                'Worker could not resume session (likely worker restart) — reverting DB status',
              );

              await db
                .update(rcSessions)
                .set({ status: 'ended', endedAt: new Date() })
                .where(eq(rcSessions.id, sessionId));

              return reply.code(410).send({
                error: 'SESSION_LOST',
                message:
                  'This session was lost due to a worker restart. ' +
                  'You can fork this session or create a new one to continue.',
              });
            }

            app.log.warn(
              { sessionId, machineId: session.machineId, workerError: msg },
              'Worker rejected resume — reverting DB status',
            );

            // Store the error details in session metadata so the UI can show them
            await db
              .update(rcSessions)
              .set({
                status: session.status,
                endedAt: session.endedAt,
                metadata: sql`${rcSessions.metadata} || ${JSON.stringify({
                  errorMessage: msg,
                  ...(hint ? { errorHint: hint } : {}),
                })}::jsonb`,
              })
              .where(eq(rcSessions.id, sessionId));

            return reply.code(502).send({
              error: code,
              message: msg,
              hint,
            });
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          app.log.warn(
            { sessionId, machineId: session.machineId, err: errMsg },
            'Failed to dispatch resume to worker — reverting DB status',
          );

          await db
            .update(rcSessions)
            .set({ status: session.status, endedAt: session.endedAt })
            .where(eq(rcSessions.id, sessionId));

          return reply.code(502).send({
            error: 'WORKER_UNREACHABLE',
            message: `Failed to resume session on worker: ${errMsg}`,
          });
        }
      }

      return { ok: true, session: updated };
    },
  );

  // ---------------------------------------------------------------------------
  // POST /:sessionId/fork — fork a session (resume from a new session)
  // ---------------------------------------------------------------------------

  app.post<{
    Params: { sessionId: string };
    Body: {
      prompt: string;
      machineId?: string;
      accountId?: string;
      model?: string;
      strategy?: 'jsonl-truncation' | 'context-injection' | 'resume';
      forkAtIndex?: number;
      selectedMessages?: Array<{
        type: string;
        content: string;
        toolName?: string;
        timestamp?: string;
      }>;
    };
  }>(
    '/:sessionId/fork',
    { schema: { tags: ['sessions'], summary: 'Fork a session into a new one' } },
    async (request, reply) => {
      const { sessionId } = request.params;
      const {
        prompt,
        machineId: overrideMachineId,
        accountId: overrideAccountId,
        model: overrideModel,
        strategy = 'resume',
        forkAtIndex,
        selectedMessages,
      } = request.body;

      if (!prompt || typeof prompt !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_PROMPT',
          message: 'A non-empty "prompt" string is required to fork the session',
        });
      }

      // Look up the parent session
      const [parent] = await db.select().from(rcSessions).where(eq(rcSessions.id, sessionId));

      if (!parent) {
        return reply.code(404).send({
          error: 'SESSION_NOT_FOUND',
          message: `Session '${sessionId}' does not exist`,
        });
      }

      if (!parent.claudeSessionId) {
        return reply.code(400).send({
          error: 'NO_CLAUDE_SESSION',
          message: 'Parent session has no Claude session ID — cannot fork',
        });
      }

      // Use same machine or allow override
      const targetMachineId = overrideMachineId ?? parent.machineId;
      const machine = await dbRegistry.getMachine(targetMachineId);

      if (!machine) {
        return reply.code(404).send({
          error: 'MACHINE_NOT_FOUND',
          message: `Machine '${targetMachineId}' is not registered`,
        });
      }

      if (machine.status === 'offline') {
        return reply.code(503).send({
          error: 'MACHINE_OFFLINE',
          message: `Machine '${targetMachineId}' (${machine.hostname}) is offline`,
        });
      }

      // Resolve credentials (same logic as session creation)
      let accountCredential: string | null = null;
      let accountProvider: string | null = null;
      const resolvedAccountId = overrideAccountId ?? parent.accountId;

      if (resolvedAccountId && encryptionKey) {
        const [account] = await db
          .select()
          .from(apiAccounts)
          .where(eq(apiAccounts.id, resolvedAccountId));

        if (account) {
          accountCredential = decryptCredential(
            account.credential,
            account.credentialIv,
            encryptionKey,
          );
          accountProvider = account.provider;
        }
      }

      // Create new session record
      const newSessionId = crypto.randomUUID();

      const [inserted] = await db
        .insert(rcSessions)
        .values({
          id: newSessionId,
          agentId: parent.agentId,
          machineId: targetMachineId,
          status: 'starting',
          projectPath: parent.projectPath,
          model: overrideModel ?? parent.model,
          accountId: resolvedAccountId ?? null,
          metadata: {
            initialPrompt: prompt,
            forkedFrom: sessionId,
            parentClaudeSessionId: parent.claudeSessionId,
            forkStrategy: strategy,
          },
        })
        .returning();

      // Dispatch to worker — build body based on fork strategy
      const workerBaseUrl = `http://${machineAddress(machine)}:${String(workerPort)}`;

      let workerBody: Record<string, unknown> = {
        sessionId: newSessionId,
        agentId: parent.agentId,
        projectPath: parent.projectPath,
        model: overrideModel ?? parent.model ?? null,
        prompt,
        resumeSessionId: parent.claudeSessionId,
        accountCredential,
        accountProvider,
      };

      if (strategy === 'jsonl-truncation') {
        // Pass forkAtIndex so the worker can truncate the JSONL before resuming
        workerBody.forkAtIndex = forkAtIndex;
      } else if (strategy === 'context-injection' && selectedMessages?.length) {
        // Build a system prompt from selected messages and start a fresh session
        const contextLines = ['## Previous Conversation Context\n'];
        for (const msg of selectedMessages) {
          const role =
            msg.type === 'human' ? 'User' : msg.type === 'assistant' ? 'Assistant' : 'Tool';
          contextLines.push(`### ${role}${msg.timestamp ? ` (${msg.timestamp})` : ''}`);
          if (msg.toolName) contextLines.push(`Tool: ${msg.toolName}`);
          contextLines.push(msg.content, '');
        }
        workerBody = {
          sessionId: newSessionId,
          agentId: parent.agentId,
          projectPath: parent.projectPath,
          model: overrideModel ?? parent.model ?? null,
          prompt,
          systemPrompt: contextLines.join('\n'),
          // No resumeSessionId — fresh session with context injected
          accountCredential,
          accountProvider,
        };
      }
      // For 'resume' (default), workerBody already includes resumeSessionId

      try {
        const workerResponse = await fetch(`${workerBaseUrl}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(workerBody),
          signal: AbortSignal.timeout(WORKER_REQUEST_TIMEOUT_MS),
        });

        if (workerResponse.ok) {
          await db
            .update(rcSessions)
            .set({ status: 'active', lastHeartbeat: new Date() })
            .where(eq(rcSessions.id, newSessionId));
        } else {
          const errorText = await workerResponse.text().catch(() => 'Unknown error');
          app.log.warn({ newSessionId, errorText }, 'Worker rejected fork session');
          await db
            .update(rcSessions)
            .set({
              status: 'error',
              endedAt: new Date(),
              metadata: {
                ...(inserted.metadata as Record<string, unknown>),
                errorMessage: errorText,
              },
            })
            .where(eq(rcSessions.id, newSessionId));
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        app.log.warn({ newSessionId, err: errMsg }, 'Failed to dispatch fork to worker');
        await db
          .update(rcSessions)
          .set({
            status: 'error',
            endedAt: new Date(),
            metadata: { ...(inserted.metadata as Record<string, unknown>), errorMessage: errMsg },
          })
          .where(eq(rcSessions.id, newSessionId));
      }

      const [finalSession] = await db
        .select()
        .from(rcSessions)
        .where(eq(rcSessions.id, newSessionId));

      return reply.code(201).send({
        ok: true,
        sessionId: newSessionId,
        session: finalSession ?? inserted,
        forkedFrom: sessionId,
      });
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

      // Resolve account credentials for the message dispatch
      let accountCredential: string | null = null;
      let accountProvider: string | null = null;

      if (session.accountId && encryptionKey) {
        const [account] = await db
          .select()
          .from(apiAccounts)
          .where(eq(apiAccounts.id, session.accountId));

        if (account) {
          accountCredential = decryptCredential(
            account.credential,
            account.credentialIv,
            encryptionKey,
          );
          accountProvider = account.provider;
        }
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

      const workerBaseUrl = `http://${machineAddress(machine)}:${String(workerPort)}`;

      // The worker looks up sessions by its internal ID or claudeSessionId,
      // NOT by the control-plane's RC session UUID. Send claudeSessionId.
      const workerSessionRef = session.claudeSessionId ?? sessionId;

      try {
        const workerResponse = await fetch(
          `${workerBaseUrl}/api/sessions/${encodeURIComponent(workerSessionRef)}/message`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, accountCredential, accountProvider }),
            signal: AbortSignal.timeout(WORKER_REQUEST_TIMEOUT_MS),
          },
        );

        if (!workerResponse.ok) {
          let workerError: { error?: string; code?: string; hint?: string } = {};
          try {
            workerError = (await workerResponse.json()) as {
              error?: string;
              code?: string;
              hint?: string;
            };
          } catch {
            /* ignore parse errors */
          }

          const code = workerError.code ?? 'WORKER_ERROR';
          const msg = workerError.error ?? `Worker returned HTTP ${String(workerResponse.status)}`;

          // If the worker doesn't have this session in memory (e.g. after worker
          // restart), mark it as ended in the DB so the UI reflects reality.
          if (workerResponse.status === 404 || code === 'SESSION_NOT_FOUND') {
            app.log.warn(
              { sessionId, machineId: session.machineId, workerError: msg },
              'Worker session not found (likely worker restart) — marking session as ended',
            );

            await db
              .update(rcSessions)
              .set({
                status: 'ended',
                endedAt: new Date(),
              })
              .where(eq(rcSessions.id, sessionId));

            return reply.code(410).send({
              error: 'SESSION_LOST',
              message:
                'This session was lost due to a worker restart. ' +
                'You can fork this session or create a new one to continue.',
            });
          }

          // Forward worker error code so the frontend can show specific messages
          return reply.code(workerResponse.status === 409 ? 409 : 502).send({
            error: code,
            message: msg,
            ...(workerError.hint && { hint: workerError.hint }),
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
        const workerBaseUrl = `http://${machineAddress(machine)}:${String(workerPort)}`;
        const workerSessionRef = session.claudeSessionId ?? sessionId;

        const result = await proxyWorkerRequest({
          workerBaseUrl,
          path: `/api/sessions/${encodeURIComponent(workerSessionRef)}`,
          method: 'DELETE',
          timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
        });

        if (!result.ok) {
          app.log.warn(
            { sessionId, machineId: session.machineId, err: result.message },
            'Failed to notify worker of session end — session marked ended in control plane',
          );
        }
      }

      return { ok: true, sessionId, session: updated };
    },
  );

  // ---------------------------------------------------------------------------
  // GET /:sessionId/stream — SSE proxy to worker's stream endpoint
  // ---------------------------------------------------------------------------

  app.get<{ Params: { sessionId: string } }>(
    '/:sessionId/stream',
    {
      schema: { tags: ['sessions'], summary: 'SSE stream of session output (proxied from worker)' },
    },
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

      const machine = await dbRegistry.getMachine(session.machineId);

      if (!machine) {
        return reply.code(404).send({
          error: 'MACHINE_NOT_FOUND',
          message: `Machine '${session.machineId}' is not registered`,
        });
      }

      if (machine.status === 'offline') {
        return reply.code(503).send({
          error: 'MACHINE_OFFLINE',
          message: `Machine '${session.machineId}' (${machine.hostname}) is offline`,
        });
      }

      const workerBaseUrl = `http://${machineAddress(machine)}:${String(workerPort)}`;
      const workerSessionRef = session.claudeSessionId ?? sessionId;

      try {
        // SSE streams stay open indefinitely — do NOT use a timeout here.
        // The 10s WORKER_REQUEST_TIMEOUT_MS is only for RPC-style requests.
        const workerResponse = await fetch(
          `${workerBaseUrl}/api/sessions/${encodeURIComponent(workerSessionRef)}/stream`,
        );

        if (!workerResponse.ok || !workerResponse.body) {
          const errorText = await workerResponse.text().catch(() => 'Unknown error');

          // If the worker lost the session (e.g. after restart), mark it as
          // ended in the DB so the frontend can show the correct state.
          if (workerResponse.status === 404) {
            app.log.warn(
              { sessionId, machineId: session.machineId },
              'Worker session not found for stream (likely worker restart) — marking session as ended',
            );

            await db
              .update(rcSessions)
              .set({ status: 'ended', endedAt: new Date() })
              .where(eq(rcSessions.id, sessionId));

            return reply.code(410).send({
              error: 'SESSION_LOST',
              message:
                'This session was lost due to a worker restart. ' +
                'You can fork this session or create a new one to continue.',
            });
          }

          return reply.code(502).send({
            error: 'WORKER_ERROR',
            message: `Worker stream returned HTTP ${String(workerResponse.status)}: ${errorText}`,
            sessionId,
          });
        }

        // Hijack the response for raw SSE piping
        reply.hijack();
        const raw = reply.raw;

        raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        // Pipe worker's SSE stream to the client
        const reader = workerResponse.body.getReader();
        const decoder = new TextDecoder();

        const pump = async (): Promise<void> => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done || raw.destroyed) break;
              raw.write(decoder.decode(value, { stream: true }));
            }
          } catch (streamErr) {
            const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
            app.log.warn(
              { sessionId, machineId: session.machineId, err: msg },
              'SSE stream from worker disconnected',
            );
          } finally {
            if (!raw.destroyed) {
              raw.end();
            }
          }
        };

        void pump();

        // Cleanup on client disconnect
        request.raw.on('close', () => {
          reader.cancel().catch(() => {});
        });
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'WORKER_UNREACHABLE',
          `Failed to connect to worker stream at ${workerBaseUrl}: ${errMessage}`,
          { sessionId, machineId: session.machineId },
        );
      }
    },
  );

  // ---------------------------------------------------------------------------
  // PATCH /:sessionId/status — worker reports session status changes
  //
  // This is called by the agent-worker when a CLI session ends, errors, or
  // when the Claude session ID / PID becomes available. This solves the bug
  // where sessions get stuck at "starting" because the worker never reported
  // back after the async CLI process completed or failed.
  // ---------------------------------------------------------------------------

  app.patch<{
    Params: { sessionId: string };
    Body: {
      status?: string;
      claudeSessionId?: string | null;
      pid?: number | null;
      costUsd?: number;
      errorMessage?: string;
      messageCount?: number;
    };
  }>(
    '/:sessionId/status',
    { schema: { tags: ['sessions'], summary: 'Worker reports session status update' } },
    async (request, reply) => {
      const { sessionId } = request.params;
      const { status, claudeSessionId, pid, costUsd, errorMessage, messageCount } = request.body;

      const rows = await db.select().from(rcSessions).where(eq(rcSessions.id, sessionId));

      if (rows.length === 0) {
        return reply.code(404).send({
          error: 'SESSION_NOT_FOUND',
          message: `Session '${sessionId}' does not exist`,
        });
      }

      // Build the update set dynamically based on provided fields
      const updateSet: Record<string, unknown> = {
        lastHeartbeat: new Date(),
      };

      if (status) {
        if (!RC_SESSION_STATUSES.includes(status as RcSessionStatus)) {
          return reply.code(400).send({
            error: 'INVALID_STATUS',
            message: `Invalid status. Must be one of: ${RC_SESSION_STATUSES.join(', ')}`,
          });
        }
        updateSet.status = status;

        if (status === 'ended' || status === 'error') {
          updateSet.endedAt = new Date();
        }
      }

      if (claudeSessionId !== undefined) {
        updateSet.claudeSessionId = claudeSessionId;
      }

      if (pid !== undefined) {
        updateSet.pid = pid;
      }

      // Store cost, error, and messageCount in metadata (merge with existing)
      if (costUsd !== undefined || errorMessage !== undefined || messageCount !== undefined) {
        const existingMeta = (rows[0].metadata ?? {}) as Record<string, unknown>;
        const newMeta = { ...existingMeta };

        if (costUsd !== undefined) {
          newMeta.costUsd = costUsd;
        }
        if (errorMessage !== undefined) {
          newMeta.errorMessage = errorMessage;
        }
        if (messageCount !== undefined) {
          newMeta.messageCount = messageCount;
        }

        updateSet.metadata = newMeta;
      }

      const [updated] = await db
        .update(rcSessions)
        .set(updateSet)
        .where(eq(rcSessions.id, sessionId))
        .returning();

      app.log.info({ sessionId, status, claudeSessionId, pid }, 'Session status updated by worker');

      // ── Account failover ──────────────────────────────────────────
      // When a session fails with a quota/auth error, check the failover
      // policy and try the next active account if applicable.
      if (
        status === 'error' &&
        errorMessage &&
        updated.accountId &&
        encryptionKey &&
        isQuotaOrAuthError(errorMessage)
      ) {
        try {
          const [policySetting] = await db
            .select()
            .from(settings)
            .where(eq(settings.key, 'failover_policy'));
          const policy = (policySetting?.value as { value?: string })?.value ?? 'none';

          if (policy === 'priority' || policy === 'round_robin') {
            // Get all active accounts sorted by priority
            const activeAccounts = await db
              .select()
              .from(apiAccounts)
              .where(eq(apiAccounts.isActive, true))
              .orderBy(apiAccounts.priority);

            // Find next account after the current one
            const currentIdx = activeAccounts.findIndex((a) => a.id === updated.accountId);
            const nextAccount =
              currentIdx >= 0 && currentIdx + 1 < activeAccounts.length
                ? activeAccounts[currentIdx + 1]
                : null;

            if (nextAccount) {
              app.log.info(
                {
                  sessionId,
                  failedAccountId: updated.accountId,
                  nextAccountId: nextAccount.id,
                  nextAccountName: nextAccount.name,
                  policy,
                },
                'Failover: switching to next account after quota/auth error',
              );

              // Store failover metadata on the failed session
              const failMeta = (updated.metadata ?? {}) as Record<string, unknown>;
              failMeta.failoverTo = nextAccount.id;
              failMeta.failoverReason = errorMessage;
              await db
                .update(rcSessions)
                .set({ metadata: failMeta })
                .where(eq(rcSessions.id, sessionId));

              // Decrypt the next account's credential
              const nextCredential = decryptCredential(
                nextAccount.credential,
                nextAccount.credentialIv,
                encryptionKey,
              );

              // Re-dispatch: resume the same Claude session with the new account
              const machine = await dbRegistry.getMachine(updated.machineId);
              if (machine) {
                const workerBaseUrl = `http://${machineAddress(machine)}:${String(workerPort)}`;
                const resumePayload = {
                  prompt: 'Continue from where you left off.',
                  claudeSessionId: updated.claudeSessionId,
                  cpSessionId: sessionId,
                  agentId: updated.agentId,
                  model: updated.model,
                  projectPath: updated.projectPath,
                  accountId: nextAccount.id,
                  accountCredential: nextCredential,
                  accountProvider: nextAccount.provider,
                };

                const resumeResp = await fetch(
                  `${workerBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/resume`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(resumePayload),
                    signal: AbortSignal.timeout(WORKER_REQUEST_TIMEOUT_MS),
                  },
                );

                if (resumeResp.ok) {
                  // Update the session to point to the new account
                  await db
                    .update(rcSessions)
                    .set({
                      status: 'starting',
                      endedAt: null,
                      accountId: nextAccount.id,
                      lastHeartbeat: new Date(),
                    })
                    .where(eq(rcSessions.id, sessionId));

                  app.log.info(
                    { sessionId, newAccountId: nextAccount.id },
                    'Failover: session resumed with new account',
                  );
                } else {
                  app.log.warn(
                    { sessionId, status: resumeResp.status },
                    'Failover: worker resume request failed',
                  );
                }
              }
            } else {
              app.log.warn(
                { sessionId, accountId: updated.accountId },
                'Failover: no more active accounts available to try',
              );
            }
          }
        } catch (failoverErr) {
          app.log.error(
            {
              sessionId,
              error: failoverErr instanceof Error ? failoverErr.message : String(failoverErr),
            },
            'Failover: unexpected error during account switch',
          );
        }
      }

      return { ok: true, session: updated };
    },
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Patterns in error messages that indicate quota exhaustion or auth failure. */
const QUOTA_AUTH_PATTERNS = [
  'out of extra usage',
  'exceeded your',
  'rate limit',
  'quota exceeded',
  'usage limit',
  'too many requests',
  '429',
  'unauthorized',
  'authentication',
  'invalid api key',
  'invalid_api_key',
  'permission denied',
  '401',
  '403',
];

function isQuotaOrAuthError(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  return QUOTA_AUTH_PATTERNS.some((pattern) => lower.includes(pattern));
}
