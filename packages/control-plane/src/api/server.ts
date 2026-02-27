import fastifyWebsocket from '@fastify/websocket';
import type { Queue } from 'bullmq';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Mem0Client } from '../memory/mem0-client.js';
import type { MachineRegistryLike } from '../registry/agent-registry.js';
import { AgentRegistry } from '../registry/agent-registry.js';
import type { DbAgentRegistry } from '../registry/db-registry.js';
import type { LiteLLMClient } from '../router/litellm-client.js';
import type { RepeatableJobManager } from '../scheduler/repeatable-jobs.js';
import type { AgentTaskJobData, AgentTaskJobName } from '../scheduler/task-queue.js';
import { agentRoutes } from './routes/agents.js';
import { healthRoutes } from './routes/health.js';
import { memoryRoutes } from './routes/memory.js';
import { routerRoutes } from './routes/router.js';
import { streamRoutes } from './routes/stream.js';
import { wsRoutes } from './routes/ws.js';

type CreateServerOptions = {
  logger: Logger;
  taskQueue?: Queue<AgentTaskJobData, void, AgentTaskJobName>;
  repeatableJobs?: RepeatableJobManager;
  registry?: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry;
  litellmClient?: LiteLLMClient;
  mem0Client?: Mem0Client;
};

export async function createServer({
  logger,
  taskQueue,
  repeatableJobs,
  registry: externalRegistry,
  dbRegistry,
  litellmClient,
  mem0Client,
}: CreateServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
  });

  const registry = externalRegistry ?? new AgentRegistry();

  app.addHook('onRequest', async (request) => {
    logger.debug({ method: request.method, url: request.url }, 'incoming request');
  });

  // Register @fastify/websocket before any WebSocket route plugins.
  await app.register(fastifyWebsocket);

  await app.register(healthRoutes);
  await app.register(agentRoutes, {
    prefix: '/api/agents',
    taskQueue,
    repeatableJobs,
    registry,
    dbRegistry,
  });
  await app.register(streamRoutes, {
    prefix: '/api/agents',
    registry,
    dbRegistry: dbRegistry ?? null,
  });
  await app.register(wsRoutes, {
    prefix: '/api',
    dbRegistry: dbRegistry ?? null,
    taskQueue: taskQueue ?? null,
    logger,
  });

  // Register LiteLLM router routes only when the client is provided.
  if (litellmClient) {
    await app.register(routerRoutes, {
      prefix: '/api/router',
      litellmClient,
    });
  }

  // Register memory routes only when the Mem0 client is provided.
  if (mem0Client) {
    await app.register(memoryRoutes, {
      prefix: '/api/memory',
      mem0Client,
    });
  }

  return app;
}
