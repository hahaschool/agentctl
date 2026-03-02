import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MigrationFile } from '../packages/control-plane/src/db/migration-runner.js';

// ---------------------------------------------------------------------------
// Mocks — set up before importing the module under test
// ---------------------------------------------------------------------------

const mockPoolClient = {
  query: vi.fn(),
  release: vi.fn(),
};

const mockPool = {
  query: vi.fn(),
  connect: vi.fn(() => Promise.resolve(mockPoolClient)),
  end: vi.fn(),
};

vi.mock('pg', () => {
  // biome-ignore lint/complexity/useArrowFunction: Pool must be constructable (arrow functions cannot be used with `new`)
  const Pool = vi.fn(function () {
    return mockPool;
  });
  return { default: { Pool }, Pool };
});

vi.mock('../packages/control-plane/src/db/migration-runner.js', () => ({
  discoverMigrations: vi.fn(),
  getPendingMigrations: vi.fn(),
  sortMigrations: vi.fn(),
}));

import pg from 'pg';

import {
  discoverMigrations,
  getPendingMigrations,
} from '../packages/control-plane/src/db/migration-runner.js';
import type { MigrateDeployOptions, MigrateDeployResult } from './migrate-deploy.js';
import {
  ADVISORY_LOCK_KEY,
  applyMigration,
  DEFAULT_MIGRATIONS_DIR,
  EXIT_CONNECTION_ERROR,
  EXIT_LOCK_CONTENTION,
  EXIT_MIGRATION_FAILED,
  EXIT_SUCCESS,
  ensureMigrationsTable,
  exitCodeFromResult,
  extractUserFromUrl,
  getAppliedVersions,
  getConnectionUrl,
  MigrateDeployError,
  main,
  maskConnectionUrl,
  parseArgs,
  releaseAdvisoryLock,
  runMigrations,
  tryAcquireAdvisoryLock,
  validateUserPermissions,
} from './migrate-deploy.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMigration(version: string, filename: string, content = '-- migration'): MigrationFile {
  return { filename, version, content };
}

function makeSuccessResult(overrides: Partial<MigrateDeployResult> = {}): MigrateDeployResult {
  return {
    success: true,
    dryRun: false,
    migrationsApplied: [],
    migrationsSkipped: [],
    migrationsPending: [],
    durationMs: 0,
    database: 'agentctl',
    user: 'migrator',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function defaultOptions(overrides: Partial<MigrateDeployOptions> = {}): MigrateDeployOptions {
  return {
    dryRun: false,
    statementTimeoutMs: 30_000,
    lockTimeoutMs: 5_000,
    migrationsDir: DEFAULT_MIGRATIONS_DIR,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Re-establish default pool.connect (clearAllMocks does not reset mockImplementation)
  mockPool.connect.mockImplementation(() => Promise.resolve(mockPoolClient));
  // Default: advisory lock succeeds
  mockPoolClient.query.mockImplementation(async (sql: string, _params?: unknown[]) => {
    if (typeof sql === 'string' && sql.includes('pg_try_advisory_lock')) {
      return { rows: [{ locked: true }] };
    }
    if (typeof sql === 'string' && sql.includes('pg_advisory_unlock')) {
      return { rows: [{ unlocked: true }] };
    }
    if (typeof sql === 'string' && sql.includes('lock_timeout')) {
      return { rows: [] };
    }
    if (typeof sql === 'string' && sql.includes('statement_timeout')) {
      return { rows: [] };
    }
    if (typeof sql === 'string' && sql.includes('BEGIN')) {
      return { rows: [] };
    }
    if (typeof sql === 'string' && sql.includes('COMMIT')) {
      return { rows: [] };
    }
    if (typeof sql === 'string' && sql.includes('ROLLBACK')) {
      return { rows: [] };
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO')) {
      return { rows: [] };
    }
    return { rows: [] };
  });

  // Default pool.query for table creation and version queries
  mockPool.query.mockImplementation(async (sql: string) => {
    if (typeof sql === 'string' && sql.includes('current_database')) {
      return { rows: [{ db: 'agentctl', user: 'migrator' }] };
    }
    if (typeof sql === 'string' && sql.includes('SELECT tag')) {
      return { rows: [] };
    }
    return { rows: [] };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// 1. MigrateDeployError
// ============================================================================

describe('MigrateDeployError', () => {
  it('creates an error with code, message, and context', () => {
    const error = new MigrateDeployError('TEST_CODE', 'test message', { key: 'value' });

    expect(error.name).toBe('MigrateDeployError');
    expect(error.code).toBe('TEST_CODE');
    expect(error.message).toBe('test message');
    expect(error.context).toEqual({ key: 'value' });
  });

  it('creates an error without context', () => {
    const error = new MigrateDeployError('TEST_CODE', 'test message');

    expect(error.context).toBeUndefined();
  });

  it('is an instance of Error', () => {
    const error = new MigrateDeployError('CODE', 'msg');

    expect(error).toBeInstanceOf(Error);
  });

  it('has readonly code and context properties', () => {
    const error = new MigrateDeployError('CODE', 'msg', { a: 1 });

    // TypeScript enforces readonly; verify the values are set correctly
    expect(error.code).toBe('CODE');
    expect(error.context).toEqual({ a: 1 });
  });

  it('preserves the stack trace', () => {
    const error = new MigrateDeployError('CODE', 'msg');

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('MigrateDeployError');
  });
});

// ============================================================================
// 2. parseArgs
// ============================================================================

describe('parseArgs', () => {
  it('returns defaults when no arguments are provided', () => {
    const opts = parseArgs(['node', 'script.ts']);

    expect(opts.dryRun).toBe(false);
    expect(opts.statementTimeoutMs).toBe(30_000);
    expect(opts.lockTimeoutMs).toBe(5_000);
  });

  it('sets dryRun when --dry-run flag is present', () => {
    const opts = parseArgs(['node', 'script.ts', '--dry-run']);

    expect(opts.dryRun).toBe(true);
  });

  it('parses --timeout value', () => {
    const opts = parseArgs(['node', 'script.ts', '--timeout', '60000']);

    expect(opts.statementTimeoutMs).toBe(60_000);
  });

  it('parses --lock-timeout value', () => {
    const opts = parseArgs(['node', 'script.ts', '--lock-timeout', '10000']);

    expect(opts.lockTimeoutMs).toBe(10_000);
  });

  it('handles all flags combined', () => {
    const opts = parseArgs([
      'node',
      'script.ts',
      '--dry-run',
      '--timeout',
      '45000',
      '--lock-timeout',
      '8000',
    ]);

    expect(opts.dryRun).toBe(true);
    expect(opts.statementTimeoutMs).toBe(45_000);
    expect(opts.lockTimeoutMs).toBe(8_000);
  });

  it('throws MigrateDeployError when --timeout has no value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--timeout'])).toThrow(MigrateDeployError);
  });

  it('throws MigrateDeployError when --timeout has non-numeric value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--timeout', 'abc'])).toThrow(MigrateDeployError);
  });

  it('throws MigrateDeployError when --lock-timeout has no value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--lock-timeout'])).toThrow(MigrateDeployError);
  });

  it('throws MigrateDeployError when --lock-timeout has non-numeric value', () => {
    expect(() => parseArgs(['node', 'script.ts', '--lock-timeout', 'xyz'])).toThrow(
      MigrateDeployError,
    );
  });

  it('sets migrationsDir to the default', () => {
    const opts = parseArgs(['node', 'script.ts']);

    expect(opts.migrationsDir).toBe(DEFAULT_MIGRATIONS_DIR);
  });

  it('ignores unrecognized flags', () => {
    const opts = parseArgs(['node', 'script.ts', '--verbose', '--dry-run']);

    expect(opts.dryRun).toBe(true);
    expect(opts.statementTimeoutMs).toBe(30_000);
  });
});

