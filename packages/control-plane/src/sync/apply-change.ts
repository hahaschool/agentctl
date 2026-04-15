import type { ChangeLogEntry, VectorClock } from '@agentctl/shared';
import { getTablePkColumn, TABLE_SYNC_CONFIG, vcCompare, vcMerge } from '@agentctl/shared';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { extractRows } from '../db/index.js';

import { withSyncApplyGuard } from './apply-guard.js';
import { assertEnvelopeCompat, getLocalSchemaVersion } from './mesh-compat.js';

/**
 * Record a `MESH_ENVELOPE_SCHEMA_AHEAD` rejection against the offending peer's
 * `sync_nodes` row so operators can see on `/mesh-peers` which peer sent the
 * envelope our apply gate could not accept (roadmap §33.10).
 *
 * Returns the post-update row count via `result.rowCount` (best-effort — the
 * driver's exact shape varies) and logs at WARN level. Failures to persist the
 * rejection MUST NOT mask the original rejection; callers already logged the
 * reject reason, so we only record a secondary WARN here if the UPDATE fails.
 *
 * The row is a no-op when no matching `sync_nodes` row exists (e.g. an envelope
 * from an unregistered node): `UPDATE ... WHERE id = ?` simply affects zero
 * rows. That is intentional — we do not want this helper to silently insert
 * rows and implicitly register unknown peers.
 */
export async function recordSchemaAheadRejection(
  db: Database,
  machineId: string,
  envelopeSchemaVersion: number,
  logger?: Logger,
): Promise<void> {
  if (!machineId || !Number.isFinite(envelopeSchemaVersion)) {
    return;
  }

  try {
    await db.execute(sql`
      UPDATE sync_nodes
      SET last_schema_ahead_version = ${envelopeSchemaVersion},
          last_schema_ahead_at = now(),
          schema_ahead_count = COALESCE(schema_ahead_count, 0) + 1
      WHERE id = ${machineId}
    `);
  } catch (err) {
    logger?.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        machineId,
        envelopeSchemaVersion,
      },
      'Failed to persist schema-ahead rejection on sync_nodes',
    );
  }
}

export type ApplyResult = 'applied' | 'skipped' | 'conflict';

type LatestChangeRow = {
  vclock: VectorClock;
  payload: Record<string, unknown> | null;
};

function payloadWithRemoteMachineProvenance(
  tableName: string,
  nodeId: string,
  payload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (tableName !== 'machines' || !payload) {
    return payload;
  }

  const next = { ...payload };
  if ('originNodeId' in next && !('origin_node_id' in next)) {
    next.origin_node_id = next.originNodeId;
  }
  delete next.originNodeId;

  if (next.origin_node_id == null || next.origin_node_id === '') {
    next.origin_node_id = nodeId;
  }

  return next;
}

/**
 * Apply a single remote change to the local database.
 * Routes to append-only or mutable logic based on TABLE_SYNC_CONFIG.
 *
 * Before routing, validates the envelope's mesh compat metadata (schemaVersion,
 * protocolVersion). Rejects envelopes that are too far ahead of the local
 * schema or outside the supported protocol window; legacy envelopes missing
 * `meta` are accepted for backward compat (with a WARN log). See
 * `./mesh-compat.ts` and `docs/MESH_COMPAT.md`.
 */
export async function applyChange(
  change: ChangeLogEntry,
  db: Database,
  logger?: Logger,
): Promise<ApplyResult> {
  // Compat gate first: reject unsupported envelopes before any DB side effects.
  assertEnvelopeCompat(change, getLocalSchemaVersion(), logger);

  const tableType = TABLE_SYNC_CONFIG[change.tableName];

  if (!tableType || tableType === 'local-only') {
    return 'skipped';
  }

  if (tableType === 'append-only') {
    return applyAppendOnly(change, db);
  }

  return applyMutable(change, db);
}

/**
 * Apply an append-only change: INSERT if PK does not exist, skip otherwise.
 */
async function applyAppendOnly(
  change: ChangeLogEntry,
  db: Database,
): Promise<'applied' | 'skipped'> {
  const pkCol = getTablePkColumn(change.tableName);

  // Check existence outside the guard (read-only, no trigger concern)
  const existing = await db.execute(
    sql`SELECT 1 FROM ${sql.identifier(change.tableName)} WHERE ${sql.identifier(pkCol)} = ${change.rowId} LIMIT 1`,
  );

  if (extractRows(existing).length > 0) {
    return 'skipped';
  }

  // INSERT inside guard to suppress sync trigger re-fire
  await withSyncApplyGuard(db, async (tx) => {
    if (change.payload) {
      const columns = Object.keys(change.payload);
      const values = Object.values(change.payload);

      if (columns.length > 0) {
        const colList = columns.map((c) => sql.identifier(c));
        const valList = values.map((v) => sql`${v}`);

        await tx.execute(sql`
          INSERT INTO ${sql.identifier(change.tableName)}
          (${sql.join(colList, sql`, `)})
          VALUES (${sql.join(valList, sql`, `)})
          ON CONFLICT (${sql.identifier(pkCol)}) DO NOTHING
        `);
      }
    }

    // Record in local change log with remote vclock
    await tx.execute(sql`
      INSERT INTO sync_change_log (node_id, table_name, row_id, operation, payload, vclock)
      VALUES (${change.nodeId}, ${change.tableName}, ${change.rowId}, ${change.operation},
              ${change.payload ? JSON.stringify(change.payload) : null}::jsonb,
              ${JSON.stringify(change.vclock)}::jsonb)
    `);
  });

  return 'applied';
}

