#!/usr/bin/env npx tsx

/**
 * Deploy-time migration runner for AgentCTL control plane.
 *
 * Designed to run as a pre-deploy step in CI/CD pipelines. Applies pending
 * Drizzle migrations with safety guarantees:
 *
 *   - Advisory lock prevents concurrent migration runs
 *   - Statement timeout prevents long-running migrations from blocking deploys
 *   - Per-migration transactions with automatic rollback on failure
 *   - Structured JSON output for CI consumption
 *   - Dry-run mode validates without applying
 *
 * Exit codes:
 *   0 = success (or dry-run pass)
 *   1 = migration failed
 *   2 = lock contention (another migration is running)
 *   3 = connection error
 *
 * Usage:
 *   MIGRATION_DATABASE_URL=postgres://migrator:pass@host:5432/agentctl \
 *     pnpm tsx scripts/migrate-deploy.ts [--dry-run] [--timeout 30000]
 *
 * Environment:
 *   MIGRATION_DATABASE_URL  Preferred. Dedicated migration user connection string.
 *   DATABASE_URL            Fallback if MIGRATION_DATABASE_URL is not set.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import {
  discoverMigrations,
  getPendingMigrations,
} from '../packages/control-plane/src/db/migration-runner.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class MigrateDeployError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MigrateDeployError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MigrateDeployResult = {
  success: boolean;
  dryRun: boolean;
  migrationsApplied: string[];
  migrationsSkipped: string[];
  migrationsPending: string[];
  error?: { code: string; message: string; migration?: string };
  durationMs: number;
  database: string;
  user: string;
  timestamp: string;
};

export type MigrateDeployOptions = {
  dryRun: boolean;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  migrationsDir: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_MIGRATIONS_DIR = path.resolve(
  __dirname,
  '..',
  'packages',
  'control-plane',
  'drizzle',
);

const MIGRATIONS_TABLE = '_drizzle_migrations';

/**
 * Advisory lock key — a fixed 64-bit integer used with pg_advisory_lock.
 * Chosen as a hash-like constant unlikely to collide with application locks.
 */
export const ADVISORY_LOCK_KEY = 8675309;

export const EXIT_SUCCESS = 0;
export const EXIT_MIGRATION_FAILED = 1;
export const EXIT_LOCK_CONTENTION = 2;
export const EXIT_CONNECTION_ERROR = 3;

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): MigrateDeployOptions {
  const args = argv.slice(2);
  let dryRun = false;
  let statementTimeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS;
  let lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS;
  const migrationsDir = DEFAULT_MIGRATIONS_DIR;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--timeout') {
      const next = args[i + 1];
      if (next === undefined || Number.isNaN(Number(next))) {
        throw new MigrateDeployError(
          'INVALID_ARGS',
          '--timeout requires a numeric value in milliseconds',
        );
      }
      statementTimeoutMs = Number(next);
      i++;
    } else if (arg === '--lock-timeout') {
      const next = args[i + 1];
      if (next === undefined || Number.isNaN(Number(next))) {
        throw new MigrateDeployError(
          'INVALID_ARGS',
          '--lock-timeout requires a numeric value in milliseconds',
        );
      }
      lockTimeoutMs = Number(next);
      i++;
    }
  }

  return { dryRun, statementTimeoutMs, lockTimeoutMs, migrationsDir };
}

// ---------------------------------------------------------------------------
// Connection helpers
// ---------------------------------------------------------------------------

export function getConnectionUrl(): string {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new MigrateDeployError(
      'MISSING_DATABASE_URL',
      'MIGRATION_DATABASE_URL or DATABASE_URL environment variable is required',
    );
  }
  return url;
}

export function maskConnectionUrl(url: string): string {
  return url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}

