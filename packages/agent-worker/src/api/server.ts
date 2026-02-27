import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

import type { AgentPool } from '../runtime/agent-pool.js';
import { agentRoutes } from './routes/agents.js';
import { streamRoutes } from './routes/stream.js';

type CreateWorkerServerOptions = {
  logger: Logger;
  agentPool: AgentPool;
  machineId: string;
};

export async function createWorkerServer({
  logger,
  agentPool,
  machineId,
}: CreateWorkerServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (request) => {
    logger.debug({ method: request.method, url: request.url }, 'incoming request');
  });

  app.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      agents: {
        running: agentPool.getRunningCount(),
        total: agentPool.size,
        maxConcurrent: agentPool.getMaxConcurrent(),
      },
    };
  });

  await app.register(agentRoutes, {
    prefix: '/api/agents',
    pool: agentPool,
    machineId,
    logger,
  });

  await app.register(streamRoutes, {
    prefix: '/api/agents',
    agentPool,
  });

  return app;
}
