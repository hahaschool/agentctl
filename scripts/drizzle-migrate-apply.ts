#!/usr/bin/env npx tsx

/**
 * drizzle-migrate-apply.ts — Apply pending Drizzle migrations via psql with
 * SHA-256 tracking that matches drizzle-orm v0.45 on-disk format.
 *
 * Why this exists:
 *   - `pnpm drizzle-kit migrate` (v0.31.9) silently no-ops on pending SQL. It
 *     claims success but does not apply migrations. Confirmed on v0.31.9 by
 *     running against a fresh DB — no rows inserted into __drizzle_migrations,
 *     no schema created.
 *   - `drizzle-orm`'s own migrator (readMigrationFiles + db.dialect.migrate)
 *     works, but it is a TS runtime dependency that requires bootstrapping
 *     a full pg connection; env-migrate/env-up want a lightweight shell-driven
 *     flow.
 *
 * How this stays compatible with drizzle-orm's migrator:
 *   - Tracker table is the SAME: drizzle.__drizzle_migrations (id, hash, created_at)
 *   - Hash is SHA-256 of full file contents, hex-encoded — exactly what
 *     drizzle-orm computes in node_modules/drizzle-orm/migrator.js line 23:
 *       crypto.createHash("sha256").update(query).digest("hex")
 *   - created_at is set to the journal entry's `when` (folderMillis), matching
 *     drizzle-orm's dialect.migrate() which uses migration.folderMillis rather
 *     than Date.now(). This is critical because drizzle-orm decides what's
 *     pending by `Number(lastDbMigration.created_at) < migration.folderMillis`.
 *
 * Idempotency:
 *   - Hash membership check before apply — running twice applies nothing on
 *     the second run.
 *
 * Legacy MD5 tracker rows (pre-drizzle-orm 0.45):
 *   - If a row exists with an MD5 hash (32 hex chars instead of 64), it is
 *     skipped by hash membership check, so the migration would re-run. To
 *     handle that gracefully, callers can pass --legacy-by-position which
 *     treats the first N tracker rows (by created_at asc) as matching the
 *     first N journal entries regardless of hash. We do not apply this by
 *     default; a human must opt in.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm tsx scripts/drizzle-migrate-apply.ts \
 *     --migrations-dir packages/control-plane/drizzle
 *
 *   Flags:
 *     --migrations-dir <path>   Dir containing meta/_journal.json + *.sql
 *     --dry-run                 Print plan, do not mutate
 *     --legacy-by-position      Treat existing tracker rows positionally
 *     --psql <path>             Path to psql (default: "psql")
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class DrizzleMigrateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DrizzleMigrateError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JournalEntry = {
  idx: number;
  tag: string;
  when: number;
  breakpoints?: boolean;
  version?: string;
};

export type Journal = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

export type PlannedMigration = {
  tag: string;
  filename: string;
  filePath: string;
  content: string;
  hash: string;
  when: number;
};

export type ApplyOptions = {
  migrationsDir: string;
  databaseUrl: string;
  psqlPath: string;
  dryRun: boolean;
  legacyByPosition: boolean;
};

export type ApplySummary = {
  applied: string[];
  alreadyPresent: string[];
  pending: string[];
};

// ---------------------------------------------------------------------------
// Journal + hashing
// ---------------------------------------------------------------------------

/**
 * Parse meta/_journal.json into ordered JournalEntry[]. Entries are sorted by
 * idx ascending so the caller can trust iteration order.
 */
export function parseJournal(journalPath: string): Journal {
  let raw: string;
  try {
    raw = readFileSync(journalPath, 'utf8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DrizzleMigrateError(
      'JOURNAL_READ_FAILED',
      `Could not read journal at ${journalPath}: ${message}`,
      { journalPath },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DrizzleMigrateError(
      'JOURNAL_PARSE_FAILED',
      `Invalid JSON in ${journalPath}: ${message}`,
      {
        journalPath,
      },
    );
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { entries?: unknown }).entries)
  ) {
    throw new DrizzleMigrateError(
      'JOURNAL_SHAPE_INVALID',
      `Journal at ${journalPath} is missing an "entries" array`,
      { journalPath },
    );
  }

  const journal = parsed as Journal;
  const sortedEntries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  for (const entry of sortedEntries) {
    if (typeof entry.tag !== 'string' || entry.tag.length === 0) {
      throw new DrizzleMigrateError(
        'JOURNAL_ENTRY_INVALID',
        `Journal entry at idx=${entry.idx} is missing "tag"`,
        { entry },
      );
    }
    if (typeof entry.when !== 'number' || !Number.isFinite(entry.when)) {
      throw new DrizzleMigrateError(
        'JOURNAL_ENTRY_INVALID',
        `Journal entry "${entry.tag}" has invalid "when" timestamp`,
        { entry },
      );
    }
  }

  return { ...journal, entries: sortedEntries };
}

/**
 * Compute sha256 hex digest of the full migration file content.
 * Matches drizzle-orm v0.45 (node_modules/drizzle-orm/migrator.js line 23).
 */
