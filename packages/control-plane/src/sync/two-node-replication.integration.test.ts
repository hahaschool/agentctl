import type { ChangeLogEntry, MeshEnvelopeMeta } from '@agentctl/shared';
import { sql } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '../db/connection.js';
import type { Database } from '../db/index.js';
import { extractRows } from '../db/index.js';

import { applyChange } from './apply-change.js';
import { __setSchemaVersionForTests } from './mesh-compat.js';

/**
 * Two-node machine replication integration test (roadmap 33.8).
 *
 * Proves that the mesh sync protocol correctly replicates machine rows
 * between two simulated nodes:
 *
 *   Node A upserts a machine (trigger fires -> change_log entry)
 *   Node B pulls the change_log entry and applies it via applyChange()
 *   Machine row appears on Node B with correct origin_node_id
 *
 * Requires a real PostgreSQL database with all migrations applied.
 * Set DATABASE_URL env var to run. Skipped if not available.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const NODE_A_ID = 'node-a-repl-test';
const NODE_B_ID = 'node-b-repl-test';

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

function makeEnvelopeMeta(): MeshEnvelopeMeta {
  return {
    schemaVersion: 30,
    protocolVersion: 1,
    producerVersion: '0.5.1-test',
  };
}

function changeLogRowToEntry(row: ChangeLogRow): ChangeLogEntry {
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
    meta: makeEnvelopeMeta(),
  };
}

describe.skipIf(!DATABASE_URL)('two-node machine replication (integration)', () => {
  let dbA: Database;
  let dbB: Database;
  const logger = pino({ level: 'silent' });

  // Track all test machine IDs for cleanup
  const testMachineIds: string[] = [];

  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for two-node replication integration tests');
    }

    // Two separate DB connections with different session node IDs,
    // simulating two independent mesh nodes sharing the same PostgreSQL.
    dbA = createDb(DATABASE_URL, { sessionNodeId: NODE_A_ID });
    dbB = createDb(DATABASE_URL, { sessionNodeId: NODE_B_ID });

    // Override the cached schema version so assertEnvelopeCompat does not
    // reject our test envelopes (the test meta has schemaVersion: 30).
    __setSchemaVersionForTests(30);

    // Warm up both pools so `app.node_id` is set on the physical connections
    await dbA.execute(sql`SELECT 1`);
    await dbB.execute(sql`SELECT 1`);
  });

  beforeEach(async () => {
    // Clean up change log entries from both test nodes
    await dbA.execute(
      sql`DELETE FROM sync_change_log WHERE node_id IN (${NODE_A_ID}, ${NODE_B_ID})`,
    );
  });

  afterAll(async () => {
    // Clean up all test artifacts
    await dbA.execute(
      sql`DELETE FROM sync_change_log WHERE node_id IN (${NODE_A_ID}, ${NODE_B_ID})`,
    );

    for (const machineId of testMachineIds) {
      await dbA.execute(sql`DELETE FROM agents WHERE machine_id = ${machineId}`);
      await dbA.execute(sql`DELETE FROM machines WHERE id = ${machineId}`);
    }

    __setSchemaVersionForTests(null);

    // Close pools to prevent Vitest from hanging
    await (dbA as unknown as { $client: { end: () => Promise<void> } }).$client.end();
    await (dbB as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  it('replicates a machine inserted on node A to node B via change log', async () => {
    const machineId = `repl-test-a-${crypto.randomUUID().slice(0, 8)}`;
    testMachineIds.push(machineId);

    // --- Step 1: Node A inserts a machine (simulating worker registration) ---
    await dbA.execute(
      sql`INSERT INTO machines (id, hostname, tailscale_ip, os, arch, status)
          VALUES (${machineId}, ${`host-${machineId}`}, '100.64.0.50', 'linux', 'x64', 'online')`,
    );

    // --- Step 2: Verify the trigger fired and created a change log entry ---
    const changeLogResult = await dbA.execute(
      sql`SELECT id, node_id, table_name, row_id, operation, vclock, payload, created_at, synced
          FROM sync_change_log
          WHERE table_name = 'machines' AND row_id = ${machineId} AND node_id = ${NODE_A_ID}
          ORDER BY id DESC LIMIT 1`,
    );
    const changeLogRows = extractRows<ChangeLogRow>(changeLogResult);

    expect(changeLogRows.length).toBe(1);
    expect(changeLogRows[0].operation).toBe('INSERT');
    expect(changeLogRows[0].vclock).toEqual({ [NODE_A_ID]: 1 });
    expect(changeLogRows[0].payload).toBeDefined();

    const changeEntry = changeLogRowToEntry(changeLogRows[0]);

    // --- Step 3: Node B applies the pulled change ---
    const applyResult = await applyChange(changeEntry, dbB, logger);

    expect(applyResult).toBe('applied');

    // --- Step 4: Verify the machine row exists with correct origin_node_id ---
    const machineResult = await dbB.execute(
      sql`SELECT id, hostname, tailscale_ip, os, arch, status, origin_node_id
          FROM machines
          WHERE id = ${machineId}`,
    );
    const machineRows = extractRows<MachineRow>(machineResult);

    expect(machineRows.length).toBe(1);
    expect(machineRows[0].id).toBe(machineId);
    expect(machineRows[0].hostname).toBe(`host-${machineId}`);
    expect(machineRows[0].os).toBe('linux');
    expect(machineRows[0].arch).toBe('x64');
    expect(machineRows[0].origin_node_id).toBe(NODE_A_ID);
  });

  it('replicates a machine from node B to node A (reverse direction)', async () => {
    const machineId = `repl-test-b-${crypto.randomUUID().slice(0, 8)}`;
    testMachineIds.push(machineId);

    // --- Node B inserts a machine ---
    await dbB.execute(
      sql`INSERT INTO machines (id, hostname, tailscale_ip, os, arch, status)
          VALUES (${machineId}, ${`host-${machineId}`}, '100.64.0.60', 'darwin', 'arm64', 'online')`,
    );

    // --- Read change log entry from node B ---
    const changeLogResult = await dbB.execute(
      sql`SELECT id, node_id, table_name, row_id, operation, vclock, payload, created_at, synced
          FROM sync_change_log
          WHERE table_name = 'machines' AND row_id = ${machineId} AND node_id = ${NODE_B_ID}
          ORDER BY id DESC LIMIT 1`,
    );
    const changeLogRows = extractRows<ChangeLogRow>(changeLogResult);

    expect(changeLogRows.length).toBe(1);
    const changeEntry = changeLogRowToEntry(changeLogRows[0]);

    // --- Node A applies the change ---
    const applyResult = await applyChange(changeEntry, dbA, logger);

    expect(applyResult).toBe('applied');

    // --- Verify machine exists on node A with origin_node_id pointing to B ---
    const machineResult = await dbA.execute(
      sql`SELECT id, hostname, os, arch, origin_node_id
          FROM machines
          WHERE id = ${machineId}`,
    );
    const machineRows = extractRows<MachineRow>(machineResult);

    expect(machineRows.length).toBe(1);
    expect(machineRows[0].origin_node_id).toBe(NODE_B_ID);
    expect(machineRows[0].os).toBe('darwin');
    expect(machineRows[0].arch).toBe('arm64');
  });

  it('updates a replicated machine row when node A sends an update', async () => {
    const machineId = `repl-test-upd-${crypto.randomUUID().slice(0, 8)}`;
    testMachineIds.push(machineId);

    // --- Insert on node A ---
    await dbA.execute(
      sql`INSERT INTO machines (id, hostname, tailscale_ip, os, arch, status)
          VALUES (${machineId}, ${`host-${machineId}`}, '100.64.0.70', 'linux', 'x64', 'online')`,
    );

    // --- Replicate INSERT to node B ---
    const insertResult = await dbA.execute(
      sql`SELECT id, node_id, table_name, row_id, operation, vclock, payload, created_at, synced
          FROM sync_change_log
          WHERE table_name = 'machines' AND row_id = ${machineId} AND node_id = ${NODE_A_ID}
          ORDER BY id ASC LIMIT 1`,
    );
    const insertRows = extractRows<ChangeLogRow>(insertResult);
    const insertEntry = changeLogRowToEntry(insertRows[0]);

    await applyChange(insertEntry, dbB, logger);

    // --- Node A updates the machine status ---
    await dbA.execute(sql`UPDATE machines SET status = 'offline' WHERE id = ${machineId}`);

    // --- Read the UPDATE change log entry ---
    const updateResult = await dbA.execute(
      sql`SELECT id, node_id, table_name, row_id, operation, vclock, payload, created_at, synced
          FROM sync_change_log
          WHERE table_name = 'machines' AND row_id = ${machineId} AND node_id = ${NODE_A_ID}
            AND operation = 'UPDATE'
          ORDER BY id DESC LIMIT 1`,
    );
    const updateRows = extractRows<ChangeLogRow>(updateResult);

    expect(updateRows.length).toBe(1);
    expect(updateRows[0].vclock).toEqual({ [NODE_A_ID]: 2 });

    const updateEntry = changeLogRowToEntry(updateRows[0]);

    // --- Apply update on node B ---
    const applyResult = await applyChange(updateEntry, dbB, logger);

    expect(applyResult).toBe('applied');

    // --- Verify the update propagated ---
    const machineResult = await dbB.execute(
      sql`SELECT id, status, origin_node_id
          FROM machines
          WHERE id = ${machineId}`,
    );
    const machineRows = extractRows<MachineRow>(machineResult);

    expect(machineRows.length).toBe(1);
    expect(machineRows[0].status).toBe('offline');
    expect(machineRows[0].origin_node_id).toBe(NODE_A_ID);
  });

  it('skips stale updates when local vclock dominates remote', async () => {
    const machineId = `repl-test-stale-${crypto.randomUUID().slice(0, 8)}`;
    testMachineIds.push(machineId);

    // --- Insert on node A and replicate to B ---
    await dbA.execute(
      sql`INSERT INTO machines (id, hostname, tailscale_ip, os, arch, status)
          VALUES (${machineId}, ${`host-${machineId}`}, '100.64.0.80', 'linux', 'x64', 'online')`,
    );

    const insertResult = await dbA.execute(
      sql`SELECT id, node_id, table_name, row_id, operation, vclock, payload, created_at, synced
          FROM sync_change_log
          WHERE table_name = 'machines' AND row_id = ${machineId} AND node_id = ${NODE_A_ID}
          ORDER BY id ASC LIMIT 1`,
    );
    const insertEntry = changeLogRowToEntry(extractRows<ChangeLogRow>(insertResult)[0]);
    await applyChange(insertEntry, dbB, logger);

    // --- Node A updates twice (vclock goes to {node-a: 3}) ---
    await dbA.execute(sql`UPDATE machines SET status = 'maintenance' WHERE id = ${machineId}`);
    await dbA.execute(sql`UPDATE machines SET status = 'online' WHERE id = ${machineId}`);

    // --- Replicate both updates to B ---
    const updatesResult = await dbA.execute(
      sql`SELECT id, node_id, table_name, row_id, operation, vclock, payload, created_at, synced
          FROM sync_change_log
          WHERE table_name = 'machines' AND row_id = ${machineId} AND node_id = ${NODE_A_ID}
            AND operation = 'UPDATE'
          ORDER BY id ASC`,
    );
    const updateEntries = extractRows<ChangeLogRow>(updatesResult).map(changeLogRowToEntry);

    // Apply the second update first (vclock {node-a: 3})
    const laterUpdate = updateEntries[1];
    const applyLater = await applyChange(laterUpdate, dbB, logger);
    expect(applyLater).toBe('applied');

    // Now try to apply the first update (vclock {node-a: 2}) — should be skipped
    const earlierUpdate = updateEntries[0];
    const applyEarlier = await applyChange(earlierUpdate, dbB, logger);
    expect(applyEarlier).toBe('skipped');

    // --- Verify machine has the latest status ---
    const machineResult = await dbB.execute(
      sql`SELECT status FROM machines WHERE id = ${machineId}`,
    );
    const rows = extractRows<MachineRow>(machineResult);

    expect(rows[0].status).toBe('online');
  });

  it('does not re-fire the sync trigger when applying remote changes (apply guard)', async () => {
    const machineId = `repl-test-guard-${crypto.randomUUID().slice(0, 8)}`;
    testMachineIds.push(machineId);

    // --- Insert on node A ---
    await dbA.execute(
      sql`INSERT INTO machines (id, hostname, tailscale_ip, os, arch, status)
          VALUES (${machineId}, ${`host-${machineId}`}, '100.64.0.90', 'linux', 'x64', 'online')`,
    );

    // Read the change log entry
    const clResult = await dbA.execute(
      sql`SELECT id, node_id, table_name, row_id, operation, vclock, payload, created_at, synced
          FROM sync_change_log
          WHERE table_name = 'machines' AND row_id = ${machineId} AND node_id = ${NODE_A_ID}
          ORDER BY id DESC LIMIT 1`,
    );
    const changeEntry = changeLogRowToEntry(extractRows<ChangeLogRow>(clResult)[0]);

    // --- Apply on node B ---
    await applyChange(changeEntry, dbB, logger);

    // --- Check that node B did NOT produce its own trigger-based change log entry ---
    // The withSyncApplyGuard sets `app.sync_applying = 'true'` which suppresses
    // the trigger. Only the change log entry written by applyChange itself
    // (with node_id = NODE_A_ID, the remote node) should be present.
    const bChangeLog = await dbB.execute(
      sql`SELECT node_id, operation
          FROM sync_change_log
          WHERE table_name = 'machines' AND row_id = ${machineId} AND node_id = ${NODE_B_ID}`,
    );
    const bEntries = extractRows<ChangeLogRow>(bChangeLog);

    // Node B should NOT have its own trigger-generated entries
    expect(bEntries.length).toBe(0);
  });
});
