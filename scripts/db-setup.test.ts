import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures mock fns are available before vi.mock hoists
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  return {
    mockExistsSync: vi.fn(),
    mockReadFileSync: vi.fn(),
    mockPoolQuery: vi.fn(),
    mockPoolConnect: vi.fn(),
    mockPoolEnd: vi.fn(),
    mockClientQuery: vi.fn(),
    mockClientRelease: vi.fn(),
  };
});

vi.mock('node:fs', () => ({
  existsSync: mocks.mockExistsSync,
  readFileSync: mocks.mockReadFileSync,
}));

vi.mock('pg', () => {
  // biome-ignore lint/complexity/useArrowFunction: Pool must be constructable (arrow functions cannot be used with `new`)
  const Pool = vi.fn(function () {
    return {
      query: mocks.mockPoolQuery,
      connect: mocks.mockPoolConnect,
      end: mocks.mockPoolEnd,
    };
  });
  return { default: { Pool }, Pool };
});

// Prevent the top-level main() from running during import.
// Set a dummy DATABASE_URL and stub process.exit so the auto-invocation
// of main() at module scope doesn't crash the test runner.
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/testdb';
vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import type pg from 'pg';

import type { Journal, JournalEntry } from './db-setup.js';
import {
  applyMigration,
  DbSetupError,
  ensureMigrationsTable,
  getAppliedMigrations,
  loadJournal,
  loadMigrationSql,
  MIGRATIONS_DIR,
  MIGRATIONS_TABLE,
  main,
} from './db-setup.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJournalEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    idx: 0,
    version: '7',
    when: 1700000000000,
    tag: '0000_initial',
    breakpoints: true,
    ...overrides,
  };
}

function makeJournal(entries: JournalEntry[] = [makeJournalEntry()]): Journal {
  return {
    version: '7',
    dialect: 'postgresql',
    entries,
  };
}

function makeMockClient(): {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  return {
    query: mocks.mockClientQuery,
    release: mocks.mockClientRelease,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockPoolConnect.mockResolvedValue(makeMockClient());
  mocks.mockClientQuery.mockResolvedValue({ rows: [] });
  mocks.mockPoolEnd.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DbSetupError', () => {
  it('stores code and message', () => {
    const err = new DbSetupError('TEST_CODE', 'something failed');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('something failed');
    expect(err.name).toBe('DbSetupError');
  });

  it('stores optional context', () => {
    const err = new DbSetupError('X', 'msg', { path: '/tmp' });
    expect(err.context).toEqual({ path: '/tmp' });
  });

  it('is an instance of Error', () => {
    const err = new DbSetupError('X', 'msg');
    expect(err).toBeInstanceOf(Error);
  });

  it('defaults context to undefined', () => {
    const err = new DbSetupError('X', 'msg');
    expect(err.context).toBeUndefined();
  });
});

describe('loadJournal()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('throws JOURNAL_NOT_FOUND when file does not exist', () => {
    mocks.mockExistsSync.mockReturnValue(false);

    expect(() => loadJournal()).toThrow(DbSetupError);
    try {
      loadJournal();
    } catch (err) {
      const e = err as DbSetupError;
      expect(e.code).toBe('JOURNAL_NOT_FOUND');
    }
  });

  it('parses valid journal JSON', () => {
    const journal = makeJournal();
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockReadFileSync.mockReturnValue(JSON.stringify(journal));

    const result = loadJournal();
    expect(result).toEqual(journal);
  });

  it('throws JOURNAL_PARSE_ERROR on invalid JSON', () => {
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockReadFileSync.mockReturnValue('not valid json{{{');

    expect(() => loadJournal()).toThrow(DbSetupError);
    try {
      loadJournal();
    } catch (err) {
      const e = err as DbSetupError;
      expect(e.code).toBe('JOURNAL_PARSE_ERROR');
    }
  });

  it('reads the journal file with utf-8 encoding', () => {
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockReadFileSync.mockReturnValue(JSON.stringify(makeJournal()));

    loadJournal();
    expect(mocks.mockReadFileSync).toHaveBeenCalledWith(expect.any(String), 'utf-8');
  });

  it('returns journal with multiple entries', () => {
    const entries = [
      makeJournalEntry({ idx: 0, tag: '0000_init' }),
      makeJournalEntry({ idx: 1, tag: '0001_users' }),
      makeJournalEntry({ idx: 2, tag: '0002_agents' }),
    ];
    const journal = makeJournal(entries);
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockReadFileSync.mockReturnValue(JSON.stringify(journal));

    const result = loadJournal();
    expect(result.entries).toHaveLength(3);
  });

  it('includes path in JOURNAL_NOT_FOUND context', () => {
    mocks.mockExistsSync.mockReturnValue(false);

    try {
      loadJournal();
    } catch (err) {
      const e = err as DbSetupError;
      expect(e.context?.path).toBeDefined();
    }
  });
});