export function hashMigrationContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Turn a journal into a list of planned migrations, loading each SQL file and
 * computing its hash. Throws if a file is missing.
 */
export function planMigrations(migrationsDir: string, journal: Journal): PlannedMigration[] {
  const planned: PlannedMigration[] = [];
  for (const entry of journal.entries) {
    const filename = `${entry.tag}.sql`;
    const filePath = path.join(migrationsDir, filename);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DrizzleMigrateError(
        'MIGRATION_FILE_MISSING',
        `Missing migration file ${filePath}: ${message}`,
        { filename, filePath, tag: entry.tag },
      );
    }
    planned.push({
      tag: entry.tag,
      filename,
      filePath,
      content,
      hash: hashMigrationContent(content),
      when: entry.when,
    });
  }
  return planned;
}

// ---------------------------------------------------------------------------
// psql helpers
// ---------------------------------------------------------------------------

/**
 * Runner abstraction so tests can stub psql invocations without touching a DB.
 */
export type PsqlRunner = {
  query: (sql: string) => string;
  applyFile: (filePath: string) => void;
  insertTrackerRow: (hash: string, createdAt: number) => void;
};

export type PsqlRunnerOptions = {
  databaseUrl: string;
  psqlPath: string;
};

/**
 * Default psql runner. Uses execFileSync — stdout is captured, stderr is
 * inherited, ON_ERROR_STOP=1 guarantees psql exits non-zero on SQL failure so
 * execFileSync throws.
 */
