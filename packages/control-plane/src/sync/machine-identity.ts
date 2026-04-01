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

/**
 * Upsert this node into the sync_nodes registry with is_self=true.
 * Safe to call before sync tables exist.
 */
export async function upsertSelfNode(
  db: Database,
  machineId: string,
  tailscaleIp?: string,
): Promise<void> {
  const hostname = os.hostname();
  await db.execute(
    sql`INSERT INTO sync_nodes (id, hostname, tailscale_ip, role, is_self, last_seen)
        VALUES (${machineId}, ${hostname}, ${tailscaleIp ?? null}, 'full', true, now())
        ON CONFLICT (id) DO UPDATE SET
          hostname = EXCLUDED.hostname,
          tailscale_ip = EXCLUDED.tailscale_ip,
          is_self = true,
          last_seen = now()`,
  );
}
