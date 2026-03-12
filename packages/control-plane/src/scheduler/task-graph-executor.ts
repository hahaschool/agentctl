import type { TaskExecutor, TaskRun, TaskRunStatus } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import type { ConnectionOptions } from 'bullmq';
import { Queue } from 'bullmq';
import type { Logger } from 'pino';

const TASK_GRAPH_QUEUE = 'task-graph-runs';

export type TaskGraphJobData = {
  taskRunId: string;
  definitionId: string;
  definitionName: string;
  graphId: string;
  attempt: number;
  timeoutMs: number;
};

/**
 * BullMQ-backed implementation of the TaskExecutor interface.
 * Can be swapped for Temporal later without changing domain logic.
 */
export class BullMQTaskExecutor implements TaskExecutor {
  private readonly queue: Queue<TaskGraphJobData>;
  private readonly logger: Logger;

  constructor(connection: ConnectionOptions, logger: Logger) {
    this.logger = logger;
    this.queue = new Queue<TaskGraphJobData>(TASK_GRAPH_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    });
  }

  async submit(taskRun: TaskRun): Promise<void> {
    const jobData: TaskGraphJobData = {
      taskRunId: taskRun.id,
      definitionId: taskRun.definitionId,
      definitionName: '', // caller should enrich if needed
      graphId: '', // caller should enrich if needed
      attempt: taskRun.attempt,
      timeoutMs: 3600000,
    };

    await this.queue.add('task-graph:execute', jobData, {
      jobId: `tg-run-${taskRun.id}-attempt-${taskRun.attempt}`,
    });

    this.logger.info(
      { taskRunId: taskRun.id, definitionId: taskRun.definitionId },
      'Task run submitted to BullMQ',
    );
  }

  async cancel(taskRunId: string): Promise<void> {
    // BullMQ doesn't have a direct cancel by job data, but we can remove
    // the job if it hasn't started yet.
    const jobs = await this.queue.getJobs(['waiting', 'delayed']);
    for (const job of jobs) {
      if (job.data.taskRunId === taskRunId) {
        await job.remove();
        this.logger.info({ taskRunId, jobId: job.id }, 'Task run job removed from queue');
        return;
      }
    }

    this.logger.warn(
      { taskRunId },
      'No waiting/delayed job found for task run — may already be running',
    );
  }

  async getStatus(taskRunId: string): Promise<TaskRunStatus> {
    const jobs = await this.queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);

    for (const job of jobs) {
      if (job.data.taskRunId === taskRunId) {
        const state = await job.getState();
        return this.mapJobState(state);
      }
    }

    throw new ControlPlaneError(
      'JOB_NOT_FOUND',
      `No BullMQ job found for task run '${taskRunId}'`,
      { taskRunId },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }

  private mapJobState(state: string): TaskRunStatus {
    switch (state) {
      case 'waiting':
      case 'delayed':
        return 'pending';
      case 'active':
        return 'running';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      default:
        return 'pending';
    }
  }
}