describe('loadMigrationSql()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reads SQL file for the given tag', () => {
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockReadFileSync.mockReturnValue('CREATE TABLE test;');

    const result = loadMigrationSql('0000_initial');
    expect(result).toBe('CREATE TABLE test;');
  });

  it('throws MIGRATION_FILE_NOT_FOUND when SQL file is missing', () => {
    mocks.mockExistsSync.mockReturnValue(false);

    expect(() => loadMigrationSql('0099_missing')).toThrow(DbSetupError);
    try {
      loadMigrationSql('0099_missing');
    } catch (err) {
      const e = err as DbSetupError;
      expect(e.code).toBe('MIGRATION_FILE_NOT_FOUND');
    }
  });

  it('includes tag in error context', () => {
    mocks.mockExistsSync.mockReturnValue(false);

    try {
      loadMigrationSql('0099_missing');
    } catch (err) {
      const e = err as DbSetupError;
      expect(e.context?.tag).toBe('0099_missing');
    }
  });

  it('constructs path using MIGRATIONS_DIR and tag', () => {
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockReadFileSync.mockReturnValue('SELECT 1;');

    loadMigrationSql('0001_users');

    const expectedPath = `${MIGRATIONS_DIR}/0001_users.sql`;
    expect(mocks.mockExistsSync).toHaveBeenCalledWith(expectedPath);
  });

  it('reads file with utf-8 encoding', () => {
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockReadFileSync.mockReturnValue('SELECT 1;');

    loadMigrationSql('0001_users');
    expect(mocks.mockReadFileSync).toHaveBeenCalledWith(expect.any(String), 'utf-8');
  });
});

describe('ensureMigrationsTable()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('executes CREATE TABLE IF NOT EXISTS query', async () => {
    mocks.mockPoolQuery.mockResolvedValue({ rows: [] });
    const pool = { query: mocks.mockPoolQuery } as unknown as pg.Pool;

    await ensureMigrationsTable(pool);

    expect(mocks.mockPoolQuery).toHaveBeenCalledOnce();
    const sql = mocks.mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS');
    expect(sql).toContain(MIGRATIONS_TABLE);
  });

  it('creates a table with tag column', async () => {
    mocks.mockPoolQuery.mockResolvedValue({ rows: [] });
    const pool = { query: mocks.mockPoolQuery } as unknown as pg.Pool;

    await ensureMigrationsTable(pool);

    const sql = mocks.mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain('tag text NOT NULL UNIQUE');
  });

  it('propagates query errors', async () => {
    mocks.mockPoolQuery.mockRejectedValue(new Error('connection refused'));
    const pool = { query: mocks.mockPoolQuery } as unknown as pg.Pool;

    await expect(ensureMigrationsTable(pool)).rejects.toThrow('connection refused');
  });
});

describe('getAppliedMigrations()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty set when no migrations are applied', async () => {
    mocks.mockPoolQuery.mockResolvedValue({ rows: [] });
    const pool = { query: mocks.mockPoolQuery } as unknown as pg.Pool;

    const result = await getAppliedMigrations(pool);
    expect(result).toEqual(new Set());
  });

  it('returns a set of applied migration tags', async () => {
    mocks.mockPoolQuery.mockResolvedValue({
      rows: [{ tag: '0000_init' }, { tag: '0001_users' }],
    });
    const pool = { query: mocks.mockPoolQuery } as unknown as pg.Pool;

    const result = await getAppliedMigrations(pool);
    expect(result).toEqual(new Set(['0000_init', '0001_users']));
  });

  it('queries the migrations table ordered by id', async () => {
    mocks.mockPoolQuery.mockResolvedValue({ rows: [] });
    const pool = { query: mocks.mockPoolQuery } as unknown as pg.Pool;

    await getAppliedMigrations(pool);

    const sql = mocks.mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain(MIGRATIONS_TABLE);
    expect(sql).toContain('ORDER BY id');
  });

  it('propagates query errors', async () => {
    mocks.mockPoolQuery.mockRejectedValue(new Error('table not found'));
    const pool = { query: mocks.mockPoolQuery } as unknown as pg.Pool;

    await expect(getAppliedMigrations(pool)).rejects.toThrow('table not found');
  });
});

