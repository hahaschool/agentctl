import type { ChangeLogEntry } from '@agentctl/shared';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { extractRows } from '../db/index.js';

import { applyChange, recordSchemaAheadRejection } from './apply-change.js';
import { MeshEnvelopeSchemaAheadError } from './mesh-compat.js';
import { createPeerSignedHeader } from './peer-auth.js';
import { markSyncedEntries } from './synced-marker.js';

const DEFAULT_SYNC_INTERVAL_MS = 30_000;
const PULL_TIMEOUT_MS = 30_000;
const ACK_TIMEOUT_MS = 10_000;
const DEFAULT_BATCH_LIMIT = 500;

type SyncPeerInfo = {
  id: string;
  syncUrl: string;
  publicKey: string;
  syncIntervalMs: number;
};

type SyncPeerRow = {
  id: string;
  sync_url: string | null;
  public_key: string | null;
  sync_interval_ms: number | null;
};

type PulledCursorRow = {
  pulled_cursor: number | null;
};

type SyncFromPeerResult = {
  applied: number;
  conflicts: number;
  errors: number;
};

type PullResponse = {
  changes: ChangeLogEntry[];
  cursor: number;
  hasMore: boolean;
};

/**
 * Get the pulled_cursor for a specific peer.
 */
async function getPulledCursor(
  db: Database,
  selfMachineId: string,
  peerId: string,
): Promise<number> {
  const result = await db.execute(sql`
    SELECT pulled_cursor
    FROM sync_peer_cursors
    WHERE local_node_id = ${selfMachineId}
      AND remote_node_id = ${peerId}
    LIMIT 1
  `);

  const [row] = extractRows<PulledCursorRow>(result);
  return row?.pulled_cursor ?? 0;
}

/**
 * Update the pulled_cursor for a specific peer.
 */
async function updatePulledCursor(
  db: Database,
  selfMachineId: string,
  peerId: string,
  cursor: number,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO sync_peer_cursors (local_node_id, remote_node_id, pulled_cursor, updated_at)
    VALUES (${selfMachineId}, ${peerId}, ${cursor}, now())
    ON CONFLICT (local_node_id, remote_node_id) DO UPDATE SET
      pulled_cursor = GREATEST(sync_peer_cursors.pulled_cursor, EXCLUDED.pulled_cursor),
      updated_at = now()
  `);
}

/**
 * Pull and apply changes from a single peer.
 * Processes in batches, advancing cursor only to the last successful change on error.
 */
export async function syncFromPeer(opts: {
  db: Database;
  selfMachineId: string;
  peer: { id: string; syncUrl: string };
  secretKey: string;
  logger: Logger;
}): Promise<SyncFromPeerResult> {
  const { db, selfMachineId, peer, secretKey, logger } = opts;
  let cursor = await getPulledCursor(db, selfMachineId, peer.id);
  let applied = 0;
  let conflicts = 0;
  let errors = 0;

  while (true) {
    let data: PullResponse;
    try {
      const path = `/api/sync/changes?since=${cursor}&limit=${DEFAULT_BATCH_LIMIT}`;
      const authHeader = createPeerSignedHeader(
        selfMachineId,
        'GET',
        '/api/sync/changes',
        '',
        secretKey,
      );

      const resp = await fetch(`${peer.syncUrl}${path}`, {
        headers: { 'X-Sync-Auth': authHeader },
        signal: AbortSignal.timeout(PULL_TIMEOUT_MS),
      });

      if (!resp.ok) {
        logger.warn({ peerId: peer.id, status: resp.status }, 'Sync pull returned non-OK status');
        errors++;
        break;
      }

      data = (await resp.json()) as PullResponse;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), peerId: peer.id },
        'Sync pull failed (network/timeout)',
      );
      errors++;
      break;
    }

    if (data.changes.length === 0) {
      break;
    }

    let batchFailed = false;
    let lastSuccessId = cursor;

    for (const change of data.changes) {
      try {
        const result = await applyChange(change, db, logger);
        if (result === 'applied') applied++;
        if (result === 'conflict') conflicts++;
        lastSuccessId = change.id;
      } catch (err) {
        logger.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            changeId: change.id,
            peerId: peer.id,
          },
          'Failed to apply sync change - stopping batch',
        );
        // 33.10: when the compat gate rejects a schema-ahead envelope, stamp
        // the offending peer row so /mesh-peers can render a "Peer ahead" badge
        // pointing the operator at the CP that needs updating.
        if (err instanceof MeshEnvelopeSchemaAheadError) {
          await recordSchemaAheadRejection(
            db,
            err.context.producerMachineId ?? peer.id,
            err.context.envelopeSchemaVersion,
            logger,
          );
        }
        errors++;
        batchFailed = true;
        break;
      }
    }

    // Only advance cursor to last successfully processed change
    cursor = batchFailed ? lastSuccessId : data.cursor;
    await updatePulledCursor(db, selfMachineId, peer.id, cursor);

    // ACK to peer (non-fatal if fails)
    try {
      const ackBody = JSON.stringify({ machineId: selfMachineId, cursor });
      const ackAuth = createPeerSignedHeader(
        selfMachineId,
        'POST',
        '/api/sync/ack',
        { machineId: selfMachineId, cursor },
        secretKey,
      );

      await fetch(`${peer.syncUrl}/api/sync/ack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sync-Auth': ackAuth,
        },
        body: ackBody,
        signal: AbortSignal.timeout(ACK_TIMEOUT_MS),
      });
    } catch (err) {
      logger.debug(
        { err: err instanceof Error ? err.message : String(err), peerId: peer.id },
        'Sync ACK failed (non-fatal)',
      );
    }

    if (batchFailed || !data.hasMore) {
      break;
    }
  }

  // After a full sync cycle, update synced markers
  if (applied > 0) {
    try {
      await markSyncedEntries(db, selfMachineId);
    } catch (err) {
      logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'markSyncedEntries failed (non-fatal)',
      );
    }
  }

  if (applied > 0 || conflicts > 0 || errors > 0) {
    logger.info({ peerId: peer.id, applied, conflicts, errors }, 'Sync cycle completed');
  }

  return { applied, conflicts, errors };
}

