import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import { extractRows } from '../../db/index.js';
import { computeNextInterval } from '../../sync/peer-health.js';

const DEFAULT_INTERVAL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5_000;

type SyncPeersRoutesOptions = {
  db: Database;
};

type SyncPeerRow = {
  id: string;
  hostname: string;
  tailscale_ip: string | null;
  sync_url: string | null;
  role: string | null;
  sync_status: string | null;
  sync_interval_ms: number | null;
  is_self: boolean | null;
  public_key: string | null;
  last_seen: string | Date | null;
  created_at: string | Date | null;
};

type UpsertSyncPeerBody = {
  machineId?: string;
  hostname?: string;
  tailscaleIp?: string;
  syncUrl?: string;
  role?: string;
  syncStatus?: string;
  syncIntervalMs?: number;
  isSelf?: boolean;
  publicKey?: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function toIsoString(value: string | Date | null): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapSyncPeerRow(row: SyncPeerRow) {
  return {
    machineId: row.id,
    hostname: row.hostname,
    tailscaleIp: row.tailscale_ip,
    syncUrl: row.sync_url,
    role: row.role ?? 'full',
    syncStatus: row.sync_status ?? 'unknown',
    syncIntervalMs: row.sync_interval_ms ?? DEFAULT_INTERVAL_MS,
    isSelf: row.is_self ?? false,
    publicKey: row.public_key,
    lastSeen: toIsoString(row.last_seen),
    createdAt: toIsoString(row.created_at),
  };
}

async function fetchPeer(db: Database, machineId: string): Promise<SyncPeerRow | null> {
  const result = await db.execute(sql`
    SELECT id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key, last_seen, created_at
    FROM sync_nodes
    WHERE id = ${machineId}
    LIMIT 1
  `);
  const [peer] = extractRows<SyncPeerRow>(result);
  return peer ?? null;
}

async function pingPeer(syncUrl: string): Promise<'reachable' | 'unreachable'> {
  try {
    const response = await fetch(`${syncUrl}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok ? 'reachable' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

export const syncPeersRoutes: FastifyPluginAsync<SyncPeersRoutesOptions> = async (app, opts) => {
  const { db } = opts;

  app.get(
    '/',
    {
      schema: {
        tags: ['sync'],
        summary: 'List mesh sync peers',
      },
    },
    async () => {
      const result = await db.execute(sql`
        SELECT id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key, last_seen, created_at
        FROM sync_nodes
        ORDER BY hostname ASC, id ASC
      `);

      return {
        peers: extractRows<SyncPeerRow>(result).map(mapSyncPeerRow),
      };
    },
  );

  app.post<{ Body: UpsertSyncPeerBody }>(
    '/',
    {
      schema: {
        tags: ['sync'],
        summary: 'Create or update a mesh sync peer',
      },
    },
    async (request, reply) => {
      const {
        machineId,
        hostname,
        tailscaleIp,
        syncUrl,
        role,
        syncStatus,
        syncIntervalMs,
        isSelf,
        publicKey,
      } = request.body ?? {};

      if (!isNonEmptyString(machineId)) {
        return reply.code(400).send({
          error: 'INVALID_MACHINE_ID',
          message: 'A non-empty "machineId" string is required',
        });
      }

      if (!isNonEmptyString(hostname)) {
        return reply.code(400).send({
          error: 'INVALID_HOSTNAME',
          message: 'A non-empty "hostname" string is required',
        });
      }

      if (!isNonEmptyString(syncUrl)) {
        return reply.code(400).send({
          error: 'INVALID_SYNC_URL',
          message: 'A non-empty "syncUrl" string is required',
        });
      }

      const result = await db.execute(sql`
        INSERT INTO sync_nodes (id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key)
        VALUES (
          ${machineId.trim()},
          ${hostname.trim()},
          ${tailscaleIp?.trim() ?? null},
          ${syncUrl.trim()},
          ${role?.trim() ?? 'full'},
          ${syncStatus?.trim() ?? 'unknown'},
          ${syncIntervalMs ?? DEFAULT_INTERVAL_MS},
          ${isSelf ?? false},
          ${publicKey?.trim() ?? null}
        )
        ON CONFLICT (id) DO UPDATE SET
          hostname = EXCLUDED.hostname,
          tailscale_ip = EXCLUDED.tailscale_ip,
          sync_url = EXCLUDED.sync_url,
          role = EXCLUDED.role,
          sync_status = EXCLUDED.sync_status,
          sync_interval_ms = EXCLUDED.sync_interval_ms,
          is_self = EXCLUDED.is_self,
          public_key = EXCLUDED.public_key
        RETURNING id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key, last_seen, created_at
      `);
      const [peer] = extractRows<SyncPeerRow>(result);

      return reply.code(201).send({
        ok: true,
        peer: peer ? mapSyncPeerRow(peer) : null,
      });
    },
  );

  app.delete<{ Params: { machineId: string } }>(
    '/:machineId',
    {
      schema: {
        tags: ['sync'],
        summary: 'Delete a mesh sync peer',
      },
    },
    async (request, reply) => {
      const { machineId } = request.params;

      if (!isNonEmptyString(machineId)) {
        return reply.code(400).send({
          error: 'INVALID_MACHINE_ID',
          message: 'A non-empty "machineId" path parameter is required',
        });
      }

      const result = await db.execute(sql`
        DELETE FROM sync_nodes
        WHERE id = ${machineId.trim()}
        RETURNING id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key, last_seen, created_at
      `);
      const [peer] = extractRows<SyncPeerRow>(result);

      if (!peer) {
        return reply.code(404).send({
          error: 'SYNC_PEER_NOT_FOUND',
          message: `Sync peer '${machineId}' not found`,
        });
      }

      return {
        ok: true,
        peer: mapSyncPeerRow(peer),
      };
    },
  );

  app.post<{ Params: { machineId: string } }>(
    '/:machineId/ping',
    {
      schema: {
        tags: ['sync'],
        summary: 'Ping a mesh sync peer via /health',
      },
    },
    async (request, reply) => {
      const { machineId } = request.params;

      if (!isNonEmptyString(machineId)) {
        return reply.code(400).send({
          error: 'INVALID_MACHINE_ID',
          message: 'A non-empty "machineId" path parameter is required',
        });
      }

      const peer = await fetchPeer(db, machineId.trim());
      if (!peer) {
        return reply.code(404).send({
          error: 'SYNC_PEER_NOT_FOUND',
          message: `Sync peer '${machineId}' not found`,
        });
      }

      if (!isNonEmptyString(peer.sync_url)) {
        return reply.code(400).send({
          error: 'SYNC_PEER_MISSING_URL',
          message: `Sync peer '${machineId}' does not have a syncUrl configured`,
        });
      }

      const status = await pingPeer(peer.sync_url);
      const nextInterval = computeNextInterval(
        peer.sync_interval_ms ?? DEFAULT_INTERVAL_MS,
        status,
      );

      const updateResult =
        status === 'reachable'
          ? await db.execute(sql`
              UPDATE sync_nodes
              SET sync_status = 'reachable',
                  sync_interval_ms = ${nextInterval},
                  last_seen = now()
              WHERE id = ${machineId.trim()}
              RETURNING id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key, last_seen, created_at
            `)
          : await db.execute(sql`
              UPDATE sync_nodes
              SET sync_status = 'unreachable',
                  sync_interval_ms = ${nextInterval}
              WHERE id = ${machineId.trim()}
              RETURNING id, hostname, tailscale_ip, sync_url, role, sync_status, sync_interval_ms, is_self, public_key, last_seen, created_at
            `);

      const [updatedPeer] = extractRows<SyncPeerRow>(updateResult);

      return {
        ok: true,
        status,
        peer: updatedPeer ? mapSyncPeerRow(updatedPeer) : mapSyncPeerRow(peer),
      };
    },
  );
};