describe('applyMigration()', () => {
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockClient = makeMockClient();
    mocks.mockPoolConnect.mockResolvedValue(mockClient);
  });

  it('wraps migration in a transaction', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });
    const pool = { connect: mocks.mockPoolConnect } as unknown as pg.Pool;
    const entry = makeJournalEntry();

    await applyMigration(pool, entry, 'CREATE TABLE test;');

    const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[calls.length - 1]).toBe('COMMIT');
  });

  it('executes the migration SQL', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });
    const pool = { connect: mocks.mockPoolConnect } as unknown as pg.Pool;
    const entry = makeJournalEntry();

    await applyMigration(pool, entry, 'CREATE TABLE users (id serial);');

    expect(mockClient.query).toHaveBeenCalledWith('CREATE TABLE users (id serial);');
  });

  it('records the migration tag after executing SQL', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });
    const pool = { connect: mocks.mockPoolConnect } as unknown as pg.Pool;
    const entry = makeJournalEntry({ tag: '0001_users' });

    await applyMigration(pool, entry, 'CREATE TABLE users;');

    expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining(MIGRATIONS_TABLE), [
      '0001_users',
    ]);
  });

  it('rolls back on SQL execution failure', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('syntax error')) // migration SQL
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const pool = { connect: mocks.mockPoolConnect } as unknown as pg.Pool;
    const entry = makeJournalEntry();

    await expect(applyMigration(pool, entry, 'BAD SQL')).rejects.toThrow(DbSetupError);
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('throws MIGRATION_FAILED with tag context', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('syntax error'))
      .mockResolvedValueOnce({ rows: [] });

    const pool = { connect: mocks.mockPoolConnect } as unknown as pg.Pool;
    const entry = makeJournalEntry({ tag: '0005_broken' });

    try {
      await applyMigration(pool, entry, 'BAD SQL');
    } catch (err) {
      const e = err as DbSetupError;
      expect(e.code).toBe('MIGRATION_FAILED');
      expect(e.context?.tag).toBe('0005_broken');
    }
  });

  it('always releases the client even on success', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });
    const pool = { connect: mocks.mockPoolConnect } as unknown as pg.Pool;
    const entry = makeJournalEntry();

    await applyMigration(pool, entry, 'SELECT 1;');

    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it('always releases the client on failure', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ rows: [] });

    const pool = { connect: mocks.mockPoolConnect } as unknown as pg.Pool;
    const entry = makeJournalEntry();

    try {
      await applyMigration(pool, entry, 'BAD');
    } catch {
      // expected
    }

    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it('includes the original error message in DbSetupError', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('relation "users" already exists'))
      .mockResolvedValueOnce({ rows: [] });

    const pool = { connect: mocks.mockPoolConnect } as unknown as pg.Pool;
    const entry = makeJournalEntry({ tag: '0005_broken' });

    try {
      await applyMigration(pool, entry, 'BAD');
    } catch (err) {
      const e = err as DbSetupError;
      expect(e.message).toContain('relation "users" already exists');
    }
  });

  it('handles non-Error thrown values', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce('string error')
      .mockResolvedValueOnce({ rows: [] });

    const pool = { connect: mocks.mockPoolConnect } as unknown as pg.Pool;
    const entry = makeJournalEntry();

    await expect(applyMigration(pool, entry, 'BAD')).rejects.toThrow(DbSetupError);
  });
});

