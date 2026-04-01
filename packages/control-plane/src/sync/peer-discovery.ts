import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';

const execFileAsync = promisify(execFile);
const TAILSCALE_TIMEOUT_MS = 5_000;
const HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_CP_PORT = 8080;
const DEFAULT_DISCOVERY_INTERVAL_MS = 60_000;

export type TailscalePeer = {
  hostname: string;
  tailscaleIp: string;
};

type TailscaleStatusEntry = {
  TailscaleIPs: string[];
  HostName: string;
  Online: boolean;
  Tags?: string[];
};

type TailscaleStatus = {
  Self: TailscaleStatusEntry;
  Peer: Record<string, TailscaleStatusEntry>;
};

type ResolvedPeerIdentity = {
  machineId: string;
  publicKey: string | null;
};

export function parseTailscalePeers(status: TailscaleStatus): TailscalePeer[] {
  const peers: TailscalePeer[] = [];

  for (const peer of Object.values(status.Peer)) {
    if (!peer.Online) {
      continue;
    }
    if (!peer.Tags?.includes('tag:mesh-node')) {
      continue;
    }

    const tailscaleIp = peer.TailscaleIPs[0];
    if (!tailscaleIp) {
      continue;
    }

    peers.push({
      hostname: peer.HostName,
      tailscaleIp,
    });
  }

  return peers;
}

async function fetchTailscalePeers(logger: Logger): Promise<TailscalePeer[]> {
  try {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], {
      timeout: TAILSCALE_TIMEOUT_MS,
    });

    return parseTailscalePeers(JSON.parse(stdout) as TailscaleStatus);
  } catch (error: unknown) {
    logger.debug(
      { err: error instanceof Error ? error.message : String(error) },
      'Tailscale discovery failed',
    );
    return [];
  }
}

async function resolvePeerMachineId(syncUrl: string): Promise<ResolvedPeerIdentity | null> {
  try {
    const response = await fetch(`${syncUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as {
      machineId?: string;
      nodePublicKey?: string;
    };

    if (!body.machineId) {
      return null;
    }

    return {
      machineId: body.machineId,
      publicKey: body.nodePublicKey ?? null,
    };
  } catch {
    return null;
  }
}

async function upsertPeer(
  db: Database,
  peer: TailscalePeer & ResolvedPeerIdentity & { syncUrl: string },
): Promise<void> {
  await db.execute(
    sql`INSERT INTO sync_nodes (id, hostname, tailscale_ip, sync_url, public_key, sync_status, role)
        VALUES (${peer.machineId}, ${peer.hostname}, ${peer.tailscaleIp}, ${peer.syncUrl}, ${peer.publicKey}, 'unknown', 'full')
        ON CONFLICT (id) DO UPDATE SET
          hostname = EXCLUDED.hostname,
          tailscale_ip = EXCLUDED.tailscale_ip,
          sync_url = EXCLUDED.sync_url,
          public_key = COALESCE(EXCLUDED.public_key, sync_nodes.public_key)`,
  );
}

async function discoverPeersOnce(opts: {
  db: Database;
  logger: Logger;
  cpPort: number;
}): Promise<void> {
  const peers = await fetchTailscalePeers(opts.logger);

  for (const peer of peers) {
    const syncUrl = `http://${peer.tailscaleIp}:${opts.cpPort}`;

    try {
      const resolved = await resolvePeerMachineId(syncUrl);
      if (!resolved) {
        continue;
      }

      await upsertPeer(opts.db, {
        ...peer,
        ...resolved,
        syncUrl,
      });

      opts.logger.debug(
        { machineId: resolved.machineId, hostname: peer.hostname, syncUrl },
        'Discovered mesh peer',
      );
    } catch (error: unknown) {
      opts.logger.warn(
        {
          err: error instanceof Error ? error.message : String(error),
          hostname: peer.hostname,
          syncUrl,
        },
        'Failed to upsert discovered mesh peer',
      );
    }
  }
}

export function startDiscoveryLoop(opts: {
  db: Database;
  logger: Logger;
  cpPort?: number;
  intervalMs?: number;
}): { stop: () => void } {
  const { db, logger, cpPort = DEFAULT_CP_PORT, intervalMs = DEFAULT_DISCOVERY_INTERVAL_MS } = opts;

  void discoverPeersOnce({ db, logger, cpPort });

  const timer = setInterval(() => {
    void discoverPeersOnce({ db, logger, cpPort });
  }, intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
  };
}
