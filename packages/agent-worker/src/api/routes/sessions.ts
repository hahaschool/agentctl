// ---------------------------------------------------------------------------
// Worker-side session routes — HTTP endpoints that the control plane dispatches
// to for managing Claude Code CLI sessions on this worker machine.
//
// Uses CliSessionManager to spawn/stop `claude -p` subprocesses.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, normalize, resolve as resolvePath } from 'node:path';

import type { AgentEvent, ContentMessage } from '@agentctl/shared';
import { AgentError, WorkerError } from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';
import type {
  CliSession,
  CliSessionEvent,
  CliSessionManager,
} from '../../runtime/cli-session-manager.js';
import { SSE_HEARTBEAT_INTERVAL_MS } from '../constants.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Delay before cleaning up session buffers after session ends, allowing late SSE consumers. */
const SESSION_BUFFER_CLEANUP_DELAY_MS =
  Number(process.env.SESSION_BUFFER_CLEANUP_DELAY_MS) || 60_000;

/** How long to wait after dispatching a session start/resume before returning success. */
const SESSION_STARTUP_VERIFY_MS = 3_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionRouteOptions = FastifyPluginOptions & {
  sessionManager: CliSessionManager;
  machineId: string;
  logger: Logger;
  controlPlaneUrl?: string;
};

type CreateSessionBody = {
  sessionId: string;
  agentId: string;
  projectPath: string;
  model?: string | null;
  prompt?: string | null;
  resumeSessionId?: string | null;
  accountCredential?: string | null;
  accountProvider?: string | null;
  forkAtIndex?: number;
  systemPrompt?: string;
};

type ResumeSessionBody = {
  prompt: string;
  claudeSessionId?: string | null;
  projectPath?: string | null;
  agentId?: string | null;
  model?: string | null;
  cpSessionId?: string | null;
  accountCredential?: string | null;
  accountProvider?: string | null;
};

type MessageBody = {
  message: string;
  accountCredential?: string | null;
  accountProvider?: string | null;
};

type SessionIdParams = {
  sessionId: string;
};

type ContentParams = {
  claudeSessionId: string;
};

type ContentQuerystring = {
  projectPath?: string;
  limit?: string;
  offset?: string;
};

// ContentMessage is re-exported from @agentctl/shared for downstream consumers
export type { ContentMessage } from '@agentctl/shared';

const DEFAULT_CONTENT_LIMIT = 100;
const MAX_SEARCH_DEPTH = 3;

// ---------------------------------------------------------------------------
// Truncation limits
// ---------------------------------------------------------------------------

/** Max chars for stderr/error messages in logs and error responses */
const STDERR_TRUNCATE = 500;
/** Max chars for CLI error messages in structured error responses */
const CLI_ERROR_TRUNCATE = 300;
/** Max chars for user/assistant message text in content parsing */
const MSG_TEXT_TRUNCATE = 8_000;
/** Max chars for tool inputs/outputs and subagent content in content parsing */
const TOOL_CONTENT_TRUNCATE = 4_000;
/** Max JSONL file size in bytes (100 MB) before skipping content parsing */
const MAX_JSONL_FILE_SIZE = 100 * 1024 * 1024;

// ---------------------------------------------------------------------------
// SSE constants
// ---------------------------------------------------------------------------

const SSE_BUFFER_LIMIT = Number(process.env.SSE_BUFFER_LIMIT) || 100;

// ---------------------------------------------------------------------------
// Path security helpers
// ---------------------------------------------------------------------------

/** Sensitive path segments that must never appear in a resolved project path. */
const DENIED_PATH_SEGMENTS = ['.ssh', '.gnupg', '.aws', '.env', 'credentials'];

/**
 * Validate a Claude session ID from an HTTP request.
 * Security: session IDs are used as file name components; reject any value
 * containing path separators, dots, or characters that could enable
 * directory traversal (js/path-injection).
 */
function validateSessionId(raw: unknown): string {
  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
    throw new WorkerError('INVALID_INPUT', 'A non-empty session ID is required');
  }
  // Allow only alphanumeric characters, dashes, and underscores
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new WorkerError('INVALID_INPUT', 'Session ID contains invalid characters', {
      sessionId: raw.slice(0, 64),
    });
  }
  return raw;
}

/**
 * Validate that a project path from an HTTP request is safe to use as a
 * file-system path. Rejects traversal sequences and sensitive directories.
 *
 * Security: prevents js/path-injection by (a) normalising the path to remove
 * any `..` traversal components via resolvePath, (b) requiring an absolute
 * path, and (c) disallowing sensitive directory names such as .ssh and .aws
 * anywhere in the resolved path.
 *
 * Note: we intentionally do NOT restrict to a specific set of root prefixes
 * (e.g. homedir, /tmp) because agent workers legitimately operate on project
 * directories anywhere on the filesystem (/home, /Users, /mnt, /opt, etc.).
 * The denied-segment check is the primary guard against accessing credentials.
 */
