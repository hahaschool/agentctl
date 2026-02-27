import type { FastifyPluginAsync } from 'fastify';

import type { AgentEvent } from '@agentctl/shared';
import { WorkerError } from '@agentctl/shared';

import type { AgentPool } from '../../runtime/agent-pool.js';

const SSE_CATCH_UP_LIMIT = 50;
const HEARTBEAT_INTERVAL_MS = 15_000;

export type StreamRoutesOptions = {
  agentPool: AgentPool;
};

/**
 * Fastify plugin that registers SSE streaming endpoints for agent output.
 *
 * `GET /api/agents/:id/stream` opens a long-lived SSE connection that:
 *   1. Replays the most recent buffered events (catch-up)
 *   2. Streams new events in real-time via OutputBuffer subscription
 *   3. Sends periodic heartbeat comments to keep the connection alive
 */
export const streamRoutes: FastifyPluginAsync<StreamRoutesOptions> = async (app, opts) => {
  const { agentPool } = opts;

  app.get<{ Params: { id: string } }>(
    '/:id/stream',
    async (request, reply) => {
      const agentId = request.params.id;
      const agent = agentPool.getAgent(agentId);

      if (!agent) {
        throw new WorkerError(
          'AGENT_NOT_FOUND',
          `Agent '${agentId}' not found in the pool`,
          { agentId },
        );
      }

      // Prevent Fastify from automatically serializing/ending the response.
      // We manage the raw HTTP stream directly for SSE.
      reply.hijack();

      const raw = reply.raw;

      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Helper to format and write a single SSE frame.
      const writeEvent = (event: AgentEvent): void => {
        raw.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      };

      // 1. Replay recent buffered events so the client can catch up.
      const recent = agent.outputBuffer.getRecent(SSE_CATCH_UP_LIMIT);

      for (const event of recent) {
        writeEvent(event);
      }

      // 2. Subscribe to live events.
      const onEvent = (event: AgentEvent): void => {
        if (!raw.destroyed) {
          writeEvent(event);
        }
      };

      agent.outputBuffer.subscribe(onEvent);

      // 3. Periodic heartbeat comment to keep proxies/load-balancers from
      //    closing the connection due to inactivity.
      const heartbeat = setInterval(() => {
        if (!raw.destroyed) {
          raw.write(`: heartbeat\n\n`);
        }
      }, HEARTBEAT_INTERVAL_MS);

      // 4. Clean up when the client disconnects.
      request.raw.on('close', () => {
        clearInterval(heartbeat);
        agent.outputBuffer.unsubscribe(onEvent);
      });
    },
  );
};