export function extractUserFromUrl(url: string): string {
  const match = url.match(/\/\/([^:@]+)(?::[^@]*)?@/);
  return match ? match[1] : 'unknown';
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

export async function ensureMigrationsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
      id serial PRIMARY KEY,
      tag text NOT NULL UNIQUE,
      created_at timestamp with time zone DEFAULT now()
    );
  `);
}

export async function getAppliedVersions(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query<{ tag: string }>(
    `SELECT tag FROM "${MIGRATIONS_TABLE}" ORDER BY id`,
  );
  return result.rows.map((row) => row.tag);
}

/**
 * Attempt to acquire a PostgreSQL advisory lock. Returns true if the lock was
 * acquired, false if another session already holds it.
 */
export async function tryAcquireAdvisoryLock(
  client: pg.PoolClient,
  lockTimeoutMs: number,
): Promise<boolean> {
  await client.query(`SET lock_timeout = '${lockTimeoutMs}ms'`);
  const result = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [ADVISORY_LOCK_KEY],
  );
  return result.rows[0]?.locked === true;
}

export async function releaseAdvisoryLock(client: pg.PoolClient): Promise<void> {
  await client.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]);
}

export async function validateUserPermissions(pool: pg.Pool): Promise<{
  database: string;
  user: string;
}> {
  const result = await pool.query<{ db: string; user: string }>(
    'SELECT current_database() AS db, current_user AS user',
  );
  const row = result.rows[0];
  if (!row) {
    throw new MigrateDeployError('PERMISSION_CHECK_FAILED', 'Could not query current user info');
  }
  return { database: row.db, user: row.user };
}

/**
 * Apply a single migration inside a transaction with a statement timeout.
 */
export async function applyMigration(
  client: pg.PoolClient,
  version: string,
  filename: string,
  sql: string,
  statementTimeoutMs: number,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);
    await client.query(sql);
    await client.query(`INSERT INTO "${MIGRATIONS_TABLE}" (tag) VALUES ($1)`, [version]);
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : String(error);
    throw new MigrateDeployError('MIGRATION_FAILED', `Migration "${filename}" failed: ${message}`, {
      filename,
      version,
    });
  }
}

// ---------------------------------------------------------------------------
// Main runner (testable, does not call process.exit)
// ---------------------------------------------------------------------------

export async function runMigrations(
  pool: pg.Pool,
  options: MigrateDeployOptions,
): Promise<MigrateDeployResult> {
  const startTime = Date.now();
  const result: MigrateDeployResult = {
    success: false,
    dryRun: options.dryRun,
    migrationsApplied: [],
    migrationsSkipped: [],
    migrationsPending: [],
    durationMs: 0,
    database: '',
    user: '',
    timestamp: new Date().toISOString(),
  };

  // 1. Validate connection and permissions
  let dbInfo: { database: string; user: string };
  try {
    dbInfo = await validateUserPermissions(pool);
  } catch (error: unknown) {
    result.durationMs = Date.now() - startTime;
    if (error instanceof MigrateDeployError) {
      result.error = { code: error.code, message: error.message };
    } else {
      const message = error instanceof Error ? error.message : String(error);
      result.error = { code: 'CONNECTION_ERROR', message };
    }
    return result;
  }

  result.database = dbInfo.database;
  result.user = dbInfo.user;

  // 2. Acquire advisory lock
  let lockClient: pg.PoolClient;
  try {
    lockClient = await pool.connect();
  } catch (error: unknown) {
    result.durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    result.error = { code: 'CONNECTION_ERROR', message };
    return result;
  }

  let lockAcquired = false;
  try {
    lockAcquired = await tryAcquireAdvisoryLock(lockClient, options.lockTimeoutMs);
  } catch (error: unknown) {
    lockClient.release();
    result.durationMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    result.error = { code: 'LOCK_ERROR', message };
    return result;
  }

  if (!lockAcquired) {
    lockClient.release();
    result.durationMs = Date.now() - startTime;
    result.error = {
      code: 'LOCK_CONTENTION',
      message: 'Another migration process is currently running',
    };
    return result;
  }

  try {
    // 3. Ensure migrations table exists
    await ensureMigrationsTable(pool);

    // 4. Discover and determine pending migrations
    const allMigrations = await discoverMigrations(options.migrationsDir);
    const appliedVersions = await getAppliedVersions(pool);
    const pending = getPendingMigrations(allMigrations, appliedVersions);

    result.migrationsSkipped = appliedVersions;
    result.migrationsPending = pending.map((m) => m.filename);

    if (pending.length === 0) {
      result.success = true;
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // 5. Dry-run: report pending without applying
    if (options.dryRun) {
      result.success = true;
      result.durationMs = Date.now() - startTime;
      return result;
    }

    // 6. Apply pending migrations one at a time
    const migrationClient = await pool.connect();
    try {
      for (const migration of pending) {
        await applyMigration(
          migrationClient,
          migration.version,
          migration.filename,
          migration.content,
          options.statementTimeoutMs,
        );
        result.migrationsApplied.push(migration.filename);
        // Remove from pending as they're applied
        result.migrationsPending = result.migrationsPending.filter((f) => f !== migration.filename);
      }
    } finally {
      migrationClient.release();
    }

    result.success = true;
    result.durationMs = Date.now() - startTime;
    return result;
  } catch (error: unknown) {
    result.durationMs = Date.now() - startTime;
    if (error instanceof MigrateDeployError) {
      result.error = {
        code: error.code,
        message: error.message,
        migration: error.context?.filename as string | undefined,
      };
    } else {
      const message = error instanceof Error ? error.message : String(error);
      result.error = { code: 'UNEXPECTED_ERROR', message };
    }
    return result;
  } finally {
    // Always release the advisory lock
    try {
      await releaseAdvisoryLock(lockClient);
    } catch {
      // Swallow unlock errors — the advisory lock will expire when the connection closes
    } finally {
      lockClient.release();
    }
  }
}

// ---------------------------------------------------------------------------
// Determine exit code from result
// ---------------------------------------------------------------------------

export function exitCodeFromResult(result: MigrateDeployResult): number {
  if (result.success) {
    return EXIT_SUCCESS;
  }
  const code = result.error?.code;
  if (code === 'LOCK_CONTENTION') {
    return EXIT_LOCK_CONTENTION;
  }
  if (code === 'CONNECTION_ERROR') {
    return EXIT_CONNECTION_ERROR;
  }
  return EXIT_MIGRATION_FAILED;
}

// ---------------------------------------------------------------------------
// Main (CLI entry point)
// ---------------------------------------------------------------------------

export async function main(argv: string[] = process.argv): Promise<MigrateDeployResult> {
  const options = parseArgs(argv);
  const connectionUrl = getConnectionUrl();

  const safeUrl = maskConnectionUrl(connectionUrl);
  const user = extractUserFromUrl(connectionUrl);
  console.error(`[migrate-deploy] Connecting as user "${user}" to: ${safeUrl}`);

  if (options.dryRun) {
    console.error('[migrate-deploy] DRY RUN — no migrations will be applied');
  }

  const pool = new pg.Pool({
    connectionString: connectionUrl,
    connectionTimeoutMillis: 10_000,
    max: 2,
  });

  try {
    const result = await runMigrations(pool, options);

    // Output structured JSON to stdout for CI consumption
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
      const appliedCount = result.migrationsApplied.length;
      const pendingCount = result.migrationsPending.length;
      if (options.dryRun) {
        console.error(`[migrate-deploy] Dry run complete. ${pendingCount} migration(s) pending.`);
      } else if (appliedCount > 0) {
        console.error(`[migrate-deploy] Successfully applied ${appliedCount} migration(s).`);
      } else {
        console.error('[migrate-deploy] Database is up to date. No migrations to apply.');
      }
    } else {
      console.error(`[migrate-deploy] FAILED: [${result.error?.code}] ${result.error?.message}`);
    }

    return result;
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Run when executed directly
// ---------------------------------------------------------------------------

const isDirectExecution =
  process.argv[1]?.endsWith('migrate-deploy.ts') || process.argv[1]?.endsWith('migrate-deploy.js');

if (isDirectExecution) {
  main()
    .then((result) => {
      process.exit(exitCodeFromResult(result));
    })
    .catch((error: unknown) => {
      if (error instanceof MigrateDeployError) {
        console.error(`[migrate-deploy] Error [${error.code}]: ${error.message}`);
        if (error.context) {
          console.error('Context:', JSON.stringify(error.context, null, 2));
        }
      } else {
        console.error('[migrate-deploy] Fatal error:', error);
      }
      process.exit(EXIT_MIGRATION_FAILED);
    });
}
