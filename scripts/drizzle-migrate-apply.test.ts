import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyPending,
  DrizzleMigrateError,
  diffPending,
  ensureTrackerTable,
  fetchAppliedHashes,
  formatSummary,
  hashMigrationContent,
  type Journal,
  type PlannedMigration,
  type PsqlRunner,
  parseCliArgs,
  parseJournal,
  planMigrations,
  runMigrateApply,
} from './drizzle-migrate-apply.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type RunnerCall =
  | { kind: 'query'; sql: string }
  | { kind: 'apply'; filePath: string }
  | { kind: 'insert'; hash: string; createdAt: number };

function makeRunner(
  initialHashes: string[] = [],
  opts: { applyThrows?: boolean; insertThrows?: boolean } = {},
): { runner: PsqlRunner; calls: RunnerCall[] } {
  const calls: RunnerCall[] = [];
  const appliedHashes = [...initialHashes];
  const runner: PsqlRunner = {
    query(sql: string): string {
      calls.push({ kind: 'query', sql });
      if (sql.includes('SELECT hash FROM')) {
        return `${appliedHashes.join('\n')}\n`;
      }
      return '';
    },
    applyFile(filePath: string): void {
      calls.push({ kind: 'apply', filePath });
      if (opts.applyThrows) {
        throw new Error('psql failed');
      }
    },
    insertTrackerRow(hash: string, createdAt: number): void {
      calls.push({ kind: 'insert', hash, createdAt });
      if (opts.insertThrows) {
        throw new Error('insert failed');
      }
      appliedHashes.push(hash);
    },
  };
  return { runner, calls };
}

function makePlanned(
  overrides: Partial<PlannedMigration> & { tag: string; content: string },
): PlannedMigration {
  const tag = overrides.tag;
  return {
    tag,
    filename: `${tag}.sql`,
    filePath: `/tmp/${tag}.sql`,
    content: overrides.content,
    hash: hashMigrationContent(overrides.content),
    when: overrides.when ?? 1_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// hashMigrationContent
// ---------------------------------------------------------------------------

describe('hashMigrationContent', () => {
  it('produces 64-char hex sha256 hashes', () => {
    const h = hashMigrationContent('SELECT 1;');

    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the exact sha256 digest drizzle-orm v0.45 computes (vector check)', () => {
    // crypto.createHash('sha256').update('hello').digest('hex')
    // Verified: the drizzle-orm migrator.js line 23 formula produces this value.
    expect(hashMigrationContent('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('is deterministic: same input produces same hash', () => {
    const a = hashMigrationContent('CREATE TABLE t (id int);');
    const b = hashMigrationContent('CREATE TABLE t (id int);');

    expect(a).toBe(b);
  });

  it('changes when whitespace changes', () => {
    const a = hashMigrationContent('SELECT 1;');
    const b = hashMigrationContent('SELECT 1; ');

    expect(a).not.toBe(b);
  });

  it('differs from an MD5 digest of the same input (length check)', () => {
    // Legacy pre-drizzle-orm 0.45 hashes were MD5 (32 hex chars).
    // Our implementation must never emit those.
    const h = hashMigrationContent('some migration');

    expect(h.length).toBe(64);
    expect(h.length).not.toBe(32);
  });
});

// ---------------------------------------------------------------------------
// parseJournal + planMigrations
// ---------------------------------------------------------------------------

describe('parseJournal', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'drizzle-journal-'));
    mkdirSync(path.join(tmpDir, 'meta'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses a valid journal and returns entries sorted by idx', () => {
    const journal: Journal = {
      version: '7',
      dialect: 'postgresql',
      entries: [
        { idx: 1, tag: '0001_foo', when: 2_000_000 },
        { idx: 0, tag: '0000_init', when: 1_000_000 },
        { idx: 2, tag: '0002_bar', when: 3_000_000 },
      ],
    };
    const journalPath = path.join(tmpDir, 'meta', '_journal.json');
    writeFileSync(journalPath, JSON.stringify(journal));

    const parsed = parseJournal(journalPath);

    expect(parsed.entries.map((e) => e.tag)).toEqual(['0000_init', '0001_foo', '0002_bar']);
  });

  it('throws JOURNAL_READ_FAILED on missing file', () => {
    const missingPath = path.join(tmpDir, 'nope.json');
    expect(() => parseJournal(missingPath)).toThrow(DrizzleMigrateError);
    try {
      parseJournal(missingPath);
    } catch (error) {
      expect((error as DrizzleMigrateError).code).toBe('JOURNAL_READ_FAILED');
    }
  });

  it('throws JOURNAL_PARSE_FAILED on invalid JSON', () => {
    const p = path.join(tmpDir, 'meta', '_journal.json');
    writeFileSync(p, '{ not valid json');

    expect(() => parseJournal(p)).toThrow(DrizzleMigrateError);
    try {
      parseJournal(p);
    } catch (error) {
      expect((error as DrizzleMigrateError).code).toBe('JOURNAL_PARSE_FAILED');
    }
  });

  it('throws JOURNAL_SHAPE_INVALID when entries is missing', () => {
    const p = path.join(tmpDir, 'meta', '_journal.json');
    writeFileSync(p, JSON.stringify({ version: '7', dialect: 'postgresql' }));

    try {
      parseJournal(p);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DrizzleMigrateError).code).toBe('JOURNAL_SHAPE_INVALID');
    }
  });

  it('throws JOURNAL_ENTRY_INVALID when an entry lacks a tag', () => {
    const p = path.join(tmpDir, 'meta', '_journal.json');
    writeFileSync(
      p,
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: [{ idx: 0, when: 1, tag: '' }],
      }),
    );

    try {
      parseJournal(p);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DrizzleMigrateError).code).toBe('JOURNAL_ENTRY_INVALID');
    }
  });

  it('throws JOURNAL_ENTRY_INVALID when when is not numeric', () => {
    const p = path.join(tmpDir, 'meta', '_journal.json');
    writeFileSync(
      p,
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: [{ idx: 0, when: 'not-a-number', tag: '0000_init' }],
      }),
    );

    try {
      parseJournal(p);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DrizzleMigrateError).code).toBe('JOURNAL_ENTRY_INVALID');
    }
  });
});

