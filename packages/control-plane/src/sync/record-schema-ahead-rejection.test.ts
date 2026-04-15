import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../db/index.js';
import { recordSchemaAheadRejection } from './apply-change.js';

function createMockDb() {
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  return {
    db: { execute } as unknown as Database,
    execute,
  };
}

function createMockLogger() {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(function (this: unknown) {
      return this;
    }),
  } as never;
}

/**
 * Extract the runtime params from a drizzle `sql` template. Drizzle stores
 * raw bind values interleaved with SQL string pieces in `queryChunks`. Every
 * non-SQL-chunk entry is a bound parameter value.
 */
function extractBindParams(arg: unknown): unknown[] {
  if (!arg || typeof arg !== 'object') return [];
  const chunks = (arg as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks.filter((chunk) => !(chunk && typeof chunk === 'object' && 'value' in chunk));
}

describe('recordSchemaAheadRejection (roadmap §33.10)', () => {
  it('issues an UPDATE that stamps the rejected envelope version on sync_nodes', async () => {
    const { db, execute } = createMockDb();

    await recordSchemaAheadRejection(db, 'peer-machine-1', 42);

    expect(execute).toHaveBeenCalledTimes(1);
    const call = execute.mock.calls[0]?.[0];
    const params = extractBindParams(call);
    // Drizzle emits the bound params in call order: schemaVersion, then id.
    expect(params).toEqual(expect.arrayContaining([42, 'peer-machine-1']));
  });

  it('issues an UPDATE that increments schema_ahead_count via COALESCE + 1', async () => {
    const { db, execute } = createMockDb();

    await recordSchemaAheadRejection(db, 'peer-machine-1', 42);

    const call = execute.mock.calls[0]?.[0];
    // The raw SQL fragments are stored on chunk.value. Re-assemble enough of
    // the statement to assert the UPDATE semantics without pinning the exact
    // whitespace layout.
    const chunks = (call as { queryChunks?: Array<{ value?: string[] }> }).queryChunks ?? [];
    const sqlText = chunks
      .flatMap((chunk) => chunk.value ?? [])
      .join(' ')
      .replace(/\s+/g, ' ');
    expect(sqlText).toContain('UPDATE sync_nodes');
    expect(sqlText).toContain('last_schema_ahead_version');
    expect(sqlText).toContain('last_schema_ahead_at');
    expect(sqlText).toContain('schema_ahead_count');
    expect(sqlText).toContain('COALESCE');
  });

  it('is a no-op when machineId is empty', async () => {
    const { db, execute } = createMockDb();

    await recordSchemaAheadRejection(db, '', 42);

    expect(execute).not.toHaveBeenCalled();
  });

  it('is a no-op when envelopeSchemaVersion is not finite', async () => {
    const { db, execute } = createMockDb();

    await recordSchemaAheadRejection(db, 'peer-machine-1', Number.NaN);

    expect(execute).not.toHaveBeenCalled();
  });

  it('logs at WARN and does not throw when the UPDATE fails', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('db gone'));
    const db = { execute } as unknown as Database;
    const logger = createMockLogger();

    // Must not throw — persistence failures must never mask the original
    // rejection path the caller already logged.
    await expect(
      recordSchemaAheadRejection(db, 'peer-machine-1', 42, logger),
    ).resolves.toBeUndefined();

    expect((logger as unknown as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalledTimes(1);
    const warnArg = (logger as unknown as { warn: ReturnType<typeof vi.fn> }).warn.mock
      .calls[0]?.[0];
    expect(warnArg).toMatchObject({
      machineId: 'peer-machine-1',
      envelopeSchemaVersion: 42,
    });
  });
});
