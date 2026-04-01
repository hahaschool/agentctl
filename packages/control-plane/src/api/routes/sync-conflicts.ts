import type { VectorClock } from '@agentctl/shared';
import { getTablePkColumn, vcMerge } from '@agentctl/shared';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';

import type { Database } from '../../db/index.js';
import { extractRows } from '../../db/index.js';
import { withSyncApplyGuard } from '../../sync/apply-guard.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SyncConflictsRoutesOptions = {
  db: Database;
  logger: Logger;
  selfMachineId: string;
};

type ConflictRow = {
  id: string;
  table_name: string;
  row_id: string;
  local_vclock: VectorClock;
  local_payload: Record<string, unknown> | null;
  remote_vclock: VectorClock;
  remote_payload: Record<string, unknown> | null;
  remote_node_id: string;
  status: string;
  resolution: string | null;
  resolved_at: string | Date | null;
  created_at: string | Date;
};

type ListQuerystring = {
  status?: string;
  table?: string;
  remoteNodeId?: string;
};

type IdParams = {
  id: string;
};

type ResolveBody = {
  resolution: 'local' | 'remote' | 'merged';
  payload?: Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIsoString(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapConflictRow(row: ConflictRow) {
  return {
    id: row.id,
    tableName: row.table_name,
    rowId: row.row_id,
    localVclock: row.local_vclock,
    localPayload: row.local_payload,
    remoteVclock: row.remote_vclock,
    remotePayload: row.remote_payload,
    remoteNodeId: row.remote_node_id,
    status: row.status,
    resolution: row.resolution,
    resolvedAt: toIsoString(row.resolved_at),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

const VALID_RESOLUTIONS = new Set(['local', 'remote', 'merged']);

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const syncConflictsRoutes: FastifyPluginAsync<SyncConflictsRoutesOptions> = async (
  app,
  opts,
) => {
  const { db, logger, selfMachineId } = opts;

  /**
   * GET /api/sync/conflicts
   * List conflicts with optional filters: ?status=pending&table=agents&remoteNodeId=abc
   */
  app.get<{ Querystring: ListQuerystring }>(
    '/',
    {
      schema: {
        tags: ['sync'],
        summary: 'List sync conflicts',
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            table: { type: 'string' },
            remoteNodeId: { type: 'string' },
          },
        },
      },
    },
    async (request) => {
      const { status, table, remoteNodeId } = request.query;

      const conditions: ReturnType<typeof sql>[] = [];
      if (status && status.trim().length > 0) {
        conditions.push(sql`status = ${status.trim()}`);
      }
      if (table && table.trim().length > 0) {
        conditions.push(sql`table_name = ${table.trim()}`);
      }
      if (remoteNodeId && remoteNodeId.trim().length > 0) {
        conditions.push(sql`remote_node_id = ${remoteNodeId.trim()}`);
      }

      const whereClause =
        conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

      const result = await db.execute(sql`
        SELECT id, table_name, row_id, local_vclock, local_payload,
               remote_vclock, remote_payload, remote_node_id,
               status, resolution, resolved_at, created_at
        FROM sync_conflicts
        ${whereClause}
        ORDER BY created_at DESC
      `);

      const rows = extractRows<ConflictRow>(result);

      return {
        conflicts: rows.map(mapConflictRow),
        total: rows.length,
      };
    },
  );

  /**
   * GET /api/sync/conflicts/:id
   * Get a single conflict detail.
   */
  app.get<{ Params: IdParams }>(
    '/:id',
    {
      schema: {
        tags: ['sync'],
        summary: 'Get a single sync conflict',
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      const result = await db.execute(sql`
        SELECT id, table_name, row_id, local_vclock, local_payload,
               remote_vclock, remote_payload, remote_node_id,
               status, resolution, resolved_at, created_at
        FROM sync_conflicts
        WHERE id = ${id}
        LIMIT 1
      `);

      const [row] = extractRows<ConflictRow>(result);
      if (!row) {
        return reply.code(404).send({
          error: 'CONFLICT_NOT_FOUND',
          message: `Sync conflict '${id}' not found`,
        });
      }

      return mapConflictRow(row);
    },
  );

  /**
   * PUT /api/sync/conflicts/:id/resolve
   * Resolve a conflict: { resolution: 'local' | 'remote' | 'merged', payload?: {...} }
   *
   * Convergence guarantee: writes a merged vclock to sync_change_log so the
   * resolution propagates to all peers on next sync.
   */
  app.put<{ Params: IdParams; Body: ResolveBody }>(
    '/:id/resolve',
    {
      schema: {
        tags: ['sync'],
        summary: 'Resolve a sync conflict',
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { resolution, payload: userPayload } = request.body ?? {};

      // Validate resolution
      if (!resolution || !VALID_RESOLUTIONS.has(resolution)) {
        return reply.code(400).send({
          error: 'INVALID_RESOLUTION',
          message: 'resolution must be one of: local, remote, merged',
        });
      }

      if (resolution === 'merged' && userPayload === undefined) {
        return reply.code(400).send({
          error: 'MISSING_PAYLOAD',
          message: 'payload is required when resolution is "merged"',
        });
      }

      // Fetch the conflict
      const conflictResult = await db.execute(sql`
        SELECT id, table_name, row_id, local_vclock, local_payload,
               remote_vclock, remote_payload, remote_node_id,
               status, resolution AS existing_resolution, resolved_at, created_at
        FROM sync_conflicts
        WHERE id = ${id}
        LIMIT 1
      `);

      const [conflict] = extractRows<ConflictRow & { existing_resolution: string | null }>(
        conflictResult,
      );
      if (!conflict) {
        return reply.code(404).send({
          error: 'CONFLICT_NOT_FOUND',
          message: `Sync conflict '${id}' not found`,
        });
      }

      if (conflict.status === 'resolved') {
        return reply.code(409).send({
          error: 'CONFLICT_ALREADY_RESOLVED',
          message: 'This conflict has already been resolved',
        });
      }

      // Compute merged vclock for convergence
      const localVclock: VectorClock = conflict.local_vclock ?? {};
      const remoteVclock: VectorClock = conflict.remote_vclock ?? {};
      const mergedVclock = vcMerge(localVclock, remoteVclock);

      // Determine which payload wins
      const chosenPayload =
        resolution === 'local'
          ? conflict.local_payload
          : resolution === 'remote'
            ? conflict.remote_payload
            : (userPayload ?? null);

      const pkCol = getTablePkColumn(conflict.table_name);

      try {
        await withSyncApplyGuard(db, async (tx) => {
          if (chosenPayload === null) {
            // Chosen side was a DELETE — apply DELETE
            await tx.execute(
              sql`DELETE FROM ${sql.identifier(conflict.table_name)} WHERE ${sql.identifier(pkCol)} = ${conflict.row_id}`,
            );
          } else if (resolution !== 'local') {
            // 'remote' or 'merged' with non-null payload — UPSERT
            const columns = Object.keys(chosenPayload);
            const values = Object.values(chosenPayload);

            if (columns.length > 0) {
              const colList = columns.map((c) => sql.identifier(c));
              const valList = values.map((v) => sql`${v}`);
              const updateSet = columns
                .filter((c) => c !== pkCol)
                .map((c) => sql`${sql.identifier(c)} = EXCLUDED.${sql.identifier(c)}`);

              if (updateSet.length > 0) {
                await tx.execute(sql`
                  INSERT INTO ${sql.identifier(conflict.table_name)}
                  (${sql.join(colList, sql`, `)})
                  VALUES (${sql.join(valList, sql`, `)})
                  ON CONFLICT (${sql.identifier(pkCol)}) DO UPDATE SET
                  ${sql.join(updateSet, sql`, `)}
                `);
              } else {
                await tx.execute(sql`
                  INSERT INTO ${sql.identifier(conflict.table_name)}
                  (${sql.join(colList, sql`, `)})
                  VALUES (${sql.join(valList, sql`, `)})
                  ON CONFLICT (${sql.identifier(pkCol)}) DO NOTHING
                `);
              }
            }
          }
          // 'local' with non-null payload — no data change needed (row is already correct)

          // Write provenance entry with merged vclock for convergence
          const op = chosenPayload === null ? 'DELETE' : 'UPDATE';
          await tx.execute(sql`
            INSERT INTO sync_change_log
              (node_id, table_name, row_id, operation, payload, vclock)
            VALUES (
              ${selfMachineId},
              ${conflict.table_name},
              ${conflict.row_id},
              ${op},
              ${chosenPayload ? JSON.stringify(chosenPayload) : null}::jsonb,
              ${JSON.stringify(mergedVclock)}::jsonb
            )
          `);

          // Mark conflict as resolved
          await tx.execute(sql`
            UPDATE sync_conflicts
            SET status = 'resolved',
                resolution = ${resolution},
                resolved_at = now()
            WHERE id = ${id}
          `);
        });

        logger.info(
          { conflictId: id, resolution, tableName: conflict.table_name, rowId: conflict.row_id },
          'sync conflict resolved',
        );

        return { ok: true, resolution };
      } catch (err) {
        logger.error(
          { conflictId: id, err, tableName: conflict.table_name, rowId: conflict.row_id },
          'failed to resolve sync conflict',
        );

        return reply.code(500).send({
          error: 'RESOLUTION_FAILED',
          message: err instanceof Error ? err.message : 'Unknown error during conflict resolution',
        });
      }
    },
  );

  /**
   * GET /api/sync/conflicts/count
   * Returns the count of pending conflicts (for sidebar badge polling).
   */
  app.get(
    '/count',
    {
      schema: {
        tags: ['sync'],
        summary: 'Count pending sync conflicts',
      },
    },
    async () => {
      const result = await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM sync_conflicts
        WHERE status = 'pending'
      `);

      const [row] = extractRows<{ count: number }>(result);
      return { count: row?.count ?? 0 };
    },
  );
};