// ============================================================================
// 3. Connection helpers
// ============================================================================

describe('getConnectionUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MIGRATION_DATABASE_URL;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('prefers MIGRATION_DATABASE_URL over DATABASE_URL', () => {
    process.env.MIGRATION_DATABASE_URL = 'postgres://migrator:pass@host/db';
    process.env.DATABASE_URL = 'postgres://app:pass@host/db';

    const url = getConnectionUrl();

    expect(url).toBe('postgres://migrator:pass@host/db');
  });

  it('falls back to DATABASE_URL when MIGRATION_DATABASE_URL is not set', () => {
    process.env.DATABASE_URL = 'postgres://app:pass@host/db';

    const url = getConnectionUrl();

    expect(url).toBe('postgres://app:pass@host/db');
  });

  it('throws MigrateDeployError when neither env var is set', () => {
    expect(() => getConnectionUrl()).toThrow(MigrateDeployError);
    try {
      getConnectionUrl();
    } catch (error) {
      expect((error as MigrateDeployError).code).toBe('MISSING_DATABASE_URL');
    }
  });
});

describe('maskConnectionUrl', () => {
  it('masks the password in a connection URL', () => {
    const masked = maskConnectionUrl('postgres://user:secretpass@host:5432/db');

    expect(masked).toBe('postgres://user:****@host:5432/db');
    expect(masked).not.toContain('secretpass');
  });

  it('handles URLs without password', () => {
    const masked = maskConnectionUrl('postgres://host:5432/db');

    expect(masked).toBe('postgres://host:5432/db');
  });

  it('handles complex passwords with special characters', () => {
    const masked = maskConnectionUrl('postgres://user:p@ss!word@host:5432/db');

    expect(masked).not.toContain('p@ss');
  });
});

describe('extractUserFromUrl', () => {
  it('extracts user from standard connection URL', () => {
    const user = extractUserFromUrl('postgres://migrator:pass@host:5432/db');

    expect(user).toBe('migrator');
  });

  it('extracts user from URL without password', () => {
    const user = extractUserFromUrl('postgres://admin@host:5432/db');

    expect(user).toBe('admin');
  });

  it('returns "unknown" for URLs without user info', () => {
    const user = extractUserFromUrl('postgres://host:5432/db');

    expect(user).toBe('unknown');
  });

  it('extracts user from URL with port in userinfo', () => {
    const user = extractUserFromUrl('postgres://deploy_user:longpassword@db.example.com:5432/app');

    expect(user).toBe('deploy_user');
  });
});

// ============================================================================
// 4. ensureMigrationsTable
// ============================================================================

describe('ensureMigrationsTable', () => {
  it('executes CREATE TABLE IF NOT EXISTS query', async () => {
    await ensureMigrationsTable(mockPool as unknown as pg.Pool);

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS'),
    );
    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('_drizzle_migrations'));
  });

  it('propagates query errors', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('permission denied'));

    await expect(ensureMigrationsTable(mockPool as unknown as pg.Pool)).rejects.toThrow(
      'permission denied',
    );
  });
});

// ============================================================================
// 5. getAppliedVersions
// ============================================================================