describe('planMigrations', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'drizzle-plan-'));
    mkdirSync(path.join(tmpDir, 'meta'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads each migration file and computes its hash', () => {
    writeFileSync(path.join(tmpDir, '0000_init.sql'), 'CREATE TABLE a();');
    writeFileSync(path.join(tmpDir, '0001_foo.sql'), 'ALTER TABLE a ADD x int;');

    const journal: Journal = {
      version: '7',
      dialect: 'postgresql',
      entries: [
        { idx: 0, tag: '0000_init', when: 1 },
        { idx: 1, tag: '0001_foo', when: 2 },
      ],
    };
    const planned = planMigrations(tmpDir, journal);

    expect(planned).toHaveLength(2);
    expect(planned[0].tag).toBe('0000_init');
    expect(planned[0].hash).toBe(hashMigrationContent('CREATE TABLE a();'));
    expect(planned[1].hash).toBe(hashMigrationContent('ALTER TABLE a ADD x int;'));
  });

  it('throws MIGRATION_FILE_MISSING when a SQL file is absent', () => {
    const journal: Journal = {
      version: '7',
      dialect: 'postgresql',
      entries: [{ idx: 0, tag: '0000_missing', when: 1 }],
    };

    try {
      planMigrations(tmpDir, journal);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DrizzleMigrateError).code).toBe('MIGRATION_FILE_MISSING');
    }
  });

  it('preserves the when timestamp from the journal (used as created_at)', () => {
    writeFileSync(path.join(tmpDir, '0000_init.sql'), '-- noop');
    const journal: Journal = {
      version: '7',
      dialect: 'postgresql',
      entries: [{ idx: 0, tag: '0000_init', when: 1_709_337_600_000 }],
    };

    const planned = planMigrations(tmpDir, journal);

    expect(planned[0].when).toBe(1_709_337_600_000);
  });
});

// ---------------------------------------------------------------------------
// diffPending
// ---------------------------------------------------------------------------

