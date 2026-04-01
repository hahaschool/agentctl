import { and, eq, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { syncChangeLog } from '../db/schema.js';

const DEFAULT_RETENTION_DAYS = 30;

/**
 * Delete old synced change log entries beyond the retention period.
 * Only deletes entries where synced = true (already pulled by all peers).
 * Returns the number of deleted rows.
 */
export async function cleanupSyncedChanges(
  db: Database,
  logger: Logger,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
): Promise<number> {
  const cutoff = sql`now() - ${`${retentionDays} days`}::interval`;

  const result = await db
    .delete(syncChangeLog)
    .where(and(eq(syncChangeLog.synced, true), lt(syncChangeLog.createdAt, cutoff)))
    .returning({ id: syncChangeLog.id });

  const count = result.length;
  if (count > 0) {
    logger.info({ deletedCount: count, retentionDays }, 'Cleaned up old sync change log entries');
  }

  return count;
}
