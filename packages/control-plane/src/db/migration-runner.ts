// ---------------------------------------------------------------------------
// Migration Runner — discover, sort, and determine pending SQL migrations
// ---------------------------------------------------------------------------

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type MigrationFile = {
  filename: string;
  version: string; // e.g., "0002"
  content: string;
  appliedAt?: Date;
};

export type MigrationRunResult = {
  applied: MigrationFile[];
  skipped: MigrationFile[];
  errors: Array<{ file: string; error: string }>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Matches filenames like `0000_initial_schema.sql`, `0001_add_schedule_config.sql`.
 * Captures the NNNN prefix as group 1.
 */
const MIGRATION_FILENAME_PATTERN = /^(\d{4,})_.+\.sql$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Discover migration files in a directory. */
export async function discoverMigrations(dirPath: string): Promise<MigrationFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return [];
  }

  const migrations: MigrationFile[] = [];

  for (const entry of entries) {
    const match = entry.match(MIGRATION_FILENAME_PATTERN);
    if (!match) {
      // Skip files that don't match the naming convention
      continue;
    }

    const version = match[1];
    const filePath = join(dirPath, entry);

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      // Skip unreadable files
      continue;
    }

    migrations.push({
      filename: entry,
      version,
      content,
    });
  }

  return sortMigrations(migrations);
}

/** Determine which migrations need to be applied (based on version ordering). */
export function getPendingMigrations(all: MigrationFile[], applied: string[]): MigrationFile[] {
  const appliedSet = new Set(applied);
  return all.filter((m) => !appliedSet.has(m.version));
}

/** Sort migrations by version number (lexicographic on the NNNN prefix). */
export function sortMigrations(migrations: MigrationFile[]): MigrationFile[] {
  return [...migrations].sort((a, b) => a.version.localeCompare(b.version));
}