describe('diffPending', () => {
  it('returns everything as pending when tracker is empty', () => {
    const planned = [
      makePlanned({ tag: '0000', content: 'a' }),
      makePlanned({ tag: '0001', content: 'b' }),
    ];

    const { pending, alreadyPresent } = diffPending(planned, []);

    expect(pending.map((p) => p.tag)).toEqual(['0000', '0001']);
    expect(alreadyPresent).toEqual([]);
  });

  it('returns nothing pending when all hashes are already in tracker', () => {
    const planned = [
      makePlanned({ tag: '0000', content: 'a' }),
      makePlanned({ tag: '0001', content: 'b' }),
    ];
    const appliedHashes = planned.map((p) => p.hash);

    const { pending, alreadyPresent } = diffPending(planned, appliedHashes);

    expect(pending).toEqual([]);
    expect(alreadyPresent.map((p) => p.tag)).toEqual(['0000', '0001']);
  });

  it('splits correctly when some migrations are applied', () => {
    const planned = [
      makePlanned({ tag: '0000', content: 'a' }),
      makePlanned({ tag: '0001', content: 'b' }),
      makePlanned({ tag: '0002', content: 'c' }),
    ];
    const applied = [planned[0].hash];

    const { pending, alreadyPresent } = diffPending(planned, applied);

    expect(alreadyPresent.map((p) => p.tag)).toEqual(['0000']);
    expect(pending.map((p) => p.tag)).toEqual(['0001', '0002']);
  });

  it('matches by hash, not by order', () => {
    // If a tracker row's hash does not correspond to any planned migration, we
    // still treat the planned migrations as pending (no false skip).
    const planned = [
      makePlanned({ tag: '0000', content: 'a' }),
      makePlanned({ tag: '0001', content: 'b' }),
    ];
    const applied = ['deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'];

    const { pending } = diffPending(planned, applied);

    expect(pending.map((p) => p.tag)).toEqual(['0000', '0001']);
  });

  it('legacy-by-position treats the first N entries as applied regardless of hash', () => {
    const planned = [
      makePlanned({ tag: '0000', content: 'a' }),
      makePlanned({ tag: '0001', content: 'b' }),
      makePlanned({ tag: '0002', content: 'c' }),
    ];
    // Pretend pre-upgrade MD5 hashes are recorded (length 32)
    const md5s = ['11111111111111111111111111111111', '22222222222222222222222222222222'];

    const { pending, alreadyPresent } = diffPending(planned, md5s, true);

    expect(alreadyPresent.map((p) => p.tag)).toEqual(['0000', '0001']);
    expect(pending.map((p) => p.tag)).toEqual(['0002']);
  });
});

// ---------------------------------------------------------------------------
// ensureTrackerTable + fetchAppliedHashes
// ---------------------------------------------------------------------------

describe('ensureTrackerTable', () => {
  it('creates schema and tracker table via psql', () => {
    const { runner, calls } = makeRunner();

    ensureTrackerTable(runner);

    const sqls = calls.filter((c) => c.kind === 'query').map((c) => (c as { sql: string }).sql);
    expect(sqls.some((s) => s.includes('CREATE SCHEMA IF NOT EXISTS "drizzle"'))).toBe(true);
    expect(
      sqls.some((s) => s.includes('CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations"')),
    ).toBe(true);
    expect(sqls.some((s) => s.includes('"hash" text NOT NULL'))).toBe(true);
    expect(sqls.some((s) => s.includes('"created_at" bigint'))).toBe(true);
  });
});

describe('fetchAppliedHashes', () => {
  it('returns hashes from psql output split by newline', () => {
    const { runner } = makeRunner([
      '1111111111111111111111111111111111111111111111111111111111111111',
      '2222222222222222222222222222222222222222222222222222222222222222',
    ]);

    const hashes = fetchAppliedHashes(runner);

    expect(hashes).toEqual([
      '1111111111111111111111111111111111111111111111111111111111111111',
      '2222222222222222222222222222222222222222222222222222222222222222',
    ]);
  });

  it('returns an empty array when the tracker is empty', () => {
    const { runner } = makeRunner([]);

    expect(fetchAppliedHashes(runner)).toEqual([]);
  });

  it('strips blank lines and whitespace', () => {
    const runner: PsqlRunner = {
      query: () => '\n  aaaa  \n\nbbbb\n',
      applyFile: () => {},
      insertTrackerRow: () => {},
    };

    expect(fetchAppliedHashes(runner)).toEqual(['aaaa', 'bbbb']);
  });
});

// ---------------------------------------------------------------------------
// applyPending
// ---------------------------------------------------------------------------

