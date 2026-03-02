import { AgentError, WorkerError } from '@agentctl/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
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

  // --- Global error handler ---
  app.setErrorHandler<FastifyError>((err, request, reply) => {
    if (err instanceof WorkerError || err instanceof AgentError) {
      const statusCode = workerErrorToStatus(err.code);
      return reply.status(statusCode).send({
        error: err.code,
        message: err.message,
      });
    }

    // Fastify validation errors (e.g. schema validation failures)
    if (err.statusCode === 400 && err.validation) {
      return reply.status(400).send(err);
    }

    logger.error({ err, method: request.method, url: request.url }, 'unhandled request error');

    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });

  // --- Structured request logging ---
  app.addHook('onSend', async (request, reply) => {
    const logData = {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
    };

    if (reply.statusCode >= 500) {
      logger.error(logData, 'request completed');
    } else if (reply.statusCode >= 400) {
      logger.warn(logData, 'request completed');
    } else {
      logger.info(logData, 'request completed');
    }
  });

  return app;
}

function workerErrorToStatus(code: string): number {
  if (code.endsWith('_NOT_FOUND')) {
    return 404;
  }
  if (code.endsWith('_UNAVAILABLE') || code.endsWith('_OFFLINE')) {
    return 503;
  }
  if (code.startsWith('INVALID_')) {
    return 400;
  }
  return 500;
}