describe('getAppliedVersions', () => {
  it('returns an array of version tags', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ tag: '0000' }, { tag: '0001' }, { tag: '0002' }],
    });

    const versions = await getAppliedVersions(mockPool as unknown as pg.Pool);

    expect(versions).toEqual(['0000', '0001', '0002']);
  });

  it('returns empty array when no migrations have been applied', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const versions = await getAppliedVersions(mockPool as unknown as pg.Pool);

    expect(versions).toEqual([]);
  });

  it('queries the correct table', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await getAppliedVersions(mockPool as unknown as pg.Pool);

    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('_drizzle_migrations'));
  });
});

// ============================================================================
// 6. Advisory lock functions
// ============================================================================

describe('tryAcquireAdvisoryLock', () => {
  it('returns true when lock is acquired', async () => {
    mockPoolClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: true }] };
      }
      return { rows: [] };
    });

    const acquired = await tryAcquireAdvisoryLock(
      mockPoolClient as unknown as pg.PoolClient,
      5_000,
    );

    expect(acquired).toBe(true);
  });

  it('returns false when lock is not acquired', async () => {
    mockPoolClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: false }] };
      }
      return { rows: [] };
    });

    const acquired = await tryAcquireAdvisoryLock(
      mockPoolClient as unknown as pg.PoolClient,
      5_000,
    );

    expect(acquired).toBe(false);
  });

  it('sets the lock timeout before attempting lock', async () => {
    const calls: string[] = [];
    mockPoolClient.query.mockImplementation(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: true }] };
      }
      return { rows: [] };
    });

    await tryAcquireAdvisoryLock(mockPoolClient as unknown as pg.PoolClient, 10_000);

    expect(calls[0]).toContain('lock_timeout');
    expect(calls[0]).toContain('10000');
  });

  it('uses the correct advisory lock key', async () => {
    mockPoolClient.query.mockImplementation(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [{ locked: true }] };
      }
      return { rows: [] };
    });

    await tryAcquireAdvisoryLock(mockPoolClient as unknown as pg.PoolClient, 5_000);

    expect(mockPoolClient.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_try_advisory_lock'),
      [ADVISORY_LOCK_KEY],
    );
  });

  it('propagates query errors', async () => {
    mockPoolClient.query.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      tryAcquireAdvisoryLock(mockPoolClient as unknown as pg.PoolClient, 5_000),
    ).rejects.toThrow('connection lost');
  });

  it('returns false when rows are empty', async () => {
    mockPoolClient.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const acquired = await tryAcquireAdvisoryLock(
      mockPoolClient as unknown as pg.PoolClient,
      5_000,
    );

    expect(acquired).toBe(false);
  });
});

describe('releaseAdvisoryLock', () => {
  it('calls pg_advisory_unlock with the correct key', async () => {
    await releaseAdvisoryLock(mockPoolClient as unknown as pg.PoolClient);

    expect(mockPoolClient.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      [ADVISORY_LOCK_KEY],
    );
  });

  it('propagates query errors', async () => {
    mockPoolClient.query.mockRejectedValueOnce(new Error('unlock failed'));

    await expect(releaseAdvisoryLock(mockPoolClient as unknown as pg.PoolClient)).rejects.toThrow(
      'unlock failed',
    );
  });
});

// ============================================================================
// 7. validateUserPermissions
// ============================================================================

describe('validateUserPermissions', () => {
  it('returns database and user information', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ db: 'agentctl', user: 'migrator' }],
    });

    const info = await validateUserPermissions(mockPool as unknown as pg.Pool);

    expect(info).toEqual({ database: 'agentctl', user: 'migrator' });
  });

  it('throws MigrateDeployError when query returns no rows', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await expect(validateUserPermissions(mockPool as unknown as pg.Pool)).rejects.toThrow(
      MigrateDeployError,
    );
  });

  it('queries current_database() and current_user', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ db: 'test', user: 'admin' }],
    });

    await validateUserPermissions(mockPool as unknown as pg.Pool);

    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('current_database'));
    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('current_user'));
  });
});

// ============================================================================
// 8. applyMigration
// ============================================================================