describe('applyPending', () => {
  it('applies each migration file and inserts a tracker row', () => {
    const { runner, calls } = makeRunner();
    const planned = [
      makePlanned({ tag: '0000', content: 'a', when: 100 }),
      makePlanned({ tag: '0001', content: 'b', when: 200 }),
    ];

    const { applied } = applyPending(runner, planned, { dryRun: false });

    expect(applied).toEqual(['0000', '0001']);
    const applyCalls = calls.filter((c) => c.kind === 'apply');
    const insertCalls = calls.filter((c) => c.kind === 'insert') as Array<
      Extract<RunnerCall, { kind: 'insert' }>
    >;
    expect(applyCalls).toHaveLength(2);
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0].createdAt).toBe(100);
    expect(insertCalls[1].createdAt).toBe(200);
    expect(insertCalls[0].hash).toBe(planned[0].hash);
    expect(insertCalls[1].hash).toBe(planned[1].hash);
  });

  it('dry-run does not invoke applyFile or insertTrackerRow but still reports applied list', () => {
    const { runner, calls } = makeRunner();
    const planned = [makePlanned({ tag: '0000', content: 'a' })];

    const { applied } = applyPending(runner, planned, { dryRun: true });

    expect(applied).toEqual(['0000']);
    expect(calls.filter((c) => c.kind === 'apply')).toEqual([]);
    expect(calls.filter((c) => c.kind === 'insert')).toEqual([]);
  });

  it('throws MIGRATION_APPLY_FAILED when applyFile throws', () => {
    const { runner } = makeRunner([], { applyThrows: true });
    const planned = [makePlanned({ tag: '0000', content: 'bad' })];

    try {
      applyPending(runner, planned, { dryRun: false });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DrizzleMigrateError);
      expect((error as DrizzleMigrateError).code).toBe('MIGRATION_APPLY_FAILED');
    }
  });

  it('throws TRACKER_INSERT_FAILED when insertTrackerRow throws', () => {
    const { runner } = makeRunner([], { insertThrows: true });
    const planned = [makePlanned({ tag: '0000', content: 'a' })];

    try {
      applyPending(runner, planned, { dryRun: false });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DrizzleMigrateError).code).toBe('TRACKER_INSERT_FAILED');
    }
  });

  it('stops at the first failure and does not apply subsequent migrations', () => {
    let applyCount = 0;
    const runner: PsqlRunner = {
      query: () => '',
      applyFile: () => {
        applyCount++;
        if (applyCount === 2) {
          throw new Error('boom');
        }
      },
      insertTrackerRow: () => {},
    };
    const planned = [
      makePlanned({ tag: '0000', content: 'a' }),
      makePlanned({ tag: '0001', content: 'b' }),
      makePlanned({ tag: '0002', content: 'c' }),
    ];

    try {
      applyPending(runner, planned, { dryRun: false });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DrizzleMigrateError).context?.tag).toBe('0001');
    }
    expect(applyCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// runMigrateApply
// ---------------------------------------------------------------------------

describe('runMigrateApply', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'drizzle-run-'));
    mkdirSync(path.join(tmpDir, 'meta'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('end-to-end: empty DB + two migrations → both applied, tracker rows inserted', () => {
    writeFileSync(path.join(tmpDir, '0000_init.sql'), 'CREATE TABLE a();');
    writeFileSync(path.join(tmpDir, '0001_foo.sql'), 'ALTER TABLE a ADD x int;');
    writeFileSync(
      path.join(tmpDir, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: [
          { idx: 0, tag: '0000_init', when: 100 },
          { idx: 1, tag: '0001_foo', when: 200 },
        ],
      }),
    );

    const { runner, calls } = makeRunner([]);
    const summary = runMigrateApply(runner, {
      migrationsDir: tmpDir,
      databaseUrl: 'postgres://fake',
      psqlPath: 'psql',
      dryRun: false,
      legacyByPosition: false,
    });

    expect(summary.applied).toEqual(['0000_init', '0001_foo']);
    expect(summary.alreadyPresent).toEqual([]);
    const inserts = calls.filter((c) => c.kind === 'insert');
    expect(inserts).toHaveLength(2);
  });

  it('idempotency: running against DB with all hashes already present applies nothing', () => {
    writeFileSync(path.join(tmpDir, '0000_init.sql'), 'CREATE TABLE a();');
    writeFileSync(
      path.join(tmpDir, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: [{ idx: 0, tag: '0000_init', when: 100 }],
      }),
    );

    const preApplied = hashMigrationContent('CREATE TABLE a();');
    const { runner, calls } = makeRunner([preApplied]);

    const summary = runMigrateApply(runner, {
      migrationsDir: tmpDir,
      databaseUrl: 'postgres://fake',
      psqlPath: 'psql',
      dryRun: false,
      legacyByPosition: false,
    });

    expect(summary.applied).toEqual([]);
    expect(summary.alreadyPresent).toEqual(['0000_init']);
    expect(calls.filter((c) => c.kind === 'apply')).toEqual([]);
    expect(calls.filter((c) => c.kind === 'insert')).toEqual([]);
  });

  it('partial state: applies only the missing migration', () => {
    writeFileSync(path.join(tmpDir, '0000_init.sql'), 'CREATE TABLE a();');
    writeFileSync(path.join(tmpDir, '0001_foo.sql'), 'ALTER TABLE a ADD x int;');
    writeFileSync(
      path.join(tmpDir, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: [
          { idx: 0, tag: '0000_init', when: 100 },
          { idx: 1, tag: '0001_foo', when: 200 },
        ],
      }),
    );

    const { runner, calls } = makeRunner([hashMigrationContent('CREATE TABLE a();')]);

    const summary = runMigrateApply(runner, {
      migrationsDir: tmpDir,
      databaseUrl: 'postgres://fake',
      psqlPath: 'psql',
      dryRun: false,
      legacyByPosition: false,
    });

    expect(summary.applied).toEqual(['0001_foo']);
    expect(summary.alreadyPresent).toEqual(['0000_init']);
    const applyCalls = calls.filter((c) => c.kind === 'apply');
    expect(applyCalls).toHaveLength(1);
    expect((applyCalls[0] as Extract<RunnerCall, { kind: 'apply' }>).filePath).toBe(
      path.join(tmpDir, '0001_foo.sql'),
    );
  });
});