export function createPsqlRunner(options: PsqlRunnerOptions): PsqlRunner {
  const base = [options.databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-A', '-t'];

  return {
    query(sql: string): string {
      const out = execFileSync(options.psqlPath, [...base, '-c', sql], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      return out.toString();
    },
    applyFile(filePath: string): void {
      execFileSync(
        options.psqlPath,
        [options.databaseUrl, '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', filePath],
        { stdio: ['ignore', 'inherit', 'inherit'] },
      );
    },
    insertTrackerRow(hash: string, createdAt: number): void {
      // created_at is bigint — cast with ::bigint to be explicit.
      const sql = `INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES ('${hash}', ${createdAt}::bigint);`;
      execFileSync(options.psqlPath, [...base, '-c', sql], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
    },
  };
}

/**
 * Ensure drizzle schema + tracker table exist. Matches the DDL emitted by
 * drizzle-orm/pg-core/dialect.js migrate().
 */
export function ensureTrackerTable(runner: PsqlRunner): void {
  runner.query('CREATE SCHEMA IF NOT EXISTS "drizzle";');
  runner.query(
    'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" ("id" SERIAL PRIMARY KEY, "hash" text NOT NULL, "created_at" bigint);',
  );
}

/**
 * Fetch all applied hashes from the tracker, ordered by created_at ascending.
 */
export function fetchAppliedHashes(runner: PsqlRunner): string[] {
  const raw = runner.query(
    'SELECT hash FROM "drizzle"."__drizzle_migrations" ORDER BY created_at ASC, id ASC;',
  );
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// Core diff
// ---------------------------------------------------------------------------

/**
 * Return planned migrations whose hash is NOT already present in applied.
 * If legacyByPosition is true, the first appliedHashes.length entries of the
 * journal are assumed to correspond to the existing tracker rows, regardless
 * of hash.
 */
export function diffPending(
  planned: PlannedMigration[],
  appliedHashes: string[],
  legacyByPosition = false,
): { pending: PlannedMigration[]; alreadyPresent: PlannedMigration[] } {
  if (legacyByPosition) {
    const alreadyPresent = planned.slice(0, appliedHashes.length);
    const pending = planned.slice(appliedHashes.length);
    return { pending, alreadyPresent };
  }

  const appliedSet = new Set(appliedHashes);
  const pending: PlannedMigration[] = [];
  const alreadyPresent: PlannedMigration[] = [];
  for (const p of planned) {
    if (appliedSet.has(p.hash)) {
      alreadyPresent.push(p);
    } else {
      pending.push(p);
    }
  }
  return { pending, alreadyPresent };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Apply pending migrations in order. Each migration runs inside a single psql
 * invocation with --single-transaction so partial application on SQL failure
 * is impossible. Tracker row inserted on success.
 *
 * Note: tracker insert is a separate statement so if it fails the migration's
 * schema change is already committed. That's the same failure mode as
 * drizzle-orm's own migrator — do not wrap them in a shared transaction
 * because we want the `--single-transaction -f` guarantee for the DDL.
 */
export function applyPending(
  runner: PsqlRunner,
  pending: PlannedMigration[],
  options: { dryRun: boolean },
): { applied: string[] } {
  const applied: string[] = [];
  for (const migration of pending) {
    if (options.dryRun) {
      applied.push(migration.tag);
      continue;
    }
    try {
      runner.applyFile(migration.filePath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DrizzleMigrateError(
        'MIGRATION_APPLY_FAILED',
        `Failed to apply ${migration.filename}: ${message}`,
        { tag: migration.tag, filename: migration.filename },
      );
    }
    try {
      runner.insertTrackerRow(migration.hash, migration.when);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DrizzleMigrateError(
        'TRACKER_INSERT_FAILED',
        `Applied ${migration.filename} but could not record it in drizzle.__drizzle_migrations: ${message}`,
        { tag: migration.tag, filename: migration.filename, hash: migration.hash },
      );
    }
    applied.push(migration.tag);
  }
  return { applied };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function runMigrateApply(runner: PsqlRunner, options: ApplyOptions): ApplySummary {
  const journalPath = path.join(options.migrationsDir, 'meta', '_journal.json');
  const journal = parseJournal(journalPath);
  const planned = planMigrations(options.migrationsDir, journal);

  ensureTrackerTable(runner);
  const appliedHashes = fetchAppliedHashes(runner);
  const { pending, alreadyPresent } = diffPending(planned, appliedHashes, options.legacyByPosition);

  const { applied } = applyPending(runner, pending, { dryRun: options.dryRun });

  return {
    applied,
    alreadyPresent: alreadyPresent.map((p) => p.tag),
    pending: pending.map((p) => p.tag),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseCliArgs(argv: string[]): ApplyOptions {
  const args = argv.slice(2);
  let migrationsDir = '';
  let dryRun = false;
  let legacyByPosition = false;
  let psqlPath = 'psql';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--migrations-dir') {
      const next = args[i + 1];
      if (!next) {
        throw new DrizzleMigrateError('INVALID_ARGS', '--migrations-dir requires a value');
      }
      migrationsDir = path.resolve(next);
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--legacy-by-position') {
      legacyByPosition = true;
    } else if (arg === '--psql') {
      const next = args[i + 1];
      if (!next) {
        throw new DrizzleMigrateError('INVALID_ARGS', '--psql requires a value');
      }
      psqlPath = next;
      i++;
    } else if (arg === '-h' || arg === '--help') {
      // Signal help via a special error code so CLI can print and exit 0.
      throw new DrizzleMigrateError('HELP_REQUESTED', 'help requested');
    } else {
      throw new DrizzleMigrateError('INVALID_ARGS', `Unknown argument: ${arg}`);
    }
  }

  if (!migrationsDir) {
    throw new DrizzleMigrateError('INVALID_ARGS', '--migrations-dir is required');
  }

  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    throw new DrizzleMigrateError(
      'MISSING_DATABASE_URL',
      'DATABASE_URL environment variable is required',
    );
  }

  return { migrationsDir, dryRun, legacyByPosition, psqlPath, databaseUrl };
}

function printHelp(): void {
  const help = [
    'Usage: pnpm tsx scripts/drizzle-migrate-apply.ts --migrations-dir <path> [flags]',
    '',
    'Applies pending Drizzle migrations using psql, recording SHA-256 hashes in',
    'drizzle.__drizzle_migrations to stay compatible with drizzle-orm v0.45.',
    '',
    'Required:',
    '  DATABASE_URL env var',
    '  --migrations-dir <path>    Directory containing meta/_journal.json',
    '',
    'Flags:',
    '  --dry-run                  Report plan without applying',
    '  --legacy-by-position       Treat existing rows positionally (skip re-apply)',
    '  --psql <path>              Path to psql binary (default: "psql")',
  ].join('\n');
  console.log(help);
}

export function formatSummary(summary: ApplySummary, dryRun: boolean): string {
  const verb = dryRun ? 'would apply' : 'applied';
  return `drizzle-migrate-apply: ${verb} ${summary.applied.length}, already-present ${summary.alreadyPresent.length}, pending ${summary.pending.length - summary.applied.length}`;
}

export async function main(argv: string[] = process.argv): Promise<number> {
  let options: ApplyOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error: unknown) {
    if (error instanceof DrizzleMigrateError && error.code === 'HELP_REQUESTED') {
      printHelp();
      return 0;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`drizzle-migrate-apply: ${message}`);
    return 2;
  }

  const runner = createPsqlRunner({
    databaseUrl: options.databaseUrl,
    psqlPath: options.psqlPath,
  });

  try {
    const summary = runMigrateApply(runner, options);
    console.log(formatSummary(summary, options.dryRun));
    for (const tag of summary.applied) {
      console.log(`  ${options.dryRun ? '[dry-run] ' : ''}${tag}`);
    }
    return 0;
  } catch (error: unknown) {
    if (error instanceof DrizzleMigrateError) {
      console.error(`drizzle-migrate-apply: [${error.code}] ${error.message}`);
      if (error.context) {
        console.error(`  context: ${JSON.stringify(error.context)}`);
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`drizzle-migrate-apply: unexpected error: ${message}`);
    }
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Direct execution
// ---------------------------------------------------------------------------

const isDirectExecution =
  process.argv[1]?.endsWith('drizzle-migrate-apply.ts') ||
  process.argv[1]?.endsWith('drizzle-migrate-apply.js');

if (isDirectExecution) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      console.error('drizzle-migrate-apply: fatal error:', error);
      process.exit(1);
    });
}
