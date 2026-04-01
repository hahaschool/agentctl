import { sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';

/**
 * Execute a function within a transaction where sync triggers are disabled.
 *
 * Used by P2 sync protocol to apply remote changes without re-triggering
 * the sync_capture_change() trigger. SET LOCAL scoping ensures the guard
 * resets at transaction end even on error.
 *
 * This is a P2 contract — P1 establishes the pattern, P2 implements the
 * actual remote-apply logic inside this wrapper.
 */
export async function withSyncApplyGuard<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL app.sync_applying = 'true'`));
    return fn(tx as unknown as Database);
  });
}