describe('main()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws MISSING_DATABASE_URL when DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL;

    try {
      await main();
      expect.fail('should have thrown');
    } catch (err) {
      const e = err as DbSetupError;
      expect(e.code).toBe('MISSING_DATABASE_URL');
    }
  });

  it('masks password in logged URL', async () => {
    process.env.DATABASE_URL = 'postgres://user:secret@localhost:5432/db';
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [{ db: 'db' }] }); // SELECT current_database()
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // CREATE TABLE
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockReadFileSync.mockReturnValue(JSON.stringify(makeJournal([])));
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // getApplied
    mocks.mockPoolEnd.mockResolvedValue(undefined);

    await main();

    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    const connectLog = logCalls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Connecting to:'),
    );
    expect(connectLog).toBeDefined();
    expect((connectLog as string[])[0]).not.toContain('secret');
    expect((connectLog as string[])[0]).toContain('****');
  });

  it('logs "up to date" when there are no pending migrations', async () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [{ db: 'db' }] });
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // ensureMigrationsTable
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockReadFileSync.mockReturnValue(
      JSON.stringify(makeJournal([makeJournalEntry({ tag: '0000_init' })])),
    );
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [{ tag: '0000_init' }] });
    mocks.mockPoolEnd.mockResolvedValue(undefined);

    await main();

    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    const upToDate = logCalls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('up to date'),
    );
    expect(upToDate).toBeDefined();
  });

  it('applies pending migrations in order', async () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
    const entries = [
      makeJournalEntry({ idx: 0, tag: '0000_init' }),
      makeJournalEntry({ idx: 1, tag: '0001_users' }),
    ];
    // SELECT current_database()
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [{ db: 'db' }] });
    // ensureMigrationsTable
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    // loadJournal
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('_journal.json')) {
        return JSON.stringify(makeJournal(entries));
      }
      return 'CREATE TABLE test;';
    });
    // getAppliedMigrations — 0000_init already applied
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [{ tag: '0000_init' }] });
    // applyMigration (connect + queries)
    const mockClient = makeMockClient();
    mockClient.query.mockResolvedValue({ rows: [] });
    mocks.mockPoolConnect.mockResolvedValue(mockClient);
    mocks.mockPoolEnd.mockResolvedValue(undefined);

    await main();

    // 0001_users should be applied (BEGIN, SQL, INSERT, COMMIT)
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('calls pool.end() even when an error occurs during migrations', async () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [{ db: 'db' }] });
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // ensureMigrationsTable
    mocks.mockExistsSync.mockReturnValue(false); // journal not found
    mocks.mockPoolEnd.mockResolvedValue(undefined);

    try {
      await main();
    } catch {
      // expected
    }

    expect(mocks.mockPoolEnd).toHaveBeenCalledOnce();
  });

  it('verifies connectivity by querying current_database()', async () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [{ db: 'testdb' }] });
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // ensureMigrationsTable
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockReadFileSync.mockReturnValue(JSON.stringify(makeJournal([])));
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    mocks.mockPoolEnd.mockResolvedValue(undefined);

    await main();

    const firstQuery = mocks.mockPoolQuery.mock.calls[0][0] as string;
    expect(firstQuery).toContain('current_database()');
  });

  it('logs the count of pending migrations', async () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
    const entries = [
      makeJournalEntry({ idx: 0, tag: '0000_init' }),
      makeJournalEntry({ idx: 1, tag: '0001_users' }),
      makeJournalEntry({ idx: 2, tag: '0002_agents' }),
    ];
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [{ db: 'db' }] });
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    mocks.mockExistsSync.mockReturnValue(true);
    mocks.mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('_journal.json')) {
        return JSON.stringify(makeJournal(entries));
      }
      return 'SELECT 1;';
    });
    mocks.mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // none applied
    const mockClient = makeMockClient();
    mockClient.query.mockResolvedValue({ rows: [] });
    mocks.mockPoolConnect.mockResolvedValue(mockClient);
    mocks.mockPoolEnd.mockResolvedValue(undefined);

    await main();

    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    const pendingLog = logCalls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('3 pending'),
    );
    expect(pendingLog).toBeDefined();
  });
});

describe('constants', () => {
  it('MIGRATIONS_TABLE equals _drizzle_migrations', () => {
    expect(MIGRATIONS_TABLE).toBe('_drizzle_migrations');
  });

  it('MIGRATIONS_DIR contains drizzle path', () => {
    expect(MIGRATIONS_DIR).toContain('packages');
    expect(MIGRATIONS_DIR).toContain('control-plane');
    expect(MIGRATIONS_DIR).toContain('drizzle');
  });
});
