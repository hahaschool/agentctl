import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EnvVar } from '@agentctl/shared';
import { isNumericString, isValidLogLevel, validateEnv } from '@agentctl/shared';
import { sql } from 'drizzle-orm';
import IORedis from 'ioredis';

import { createServer } from './api/server.js';
import type { Database } from './db/index.js';
import { createDb } from './db/index.js';
import { createLogger } from './logger.js';
import { Mem0Client } from './memory/mem0-client.js';
import { MemoryInjector } from './memory/memory-injector.js';
import { DbAgentRegistry } from './registry/db-registry.js';
import { LiteLLMClient } from './router/litellm-client.js';
import { MachineCircuitBreaker } from './scheduler/circuit-breaker.js';
import { createRepeatableJobManager } from './scheduler/repeatable-jobs.js';
import { createTaskQueue } from './scheduler/task-queue.js';
import { createTaskWorker } from './scheduler/task-worker.js';

// ── Environment validation ────────────────────────────────────────────
const CONTROL_PLANE_ENV: EnvVar[] = [
  {
    name: 'PORT',
    default: '8080',
    validate: isNumericString,
    description: 'Server port for the control plane API',
  },
  {
    name: 'HOST',
    default: '0.0.0.0',
    description: 'Bind address for the control plane server',
  },
  {
    name: 'REDIS_URL',
    required: true,
    description: 'Redis connection URL (required by BullMQ task queue)',
  },
  {
    name: 'DATABASE_URL',
    description: 'PostgreSQL connection string (omit to use in-memory registry)',
  },
  {
    name: 'MEM0_URL',
    description: 'Mem0 server URL for cross-device memory',
  },
  {
    name: 'LITELLM_URL',
    description: 'LiteLLM proxy URL for multi-provider LLM routing',
  },
  {
    name: 'LOG_LEVEL',
    default: 'info',
    validate: isValidLogLevel,
    description: 'Log level (fatal, error, warn, info, debug, trace, silent)',
  },
  {
    name: 'CONTROL_PLANE_URL',
    description: 'Public URL of the control plane (used by workers for callbacks)',
  },
  {
    name: 'WORKER_CONCURRENCY',
    default: '5',
    validate: isNumericString,
    description: 'Number of concurrent BullMQ task worker jobs',
  },
  {
    name: 'SKIP_MIGRATIONS',
    default: 'false',
    description: 'Set to "true" to skip auto-migration on startup',
  },
];

const logger = createLogger('control-plane');
const env = validateEnv(CONTROL_PLANE_ENV, logger);

const PORT = Number(env.PORT);
const HOST = env.HOST as string;
const REDIS_URL = env.REDIS_URL as string;
const DATABASE_URL = env.DATABASE_URL || '';
const MEM0_URL = env.MEM0_URL || '';
const LITELLM_URL = env.LITELLM_URL || '';
const CONTROL_PLANE_URL = env.CONTROL_PLANE_URL || `http://${HOST}:${PORT}`;
const WORKER_CONCURRENCY = Number(env.WORKER_CONCURRENCY) || 5;

type DependencyHealthDeps = {
  db?: Database;
  redisConnection?: InstanceType<typeof IORedis.default>;
  mem0Client?: Mem0Client;
  litellmClient?: LiteLLMClient;
};

async function checkDependencyHealth(deps: DependencyHealthDeps): Promise<void> {
  const healthLogger = logger.child({ component: 'health-check' });

  // PostgreSQL
  if (deps.db) {
    try {
      await deps.db.execute(sql`SELECT 1`);
      healthLogger.info('PostgreSQL connection verified');
    } catch (err: unknown) {
      healthLogger.warn({ err }, 'PostgreSQL connection failed');
    }
  }

  // Redis
  if (deps.redisConnection) {
    try {
      await deps.redisConnection.ping();
      healthLogger.info('Redis connection verified');
    } catch (err: unknown) {
      healthLogger.warn({ err }, 'Redis connection failed');
    }
  }

  // Mem0
  if (deps.mem0Client) {
    try {
      const healthy = await deps.mem0Client.health();
      if (healthy) {
        healthLogger.info('Mem0 connection verified');
      } else {
        healthLogger.warn('Mem0 connection unreachable: health endpoint returned non-OK');
      }
    } catch (err: unknown) {
      healthLogger.warn({ err }, 'Mem0 connection unreachable');
    }
  }

  // LiteLLM
  if (deps.litellmClient) {
    try {
      const models = await deps.litellmClient.listModels();
      healthLogger.info(
        { modelCount: models.length },
        `LiteLLM proxy verified (${models.length} models available)`,
      );
    } catch (err: unknown) {
      healthLogger.warn({ err }, 'LiteLLM proxy unreachable');
    }
  }
}

