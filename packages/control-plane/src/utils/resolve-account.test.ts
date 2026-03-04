import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../db/index.js';
import type { AccountResolutionContext } from './resolve-account.js';
import { resolveAccountId } from './resolve-account.js';

// ---------------------------------------------------------------------------
// Chainable Drizzle query builder mock
// ---------------------------------------------------------------------------

/**
 * Creates a mock database that simulates Drizzle's chainable query builder.
 *
 * Each method in the chain (select, from, where) returns the chain itself so
 * that calls like `db.select().from(table).where(cond)` resolve correctly.
 *
 * The mock stores a `rows` array that is returned when the chain is awaited
 * (via a `.then` method). Call `setRows()` to configure what a query returns.
 *
 * For this utility we need to return different values depending on which table
 * is being queried (projectAccountMappings vs settings).  The `from` mock
 * captures the table reference so `setRowsForTable` can wire up per-table
 * responses.
 */
function createMockDb() {
  let rows: unknown[] = [];
  const tableRowMap = new Map<unknown, unknown[]>();

  const chain: Record<string, unknown> = {};

  const chainMethods = ['select', 'from', 'where'];

  for (const method of chainMethods) {
    chain[method] = vi.fn(() => chain);
  }

  // Capture the table reference on `.from(table)` so we can resolve the
  // correct rows for each table.
  (chain.from as ReturnType<typeof vi.fn>).mockImplementation((table: unknown) => {
    if (tableRowMap.has(table)) {
      rows = tableRowMap.get(table) as unknown[];
    }
    return chain;
  });

  // When the chain is awaited, resolve with the configured rows.
  // biome-ignore lint/suspicious/noThenProperty: Drizzle query builder mock requires a thenable
  chain.then = (resolve: (value: unknown) => void) => {
    resolve(rows);
    return chain;
  };

  return {
    db: chain as unknown as Database,
    /** Set a default rows value (used when no per-table mapping matches). */
    setRows: (newRows: unknown[]) => {
      rows = newRows;
    },
    /** Map a specific Drizzle table reference to the rows it should return. */
    setRowsForTable: (table: unknown, newRows: unknown[]) => {
      tableRowMap.set(table, newRows);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveAccountId', () => {
  // -------------------------------------------------------------------------
  // Level 1: Session-level override
  // -------------------------------------------------------------------------

  it('returns sessionAccountId when provided (skips all DB queries)', async () => {
    const { db } = createMockDb();

    const ctx: AccountResolutionContext = {
      sessionAccountId: 'session-acct-001',
      agentAccountId: 'agent-acct-002',
      projectPath: '/home/user/project',
    };

    const result = await resolveAccountId(ctx, db);

    expect(result).toBe('session-acct-001');
    // Should not have queried the database at all
    expect(
      (db as unknown as Record<string, ReturnType<typeof vi.fn>>).select,
    ).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Level 2: Agent-level assignment
  // -------------------------------------------------------------------------

  it('returns agentAccountId when sessionAccountId is null', async () => {
    const { db } = createMockDb();

    const ctx: AccountResolutionContext = {
      sessionAccountId: null,
      agentAccountId: 'agent-acct-002',
      projectPath: '/home/user/project',
    };

    const result = await resolveAccountId(ctx, db);

    expect(result).toBe('agent-acct-002');
    // Should not have queried the database
    expect(
      (db as unknown as Record<string, ReturnType<typeof vi.fn>>).select,
    ).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Level 3: Project-level mapping
  // -------------------------------------------------------------------------

  it('returns project mapping accountId when session and agent are null', async () => {
    // Import the schema tables so we can wire up per-table mock responses.
    const { projectAccountMappings, settings } = await import('../db/schema.js');

    const { db, setRowsForTable } = createMockDb();

    setRowsForTable(projectAccountMappings, [
      { accountId: 'project-acct-003', projectPath: '/home/user/project' },
    ]);
    setRowsForTable(settings, []);

    const ctx: AccountResolutionContext = {
      sessionAccountId: null,
      agentAccountId: null,
      projectPath: '/home/user/project',
    };

    const result = await resolveAccountId(ctx, db);

    expect(result).toBe('project-acct-003');
  });

  // -------------------------------------------------------------------------
  // Level 4: Global default
  // -------------------------------------------------------------------------

  it('returns global default when no session, agent, or project match', async () => {
    const { projectAccountMappings, settings } = await import('../db/schema.js');

    const { db, setRowsForTable } = createMockDb();

    setRowsForTable(projectAccountMappings, []);
    setRowsForTable(settings, [{ key: 'default_account_id', value: { value: 'global-acct-004' } }]);

    const ctx: AccountResolutionContext = {
      sessionAccountId: null,
      agentAccountId: null,
      projectPath: null,
    };

    const result = await resolveAccountId(ctx, db);

    expect(result).toBe('global-acct-004');
  });

  // -------------------------------------------------------------------------
  // Level 5: Nothing configured — returns null
  // -------------------------------------------------------------------------

  it('returns null when nothing is configured', async () => {
    const { settings } = await import('../db/schema.js');

    const { db, setRowsForTable } = createMockDb();

    setRowsForTable(settings, []);

    const ctx: AccountResolutionContext = {
      sessionAccountId: null,
      agentAccountId: null,
      projectPath: null,
    };

    const result = await resolveAccountId(ctx, db);

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Edge: undefined fields treated as absent
  // -------------------------------------------------------------------------

  it('treats undefined context fields the same as null', async () => {
    const { settings } = await import('../db/schema.js');

    const { db, setRowsForTable } = createMockDb();

    setRowsForTable(settings, [{ key: 'default_account_id', value: { value: 'fallback-acct' } }]);

    const ctx: AccountResolutionContext = {};

    const result = await resolveAccountId(ctx, db);

    expect(result).toBe('fallback-acct');
  });

  // -------------------------------------------------------------------------
  // Edge: project path provided but no mapping exists — falls to global
  // -------------------------------------------------------------------------

  it('falls through to global default when project path has no mapping', async () => {
    const { projectAccountMappings, settings } = await import('../db/schema.js');

    const { db, setRowsForTable } = createMockDb();

    setRowsForTable(projectAccountMappings, []);
    setRowsForTable(settings, [{ key: 'default_account_id', value: { value: 'global-acct-005' } }]);

    const ctx: AccountResolutionContext = {
      sessionAccountId: null,
      agentAccountId: null,
      projectPath: '/home/user/unmapped-project',
    };

    const result = await resolveAccountId(ctx, db);

    expect(result).toBe('global-acct-005');
  });
});
