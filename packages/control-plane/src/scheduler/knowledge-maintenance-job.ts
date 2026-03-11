// ---------------------------------------------------------------------------
// Knowledge Maintenance BullMQ Job -- section 7.4
//
// Monthly scheduled job that runs the four knowledge-maintenance passes:
//   1. Stale-entry lint
//   2. Cross-reference deleted files
//   3. Synthesis (cluster detection + principle proposals)
//   4. Knowledge coverage report
//
// Registers a repeatable job on the existing agent-tasks queue with a monthly
// cron expression. The worker handler delegates to KnowledgeMaintenance.
// ---------------------------------------------------------------------------

import type { ConnectionOptions, Job, Queue } from 'bullmq';
import { Worker } from 'bullmq';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import { KnowledgeMaintenance } from '../memory/knowledge-maintenance.js';
import type { MemoryStore } from '../memory/memory-store.js';

export const KNOWLEDGE_MAINTENANCE_QUEUE = 'knowledge-maintenance';
export const KNOWLEDGE_MAINTENANCE_JOB_NAME = 'maintenance:run';

/** Monthly at 3 AM on the 1st of each month. */
export const DEFAULT_MAINTENANCE_CRON = '0 3 1 * *';

export type KnowledgeMaintenanceJobData = {
  scope?: string;
  projectRoot?: string;
  triggeredAt: string;
};

export type KnowledgeMaintenanceJobOptions = {
  connection: ConnectionOptions;
  pool: Pool;
  memoryStore: MemoryStore;
  logger: Logger;
  projectRoot?: string;
};

export function createKnowledgeMaintenanceWorker(
  options: KnowledgeMaintenanceJobOptions,
): Worker<KnowledgeMaintenanceJobData, void, typeof KNOWLEDGE_MAINTENANCE_JOB_NAME> {
  const { connection, pool, memoryStore, logger, projectRoot } = options;

  const worker = new Worker<
    KnowledgeMaintenanceJobData,
    void,
    typeof KNOWLEDGE_MAINTENANCE_JOB_NAME
  >(
    KNOWLEDGE_MAINTENANCE_QUEUE,
    async (job: Job<KnowledgeMaintenanceJobData, void, typeof KNOWLEDGE_MAINTENANCE_JOB_NAME>) => {
      const jobLogger = logger.child({
        jobId: job.id,
        jobName: job.name,
        scope: job.data.scope ?? 'global',
      });

      jobLogger.info('Starting knowledge maintenance job');

      const maintenance = new KnowledgeMaintenance({
        pool,
        memoryStore,
        logger: jobLogger,
        projectRoot: job.data.projectRoot ?? projectRoot,
      });

      const result = await maintenance.run(job.data.scope);

      jobLogger.info(
        {
          staleEntries: result.staleEntries.length,
          deletedFileEntries: result.deletedFileEntries.length,
          synthesisClusters: result.synthesisClusters.length,
          consolidationItems: result.consolidationItems.length,
          coverageGaps: result.coverageReport.gapCount,
        },
        'Knowledge maintenance job completed',
      );
    },
    {
      connection,
      concurrency: 1,
      autorun: true,
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Knowledge maintenance job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Knowledge maintenance job failed');
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Knowledge maintenance worker error');
  });

  return worker;
}

/** Register the monthly repeatable job on the given queue. */
export async function registerMaintenanceSchedule(
  queue: Queue<KnowledgeMaintenanceJobData, void, typeof KNOWLEDGE_MAINTENANCE_JOB_NAME>,
  cronExpression: string = DEFAULT_MAINTENANCE_CRON,
  logger: Logger,
): Promise<void> {
  try {
    await queue.add(
      KNOWLEDGE_MAINTENANCE_JOB_NAME,
      {
        triggeredAt: new Date().toISOString(),
      },
      {
        repeat: {
          pattern: cronExpression,
          key: 'knowledge-maintenance:monthly',
        },
        jobId: 'knowledge-maintenance:monthly',
      },
    );

    logger.info({ cronExpression }, 'Registered monthly knowledge maintenance schedule');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { err: error, cronExpression },
      `Failed to register maintenance schedule: ${message}`,
    );
  }
}
