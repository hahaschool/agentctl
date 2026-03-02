import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock node:child_process, node:fs, node:fs/promises, node:zlib
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  createReadStream: vi.fn(),
  createWriteStream: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('node:zlib', () => ({
  createGzip: vi.fn(),
}));

import { execFile as execFileCb } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { createGzip } from 'node:zlib';

import { ControlPlaneError } from '@agentctl/shared';

import type { DestructiveOperation } from './db-backup.js';
import {
  buildBackupFilename,
  createBackupManager,
  detectDestructiveOperations,
  parseBackupFilename,
  requiresApproval,
  scanMigrationsForDestructive,
  sortBackupsByTimestamp,
} from './db-backup.js';

// ---------------------------------------------------------------------------
// Helpers for mock setup
// ---------------------------------------------------------------------------

/** Create a fake writable stream with event handling for createWriteStream mock. */
function makeFakeWriteStream() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const h of handlers[event] ?? []) {
        h(...args);
      }
    },
    write: vi.fn(),
    end: vi.fn(),
  };
}

/** Create a fake gzip transform stream with pipe support. */
function makeFakeGzip(targetStream: ReturnType<typeof makeFakeWriteStream>) {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const h of handlers[event] ?? []) {
        h(...args);
      }
    },
    pipe() {
      return targetStream;
    },
    end() {
      // Simulate successful compression: trigger finish on the write stream
      targetStream.emit('finish');
    },
  };
}

/** Set up mocks so createBackup succeeds. */
function setupSuccessfulBackupMocks() {
  vi.mocked(mkdir).mockResolvedValue(undefined);

  const fakeStream = makeFakeWriteStream();
  const fakeGzip = makeFakeGzip(fakeStream);

  vi.mocked(createWriteStream).mockReturnValue(
    fakeStream as unknown as ReturnType<typeof createWriteStream>,
  );
  vi.mocked(createGzip).mockReturnValue(fakeGzip as unknown as ReturnType<typeof createGzip>);

  // pg_dump returns raw bytes
  vi.mocked(execFileCb).mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb?: unknown) => {
      if (typeof cb === 'function') {
        cb(null, Buffer.from('pg_dump data'), '');
      } else if (typeof _args === 'function') {
        // 3-arg overload
        _args(null, Buffer.from('pg_dump data'), '');
      }
      return undefined as never;
    },
  );

  vi.mocked(stat).mockResolvedValue({ size: 1234 } as Awaited<ReturnType<typeof stat>>);

  return { fakeStream, fakeGzip };
}

// ============================================================================
// 1. buildBackupFilename
// ============================================================================

describe('buildBackupFilename', () => {
  it('generates a filename with database name and ISO timestamp', () => {
    const ts = new Date('2026-03-02T10:30:00.000Z');
    const name = buildBackupFilename('agentctl', ts);

    expect(name).toBe('backup-agentctl-2026-03-02T10-30-00-000Z.sql.gz');
  });

  it('replaces colons and dots in the timestamp', () => {
    const ts = new Date('2025-12-31T23:59:59.999Z');
    const name = buildBackupFilename('mydb', ts);

    expect(name).toBe('backup-mydb-2025-12-31T23-59-59-999Z.sql.gz');
  });

  it('handles database names with hyphens', () => {
    const ts = new Date('2026-01-01T00:00:00.000Z');
    const name = buildBackupFilename('my-database', ts);

    expect(name).toMatch(/^backup-my-database-/);
    expect(name).toMatch(/\.sql\.gz$/);
  });

  it('handles database names with underscores', () => {
    const ts = new Date('2026-06-15T12:00:00.000Z');
    const name = buildBackupFilename('my_database', ts);

    expect(name).toMatch(/^backup-my_database-/);
  });

  it('produces unique names for different timestamps', () => {
    const ts1 = new Date('2026-03-02T10:30:00.000Z');
    const ts2 = new Date('2026-03-02T10:30:01.000Z');

    expect(buildBackupFilename('db', ts1)).not.toBe(buildBackupFilename('db', ts2));
  });
});

// ============================================================================
// 2. parseBackupFilename
// ============================================================================

describe('parseBackupFilename', () => {
  it('parses a valid backup filename', () => {
    const result = parseBackupFilename('backup-agentctl-2026-03-02T10-30-00-000Z.sql.gz');

    expect(result).toEqual({
      database: 'agentctl',
      timestamp: '2026-03-02T10-30-00-000Z',
    });
  });

  it('parses a filename with hyphens in database name', () => {
    const result = parseBackupFilename('backup-my-db-2026-01-01T00-00-00-000Z.sql.gz');

    // The greedy match captures "my-db"
    expect(result).toBeDefined();
    expect(result?.timestamp).toBe('2026-01-01T00-00-00-000Z');
  });

  it('returns undefined for non-backup filenames', () => {
    expect(parseBackupFilename('README.md')).toBeUndefined();
    expect(parseBackupFilename('backup.sql')).toBeUndefined();
    expect(parseBackupFilename('random-file.gz')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseBackupFilename('')).toBeUndefined();
  });

  it('returns undefined for backup files without .gz extension', () => {
    expect(parseBackupFilename('backup-db-2026-03-02T10-30-00-000Z.sql')).toBeUndefined();
  });

  it('roundtrips with buildBackupFilename', () => {
    const ts = new Date('2026-03-02T10:30:00.000Z');
    const filename = buildBackupFilename('agentctl', ts);
    const parsed = parseBackupFilename(filename);

    expect(parsed).toBeDefined();
    expect(parsed?.database).toBe('agentctl');
  });
});

