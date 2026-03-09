// ---------------------------------------------------------------------------
// Database Backup Utility — pg_dump wrapper, retention, destructive detection
// ---------------------------------------------------------------------------

import { execFile as execFileCb } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createGzip } from 'node:zlib';

import { ControlPlaneError } from '@agentctl/shared';

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackupConfig = {
  /** Directory to store backup files. */
  backupDir: string;
  /** Database name to include in the backup filename. */
  database: string;
  /** PostgreSQL connection string for pg_dump. */
  connectionString: string;
  /** Number of recent backups to retain. Defaults to 7. */
  retentionCount: number;
  /** Custom pg_dump binary path. Defaults to "pg_dump". */
  pgDumpPath: string;
  /** Additional arguments to pass to pg_dump. */
  pgDumpArgs: string[];
};

export type BackupResult = {
  /** Absolute path to the backup file. */
  path: string;
  /** File size in bytes. */
  size: number;
  /** Duration of the backup in milliseconds. */
  duration: number;
  /** Database name that was backed up. */
  database: string;
  /** ISO timestamp of the backup. */
  timestamp: string;
};

export type DestructiveOperation = {
  /** Migration filename or identifier. */
  file: string;
  /** 1-based line number where the destructive statement was found. */
  line: number;
  /** The destructive SQL statement (trimmed). */
  statement: string;
  /** Category of the destructive operation. */
  kind: 'DROP_TABLE' | 'DROP_COLUMN' | 'TRUNCATE' | 'DROP_CONSTRAINT' | 'DROP_INDEX';
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BACKUP_DIR = './backups';
const DEFAULT_RETENTION_COUNT = 7;
const DEFAULT_PG_DUMP_PATH = 'pg_dump';
const PG_DUMP_MAX_BUFFER = 1024 * 1024 * 512; // 512 MB

/**
 * Pattern for backup filenames produced by this utility.
 * Example: backup-agentctl-2026-03-02T10-30-00-000Z.sql.gz
 */
const BACKUP_FILENAME_PATTERN =
  /^backup-(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.sql\.gz$/;

// ---------------------------------------------------------------------------
// Destructive operation patterns
// ---------------------------------------------------------------------------

const DROP_TABLE_PATTERN = /^\s*DROP\s+TABLE\b/i;
const DROP_COLUMN_PATTERN = /^\s*ALTER\s+TABLE\s+.+\bDROP\s+COLUMN\b/i;
const TRUNCATE_PATTERN = /^\s*TRUNCATE\s+(?:TABLE\s+)?/i;
const DROP_CONSTRAINT_PATTERN = /^\s*ALTER\s+TABLE\s+.+\bDROP\s+CONSTRAINT\b/i;
const DROP_INDEX_PATTERN = /^\s*DROP\s+INDEX\b/i;

// ---------------------------------------------------------------------------
// BackupManager
// ---------------------------------------------------------------------------

export type BackupManager = {
  /** Create a gzipped pg_dump backup. */
  createBackup(): Promise<BackupResult>;
  /** Enforce retention policy: keep only the N most recent backups. */
  enforceRetention(): Promise<string[]>;
  /** Get the resolved configuration. */
  getConfig(): BackupConfig;
};

/** Build the backup filename from database name and ISO timestamp. */
export function buildBackupFilename(database: string, timestamp: Date): string {
  // Replace colons and dots with dashes for filesystem safety
  const ts = timestamp.toISOString().replace(/:/g, '-').replace(/\./g, '-');
  return `backup-${database}-${ts}.sql.gz`;
}

/** Parse a backup filename to extract database and timestamp. */
export function parseBackupFilename(
  filename: string,
): { database: string; timestamp: string } | undefined {
  const match = filename.match(BACKUP_FILENAME_PATTERN);
  if (!match) {
    return undefined;
  }
  return { database: match[1], timestamp: match[2] };
}

/** Sort backup filenames by their embedded timestamp, newest first. */
export function sortBackupsByTimestamp(filenames: string[]): string[] {
  return [...filenames].sort((a, b) => {
    const parsedA = parseBackupFilename(a);
    const parsedB = parseBackupFilename(b);
    if (!parsedA || !parsedB) {
      return 0;
    }
    // Reverse lexicographic on the timestamp gives newest first
    return parsedB.timestamp.localeCompare(parsedA.timestamp);
  });
}

/** Create a BackupManager with the given configuration. */
export function createBackupManager(config?: Partial<BackupConfig>): BackupManager {
  const resolved: BackupConfig = {
    backupDir: config?.backupDir ?? DEFAULT_BACKUP_DIR,
    database: config?.database ?? 'agentctl',
    connectionString: config?.connectionString ?? '',
    retentionCount: config?.retentionCount ?? DEFAULT_RETENTION_COUNT,
    pgDumpPath: config?.pgDumpPath ?? DEFAULT_PG_DUMP_PATH,
    pgDumpArgs: config?.pgDumpArgs ?? [],
  };

  if (resolved.retentionCount < 1) {
    throw new ControlPlaneError('INVALID_RETENTION_COUNT', 'retentionCount must be at least 1', {
      retentionCount: resolved.retentionCount,
    });
  }

  return {
    getConfig(): BackupConfig {
      return { ...resolved };
    },

    async createBackup(): Promise<BackupResult> {
      if (!resolved.connectionString) {
        throw new ControlPlaneError(
          'MISSING_CONNECTION_STRING',
          'connectionString is required to create a backup',
        );
      }

      const now = new Date();
      const filename = buildBackupFilename(resolved.database, now);
      const outputPath = join(resolved.backupDir, filename);

      // Ensure the backup directory exists
      try {
        await mkdir(resolved.backupDir, { recursive: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'BACKUP_DIR_CREATE_FAILED',
          `Failed to create backup directory: ${message}`,
          { backupDir: resolved.backupDir },
        );
      }

      const startTime = Date.now();

      // Build pg_dump arguments
      const args = [
        '--dbname',
        resolved.connectionString,
        '--format=custom',
        ...resolved.pgDumpArgs,
      ];

      try {
        const { stdout } = await execFile(resolved.pgDumpPath, args, {
          encoding: 'buffer',
          maxBuffer: PG_DUMP_MAX_BUFFER,
        });

        // Compress with gzip and write to file
        await compressAndWrite(stdout, outputPath);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError('PG_DUMP_FAILED', `pg_dump execution failed: ${message}`, {
          pgDumpPath: resolved.pgDumpPath,
          database: resolved.database,
        });
      }

      const duration = Date.now() - startTime;

      // Get file size
      let size: number;
      try {
        const stats = await stat(outputPath);
        size = stats.size;
      } catch {
        size = 0;
      }

      return {
        path: outputPath,
        size,
        duration,
        database: resolved.database,
        timestamp: now.toISOString(),
      };
    },

    async enforceRetention(): Promise<string[]> {
      let entries: string[];
      try {
        entries = await readdir(resolved.backupDir);
      } catch {
        // Directory does not exist or is unreadable — nothing to clean
        return [];
      }

      // Filter to only backup files matching our pattern and the configured database
      const backupFiles = entries.filter((entry) => {
        const parsed = parseBackupFilename(entry);
        return parsed !== undefined && parsed.database === resolved.database;
      });

      if (backupFiles.length <= resolved.retentionCount) {
        return [];
      }

      // Sort newest first, then delete everything beyond retentionCount
      const sorted = sortBackupsByTimestamp(backupFiles);
      const toDelete = sorted.slice(resolved.retentionCount);
      const deleted: string[] = [];

      for (const file of toDelete) {
        const filePath = join(resolved.backupDir, file);
        try {
          await unlink(filePath);
          deleted.push(file);
        } catch {
          // Skip files that cannot be deleted (already removed, permissions, etc.)
        }
      }

      return deleted;
    },
  };
}

// ---------------------------------------------------------------------------
// Destructive operation detection
// ---------------------------------------------------------------------------

/** Detect destructive SQL operations in a migration SQL string. */
export function detectDestructiveOperations(
  sql: string,
  file = '<unknown>',
): DestructiveOperation[] {
  const lines = sql.split('\n');
  const operations: DestructiveOperation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const lineNum = i + 1;

    // Skip blank lines and comments
    if (trimmed === '' || trimmed.startsWith('--')) {
      continue;
    }

    if (DROP_TABLE_PATTERN.test(trimmed)) {
      operations.push({
        file,
        line: lineNum,
        statement: trimmed,
        kind: 'DROP_TABLE',
      });
    }

    if (DROP_COLUMN_PATTERN.test(trimmed)) {
      operations.push({
        file,
        line: lineNum,
        statement: trimmed,
        kind: 'DROP_COLUMN',
      });
    }

    if (TRUNCATE_PATTERN.test(trimmed)) {
      operations.push({
        file,
        line: lineNum,
        statement: trimmed,
        kind: 'TRUNCATE',
      });
    }

    if (DROP_CONSTRAINT_PATTERN.test(trimmed)) {
      operations.push({
        file,
        line: lineNum,
        statement: trimmed,
        kind: 'DROP_CONSTRAINT',
      });
    }

    if (DROP_INDEX_PATTERN.test(trimmed)) {
      operations.push({
        file,
        line: lineNum,
        statement: trimmed,
        kind: 'DROP_INDEX',
      });
    }
  }

  return operations;
}

/** Returns true if any destructive operations require manual approval. */
export function requiresApproval(operations: DestructiveOperation[]): boolean {
  return operations.length > 0;
}

/**
 * Scan multiple migration SQL strings for destructive operations.
 * Returns a flat list of all destructive operations found across all files.
 */
export function scanMigrationsForDestructive(
  migrations: Array<{ filename: string; content: string }>,
): DestructiveOperation[] {
  const allOps: DestructiveOperation[] = [];
  for (const migration of migrations) {
    const ops = detectDestructiveOperations(migration.content, migration.filename);
    allOps.push(...ops);
  }
  return allOps;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Compress a buffer with gzip and write to a file path. Returns a promise. */
function compressAndWrite(data: Buffer, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const gzip = createGzip({ level: 6 });
    const output = createWriteStream(outputPath);

    output.on('finish', resolve);
    output.on('error', (err) => {
      reject(
        new ControlPlaneError('COMPRESSION_FAILED', `gzip compression failed: ${err.message}`, {
          outputPath,
        }),
      );
    });
    gzip.on('error', (err) => {
      reject(
        new ControlPlaneError('COMPRESSION_FAILED', `gzip compression failed: ${err.message}`, {
          outputPath,
        }),
      );
    });

    gzip.pipe(output);
    gzip.end(data);
  });
}
