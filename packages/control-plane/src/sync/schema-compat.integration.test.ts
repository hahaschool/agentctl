import type { ChangeLogEntry, MeshEnvelopeMeta } from '@agentctl/shared';
import { MESH_PROTOCOL_VERSION } from '@agentctl/shared';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '../db/connection.js';
import type { Database } from '../db/index.js';
import { extractRows } from '../db/index.js';

import { applyChange } from './apply-change.js';
import { __setSchemaVersionForTests, MeshEnvelopeSchemaAheadError } from './mesh-compat.js';

/**
 * Schema compat two-node integration proof (roadmap 33.10).
 *
 * Extends the two-node replication pattern from PR #589 to verify the
 * apply-side schema compat gate under realistic conditions:
 *
 *   same schema    → applies
 *   +1 schema      → applies (tolerated: one-ahead grace window)
 *   +2 schema      → rejected with MESH_ENVELOPE_SCHEMA_AHEAD
 *   -1 schema      → applies (older envelopes always accepted)
 *
 * Requires a real PostgreSQL database with all migrations applied.
 * Set DATABASE_URL env var to run. Skipped if not available.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const NODE_A_ID = 'node-a-schema-compat';
const NODE_B_ID = 'node-b-schema-compat';

/** The "local" schema version we pretend the receiving node runs. */
const LOCAL_SCHEMA = 30;

type ChangeLogRow = {
  id: number;
  node_id: string;
  table_name: string;
  row_id: string;
  operation: string;
  vclock: Record<string, number>;
  payload: Record<string, unknown> | null;
  created_at: string | Date;
  synced: boolean;
};

type MachineRow = {
  id: string;
  hostname: string;
  tailscale_ip: string;
  os: string;
  arch: string;
  status: string | null;
  origin_node_id: string | null;
};

function makeEnvelopeMeta(schemaVersion: number): MeshEnvelopeMeta {
  return {
    schemaVersion,
    protocolVersion: MESH_PROTOCOL_VERSION,
    producerVersion: '0.5.1-schema-test',
  };
}

function changeLogRowToEntry(row: ChangeLogRow, schemaVersion: number): ChangeLogEntry {
  return {
    id: row.id,
    nodeId: row.node_id,
    tableName: row.table_name,
    rowId: row.row_id,
    operation: row.operation as ChangeLogEntry['operation'],
    payload: row.payload,
    vclock: row.vclock,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    synced: row.synced,
    meta: makeEnvelopeMeta(schemaVersion),
  };
}

