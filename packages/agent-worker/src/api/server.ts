import type { DependencyStatus, DispatchVerificationConfig } from '@agentctl/shared';
import { AgentError, checkWithTimeout, WorkerError } from '@agentctl/shared';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

import type { AgentPool } from '../runtime/agent-pool.js';
import { ClaudeRuntimeAdapter } from '../runtime/claude-runtime-adapter.js';
import type { CliSessionManager } from '../runtime/cli-session-manager.js';
import { CodexRuntimeAdapter } from '../runtime/codex-runtime-adapter.js';
import { CodexSessionManager } from '../runtime/codex-session-manager.js';
import { RuntimeConfigApplier } from '../runtime/config/runtime-config-applier.js';
import { ExecutionEnvironmentRegistry } from '../runtime/execution-environment-registry.js';
import { HandoffController } from '../runtime/handoff-controller.js';
import { RcSessionManager } from '../runtime/rc-session-manager.js';
import { RuntimeRegistry } from '../runtime/runtime-registry.js';
import { TerminalManager } from '../runtime/terminal-manager.js';
import { HEALTH_CHECK_TIMEOUT_MS } from './constants.js';
import { agentRoutes } from './routes/agents.js';
import { configPreviewRoutes } from './routes/config-preview.js';
import { emergencyStopRoutes } from './routes/emergency-stop.js';
import { fileRoutes } from './routes/files.js';
import { gitRoutes } from './routes/git.js';
import { getActiveLoops, loopRoutes } from './routes/loop.js';
import { manualTakeoverRoutes } from './routes/manual-takeover.js';
import { mcpDiscoverRoutes } from './routes/mcp-discover.js';
import { memoryFeedbackRoutes } from './routes/memory-feedback.js';
import { memoryPromoteRoutes } from './routes/memory-promote.js';
import { memoryRecallRoutes } from './routes/memory-recall.js';
import { memoryReportRoutes } from './routes/memory-report.js';
import { memorySearchRoutes } from './routes/memory-search.js';
import { memoryStoreRoutes } from './routes/memory-store-route.js';
import { workerMetricsRoutes } from './routes/metrics.js';
import { runtimeConfigRoutes } from './routes/runtime-config.js';
import { runtimeSessionsRoutes } from './routes/runtime-sessions.js';
import { sessionRoutes } from './routes/sessions.js';
import { skillDiscoverRoutes } from './routes/skill-discover.js';
import { streamRoutes } from './routes/stream.js';
import { terminalRoutes } from './routes/terminal.js';

type CreateWorkerServerOptions = {
  logger: Logger;
  agentPool: AgentPool;
  machineId: string;
  controlPlaneUrl?: string;
  sessionManager?: CliSessionManager;
  rcSessionManager?: RcSessionManager;
  maxTerminals?: number;
  runtimeConfigApplier?: RuntimeConfigApplier;
  runtimeRegistry?: RuntimeRegistry;
  executionEnvironmentRegistry?: ExecutionEnvironmentRegistry;
  getDispatchVerificationConfig?: () => DispatchVerificationConfig | null;
};

