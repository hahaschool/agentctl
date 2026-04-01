import type { ChangeLogEntry } from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';

import { applyChange } from './apply-change.js';

/**
 * Helper to create a mock database with configurable query responses.
 * Drizzle sql tagged templates produce objects with a queryChunks property,
 * so we inspect both toString() and JSON.stringify() to match.
 */
function createMockDb(
  opts: {
    existingRow?: boolean;
    latestVclock?: Record<string, number> | null;
    latestPayload?: Record<string, unknown> | null;
  } = {},
) {
  const executedQueries: string[] = [];

  const mockExecute = vi.fn().mockImplementation(async (query: unknown) => {
    // Drizzle SQL objects carry query info in various internal shapes.
    // Stringify for pattern matching.
    const queryStr = JSON.stringify(query);
    executedQueries.push(queryStr);

    // SELECT 1 existence check for append-only
    if (queryStr.includes('SELECT 1')) {
      return { rows: opts.existingRow ? [{ '?column?': 1 }] : [] };
    }

    // Latest vclock query for mutable (ORDER BY id DESC)
    if (queryStr.includes('ORDER BY') && queryStr.includes('DESC')) {
      if (opts.latestVclock) {
        return {
          rows: [
            {
              vclock: opts.latestVclock,
              payload: opts.latestPayload ?? null,
            },
          ],
        };
      }
      return { rows: [] };
    }

    // Default: INSERT, DELETE, advisory lock, SET LOCAL, etc.
    return { rows: [] };
  });

  const db = {
    execute: mockExecute,
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = { execute: mockExecute };
      return fn(tx);
    }),
  };

  return { db, executedQueries, mockExecute };
}

function makeChange(overrides: Partial<ChangeLogEntry> = {}): ChangeLogEntry {
  return {
    id: 1,
    nodeId: 'node-remote',
    tableName: 'agents',
    rowId: 'agent-1',
    operation: 'UPDATE' as const,
    payload: { id: 'agent-1', name: 'Test Agent' },
    vclock: { 'node-remote': 1 },
    createdAt: new Date(),
    synced: false,
    ...overrides,
  };
}

describe('applyChange', () => {
  it('skips local-only tables', async () => {
    const { db } = createMockDb();
    const change = makeChange({ tableName: 'api_accounts' });

    const result = await applyChange(change, db as never);

    expect(result).toBe('skipped');
  });

  it('skips unknown tables', async () => {
    const { db } = createMockDb();
    const change = makeChange({ tableName: 'nonexistent_table' });

    const result = await applyChange(change, db as never);

    expect(result).toBe('skipped');
  });
});

describe('applyAppendOnly', () => {
  it('inserts new row when PK does not exist', async () => {
    const { db, mockExecute } = createMockDb({ existingRow: false });
    const change = makeChange({
      tableName: 'session_handoffs',
      operation: 'INSERT',
      payload: { id: 'handoff-1', from_agent: 'a', to_agent: 'b' },
      vclock: { 'node-remote': 1 },
    });

    const result = await applyChange(change, db as never);

    expect(result).toBe('applied');
    // Should have been called multiple times: existence check, SET LOCAL, INSERT, change log
    expect(mockExecute.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('skips when PK already exists', async () => {
    const { db, mockExecute } = createMockDb({ existingRow: true });
    const change = makeChange({
      tableName: 'session_handoffs',
      operation: 'INSERT',
      payload: { id: 'handoff-1', from_agent: 'a', to_agent: 'b' },
      vclock: { 'node-remote': 1 },
    });

    const result = await applyChange(change, db as never);

    expect(result).toBe('skipped');
    // Only the existence check should have been called
    expect(mockExecute.mock.calls.length).toBe(1);
  });
});

describe('applyMutable', () => {
  it('applies when remote vclock dominates local (a_dominates)', async () => {
    const { db, executedQueries } = createMockDb({
      latestVclock: { 'node-local': 1 },
    });
    const change = makeChange({
      tableName: 'agents',
      operation: 'UPDATE',
      payload: { id: 'agent-1', name: 'Updated' },
      // remote has both local and remote counters = strictly dominates {node-local:1}
      vclock: { 'node-local': 1, 'node-remote': 1 },
    });

    const result = await applyChange(change, db as never);

    expect(result).toBe('applied');
    // Should include advisory lock query
    const hasAdvisoryLock = executedQueries.some((q) => q.includes('pg_advisory_xact_lock'));
    expect(hasAdvisoryLock).toBe(true);
  });

  it('skips when local vclock dominates remote (b_dominates)', async () => {
    const { db } = createMockDb({
      latestVclock: { 'node-local': 2, 'node-remote': 1 },
    });
    const change = makeChange({
      tableName: 'agents',
      operation: 'UPDATE',
      payload: { id: 'agent-1', name: 'Stale' },
      vclock: { 'node-remote': 1 },
    });

    const result = await applyChange(change, db as never);

    expect(result).toBe('skipped');
  });

  it('skips when clocks are equal', async () => {
    const { db } = createMockDb({
      latestVclock: { 'node-remote': 1 },
    });
    const change = makeChange({
      tableName: 'agents',
      operation: 'UPDATE',
      payload: { id: 'agent-1', name: 'Same' },
      vclock: { 'node-remote': 1 },
    });

    const result = await applyChange(change, db as never);

    expect(result).toBe('skipped');
  });

  it('creates conflict when clocks are incomparable', async () => {
    const { db, executedQueries } = createMockDb({
      latestVclock: { 'node-local': 2 },
      latestPayload: { id: 'agent-1', name: 'Local Version' },
    });
    const change = makeChange({
      tableName: 'agents',
      operation: 'UPDATE',
      payload: { id: 'agent-1', name: 'Remote Version' },
      vclock: { 'node-remote': 2 },
    });

    const result = await applyChange(change, db as never);

    expect(result).toBe('conflict');
    const hasConflictInsert = executedQueries.some((q) => q.includes('sync_conflicts'));
    expect(hasConflictInsert).toBe(true);
  });

  it('handles DELETE operation when remote dominates', async () => {
    const { db, executedQueries } = createMockDb({
      latestVclock: { 'node-local': 1 },
    });
    const change = makeChange({
      tableName: 'agents',
      operation: 'DELETE',
      payload: null,
      vclock: { 'node-local': 1, 'node-remote': 1 },
    });

    const result = await applyChange(change, db as never);

    expect(result).toBe('applied');
    const hasDelete = executedQueries.some((q) => q.includes('DELETE'));
    expect(hasDelete).toBe(true);
  });

  it('applies when no local entry exists (first sync)', async () => {
    const { db } = createMockDb({
      latestVclock: null,
    });
    const change = makeChange({
      tableName: 'agents',
      operation: 'INSERT',
      payload: { id: 'agent-new', name: 'New Agent' },
      vclock: { 'node-remote': 1 },
    });

    const result = await applyChange(change, db as never);

    expect(result).toBe('applied');
  });
});