describe.skipIf(!DATABASE_URL)('schema compat two-node integration (33.10)', () => {
  let dbA: Database;
  let dbB: Database;
  const logger = pino({ level: 'silent' });

  const testMachineIds: string[] = [];

  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for schema compat integration tests');
    }

    dbA = createDb(DATABASE_URL, { sessionNodeId: NODE_A_ID });
    dbB = createDb(DATABASE_URL, { sessionNodeId: NODE_B_ID });

    // The receiving node (B) thinks its local schema is LOCAL_SCHEMA.
    __setSchemaVersionForTests(LOCAL_SCHEMA);

    await dbA.execute(sql`SELECT 1`);
    await dbB.execute(sql`SELECT 1`);
  });

  beforeEach(async () => {
    await dbA.execute(
      sql`DELETE FROM sync_change_log WHERE node_id IN (${NODE_A_ID}, ${NODE_B_ID})`,
    );
  });

  afterAll(async () => {
    await dbA.execute(
      sql`DELETE FROM sync_change_log WHERE node_id IN (${NODE_A_ID}, ${NODE_B_ID})`,
    );

    for (const machineId of testMachineIds) {
      await dbA.execute(sql`DELETE FROM agents WHERE machine_id = ${machineId}`);
      await dbA.execute(sql`DELETE FROM machines WHERE id = ${machineId}`);
    }

    __setSchemaVersionForTests(null);

    await (dbA as unknown as { $client: { end: () => Promise<void> } }).$client.end();
    await (dbB as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  /**
   * Helper: insert a machine on node A and return the change log entry with
   * a configurable envelope schemaVersion.
   */
  async function insertMachineAndGetChange(
    machineId: string,
    envelopeSchemaVersion: number,
  ): Promise<ChangeLogEntry> {
    testMachineIds.push(machineId);

    await dbA.execute(
      sql`INSERT INTO machines (id, hostname, tailscale_ip, os, arch, status)
            VALUES (${machineId}, ${`host-${machineId}`}, '100.64.0.50', 'linux', 'x64', 'online')`,
    );

    const changeLogResult = await dbA.execute(
      sql`SELECT id, node_id, table_name, row_id, operation, vclock, payload, created_at, synced
            FROM sync_change_log
            WHERE table_name = 'machines' AND row_id = ${machineId} AND node_id = ${NODE_A_ID}
            ORDER BY id DESC LIMIT 1`,
    );
    const rows = extractRows<ChangeLogRow>(changeLogResult);
    expect(rows.length).toBe(1);

    return changeLogRowToEntry(rows[0], envelopeSchemaVersion);
  }

  // -----------------------------------------------------------------------
  // Same schema: local=30, envelope=30 → applies
  // -----------------------------------------------------------------------
  it('applies envelope with the same schema version as local', async () => {
    const machineId = `compat-same-${crypto.randomUUID().slice(0, 8)}`;
    const change = await insertMachineAndGetChange(machineId, LOCAL_SCHEMA);

    const result = await applyChange(change, dbB, logger);

    expect(result).toBe('applied');

    const machineResult = await dbB.execute(
      sql`SELECT id, hostname, origin_node_id FROM machines WHERE id = ${machineId}`,
    );
    const rows = extractRows<MachineRow>(machineResult);
    expect(rows.length).toBe(1);
    expect(rows[0].origin_node_id).toBe(NODE_A_ID);
  });

  // -----------------------------------------------------------------------
  // +1 schema: local=30, envelope=31 → applies (tolerated grace window)
  // -----------------------------------------------------------------------
  it('applies envelope one schema version ahead (+1 grace window)', async () => {
    const machineId = `compat-plus1-${crypto.randomUUID().slice(0, 8)}`;
    const change = await insertMachineAndGetChange(machineId, LOCAL_SCHEMA + 1);

    const result = await applyChange(change, dbB, logger);

    expect(result).toBe('applied');

    const machineResult = await dbB.execute(
      sql`SELECT id, hostname, origin_node_id FROM machines WHERE id = ${machineId}`,
    );
    const rows = extractRows<MachineRow>(machineResult);
    expect(rows.length).toBe(1);
    expect(rows[0].origin_node_id).toBe(NODE_A_ID);
  });

  // -----------------------------------------------------------------------
  // +2 schema: local=30, envelope=32 → rejected MESH_ENVELOPE_SCHEMA_AHEAD
  // -----------------------------------------------------------------------
  it('rejects envelope two or more schema versions ahead with MESH_ENVELOPE_SCHEMA_AHEAD', async () => {
    const machineId = `compat-plus2-${crypto.randomUUID().slice(0, 8)}`;
    const change = await insertMachineAndGetChange(machineId, LOCAL_SCHEMA + 2);

    await expect(applyChange(change, dbB, logger)).rejects.toThrow(MeshEnvelopeSchemaAheadError);

    try {
      await applyChange(change, dbB, logger);
    } catch (err) {
      expect(err).toBeInstanceOf(MeshEnvelopeSchemaAheadError);
      const schemaErr = err as MeshEnvelopeSchemaAheadError;
      expect(schemaErr.code).toBe('MESH_ENVELOPE_SCHEMA_AHEAD');
      expect(schemaErr.context.localSchemaVersion).toBe(LOCAL_SCHEMA);
      expect(schemaErr.context.envelopeSchemaVersion).toBe(LOCAL_SCHEMA + 2);
    }

    // The machine should NOT exist on node B (rejected before any DB writes).
    const machineResult = await dbB.execute(sql`SELECT id FROM machines WHERE id = ${machineId}`);
    expect(extractRows(machineResult).length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // -1 schema: local=30, envelope=29 → applies (older envelopes accepted)
  // -----------------------------------------------------------------------
  it('applies envelope with an older schema version (-1)', async () => {
    const machineId = `compat-minus1-${crypto.randomUUID().slice(0, 8)}`;
    const change = await insertMachineAndGetChange(machineId, LOCAL_SCHEMA - 1);

    const result = await applyChange(change, dbB, logger);

    expect(result).toBe('applied');

    const machineResult = await dbB.execute(
      sql`SELECT id, hostname, origin_node_id FROM machines WHERE id = ${machineId}`,
    );
    const rows = extractRows<MachineRow>(machineResult);
    expect(rows.length).toBe(1);
    expect(rows[0].origin_node_id).toBe(NODE_A_ID);
  });

  // -----------------------------------------------------------------------
  // Legacy envelope (missing meta entirely) → applies for backward compat
  // -----------------------------------------------------------------------
  it('applies legacy envelope without meta for backward compatibility', async () => {
    const machineId = `compat-legacy-${crypto.randomUUID().slice(0, 8)}`;
    testMachineIds.push(machineId);

    await dbA.execute(
      sql`INSERT INTO machines (id, hostname, tailscale_ip, os, arch, status)
            VALUES (${machineId}, ${`host-${machineId}`}, '100.64.0.51', 'linux', 'x64', 'online')`,
    );

    const changeLogResult = await dbA.execute(
      sql`SELECT id, node_id, table_name, row_id, operation, vclock, payload, created_at, synced
            FROM sync_change_log
            WHERE table_name = 'machines' AND row_id = ${machineId} AND node_id = ${NODE_A_ID}
            ORDER BY id DESC LIMIT 1`,
    );
    const rows = extractRows<ChangeLogRow>(changeLogResult);
    expect(rows.length).toBe(1);

    // Simulate a legacy producer: no meta field at all.
    const legacyEntry: ChangeLogEntry = {
      id: rows[0].id,
      nodeId: rows[0].node_id,
      tableName: rows[0].table_name,
      rowId: rows[0].row_id,
      operation: rows[0].operation as ChangeLogEntry['operation'],
      payload: rows[0].payload,
      vclock: rows[0].vclock,
      createdAt:
        rows[0].created_at instanceof Date ? rows[0].created_at : new Date(rows[0].created_at),
      synced: rows[0].synced,
      // meta intentionally omitted
    };

    const result = await applyChange(legacyEntry, dbB, logger);

    expect(result).toBe('applied');

    const machineResult = await dbB.execute(
      sql`SELECT id, origin_node_id FROM machines WHERE id = ${machineId}`,
    );
    const machineRows = extractRows<MachineRow>(machineResult);
    expect(machineRows.length).toBe(1);
    expect(machineRows[0].origin_node_id).toBe(NODE_A_ID);
  });

  // -----------------------------------------------------------------------
  // +3 schema (further ahead) → also rejected
  // -----------------------------------------------------------------------
  it('rejects envelope three schema versions ahead', async () => {
    const machineId = `compat-plus3-${crypto.randomUUID().slice(0, 8)}`;
    const change = await insertMachineAndGetChange(machineId, LOCAL_SCHEMA + 3);

    await expect(applyChange(change, dbB, logger)).rejects.toThrow(MeshEnvelopeSchemaAheadError);

    const machineResult = await dbB.execute(sql`SELECT id FROM machines WHERE id = ${machineId}`);
    expect(extractRows(machineResult).length).toBe(0);
  });
});