describe('applyMigration', () => {
  it('wraps migration SQL in BEGIN/COMMIT transaction', async () => {
    const calls: string[] = [];
    mockPoolClient.query.mockImplementation(async (sql: string) => {
      calls.push(sql);
      return { rows: [] };
    });

    await applyMigration(
      mockPoolClient as unknown as pg.PoolClient,
      '0001',
      '0001_test.sql',
      'CREATE TABLE test (id int);',
      30_000,
    );

    expect(calls[0]).toBe('BEGIN');
    expect(calls).toContain('CREATE TABLE test (id int);');
    expect(calls[calls.length - 1]).toBe('COMMIT');
  });

  it('sets statement timeout inside the transaction', async () => {
    const calls: string[] = [];
    mockPoolClient.query.mockImplementation(async (sql: string) => {
      calls.push(sql);
      return { rows: [] };
    });

    await applyMigration(
      mockPoolClient as unknown as pg.PoolClient,
      '0001',
      '0001_test.sql',
      '-- sql',
      45_000,
    );

    const timeoutCall = calls.find((c) => c.includes('statement_timeout'));
    expect(timeoutCall).toBeDefined();
    expect(timeoutCall).toContain('45000');
  });

  it('records the migration version in the tracking table', async () => {
    const insertCalls: Array<{ sql: string; params: unknown[] }> = [];
    mockPoolClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO')) {
        insertCalls.push({ sql, params: params ?? [] });
      }
      return { rows: [] };
    });

    await applyMigration(
      mockPoolClient as unknown as pg.PoolClient,
      '0002',
      '0002_test.sql',
      '-- sql',
      30_000,
    );

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].sql).toContain('_drizzle_migrations');
    expect(insertCalls[0].params).toEqual(['0002']);
  });

  it('rolls back on SQL error and throws MigrateDeployError', async () => {
    const calls: string[] = [];
    mockPoolClient.query.mockImplementation(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('CREATE TABLE')) {
        throw new Error('syntax error at position 42');
      }
      return { rows: [] };
    });

    await expect(
      applyMigration(
        mockPoolClient as unknown as pg.PoolClient,
        '0001',
        '0001_bad.sql',
        'CREATE TABLE bad syntax;',
        30_000,
      ),
    ).rejects.toThrow(MigrateDeployError);

    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });

  it('includes migration filename in error context', async () => {
    mockPoolClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql.includes('statement_timeout') || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      throw new Error('column does not exist');
    });

    try {
      await applyMigration(
        mockPoolClient as unknown as pg.PoolClient,
        '0003',
        '0003_broken.sql',
        '-- bad sql',
        30_000,
      );
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MigrateDeployError);
      const err = error as MigrateDeployError;
      expect(err.code).toBe('MIGRATION_FAILED');
      expect(err.context?.filename).toBe('0003_broken.sql');
      expect(err.context?.version).toBe('0003');
    }
  });

  it('includes the original error message in the MigrateDeployError message', async () => {
    mockPoolClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql.includes('statement_timeout') || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      throw new Error('relation "users" already exists');
    });

    try {
      await applyMigration(
        mockPoolClient as unknown as pg.PoolClient,
        '0001',
        '0001_dup.sql',
        '-- dup',
        30_000,
      );
      expect.unreachable('should have thrown');
    } catch (error) {
      const err = error as MigrateDeployError;
      expect(err.message).toContain('relation "users" already exists');
    }
  });

  it('handles non-Error thrown values in catch block', async () => {
    mockPoolClient.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql.includes('statement_timeout') || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      throw 'string error'; // eslint-disable-line no-throw-literal
    });

    await expect(
      applyMigration(
        mockPoolClient as unknown as pg.PoolClient,
        '0001',
        '0001_test.sql',
        '-- sql',
        30_000,
      ),
    ).rejects.toThrow(MigrateDeployError);
  });
});

// ============================================================================
// 9. runMigrations — happy paths
// ============================================================================

