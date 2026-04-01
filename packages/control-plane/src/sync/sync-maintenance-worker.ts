import type { ConnectionOptions } from 'bullmq';
import { Queue, Worker } from 'bullmq';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';

import { cleanupSyncedChanges } from './change-log-cleanup.js';

export const SYNC_MAINTENANCE_QUEUE = 'sync-maintenance';

type SyncMaintenanceJobData = Record<string, never>;
type SyncMaintenanceJobName = 'sync:cleanup';

/**
 * Register the daily sync cleanup repeatable job.
 * Safe to call multiple times — BullMQ deduplicates by repeat key.
 */
export async function registerSyncMaintenanceJobs(
  connection: ConnectionOptions,
): Promise<Queue<SyncMaintenanceJobData, void, SyncMaintenanceJobName>> {
  const queue = new Queue<SyncMaintenanceJobData, void, SyncMaintenanceJobName>(
    SYNC_MAINTENANCE_QUEUE,
    { connection },
  );

  await queue.add('sync:cleanup', {}, {
    repeat: { pattern: '0 3 * * *' },
    removeOnComplete: true,
    removeOnFail: 5,
  });

  return queue;
}

/**
 * Create a BullMQ worker that processes sync maintenance jobs.
 */
export function createSyncMaintenanceWorker(opts: {
  connection: ConnectionOptions;
  db: Database;
  logger: Logger;
}): Worker<SyncMaintenanceJobData, void, SyncMaintenanceJobName> {
  const { connection, db, logger } = opts;

  return new Worker<SyncMaintenanceJobData, void, SyncMaintenanceJobName>(
    SYNC_MAINTENANCE_QUEUE,
    async (job) => {
      if (job.name === 'sync:cleanup') {
        await cleanupSyncedChanges(db, logger);
      }
    },
    { connection, concurrency: 1 },
  );
}
