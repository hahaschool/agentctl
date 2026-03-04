import * as crypto from 'node:crypto';

import { ControlPlaneError } from '@agentctl/shared';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyWebsocket from '@fastify/websocket';
import type { Queue } from 'bullmq';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import type { Mem0Client } from '../memory/mem0-client.js';
import type { MemoryInjector } from '../memory/memory-injector.js';
import type { MachineRegistryLike } from '../registry/agent-registry.js';
import { AgentRegistry } from '../registry/agent-registry.js';
import type { DbAgentRegistry } from '../registry/db-registry.js';
import type { LiteLLMClient } from '../router/litellm-client.js';
import type { RepeatableJobManager } from '../scheduler/repeatable-jobs.js';
import type { AgentTaskJobData, AgentTaskJobName } from '../scheduler/task-queue.js';
import { agentRoutes } from './routes/agents.js';
import { auditRoutes } from './routes/audit.js';
import { checkpointRoutes } from './routes/checkpoint.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { emergencyStopProxyRoutes } from './routes/emergency-stop.js';
import { healthRoutes } from './routes/health.js';
import { loopProxyRoutes } from './routes/loop.js';
import { memoryRoutes } from './routes/memory.js';
import { createRequestTracker, metricsRoutes, recordRequest } from './routes/metrics.js';
import { replayRoutes } from './routes/replay.js';
import { routerRoutes } from './routes/router.js';
import { schedulerRoutes } from './routes/scheduler.js';
import { accountRoutes } from './routes/accounts.js';
import { sessionRoutes } from './routes/sessions.js';
import { streamRoutes } from './routes/stream.js';
import { webhookRoutes } from './routes/webhooks.js';
import { wsRoutes } from './routes/ws.js';

type CreateServerOptions = {
  logger: Logger;
  taskQueue?: Queue<AgentTaskJobData, void, AgentTaskJobName>;
  repeatableJobs?: RepeatableJobManager;
  registry?: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry;
  db?: Database;
  redis?: { ping: () => Promise<string> };
  litellmClient?: LiteLLMClient;
  mem0Client?: Mem0Client;
  memoryInjector?: MemoryInjector | null;
  workerPort?: number;
  isProduction?: boolean;
  corsOrigins?: string;
};