// ---------------------------------------------------------------------------
// parseCliArgs
// ---------------------------------------------------------------------------

describe('parseCliArgs', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('requires --migrations-dir', () => {
    process.env.DATABASE_URL = 'postgres://x';

    expect(() => parseCliArgs(['node', 'script.ts'])).toThrow(DrizzleMigrateError);
  });

  it('requires DATABASE_URL env var', () => {
    expect(() => parseCliArgs(['node', 'script.ts', '--migrations-dir', '/tmp/m'])).toThrow(
      DrizzleMigrateError,
    );
  });

  it('parses all flags', () => {
    process.env.DATABASE_URL = 'postgres://u:p@h/db';

    const opts = parseCliArgs([
      'node',
      'script.ts',
      '--migrations-dir',
      '/a/b',
      '--dry-run',
      '--legacy-by-position',
      '--psql',
      '/usr/local/bin/psql',
    ]);

    expect(opts.dryRun).toBe(true);
    expect(opts.legacyByPosition).toBe(true);
    expect(opts.psqlPath).toBe('/usr/local/bin/psql');
    expect(opts.databaseUrl).toBe('postgres://u:p@h/db');
    expect(path.isAbsolute(opts.migrationsDir)).toBe(true);
  });

  it('rejects unknown flags', () => {
    process.env.DATABASE_URL = 'x';
    expect(() => parseCliArgs(['node', 'script.ts', '--migrations-dir', '/x', '--nope'])).toThrow(
      DrizzleMigrateError,
    );
  });

  it('throws HELP_REQUESTED for --help', () => {
    process.env.DATABASE_URL = 'x';
    try {
      parseCliArgs(['node', 'script.ts', '--help']);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DrizzleMigrateError).code).toBe('HELP_REQUESTED');
    }
  });
});

// ---------------------------------------------------------------------------
// formatSummary
// ---------------------------------------------------------------------------

describe('formatSummary', () => {
  it('reports counts for an applied run', () => {
    const out = formatSummary(
      { applied: ['0000', '0001'], alreadyPresent: ['0002'], pending: ['0000', '0001'] },
      false,
    );

    expect(out).toContain('applied 2');
    expect(out).toContain('already-present 1');
  });

  it('uses "would apply" for dry-run', () => {
    const out = formatSummary({ applied: ['0000'], alreadyPresent: [], pending: ['0000'] }, true);

    expect(out).toContain('would apply 1');
  });
});
