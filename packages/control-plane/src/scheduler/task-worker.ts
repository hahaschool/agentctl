import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import type { Logger } from 'pino';
import { ControlPlaneError } from '@agentctl/shared';

import { AGENT_TASKS_QUEUE, type AgentTaskJobData, type AgentTaskJobName } from './task-queue.js';

export type TaskWorkerOptions = {
  connection: ConnectionOptions;
  logger: Logger;
  concurrency?: number;
};

export function createTaskWorker({
  connection,
  logger,
  concurrency = 5,
}: TaskWorkerOptions): Worker<AgentTaskJobData, void, AgentTaskJobName> {
  const worker = new Worker<AgentTaskJobData, void, AgentTaskJobName>(
    AGENT_TASKS_QUEUE,
    async (job: Job<AgentTaskJobData, void, AgentTaskJobName>) => {
      const { agentId, machineId, trigger, prompt, model } = job.data;

      const jobLogger = logger.child({
        jobId: job.id,
        jobName: job.name,
        agentId,
        machineId,
        trigger,
      });

      jobLogger.info('Processing agent task job');

      try {
        // TODO: dispatch to agent-worker via HTTP/WebSocket once agent-worker package is ready
        // For now, log and mark complete as a placeholder.
        jobLogger.info(
          {
            prompt: prompt ? `${prompt.slice(0, 80)}...` : null,
            model,
          },
          'Agent task job processed (stub — dispatch not yet implemented)',
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        jobLogger.error({ err }, 'Agent task job failed');
        throw new ControlPlaneError('TASK_PROCESSING_FAILED', `Failed to process task for agent ${agentId}: ${message}`, {
          agentId,
          machineId,
          jobId: job.id,
        });
      }
    },
    {
      connection,
      concurrency,
      autorun: true,
    },
  );

  worker.on('completed', (job: Job<AgentTaskJobData, void, AgentTaskJobName>) => {
    logger.debug({ jobId: job.id, agentId: job.data.agentId }, 'Job completed');
  });

  worker.on('failed', (job: Job<AgentTaskJobData, void, AgentTaskJobName> | undefined, err: Error) => {
    logger.error(
      { jobId: job?.id, agentId: job?.data.agentId, err },
      'Job failed',
    );
  });

  worker.on('error', (err: Error) => {
    logger.error({ err }, 'Task worker error');
  });

  return worker;
}
