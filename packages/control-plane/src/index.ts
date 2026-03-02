import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { createRepeatableJobManager } from './scheduler/repeatable-jobs.js';
import { createTaskQueue } from './scheduler/task-queue.js';
import { createTaskWorker } from './scheduler/task-worker.js';

const logger = createLogger('control-plane');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const DATABASE_URL = process.env.DATABASE_URL || '';
const MEM0_URL = process.env.MEM0_URL || '';
const LITELLM_URL = process.env.LITELLM_URL || '';
const CONTROL_PLANE_URL =
  process.env.CONTROL_PLANE_URL ||
  `http://${process.env.HOST || '0.0.0.0'}:${Number(process.env.PORT) || 8080}`;
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 5;

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
  });

  logger.info({ redisUrl: REDIS_URL }, 'Connecting to Redis');

  // Optionally connect to PostgreSQL when DATABASE_URL is provided.
  let db: Database | undefined;
  let dbRegistry: DbAgentRegistry | undefined;

  if (DATABASE_URL) {
    logger.info('Connecting to PostgreSQL');
    db = createDb(DATABASE_URL);

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

    if (migrationPath) {
      const migrationSql = readFileSync(migrationPath, 'utf-8');

      // Schema version check: verify the migration file contains the expected tables
      const expectedTables = ['machines', 'agents', 'agent_runs', 'agent_actions'];
      const missingTables = expectedTables.filter((table) => !migrationSql.includes(`"${table}"`));

      if (missingTables.length > 0) {
        logger.warn(
          { migrationPath, missingTables },
          'Migration file may be incomplete — expected tables not found in SQL',
        );
      }

      await db.execute(sql.raw(migrationSql));
      logger.info({ migrationPath }, 'Database migrations applied');
    } else {
      logger.warn(
        { candidatePaths },
        'Migration file not found — skipping auto-migration. Database schema must be applied manually.',
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

  const taskQueue = createTaskQueue(redisConnection);
  const worker = createTaskWorker({
    connection: redisConnection,
    logger: logger.child({ component: 'task-worker' }),
    concurrency: WORKER_CONCURRENCY,
    registry: dbRegistry ?? null,
    memoryInjector: memoryInjector ?? null,
    litellmClient: litellmClient ?? null,
    controlPlaneUrl: CONTROL_PLANE_URL,
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