export async function createServer({
  logger,
  taskQueue,
  repeatableJobs,
  registry: externalRegistry,
  dbRegistry,
  db,
  redis,
  litellmClient,
  mem0Client,
  memoryInjector = null,
  workerPort = 9000,
  isProduction: isProductionOverride,
  corsOrigins: corsOriginsOverride,
}: CreateServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    genReqId: () => crypto.randomUUID(),
  });

  const registry = externalRegistry ?? new AgentRegistry();
  const requestTracker = createRequestTracker();

  // --- Metrics request tracking ---
  // Registered at the root level so it captures requests to all routes.
  app.addHook('onResponse', async (request, reply) => {
    // Exclude the /metrics endpoint itself to avoid self-referential noise
    if (request.url === '/metrics') {
      return;
    }
    const durationSeconds = (reply.elapsedTime ?? 0) / 1000;
    recordRequest(requestTracker, request.method, request.url, reply.statusCode, durationSeconds);
  });

  // --- Request ID ---
  // Expose the generated request ID as a response header for traceability.
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });

  app.addHook('onRequest', async (request) => {
    logger.debug(
      { method: request.method, url: request.url, requestId: request.id },
      'incoming request',
    );
  });

  // --- CORS ---
  const isProduction = isProductionOverride ?? process.env.NODE_ENV === 'production';
  const corsOrigins = corsOriginsOverride ?? process.env.CORS_ORIGINS;

  await app.register(fastifyCors, {
    origin: isProduction
      ? corsOrigins
        ? corsOrigins.split(',').map((o) => o.trim())
        : false
      : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['X-Request-Id'],
  });

  // --- Rate Limiting ---
  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: (request) => {
      return request.url === '/health' || request.url === '/metrics';
    },
    errorResponseBuilder: () => {
      return { error: 'RATE_LIMITED', message: 'Too many requests' };
    },
  });

  // --- OpenAPI / Swagger ---
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'AgentCTL Control Plane',
        description: 'Multi-machine AI agent orchestration API',
        version: '0.1.0',
      },
      tags: [
        { name: 'health', description: 'Health checks and system status' },
        { name: 'machines', description: 'Machine registration and heartbeat' },
        { name: 'agents', description: 'Agent CRUD and lifecycle control' },
        { name: 'scheduler', description: 'Repeatable job scheduling' },
        { name: 'memory', description: 'Mem0 memory search' },
        { name: 'router', description: 'LiteLLM model routing' },
        { name: 'audit', description: 'Action audit log and replay' },
        { name: 'dashboard', description: 'Analytics and cost dashboards' },
        { name: 'webhooks', description: 'Webhook subscription management' },
        { name: 'sessions', description: 'Remote Control session management' },
        { name: 'stream', description: 'SSE agent output streaming' },
      ],
      components: {
        schemas: {
          DependencyStatus: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'error'] },
              latencyMs: { type: 'number' },
              error: { type: 'string' },
            },
            required: ['status', 'latencyMs'],
          },
          ErrorResponse: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['error', 'message'],
          },
        },
      },
    },
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: '/api/docs',
  });

  // Register @fastify/websocket before any WebSocket route plugins.
  await app.register(fastifyWebsocket);

  await app.register(healthRoutes, {
    db,
    redis,
    mem0Client,
    litellmClient,
  });
  await app.register(metricsRoutes, {
    registry,
    dbRegistry,
    db,
    redis,
    mem0Client,
    litellmClient,
    requestTracker,
  });
  await app.register(agentRoutes, {
    prefix: '/api/agents',
    taskQueue,
    repeatableJobs,
    registry,
    dbRegistry,
    memoryInjector,
  });
  await app.register(streamRoutes, {
    prefix: '/api/agents',
    registry,
    dbRegistry: dbRegistry ?? null,
    workerPort,
  });
  await app.register(loopProxyRoutes, {
    prefix: '/api/agents',
    registry,
    dbRegistry: dbRegistry ?? null,
    workerPort,
  });
  await app.register(emergencyStopProxyRoutes, {
    prefix: '/api/agents',
    registry,
    dbRegistry: dbRegistry ?? null,
    workerPort,
  });
  await app.register(wsRoutes, {
    prefix: '/api',
    dbRegistry: dbRegistry ?? null,
    taskQueue: taskQueue ?? null,
    logger,
    workerPort,
  });

  // Register audit ingestion routes only when the database is configured.
  if (dbRegistry) {
    await app.register(auditRoutes, {
      prefix: '/api/audit',
      dbRegistry,
    });

    await app.register(replayRoutes, {
      prefix: '/api/audit/replay',
      dbRegistry,
    });
  }

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

  // Register scheduler routes for managing repeatable jobs.
  await app.register(schedulerRoutes, {
    prefix: '/api/scheduler',
    repeatableJobManager: repeatableJobs ?? null,
  });

  // Register checkpoint routes when both dbRegistry and db are available.
  if (dbRegistry && db) {
    await app.register(checkpointRoutes, {
      prefix: '/api/agents',
      dbRegistry,
      db,
    });
  }

  // Register webhook subscription management routes when db is available.
  if (db) {
    await app.register(webhookRoutes, {
      prefix: '/api/webhooks',
      db,
    });
  }

  // Register session management routes when both db and dbRegistry are available.
  if (db && dbRegistry) {
    await app.register(sessionRoutes, {
      prefix: '/api/sessions',
      db,
      dbRegistry,
      workerPort,
    });
  }

  // Register dashboard analytics routes when both db and dbRegistry are available.
  if (db && dbRegistry) {
    await app.register(dashboardRoutes, {
      prefix: '/api/dashboard',
      db,
      dbRegistry,
    });
  }

  // Register account management routes when db is available.
  if (db) {
    const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY ?? '';
    if (encryptionKey) {
      await app.register(accountRoutes, {
        prefix: '/api/settings/accounts',
        db,
        encryptionKey,
      });
    }
  }

  // --- Global error handler ---
  app.setErrorHandler<FastifyError>((err, request, reply) => {
    if (err instanceof ControlPlaneError) {
      const statusCode = controlPlaneErrorToStatus(err.code);
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
      requestId: request.id,
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

function controlPlaneErrorToStatus(code: string): number {
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
