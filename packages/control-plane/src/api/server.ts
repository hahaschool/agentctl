import * as crypto from 'node:crypto';

import {
  ControlPlaneError,
  type DispatchVerificationConfig,
  summarizeHandoffAnalytics,
} from '@agentctl/shared';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyWebsocket from '@fastify/websocket';
import type { Queue } from 'bullmq';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { EventStore } from '../collaboration/event-store.js';
import { SpaceStore } from '../collaboration/space-store.js';
import { TaskGraphStore } from '../collaboration/task-graph-store.js';
import { TaskRunStore } from '../collaboration/task-run-store.js';
import { ThreadStore } from '../collaboration/thread-store.js';
import { WorkerLeaseStore } from '../collaboration/worker-lease-store.js';
import { WorkerNodeStore } from '../collaboration/worker-node-store.js';
import type { Database } from '../db/index.js';
import type { Mem0Client } from '../memory/mem0-client.js';
import type { MemoryInjector } from '../memory/memory-injector.js';
import type { MemorySearch } from '../memory/memory-search.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { MachineRegistryLike } from '../registry/agent-registry.js';
import { AgentRegistry } from '../registry/agent-registry.js';
import type { DbAgentRegistry } from '../registry/db-registry.js';
import type { LiteLLMClient } from '../router/litellm-client.js';
import { HandoffStore, type SessionHandoffRecord } from '../runtime-management/handoff-store.js';
import {
  type ManagedSessionRecord,
  ManagedSessionStore,
} from '../runtime-management/managed-session-store.js';
import {
  type CreateRunHandoffDecisionInput,
  RunHandoffDecisionStore,
} from '../runtime-management/run-handoff-decision-store.js';
import {
  type MachineRuntimeStateRecord,
  RuntimeConfigStore,
} from '../runtime-management/runtime-config-store.js';
import type { RepeatableJobManager } from '../scheduler/repeatable-jobs.js';
import type { AgentTaskJobData, AgentTaskJobName } from '../scheduler/task-queue.js';
import { accountRoutes } from './routes/accounts.js';
import { agentRoutes } from './routes/agents.js';
import { auditRoutes } from './routes/audit.js';
import { checkpointRoutes } from './routes/checkpoint.js';
import { claudeMemRoutes } from './routes/claude-mem.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { emergencyStopProxyRoutes } from './routes/emergency-stop.js';
import { fileProxyRoutes } from './routes/files.js';
import { gitProxyRoutes } from './routes/git.js';
import { handoffRoutes } from './routes/handoffs.js';
import { healthRoutes } from './routes/health.js';
import { loopProxyRoutes } from './routes/loop.js';
import { manualTakeoverRoutes } from './routes/manual-takeover.js';
import { mcpTemplateRoutes } from './routes/mcp-templates.js';
import { memoryRoutes } from './routes/memory.js';
import { memoryConsolidationRoutes } from './routes/memory-consolidation.js';
import { memoryDecayRoutes } from './routes/memory-decay.js';
import { memoryEdgeRoutes, memoryGraphRoutes } from './routes/memory-edges.js';
import { memoryFactRoutes } from './routes/memory-facts.js';
import { memoryImportRoutes } from './routes/memory-import.js';
import { memoryReportsRoutes } from './routes/memory-reports.js';
import { memoryScopeRoutes } from './routes/memory-scopes.js';
import { memoryStatsRoutes } from './routes/memory-stats.js';
import { memorySynthesisRoutes } from './routes/memory-synthesis.js';
import { createRequestTracker, metricsRoutes, recordRequest } from './routes/metrics.js';
import { oauthRoutes } from './routes/oauth.js';
import { replayRoutes } from './routes/replay.js';
import { routerRoutes } from './routes/router.js';
import { runHandoffRoutes } from './routes/run-handoffs.js';
import { registerRunReaper } from './routes/run-reaper.js';
import { runSummaryRoutes } from './routes/run-summary.js';
import { type RuntimeConfigRouteStore, runtimeConfigRoutes } from './routes/runtime-config.js';
import { runtimeSessionRoutes } from './routes/runtime-sessions.js';
import { schedulerRoutes } from './routes/scheduler.js';
import { sessionRoutes } from './routes/sessions.js';
import { settingsRoutes } from './routes/settings.js';
import { spaceRoutes } from './routes/spaces.js';
import { streamRoutes } from './routes/stream.js';
import { taskGraphRoutes } from './routes/task-graphs.js';
import { taskRunRoutes } from './routes/task-runs.js';
import { terminalProxyRoutes } from './routes/terminal.js';
import { webhookRoutes } from './routes/webhooks.js';
import { workerNodeRoutes } from './routes/worker-nodes.js';
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
  memorySearch?: Pick<MemorySearch, 'search'>;
  memoryStore?: Pick<
    MemoryStore,
    | 'addEdge'
    | 'addFact'
    | 'deleteEdge'
    | 'deleteFact'
    | 'getFact'
    | 'getStats'
    | 'invalidateFact'
    | 'listEdges'
    | 'listFacts'
    | 'recordFeedback'
    | 'updateFact'
  >;
  memoryInjector?: MemoryInjector | null;
  pgPool?: Pool;
  workerPort?: number;
  isProduction?: boolean;
  corsOrigins?: string;
  runtimeConfigStore?: RuntimeConfigRouteStore;
  dispatchVerificationConfig?: DispatchVerificationConfig | null;
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
  memorySearch,
  memoryStore,
  memoryInjector = null,
  pgPool,
  workerPort = 9000,
  isProduction: isProductionOverride,
  corsOrigins: corsOriginsOverride,
  runtimeConfigStore: externalRuntimeConfigStore,
  dispatchVerificationConfig = null,
}: CreateServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    genReqId: () => crypto.randomUUID(),
  });

  const registry = externalRegistry ?? new AgentRegistry();
  const requestTracker = createRequestTracker();
  const runtimeConfigStore =
    externalRuntimeConfigStore ??
    (db ? new RuntimeConfigStore(db, logger) : createFallbackRuntimeConfigStore());
  const managedSessionStore = db
    ? new ManagedSessionStore(db, logger)
    : createFallbackManagedSessionStore();
  const handoffStore = db ? new HandoffStore(db, logger) : createFallbackHandoffStore();
  const runHandoffDecisionStore = db
    ? new RunHandoffDecisionStore(db, logger)
    : createFallbackRunHandoffDecisionStore();

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
  const rateLimitMax = Number(process.env.RATE_LIMIT_MAX) || 100;
  const rateLimitWindow = process.env.RATE_LIMIT_WINDOW || '1 minute';
  await app.register(fastifyRateLimit, {
    max: rateLimitMax,
    timeWindow: rateLimitWindow,
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
        { name: 'memory', description: 'Unified memory search and storage' },
        { name: 'router', description: 'LiteLLM model routing' },
        { name: 'runtime-config', description: 'Managed Claude/Codex configuration sync state' },
        { name: 'runtime-sessions', description: 'Unified Claude/Codex managed session lifecycle' },
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

  // --- JSON body parser that tolerates empty bodies ---
  // By default Fastify rejects requests with Content-Type: application/json but
  // no body.  Many HTTP clients (browsers, Playwright, curl) set this header on
  // POST/DELETE even when there is no payload. We override the built-in parser
  // to treat an empty body as `{}` so these requests succeed.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const str = (body as string) ?? '';
      done(null, str.length > 0 ? JSON.parse(str) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
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
  await app.register(runHandoffRoutes, {
    prefix: '/api/runs',
    runHandoffDecisionStore,
  });
  await app.register(runtimeConfigRoutes, {
    prefix: '/api/runtime-config',
    runtimeConfigStore,
    dbRegistry,
    workerPort,
  });
  await app.register(runtimeSessionRoutes, {
    prefix: '/api/runtime-sessions',
    managedSessionStore,
    runtimeConfigStore,
    runHandoffDecisionStore,
    dbRegistry,
    workerPort,
  });
  await app.register(handoffRoutes, {
    prefix: '/api/runtime-sessions',
    managedSessionStore,
    handoffStore,
    runtimeConfigStore,
    dbRegistry,
    workerPort,
  });
  await app.register(manualTakeoverRoutes, {
    prefix: '/api/runtime-sessions',
    managedSessionStore,
    dbRegistry,
    workerPort,
  });
  await app.register(agentRoutes, {
    prefix: '/api/agents',
    taskQueue,
    repeatableJobs,
    registry,
    dbRegistry,
    memoryInjector,
    dispatchVerificationConfig,
    workerPort,
  });

  // MCP template library + discovery proxy
  await app.register(mcpTemplateRoutes, {
    prefix: '/api/mcp',
    registry,
    dbRegistry,
    workerPort,
  });

  // Register the run reaper to clean up stale "running" runs.
  if (db) {
    registerRunReaper(app, db);
  }
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
    await app.register(runSummaryRoutes, {
      prefix: '/api/runs',
      dbRegistry,
    });

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

  if (memorySearch && memoryStore) {
    await app.register(memoryFactRoutes, {
      prefix: '/api/memory/facts',
      memorySearch,
      memoryStore,
    });
    await app.register(memoryEdgeRoutes, {
      prefix: '/api/memory/edges',
      memoryStore,
    });
    await app.register(memoryGraphRoutes, {
      prefix: '/api/memory/graph',
      memoryStore,
    });
    await app.register(memoryStatsRoutes, {
      prefix: '/api/memory/stats',
      memoryStore,
    });
    await app.register(memoryScopeRoutes, {
      prefix: '/api/memory/scopes',
      memoryStore,
    });
    await app.register(memoryRoutes, {
      prefix: '/api/memory',
      memorySearch,
      memoryStore,
    });
  } else if (mem0Client) {
    await app.register(memoryRoutes, {
      prefix: '/api/memory',
      mem0Client,
    });
  }

  // Register knowledge synthesis route when a raw pg pool is available.
  if (pgPool) {
    await app.register(memorySynthesisRoutes, {
      prefix: '/api/memory/synthesis',
      pool: pgPool,
      logger,
    });

    await app.register(memoryConsolidationRoutes, {
      prefix: '/api/memory/consolidation',
      pool: pgPool,
      logger,
    });

    await app.register(memoryReportsRoutes, {
      prefix: '/api/memory/reports',
      pool: pgPool,
      logger,
    });

    await app.register(memoryDecayRoutes, {
      prefix: '/api/memory/decay',
      pool: pgPool,
      logger,
    });
  }

  // Register memory import routes (in-memory job tracking, no DB required).
  await app.register(memoryImportRoutes, { prefix: '/api/memory' });

  // Register claude-mem routes for querying the local claude-mem SQLite database.
  await app.register(claudeMemRoutes, {
    prefix: '/api/claude-mem',
  });

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
      encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY ?? '',
    });
  }

  // Register file browsing proxy routes when dbRegistry is available.
  if (dbRegistry) {
    await app.register(fileProxyRoutes, {
      prefix: '/api/machines',
      dbRegistry,
      workerPort,
    });
  }

  // Register git status proxy routes when dbRegistry is available.
  if (dbRegistry) {
    await app.register(gitProxyRoutes, {
      prefix: '/api/machines',
      dbRegistry,
      workerPort,
    });
  }

  // Register terminal proxy routes when dbRegistry is available.
  if (dbRegistry) {
    await app.register(terminalProxyRoutes, {
      prefix: '/api/machines',
      dbRegistry,
      workerPort,
      logger,
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

  // Register collaboration space routes when db is available.
  if (db) {
    const spaceStore = new SpaceStore(db, logger);
    const threadStore = new ThreadStore(db, logger);
    const eventStore = new EventStore(db, logger);
    await app.register(spaceRoutes, {
      prefix: '/api/spaces',
      spaceStore,
      threadStore,
      eventStore,
    });

    // Task Graph + Fleet routes (§10.3)
    const taskGraphStore = new TaskGraphStore(db, logger);
    const taskRunStore = new TaskRunStore(db, logger);
    const workerNodeStore = new WorkerNodeStore(db, logger);
    const workerLeaseStore = new WorkerLeaseStore(db, logger);

    await app.register(taskGraphRoutes, {
      prefix: '/api/task-graphs',
      taskGraphStore,
      taskRunStore,
    });

    await app.register(taskRunRoutes, {
      prefix: '/api/task-runs',
      taskRunStore,
      workerLeaseStore,
    });

    await app.register(workerNodeRoutes, {
      prefix: '/api/fleet/nodes',
      workerNodeStore,
      taskRunStore,
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

      await app.register(oauthRoutes, {
        prefix: '/api/oauth',
        db,
        encryptionKey,
      });
    } else {
      logger.warn(
        'CREDENTIAL_ENCRYPTION_KEY is not set — account management routes are disabled. ' +
          "Generate a key with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }

    await app.register(settingsRoutes, {
      prefix: '/api/settings',
      db,
    });
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

function createFallbackRuntimeConfigStore(): RuntimeConfigRouteStore {
  const stateMap = new Map<string, MachineRuntimeStateRecord>();

  return {
    async getLatestRevision() {
      return null;
    },
    async saveRevision(config) {
      return {
        id: 'ephemeral-default',
        version: config.version,
        hash: config.hash,
        config,
        createdAt: new Date(),
      };
    },
    async listMachineStates(machineId) {
      const all = [...stateMap.values()];
      return machineId ? all.filter((s) => s.machineId === machineId) : all;
    },
    async upsertMachineState(input) {
      const key = `${input.machineId}:${input.runtime}`;
      const now = new Date();
      const record: MachineRuntimeStateRecord = {
        id: key,
        machineId: input.machineId,
        runtime: input.runtime,
        isInstalled: input.isInstalled,
        isAuthenticated: input.isAuthenticated,
        syncStatus: input.syncStatus,
        configVersion: input.configVersion,
        configHash: input.configHash,
        metadata: input.metadata,
        lastConfigAppliedAt: input.lastConfigAppliedAt ?? null,
        createdAt: stateMap.get(key)?.createdAt ?? now,
        updatedAt: now,
      };
      stateMap.set(key, record);
      return record;
    },
  };
}

function createFallbackManagedSessionStore(): Pick<
  ManagedSessionStore,
  'list' | 'create' | 'get' | 'updateStatus' | 'patchMetadata'
> {
  const sessions = new Map<string, ManagedSessionRecord>();
  return {
    async list() {
      return [...sessions.values()];
    },
    async create(input) {
      const session: ManagedSessionRecord = {
        id: crypto.randomUUID(),
        runtime: input.runtime,
        nativeSessionId: input.nativeSessionId,
        machineId: input.machineId,
        agentId: input.agentId,
        projectPath: input.projectPath,
        worktreePath: input.worktreePath,
        status: input.status,
        configRevision: input.configRevision,
        handoffStrategy: input.handoffStrategy,
        handoffSourceSessionId: input.handoffSourceSessionId,
        metadata: input.metadata,
        startedAt: input.startedAt ?? new Date(),
        lastHeartbeat: input.lastHeartbeat ?? null,
        endedAt: input.endedAt ?? null,
      };
      sessions.set(session.id, session);
      return session;
    },
    async get(id) {
      return sessions.get(id) ?? null;
    },
    async updateStatus(id, status, patch = {}) {
      const existing = sessions.get(id);
      if (!existing) {
        throw new Error(`Managed session '${id}' not found`);
      }
      const updated: ManagedSessionRecord = {
        ...existing,
        status,
        nativeSessionId: patch.nativeSessionId ?? existing.nativeSessionId,
        handoffStrategy: patch.handoffStrategy ?? existing.handoffStrategy,
        metadata: patch.metadata ?? existing.metadata,
        lastHeartbeat: patch.lastHeartbeat ?? existing.lastHeartbeat,
        endedAt: patch.endedAt ?? existing.endedAt,
      };
      sessions.set(id, updated);
      return updated;
    },
    async patchMetadata(id, metadataPatch) {
      const existing = sessions.get(id);
      if (!existing) {
        throw new Error(`Managed session '${id}' not found`);
      }

      const updated: ManagedSessionRecord = {
        ...existing,
        metadata: {
          ...existing.metadata,
          ...metadataPatch,
        },
      };
      sessions.set(id, updated);
      return updated;
    },
  };
}

function createFallbackHandoffStore(): Pick<
  HandoffStore,
  'create' | 'listForSession' | 'recordNativeImportAttempt' | 'summarizeRecent'
> {
  const handoffs = new Map<string, SessionHandoffRecord>();
  const nativeImportAttempts = new Map<
    string,
    { handoffId: string | null; status: 'pending' | 'succeeded' | 'failed' }
  >();
  return {
    async create(input) {
      const record: SessionHandoffRecord = {
        id: crypto.randomUUID(),
        sourceSessionId: input.sourceSessionId,
        targetSessionId: input.targetSessionId,
        sourceRuntime: input.sourceRuntime,
        targetRuntime: input.targetRuntime,
        reason: input.reason,
        strategy: input.strategy,
        status: input.status,
        snapshot: input.snapshot,
        errorMessage: input.errorMessage,
        createdAt: input.createdAt ?? new Date(),
        completedAt: input.completedAt ?? null,
      };
      handoffs.set(record.id, record);
      return record;
    },
    async listForSession(sessionId, limit = 20) {
      return [...handoffs.values()]
        .filter(
          (record) => record.sourceSessionId === sessionId || record.targetSessionId === sessionId,
        )
        .slice(0, limit);
    },
    async recordNativeImportAttempt(input) {
      const record = {
        id: crypto.randomUUID(),
        handoffId: input.handoffId,
        sourceSessionId: input.sourceSessionId,
        targetSessionId: input.targetSessionId,
        sourceRuntime: input.sourceRuntime,
        targetRuntime: input.targetRuntime,
        status: input.status,
        metadata: input.metadata,
        errorMessage: input.errorMessage,
        attemptedAt: input.attemptedAt ?? new Date(),
      };
      nativeImportAttempts.set(record.id, {
        handoffId: record.handoffId,
        status: record.status,
      });
      return record;
    },
    async summarizeRecent(limit = 100) {
      const recentHandoffs = [...handoffs.values()].slice(0, limit);
      return summarizeHandoffAnalytics(
        recentHandoffs.map((handoff) => {
          const attempt = [...nativeImportAttempts.values()].find(
            (entry) => entry.handoffId === handoff.id,
          );
          return {
            status: handoff.status,
            nativeImportAttempt: attempt ? { ok: attempt.status === 'succeeded' } : undefined,
          };
        }),
      );
    },
  };
}

function createFallbackRunHandoffDecisionStore(): Pick<
  RunHandoffDecisionStore,
  'create' | 'listForRun'
> {
  const decisions = new Map<string, Awaited<ReturnType<RunHandoffDecisionStore['create']>>>();

  return {
    async create(input: CreateRunHandoffDecisionInput) {
      const createdAt = input.createdAt ?? new Date();
      const updatedAt = input.updatedAt ?? createdAt;
      const record = {
        ...input,
        id: crypto.randomUUID(),
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      };
      decisions.set(record.id, record);
      return record;
    },
    async listForRun(runId, limit = 50) {
      return [...decisions.values()]
        .filter((decision) => decision.sourceRunId === runId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
    },
  };
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
