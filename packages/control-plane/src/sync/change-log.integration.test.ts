import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '../db/connection.js';
import { extractRows } from '../db/index.js';

/**
 * Integration tests for the sync_change_log trigger.
 * Requires a real PostgreSQL database with migration drizzle/0021 applied.
 * Set DATABASE_URL env var to run. Skipped if not available.
 *
 * NOTE: agents.machine_id is FK to machines.id, so we create a test machine first.
 * agents table columns: id, machine_id, name, type, status, project_path, ...
 * (NO 'trigger' column — that's the RunTrigger type in agent_runs, not agents.)
 */
const DATABASE_URL = process.env.DATABASE_URL;

type ChangeLogRow = {
  node_id: string;
  table_name: string;
  row_id: string;
  operation: string;
  vclock: Record<string, number>;
  payload: Record<string, unknown> | null;
};

describe.skipIf(!DATABASE_URL)('sync_change_log trigger (integration)', () => {
  let db: ReturnType<typeof createDb>;
  const testMachineId = 'test-machine-sync';

  beforeAll(async () => {
    db = createDb(DATABASE_URL!, { sessionNodeId: 'node-test-0001' });
    // Create a test machine so agents FK constraint is satisfied
    await db.execute(
      sql`INSERT INTO machines (id, hostname, tailscale_ip, os, arch)
          VALUES (${testMachineId}, 'test-host', '100.64.0.99', 'darwin', 'arm64')
          ON CONFLICT (id) DO NOTHING`,
    );
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM sync_change_log WHERE node_id = 'node-test-0001'`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM sync_change_log WHERE node_id = 'node-test-0001'`);
    await db.execute(sql`DELETE FROM agents WHERE machine_id = ${testMachineId}`);
    await db.execute(sql`DELETE FROM machines WHERE id = ${testMachineId}`);
    // Close the pool to prevent Vitest from hanging on open handles
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  it('captures INSERT into agents table with correct vclock', async () => {
    const agentId = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO agents (id, machine_id, name, type, status, project_path)
          VALUES (${agentId}, ${testMachineId}, 'test-agent', 'autonomous', 'registered', '/tmp/test')`,
    );

    const result = await db.execute(
      sql`SELECT node_id, table_name, row_id, operation, vclock, payload
          FROM sync_change_log
          WHERE table_name = 'agents' AND row_id = ${agentId}
          ORDER BY id DESC LIMIT 1`,
    );
    const rows = extractRows<ChangeLogRow>(result);

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].node_id).toBe('node-test-0001');
    expect(rows[0].operation).toBe('INSERT');
    expect(rows[0].vclock).toEqual({ 'node-test-0001': 1 });
    expect(rows[0].payload).toBeDefined();

    await db.execute(sql`DELETE FROM agents WHERE id = ${agentId}`);
  });

  it('increments vclock on UPDATE', async () => {
    const agentId = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO agents (id, machine_id, name, type, status, project_path)
          VALUES (${agentId}, ${testMachineId}, 'test-agent', 'autonomous', 'registered', '/tmp/test')`,
    );
    await db.execute(
      sql`UPDATE agents SET name = 'updated-agent' WHERE id = ${agentId}`,
    );

    const result = await db.execute(
      sql`SELECT operation, vclock FROM sync_change_log
          WHERE table_name = 'agents' AND row_id = ${agentId}
          ORDER BY id ASC`,
    );
    const rows = extractRows<ChangeLogRow>(result);

    expect(rows.length).toBe(2);
    expect(rows[0].vclock).toEqual({ 'node-test-0001': 1 });
    expect(rows[1].vclock).toEqual({ 'node-test-0001': 2 });
    expect(rows[1].operation).toBe('UPDATE');

    await db.execute(sql`DELETE FROM agents WHERE id = ${agentId}`);
  });

  it('skips change log when sync_applying is true', async () => {
    const agentId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL app.sync_applying = 'true'`));
      await tx.execute(
        sql`INSERT INTO agents (id, machine_id, name, type, status, project_path)
            VALUES (${agentId}, ${testMachineId}, 'sync-guard-test', 'autonomous', 'registered', '/tmp/test')`,
      );
    });

    const result = await db.execute(
      sql`SELECT * FROM sync_change_log
          WHERE table_name = 'agents' AND row_id = ${agentId} AND node_id = 'node-test-0001'`,
    );
    const rows = extractRows<ChangeLogRow>(result);

    expect(rows.length).toBe(0);

    await db.execute(sql`DELETE FROM agents WHERE id = ${agentId}`);
  });
});
