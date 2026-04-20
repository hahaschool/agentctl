import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';

import { MemoryDrawerBackfillStateStore } from './memory-drawer-backfill-state-store.js';

function createBackfillRow(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? 'backfill-1',
    source_type: overrides.source_type ?? 'session-jsonl',
    source_root: overrides.source_root ?? '/Users/example/.claude/projects',
    cursor_json: overrides.cursor_json ?? {},
    status: overrides.status ?? 'running',
    last_error: overrides.last_error ?? null,
    created_at: overrides.created_at ?? new Date('2026-04-20T00:00:00.000Z'),
    updated_at: overrides.updated_at ?? new Date('2026-04-20T00:00:00.000Z'),
  };
}

function createMockPool(rowOverrides: Record<string, unknown> = {}) {
  return {
    query: vi.fn().mockImplementation((_sql: string, params: unknown[]) => ({
      rows: [
        createBackfillRow({
          id: params[0],
          source_type: params[1],
          source_root: params[2],
          cursor_json: params[3] ?? {},
          ...rowOverrides,
        }),
      ],
      rowCount: 1,
    })),
  };
}

describe('MemoryDrawerBackfillStateStore', () => {
  it('creates a running state for a JSONL source root with an empty cursor', async () => {
    const pool = createMockPool();
    const store = new MemoryDrawerBackfillStateStore({
      pool: pool as never,
      logger: createMockLogger(),
    });

    const state = await store.startOrResume({
      sourceType: 'session-jsonl',
      sourceRoot: '/Users/example/.claude/projects',
    });

    expect(state).toMatchObject({
      sourceType: 'session-jsonl',
      sourceRoot: '/Users/example/.claude/projects',
      cursorJson: {},
      status: 'running',
      lastError: null,
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    });
    expect(state.id).toMatch(/^[a-z0-9]{26}$/);

    const [sql, params] = vi.mocked(pool.query).mock.calls[0] ?? [];
    expect(sql).toContain('INSERT INTO memory_drawer_backfill_state');
    expect(sql).toContain('ON CONFLICT (source_type, source_root)');
    expect(sql).not.toContain('cursor_json = EXCLUDED.cursor_json');
    expect(params).toEqual([state.id, 'session-jsonl', '/Users/example/.claude/projects', {}]);
  });

  it('resumes a failed claude-mem source without overwriting its saved cursor', async () => {
    const pool = createMockPool({
      id: 'backfill-existing',
      source_type: 'claude-mem',
      source_root: '/Users/example/.local/share/claude-mem/claude-mem.db',
      cursor_json: { observationId: 42, rowOffset: 7 },
      status: 'running',
      last_error: null,
    });
    const store = new MemoryDrawerBackfillStateStore({
      pool: pool as never,
      logger: createMockLogger(),
    });

    const state = await store.startOrResume({
      sourceType: 'claude-mem',
      sourceRoot: '/Users/example/.local/share/claude-mem/claude-mem.db',
      cursorJson: { observationId: 0 },
    });

    expect(state).toMatchObject({
      id: 'backfill-existing',
      sourceType: 'claude-mem',
      cursorJson: { observationId: 42, rowOffset: 7 },
      status: 'running',
      lastError: null,
    });
  });

  it('updates a running state cursor for the next JSONL line to resume from', async () => {
    const cursor = { filePath: 'project/session.jsonl', byteOffset: 4096, line: 128 };
    const pool = createMockPool({
      id: 'backfill-existing',
      cursor_json: cursor,
      status: 'running',
      last_error: null,
    });
    const store = new MemoryDrawerBackfillStateStore({
      pool: pool as never,
      logger: createMockLogger(),
    });

    const state = await store.updateCursor('backfill-existing', cursor);

    expect(state.cursorJson).toEqual(cursor);
    expect(state.status).toBe('running');

    const [sql, params] = vi.mocked(pool.query).mock.calls[0] ?? [];
    expect(sql).toContain('UPDATE memory_drawer_backfill_state');
    expect(sql).toContain('cursor_json = $2');
    expect(sql).toContain("status = 'running'");
    expect(params).toEqual(['backfill-existing', cursor]);
  });

  it('marks a state failed with a resumable safe error summary', async () => {
    const pool = createMockPool({
      id: 'backfill-existing',
      status: 'failed',
      last_error: 'json_parse_error',
    });
    const store = new MemoryDrawerBackfillStateStore({
      pool: pool as never,
      logger: createMockLogger(),
    });
    const rawSecret = 'raw drawer content password=hunter2';
    const error = Object.assign(new Error(rawSecret), { code: 'json_parse_error' });

    const state = await store.markFailed('backfill-existing', error);

    expect(state.status).toBe('failed');
    expect(state.lastError).toBe('json_parse_error');
    const serializedParams = JSON.stringify(vi.mocked(pool.query).mock.calls[0]?.[1]);
    expect(serializedParams).not.toContain(rawSecret);
    expect(serializedParams).not.toContain('hunter2');
  });
});
