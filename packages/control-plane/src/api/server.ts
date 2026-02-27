import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

import { agentRoutes } from './routes/agents.js';
import { healthRoutes } from './routes/health.js';

type CreateServerOptions = {
  logger: Logger;
};

export async function createServer({ logger }: CreateServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
  });

  app.addHook('onRequest', async (request) => {
    logger.debug({ method: request.method, url: request.url }, 'incoming request');
  });

  await app.register(healthRoutes);
  await app.register(agentRoutes, { prefix: '/api/agents' });

  return app;
}
