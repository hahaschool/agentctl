import { sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { extractRows } from '../db/index.js';

/**
 * Mark change log entries as synced when ALL known peers have ACKed past them.
 *
 * An entry is safe to mark synced when its id <= the minimum acked_cursor
 * across all peers that this node tracks.
 *
 * Returns the number of entries marked as synced.
 */
export async function markSyncedEntries(db: Database, selfMachineId: string): Promise<number> {
  const result = await db.execute(sql`
    UPDATE sync_change_log SET synced = true
    WHERE id <= (
      SELECT COALESCE(MIN(acked_cursor), 0)
      FROM sync_peer_cursors
      WHERE local_node_id = ${selfMachineId}
    )
    AND synced = false
    RETURNING id
  `);

  return extractRows(result).length;
}
