import { ControlPlaneError } from '@agentctl/shared';
import { type ConnectionOptions, type Job, Worker } from 'bullmq';
import type { Logger } from 'pino';

import type { JobEventsRepository } from './job-events-repository.js';
import type { JobsRepository } from './jobs-repository.js';
import { MEMORY_OPS_QUEUE, type MemoryOpsQueueData, type MemoryOpsQueueName } from './queue.js';

export type MemoryOpsJobHandler = (
  job: Job<MemoryOpsQueueData, void, MemoryOpsQueueName>,
) => Promise<void>;

export type CreateMemoryOpsWorkerRuntimeOptions = {
  connection: ConnectionOptions;
  jobsRepository: JobsRepository;
  eventsRepository: JobEventsRepository;
  logger: Logger;
  handlers?: Partial<Record<MemoryOpsQueueName, MemoryOpsJobHandler>>;
  concurrency?: number;
};

export function createMemoryOpsWorkerRuntime({
  connection,
  jobsRepository,
  eventsRepository,
  logger,
  handlers = {},
  concurrency = 1,
}: CreateMemoryOpsWorkerRuntimeOptions): Worker<MemoryOpsQueueData, void, MemoryOpsQueueName> {
  return new Worker<MemoryOpsQueueData, void, MemoryOpsQueueName>(
    MEMORY_OPS_QUEUE,
    async (job) => {
      const dbJobId = job.data.dbJobId;
      await jobsRepository.markRunning(dbJobId);
      await eventsRepository.insert({
        jobId: dbJobId,
        eventType: 'started',
        level: 'info',
        message: `Started ${job.name}`,
      });

      const handler = handlers[job.name];
      if (!handler) {
        const error = new ControlPlaneError(
          'HANDLER_NOT_REGISTERED',
          `No memory operation handler is registered for ${job.name}`,
          { jobId: dbJobId, kind: job.name },
        );
        await jobsRepository.transition(dbJobId, 'failed', {
          error: error.message,
          errorCode: error.code,
        });
        await eventsRepository.insert({
          jobId: dbJobId,
          eventType: 'failed',
          level: 'error',
          message: error.message,
          payload: { code: error.code },
        });
        throw error;
      }

      try {
        await handler(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = error instanceof ControlPlaneError ? error.code : 'JOB_HANDLER_FAILED';
        await jobsRepository.transition(dbJobId, 'failed', { error: message, errorCode: code });
        await eventsRepository.insert({
          jobId: dbJobId,
          eventType: 'failed',
          level: 'error',
          message,
          payload: { code },
        });
        throw error;
      }
    },
    { connection, concurrency },
  ).on('failed', (job, error) => {
    logger.warn(
      { jobId: job?.data.dbJobId, kind: job?.name, err: error },
      'Memory operation job failed',
    );
  });
}
