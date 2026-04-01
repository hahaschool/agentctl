import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';

import type { Database } from '../../db/index.js';
import { extractRows } from '../../db/index.js';
import { createSyncAuthHook } from '../../sync/sync-auth.js';
import { readRateLimitEnv } from '../rate-limit.js';

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5_000;
const SYNC_RATE_LIMIT = {
  max: 120,
  timeWindow: '1 minute',
} as const;

type SyncRoutesOptions = {
  db: Database;
  logger: Logger;
  /** Machine ID of this node (for ACK target validation). */
  selfMachineId: string;
};

type ChangeLogRow = {
  id: number;
  node_id: string;
  table_name: string;
  row_id: string;
  operation: string;
  payload: Record<string, unknown> | null;
  vclock: Record<string, number>;
  created_at: string | Date;
  synced: boolean;
};

type ChangesQuerystring = {
  since?: string;
  limit?: string;
};

type AckBody = {
  machineId?: string;
  cursor?: number;
};

function mapChangeLogRow(row: ChangeLogRow) {
  return {
    id: row.id,
    nodeId: row.node_id,
    tableName: row.table_name,
    rowId: row.row_id,
    operation: row.operation,
    payload: row.payload,
    vclock: row.vclock,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    synced: row.synced,
  };
}

export const syncRoutes: FastifyPluginAsync<SyncRoutesOptions> = async (app, opts) => {
  const { db, logger, selfMachineId } = opts;
  const syncRateLimitMax = readRateLimitEnv('SYNC_ROUTE_RATE_LIMIT_MAX', SYNC_RATE_LIMIT.max);
  const syncRateLimitWindowMs = readRateLimitEnv('SYNC_ROUTE_RATE_LIMIT_WINDOW_MS', 60_000);
  const syncRouteRateLimit = {
    max: syncRateLimitMax,
    timeWindow: syncRateLimitWindowMs,
  } as const;
  const syncRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many requests',
  });
  const getSyncRateLimitKey = (request: {
    ip?: string;
    headers: Record<string, string | string[] | undefined>;
  }) => {
    const verifiedPeerId = request.headers['x-verified-peer-id'];
    if (typeof verifiedPeerId === 'string' && verifiedPeerId.trim().length > 0) {
      return `peer:${verifiedPeerId.trim()}`;
    }

    return (
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown')
    );
  };
  const syncFastifyRateLimit = {
    ...syncRouteRateLimit,
    keyGenerator: getSyncRateLimitKey,
    errorResponseBuilder: syncRateLimitError,
  } as const;

  // Register auth hook for all routes in this plugin
  const authHook = createSyncAuthHook({ db, logger });
  app.addHook('preHandler', authHook);
  await app.register(rateLimit, {
    global: false,
    keyGenerator: getSyncRateLimitKey,
    errorResponseBuilder: syncRateLimitError,
  });

  /**
   * GET /api/sync/changes?since=<cursor>&limit=<n>
   * Returns changes from sync_change_log after the given cursor.
   */
  app.get<{ Querystring: ChangesQuerystring }>(
    '/changes',
    {
      config: { rateLimit: syncFastifyRateLimit },
      schema: {
        tags: ['sync'],
        summary: 'Pull sync changes from this node',
        querystring: {
          type: 'object',
          properties: {
            since: { type: 'string' },
            limit: { type: 'string' },
          },
        },
      },
      preHandler: app.rateLimit(syncFastifyRateLimit),
    },
    async (request) => {
      const since = Number(request.query.since) || 0;
      const rawLimit = Number(request.query.limit) || DEFAULT_LIMIT;
      const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT);

      // Fetch limit+1 to detect hasMore without a separate COUNT query
      const result = await db.execute(sql`
        SELECT id, node_id, table_name, row_id, operation, payload, vclock, created_at, synced
        FROM sync_change_log
        WHERE id > ${since}
        ORDER BY id ASC
        LIMIT ${limit + 1}
      `);

      const rows = extractRows<ChangeLogRow>(result);
      const hasMore = rows.length > limit;
      const changes = hasMore ? rows.slice(0, limit) : rows;
      const lastEntry = changes[changes.length - 1];
      const cursor = lastEntry?.id ?? since;

      return {
        changes: changes.map(mapChangeLogRow),
        cursor,
        hasMore,
      };
    },
  );

  /**
   * POST /api/sync/ack
   * Remote peer acknowledges it has applied changes up to the given cursor.
   */
  app.post<{ Body: AckBody }>(
    '/ack',
    {
      config: { rateLimit: syncFastifyRateLimit },
      schema: {
        tags: ['sync'],
        summary: 'Acknowledge sync cursor from a remote peer',
      },
      preHandler: app.rateLimit(syncFastifyRateLimit),
    },
    async (request, reply) => {
      const { machineId, cursor } = request.body ?? {};

      if (!machineId || typeof machineId !== 'string' || machineId.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_MACHINE_ID',
          message: 'A non-empty "machineId" string is required',
        });
      }

      if (typeof cursor !== 'number' || !Number.isFinite(cursor) || cursor < 0) {
        return reply.code(400).send({
          error: 'INVALID_CURSOR',
          message: 'A non-negative numeric "cursor" is required',
        });
      }

      // Verify the ACK machineId matches the authenticated peer
      const verifiedPeerId = request.headers['x-verified-peer-id'];
      if (verifiedPeerId && verifiedPeerId !== machineId.trim()) {
        return reply.code(403).send({
          error: 'SYNC_AUTH_MISMATCH',
          message: 'ACK machineId does not match authenticated peer',
        });
      }

      await db.execute(sql`
        INSERT INTO sync_peer_cursors (local_node_id, remote_node_id, acked_cursor, updated_at)
        VALUES (${selfMachineId}, ${machineId.trim()}, ${cursor}, now())
        ON CONFLICT (local_node_id, remote_node_id) DO UPDATE SET
          acked_cursor = GREATEST(sync_peer_cursors.acked_cursor, EXCLUDED.acked_cursor),
          updated_at = now()
      `);

      return { ok: true };
    },
  );
};
