import IORedis from 'ioredis';

import { createServer } from './api/server.js';
import { createLogger } from './logger.js';
import { createTaskQueue } from './scheduler/task-queue.js';
import { createTaskWorker } from './scheduler/task-worker.js';
import { createRepeatableJobManager } from './scheduler/repeatable-jobs.js';

const logger = createLogger('control-plane');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 5;

async function main(): Promise<void> {
  const redisConnection = new IORedis.default(REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  logger.info({ redisUrl: REDIS_URL }, 'Connecting to Redis');

  const taskQueue = createTaskQueue(redisConnection);
  const worker = createTaskWorker({
    connection: redisConnection,
    logger: logger.child({ component: 'task-worker' }),
    concurrency: WORKER_CONCURRENCY,
  });
  const repeatableJobs = createRepeatableJobManager(
    taskQueue,
    logger.child({ component: 'repeatable-jobs' }),
  );

  const server = await createServer({ logger, taskQueue, repeatableJobs });

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