export async function createWorkerServer({
  logger,
  agentPool,
  machineId,
  controlPlaneUrl,
  sessionManager,
  rcSessionManager,
  maxTerminals,
  runtimeConfigApplier = new RuntimeConfigApplier(),
  runtimeRegistry: externalRuntimeRegistry,
  executionEnvironmentRegistry: externalExecutionEnvironmentRegistry,
  getDispatchVerificationConfig,
}: CreateWorkerServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const runtimeRegistry = externalRuntimeRegistry ?? buildRuntimeRegistry(sessionManager);
  const executionEnvironmentRegistry =
    externalExecutionEnvironmentRegistry ?? new ExecutionEnvironmentRegistry();
  const handoffController = new HandoffController({
    machineId,
    logger,
    runtimeRegistry,
  });
  const manualTakeoverManager =
    rcSessionManager ??
    new RcSessionManager({
      logger,
      machineId,
    });

  // Register @fastify/websocket before any WebSocket route plugins.
  await app.register(fastifyWebsocket);

  // Instantiate the terminal PTY manager for remote shell access.
  const terminalManager = new TerminalManager({ logger, maxTerminals });

  app.addHook('onRequest', async (request) => {
    logger.debug({ method: request.method, url: request.url }, 'incoming request');
  });

  app.get<{ Querystring: { detail?: string } }>('/health', async (request) => {
    const detail = request.query.detail === 'true';
    const timestamp = new Date().toISOString();

    const mem = process.memoryUsage();
    const toMb = (bytes: number): number => Math.round((bytes / 1_048_576) * 100) / 100;
    const memoryUsage = {
      rss: toMb(mem.rss),
      heapUsed: toMb(mem.heapUsed),
      heapTotal: toMb(mem.heapTotal),
    };

    // Run dependency checks in parallel.
    const [controlPlaneResult, executionEnvironmentResult] = await Promise.allSettled([
      controlPlaneUrl
        ? checkWithTimeout(
            'controlPlane',
            async () => {
              const response = await fetch(`${controlPlaneUrl}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
              });
              if (!response.ok) {
                throw new WorkerError(
                  'HEALTH_CHECK_FAILED',
                  `Control plane returned HTTP ${response.status}`,
                  { httpStatus: response.status },
                );
              }
            },
            HEALTH_CHECK_TIMEOUT_MS,
          )
        : Promise.resolve({ status: 'ok' as const, latencyMs: 0 }),
      executionEnvironmentRegistry.detectAll(),
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

    const base = {
      status,
      timestamp,
      uptime: process.uptime(),
      nodeVersion: process.version,
      activeAgents: agentPool.getRunningCount(),
      activeSessions: sessionManager?.getActiveSessionCount() ?? 0,
      totalAgentsStarted: agentPool.getTotalAgentsStarted(),
      worktreesActive: agentPool.getWorktreeCount(),
      memoryUsage,
      agents: {
        running: agentPool.getRunningCount(),
        total: agentPool.size,
        maxConcurrent: agentPool.getMaxConcurrent(),
      },
    };

    if (!detail) {
      return base;
    }

    return {
      ...base,
      dependencies: {
        controlPlane: cpStatus,
      },
      executionEnvironments:
        executionEnvironmentResult.status === 'fulfilled' ? executionEnvironmentResult.value : [],
    };
  });

  await app.register(agentRoutes, {
    prefix: '/api/agents',
    pool: agentPool,
    machineId,
    logger,
    getDispatchVerificationConfig,
  });

  await app.register(loopRoutes, {
    prefix: '/api/agents',
    pool: agentPool,
    machineId,
    logger,
  });

  await app.register(emergencyStopRoutes, {
    prefix: '/api/agents',
    pool: agentPool,
    machineId,
    logger,
    getActiveLoops,
  });

  await app.register(streamRoutes, {
    prefix: '/api/agents',
    agentPool,
  });

  await app.register(workerMetricsRoutes, {
    agentPool,
  });

  await app.register(runtimeConfigRoutes, {
    prefix: '/api/runtime-config',
    machineId,
    runtimeConfigApplier,
    logger,
  });

  await app.register(configPreviewRoutes, {
    prefix: '/api/config',
    logger,
  });

  await app.register(runtimeSessionsRoutes, {
    prefix: '/api/runtime-sessions',
    machineId,
    runtimeRegistry,
    handoffController,
    logger,
  });

  await app.register(manualTakeoverRoutes, {
    prefix: '/api/runtime-sessions',
    logger,
    rcSessionManager: manualTakeoverManager,
  });

  await app.register(fileRoutes, {
    prefix: '/api/files',
    logger,
  });

  await app.register(gitRoutes, {
    prefix: '/api/git',
    logger,
  });

  await app.register(terminalRoutes, {
    prefix: '/api/terminal',
    terminalManager,
    logger,
  });

  if (sessionManager) {
    await app.register(sessionRoutes, {
      prefix: '/api/sessions',
      sessionManager,
      machineId,
      logger,
      controlPlaneUrl,
    });
  }

  await app.register(mcpDiscoverRoutes, {
    prefix: '/api/mcp',
    logger,
  });

  await app.register(skillDiscoverRoutes, {
    prefix: '/api/skills',
    logger,
  });

  if (controlPlaneUrl) {
    await app.register(memoryFeedbackRoutes, {
      prefix: '/api/mcp',
      controlPlaneUrl,
      logger,
    });
    await app.register(memorySearchRoutes, {
      prefix: '/api/mcp',
      controlPlaneUrl,
      logger,
    });
    await app.register(memoryStoreRoutes, {
      prefix: '/api/mcp',
      controlPlaneUrl,
      logger,
    });
    await app.register(memoryRecallRoutes, {
      prefix: '/api/mcp',
      controlPlaneUrl,
      logger,
    });
    await app.register(memoryReportRoutes, {
      prefix: '/api/mcp',
      controlPlaneUrl,
      logger,
    });
    await app.register(memoryPromoteRoutes, {
      prefix: '/api/mcp',
      controlPlaneUrl,
      logger,
    });
  }

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

  // --- Graceful shutdown: kill all terminals ---
  app.addHook('onClose', async () => {
    await manualTakeoverManager.stopAll();
    terminalManager.killAll();
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
  if (code.endsWith('_UNAVAILABLE') || code.endsWith('_OFFLINE') || code.endsWith('_UNREACHABLE')) {
    return 503;
  }
  if (code.startsWith('INVALID_')) {
    return 400;
  }
  if (code === 'TERMINAL_LIMIT_REACHED') {
    return 429;
  }
  if (code === 'TERMINAL_ALREADY_EXISTS') {
    return 409;
  }
  return 500;
}

function buildRuntimeRegistry(sessionManager?: CliSessionManager): RuntimeRegistry {
  const registry = new RuntimeRegistry();
  if (sessionManager) {
    registry.register(new ClaudeRuntimeAdapter(sessionManager));
  }
  registry.register(new CodexRuntimeAdapter(new CodexSessionManager()));
  return registry;
}
