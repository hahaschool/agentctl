import Fastify, { type FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';

import { agentRoutes } from './routes/agents.js';
import { healthRoutes } from './routes/health.js';
import { streamRoutes } from './routes/stream.js';
import { AgentRegistry } from '../registry/agent-registry.js';
import type { AgentTaskJobData, AgentTaskJobName } from '../scheduler/task-queue.js';
import type { RepeatableJobManager } from '../scheduler/repeatable-jobs.js';

type CreateServerOptions = {
  logger: Logger;
  taskQueue?: Queue<AgentTaskJobData, void, AgentTaskJobName>;
  repeatableJobs?: RepeatableJobManager;
};

export async function createServer({ logger, taskQueue, repeatableJobs }: CreateServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
  });

  const registry = new AgentRegistry();

  app.addHook('onRequest', async (request) => {
    logger.debug({ method: request.method, url: request.url }, 'incoming request');
  });

  await app.register(healthRoutes);
  await app.register(agentRoutes, {
    prefix: '/api/agents',
    taskQueue,
    repeatableJobs,
    registry,
  });
  await app.register(streamRoutes, {
    prefix: '/api/agents',
    registry,
  });

  return app;
}
