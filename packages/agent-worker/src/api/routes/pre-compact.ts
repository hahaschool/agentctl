// ---------------------------------------------------------------------------
// Pre-Compact Memory Checkpoint Route
//
// POST /api/sessions/:sessionId/pre-compact
//
// Called by the PreCompact hook script immediately before Claude Code CLI
// compacts the context window. Returns 202 Accepted immediately and fires
// the memory capture asynchronously — the hook script (and thus the CLI)
// must not be blocked.
//
// Architecture:
//   1. Validate the incoming JSON body manually (matching existing codebase pattern)
//   2. Return 202 immediately so the CLI can proceed with compaction
//   3. Schedule the async memory capture job onto the next tick
//   4. The async job has a hard 30s timeout — it will never hang forever
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard timeout for the async memory capture POST to the control plane. */
const CAPTURE_TIMEOUT_MS = 30_000;

/** Max number of recent messages accepted from the hook payload. */
const MAX_RECENT_MESSAGES = 50;

/** Max chars per recent message string before truncation. */
const MAX_MESSAGE_CHARS = 4_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PreCompactBody = {
  agentId: string;
  machineId: string;
  contextSizeTokens?: number;
  recentMessages?: string[];
};

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export type PreCompactRouteOptions = FastifyPluginOptions & {
  /** Base URL for the control plane (e.g. http://localhost:8080). */
  controlPlaneUrl: string;
  /** Logger instance. */
  logger: Logger;
  /** Optional scheduler override for deferred checkpoint capture. */
  scheduleCapture?: (task: () => void) => void;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type ValidationResult = { ok: true; body: PreCompactBody } | { ok: false; error: string };

function validatePreCompactBody(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  const body = raw as Record<string, unknown>;

  if (!body.agentId || typeof body.agentId !== 'string' || body.agentId.trim().length === 0) {
    return { ok: false, error: 'agentId must be a non-empty string' };
  }

  if (!body.machineId || typeof body.machineId !== 'string' || body.machineId.trim().length === 0) {
    return { ok: false, error: 'machineId must be a non-empty string' };
  }

  if (body.contextSizeTokens !== undefined) {
    if (
      typeof body.contextSizeTokens !== 'number' ||
      !Number.isInteger(body.contextSizeTokens) ||
      body.contextSizeTokens < 0
    ) {
      return { ok: false, error: 'contextSizeTokens must be a non-negative integer' };
    }
  }

  if (body.recentMessages !== undefined) {
    if (!Array.isArray(body.recentMessages)) {
      return { ok: false, error: 'recentMessages must be an array' };
    }
    if (body.recentMessages.length > MAX_RECENT_MESSAGES) {
      return {
        ok: false,
        error: `recentMessages must have at most ${MAX_RECENT_MESSAGES} entries`,
      };
    }
    for (const msg of body.recentMessages) {
      if (typeof msg !== 'string') {
        return { ok: false, error: 'Each entry in recentMessages must be a string' };
      }
    }
  }

  return {
    ok: true,
    body: {
      agentId: (body.agentId as string).trim(),
      machineId: (body.machineId as string).trim(),
      contextSizeTokens: body.contextSizeTokens as number | undefined,
      recentMessages: body.recentMessages as string[] | undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Async capture — fire and forget
// ---------------------------------------------------------------------------

/**
 * Asynchronously capture pre-compact session context as a memory fact.
 *
 * Posts to the control plane memory endpoint. Has a hard 30s timeout.
 * Errors are logged but never propagated — the caller has already returned 202.
 */
export async function capturePreCompactCheckpoint(
  sessionId: string,
  body: PreCompactBody,
  controlPlaneUrl: string,
  log: Logger,
): Promise<void> {
  const { agentId, machineId, contextSizeTokens, recentMessages } = body;

  // Build a concise context snapshot to store as a memory fact.
  // Only include the last 10 messages to keep the fact focused.
  const messageSnippet = recentMessages
    ?.slice(-10)
    .map((m) => m.slice(0, MAX_MESSAGE_CHARS))
    .join('\n---\n');

  const content = [
    `Pre-compaction context checkpoint for session ${sessionId}.`,
    contextSizeTokens !== undefined
      ? `Context size at compaction: ${contextSizeTokens} tokens.`
      : '',
    messageSnippet ? `Recent messages before compaction:\n${messageSnippet}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  if (!content) {
    log.info({ agentId, sessionId }, 'Pre-compact checkpoint: no content to store, skipping');
    return;
  }

  const url = `${controlPlaneUrl}/api/memory/facts`;

  const requestBody = {
    content,
    scope: `agent:${agentId}`,
    entityType: 'experience',
    confidence: 0.7,
    source: {
      session_id: sessionId,
      agent_id: agentId,
      machine_id: machineId,
      turn_index: null,
      extraction_method: 'pre_compact_hook',
    },
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    log.error(
      { err: error, agentId, sessionId, machineId },
      'Pre-compact checkpoint: failed to reach control plane',
    );
    return;
  }

  if (!response.ok) {
    const responseBody = await response.json().catch(() => ({}));
    log.warn(
      { status: response.status, body: responseBody, agentId, sessionId },
      'Pre-compact checkpoint: control plane returned error',
    );
    return;
  }

  log.info(
    { agentId, sessionId, machineId, contextSizeTokens },
    'Pre-compact checkpoint stored successfully',
  );
}

function scheduleDeferredCapture(task: () => void): void {
  setImmediate(task);
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function preCompactRoutes(
  app: FastifyInstance,
  opts: PreCompactRouteOptions,
): Promise<void> {
  const { controlPlaneUrl, logger, scheduleCapture = scheduleDeferredCapture } = opts;

  app.post<{ Params: { sessionId: string }; Body: unknown }>(
    '/:sessionId/pre-compact',
    async (request: FastifyRequest<{ Params: { sessionId: string }; Body: unknown }>, reply) => {
      const log = logger.child({ route: 'pre-compact' });

      const { sessionId } = request.params;

      // Validate body manually (matching existing codebase pattern — no zod dependency)
      const validation = validatePreCompactBody(request.body);
      if (!validation.ok) {
        return reply.status(400).send({
          error: 'INVALID_PARAMS',
          message: validation.error,
        });
      }

      const body = validation.body;

      log.info(
        {
          sessionId,
          agentId: body.agentId,
          machineId: body.machineId,
          contextSizeTokens: body.contextSizeTokens,
          recentMessageCount: body.recentMessages?.length ?? 0,
        },
        'Pre-compact notification received — triggering async checkpoint',
      );

      // Fire-and-forget: return 202 immediately, then start the checkpoint on the next tick.
      scheduleCapture(() => {
        void capturePreCompactCheckpoint(sessionId, body, controlPlaneUrl, log).catch(
          (err: unknown) => {
            log.error({ err, sessionId }, 'Unexpected error in pre-compact checkpoint capture');
          },
        );
      });

      return reply.status(202).send({ queued: true });
    },
  );
}