/**
 * Apply a mutable change using vector clock comparison.
 * Advisory lock + all logic runs inside withSyncApplyGuard transaction.
 */
async function applyMutable(change: ChangeLogEntry, db: Database): Promise<ApplyResult> {
  return withSyncApplyGuard(db, async (tx) => {
    const payload = payloadWithRemoteMachineProvenance(
      change.tableName,
      change.nodeId,
      change.payload,
    );

    // Advisory lock INSIDE the transaction (xact-scoped, released at tx end)
    const lockKey = `${change.tableName}:${change.rowId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);

    // Get latest local vclock for this table+row from the change log
    const latestResult = await tx.execute(sql`
      SELECT vclock, payload
      FROM sync_change_log
      WHERE table_name = ${change.tableName}
        AND row_id = ${change.rowId}
      ORDER BY id DESC
      LIMIT 1
    `);

    const [localEntry] = extractRows<LatestChangeRow>(latestResult);
    const localVclock: VectorClock = (localEntry?.vclock as VectorClock) ?? {};
    const remoteVclock: VectorClock = change.vclock;

    // vcCompare(remote, local): a_dominates means remote wins
    const comparison = vcCompare(remoteVclock, localVclock);

    if (comparison === 'a_dominates') {
      const pkCol = getTablePkColumn(change.tableName);

      if (change.operation === 'DELETE') {
        await tx.execute(sql`
          DELETE FROM ${sql.identifier(change.tableName)}
          WHERE ${sql.identifier(pkCol)} = ${change.rowId}
        `);
      } else if (payload) {
        // UPSERT: try insert, on conflict update all payload columns
        const columns = Object.keys(payload);
        const values = Object.values(payload);

        if (columns.length > 0) {
          const colList = columns.map((c) => sql.identifier(c));
          const valList = values.map((v) => sql`${v}`);
          const updateSet = columns
            .filter((c) => c !== pkCol)
            .map((c) => sql`${sql.identifier(c)} = EXCLUDED.${sql.identifier(c)}`);

          if (updateSet.length > 0) {
            await tx.execute(sql`
              INSERT INTO ${sql.identifier(change.tableName)}
              (${sql.join(colList, sql`, `)})
              VALUES (${sql.join(valList, sql`, `)})
              ON CONFLICT (${sql.identifier(pkCol)}) DO UPDATE SET
              ${sql.join(updateSet, sql`, `)}
            `);
          } else {
            await tx.execute(sql`
              INSERT INTO ${sql.identifier(change.tableName)}
              (${sql.join(colList, sql`, `)})
              VALUES (${sql.join(valList, sql`, `)})
              ON CONFLICT (${sql.identifier(pkCol)}) DO NOTHING
            `);
          }
        }
      }

      // Record merged vclock in local change log
      const merged = vcMerge(remoteVclock, localVclock);
      await tx.execute(sql`
        INSERT INTO sync_change_log (node_id, table_name, row_id, operation, payload, vclock)
        VALUES (${change.nodeId}, ${change.tableName}, ${change.rowId}, ${change.operation},
                ${payload ? JSON.stringify(payload) : null}::jsonb,
                ${JSON.stringify(merged)}::jsonb)
      `);

      return 'applied';
    }

    if (comparison === 'conflict') {
      // Record conflict for manual resolution
      await tx.execute(sql`
        INSERT INTO sync_conflicts
          (table_name, row_id, local_vclock, local_payload, remote_vclock, remote_payload, remote_node_id)
        VALUES (
          ${change.tableName},
          ${change.rowId},
          ${JSON.stringify(localVclock)}::jsonb,
          ${localEntry?.payload ? JSON.stringify(localEntry.payload) : null}::jsonb,
          ${JSON.stringify(remoteVclock)}::jsonb,
          ${payload ? JSON.stringify(payload) : null}::jsonb,
          ${change.nodeId}
        )
      `);

      return 'conflict';
    }

    // b_dominates or equal: local is newer or same, skip
    return 'skipped';
  });
}
