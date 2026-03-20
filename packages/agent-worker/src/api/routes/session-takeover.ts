// ---------------------------------------------------------------------------
// Worker-side session takeover routes — HTTP endpoints for initiating and
// releasing terminal takeover sessions.
//
// When a user wants to "take over" a managed CLI session, these routes:
//   1. Stop the managed -p process (with close-event waiting)
//   2. Spawn an interactive PTY via TakeoverManager
//   3. Return terminal credentials for WebSocket attachment
//
// Routes:
//   POST /:sessionId/takeover  — initiate takeover (stop managed + spawn PTY)
//   POST /:sessionId/release   — release takeover (kill PTY, optionally resume)
//   GET  /:sessionId/takeover  — get current takeover state
// ---------------------------------------------------------------------------

import { WorkerError } from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';

import type { AgentPool } from '../../runtime/agent-pool.js';
import type { CliSessionManager } from '../../runtime/cli-session-manager.js';
import type { TakeoverManager } from '../../runtime/takeover-manager.js';
import type { TerminalManager } from '../../runtime/terminal-manager.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time to wait for the managed session process to exit after stop. */
const SESSION_CLOSE_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionTakeoverRouteOptions = FastifyPluginOptions & {
  sessionManager: CliSessionManager;
  terminalManager: TerminalManager;
  takeoverManager: TakeoverManager;
  agentPool: AgentPool;
  controlPlaneUrl?: string;
  logger: Logger;
};

type SessionIdParams = {
  sessionId: string;
};

