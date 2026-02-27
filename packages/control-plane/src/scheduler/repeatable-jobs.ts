import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { ControlPlaneError } from '@agentctl/shared';

import type { AgentTaskJobData, AgentTaskJobName } from './task-queue.js';

const HEARTBEAT_JOB_PREFIX = 'heartbeat';
const CRON_JOB_PREFIX = 'cron';

function repeatableJobKey(prefix: string, agentId: string): string {
  return `${prefix}:${agentId}`;
}

export type RepeatableJobManager = {
  addCronJob: (agentId: string, cronExpression: string, jobData: AgentTaskJobData) => Promise<void>;
  addHeartbeatJob: (agentId: string, intervalMs: number, jobData: AgentTaskJobData) => Promise<void>;
  removeJobsByAgentId: (agentId: string) => Promise<number>;
  listRepeatableJobs: () => Promise<RepeatableJobInfo[]>;
};

export type RepeatableJobInfo = {
  key: string;
  name: string;
  pattern: string | null;
  every: string | null;
  next: number | null;
};

export function createRepeatableJobManager(
  queue: Queue<AgentTaskJobData, void, AgentTaskJobName>,
  logger: Logger,
): RepeatableJobManager {
  return {
    async addCronJob(agentId: string, cronExpression: string, jobData: AgentTaskJobData): Promise<void> {
      const jobKey = repeatableJobKey(CRON_JOB_PREFIX, agentId);

      try {
        await queue.add('agent:cron', jobData, {
          repeat: {
            pattern: cronExpression,
            key: jobKey,
          },
          jobId: jobKey,
        });

        logger.info(
          { agentId, cronExpression, jobKey },
          'Added repeatable cron job',
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'CRON_JOB_ADD_FAILED',
          `Failed to add cron job for agent ${agentId}: ${message}`,
          { agentId, cronExpression },
        );
      }
    },

    async addHeartbeatJob(agentId: string, intervalMs: number, jobData: AgentTaskJobData): Promise<void> {
      const jobKey = repeatableJobKey(HEARTBEAT_JOB_PREFIX, agentId);

      try {
        await queue.add('agent:heartbeat', jobData, {
          repeat: {
            every: intervalMs,
            key: jobKey,
          },
          jobId: jobKey,
        });

        logger.info(
          { agentId, intervalMs, jobKey },
          'Added repeatable heartbeat job',
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'HEARTBEAT_JOB_ADD_FAILED',
          `Failed to add heartbeat job for agent ${agentId}: ${message}`,
          { agentId, intervalMs },
        );
      }
    },

    async removeJobsByAgentId(agentId: string): Promise<number> {
      try {
        const repeatableJobs = await queue.getRepeatableJobs();
        let removedCount = 0;

        const heartbeatKey = repeatableJobKey(HEARTBEAT_JOB_PREFIX, agentId);
        const cronKey = repeatableJobKey(CRON_JOB_PREFIX, agentId);

        for (const job of repeatableJobs) {
          if (job.key.includes(heartbeatKey) || job.key.includes(cronKey)) {
            await queue.removeRepeatableByKey(job.key);
            removedCount++;
            logger.info(
              { agentId, jobKey: job.key },
              'Removed repeatable job',
            );
          }
        }

        return removedCount;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'REPEATABLE_JOB_REMOVE_FAILED',
          `Failed to remove repeatable jobs for agent ${agentId}: ${message}`,
          { agentId },
        );
      }
    },

    async listRepeatableJobs(): Promise<RepeatableJobInfo[]> {
      try {
        const jobs = await queue.getRepeatableJobs();

        return jobs.map((job) => ({
          key: job.key,
          name: job.name,
          pattern: job.pattern ?? null,
          every: job.every ? String(job.every) : null,
          next: job.next ?? null,
        }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'REPEATABLE_JOB_LIST_FAILED',
          `Failed to list repeatable jobs: ${message}`,
          {},
        );
      }
    },
  };
}
