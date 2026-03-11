// ---------------------------------------------------------------------------
// Worker-side memory feedback route
//
// Proxies `memory_feedback` MCP tool signals to the control-plane
// POST /api/memory/facts/:id/feedback endpoint.
//
// Supported signals:
//   - used:       fact was helpful; increments usage_count and boosts strength
//   - irrelevant: fact was not relevant; decreases strength slightly
//   - outdated:   fact is stale; decreases confidence and flags for review
// ---------------------------------------------------------------------------

import type { FeedbackSignal } from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

const VALID_SIGNALS: FeedbackSignal[] = ['used', 'irrelevant', 'outdated'];

type MemoryFeedbackRouteOptions = FastifyPluginOptions & {
  controlPlaneUrl: string;
  logger: Logger;
};

type FeedbackBody = {
  factId: string;
  signal: string;
};

export async function memoryFeedbackRoutes(
  app: FastifyInstance,
  opts: MemoryFeedbackRouteOptions,
): Promise<void> {
  const { controlPlaneUrl, logger } = opts;

  app.post(
    '/memory-feedback',
    async (request: FastifyRequest<{ Body: FeedbackBody }>, reply: FastifyReply) => {
      const body = request.body as FeedbackBody;
      const factId = body?.factId;
      const signal = body?.signal as FeedbackSignal | undefined;

      if (!factId || typeof factId !== 'string' || factId.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'factId must be a non-empty string',
        });
      }

      if (!signal || !VALID_SIGNALS.includes(signal)) {
        return reply.code(400).send({
          error: 'INVALID_SIGNAL',
          message: `signal must be one of: ${VALID_SIGNALS.join(', ')}`,
        });
      }

      const url = `${controlPlaneUrl}/api/memory/facts/${encodeURIComponent(factId)}/feedback`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signal }),
        });
      } catch (error: unknown) {
        logger.error(
          { err: error, factId, signal },
          'Failed to reach control-plane for memory feedback',
        );
        return reply.code(503).send({
          error: 'MEMORY_FEEDBACK_UNREACHABLE',
          message: 'Control-plane unreachable while recording memory feedback',
        });
      }

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({}));
        logger.warn(
          { factId, signal, status: response.status, body: responseBody },
          'Control-plane returned error for memory feedback',
        );
        return reply.code(response.status).send(responseBody);
      }

      const result = (await response.json()) as Record<string, unknown>;
      return { ok: true, ...result };
    },
  );
}