async function main(): Promise<void> {
  const redisConnection = new IORedis.default(REDIS_URL, {
    maxRetriesPerRequest: null,
    connectTimeout: 10_000,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5_000);
      return delay;
    },
    lazyConnect: false,
  });

  logger.info({ redisUrl: REDIS_URL }, 'Connecting to Redis');

  // Optionally connect to PostgreSQL when DATABASE_URL is provided.
  let db: Database | undefined;
  let dbRegistry: DbAgentRegistry | undefined;

  if (DATABASE_URL) {
    logger.info('Connecting to PostgreSQL');
    db = createDb(DATABASE_URL);

    const skipMigrations = env.SKIP_MIGRATIONS === 'true';

    if (skipMigrations) {
      logger.info(
        'SKIP_MIGRATIONS=true — skipping auto-migration (assuming migrations are run separately)',
      );
    } else {
      // Run the initial schema migration on every startup.
      // All DDL statements use CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS,
      // so this is idempotent and safe to execute against an already-migrated database.
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const MIGRATION_FILE = '0000_initial_schema.sql';

      // Candidate paths in priority order:
      //   1. dist/drizzle/ — production builds (postbuild copies drizzle/ into dist/)
      //   2. ../drizzle/   — dev mode (tsx runs from src/, package root is one level up)
      const candidatePaths = [
        join(__dirname, 'drizzle', MIGRATION_FILE),
        join(__dirname, '..', 'drizzle', MIGRATION_FILE),
      ];

      const migrationPath = candidatePaths.find((p) => existsSync(p));

      if (!migrationPath) {
        logger.fatal(
          { candidatePaths },
          'Migration file not found — cannot start with DATABASE_URL set and no migration files. ' +
            'Either provide migration files or set SKIP_MIGRATIONS=true if migrations are applied separately.',
        );
        process.exit(1);
      }

      const migrationSql = readFileSync(migrationPath, 'utf-8');

      // Schema version check: verify the migration file contains the expected tables
      const expectedTables = ['machines', 'agents', 'agent_runs', 'agent_actions'];
      const missingTables = expectedTables.filter((table) => !migrationSql.includes(`"${table}"`));

      if (missingTables.length > 0) {
        logger.fatal(
          { migrationPath, missingTables },
          'Migration file is incomplete — expected tables not found in SQL. ' +
            'This likely means the migration file is corrupt or outdated.',
        );
        process.exit(1);
      }

      try {
        await db.execute(sql.raw(migrationSql));
      } catch (err: unknown) {
        logger.fatal(
          { err, migrationPath },
          'Database migration failed — cannot continue with an incomplete schema. ' +
            'Fix the migration error or set SKIP_MIGRATIONS=true if migrations are applied separately.',
        );
        process.exit(1);
      }

      // Count the number of DDL statements applied (CREATE TABLE + CREATE INDEX)
      const ddlStatements =
        migrationSql.match(/CREATE\s+(TABLE|INDEX)\s+IF\s+NOT\s+EXISTS/gi) ?? [];
      logger.info(
        { migrationPath, ddlStatements: ddlStatements.length },
        `Database migration applied successfully (${ddlStatements.length} DDL statements, all idempotent)`,
      );
    }

    dbRegistry = new DbAgentRegistry(db, logger.child({ component: 'db-registry' }));
    logger.info('Database-backed agent registry initialised');
  } else {
    logger.warn('DATABASE_URL not set — falling back to in-memory registry');
  }

  // Optionally initialise Mem0-backed memory injector when MEM0_URL is provided.
  let mem0Client: Mem0Client | undefined;
  let memoryInjector: MemoryInjector | undefined;

  if (MEM0_URL) {
    mem0Client = new Mem0Client({
      baseUrl: MEM0_URL,
      logger: logger.child({ component: 'mem0-client' }),
    });
    memoryInjector = new MemoryInjector({
      mem0Client,
      logger: logger.child({ component: 'memory-injector' }),
    });
    logger.info({ mem0Url: MEM0_URL }, 'Memory injector initialised');
  } else {
    logger.info('MEM0_URL not set — memory injection disabled');
  }

  // Optionally initialise LiteLLM client when LITELLM_URL is provided.
  let litellmClient: LiteLLMClient | undefined;

  if (LITELLM_URL) {
    litellmClient = new LiteLLMClient({
      baseUrl: LITELLM_URL,
      logger: logger.child({ component: 'litellm-client' }),
    });
    logger.info({ litellmUrl: LITELLM_URL }, 'LiteLLM client initialised');
  } else {
    logger.info('LITELLM_URL not set — LLM router routes disabled');
  }

  const circuitBreaker = new MachineCircuitBreaker({
    logger: logger.child({ component: 'circuit-breaker' }),
  });

  const taskQueue = createTaskQueue(redisConnection);
  const worker = createTaskWorker({
    connection: redisConnection,
    logger: logger.child({ component: 'task-worker' }),
    concurrency: WORKER_CONCURRENCY,
    registry: dbRegistry ?? null,
    memoryInjector: memoryInjector ?? null,
    litellmClient: litellmClient ?? null,
    controlPlaneUrl: CONTROL_PLANE_URL,
    circuitBreaker,
  });
  const repeatableJobs = createRepeatableJobManager(
    taskQueue,
    logger.child({ component: 'repeatable-jobs' }),
  );

  const server = await createServer({
    logger,
    taskQueue,
    repeatableJobs,
    registry: dbRegistry,
    dbRegistry,
    db,
    redis: redisConnection,
    litellmClient,
    mem0Client,
    memoryInjector: memoryInjector ?? null,
  });

  // Run dependency health checks before starting the server.
  // Failures are logged as warnings — they do not prevent startup.
  await checkDependencyHealth({
    db,
    redisConnection,
    mem0Client,
    litellmClient,
  });

  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info('Shutting down control plane...');

    try {
      await server.close();
    } catch (err: unknown) {
      logger.error({ err }, 'Error closing Fastify server');
    }

    try {
      await worker.close();
    } catch (err: unknown) {
      logger.error({ err }, 'Error closing task worker');
    }

    try {
      await taskQueue.close();
    } catch (err: unknown) {
      logger.error({ err }, 'Error closing task queue');
    }

    try {
      await redisConnection.quit();
    } catch (err: unknown) {
      logger.error({ err }, 'Error closing Redis connection');
    }

    logger.info('Control plane shut down cleanly');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.listen({ port: PORT, host: HOST });
  logger.info({ port: PORT, host: HOST }, 'Control plane started');
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start control plane');
  process.exit(1);
});
