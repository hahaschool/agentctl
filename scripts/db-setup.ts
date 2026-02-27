#!/usr/bin/env npx tsx

/**
 * Database setup script for AgentCTL control plane.
 *
 * Reads the Drizzle migration SQL files and applies them to the target
 * PostgreSQL database. Tracks applied migrations in a `_drizzle_migrations`
 * table so each migration runs at most once.
 *
 * Usage:
 *   DATABASE_URL=postgres://user:pass@localhost:5432/agentctl pnpm tsx scripts/db-setup.ts
 *
 * Environment:
 *   DATABASE_URL  Required. PostgreSQL connection string.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

class DbSetupError extends Error {
  constructor(
    public code: string,
    message: string,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DbSetupError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type Journal = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'packages', 'control-plane', 'drizzle');

const JOURNAL_PATH = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');

const MIGRATIONS_TABLE = '_drizzle_migrations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadJournal(): Journal {
  if (!fs.existsSync(JOURNAL_PATH)) {
    throw new DbSetupError('JOURNAL_NOT_FOUND', `Migration journal not found at ${JOURNAL_PATH}`, {
      path: JOURNAL_PATH,
    });
  }

  const raw = fs.readFileSync(JOURNAL_PATH, 'utf-8');

  try {
    return JSON.parse(raw) as Journal;
  } catch {
    throw new DbSetupError('JOURNAL_PARSE_ERROR', 'Failed to parse migration journal JSON', {
      path: JOURNAL_PATH,
    });
  }
}

function loadMigrationSql(tag: string): string {
  const sqlPath = path.join(MIGRATIONS_DIR, `${tag}.sql`);

  if (!fs.existsSync(sqlPath)) {
    throw new DbSetupError('MIGRATION_FILE_NOT_FOUND', `Migration SQL file not found: ${sqlPath}`, {
      tag,
      path: sqlPath,
    });
  }

  return fs.readFileSync(sqlPath, 'utf-8');
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

async function ensureMigrationsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
      id serial PRIMARY KEY,
      tag text NOT NULL UNIQUE,
      created_at timestamp with time zone DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(pool: pg.Pool): Promise<Set<string>> {
  const result = await pool.query<{ tag: string }>(
    `SELECT tag FROM "${MIGRATIONS_TABLE}" ORDER BY id`,
  );
  return new Set(result.rows.map((row) => row.tag));
}

async function applyMigration(pool: pg.Pool, entry: JournalEntry, sql: string): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`INSERT INTO "${MIGRATIONS_TABLE}" (tag) VALUES ($1)`, [entry.tag]);
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : String(error);
    throw new DbSetupError('MIGRATION_FAILED', `Migration "${entry.tag}" failed: ${message}`, {
      tag: entry.tag,
      idx: entry.idx,
    });
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new DbSetupError('MISSING_DATABASE_URL', 'DATABASE_URL environment variable is required');
  }

  // Log a safe version of the URL (mask password)
  const safeUrl = databaseUrl.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
  console.log(`Connecting to: ${safeUrl}`);

  const pool = new pg.Pool({ connectionString: databaseUrl });

  try {
    // Verify connectivity
    const connResult = await pool.query('SELECT current_database() AS db');
    const dbName = (connResult.rows[0] as { db: string }).db;
    console.log(`Connected to database: ${dbName}`);

    // Ensure the migrations tracking table exists
    console.log(`Ensuring "${MIGRATIONS_TABLE}" table exists...`);
    await ensureMigrationsTable(pool);

    // Load journal
    const journal = loadJournal();
    console.log(`Found ${journal.entries.length} migration(s) in journal.`);

    // Determine which migrations have already been applied
    const applied = await getAppliedMigrations(pool);
    console.log(`Already applied: ${applied.size} migration(s).`);

    // Apply pending migrations in order
    const pending = journal.entries
      .sort((a, b) => a.idx - b.idx)
      .filter((entry) => !applied.has(entry.tag));

    if (pending.length === 0) {
      console.log('Database is up to date. No migrations to apply.');
      return;
    }

    console.log(`Applying ${pending.length} pending migration(s)...`);
    console.log('');

    for (const entry of pending) {
      console.log(`  [${entry.idx}] Applying "${entry.tag}"...`);
      const sql = loadMigrationSql(entry.tag);
      await applyMigration(pool, entry, sql);
      console.log(`  [${entry.idx}] Applied "${entry.tag}" successfully.`);
    }

    console.log('');
    console.log(`All migrations applied. ${pending.length} migration(s) executed.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof DbSetupError) {
    console.error(`Error [${error.code}]: ${error.message}`);
    if (error.context) {
      console.error('Context:', JSON.stringify(error.context, null, 2));
    }
  } else {
    console.error('Fatal error:', error);
  }
  process.exit(1);
});
