import os from 'node:os';
import { join } from 'node:path';

import type { AgentConfig, EnvVar } from '@agentctl/shared';
import { AgentError, isNumericString, isValidLogLevel, validateEnv } from '@agentctl/shared';

import { createWorkerServer } from './api/server.js';
import { HealthReporter } from './health-reporter.js';
import { AuditReporter } from './hooks/audit-reporter.js';
import type { IpcMessage, IpcResponse } from './ipc/index.js';
import { createIpcResponse, IpcServer } from './ipc/index.js';
import { createLogger } from './logger.js';
import { CliSessionManager } from './runtime/cli-session-manager.js';
import { AgentPool } from './runtime/index.js';
import { WorktreeManager } from './worktree/index.js';

// ── Environment validation ────────────────────────────────────────────
const AGENT_WORKER_ENV: EnvVar[] = [
  {
    name: 'WORKER_PORT',
    default: '9000',
    validate: isNumericString,
    description: 'Worker API port for agent management HTTP endpoints',
  },
  {
    name: 'WORKER_HOST',
    default: '0.0.0.0',
    description: 'Bind address for the worker server',
  },
  {
    name: 'CONTROL_URL',
    description: 'Control plane URL for health and audit reporting',
  },
  {
    name: 'MACHINE_ID',
    default: `machine-${os.hostname()}`,
    description: 'Unique machine identifier (must be different on each machine)',
  },
  {
    name: 'PROJECT_PATH',
    description: 'Root project path for git worktree isolation',
  },
  {
    name: 'LOG_LEVEL',
    default: 'info',
    validate: isValidLogLevel,
    description: 'Log level (fatal, error, warn, info, debug, trace, silent)',
  },
  {
    name: 'MAX_CONCURRENT_AGENTS',
    default: '3',
    validate: isNumericString,
    description: 'Maximum number of agents that can run concurrently in the pool',
  },
  {
    name: 'AUDIT_LOG_DIR',
    default: '.agentctl/audit',
    description: 'Directory for NDJSON audit log files',
  },
  {
    name: 'IPC_DIR',
    default: '.agentctl/ipc',
    description: 'Directory for filesystem-based IPC message exchange',
  },
  {
    name: 'RUN_ID',
    default: '',
    description: 'Worker-level run ID for audit reporting (empty disables audit reporter)',
  },
  {
    name: 'AUDIT_FLUSH_INTERVAL_MS',
    default: '5000',
    validate: isNumericString,
    description: 'Interval in milliseconds between audit log flushes to the control plane',
  },
];

const logger = createLogger('agent-worker');
const env = validateEnv(AGENT_WORKER_ENV, logger);

const PORT = Number(env.WORKER_PORT);
const HOST = env.WORKER_HOST as string;
const CONTROL_PLANE_URL = env.CONTROL_URL || 'http://localhost:8080';
const MACHINE_ID = env.MACHINE_ID as string;
const MAX_CONCURRENT_AGENTS = Number(env.MAX_CONCURRENT_AGENTS) || 3;
const AUDIT_LOG_DIR = env.AUDIT_LOG_DIR || '.agentctl/audit';
const IPC_DIR = env.IPC_DIR || '.agentctl/ipc';
const RUN_ID = env.RUN_ID || '';
const AUDIT_FLUSH_INTERVAL_MS = Number(env.AUDIT_FLUSH_INTERVAL_MS) || 5_000;
const PROJECT_PATH = env.PROJECT_PATH || '';
const HEALTH_REPORTER_INTERVAL_MS = 15_000;

/**
 * Dispatch an incoming IPC message to the correct pool operation based
 * on `message.type`.
 *
 * Supported commands:
 *   - `start_agent`  — create an agent in the pool and start it
 *   - `stop_agent`   — stop a running agent
 *   - `list_agents`  — return summaries of every agent in the pool
 *   - `agent_status` — return full JSON snapshot of one agent
 */