// ============================================================================
// 3. sortBackupsByTimestamp
// ============================================================================

describe('sortBackupsByTimestamp', () => {
  it('sorts backups newest first', () => {
    const files = [
      'backup-db-2026-01-01T00-00-00-000Z.sql.gz',
      'backup-db-2026-03-01T00-00-00-000Z.sql.gz',
      'backup-db-2026-02-01T00-00-00-000Z.sql.gz',
    ];

    const sorted = sortBackupsByTimestamp(files);

    expect(sorted[0]).toContain('2026-03-01');
    expect(sorted[1]).toContain('2026-02-01');
    expect(sorted[2]).toContain('2026-01-01');
  });

  it('returns a new array (does not mutate input)', () => {
    const files = [
      'backup-db-2026-01-01T00-00-00-000Z.sql.gz',
      'backup-db-2026-03-01T00-00-00-000Z.sql.gz',
    ];

    const sorted = sortBackupsByTimestamp(files);

    expect(sorted).not.toBe(files);
    expect(files[0]).toContain('2026-01-01');
  });

  it('handles empty array', () => {
    expect(sortBackupsByTimestamp([])).toEqual([]);
  });

  it('handles single entry', () => {
    const files = ['backup-db-2026-03-01T00-00-00-000Z.sql.gz'];
    const sorted = sortBackupsByTimestamp(files);

    expect(sorted).toHaveLength(1);
  });

  it('handles non-backup filenames gracefully (keeps them in place)', () => {
    const files = ['README.md', 'backup-db-2026-01-01T00-00-00-000Z.sql.gz'];

    const sorted = sortBackupsByTimestamp(files);

    expect(sorted).toHaveLength(2);
  });
});

// ============================================================================
// 4. createBackupManager — configuration
// ============================================================================

describe('createBackupManager — configuration', () => {
  it('creates a manager with default config', () => {
    const manager = createBackupManager();
    const cfg = manager.getConfig();

    expect(cfg.backupDir).toBe('./backups');
    expect(cfg.database).toBe('agentctl');
    expect(cfg.retentionCount).toBe(7);
    expect(cfg.pgDumpPath).toBe('pg_dump');
    expect(cfg.pgDumpArgs).toEqual([]);
    expect(cfg.connectionString).toBe('');
  });

  it('merges partial config with defaults', () => {
    const manager = createBackupManager({
      database: 'custom_db',
      retentionCount: 3,
    });
    const cfg = manager.getConfig();

    expect(cfg.database).toBe('custom_db');
    expect(cfg.retentionCount).toBe(3);
    expect(cfg.backupDir).toBe('./backups'); // default preserved
  });

  it('accepts all config fields', () => {
    const manager = createBackupManager({
      backupDir: '/tmp/backups',
      database: 'prod',
      connectionString: 'postgres://user:pass@host:5432/prod',
      retentionCount: 14,
      pgDumpPath: '/usr/bin/pg_dump',
      pgDumpArgs: ['--no-owner', '--no-privileges'],
    });
    const cfg = manager.getConfig();

    expect(cfg.backupDir).toBe('/tmp/backups');
    expect(cfg.pgDumpPath).toBe('/usr/bin/pg_dump');
    expect(cfg.pgDumpArgs).toEqual(['--no-owner', '--no-privileges']);
  });

  it('throws ControlPlaneError when retentionCount < 1', () => {
    expect(() => createBackupManager({ retentionCount: 0 })).toThrow(ControlPlaneError);
    expect(() => createBackupManager({ retentionCount: -1 })).toThrow(ControlPlaneError);
  });

  it('throws with correct error code for invalid retention', () => {
    try {
      createBackupManager({ retentionCount: 0 });
    } catch (err) {
      expect(err).toBeInstanceOf(ControlPlaneError);
      expect((err as ControlPlaneError).code).toBe('INVALID_RETENTION_COUNT');
    }
  });

  it('returns a copy of config (not a reference)', () => {
    const manager = createBackupManager({ database: 'original' });
    const cfg1 = manager.getConfig();
    const cfg2 = manager.getConfig();

    expect(cfg1).not.toBe(cfg2);
    expect(cfg1).toEqual(cfg2);
  });
});

// ============================================================================
// 5. createBackupManager — createBackup
// ============================================================================