function validateProjectPath(raw: unknown): string {
  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
    throw new WorkerError('INVALID_PATH', 'A non-empty project path is required');
  }

  // resolvePath + normalize collapses any `..` components, eliminating traversal
  const resolved = resolvePath(normalize(raw));

  const segments = resolved.split('/');
  for (const segment of segments) {
    if (DENIED_PATH_SEGMENTS.includes(segment)) {
      throw new WorkerError(
        'INVALID_PATH',
        `Access to "${segment}" directories is denied for security reasons`,
        { path: resolved, deniedSegment: segment },
      );
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

const ERROR_STATUS_MAP: Record<string, number> = {
  SESSION_NOT_FOUND: 404,
  MAX_SESSIONS_EXCEEDED: 503,
  INVALID_INPUT: 400,
};

function errorToStatusCode(err: unknown): number {
  if (err instanceof AgentError || err instanceof WorkerError) {
    return ERROR_STATUS_MAP[err.code] ?? 500;
  }
  return 500;
}

function errorToResponse(err: unknown): { error: string; code: string } {
  if (err instanceof AgentError || err instanceof WorkerError) {
    return { error: err.message, code: err.code };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { error: message, code: 'INTERNAL_ERROR' };
}

// ---------------------------------------------------------------------------
// Session event buffer — collects AgentEvents per session for SSE catch-up
// ---------------------------------------------------------------------------

type SessionEventBuffer = {
  events: AgentEvent[];
  subscribers: Set<(event: AgentEvent) => void>;
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function sessionRoutes(
  app: FastifyInstance,
  options: SessionRouteOptions,
): Promise<void> {
  const { sessionManager, machineId, logger, controlPlaneUrl } = options;

  // Map worker-internal session IDs to control-plane session IDs
  const cpSessionIdMap = new Map<string, string>();

  // Sessions that were intentionally stopped (e.g. auto-stop before message send).
  // The session_ended handler skips error reporting for these.
  const intentionalStops = new Set<string>();

  // Per-session output buffers for SSE streaming
  const sessionBuffers = new Map<string, SessionEventBuffer>();

  /**
   * Report a session status change back to the control plane.
   * Best-effort — failures are logged but don't affect local operation.
   */
  async function reportStatusToControlPlane(
    workerSessionId: string,
    update: {
      status?: string;
      claudeSessionId?: string | null;
      pid?: number | null;
      costUsd?: number;
      errorMessage?: string;
      messageCount?: number;
    },
  ): Promise<void> {
    const cpSessionId = cpSessionIdMap.get(workerSessionId);
    if (!cpSessionId || !controlPlaneUrl) {
      return;
    }

    try {
      const response = await fetch(
        `${controlPlaneUrl}/api/sessions/${encodeURIComponent(cpSessionId)}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(update),
          signal: AbortSignal.timeout(5_000),
        },
      );

      if (!response.ok) {
        logger.warn(
          { cpSessionId, workerSessionId, httpStatus: response.status },
          'Failed to report session status to control plane',
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { cpSessionId, workerSessionId, err: message },
        'Error reporting session status to control plane',
      );
    }
  }

  function getOrCreateBuffer(sessionId: string): SessionEventBuffer {
    let buf = sessionBuffers.get(sessionId);
    if (!buf) {
      buf = { events: [], subscribers: new Set() };
      sessionBuffers.set(sessionId, buf);
    }
    return buf;
  }

  // Wire CliSessionManager events → session buffers
  sessionManager.on('session_output', (event: CliSessionEvent) => {
    if (event.type !== 'session_output') return;

    const buf = getOrCreateBuffer(event.sessionId);

    // Append to ring buffer
    buf.events.push(event.event);
    if (buf.events.length > SSE_BUFFER_LIMIT) {
      buf.events.shift();
    }

    // Notify live subscribers
    for (const sub of buf.subscribers) {
      sub(event.event);
    }
  });

  sessionManager.on('session_ended', (event: CliSessionEvent) => {
    if (event.type !== 'session_ended') return;

    // Skip if this session was already force-cleaned by DELETE endpoint
    if (!cpSessionIdMap.has(event.sessionId) && !sessionBuffers.has(event.sessionId)) {
      return;
    }

    const buf = sessionBuffers.get(event.sessionId);
    if (buf) {
      // Emit a synthetic "ended" event to all subscribers
      const session = sessionManager.getSession(event.sessionId);
      const statusValue = session?.status === 'error' ? 'error' : 'stopped';
      const endedEvent: AgentEvent = {
        event: 'status',
        data: {
          status: statusValue,
          reason: `CLI process exited with code ${String(event.exitCode)}`,
        },
      };
      buf.events.push(endedEvent);
      for (const sub of buf.subscribers) {
        sub(endedEvent);
      }
    }

    // Report session end to the control plane — but skip if this was an intentional
    // stop (e.g. auto-stop before sending a new message). The new session will report
    // 'active' and override the state.
    const wasIntentional = intentionalStops.delete(event.sessionId);
    if (!wasIntentional) {
      const session = sessionManager.getSession(event.sessionId);
      const cpSessionId = cpSessionIdMap.get(event.sessionId);
      if (cpSessionId) {
        const status = session?.status === 'error' ? 'error' : 'ended';
        void reportStatusToControlPlane(event.sessionId, {
          status,
          claudeSessionId: session?.claudeSessionId ?? null,
          pid: null,
          costUsd: session?.costUsd ?? undefined,
          messageCount: session?.messageCount ?? undefined,
          errorMessage:
            status === 'error'
              ? session?.lastError
                ? `CLI process exited with code ${event.exitCode}: ${session.lastError.slice(0, STDERR_TRUNCATE)}`
                : `CLI process exited with code ${event.exitCode}`
              : undefined,
        });
      }
    }

    // Clean up in-memory maps to prevent unbounded growth
    cpSessionIdMap.delete(event.sessionId);
    reportedClaudeIds.delete(event.sessionId);
    // Keep sessionBuffers briefly for late SSE consumers, unless already deleted by DELETE endpoint
    if (sessionBuffers.has(event.sessionId)) {
      setTimeout(() => {
        sessionBuffers.delete(event.sessionId);
      }, SESSION_BUFFER_CLEANUP_DELAY_MS);
    }
  });

  // Track which sessions have had their claudeSessionId reported
  const reportedClaudeIds = new Set<string>();

  // Report when the Claude session ID becomes available (from init/system message)
  sessionManager.on('session_output', (event: CliSessionEvent) => {
    if (event.type !== 'session_output') return;

    const session = sessionManager.getSession(event.sessionId);
    if (
      session?.claudeSessionId &&
      cpSessionIdMap.has(event.sessionId) &&
      !reportedClaudeIds.has(event.sessionId)
    ) {
      reportedClaudeIds.add(event.sessionId);
      void reportStatusToControlPlane(event.sessionId, {
        claudeSessionId: session.claudeSessionId,
        pid: session.pid,
      });
    }
  });

  // -----------------------------------------------------------------------
  // Periodic heartbeat: report active sessions to the control plane
  // -----------------------------------------------------------------------

  const CP_HEARTBEAT_INTERVAL_MS = 30_000;

  const cpHeartbeatTimer = controlPlaneUrl
    ? setInterval(() => {
        for (const [workerSessionId] of cpSessionIdMap) {
          const session = sessionManager.getSession(workerSessionId);
          if (session && (session.status === 'running' || session.status === 'starting')) {
            void reportStatusToControlPlane(workerSessionId, {
              status: 'active',
              pid: session.pid ?? undefined,
              costUsd: session.costUsd,
            });
          }
        }
      }, CP_HEARTBEAT_INTERVAL_MS)
    : null;

  app.addHook('onClose', async () => {
    if (cpHeartbeatTimer) clearInterval(cpHeartbeatTimer);
  });

  // -----------------------------------------------------------------------
  // GET / — list all active sessions on this worker
  // -----------------------------------------------------------------------

  app.get('/', async () => {
    const sessions = sessionManager.listSessions();
    return {
      sessions: sessions.map(sessionToJson),
      count: sessions.length,
      machineId,
    };
  });

  // -----------------------------------------------------------------------
  // GET /discover — discover existing Claude Code sessions on this machine
  // -----------------------------------------------------------------------

  app.get<{ Querystring: { projectPath?: string } }>('/discover', async (request) => {
    const { projectPath } = request.query;
    const discovered = sessionManager.discoverLocalSessions(projectPath ?? undefined);
    return { sessions: discovered, count: discovered.length, machineId };
  });

  // -----------------------------------------------------------------------
  // GET /content/:claudeSessionId — read conversation history from JSONL
  // -----------------------------------------------------------------------

  app.get<{ Params: ContentParams; Querystring: ContentQuerystring }>(
    '/content/:claudeSessionId',
    async (request, reply) => {
      // Security: validate session ID and project path from HTTP request to
      // prevent path injection (js/path-injection, js/http-to-file-access).
      let claudeSessionId: string;
      try {
        claudeSessionId = validateSessionId(request.params.claudeSessionId);
      } catch {
        return reply.status(400).send({ error: 'Invalid session ID', code: 'INVALID_INPUT' });
      }

      let safeProjectPath: string | undefined;
      if (request.query.projectPath) {
        try {
          safeProjectPath = validateProjectPath(request.query.projectPath);
        } catch {
          return reply.status(400).send({ error: 'Invalid project path', code: 'INVALID_INPUT' });
        }
      }

      const { limit: limitStr, offset: offsetStr } = request.query;

      let limit = DEFAULT_CONTENT_LIMIT;
      if (limitStr !== undefined) {
        const parsed = Number(limitStr);
        if (Number.isInteger(parsed) && parsed >= 1) {
          limit = parsed;
        }
      }

      // offset counts backwards from the end (0 = latest messages)
      let offset = 0;
      if (offsetStr !== undefined) {
        const parsed = Number(offsetStr);
        if (Number.isInteger(parsed) && parsed >= 0) {
          offset = parsed;
        }
      }

      const jsonlPath = findSessionJsonl(claudeSessionId, safeProjectPath);

      if (!jsonlPath) {
        return reply.status(404).send({
          error: `JSONL file for session '${claudeSessionId}' not found`,
          code: 'SESSION_CONTENT_NOT_FOUND',
        });
      }

      try {
        const stat = statSync(jsonlPath);
        if (stat.size > MAX_JSONL_FILE_SIZE) {
          // 100MB limit
          return reply.status(413).send({
            error: 'Session JSONL file too large (> 100 MB)',
            code: 'CONTENT_TOO_LARGE',
          });
        }
        const raw = readFileSync(jsonlPath, 'utf-8');
        const lines = raw.split('\n').filter((line) => line.trim().length > 0);

        const allMessages: ContentMessage[] = [];

        for (const line of lines) {
          try {
            const parsed: unknown = JSON.parse(line);
            const msgs = parseJsonlEntry(parsed);
            for (const msg of msgs) {
              allMessages.push(msg);
            }
          } catch {
            // Skip unparseable lines — partial results are acceptable
          }
        }

        const totalMessages = allMessages.length;
        // offset counts backwards from end: offset=0 → latest, offset=200 → skip last 200
        const end = totalMessages - offset;
        const start = Math.max(0, end - limit);
        const messages = end > 0 ? allMessages.slice(start, end) : [];

        return {
          messages,
          sessionId: claudeSessionId,
          totalMessages,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { claudeSessionId, jsonlPath, err: message },
          'Failed to read session JSONL file',
        );
        return reply.status(500).send({
          error: `Failed to read session content: ${message}`,
          code: 'CONTENT_READ_ERROR',
        });
      }
    },
  );

  // -----------------------------------------------------------------------
  // GET /stats — session count and breakdown by status
  // -----------------------------------------------------------------------

  app.get('/stats', async () => {
    const sessions = sessionManager.listSessions();
    const byStatus: Record<string, number> = {};
    for (const s of sessions) {
      byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    }
    return {
      total: sessions.length,
      byStatus,
      maxConcurrent: sessionManager.getMaxConcurrentSessions(),
    };
  });

  // -----------------------------------------------------------------------
  // POST /cleanup — manually trigger stale session cleanup
  // -----------------------------------------------------------------------

  app.post('/cleanup', async () => {
    const cleaned = sessionManager.cleanupStaleSessions();
    logger.info({ cleaned, machineId }, 'Manual session cleanup executed');
    return { ok: true, cleaned };
  });

  // -----------------------------------------------------------------------
  // GET /:sessionId — get a single session's details
  // -----------------------------------------------------------------------

  app.get<{ Params: SessionIdParams }>('/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;
    const session =
      sessionManager.getSession(sessionId) ?? sessionManager.getSessionByClaudeId(sessionId);

    if (!session) {
      return reply.status(404).send({
        error: `Session '${sessionId}' not found`,
        code: 'SESSION_NOT_FOUND',
      });
    }

    return sessionToJson(session);
  });

  // -----------------------------------------------------------------------
  // POST / — start a new CLI session (dispatched from control plane)
  // -----------------------------------------------------------------------

  app.post<{ Body: CreateSessionBody }>('/', async (request, reply) => {
    const {
      sessionId: cpSessionId,
      agentId,
      projectPath,
      model,
      prompt,
      resumeSessionId,
      accountCredential,
      accountProvider,
      forkAtIndex,
      systemPrompt: bodySystemPrompt,
    } = request.body;

    if (!agentId || typeof agentId !== 'string') {
      return reply.status(400).send({
        error: 'A non-empty "agentId" string is required',
        code: 'INVALID_INPUT',
      });
    }

    if (!projectPath || typeof projectPath !== 'string') {
      return reply.status(400).send({
        error: 'A non-empty "projectPath" string is required',
        code: 'INVALID_INPUT',
      });
    }

    // Security: validate project path and resume session ID from request body
    // to prevent path injection (js/path-injection, js/http-to-file-access).
    let safeProjectPath: string;
    try {
      safeProjectPath = validateProjectPath(projectPath);
    } catch {
      return reply.status(400).send({ error: 'Invalid project path', code: 'INVALID_INPUT' });
    }

    let safeResumeSessionId: string | null | undefined = resumeSessionId;
    if (resumeSessionId) {
      try {
        safeResumeSessionId = validateSessionId(resumeSessionId);
      } catch {
        return reply
          .status(400)
          .send({ error: 'Invalid resume session ID', code: 'INVALID_INPUT' });
      }
    }

    // Handle JSONL truncation fork: copy + truncate parent JSONL
    let effectiveResumeSessionId = safeResumeSessionId;

    if (forkAtIndex !== undefined && forkAtIndex >= 0 && safeResumeSessionId) {
      const parentJsonlPath = findSessionJsonl(safeResumeSessionId, safeProjectPath);
      if (parentJsonlPath) {
        const raw = readFileSync(parentJsonlPath, 'utf-8');
        const allLines = raw.split('\n').filter((l) => l.trim());

        // Count parsed messages to determine where to truncate
        let msgCount = 0;
        const truncatedLines: string[] = [];
        for (const line of allLines) {
          try {
            const parsed = JSON.parse(line);
            const msgs = parseJsonlEntry(parsed);
            truncatedLines.push(line);
            msgCount += msgs.length;
            if (msgCount > forkAtIndex) break;
          } catch {
            truncatedLines.push(line); // Keep unparseable lines
          }
        }

        // Write truncated JSONL next to parent
        const dir = dirname(parentJsonlPath);
        const newJsonlPath = join(dir, `${cpSessionId}.jsonl`);
        writeFileSync(newJsonlPath, `${truncatedLines.join('\n')}\n`);

        // Resume from the truncated copy (which uses the CP session ID)
        effectiveResumeSessionId = cpSessionId;
        logger.info(
          {
            sessionId: cpSessionId,
            parentJsonlPath,
            newJsonlPath,
            forkAtIndex,
            linesKept: truncatedLines.length,
          },
          'Created truncated JSONL fork',
        );
      } else {
        logger.warn(
          { resumeSessionId: safeResumeSessionId, projectPath: safeProjectPath },
          'Parent JSONL not found for truncation fork',
        );
      }
    }

    try {
      const session = sessionManager.startSession({
        agentId,
        projectPath: safeProjectPath,
        prompt: prompt ?? 'Continue working.',
        model: model ?? undefined,
        resumeSessionId: effectiveResumeSessionId ?? undefined,
        accountCredential: accountCredential ?? undefined,
        accountProvider: accountProvider ?? undefined,
        ...(bodySystemPrompt ? { config: { systemPrompt: bodySystemPrompt } } : {}),
      });

      // Store CP→worker session ID mapping for status callbacks
      if (cpSessionId) {
        cpSessionIdMap.set(session.id, cpSessionId);

        // Immediately report active status so the control plane doesn't have
        // to wait for the next periodic heartbeat (30s) to see this session.
        void reportStatusToControlPlane(session.id, {
          status: 'active',
          pid: session.pid ?? undefined,
        });
      }

      // Wait briefly to verify CLI process doesn't crash on startup
      const startupOk = await new Promise<boolean>((resolve) => {
        const s = sessionManager.getSession(session.id);
        if (s && s.status === 'error') {
          resolve(false);
          return;
        }

        const timer = setTimeout(() => {
          sessionManager.off('session_error', onError);
          sessionManager.off('session_ended', onEnd);
          resolve(true);
        }, SESSION_STARTUP_VERIFY_MS);

        const onError = (evt: { sessionId: string }): void => {
          if (evt.sessionId === session.id) {
            clearTimeout(timer);
            sessionManager.off('session_error', onError);
            sessionManager.off('session_ended', onEnd);
            resolve(false);
          }
        };
        const onEnd = (evt: { sessionId: string }): void => {
          if (evt.sessionId === session.id) {
            clearTimeout(timer);
            sessionManager.off('session_error', onError);
            sessionManager.off('session_ended', onEnd);
            const ended = sessionManager.getSession(session.id);
            resolve(ended?.status === 'running' || ended?.status === 'starting');
          }
        };
        sessionManager.on('session_error', onError);
        sessionManager.on('session_ended', onEnd);
      });

      if (!startupOk) {
        const failedSession = sessionManager.getSession(session.id);
        const stderr = failedSession?.lastError?.trim() ?? '';

        let hint = 'Check project path and credentials.';
        if (
          stderr.includes('authentication') ||
          stderr.includes('API key') ||
          stderr.includes('Unauthorized') ||
          stderr.includes('401')
        ) {
          hint =
            'No valid API key or auth token. Go to Settings → Accounts to configure one, then assign it to this session.';
        } else if (stderr.includes('ENOENT') || stderr.includes('no such file')) {
          hint = 'Project path does not exist on this machine.';
        } else if (stderr.includes('EACCES') || stderr.includes('permission')) {
          hint = 'Permission denied — check file/directory permissions.';
        }

        logger.warn(
          { sessionId: session.id, cpSessionId, stderr: stderr.slice(0, STDERR_TRUNCATE) },
          'CLI session failed to start',
        );
        return reply.status(502).send({
          error: stderr
            ? `CLI failed: ${stderr.slice(0, CLI_ERROR_TRUNCATE)}`
            : 'CLI process exited immediately.',
          code: 'CLI_STARTUP_FAILED',
          hint,
        });
      }

      logger.info(
        { sessionId: session.id, cpSessionId, agentId, machineId, projectPath },
        'CLI session started',
      );

      return reply.status(201).send({
        ok: true,
        session: sessionToJson(session),
      });
    } catch (err) {
      const statusCode = errorToStatusCode(err);
      return reply.status(statusCode).send(errorToResponse(err));
    }
  });

  // -----------------------------------------------------------------------
  // POST /:sessionId/resume — resume a previously completed session
  // -----------------------------------------------------------------------

  app.post<{ Params: SessionIdParams; Body: ResumeSessionBody }>(
    '/:sessionId/resume',
    async (request, reply) => {
      const { sessionId } = request.params;
      const {
        prompt,
        claudeSessionId: bodyClaudeId,
        projectPath,
        agentId,
        model,
        cpSessionId,
        accountCredential,
        accountProvider,
      } = request.body;

      if (!prompt || typeof prompt !== 'string') {
        return reply.status(400).send({
          error: 'A non-empty "prompt" string is required',
          code: 'INVALID_INPUT',
        });
      }

      // Try to find the session in memory — might be a manager ID or a Claude session ID
      const existingSession =
        sessionManager.getSession(sessionId) ?? sessionManager.getSessionByClaudeId(sessionId);

      // Determine the Claude session ID to resume from
      const resumeId = existingSession?.claudeSessionId ?? bodyClaudeId;

      if (!resumeId) {
        // Session not in memory and no claudeSessionId provided — can't resume
        if (!existingSession) {
          return reply.status(404).send({
            error: `Session '${sessionId}' not found and no claudeSessionId provided`,
            code: 'SESSION_NOT_FOUND',
          });
        }
        return reply.status(400).send({
          error: 'Session has no Claude session ID to resume',
          code: 'INVALID_INPUT',
        });
      }

      try {
        const newSession = sessionManager.resumeSession(resumeId, {
          agentId: existingSession?.agentId ?? agentId ?? 'adhoc',
          projectPath: existingSession?.projectPath ?? projectPath ?? process.cwd(),
          prompt,
          model: existingSession?.model ?? model ?? undefined,
          accountCredential: accountCredential ?? undefined,
          accountProvider: accountProvider ?? undefined,
        });

        // Store CP→worker session ID mapping so status callbacks reach the control plane
        if (cpSessionId) {
          cpSessionIdMap.set(newSession.id, cpSessionId);

          // Immediately report active status so the control plane doesn't have
          // to wait for the next periodic heartbeat (30s) to see this session.
          void reportStatusToControlPlane(newSession.id, {
            status: 'active',
            pid: newSession.pid ?? undefined,
          });
        }

        // Wait briefly to verify the CLI process didn't crash immediately
        const startupOk = await new Promise<boolean>((resolve) => {
          // If the process is already dead, fail fast
          const s = sessionManager.getSession(newSession.id);
          if (s && s.status === 'error') {
            resolve(false);
            return;
          }

          const timer = setTimeout(() => {
            // After 3s the process is still alive — good enough
            sessionManager.off('session_error', onError);
            resolve(true);
          }, SESSION_STARTUP_VERIFY_MS);

          const onError = (evt: { sessionId: string; error?: string }): void => {
            if (evt.sessionId === newSession.id) {
              clearTimeout(timer);
              sessionManager.off('session_error', onError);
              resolve(false);
            }
          };
          sessionManager.on('session_error', onError);

          // Also check if process exited already
          const onEnd = (evt: { sessionId: string }): void => {
            if (evt.sessionId === newSession.id) {
              clearTimeout(timer);
              sessionManager.off('session_error', onError);
              sessionManager.off('session_ended', onEnd);
              const endedSession = sessionManager.getSession(newSession.id);
              resolve(endedSession?.status === 'running' || endedSession?.status === 'starting');
            }
          };
          sessionManager.on('session_ended', onEnd);
        });

        if (!startupOk) {
          const failedSession = sessionManager.getSession(newSession.id);
          const stderr = failedSession?.lastError?.trim() ?? '';

          // Produce a user-friendly diagnosis from stderr
          let hint = 'Check project path and credentials.';
          if (
            stderr.includes('authentication') ||
            stderr.includes('API key') ||
            stderr.includes('Unauthorized') ||
            stderr.includes('401')
          ) {
            hint =
              'No valid API key or auth token. Go to Settings → Accounts to configure one, then assign it to this session.';
          } else if (stderr.includes('ENOENT') || stderr.includes('no such file')) {
            hint = 'Project path does not exist on this machine.';
          } else if (stderr.includes('EACCES') || stderr.includes('permission')) {
            hint = 'Permission denied — check file/directory permissions.';
          }

          logger.warn(
            {
              newSessionId: newSession.id,
              resumedFrom: resumeId,
              status: failedSession?.status,
              stderr: stderr.slice(0, STDERR_TRUNCATE),
            },
            'Resumed CLI process failed to start',
          );
          return reply.status(502).send({
            error: stderr
              ? `CLI failed: ${stderr.slice(0, CLI_ERROR_TRUNCATE)}`
              : 'CLI process exited immediately after resume.',
            code: 'CLI_STARTUP_FAILED',
            hint,
          });
        }

        logger.info(
          {
            newSessionId: newSession.id,
            resumedFrom: resumeId,
            cpSessionId,
            machineId,
          },
          'CLI session resumed',
        );

        return reply.status(200).send({
          ok: true,
          session: sessionToJson(newSession),
          resumedFrom: existingSession?.id ?? sessionId,
        });
      } catch (err) {
        const statusCode = errorToStatusCode(err);
        return reply.status(statusCode).send(errorToResponse(err));
      }
    },
  );

  // -----------------------------------------------------------------------
  // POST /:sessionId/message — send a follow-up message to a session
  //
  // In CLI `-p` mode, each prompt is a separate process. To "send a message"
  // to a completed session, we resume it with `--resume`.
  // -----------------------------------------------------------------------

  app.post<{ Params: SessionIdParams; Body: MessageBody }>(
    '/:sessionId/message',
    async (request, reply) => {
      const { sessionId } = request.params;
      const { message, accountCredential, accountProvider } = request.body;

      if (!message || typeof message !== 'string') {
        return reply.status(400).send({
          error: 'A non-empty "message" string is required',
          code: 'INVALID_INPUT',
        });
      }

      const existingSession =
        sessionManager.getSession(sessionId) ?? sessionManager.getSessionByClaudeId(sessionId);

      if (!existingSession) {
        return reply.status(404).send({
          error: `Session '${sessionId}' not found`,
          code: 'SESSION_NOT_FOUND',
        });
      }

      // If the session is still running, auto-stop it before resuming with the new message.
      // This handles cases like rate-limit hangs where the CLI process is alive but idle.
      // IMPORTANT: Save cpSessionId BEFORE stopping — the session_ended handler deletes it.
      let savedCpSessionId: string | undefined;
      if (existingSession.status === 'running') {
        // Grab the CP session ID before it gets deleted by the cleanup handler
        savedCpSessionId = cpSessionIdMap.get(existingSession.id);
        // Mark this session as intentionally stopped so session_ended doesn't report error
        intentionalStops.add(existingSession.id);

        logger.info(
          { sessionId: existingSession.id, pid: existingSession.pid },
          'Session busy — auto-stopping before sending new message',
        );
        try {
          await sessionManager.stopSession(existingSession.id, true);
          // Wait briefly for process cleanup
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (stopErr) {
          logger.warn({ err: stopErr }, 'Failed to auto-stop busy session');
          intentionalStops.delete(existingSession.id);
          return reply.status(409).send({
            error: 'Session is currently running and could not be stopped automatically.',
            code: 'SESSION_BUSY',
          });
        }
      }

      if (!existingSession.claudeSessionId) {
        return reply.status(400).send({
          error: 'Session has no Claude session ID — cannot resume',
          code: 'INVALID_INPUT',
        });
      }

      try {
        const newSession = sessionManager.resumeSession(existingSession.claudeSessionId, {
          agentId: existingSession.agentId,
          projectPath: existingSession.projectPath,
          prompt: message,
          model: existingSession.model,
          accountCredential: accountCredential ?? undefined,
          accountProvider: accountProvider ?? undefined,
        });

        // Use the saved CP session ID (may have been deleted by session_ended cleanup)
        const cpId = savedCpSessionId ?? cpSessionIdMap.get(existingSession.id);
        if (cpId) {
          cpSessionIdMap.set(newSession.id, cpId);
          // Immediately report active to override any error from the killed process
          void reportStatusToControlPlane(newSession.id, {
            status: 'active',
            pid: newSession.pid ?? undefined,
          });
        }

        logger.info(
          {
            newSessionId: newSession.id,
            resumedFrom: existingSession.claudeSessionId,
            machineId,
          },
          'Message sent via session resume',
        );

        return reply.status(200).send({
          ok: true,
          session: sessionToJson(newSession),
        });
      } catch (err) {
        const statusCode = errorToStatusCode(err);
        return reply.status(statusCode).send(errorToResponse(err));
      }
    },
  );

  // -----------------------------------------------------------------------
  // DELETE /:sessionId — stop/end a session
  // -----------------------------------------------------------------------

  app.delete<{ Params: SessionIdParams }>('/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;

    const session =
      sessionManager.getSession(sessionId) ?? sessionManager.getSessionByClaudeId(sessionId);
    if (!session) {
      return reply.status(404).send({
        error: `Session '${sessionId}' not found`,
        code: 'SESSION_NOT_FOUND',
      });
    }

    try {
      await sessionManager.stopSession(sessionId, true);

      // Force-clean all cleanup maps immediately (don't wait for session_ended handler).
      // This ensures DELETE is synchronously complete with no lingering references.
      cpSessionIdMap.delete(sessionId);
      reportedClaudeIds.delete(sessionId);
      intentionalStops.delete(sessionId);
      sessionBuffers.delete(sessionId);

      logger.info({ sessionId, machineId }, 'CLI session stopped');

      return reply.status(200).send({
        ok: true,
        sessionId,
      });
    } catch (err) {
      const statusCode = errorToStatusCode(err);
      return reply.status(statusCode).send(errorToResponse(err));
    }
  });

  // -----------------------------------------------------------------------
  // GET /:sessionId/stream — SSE stream of session output
  // -----------------------------------------------------------------------

  app.get<{ Params: SessionIdParams }>('/:sessionId/stream', async (request, reply) => {
    const { sessionId } = request.params;

    const session =
      sessionManager.getSession(sessionId) ?? sessionManager.getSessionByClaudeId(sessionId);
    if (!session) {
      throw new WorkerError('SESSION_NOT_FOUND', `Session '${sessionId}' not found`, {
        sessionId,
      });
    }

    // Hijack the response for raw SSE streaming
    reply.hijack();
    const raw = reply.raw;

    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const writeEvent = (event: AgentEvent): void => {
      raw.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };

    // 1. Replay buffered events — use internal session ID for buffer lookup
    const buf = getOrCreateBuffer(session.id);
    for (const event of buf.events) {
      writeEvent(event);
    }

    // 2. Subscribe to live events
    const onEvent = (event: AgentEvent): void => {
      if (!raw.destroyed) {
        writeEvent(event);
      }
    };
    buf.subscribers.add(onEvent);

    // 3. Heartbeat
    const heartbeat = setInterval(() => {
      if (!raw.destroyed) {
        raw.write(`: heartbeat\n\n`);
      }
    }, SSE_HEARTBEAT_INTERVAL_MS);

    // 4. Cleanup on disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      buf.subscribers.delete(onEvent);
    });
  });
}

// ---------------------------------------------------------------------------
// JSONL content helpers
// ---------------------------------------------------------------------------

const PREVIEW_TYPES = new Set(['user', 'assistant', 'progress']);

/**
 * Recursively search directories under `~/.claude/projects/` for a JSONL file
 * matching `<claudeSessionId>.jsonl`, respecting a maximum depth.
 */
function findSessionJsonl(claudeSessionId: string, projectPath?: string): string | null {
  const projectsDir = join(homedir(), '.claude', 'projects');

  if (!existsSync(projectsDir)) {
    return null;
  }

  const fileName = `${claudeSessionId}.jsonl`;

  // If projectPath is provided, check the specific encoded directory first
  if (projectPath) {
    const encoded = projectPath.replace(/\//g, '-');

    // Direct: ~/.claude/projects/<encoded>/<sessionId>.jsonl
    const directPath = join(projectsDir, encoded, fileName);
    if (existsSync(directPath)) {
      return directPath;
    }

    // Nested under `-` parent: ~/.claude/projects/-/<encoded-rest>/<sessionId>.jsonl
    const encodedRest = projectPath.startsWith('/')
      ? projectPath.slice(1).replace(/\//g, '-')
      : projectPath.replace(/\//g, '-');
    const nestedPath = join(projectsDir, '-', encodedRest, fileName);
    if (existsSync(nestedPath)) {
      return nestedPath;
    }
  }

  // Fall back to recursive search across all subdirectories
  return searchForJsonl(projectsDir, fileName, 0);
}

/**
 * Recursively search a directory tree for a file, with depth limiting.
 */
function searchForJsonl(dir: string, fileName: string, currentDepth: number): string | null {
  if (currentDepth > MAX_SEARCH_DEPTH) {
    return null;
  }

  const directPath = join(dir, fileName);
  if (existsSync(directPath)) {
    return directPath;
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    try {
      if (statSync(entryPath).isDirectory()) {
        const found = searchForJsonl(entryPath, fileName, currentDepth + 1);
        if (found) {
          return found;
        }
      }
    } catch {
      // Skip entries we can't stat
    }
  }

  return null;
}

/**
 * Parse a single JSONL entry and return ContentMessage(s).
 *
 * Claude Code JSONL format:
 * - type: "user"      → message.content[] has {type:"text"} and {type:"tool_result"} blocks
 * - type: "assistant"  → message.content[] has {type:"text"}, {type:"thinking"}, {type:"tool_use"} blocks
 * - type: "progress"  → bash_progress, agent_progress, waiting_for_task
 * - type: "queue-operation" / "file-history-snapshot" / "system" → skip
 *
 * Each content block becomes a separate ContentMessage so the frontend can
 * render them individually with appropriate styling.
 */
export function parseJsonlEntry(entry: unknown): ContentMessage[] {
  if (typeof entry !== 'object' || entry === null) {
    return [];
  }

  const obj = entry as Record<string, unknown>;
  const entryType = typeof obj.type === 'string' ? obj.type : null;

  if (!entryType || !PREVIEW_TYPES.has(entryType)) {
    return [];
  }

  const timestamp = typeof obj.timestamp === 'string' ? obj.timestamp : undefined;

  const isSidechain = (obj as Record<string, unknown>).isSidechain === true;
  const agentId =
    typeof (obj as Record<string, unknown>).agentId === 'string'
      ? ((obj as Record<string, unknown>).agentId as string)
      : undefined;

  // Handle progress entries
  if (entryType === 'progress') {
    const data = obj.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return [];

    const progressType = typeof data.type === 'string' ? data.type : null;

    if (progressType === 'agent_progress') {
      // Subagent dispatch — real data uses `data.prompt`, SDK docs say `data.content`
      const content =
        typeof data.prompt === 'string'
          ? data.prompt
          : typeof data.content === 'string'
            ? data.content
            : '';
      const subAgentId = typeof data.agentId === 'string' ? data.agentId : undefined;
      const agentType = typeof data.agentType === 'string' ? data.agentType : 'subagent';
      if (content.trim().length > 0) {
        const msg: ContentMessage = {
          type: 'subagent',
          content: content.slice(0, TOOL_CONTENT_TRUNCATE),
          toolName: agentType,
          timestamp,
        };
        if (subAgentId) msg.subagentId = subAgentId;
        else if (isSidechain) msg.subagentId = agentId;
        return [msg];
      }
    } else if (progressType === 'bash_progress') {
      const command = typeof data.command === 'string' ? data.command : '';
      if (command.trim().length > 0) {
        const msg: ContentMessage = {
          type: 'progress',
          content: command,
          toolName: 'bash',
          timestamp,
        };
        if (isSidechain) msg.subagentId = agentId;
        return [msg];
      }
    } else if (progressType === 'waiting_for_task') {
      const desc = typeof data.taskDescription === 'string' ? data.taskDescription : '';
      const taskType = typeof data.taskType === 'string' ? data.taskType : 'task';
      if (desc.trim().length > 0) {
        const msg: ContentMessage = {
          type: 'progress',
          content: desc,
          toolName: taskType,
          timestamp,
        };
        if (isSidechain) msg.subagentId = agentId;
        return [msg];
      }
    } else if (progressType === 'mcp_progress') {
      // Only show "started" events (skip "completed" to avoid duplicates)
      const status = typeof data.status === 'string' ? data.status : 'started';
      if (status === 'completed') return [];
      const server = typeof data.serverName === 'string' ? data.serverName : 'mcp';
      const tool = typeof data.toolName === 'string' ? data.toolName : '';
      const content = tool ? `${server}: ${tool}` : server;
      const msg: ContentMessage = { type: 'progress', content, toolName: 'mcp', timestamp };
      if (isSidechain) msg.subagentId = agentId;
      return [msg];
    } else if (progressType === 'hook_progress') {
      const hookName = typeof data.hookName === 'string' ? data.hookName : 'hook';
      const hookEvent = typeof data.event === 'string' ? data.event : '';
      const content = hookEvent ? `${hookName} (${hookEvent})` : hookName;
      const msg: ContentMessage = { type: 'progress', content, toolName: 'hook', timestamp };
      if (isSidechain) msg.subagentId = agentId;
      return [msg];
    }

    return [];
  }

  const message = obj.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== 'object') {
    return [];
  }

  // message.content can be a plain string (e.g. resumed sessions) or an array of blocks
  if (typeof message.content === 'string') {
    const text = (message.content as string).trim();
    if (text.length > 0) {
      return [{ type: entryType === 'user' ? 'human' : 'assistant', content: text, timestamp }];
    }
    return [];
  }

  const contentBlocks = Array.isArray(message.content) ? message.content : [];
  if (contentBlocks.length === 0) {
    return [];
  }

  const results: ContentMessage[] = [];

  for (const block of contentBlocks) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    const blockType = typeof b.type === 'string' ? b.type : null;

    if (entryType === 'user') {
      if (blockType === 'text' && typeof b.text === 'string') {
        // Skip system-injected text (IDE events, system reminders)
        const text = b.text.trim();
        if (text.startsWith('<') && (text.includes('system-reminder') || text.includes('ide_'))) {
          continue;
        }
        if (text.length > 0) {
          results.push({ type: 'human', content: text.slice(0, MSG_TEXT_TRUNCATE), timestamp });
        }
      } else if (blockType === 'tool_result') {
        const content =
          typeof b.content === 'string'
            ? b.content.slice(0, TOOL_CONTENT_TRUNCATE)
            : JSON.stringify(b.content ?? '').slice(0, TOOL_CONTENT_TRUNCATE);
        results.push({
          type: 'tool_result',
          content,
          toolId: typeof b.tool_use_id === 'string' ? (b.tool_use_id as string) : undefined,
          timestamp,
        });
      }
    }

    if (entryType === 'assistant') {
      if (blockType === 'text' && typeof b.text === 'string') {
        const text = b.text.trim();
        if (text.length > 0) {
          results.push({ type: 'assistant', content: text.slice(0, MSG_TEXT_TRUNCATE), timestamp });
        }
      } else if (blockType === 'thinking' && typeof b.thinking === 'string') {
        const text = b.thinking as string;
        if (text.trim().length > 0) {
          results.push({ type: 'thinking', content: text, timestamp });
        }
      } else if (blockType === 'tool_use' && typeof b.name === 'string') {
        const input =
          typeof b.input === 'string'
            ? b.input.slice(0, TOOL_CONTENT_TRUNCATE)
            : JSON.stringify(b.input ?? '', null, 2).slice(0, TOOL_CONTENT_TRUNCATE);
        results.push({
          type: 'tool_use',
          content: input,
          toolName: b.name as string,
          toolId: typeof b.id === 'string' ? (b.id as string) : undefined,
          timestamp,
        });
        // Detect TodoWrite tool — extract todos as separate message
        if (b.name === 'TodoWrite' && typeof b.input === 'object' && b.input !== null) {
          const inp = b.input as Record<string, unknown>;
          if (Array.isArray(inp.todos)) {
            results.push({
              type: 'todo',
              content: JSON.stringify(inp.todos),
              toolName: 'TodoWrite',
              timestamp,
            });
          }
        }
      }
    }
  }

  // Tag sidechain messages with their subagent ID
  if (isSidechain && agentId) {
    for (const r of results) {
      r.subagentId = agentId;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

function sessionToJson(session: CliSession): Record<string, unknown> {
  return {
    id: session.id,
    claudeSessionId: session.claudeSessionId,
    agentId: session.agentId,
    projectPath: session.projectPath,
    status: session.status,
    model: session.model,
    pid: session.pid,
    costUsd: session.costUsd,
    messageCount: session.messageCount,
    startedAt: session.startedAt.toISOString(),
    lastActivity: session.lastActivity.toISOString(),
    isResumed: session.isResumed,
    lastError: session.lastError ?? null,
  };
}
