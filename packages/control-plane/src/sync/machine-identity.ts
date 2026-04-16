import * as os from 'node:os';

import { sql } from 'drizzle-orm';

import type { Database } from '../db/index.js';

/**
 * Get the machine ID for this node. Uses MACHINE_ID env var (same as worker
 * registration) or derives from hostname. No separate file-based identity.
 */
export function getMachineId(): string {
  const envId = process.env.MACHINE_ID;
  if (envId) return envId;

  return (
    os
      .hostname()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 32) || 'unknown'
  );
}

export type UpsertSelfNodeOptions = {
  db: Database;
  machineId: string;
  tailscaleIp?: string;
  syncUrl?: string;
  peerVersion?: string;
  peerGitSha?: string;
  peerSchemaVersion?: number;
};

/**
 * Upsert this node into the sync_nodes registry with is_self=true.
 * Populates version and sync fields so the Mesh Peers page displays
 * accurate data for the self row (status, sync URL, version).
 * Safe to call before sync tables exist.
 */
export async function upsertSelfNode(opts: UpsertSelfNodeOptions): Promise<void> {
  const { db, machineId, tailscaleIp, syncUrl, peerVersion, peerGitSha, peerSchemaVersion } = opts;
  const hostname = os.hostname();
  await db.execute(
    sql`INSERT INTO sync_nodes (
          id, hostname, tailscale_ip, role, is_self, last_seen,
          sync_url, sync_status, peer_version, peer_git_sha, peer_schema_version
        )
        VALUES (
          ${machineId}, ${hostname}, ${tailscaleIp ?? null}, 'full', true, now(),
          ${syncUrl ?? null}, 'reachable', ${peerVersion ?? null},
          ${peerGitSha ?? null}, ${peerSchemaVersion ?? null}
        )
        ON CONFLICT (id) DO UPDATE SET
          hostname = EXCLUDED.hostname,
          tailscale_ip = EXCLUDED.tailscale_ip,
          is_self = true,
          last_seen = now(),
          sync_url = EXCLUDED.sync_url,
          sync_status = EXCLUDED.sync_status,
          peer_version = EXCLUDED.peer_version,
          peer_git_sha = EXCLUDED.peer_git_sha,
          peer_schema_version = EXCLUDED.peer_schema_version`,
  );
}