describe('createBackupManager — createBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws ControlPlaneError when connectionString is empty', async () => {
    const manager = createBackupManager({ database: 'db' });

    await expect(manager.createBackup()).rejects.toThrow(ControlPlaneError);
    await expect(manager.createBackup()).rejects.toThrow(/connectionString is required/);
  });

  it('throws with MISSING_CONNECTION_STRING error code', async () => {
    const manager = createBackupManager();

    try {
      await manager.createBackup();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ControlPlaneError).code).toBe('MISSING_CONNECTION_STRING');
    }
  });

  it('creates the backup directory if it does not exist', async () => {
    setupSuccessfulBackupMocks();

    const manager = createBackupManager({
      connectionString: 'postgres://localhost/test',
      backupDir: '/tmp/test-backups',
    });

    await manager.createBackup();

    expect(mkdir).toHaveBeenCalledWith('/tmp/test-backups', { recursive: true });
  });

  it('throws ControlPlaneError when mkdir fails', async () => {
    vi.mocked(mkdir).mockRejectedValue(new Error('EACCES: permission denied'));

    const manager = createBackupManager({
      connectionString: 'postgres://localhost/test',
    });

    await expect(manager.createBackup()).rejects.toThrow(ControlPlaneError);

    try {
      await manager.createBackup();
    } catch (err) {
      expect((err as ControlPlaneError).code).toBe('BACKUP_DIR_CREATE_FAILED');
    }
  });

  it('calls pg_dump with correct connection string', async () => {
    setupSuccessfulBackupMocks();

    const manager = createBackupManager({
      connectionString: 'postgres://user:pass@host:5432/mydb',
      database: 'mydb',
    });

    await manager.createBackup();

    expect(execFileCb).toHaveBeenCalled();
    const call = vi.mocked(execFileCb).mock.calls[0];
    expect(call[0]).toBe('pg_dump');
    const args = call[1] as string[];
    expect(args).toContain('--dbname');
    expect(args).toContain('postgres://user:pass@host:5432/mydb');
  });

  it('uses custom pgDumpPath when configured', async () => {
    setupSuccessfulBackupMocks();

    const manager = createBackupManager({
      connectionString: 'postgres://localhost/test',
      pgDumpPath: '/opt/pg16/bin/pg_dump',
    });

    await manager.createBackup();

    const call = vi.mocked(execFileCb).mock.calls[0];
    expect(call[0]).toBe('/opt/pg16/bin/pg_dump');
  });

  it('includes custom pgDumpArgs', async () => {
    setupSuccessfulBackupMocks();

    const manager = createBackupManager({
      connectionString: 'postgres://localhost/test',
      pgDumpArgs: ['--no-owner', '--verbose'],
    });

    await manager.createBackup();

    const call = vi.mocked(execFileCb).mock.calls[0];
    const args = call[1] as string[];
    expect(args).toContain('--no-owner');
    expect(args).toContain('--verbose');
  });

  it('throws ControlPlaneError when pg_dump fails', async () => {
    vi.mocked(mkdir).mockResolvedValue(undefined);

    vi.mocked(execFileCb).mockImplementation(
      (_cmd: unknown, _args: unknown, _opts: unknown, cb?: unknown) => {
        if (typeof cb === 'function') {
          cb(new Error('pg_dump: command not found'), null, '');
        }
        return undefined as never;
      },
    );

    const manager = createBackupManager({
      connectionString: 'postgres://localhost/test',
    });

    await expect(manager.createBackup()).rejects.toThrow(ControlPlaneError);

    try {
      await manager.createBackup();
    } catch (err) {
      expect((err as ControlPlaneError).code).toBe('PG_DUMP_FAILED');
    }
  });

  it('returns a BackupResult with correct fields', async () => {
    setupSuccessfulBackupMocks();

    const manager = createBackupManager({
      connectionString: 'postgres://localhost/test',
      database: 'testdb',
      backupDir: '/tmp/bk',
    });

    const result = await manager.createBackup();

    expect(result.database).toBe('testdb');
    expect(result.path).toMatch(/^\/tmp\/bk\/backup-testdb-/);
    expect(result.path).toMatch(/\.sql\.gz$/);
    expect(result.size).toBe(1234);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('reports size as 0 when stat fails', async () => {
    setupSuccessfulBackupMocks();
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'));

    const manager = createBackupManager({
      connectionString: 'postgres://localhost/test',
    });

    const result = await manager.createBackup();

    expect(result.size).toBe(0);
  });

  it('writes to the configured backup directory', async () => {
    setupSuccessfulBackupMocks();

    const manager = createBackupManager({
      connectionString: 'postgres://localhost/test',
      backupDir: '/data/backups',
    });

    const result = await manager.createBackup();

    expect(result.path).toMatch(/^\/data\/backups\//);
  });
});

// ============================================================================
// 6. createBackupManager — enforceRetention
// ============================================================================

describe('createBackupManager — enforceRetention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when backup directory does not exist', async () => {
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));

    const manager = createBackupManager({
      database: 'db',
      retentionCount: 3,
    });

    const deleted = await manager.enforceRetention();

    expect(deleted).toEqual([]);
  });

  it('returns empty array when directory is empty', async () => {
    vi.mocked(readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);

    const manager = createBackupManager({
      database: 'db',
      retentionCount: 3,
    });

    const deleted = await manager.enforceRetention();

    expect(deleted).toEqual([]);
  });

  it('returns empty array when fewer than retentionCount backups exist', async () => {
    vi.mocked(readdir).mockResolvedValue([
      'backup-db-2026-01-01T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-02T00-00-00-000Z.sql.gz',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    const manager = createBackupManager({
      database: 'db',
      retentionCount: 3,
    });

    const deleted = await manager.enforceRetention();

    expect(deleted).toEqual([]);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('returns empty array when exactly retentionCount backups exist', async () => {
    vi.mocked(readdir).mockResolvedValue([
      'backup-db-2026-01-01T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-02T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-03T00-00-00-000Z.sql.gz',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    const manager = createBackupManager({
      database: 'db',
      retentionCount: 3,
    });

    const deleted = await manager.enforceRetention();

    expect(deleted).toEqual([]);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('deletes oldest backups beyond retention count', async () => {
    vi.mocked(readdir).mockResolvedValue([
      'backup-db-2026-01-01T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-02T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-03T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-04T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-05T00-00-00-000Z.sql.gz',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    vi.mocked(unlink).mockResolvedValue(undefined);

    const manager = createBackupManager({
      database: 'db',
      retentionCount: 3,
      backupDir: '/tmp/bk',
    });

    const deleted = await manager.enforceRetention();

    expect(deleted).toHaveLength(2);
    // Oldest two should be deleted
    expect(deleted).toContain('backup-db-2026-01-01T00-00-00-000Z.sql.gz');
    expect(deleted).toContain('backup-db-2026-01-02T00-00-00-000Z.sql.gz');
  });

  it('keeps the newest backups', async () => {
    vi.mocked(readdir).mockResolvedValue([
      'backup-db-2026-01-01T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-02T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-03T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-04T00-00-00-000Z.sql.gz',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    vi.mocked(unlink).mockResolvedValue(undefined);

    const manager = createBackupManager({
      database: 'db',
      retentionCount: 2,
      backupDir: '/tmp/bk',
    });

    const deleted = await manager.enforceRetention();

    // Should delete the 2 oldest, keep 2 newest
    expect(deleted).toHaveLength(2);
    expect(deleted).not.toContain('backup-db-2026-01-03T00-00-00-000Z.sql.gz');
    expect(deleted).not.toContain('backup-db-2026-01-04T00-00-00-000Z.sql.gz');
  });

  it('ignores non-backup files in the directory', async () => {
    vi.mocked(readdir).mockResolvedValue([
      'README.md',
      '.DS_Store',
      'backup-db-2026-01-01T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-02T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-03T00-00-00-000Z.sql.gz',
      'random.sql.gz',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    vi.mocked(unlink).mockResolvedValue(undefined);

    const manager = createBackupManager({
      database: 'db',
      retentionCount: 2,
      backupDir: '/tmp/bk',
    });

    const deleted = await manager.enforceRetention();

    // Only 3 backup files match, retain 2, delete 1
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain('2026-01-01');
  });

  it('only considers backups matching the configured database', async () => {
    vi.mocked(readdir).mockResolvedValue([
      'backup-db-2026-01-01T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-02T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-03T00-00-00-000Z.sql.gz',
      'backup-other-2026-01-01T00-00-00-000Z.sql.gz',
      'backup-other-2026-01-02T00-00-00-000Z.sql.gz',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    vi.mocked(unlink).mockResolvedValue(undefined);

    const manager = createBackupManager({
      database: 'db',
      retentionCount: 2,
      backupDir: '/tmp/bk',
    });

    const deleted = await manager.enforceRetention();

    // Only db backups (3), retain 2, delete 1
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain('backup-db-');
  });

  it('skips files that fail to delete', async () => {
    vi.mocked(readdir).mockResolvedValue([
      'backup-db-2026-01-01T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-02T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-03T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-04T00-00-00-000Z.sql.gz',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    vi.mocked(unlink).mockImplementation(async (path) => {
      const p = String(path);
      if (p.includes('2026-01-01')) {
        throw new Error('EACCES: permission denied');
      }
    });

    const manager = createBackupManager({
      database: 'db',
      retentionCount: 2,
      backupDir: '/tmp/bk',
    });

    const deleted = await manager.enforceRetention();

    // 2 to delete, but one fails — only the successful one is in the result
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain('2026-01-02');
  });

  it('handles retentionCount of 1', async () => {
    vi.mocked(readdir).mockResolvedValue([
      'backup-db-2026-01-01T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-02T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-03T00-00-00-000Z.sql.gz',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    vi.mocked(unlink).mockResolvedValue(undefined);

    const manager = createBackupManager({
      database: 'db',
      retentionCount: 1,
      backupDir: '/tmp/bk',
    });

    const deleted = await manager.enforceRetention();

    expect(deleted).toHaveLength(2);
  });

  it('constructs correct file paths for unlink', async () => {
    vi.mocked(readdir).mockResolvedValue([
      'backup-db-2026-01-01T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-02T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-03T00-00-00-000Z.sql.gz',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    vi.mocked(unlink).mockResolvedValue(undefined);

    const manager = createBackupManager({
      database: 'db',
      retentionCount: 2,
      backupDir: '/data/backups',
    });

    await manager.enforceRetention();

    expect(unlink).toHaveBeenCalledWith(
      expect.stringContaining('/data/backups/backup-db-2026-01-01'),
    );
  });
});

// ============================================================================
// 7. detectDestructiveOperations — DROP TABLE
// ============================================================================

describe('detectDestructiveOperations — DROP TABLE', () => {
  it('detects DROP TABLE statement', () => {
    const sql = 'DROP TABLE "users";';
    const ops = detectDestructiveOperations(sql, '0005_drop_users.sql');

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_TABLE');
    expect(ops[0].line).toBe(1);
    expect(ops[0].file).toBe('0005_drop_users.sql');
    expect(ops[0].statement).toContain('DROP TABLE');
  });

  it('detects DROP TABLE IF EXISTS', () => {
    const sql = 'DROP TABLE IF EXISTS "old_table";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_TABLE');
  });

  it('detects DROP TABLE with schema prefix', () => {
    const sql = 'DROP TABLE public."users";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_TABLE');
  });

  it('detects DROP TABLE CASCADE', () => {
    const sql = 'DROP TABLE "users" CASCADE;';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_TABLE');
  });

  it('detects DROP TABLE with leading whitespace', () => {
    const sql = '    DROP TABLE "users";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_TABLE');
  });

  it('ignores DROP TABLE in comments', () => {
    const sql = '-- DROP TABLE "users";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(0);
  });

  it('detects multiple DROP TABLE statements', () => {
    const sql = `
DROP TABLE "table_a";
DROP TABLE "table_b";
DROP TABLE IF EXISTS "table_c";
    `;
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(3);
    expect(ops.every((op) => op.kind === 'DROP_TABLE')).toBe(true);
  });

  it('provides correct line numbers for DROP TABLE', () => {
    const sql = `-- comment
CREATE TABLE "new" ("id" serial);

DROP TABLE "old";
    `;
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].line).toBe(4);
  });
});

// ============================================================================
// 8. detectDestructiveOperations — DROP COLUMN
// ============================================================================

describe('detectDestructiveOperations — DROP COLUMN', () => {
  it('detects ALTER TABLE ... DROP COLUMN', () => {
    const sql = 'ALTER TABLE "agents" DROP COLUMN "old_field";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_COLUMN');
  });

  it('detects DROP COLUMN IF EXISTS', () => {
    const sql = 'ALTER TABLE "agents" DROP COLUMN IF EXISTS "deprecated";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_COLUMN');
  });

  it('detects DROP COLUMN with schema-qualified table', () => {
    const sql = 'ALTER TABLE public."agents" DROP COLUMN "field";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_COLUMN');
  });

  it('detects multiple DROP COLUMN in one file', () => {
    const sql = `
ALTER TABLE "agents" DROP COLUMN "col_a";
ALTER TABLE "agents" DROP COLUMN "col_b";
ALTER TABLE "machines" DROP COLUMN "col_c";
    `;
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(3);
    expect(ops.every((op) => op.kind === 'DROP_COLUMN')).toBe(true);
  });

  it('ignores ADD COLUMN (not destructive)', () => {
    const sql = 'ALTER TABLE "agents" ADD COLUMN "new_field" text;';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(0);
  });

  it('is case-insensitive for DROP COLUMN', () => {
    const sql = 'alter table "agents" drop column "field";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_COLUMN');
  });
});

// ============================================================================
// 9. detectDestructiveOperations — TRUNCATE
// ============================================================================

describe('detectDestructiveOperations — TRUNCATE', () => {
  it('detects TRUNCATE TABLE', () => {
    const sql = 'TRUNCATE TABLE "sessions";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('TRUNCATE');
  });

  it('detects TRUNCATE without TABLE keyword', () => {
    const sql = 'TRUNCATE "sessions";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('TRUNCATE');
  });

  it('detects TRUNCATE TABLE CASCADE', () => {
    const sql = 'TRUNCATE TABLE "sessions" CASCADE;';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('TRUNCATE');
  });

  it('ignores TRUNCATE in comments', () => {
    const sql = '-- TRUNCATE TABLE "sessions";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(0);
  });

  it('is case-insensitive for TRUNCATE', () => {
    const sql = 'truncate table "sessions";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('TRUNCATE');
  });
});

// ============================================================================
// 10. detectDestructiveOperations — DROP CONSTRAINT
// ============================================================================

describe('detectDestructiveOperations — DROP CONSTRAINT', () => {
  it('detects ALTER TABLE ... DROP CONSTRAINT', () => {
    const sql = 'ALTER TABLE "agents" DROP CONSTRAINT "agents_machine_id_fkey";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_CONSTRAINT');
  });

  it('detects DROP CONSTRAINT IF EXISTS', () => {
    const sql = 'ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "old_constraint";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_CONSTRAINT');
  });

  it('is case-insensitive for DROP CONSTRAINT', () => {
    const sql = 'alter table "agents" drop constraint "fkey";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_CONSTRAINT');
  });
});

// ============================================================================
// 11. detectDestructiveOperations — DROP INDEX
// ============================================================================

describe('detectDestructiveOperations — DROP INDEX', () => {
  it('detects DROP INDEX', () => {
    const sql = 'DROP INDEX "idx_agents_status";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_INDEX');
  });

  it('detects DROP INDEX IF EXISTS', () => {
    const sql = 'DROP INDEX IF EXISTS "idx_old";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_INDEX');
  });

  it('detects DROP INDEX CONCURRENTLY', () => {
    const sql = 'DROP INDEX CONCURRENTLY "idx_slow";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_INDEX');
  });

  it('is case-insensitive for DROP INDEX', () => {
    const sql = 'drop index "idx_test";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_INDEX');
  });
});

// ============================================================================
// 12. detectDestructiveOperations — mixed / complex
// ============================================================================

describe('detectDestructiveOperations — mixed scenarios', () => {
  it('detects multiple kinds in one SQL file', () => {
    const sql = `
-- Migration: dangerous cleanup
DROP TABLE IF EXISTS "old_sessions";
ALTER TABLE "agents" DROP COLUMN "deprecated_field";
TRUNCATE TABLE "temp_data";
ALTER TABLE "agents" DROP CONSTRAINT "agents_old_fkey";
DROP INDEX "idx_old_lookup";
    `;
    const ops = detectDestructiveOperations(sql, '0010_cleanup.sql');

    expect(ops).toHaveLength(5);

    const kinds = ops.map((op) => op.kind);
    expect(kinds).toContain('DROP_TABLE');
    expect(kinds).toContain('DROP_COLUMN');
    expect(kinds).toContain('TRUNCATE');
    expect(kinds).toContain('DROP_CONSTRAINT');
    expect(kinds).toContain('DROP_INDEX');
  });

  it('returns empty array for safe migration SQL', () => {
    const sql = `
BEGIN;
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL
);
ALTER TABLE "agents" ADD COLUMN "task_count" integer DEFAULT 0;
CREATE INDEX IF NOT EXISTS "idx_tasks_title" ON "tasks" ("title");
COMMIT;
    `;
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(0);
  });

  it('returns empty array for empty SQL', () => {
    expect(detectDestructiveOperations('')).toEqual([]);
  });

  it('returns empty array for comments-only SQL', () => {
    const sql = `
-- This is a safe migration
-- DROP TABLE "users"; -- this is just a comment
-- ALTER TABLE "agents" DROP COLUMN "x";
    `;
    expect(detectDestructiveOperations(sql)).toEqual([]);
  });

  it('uses default file name when not provided', () => {
    const ops = detectDestructiveOperations('DROP TABLE "x";');

    expect(ops[0].file).toBe('<unknown>');
  });

  it('handles blank lines between destructive statements', () => {
    const sql = `
DROP TABLE "a";

DROP TABLE "b";


DROP TABLE "c";
    `;
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(3);
    expect(ops[0].line).toBe(2);
    expect(ops[1].line).toBe(4);
    expect(ops[2].line).toBe(7);
  });

  it('preserves the original statement text (trimmed)', () => {
    const sql = '   DROP TABLE IF EXISTS "users" CASCADE;  ';
    const ops = detectDestructiveOperations(sql);

    expect(ops[0].statement).toBe('DROP TABLE IF EXISTS "users" CASCADE;');
  });
});

// ============================================================================
// 13. requiresApproval
// ============================================================================

describe('requiresApproval', () => {
  it('returns true when there are destructive operations', () => {
    const ops: DestructiveOperation[] = [
      { file: 'test.sql', line: 1, statement: 'DROP TABLE "x";', kind: 'DROP_TABLE' },
    ];

    expect(requiresApproval(ops)).toBe(true);
  });

  it('returns false when there are no destructive operations', () => {
    expect(requiresApproval([])).toBe(false);
  });

  it('returns true for any kind of destructive operation', () => {
    const kinds: DestructiveOperation['kind'][] = [
      'DROP_TABLE',
      'DROP_COLUMN',
      'TRUNCATE',
      'DROP_CONSTRAINT',
      'DROP_INDEX',
    ];

    for (const kind of kinds) {
      const ops: DestructiveOperation[] = [
        { file: 'test.sql', line: 1, statement: `${kind} statement`, kind },
      ];
      expect(requiresApproval(ops)).toBe(true);
    }
  });

  it('returns true for multiple operations', () => {
    const ops: DestructiveOperation[] = [
      { file: 'a.sql', line: 1, statement: 'DROP TABLE "a";', kind: 'DROP_TABLE' },
      { file: 'b.sql', line: 5, statement: 'TRUNCATE "b";', kind: 'TRUNCATE' },
    ];

    expect(requiresApproval(ops)).toBe(true);
  });
});

// ============================================================================
// 14. scanMigrationsForDestructive
// ============================================================================

describe('scanMigrationsForDestructive', () => {
  it('scans multiple migration files for destructive operations', () => {
    const migrations = [
      {
        filename: '0000_initial.sql',
        content: 'CREATE TABLE "users" ("id" serial PRIMARY KEY);',
      },
      {
        filename: '0001_cleanup.sql',
        content: 'DROP TABLE IF EXISTS "old_users";',
      },
      {
        filename: '0002_alter.sql',
        content: 'ALTER TABLE "agents" DROP COLUMN "deprecated";',
      },
    ];

    const ops = scanMigrationsForDestructive(migrations);

    expect(ops).toHaveLength(2);
    expect(ops[0].file).toBe('0001_cleanup.sql');
    expect(ops[1].file).toBe('0002_alter.sql');
  });

  it('returns empty array when no migrations are destructive', () => {
    const migrations = [
      {
        filename: '0000_initial.sql',
        content: 'CREATE TABLE "users" ("id" serial PRIMARY KEY);',
      },
      {
        filename: '0001_add_col.sql',
        content: 'ALTER TABLE "users" ADD COLUMN "name" text;',
      },
    ];

    const ops = scanMigrationsForDestructive(migrations);

    expect(ops).toHaveLength(0);
  });

  it('returns empty array for empty migrations list', () => {
    expect(scanMigrationsForDestructive([])).toEqual([]);
  });

  it('preserves file information per operation', () => {
    const migrations = [
      {
        filename: '0005_multi.sql',
        content: `
DROP TABLE "a";
ALTER TABLE "b" DROP COLUMN "c";
        `,
      },
    ];

    const ops = scanMigrationsForDestructive(migrations);

    expect(ops).toHaveLength(2);
    expect(ops[0].file).toBe('0005_multi.sql');
    expect(ops[1].file).toBe('0005_multi.sql');
  });

  it('handles migrations with mixed safe and destructive SQL', () => {
    const migrations = [
      {
        filename: '0003_mixed.sql',
        content: `
BEGIN;
CREATE TABLE IF NOT EXISTS "new_table" ("id" serial);
DROP TABLE IF EXISTS "legacy_table";
ALTER TABLE "agents" ADD COLUMN "new_col" text;
ALTER TABLE "agents" DROP COLUMN "old_col";
COMMIT;
        `,
      },
    ];

    const ops = scanMigrationsForDestructive(migrations);

    expect(ops).toHaveLength(2);
    expect(ops[0].kind).toBe('DROP_TABLE');
    expect(ops[1].kind).toBe('DROP_COLUMN');
  });
});

// ============================================================================
// 15. Edge cases & integration-style tests
// ============================================================================

describe('edge cases', () => {
  it('detectDestructiveOperations handles Windows line endings (CRLF)', () => {
    const sql = 'CREATE TABLE "x" ("id" serial);\r\nDROP TABLE "y";\r\nSELECT 1;';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_TABLE');
    expect(ops[0].line).toBe(2);
  });

  it('detectDestructiveOperations handles tab-indented SQL', () => {
    const sql = '\tDROP TABLE "users";';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
  });

  it('parseBackupFilename handles corrupted timestamp format', () => {
    expect(parseBackupFilename('backup-db-not-a-date.sql.gz')).toBeUndefined();
  });

  it('buildBackupFilename produces parseable filenames', () => {
    const dates = [
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-06-15T12:30:45.123Z'),
      new Date('2026-12-31T23:59:59.999Z'),
    ];

    for (const date of dates) {
      const filename = buildBackupFilename('testdb', date);
      const parsed = parseBackupFilename(filename);
      expect(parsed).toBeDefined();
      expect(parsed?.database).toBe('testdb');
    }
  });

  it('enforceRetention with retentionCount of 1 keeps only the newest backup', async () => {
    vi.clearAllMocks();
    vi.mocked(readdir).mockResolvedValue([
      'backup-db-2026-01-01T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-05T00-00-00-000Z.sql.gz',
      'backup-db-2026-01-03T00-00-00-000Z.sql.gz',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    vi.mocked(unlink).mockResolvedValue(undefined);

    const manager = createBackupManager({
      database: 'db',
      retentionCount: 1,
      backupDir: '/tmp/bk',
    });

    const deleted = await manager.enforceRetention();

    expect(deleted).toHaveLength(2);
    // The newest (Jan 5) should be kept
    expect(deleted).not.toContain('backup-db-2026-01-05T00-00-00-000Z.sql.gz');
    expect(deleted).toContain('backup-db-2026-01-01T00-00-00-000Z.sql.gz');
    expect(deleted).toContain('backup-db-2026-01-03T00-00-00-000Z.sql.gz');
  });

  it('createBackupManager is callable with no arguments', () => {
    const manager = createBackupManager();

    expect(manager.createBackup).toBeTypeOf('function');
    expect(manager.enforceRetention).toBeTypeOf('function');
    expect(manager.getConfig).toBeTypeOf('function');
  });

  it('SQL with only whitespace produces no destructive operations', () => {
    expect(detectDestructiveOperations('   \n\n   \n')).toEqual([]);
  });

  it('DROP TABLE inside a string literal on a real line is still detected', () => {
    // This is a known limitation: we do line-by-line regex, not a full parser
    const sql = 'DROP TABLE "users"; -- cleanup per ticket AGENT-123';
    const ops = detectDestructiveOperations(sql);

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('DROP_TABLE');
  });
});

// ============================================================================
// 16. Real-world migration patterns from the AgentCTL project
// ============================================================================

describe('real-world migration patterns', () => {
  it('detects no destructive ops in 0000_initial_schema.sql pattern', () => {
    const sql = `
CREATE TABLE IF NOT EXISTS "machines" (
  "id" text PRIMARY KEY,
  "hostname" text NOT NULL UNIQUE,
  "status" text DEFAULT 'online',
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "machine_id" text REFERENCES "machines"("id"),
  "name" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_machines_status" ON "machines" ("status");
    `;

    const ops = detectDestructiveOperations(sql, '0000_initial_schema.sql');

    expect(ops).toHaveLength(0);
  });

  it('detects no destructive ops in ADD COLUMN migration pattern', () => {
    const sql = `
ALTER TABLE "agents" ADD COLUMN "loop_config" jsonb DEFAULT NULL;
ALTER TABLE "agent_runs" ADD COLUMN "loop_iteration" integer DEFAULT NULL;
ALTER TABLE "agent_runs" ADD COLUMN "parent_run_id" text DEFAULT NULL;
CREATE INDEX IF NOT EXISTS "idx_agent_runs_parent_run_id" ON "agent_runs" ("parent_run_id");
    `;

    const ops = detectDestructiveOperations(sql, '0002_add_loop_columns.sql');

    expect(ops).toHaveLength(0);
  });

  it('detects destructive ops in a rollback migration', () => {
    const sql = `
-- Rollback migration for 0002_add_loop_columns
ALTER TABLE "agent_runs" DROP COLUMN "parent_run_id";
ALTER TABLE "agent_runs" DROP COLUMN "loop_iteration";
ALTER TABLE "agents" DROP COLUMN "loop_config";
DROP INDEX IF EXISTS "idx_agent_runs_parent_run_id";
    `;

    const ops = detectDestructiveOperations(sql, '0002_rollback.sql');

    expect(ops).toHaveLength(4);
    expect(ops.filter((op) => op.kind === 'DROP_COLUMN')).toHaveLength(3);
    expect(ops.filter((op) => op.kind === 'DROP_INDEX')).toHaveLength(1);
  });

  it('scanMigrationsForDestructive works with real migration filenames', () => {
    const migrations = [
      {
        filename: '0000_initial_schema.sql',
        content: 'CREATE TABLE IF NOT EXISTS "machines" ("id" text PRIMARY KEY);',
      },
      {
        filename: '0001_add_schedule_config.sql',
        content: 'ALTER TABLE "agents" ADD COLUMN "schedule_config" jsonb;',
      },
      {
        filename: '0002_add_loop_columns.sql',
        content: 'ALTER TABLE "agents" ADD COLUMN "loop_config" jsonb;',
      },
      {
        filename: '0003_add_webhook_tables.sql',
        content: 'CREATE TABLE IF NOT EXISTS "webhooks" ("id" uuid PRIMARY KEY);',
      },
    ];

    const ops = scanMigrationsForDestructive(migrations);

    expect(ops).toHaveLength(0);
    expect(requiresApproval(ops)).toBe(false);
  });

  it('full workflow: scan migrations, check approval, decide', () => {
    const safeMigrations = [
      { filename: '0000.sql', content: 'CREATE TABLE "t" ("id" serial);' },
      { filename: '0001.sql', content: 'ALTER TABLE "t" ADD COLUMN "name" text;' },
    ];

    const dangerousMigrations = [
      ...safeMigrations,
      { filename: '0002.sql', content: 'DROP TABLE IF EXISTS "legacy";' },
    ];

    const safeOps = scanMigrationsForDestructive(safeMigrations);
    expect(requiresApproval(safeOps)).toBe(false);

    const dangerousOps = scanMigrationsForDestructive(dangerousMigrations);
    expect(requiresApproval(dangerousOps)).toBe(true);
    expect(dangerousOps).toHaveLength(1);
    expect(dangerousOps[0].file).toBe('0002.sql');
  });
});
