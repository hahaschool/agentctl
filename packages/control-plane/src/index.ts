import IORedis from 'ioredis';

import { createServer } from './api/server.js';
import { createLogger } from './logger.js';
import { createTaskQueue } from './scheduler/task-queue.js';
import { createTaskWorker } from './scheduler/task-worker.js';
import { createRepeatableJobManager } from './scheduler/repeatable-jobs.js';
import { createDb } from './db/index.js';
import { DbAgentRegistry } from './registry/db-registry.js';
import { Mem0Client } from './memory/mem0-client.js';
import { MemoryInjector } from './memory/memory-injector.js';

const logger = createLogger('control-plane');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const DATABASE_URL = process.env.DATABASE_URL || '';
const MEM0_URL = process.env.MEM0_URL || '';
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || `http://${process.env.HOST || '0.0.0.0'}:${Number(process.env.PORT) || 8080}`;
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 5;

async function main(): Promise<void> {
  const redisConnection = new IORedis.default(REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  logger.info({ redisUrl: REDIS_URL }, 'Connecting to Redis');

  // Optionally connect to PostgreSQL when DATABASE_URL is provided.
  let dbRegistry: DbAgentRegistry | undefined;

  if (DATABASE_URL) {
    logger.info('Connecting to PostgreSQL');
    const db = createDb(DATABASE_URL);
    dbRegistry = new DbAgentRegistry(
      db,
      logger.child({ component: 'db-registry' }),
    );
    logger.info('Database-backed agent registry initialised');
  } else {
    logger.warn('DATABASE_URL not set — falling back to in-memory registry');
  }

  // Optionally initialise Mem0-backed memory injector when MEM0_URL is provided.
  let memoryInjector: MemoryInjector | undefined;

  if (MEM0_URL) {
    const mem0Client = new Mem0Client({
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

  const taskQueue = createTaskQueue(redisConnection);
  const worker = createTaskWorker({
    connection: redisConnection,
    logger: logger.child({ component: 'task-worker' }),
    concurrency: WORKER_CONCURRENCY,
    registry: dbRegistry ?? null,
    memoryInjector: memoryInjector ?? null,
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
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down control plane');
    await worker.close();
    await taskQueue.close();
    await server.close();
    await redisConnection.quit();
    logger.info('Shutdown complete');
  };

  process.on('SIGINT', () => {
    shutdown().catch((err: unknown) => {
      logger.fatal({ err }, 'Error during shutdown');
      process.exit(1);
    });
  });

  process.on('SIGTERM', () => {
    shutdown().catch((err: unknown) => {
      logger.fatal({ err }, 'Error during shutdown');
      process.exit(1);
    });
  });

  await server.listen({ port: PORT, host: HOST });
  logger.info({ port: PORT, host: HOST }, 'Control plane started');
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start control plane');
  process.exit(1);
});