/**
 * Get all reachable peers from sync_nodes.
 */
async function getReachablePeers(db: Database): Promise<SyncPeerInfo[]> {
  const result = await db.execute(sql`
    SELECT id, sync_url, public_key, sync_interval_ms
    FROM sync_nodes
    WHERE COALESCE(is_self, false) = false
      AND sync_status = 'reachable'
      AND sync_url IS NOT NULL
      AND public_key IS NOT NULL
  `);

  return extractRows<SyncPeerRow>(result)
    .filter(
      (r): r is SyncPeerRow & { sync_url: string; public_key: string } =>
        r.sync_url !== null && r.public_key !== null,
    )
    .map((r) => ({
      id: r.id,
      syncUrl: r.sync_url,
      publicKey: r.public_key,
      syncIntervalMs: r.sync_interval_ms ?? DEFAULT_SYNC_INTERVAL_MS,
    }));
}

/**
 * Start sync loops for all reachable peers.
 * Each peer runs on its own interval based on sync_interval_ms.
 * Returns a stop function that clears all timers.
 */
export function startSyncLoops(opts: {
  db: Database;
  selfMachineId: string;
  secretKey: string;
  logger: Logger;
  pollIntervalMs?: number;
}): { stop: () => void } {
  const { db, selfMachineId, secretKey, logger, pollIntervalMs = DEFAULT_SYNC_INTERVAL_MS } = opts;

  const peerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let running = true;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function schedulePeerSync(peer: SyncPeerInfo): Promise<void> {
    if (!running || peerTimers.has(peer.id)) {
      return;
    }

    const doSync = async (): Promise<void> => {
      if (!running) return;

      try {
        await syncFromPeer({
          db,
          selfMachineId,
          peer: { id: peer.id, syncUrl: peer.syncUrl },
          secretKey,
          logger: logger.child({ component: 'sync-loop', peerId: peer.id }),
        });
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), peerId: peer.id },
          'Sync loop error',
        );
      }

      // Re-schedule if still running
      if (running) {
        const timer = setTimeout(() => {
          peerTimers.delete(peer.id);
          void doSync();
        }, peer.syncIntervalMs);
        timer.unref?.();
        peerTimers.set(peer.id, timer);
      }
    };

    // Initial sync
    const timer = setTimeout(() => {
      peerTimers.delete(peer.id);
      void doSync();
    }, 0);
    timer.unref?.();
    peerTimers.set(peer.id, timer);
  }

  // Periodically poll for new/changed peers and schedule sync loops
  async function pollPeers(): Promise<void> {
    if (!running) return;

    try {
      const peers = await getReachablePeers(db);
      for (const peer of peers) {
        void schedulePeerSync(peer);
      }
    } catch (err) {
      logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'Failed to poll reachable peers',
      );
    }
  }

  void pollPeers();
  pollTimer = setInterval(() => void pollPeers(), pollIntervalMs);
  pollTimer.unref?.();

  return {
    stop: () => {
      running = false;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      for (const timer of peerTimers.values()) {
        clearTimeout(timer);
      }
      peerTimers.clear();
      logger.info('Sync loops stopped');
    },
  };
}