describe('runMigrations', () => {
  describe('happy paths', () => {
    it('returns success when no pending migrations exist', async () => {
      vi.mocked(discoverMigrations).mockResolvedValue([makeMigration('0000', '0000_initial.sql')]);
      vi.mocked(getPendingMigrations).mockReturnValue([]);
      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('current_database')) {
          return { rows: [{ db: 'agentctl', user: 'migrator' }] };
        }
        if (sql.includes('SELECT tag')) {
          return { rows: [{ tag: '0000' }] };
        }
        return { rows: [] };
      });

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.success).toBe(true);
      expect(result.migrationsApplied).toEqual([]);
      expect(result.migrationsPending).toEqual([]);
    });

    it('applies pending migrations and records them', async () => {
      const pending = [
        makeMigration('0002', '0002_add_loop.sql', 'ALTER TABLE agents ADD loop boolean;'),
        makeMigration('0003', '0003_webhooks.sql', 'CREATE TABLE webhooks (id int);'),
      ];
      vi.mocked(discoverMigrations).mockResolvedValue([
        makeMigration('0000', '0000_initial.sql'),
        makeMigration('0001', '0001_schedule.sql'),
        ...pending,
      ]);
      vi.mocked(getPendingMigrations).mockReturnValue(pending);

      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('current_database')) {
          return { rows: [{ db: 'agentctl', user: 'migrator' }] };
        }
        if (sql.includes('SELECT tag')) {
          return { rows: [{ tag: '0000' }, { tag: '0001' }] };
        }
        return { rows: [] };
      });

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.success).toBe(true);
      expect(result.migrationsApplied).toEqual(['0002_add_loop.sql', '0003_webhooks.sql']);
      expect(result.migrationsSkipped).toEqual(['0000', '0001']);
    });

    it('sets database and user in the result', async () => {
      vi.mocked(discoverMigrations).mockResolvedValue([]);
      vi.mocked(getPendingMigrations).mockReturnValue([]);
      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('current_database')) {
          return { rows: [{ db: 'mydb', user: 'deploy_user' }] };
        }
        return { rows: [] };
      });

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.database).toBe('mydb');
      expect(result.user).toBe('deploy_user');
    });

    it('records duration in milliseconds', async () => {
      vi.mocked(discoverMigrations).mockResolvedValue([]);
      vi.mocked(getPendingMigrations).mockReturnValue([]);

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('includes ISO timestamp', async () => {
      vi.mocked(discoverMigrations).mockResolvedValue([]);
      vi.mocked(getPendingMigrations).mockReturnValue([]);

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('releases the lock client after success', async () => {
      vi.mocked(discoverMigrations).mockResolvedValue([]);
      vi.mocked(getPendingMigrations).mockReturnValue([]);

      await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(mockPoolClient.release).toHaveBeenCalled();
    });

    it('releases the migration client after applying migrations', async () => {
      const migrationClient = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
      let connectCount = 0;
      mockPool.connect.mockImplementation(async () => {
        connectCount++;
        // First connect is for lock, second is for migrations
        if (connectCount === 1) return mockPoolClient;
        return migrationClient;
      });

      const pending = [makeMigration('0000', '0000_init.sql', '-- sql')];
      vi.mocked(discoverMigrations).mockResolvedValue(pending);
      vi.mocked(getPendingMigrations).mockReturnValue(pending);

      await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(migrationClient.release).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Dry-run mode
  // --------------------------------------------------------------------------

  describe('dry-run mode', () => {
    it('reports pending migrations without applying them', async () => {
      const pending = [
        makeMigration('0002', '0002_add_loop.sql'),
        makeMigration('0003', '0003_webhooks.sql'),
      ];
      vi.mocked(discoverMigrations).mockResolvedValue(pending);
      vi.mocked(getPendingMigrations).mockReturnValue(pending);

      const result = await runMigrations(
        mockPool as unknown as pg.Pool,
        defaultOptions({ dryRun: true }),
      );

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.migrationsPending).toEqual(['0002_add_loop.sql', '0003_webhooks.sql']);
      expect(result.migrationsApplied).toEqual([]);
    });

    it('does not execute any migration SQL', async () => {
      const pending = [makeMigration('0002', '0002_test.sql', 'DROP TABLE important;')];
      vi.mocked(discoverMigrations).mockResolvedValue(pending);
      vi.mocked(getPendingMigrations).mockReturnValue(pending);

      await runMigrations(mockPool as unknown as pg.Pool, defaultOptions({ dryRun: true }));

      // The migration client should not have been acquired (only lock client + pool queries)
      // Verify no BEGIN was called on the pool client for migration purposes
      const clientCalls = mockPoolClient.query.mock.calls.map((c) => String(c[0]));
      const hasBeginForMigration = clientCalls.some((sql) => sql === 'BEGIN');
      expect(hasBeginForMigration).toBe(false);
    });

    it('still acquires and releases the advisory lock', async () => {
      vi.mocked(discoverMigrations).mockResolvedValue([]);
      vi.mocked(getPendingMigrations).mockReturnValue([]);

      await runMigrations(mockPool as unknown as pg.Pool, defaultOptions({ dryRun: true }));

      const clientCalls = mockPoolClient.query.mock.calls.map((c) => String(c[0]));
      expect(clientCalls.some((sql) => sql.includes('pg_try_advisory_lock'))).toBe(true);
      expect(clientCalls.some((sql) => sql.includes('pg_advisory_unlock'))).toBe(true);
    });

    it('sets dryRun flag in result', async () => {
      vi.mocked(discoverMigrations).mockResolvedValue([]);
      vi.mocked(getPendingMigrations).mockReturnValue([]);

      const result = await runMigrations(
        mockPool as unknown as pg.Pool,
        defaultOptions({ dryRun: true }),
      );

      expect(result.dryRun).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Lock contention
  // --------------------------------------------------------------------------

  describe('lock contention', () => {
    it('returns lock contention error when advisory lock is not acquired', async () => {
      mockPoolClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return { rows: [{ locked: false }] };
        }
        return { rows: [] };
      });

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('LOCK_CONTENTION');
    });

    it('releases the client when lock is not acquired', async () => {
      mockPoolClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return { rows: [{ locked: false }] };
        }
        return { rows: [] };
      });

      await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(mockPoolClient.release).toHaveBeenCalled();
    });

    it('returns lock error when advisory lock query fails', async () => {
      mockPoolClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('lock_timeout')) {
          throw new Error('canceling statement due to lock timeout');
        }
        return { rows: [] };
      });

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('LOCK_ERROR');
    });

    it('does not attempt any migrations when lock is contended', async () => {
      mockPoolClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return { rows: [{ locked: false }] };
        }
        return { rows: [] };
      });

      await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      // discoverMigrations should not have been called
      expect(discoverMigrations).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Connection errors
  // --------------------------------------------------------------------------

  describe('connection errors', () => {
    it('returns connection error when validateUserPermissions fails', async () => {
      mockPool.query.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CONNECTION_ERROR');
      expect(result.error?.message).toContain('ECONNREFUSED');
    });

    it('returns connection error when pool.connect fails for lock', async () => {
      mockPool.query.mockImplementation(async (sql: string) => {
        if (sql.includes('current_database')) {
          return { rows: [{ db: 'db', user: 'user' }] };
        }
        return { rows: [] };
      });
      mockPool.connect.mockRejectedValueOnce(new Error('too many connections'));

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.success).toBe(false);
    });

    it('handles MigrateDeployError in permission validation', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // empty rows = no user info

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PERMISSION_CHECK_FAILED');
    });
  });

  // --------------------------------------------------------------------------
  // Migration failure mid-batch
  // --------------------------------------------------------------------------

  describe('migration failure mid-batch', () => {
    it('records partial progress when a migration fails', async () => {
      const pending = [
        makeMigration('0001', '0001_good.sql', '-- good sql'),
        makeMigration('0002', '0002_bad.sql', '-- bad sql'),
        makeMigration('0003', '0003_never.sql', '-- never reached'),
      ];
      vi.mocked(discoverMigrations).mockResolvedValue(pending);
      vi.mocked(getPendingMigrations).mockReturnValue(pending);

      let _migrationCount = 0;
      const migrationClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql === '-- bad sql') {
            throw new Error('column "x" does not exist');
          }
          if (sql === '-- good sql' || sql.includes('INSERT INTO')) {
            _migrationCount++;
          }
          return { rows: [] };
        }),
        release: vi.fn(),
      };

      let connectCount = 0;
      mockPool.connect.mockImplementation(async () => {
        connectCount++;
        if (connectCount === 1) return mockPoolClient;
        return migrationClient;
      });

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.success).toBe(false);
      expect(result.migrationsApplied).toEqual(['0001_good.sql']);
      expect(result.error?.code).toBe('MIGRATION_FAILED');
      expect(result.error?.migration).toBe('0002_bad.sql');
    });

    it('rolls back the failed migration but keeps prior commits', async () => {
      const pending = [
        makeMigration('0001', '0001_ok.sql', '-- ok'),
        makeMigration('0002', '0002_fail.sql', '-- fail'),
      ];
      vi.mocked(discoverMigrations).mockResolvedValue(pending);
      vi.mocked(getPendingMigrations).mockReturnValue(pending);

      const calls: string[] = [];
      const migrationClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          calls.push(sql);
          if (sql === '-- fail') {
            throw new Error('boom');
          }
          return { rows: [] };
        }),
        release: vi.fn(),
      };

      let connectCount = 0;
      mockPool.connect.mockImplementation(async () => {
        connectCount++;
        if (connectCount === 1) return mockPoolClient;
        return migrationClient;
      });

      await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      // First migration: BEGIN, timeout, SQL, INSERT, COMMIT
      // Second migration: BEGIN, timeout, SQL (fails), ROLLBACK
      const commitCount = calls.filter((c) => c === 'COMMIT').length;
      const rollbackCount = calls.filter((c) => c === 'ROLLBACK').length;
      expect(commitCount).toBe(1); // first migration committed
      expect(rollbackCount).toBe(1); // second migration rolled back
    });

    it('releases the migration client even on failure', async () => {
      const pending = [makeMigration('0001', '0001_fail.sql', '-- fail')];
      vi.mocked(discoverMigrations).mockResolvedValue(pending);
      vi.mocked(getPendingMigrations).mockReturnValue(pending);

      const migrationClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql === '-- fail') {
            throw new Error('boom');
          }
          return { rows: [] };
        }),
        release: vi.fn(),
      };

      let connectCount = 0;
      mockPool.connect.mockImplementation(async () => {
        connectCount++;
        if (connectCount === 1) return mockPoolClient;
        return migrationClient;
      });

      await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(migrationClient.release).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Advisory lock release guarantee
  // --------------------------------------------------------------------------

  describe('advisory lock release', () => {
    it('releases advisory lock on success', async () => {
      vi.mocked(discoverMigrations).mockResolvedValue([]);
      vi.mocked(getPendingMigrations).mockReturnValue([]);

      await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      const unlockCalls = mockPoolClient.query.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('pg_advisory_unlock'),
      );
      expect(unlockCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('releases advisory lock on migration failure', async () => {
      const pending = [makeMigration('0001', '0001_fail.sql', '-- fail')];
      vi.mocked(discoverMigrations).mockResolvedValue(pending);
      vi.mocked(getPendingMigrations).mockReturnValue(pending);

      const migrationClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql === '-- fail') {
            throw new Error('boom');
          }
          return { rows: [] };
        }),
        release: vi.fn(),
      };

      let connectCount = 0;
      mockPool.connect.mockImplementation(async () => {
        connectCount++;
        if (connectCount === 1) return mockPoolClient;
        return migrationClient;
      });

      await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      const unlockCalls = mockPoolClient.query.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('pg_advisory_unlock'),
      );
      expect(unlockCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('releases lock client even when unlock query fails', async () => {
      vi.mocked(discoverMigrations).mockResolvedValue([]);
      vi.mocked(getPendingMigrations).mockReturnValue([]);

      // Make unlock fail
      const originalImpl = mockPoolClient.query.getMockImplementation();
      mockPoolClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (typeof sql === 'string' && sql.includes('pg_advisory_unlock')) {
          throw new Error('unlock network error');
        }
        if (originalImpl) {
          return originalImpl(sql, params);
        }
        return { rows: [] };
      });

      // Should not throw — the error is swallowed in the finally block
      await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      // Client should still be released
      expect(mockPoolClient.release).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Statement timeout
  // --------------------------------------------------------------------------

  describe('statement timeout', () => {
    it('passes the configured timeout to applyMigration', async () => {
      const pending = [makeMigration('0001', '0001_slow.sql', '-- slow')];
      vi.mocked(discoverMigrations).mockResolvedValue(pending);
      vi.mocked(getPendingMigrations).mockReturnValue(pending);

      const migrationClient = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      };

      let connectCount = 0;
      mockPool.connect.mockImplementation(async () => {
        connectCount++;
        if (connectCount === 1) return mockPoolClient;
        return migrationClient;
      });

      await runMigrations(
        mockPool as unknown as pg.Pool,
        defaultOptions({ statementTimeoutMs: 60_000 }),
      );

      const timeoutCall = migrationClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('statement_timeout'),
      );
      expect(timeoutCall).toBeDefined();
      expect(String(timeoutCall?.[0])).toContain('60000');
    });

    it('handles statement timeout errors as migration failures', async () => {
      const pending = [makeMigration('0001', '0001_slow.sql', '-- slow')];
      vi.mocked(discoverMigrations).mockResolvedValue(pending);
      vi.mocked(getPendingMigrations).mockReturnValue(pending);

      const migrationClient = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql === '-- slow') {
            throw new Error('canceling statement due to statement timeout');
          }
          return { rows: [] };
        }),
        release: vi.fn(),
      };

      let connectCount = 0;
      mockPool.connect.mockImplementation(async () => {
        connectCount++;
        if (connectCount === 1) return mockPoolClient;
        return migrationClient;
      });

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MIGRATION_FAILED');
      expect(result.error?.message).toContain('statement timeout');
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty migrations directory', async () => {
      vi.mocked(discoverMigrations).mockResolvedValue([]);
      vi.mocked(getPendingMigrations).mockReturnValue([]);

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.success).toBe(true);
      expect(result.migrationsApplied).toEqual([]);
    });

    it('handles unexpected error types in the catch block', async () => {
      vi.mocked(discoverMigrations).mockRejectedValue('string error');

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNEXPECTED_ERROR');
    });

    it('handles MigrateDeployError from discoverMigrations', async () => {
      vi.mocked(discoverMigrations).mockRejectedValue(
        new MigrateDeployError('DISCOVER_FAILED', 'cannot read dir'),
      );

      const result = await runMigrations(mockPool as unknown as pg.Pool, defaultOptions());

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DISCOVER_FAILED');
    });
  });
});

