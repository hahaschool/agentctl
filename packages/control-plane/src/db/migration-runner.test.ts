import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock node:fs/promises before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import { readdir, readFile } from 'node:fs/promises';

import type { MigrationFile } from './migration-runner.js';
import { discoverMigrations, getPendingMigrations, sortMigrations } from './migration-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMigration(version: string, filename: string, content = '-- migration'): MigrationFile {
  return { filename, version, content };
}

// ============================================================================
// 1. discoverMigrations
// ============================================================================

describe('discoverMigrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discovers and sorts migration files from a directory', async () => {
    vi.mocked(readdir).mockResolvedValue([
      '0001_add_schedule_config.sql',
      '0000_initial_schema.sql',
      '0002_add_loop_columns.sql',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    vi.mocked(readFile).mockImplementation(async (path) => {
      const p = String(path);
      if (p.includes('0000')) return '-- initial schema';
      if (p.includes('0001')) return '-- schedule config';
      if (p.includes('0002')) return '-- loop columns';
      return '';
    });

    const migrations = await discoverMigrations('/fake/drizzle');

    expect(migrations).toHaveLength(3);
    // Sorted by version
    expect(migrations[0].version).toBe('0000');
    expect(migrations[1].version).toBe('0001');
    expect(migrations[2].version).toBe('0002');
    expect(migrations[0].filename).toBe('0000_initial_schema.sql');
    expect(migrations[0].content).toBe('-- initial schema');
  });

  it('returns empty array for empty directory', async () => {
    vi.mocked(readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);

    const migrations = await discoverMigrations('/fake/empty');

    expect(migrations).toHaveLength(0);
  });

  it('returns empty array when directory does not exist', async () => {
    vi.mocked(readdir).mockRejectedValue(new Error('ENOENT'));

    const migrations = await discoverMigrations('/fake/nonexistent');

    expect(migrations).toHaveLength(0);
  });

  it('skips files that do not match the naming convention', async () => {
    vi.mocked(readdir).mockResolvedValue([
      '0000_initial.sql',
      'README.md',
      'meta',
      '.DS_Store',
      'random.sql',
      '0001_second.sql',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    vi.mocked(readFile).mockResolvedValue('-- sql content');

    const migrations = await discoverMigrations('/fake/drizzle');

    expect(migrations).toHaveLength(2);
    expect(migrations[0].filename).toBe('0000_initial.sql');
    expect(migrations[1].filename).toBe('0001_second.sql');
  });

  it('skips unreadable files gracefully', async () => {
    vi.mocked(readdir).mockResolvedValue([
      '0000_first.sql',
      '0001_broken.sql',
      '0002_third.sql',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    vi.mocked(readFile).mockImplementation(async (path) => {
      const p = String(path);
      if (p.includes('0001')) throw new Error('Permission denied');
      return '-- ok';
    });

    const migrations = await discoverMigrations('/fake/drizzle');

    expect(migrations).toHaveLength(2);
    expect(migrations[0].version).toBe('0000');
    expect(migrations[1].version).toBe('0002');
  });

  it('handles filenames with longer version prefixes', async () => {
    vi.mocked(readdir).mockResolvedValue([
      '00001_extended_version.sql',
      '00000_initial.sql',
    ] as unknown as Awaited<ReturnType<typeof readdir>>);

    vi.mocked(readFile).mockResolvedValue('-- sql');

    const migrations = await discoverMigrations('/fake/drizzle');

    expect(migrations).toHaveLength(2);
    expect(migrations[0].version).toBe('00000');
    expect(migrations[1].version).toBe('00001');
  });

  it('constructs correct file paths using join', async () => {
    vi.mocked(readdir).mockResolvedValue(['0000_test.sql'] as unknown as Awaited<
      ReturnType<typeof readdir>
    >);
    vi.mocked(readFile).mockResolvedValue('-- content');

    await discoverMigrations('/my/dir');

    expect(readFile).toHaveBeenCalledWith('/my/dir/0000_test.sql', 'utf-8');
  });
});

// ============================================================================
// 2. sortMigrations
// ============================================================================

describe('sortMigrations', () => {
  it('sorts migrations by version in ascending order', () => {
    const migrations = [
      makeMigration('0002', '0002_c.sql'),
      makeMigration('0000', '0000_a.sql'),
      makeMigration('0001', '0001_b.sql'),
    ];

    const sorted = sortMigrations(migrations);

    expect(sorted.map((m) => m.version)).toEqual(['0000', '0001', '0002']);
  });

  it('returns a new array (does not mutate input)', () => {
    const migrations = [makeMigration('0001', '0001_b.sql'), makeMigration('0000', '0000_a.sql')];

    const sorted = sortMigrations(migrations);

    expect(sorted).not.toBe(migrations);
    // Original unchanged
    expect(migrations[0].version).toBe('0001');
  });

  it('handles empty array', () => {
    expect(sortMigrations([])).toEqual([]);
  });

  it('handles single migration', () => {
    const migrations = [makeMigration('0000', '0000_only.sql')];
    const sorted = sortMigrations(migrations);

    expect(sorted).toHaveLength(1);
    expect(sorted[0].version).toBe('0000');
  });

  it('sorts lexicographically so 0009 comes before 0010', () => {
    const migrations = [
      makeMigration('0010', '0010_ten.sql'),
      makeMigration('0009', '0009_nine.sql'),
    ];

    const sorted = sortMigrations(migrations);

    expect(sorted[0].version).toBe('0009');
    expect(sorted[1].version).toBe('0010');
  });
});

// ============================================================================
// 3. getPendingMigrations
// ============================================================================

describe('getPendingMigrations', () => {
  const allMigrations = [
    makeMigration('0000', '0000_initial.sql', '-- initial'),
    makeMigration('0001', '0001_second.sql', '-- second'),
    makeMigration('0002', '0002_third.sql', '-- third'),
    makeMigration('0003', '0003_fourth.sql', '-- fourth'),
  ];

  it('returns all migrations when none have been applied', () => {
    const pending = getPendingMigrations(allMigrations, []);

    expect(pending).toHaveLength(4);
    expect(pending.map((m) => m.version)).toEqual(['0000', '0001', '0002', '0003']);
  });

  it('returns only pending migrations when some have been applied', () => {
    const pending = getPendingMigrations(allMigrations, ['0000', '0001']);

    expect(pending).toHaveLength(2);
    expect(pending.map((m) => m.version)).toEqual(['0002', '0003']);
  });

  it('returns empty array when all migrations have been applied', () => {
    const pending = getPendingMigrations(allMigrations, ['0000', '0001', '0002', '0003']);

    expect(pending).toHaveLength(0);
  });

  it('handles empty migration list', () => {
    const pending = getPendingMigrations([], ['0000', '0001']);

    expect(pending).toHaveLength(0);
  });

  it('ignores applied versions that do not match any migration', () => {
    const pending = getPendingMigrations(allMigrations, ['0000', '9999']);

    expect(pending).toHaveLength(3);
    expect(pending.map((m) => m.version)).toEqual(['0001', '0002', '0003']);
  });

  it('preserves migration content in pending results', () => {
    const pending = getPendingMigrations(allMigrations, ['0000']);

    expect(pending[0].content).toBe('-- second');
    expect(pending[0].filename).toBe('0001_second.sql');
  });
});
