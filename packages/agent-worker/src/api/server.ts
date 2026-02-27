import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

import type { AgentPool } from '../runtime/agent-pool.js';
import { streamRoutes } from './routes/stream.js';

type CreateWorkerServerOptions = {
  logger: Logger;
  agentPool?: AgentPool;
};

export async function createWorkerServer({
  logger,
  agentPool,
}: CreateWorkerServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.get('/api/agents', async () => {
    return { agents: [] };
  });

  if (agentPool) {
    await app.register(streamRoutes, {
      prefix: '/api/agents',
      agentPool,
    });
  }

  app.addHook('onRequest', async (request) => {
    logger.debug({ method: request.method, url: request.url }, 'incoming request');
  });

  return app;
}