// ============================================================================
// 10. exitCodeFromResult
// ============================================================================

describe('exitCodeFromResult', () => {
  it('returns 0 for successful result', () => {
    const result = makeSuccessResult();

    expect(exitCodeFromResult(result)).toBe(EXIT_SUCCESS);
  });

  it('returns 0 for successful dry-run', () => {
    const result = makeSuccessResult({ dryRun: true });

    expect(exitCodeFromResult(result)).toBe(EXIT_SUCCESS);
  });

  it('returns 1 for migration failure', () => {
    const result = makeSuccessResult({
      success: false,
      error: { code: 'MIGRATION_FAILED', message: 'boom' },
    });

    expect(exitCodeFromResult(result)).toBe(EXIT_MIGRATION_FAILED);
  });

  it('returns 2 for lock contention', () => {
    const result = makeSuccessResult({
      success: false,
      error: { code: 'LOCK_CONTENTION', message: 'locked' },
    });

    expect(exitCodeFromResult(result)).toBe(EXIT_LOCK_CONTENTION);
  });

  it('returns 3 for connection error', () => {
    const result = makeSuccessResult({
      success: false,
      error: { code: 'CONNECTION_ERROR', message: 'refused' },
    });

    expect(exitCodeFromResult(result)).toBe(EXIT_CONNECTION_ERROR);
  });

  it('returns 1 for unknown error codes', () => {
    const result = makeSuccessResult({
      success: false,
      error: { code: 'SOMETHING_ELSE', message: 'mystery' },
    });

    expect(exitCodeFromResult(result)).toBe(EXIT_MIGRATION_FAILED);
  });

  it('returns 1 when error is undefined but success is false', () => {
    const result = makeSuccessResult({ success: false });

    expect(exitCodeFromResult(result)).toBe(EXIT_MIGRATION_FAILED);
  });
});

