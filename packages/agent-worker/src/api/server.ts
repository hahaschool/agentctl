import { AgentError, WorkerError } from '@agentctl/shared';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

import type { AgentPool } from '../runtime/agent-pool.js';
import { agentRoutes } from './routes/agents.js';
import { streamRoutes } from './routes/stream.js';

const HEALTH_CHECK_TIMEOUT_MS = 2_000;

type CreateWorkerServerOptions = {
  logger: Logger;
  agentPool: AgentPool;
  machineId: string;
  controlPlaneUrl?: string;
};

type DependencyStatus = {
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
};

/**
 * Execute a health check with a timeout. Returns a DependencyStatus indicating
 * success or failure along with the measured latency.
 */
async function checkWithTimeout(
  name: string,
  fn: () => Promise<void>,
): Promise<DependencyStatus> {
  const start = performance.now();

  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`${name} health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)), HEALTH_CHECK_TIMEOUT_MS);
      }),
    ]);

    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      latencyMs: Math.round(performance.now() - start),
      error: message,
    };
  }
}

export async function createWorkerServer({
  logger,
  agentPool,
  machineId,
  controlPlaneUrl,
}: CreateWorkerServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (request) => {
    logger.debug({ method: request.method, url: request.url }, 'incoming request');
  });

  app.get<{ Querystring: { detail?: string } }>('/health', async (request) => {
    const detail = request.query.detail === 'true';
    const timestamp = new Date().toISOString();

    const rssBytes = process.memoryUsage().rss;
    const rssMb = Math.round((rssBytes / 1_048_576) * 100) / 100;

    // Run dependency checks in parallel.
    const [controlPlaneResult] = await Promise.allSettled([
      controlPlaneUrl
        ? checkWithTimeout('controlPlane', async () => {
            const response = await fetch(`${controlPlaneUrl}/health`, {
              method: 'GET',
              signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
            });
            if (!response.ok) {
              throw new Error(`Control plane returned HTTP ${response.status}`);
            }
          })
        : Promise.resolve({ status: 'ok' as const, latencyMs: 0 }),
    ]);

    const cpStatus: DependencyStatus =
      controlPlaneResult.status === 'fulfilled'
        ? controlPlaneResult.value
        : {
            status: 'error',
            latencyMs: 0,
            error:
              controlPlaneResult.reason instanceof Error
                ? controlPlaneResult.reason.message
                : String(controlPlaneResult.reason),
          };

    const anyError = cpStatus.status === 'error';
    const status: 'ok' | 'degraded' = anyError ? 'degraded' : 'ok';

    if (!detail) {
      return {
        status,
        timestamp,
        uptime: process.uptime(),
        activeAgents: agentPool.getRunningCount(),
        totalAgentsStarted: agentPool.getTotalAgentsStarted(),
        worktreesActive: agentPool.getWorktreeCount(),
        memoryUsage: rssMb,
        agents: {
          running: agentPool.getRunningCount(),
          total: agentPool.size,
          maxConcurrent: agentPool.getMaxConcurrent(),
        },
      };
    }

    return {
      status,
      timestamp,
      uptime: process.uptime(),
      activeAgents: agentPool.getRunningCount(),
      totalAgentsStarted: agentPool.getTotalAgentsStarted(),
      worktreesActive: agentPool.getWorktreeCount(),
      memoryUsage: rssMb,
      agents: {
        running: agentPool.getRunningCount(),
        total: agentPool.size,
        maxConcurrent: agentPool.getMaxConcurrent(),
      },
      dependencies: {
        controlPlane: cpStatus,
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
