import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { extractRows } from '../db/index.js';

const HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 300_000;

/**
 * Mesh peer version fields observed from a remote `/health` response.
 *
 * All three are optional: older peers (pre-§33.9) do not advertise them and
 * must continue to ping successfully. Fields that fail type validation are
 * left as `null` so downstream UIs can render them as "unknown".
 */
export type PeerVersionInfo = {
  appVersion: string | null;
  gitSha: string | null;
  schemaVersion: number | null;
};

export const EMPTY_PEER_VERSION_INFO: PeerVersionInfo = {
  appVersion: null,
  gitSha: null,
  schemaVersion: null,
};

/**
 * Defensively extract peer version observability fields from a raw `/health`
 * JSON body. Accepts only well-typed values; anything else collapses to `null`
 * so we never persist garbage into `sync_nodes.peer_*`.
 */
export function extractPeerVersionInfo(body: unknown): PeerVersionInfo {
  if (!body || typeof body !== 'object') {
    return EMPTY_PEER_VERSION_INFO;
  }

  const record = body as Record<string, unknown>;
  const appVersionRaw = record.appVersion;
  const gitShaRaw = record.gitSha;
  const schemaVersionRaw = record.schemaVersion;

  const appVersion =
    typeof appVersionRaw === 'string' && appVersionRaw.length > 0 && appVersionRaw.length <= 128
      ? appVersionRaw
      : null;
  const gitSha =
    typeof gitShaRaw === 'string' && gitShaRaw.length > 0 && gitShaRaw.length <= 64
      ? gitShaRaw
      : null;
  const schemaVersion =
    typeof schemaVersionRaw === 'number' &&
    Number.isSafeInteger(schemaVersionRaw) &&
    schemaVersionRaw >= 0
      ? schemaVersionRaw
      : null;

  return { appVersion, gitSha, schemaVersion };
}

/**
 * Parse a `fetch` Response body as JSON and extract peer version info.
 * Swallows JSON parse errors so a malformed body never breaks the ping.
 */
export async function readPeerVersionInfo(response: Response): Promise<PeerVersionInfo> {
  try {
    const body = await response.json();
    return extractPeerVersionInfo(body);
  } catch {
    return EMPTY_PEER_VERSION_INFO;
  }
}

type PeerReachability = 'reachable' | 'unreachable';

type PeerHealthProbeResult =
  | { reachability: 'reachable'; version: PeerVersionInfo }
  | { reachability: 'unreachable'; version: PeerVersionInfo };

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

async function checkPeer(syncUrl: string): Promise<PeerHealthProbeResult> {
  try {
    const response = await fetch(`${syncUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { reachability: 'unreachable', version: EMPTY_PEER_VERSION_INFO };
    }
    const version = await readPeerVersionInfo(response);
    return { reachability: 'reachable', version };
  } catch {
    return { reachability: 'unreachable', version: EMPTY_PEER_VERSION_INFO };
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

    const probe = await checkPeer(peer.sync_url);
    const nextInterval = computeNextInterval(
      peer.sync_interval_ms ?? DEFAULT_INTERVAL_MS,
      probe.reachability,
    );

    if (probe.reachability === 'reachable') {
      const { appVersion, gitSha, schemaVersion } = probe.version;
      await opts.db.execute(sql`
        UPDATE sync_nodes
        SET sync_status = 'reachable',
            sync_interval_ms = ${nextInterval},
            last_seen = now(),
            peer_version = ${appVersion},
            peer_git_sha = ${gitSha},
            peer_schema_version = ${schemaVersion}
        WHERE id = ${peer.id}
      `);
      opts.logger.debug(
        {
          machineId: peer.id,
          syncUrl: peer.sync_url,
          peerVersion: appVersion,
          peerGitSha: gitSha,
          peerSchemaVersion: schemaVersion,
        },
        'Mesh peer is reachable',
      );
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