// ============================================================================
// 11. Constants
// ============================================================================

describe('constants', () => {
  it('exports EXIT_SUCCESS as 0', () => {
    expect(EXIT_SUCCESS).toBe(0);
  });

  it('exports EXIT_MIGRATION_FAILED as 1', () => {
    expect(EXIT_MIGRATION_FAILED).toBe(1);
  });

  it('exports EXIT_LOCK_CONTENTION as 2', () => {
    expect(EXIT_LOCK_CONTENTION).toBe(2);
  });

  it('exports EXIT_CONNECTION_ERROR as 3', () => {
    expect(EXIT_CONNECTION_ERROR).toBe(3);
  });

  it('exports ADVISORY_LOCK_KEY as a number', () => {
    expect(typeof ADVISORY_LOCK_KEY).toBe('number');
    expect(ADVISORY_LOCK_KEY).toBe(8675309);
  });

  it('exports DEFAULT_MIGRATIONS_DIR as an absolute path', () => {
    expect(path.isAbsolute(DEFAULT_MIGRATIONS_DIR)).toBe(true);
    expect(DEFAULT_MIGRATIONS_DIR).toContain('packages/control-plane/drizzle');
  });
});

// ============================================================================
// 12. main function (integration-level)
// ============================================================================

describe('main', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = 'postgres://testuser:pass@localhost:5432/testdb';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Re-establish default mock behavior (may have been overridden by prior tests)
    mockPool.connect.mockImplementation(() => Promise.resolve(mockPoolClient));

    // Default mocks for main flow
    vi.mocked(discoverMigrations).mockResolvedValue([]);
    vi.mocked(getPendingMigrations).mockReturnValue([]);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('outputs structured JSON to stdout', async () => {
    const _result = await main(['node', 'migrate-deploy.ts']);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"success"'));
  });

  it('logs connection info to stderr', async () => {
    await main(['node', 'migrate-deploy.ts']);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Connecting as user'));
  });

  it('masks the password in connection log', async () => {
    await main(['node', 'migrate-deploy.ts']);

    const errorCalls = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    const connectLog = errorCalls.find((c) => c.includes('Connecting'));
    expect(connectLog).not.toContain('pass');
    expect(connectLog).toContain('****');
  });

  it('reports dry-run mode in stderr', async () => {
    await main(['node', 'migrate-deploy.ts', '--dry-run']);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('DRY RUN'));
  });

  it('calls pool.end() after completion', async () => {
    await main(['node', 'migrate-deploy.ts']);

    expect(mockPool.end).toHaveBeenCalled();
  });

  it('creates pool with connection timeout and max connections', async () => {
    await main(['node', 'migrate-deploy.ts']);

    expect(pg.Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeoutMillis: 10_000,
        max: 2,
      }),
    );
  });

  it('returns a MigrateDeployResult', async () => {
    const result = await main(['node', 'migrate-deploy.ts']);

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('dryRun');
    expect(result).toHaveProperty('migrationsApplied');
    expect(result).toHaveProperty('timestamp');
  });

  it('reports success message when database is up to date', async () => {
    await main(['node', 'migrate-deploy.ts']);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('up to date'));
  });

  it('reports applied count on successful migration', async () => {
    const pending = [makeMigration('0001', '0001_test.sql', '-- test')];
    vi.mocked(discoverMigrations).mockResolvedValue(pending);
    vi.mocked(getPendingMigrations).mockReturnValue(pending);

    await main(['node', 'migrate-deploy.ts']);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Successfully applied 1 migration(s)'),
    );
  });

  it('reports failure message and error code on failure', async () => {
    mockPool.query.mockRejectedValue(new Error('connection refused'));

    await main(['node', 'migrate-deploy.ts']);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('FAILED'));
  });

  it('calls pool.end() even when runMigrations fails', async () => {
    mockPool.connect.mockRejectedValue(new Error('pool error'));
    // Ensure validateUserPermissions succeeds so we get to connect
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('current_database')) {
        return { rows: [{ db: 'db', user: 'user' }] };
      }
      return { rows: [] };
    });

    await main(['node', 'migrate-deploy.ts']);

    expect(mockPool.end).toHaveBeenCalled();
  });

  it('uses MIGRATION_DATABASE_URL when set', async () => {
    process.env.MIGRATION_DATABASE_URL = 'postgres://migrator:secret@host:5432/db';

    await main(['node', 'migrate-deploy.ts']);

    expect(pg.Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: 'postgres://migrator:secret@host:5432/db',
      }),
    );
  });

  it('reports dry-run pending count', async () => {
    const pending = [makeMigration('0001', '0001_a.sql'), makeMigration('0002', '0002_b.sql')];
    vi.mocked(discoverMigrations).mockResolvedValue(pending);
    vi.mocked(getPendingMigrations).mockReturnValue(pending);

    await main(['node', 'migrate-deploy.ts', '--dry-run']);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('2 migration(s) pending'));
  });
});