type ReleaseQuerystring = {
  resume?: string;
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function sessionTakeoverRoutes(
  app: FastifyInstance,
  options: SessionTakeoverRouteOptions,
): Promise<void> {
  const { sessionManager, takeoverManager, controlPlaneUrl, logger } = options;

  // -----------------------------------------------------------------------
  // POST /:sessionId/takeover — initiate terminal takeover
  // -----------------------------------------------------------------------

  app.post<{ Params: SessionIdParams }>('/:sessionId/takeover', async (request, reply) => {
    const { sessionId } = request.params;

    // Look up session by manager ID or Claude session ID
    const session =
      sessionManager.getSession(sessionId) ?? sessionManager.getSessionByClaudeId(sessionId);

    if (!session) {
      return reply.status(404).send({
        error: 'SESSION_NOT_FOUND',
        message: `Session '${sessionId}' not found`,
      });
    }

    if (!session.claudeSessionId) {
      return reply.status(400).send({
        error: 'SESSION_NOT_RESUMABLE',
        message: 'Session has no Claude session ID — cannot takeover',
      });
    }

    // Check if already under takeover
    if (takeoverManager.isUnderTakeover(session.id)) {
      const existing = takeoverManager.getTakeoverState(session.id);
      return reply.status(409).send({
        error: 'TAKEOVER_ALREADY_ACTIVE',
        message: `Session '${sessionId}' is already under takeover`,
        terminalId: existing?.terminalId,
      });
    }

    // Stop the managed session and wait for its process to actually close.
    // stopSession sends SIGTERM, but we also need to wait for the 'close'
    // event to ensure the process is fully terminated before spawning PTY.
    if (session.status === 'running' || session.status === 'starting') {
      try {
        await waitForSessionClose(sessionManager, session.id);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.error(
          { sessionId: session.id, error: detail },
          'Failed to stop managed session for takeover',
        );
        return reply.status(500).send({
          error: 'SESSION_STOP_FAILED',
          message: `Failed to stop managed session: ${detail}`,
        });
      }
    }

    // Spawn interactive PTY
    try {
      const result = await takeoverManager.initiateTakeover({
        sessionId: session.id,
        claudeSessionId: session.claudeSessionId,
        projectPath: session.projectPath,
        controlPlaneUrl,
      });

      return reply.send({
        ok: true,
        terminalId: result.terminalId,
        takeoverToken: result.takeoverToken,
        claudeSessionId: session.claudeSessionId,
      });
    } catch (err) {
      if (err instanceof WorkerError) {
        const statusCode = err.code === 'TAKEOVER_ALREADY_ACTIVE' ? 409 : 500;
        return reply.status(statusCode).send({
          error: err.code,
          message: err.message,
        });
      }
      const detail = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({
        error: 'TAKEOVER_FAILED',
        message: detail,
      });
    }
  });

  // -----------------------------------------------------------------------
  // POST /:sessionId/release — release terminal takeover
  // -----------------------------------------------------------------------

  app.post<{ Params: SessionIdParams; Querystring: ReleaseQuerystring }>(
    '/:sessionId/release',
    async (request, reply) => {
      const { sessionId } = request.params;
      const resume = request.query.resume === 'true';

      // Look up by manager ID or Claude session ID
      const session =
        sessionManager.getSession(sessionId) ?? sessionManager.getSessionByClaudeId(sessionId);

      const effectiveId = session?.id ?? sessionId;

      if (!takeoverManager.isUnderTakeover(effectiveId)) {
        return reply.status(404).send({
          error: 'TAKEOVER_NOT_FOUND',
          message: `Session '${sessionId}' is not under takeover`,
        });
      }

      try {
        await takeoverManager.release(effectiveId, {
          resume,
          controlPlaneUrl,
        });

        // If resume requested, restart the managed session
        if (resume && session?.claudeSessionId) {
          try {
            sessionManager.resumeSession(session.claudeSessionId, {
              agentId: session.agentId,
              projectPath: session.projectPath,
              prompt: 'Continue where you left off.',
              model: session.model,
            });
            logger.info(
              { sessionId: effectiveId, claudeSessionId: session.claudeSessionId },
              'Resumed managed session after takeover release',
            );
          } catch (resumeErr) {
            const detail = resumeErr instanceof Error ? resumeErr.message : String(resumeErr);
            logger.warn(
              { sessionId: effectiveId, error: detail },
              'Failed to resume managed session after takeover release',
            );
            // Don't fail the release — the takeover was successfully released
          }
        }

        return reply.send({ ok: true, resumed: resume });
      } catch (err) {
        if (err instanceof WorkerError) {
          return reply.status(404).send({
            error: err.code,
            message: err.message,
          });
        }
        const detail = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({
          error: 'RELEASE_FAILED',
          message: detail,
        });
      }
    },
  );

  // -----------------------------------------------------------------------
  // GET /:sessionId/takeover — get current takeover state
  // -----------------------------------------------------------------------

  app.get<{ Params: SessionIdParams }>('/:sessionId/takeover', async (request, reply) => {
    const { sessionId } = request.params;

    // Look up by manager ID or Claude session ID
    const session =
      sessionManager.getSession(sessionId) ?? sessionManager.getSessionByClaudeId(sessionId);

    const effectiveId = session?.id ?? sessionId;
    const state = takeoverManager.getTakeoverState(effectiveId);

    if (!state) {
      return reply.send({
        active: false,
        sessionId: effectiveId,
      });
    }

    return reply.send({
      active: true,
      sessionId: state.sessionId,
      terminalId: state.terminalId,
      claudeSessionId: state.claudeSessionId,
      startedAt: state.startedAt.toISOString(),
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Stop a managed CLI session and wait for its process to fully exit.
 *
 * Uses stopSession (which sends SIGTERM + SIGKILL fallback) and also listens
 * for the 'session_ended' event to confirm the process has closed. Times out
 * after SESSION_CLOSE_TIMEOUT_MS.
 */
async function waitForSessionClose(
  sessionManager: CliSessionManager,
  sessionId: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      // Even after timeout, the session may be killed — proceed optimistically
      resolve();
    }, SESSION_CLOSE_TIMEOUT_MS);

    const onEnded = (event: { type: string; sessionId: string }): void => {
      if (event.type === 'session_ended' && event.sessionId === sessionId) {
        cleanup();
        resolve();
      }
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      sessionManager.removeListener('session_ended', onEnded);
    };

    sessionManager.on('session_ended', onEnded);

    // Initiate graceful stop
    sessionManager.stopSession(sessionId, true).catch((err: unknown) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
