#!/usr/bin/env npx tsx

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ClaudeMemDatabase, ClaudeMemObservation } from './claude-mem-migration-lib.js';
import { loadBetterSqlite3, resolveDbPath } from './claude-mem-migration-lib.js';

export type AuditableClaudeMemDatabase = ClaudeMemDatabase;

export type AuditArgs = {
  dbPath: string;
  noBackup: boolean;
  backupPath: string | null;
};

export type AuditReport = {
  dbPath: string;
  tables: string[];
  rowCounts: {
    observations: number;
    session_summaries: number;
    sdk_sessions: number;
  };
  uniqueObservationTypes: string[];
  uniqueProjects: string[];
  sdkSessionMappings: number;
  fieldCoverage: Record<string, number>;
};

export function parseAuditArgs(argv: string[]): AuditArgs {
  const args = argv.slice(2);
  let dbPath = '';
  let noBackup = false;
  let backupPath: string | null = null;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--no-backup') {
      noBackup = true;
      continue;
    }

    if (arg === '--backup-path' && args[index + 1]) {
      backupPath = path.resolve(args[index + 1] ?? '');
      index++;
      continue;
    }

    if (!arg?.startsWith('--')) {
      dbPath = arg;
    }
  }

  if (!dbPath) {
    console.error('Usage: pnpm tsx scripts/audit-claude-mem.ts <path-to-claude-mem.db>');
    console.error('Options:');
    console.error('  --no-backup              Skip creating a snapshot copy before auditing');
    console.error('  --backup-path <path>     Write the snapshot to an explicit path');
    process.exit(1);
  }

  return {
    dbPath: resolveDbPath(dbPath),
    noBackup,
    backupPath,
  };
}

export function buildDefaultBackupPath(dbPath: string, now: Date = new Date()): string {
  const parsed = path.parse(dbPath);
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

  return path.join(parsed.dir, `${parsed.name}.backup-${timestamp}${parsed.ext || '.db'}`);
}

function listTables(db: AuditableClaudeMemDatabase): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name?: string }>;

  return rows
    .map((row) => row.name)
    .filter((name): name is string => typeof name === 'string')
    .sort();
}

function readRows(db: AuditableClaudeMemDatabase, table: string): Record<string, unknown>[] {
  try {
    return db.prepare(`SELECT * FROM ${table}`).all();
  } catch {
    return [];
  }
}

export function generateAuditReport(db: AuditableClaudeMemDatabase, dbPath: string): AuditReport {
  const tables = listTables(db);
  const observations = readRows(db, 'observations') as ClaudeMemObservation[];
  const summaries = readRows(db, 'session_summaries');
  const sdkSessions = readRows(db, 'sdk_sessions');

  const uniqueObservationTypes = [...new Set(observations.map((row) => row.type).filter(Boolean))]
    .map(String)
    .sort();
  const uniqueProjects = [...new Set(observations.map((row) => row.project).filter(Boolean))]
    .map(String)
    .sort();

  const fieldCoverage = {
    title: observations.filter((row) => Boolean(row.title?.trim())).length,
    subtitle: observations.filter((row) => Boolean(row.subtitle?.trim())).length,
    facts: observations.filter((row) => Boolean(row.facts?.trim())).length,
    narrative: observations.filter((row) => Boolean(row.narrative?.trim())).length,
    files_modified: observations.filter((row) => Boolean(row.files_modified?.trim())).length,
    project: observations.filter((row) => Boolean(row.project?.trim())).length,
    memory_session_id: observations.filter((row) => Boolean(row.memory_session_id?.trim())).length,
  };

  return {
    dbPath,
    tables,
    rowCounts: {
      observations: observations.length,
      session_summaries: summaries.length,
      sdk_sessions: sdkSessions.length,
    },
    uniqueObservationTypes,
    uniqueProjects,
    sdkSessionMappings: sdkSessions.length,
    fieldCoverage,
  };
}

export function copyDatabaseSnapshot(dbPath: string, backupPath: string): void {
  fs.copyFileSync(dbPath, backupPath);
}

function printAuditReport(report: AuditReport, backupPath: string | null): void {
  console.log(`Audited: ${report.dbPath}`);
  if (backupPath) {
    console.log(`Backup:  ${backupPath}`);
  }
  console.log('');
  console.log(`Tables: ${report.tables.join(', ') || '(none found)'}`);
  console.log(
    `Rows: observations=${report.rowCounts.observations}, session_summaries=${report.rowCounts.session_summaries}, sdk_sessions=${report.rowCounts.sdk_sessions}`,
  );
  console.log(`Observation types: ${report.uniqueObservationTypes.join(', ') || '(none)'}`);
  console.log(`Projects: ${report.uniqueProjects.join(', ') || '(none)'}`);
  console.log(`sdk_sessions mappings: ${report.sdkSessionMappings}`);
  console.log('');
  console.log('Field coverage (non-empty rows):');
  for (const [field, count] of Object.entries(report.fieldCoverage)) {
    console.log(`- ${field}: ${count}`);
  }
}

export async function main(): Promise<void> {
  const args = parseAuditArgs(process.argv);

  if (!fs.existsSync(args.dbPath)) {
    console.error(`Error: Database file not found: ${args.dbPath}`);
    process.exit(1);
  }

  let backupPath: string | null = null;
  if (!args.noBackup) {
    backupPath = args.backupPath ?? buildDefaultBackupPath(args.dbPath);
    copyDatabaseSnapshot(args.dbPath, backupPath);
  }

  const sqlite = await loadBetterSqlite3();
  const db = new sqlite.default(args.dbPath, { readonly: true });

  try {
    const report = generateAuditReport(db, args.dbPath);
    printAuditReport(report, backupPath);
  } finally {
    db.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void main();
}