// ============================================================================
// 13. Structured JSON output format
// ============================================================================

describe('structured JSON output', () => {
  it('success result includes all required fields', () => {
    const result = makeSuccessResult({
      migrationsApplied: ['0001_test.sql'],
      migrationsSkipped: ['0000'],
      migrationsPending: [],
    });
    const json = JSON.parse(JSON.stringify(result));

    expect(json).toHaveProperty('success', true);
    expect(json).toHaveProperty('dryRun', false);
    expect(json).toHaveProperty('migrationsApplied');
    expect(json).toHaveProperty('migrationsSkipped');
    expect(json).toHaveProperty('migrationsPending');
    expect(json).toHaveProperty('durationMs');
    expect(json).toHaveProperty('database');
    expect(json).toHaveProperty('user');
    expect(json).toHaveProperty('timestamp');
  });

  it('failure result includes error details', () => {
    const result = makeSuccessResult({
      success: false,
      error: { code: 'MIGRATION_FAILED', message: 'syntax error', migration: '0001_bad.sql' },
    });
    const json = JSON.parse(JSON.stringify(result));

    expect(json.error).toEqual({
      code: 'MIGRATION_FAILED',
      message: 'syntax error',
      migration: '0001_bad.sql',
    });
  });

  it('result is valid JSON that can be parsed by CI tools', () => {
    const result = makeSuccessResult({
      migrationsApplied: ['0001_a.sql', '0002_b.sql'],
      durationMs: 1234,
    });
    const serialized = JSON.stringify(result, null, 2);
    const parsed = JSON.parse(serialized);

    expect(parsed.migrationsApplied).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(parsed.durationMs).toBe(1234);
  });

  it('error field is omitted when result is successful', () => {
    const result = makeSuccessResult();
    const json = JSON.parse(JSON.stringify(result));

    expect(json.error).toBeUndefined();
  });
});

// ============================================================================
// 14. Concurrent access simulation
// ============================================================================

describe('concurrent access simulation', () => {
  it('second runner gets lock contention when first holds the lock', async () => {
    // First runner: lock succeeds
    const client1 = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return { rows: [{ locked: true }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    // Second runner: lock fails
    const client2 = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return { rows: [{ locked: false }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const pool1 = {
      ...mockPool,
      connect: vi.fn().mockResolvedValue(client1),
    };
    const pool2 = {
      ...mockPool,
      connect: vi.fn().mockResolvedValue(client2),
    };

    vi.mocked(discoverMigrations).mockResolvedValue([]);
    vi.mocked(getPendingMigrations).mockReturnValue([]);

    const [result1, result2] = await Promise.all([
      runMigrations(pool1 as unknown as pg.Pool, defaultOptions()),
      runMigrations(pool2 as unknown as pg.Pool, defaultOptions()),
    ]);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(false);
    expect(result2.error?.code).toBe('LOCK_CONTENTION');
  });
});

// ============================================================================
// 15. Import path for path module (needed for DEFAULT_MIGRATIONS_DIR test)
// ============================================================================

import * as path from 'node:path';
