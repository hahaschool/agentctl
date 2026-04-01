import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { extractRows } from '../db/index.js';

const HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 300_000;

type PeerReachability = 'reachable' | 'unreachable';

type SyncPeerRow = {
  id: string;
  sync_url: string | null;
  sync_interval_ms: number | null;
};

export function computeNextInterval(
  currentIntervalMs: number,
  reachability: PeerReachability,
): number {
  if (reachability === 'reachable') {
    return DEFAULT_INTERVAL_MS;
  }

  return Math.min(Math.max(currentIntervalMs, DEFAULT_INTERVAL_MS) * 2, MAX_INTERVAL_MS);
}

async function checkPeer(syncUrl: string): Promise<PeerReachability> {
  try {
    const response = await fetch(`${syncUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok ? 'reachable' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

export async function healthCheckAllPeers(opts: { db: Database; logger: Logger }): Promise<void> {
  const result = await opts.db.execute(sql`
    SELECT id, sync_url, sync_interval_ms
    FROM sync_nodes
    WHERE COALESCE(is_self, false) = false
      AND sync_url IS NOT NULL
  `);
  const peers = extractRows<SyncPeerRow>(result);

  for (const peer of peers) {
    if (!peer.sync_url) {
      continue;
    }

    const reachability = await checkPeer(peer.sync_url);
    const nextInterval = computeNextInterval(
      peer.sync_interval_ms ?? DEFAULT_INTERVAL_MS,
      reachability,
    );

    if (reachability === 'reachable') {
      await opts.db.execute(sql`
        UPDATE sync_nodes
        SET sync_status = 'reachable',
            sync_interval_ms = ${nextInterval},
            last_seen = now()
        WHERE id = ${peer.id}
      `);
      opts.logger.debug({ machineId: peer.id, syncUrl: peer.sync_url }, 'Mesh peer is reachable');
      continue;
    }

    await opts.db.execute(sql`
      UPDATE sync_nodes
      SET sync_status = 'unreachable',
          sync_interval_ms = ${nextInterval}
      WHERE id = ${peer.id}
    `);
    opts.logger.debug(
      { machineId: peer.id, syncUrl: peer.sync_url, nextInterval },
      'Mesh peer is unreachable',
    );
  }
}

export function startHealthCheckLoop(opts: { db: Database; logger: Logger; intervalMs?: number }): {
  stop: () => void;
} {
  const { db, logger, intervalMs = DEFAULT_INTERVAL_MS } = opts;

  void healthCheckAllPeers({ db, logger });

  const timer = setInterval(() => {
    void healthCheckAllPeers({ db, logger });
  }, intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
  };
}