function createIpcHandler(pool: AgentPool): (msg: IpcMessage) => Promise<IpcResponse> {
  return async (msg: IpcMessage): Promise<IpcResponse> => {
    switch (msg.type) {
      case 'start_agent': {
        const agentId = msg.payload.agentId as string | undefined;
        const prompt = msg.payload.prompt as string | undefined;
        const projectPath = msg.payload.projectPath as string | undefined;
        const config = (msg.payload.config as AgentConfig) ?? {};

        if (!agentId || !prompt || !projectPath) {
          return createIpcResponse(msg.id, 'error', {
            code: 'INVALID_PAYLOAD',
            message: 'start_agent requires "agentId", "prompt", and "projectPath" in the payload',
          });
        }

        try {
          const instance = await pool.createAgent({
            agentId,
            machineId: MACHINE_ID,
            config,
            projectPath,
            logger,
          });

          // Start is intentionally not awaited so the IPC response is
          // returned immediately. The agent runs in the background.
          void instance.start(prompt);

          return createIpcResponse(msg.id, 'ok', {
            agentId,
            status: instance.getStatus(),
          });
        } catch (err) {
          return createIpcResponse(msg.id, 'error', {
            code: err instanceof AgentError ? err.code : 'START_FAILED',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      case 'stop_agent': {
        const agentId = msg.payload.agentId as string | undefined;
        const graceful = (msg.payload.graceful as boolean) ?? true;

        if (!agentId) {
          return createIpcResponse(msg.id, 'error', {
            code: 'INVALID_PAYLOAD',
            message: 'stop_agent requires "agentId" in the payload',
          });
        }

        try {
          await pool.stopAgent(agentId, graceful);
          return createIpcResponse(msg.id, 'ok', { agentId, stopped: true });
        } catch (err) {
          return createIpcResponse(msg.id, 'error', {
            code: err instanceof AgentError ? err.code : 'STOP_FAILED',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      case 'list_agents': {
        const agents = pool.listAgents();
        return createIpcResponse(msg.id, 'ok', {
          agents: agents.map((a) => ({ ...a })),
        });
      }

      case 'agent_status': {
        const agentId = msg.payload.agentId as string | undefined;

        if (!agentId) {
          return createIpcResponse(msg.id, 'error', {
            code: 'INVALID_PAYLOAD',
            message: 'agent_status requires "agentId" in the payload',
          });
        }

        const instance = pool.getAgent(agentId);

        if (!instance) {
          return createIpcResponse(msg.id, 'error', {
            code: 'AGENT_NOT_FOUND',
            message: `Agent '${agentId}' not found in the pool`,
          });
        }

        return createIpcResponse(msg.id, 'ok', instance.toJSON());
      }

      default:
        return createIpcResponse(msg.id, 'error', {
          code: 'UNKNOWN_COMMAND',
          message: `Unknown IPC command type: '${msg.type}'`,
        });
    }
  };
}

async function main(): Promise<void> {
  // Create a WorktreeManager if a project path is configured.
  // When PROJECT_PATH is empty or unset, agents will run without worktree isolation.
  const worktreeManager = PROJECT_PATH
    ? new WorktreeManager({
        projectPath: PROJECT_PATH,
        logger: logger.child({ component: 'worktree-manager' }),
      })
    : undefined;

  if (worktreeManager) {
    logger.info({ projectPath: PROJECT_PATH }, 'WorktreeManager enabled for agent isolation');
  } else {
    logger.info('No PROJECT_PATH set, agents will run without worktree isolation');
  }

  const pool = new AgentPool({
    maxConcurrent: MAX_CONCURRENT_AGENTS,
    auditLogDir: AUDIT_LOG_DIR,
    logger,
    worktreeManager,
  });

  // Clean up orphaned worktrees from a previous crash or ungraceful shutdown
  // before we start accepting new work.
  try {
    await pool.cleanOrphanedWorktrees();
  } catch (err: unknown) {
    logger.warn({ err }, 'Failed to clean orphaned worktrees at startup');
  }

  const ipcServer = new IpcServer({
    ipcDir: IPC_DIR,
    agentId: MACHINE_ID,
    logger: logger.child({ component: 'ipc-server' }),
  });

  ipcServer.onMessage(createIpcHandler(pool));

  const sessionManager = new CliSessionManager({
    maxConcurrentSessions: MAX_CONCURRENT_AGENTS * 2,
    logger: logger.child({ component: 'cli-session-manager' }),
  });

  const healthReporter = new HealthReporter({
    machineId: MACHINE_ID,
    controlPlaneUrl: CONTROL_PLANE_URL,
    intervalMs: HEALTH_REPORTER_INTERVAL_MS,
    logger,
    agentPool: pool,
  });

  const server = await createWorkerServer({
    logger,
    agentPool: pool,
    machineId: MACHINE_ID,
    controlPlaneUrl: CONTROL_PLANE_URL,
    sessionManager,
    getDispatchVerificationConfig: () => healthReporter.getDispatchVerificationConfig(),
  });

  await healthReporter.register();
  healthReporter.start();

  // Start audit reporter only when a RUN_ID is provided (indicates an active run).
  // RUN_ID is a worker-level singleton env var — it applies to the whole worker process.
  // For per-agent run IDs (dispatched by the control plane via task-worker), the runId
  // is passed per-request in the StartAgentBody and stored on each AgentInstance.
  // A future enhancement can start per-agent AuditReporters using instance.runId instead.
  const todayDate = new Date().toISOString().slice(0, 10);
  const auditFilePath = join(AUDIT_LOG_DIR, `audit-${todayDate}.ndjson`);

  const auditReporter = RUN_ID
    ? new AuditReporter({
        controlPlaneUrl: CONTROL_PLANE_URL,
        runId: RUN_ID,
        auditFilePath,
        logger,
        flushIntervalMs: AUDIT_FLUSH_INTERVAL_MS,
      })
    : null;

  if (auditReporter) {
    auditReporter.start();
  }

  await server.listen({ port: PORT, host: HOST });

  await ipcServer.start();

  logger.info(
    {
      port: PORT,
      machineId: MACHINE_ID,
      controlPlaneUrl: CONTROL_PLANE_URL,
      maxConcurrentAgents: MAX_CONCURRENT_AGENTS,
      ipcDir: IPC_DIR,
    },
    'Agent worker started — verify MACHINE_ID matches DB and CONTROL_URL is reachable',
  );

  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info('Shutting down agent worker...');

    try {
      await sessionManager.stopAll();
    } catch (err: unknown) {
      logger.error({ err }, 'Error stopping CLI sessions');
    }

    try {
      await pool.stopAll();
    } catch (err: unknown) {
      logger.error({ err }, 'Error stopping agent pool');
    }

    try {
      if (auditReporter) {
        await auditReporter.stop();
      }
    } catch (err: unknown) {
      logger.error({ err }, 'Error stopping audit reporter');
    }

    try {
      healthReporter.stop();
    } catch (err: unknown) {
      logger.error({ err }, 'Error stopping health reporter');
    }

    try {
      ipcServer.stop();
    } catch (err: unknown) {
      logger.error({ err }, 'Error stopping IPC server');
    }

    try {
      await server.close();
    } catch (err: unknown) {
      logger.error({ err }, 'Error closing Fastify server');
    }

    logger.info('Agent worker shut down cleanly');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start agent worker');
  process.exit(1);
});
