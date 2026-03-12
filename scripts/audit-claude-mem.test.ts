import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditableClaudeMemDatabase } from './audit-claude-mem.js';
import { buildDefaultBackupPath, generateAuditReport, parseAuditArgs } from './audit-claude-mem.js';

function makeDb(tables: {
  observations?: Record<string, unknown>[];
  session_summaries?: Record<string, unknown>[];
  sdk_sessions?: Record<string, unknown>[];
}): AuditableClaudeMemDatabase {
  return {
    prepare: vi.fn((sql: string) => ({
      all: () => {
        if (sql.includes('sqlite_master')) {
          return [
            ...(tables.observations ? [{ name: 'observations' }] : []),
            ...(tables.session_summaries ? [{ name: 'session_summaries' }] : []),
            ...(tables.sdk_sessions ? [{ name: 'sdk_sessions' }] : []),
          ];
        }
        if (sql.includes('FROM observations')) return tables.observations ?? [];
        if (sql.includes('FROM session_summaries')) return tables.session_summaries ?? [];
        if (sql.includes('FROM sdk_sessions')) return tables.sdk_sessions ?? [];
        return [];
      },
    })),
    close: vi.fn(),
  };
}

describe('parseAuditArgs()', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses the positional db path and enables backups by default', () => {
    const result = parseAuditArgs(['node', 'audit-claude-mem.ts', './memory.db']);

    expect(result.dbPath).toMatch(/memory\.db$/);
    expect(result.noBackup).toBe(false);
  });

  it('supports --no-backup and --backup-path', () => {
    const result = parseAuditArgs([
      'node',
      'audit-claude-mem.ts',
      './memory.db',
      '--no-backup',
      '--backup-path',
      './backup.sqlite',
    ]);

    expect(result.noBackup).toBe(true);
    expect(result.backupPath).toMatch(/backup\.sqlite$/);
  });

  it('exits with code 1 when db path is missing', () => {
    parseAuditArgs(['node', 'audit-claude-mem.ts']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('buildDefaultBackupPath()', () => {
  it('creates a sibling backup path with a timestamped suffix', () => {
    const result = buildDefaultBackupPath('/tmp/claude-mem.db', new Date('2026-03-11T12:00:00Z'));
    expect(result).toBe('/tmp/claude-mem.backup-20260311T120000Z.db');
  });
});

describe('generateAuditReport()', () => {
  it('counts rows, unique types/projects, and field coverage across tables', () => {
    const db = makeDb({
      observations: [
        {
          id: 1,
          type: 'decision',
          project: 'agentctl',
          title: 'Prefer Biome',
          facts: '["one"]',
          narrative: 'Used across packages',
        },
        {
          id: 2,
          type: 'bugfix',
          project: 'agentctl',
          title: 'Fix drift',
          facts: '',
          narrative: '',
        },
      ],
      session_summaries: [
        { id: 1, session_id: 'session-1', summary: 'Testing strategy', created_at: '2026-01-01' },
      ],
      sdk_sessions: [
        { memory_session_id: 'memory-session-1', content_session_id: 'claude-session-1' },
      ],
    });

    const report = generateAuditReport(db, '/tmp/claude-mem.db');

    expect(report.rowCounts).toEqual({
      observations: 2,
      session_summaries: 1,
      sdk_sessions: 1,
    });
    expect(report.uniqueObservationTypes).toEqual(['bugfix', 'decision']);
    expect(report.uniqueProjects).toEqual(['agentctl']);
    expect(report.sdkSessionMappings).toBe(1);
    expect(report.fieldCoverage.title).toBe(2);
    expect(report.fieldCoverage.facts).toBe(1);
    expect(report.tables).toEqual(['observations', 'sdk_sessions', 'session_summaries']);
  });

  it('handles missing optional tables without failing', () => {
    const db = makeDb({
      observations: [],
    });

    const report = generateAuditReport(db, '/tmp/claude-mem.db');

    expect(report.rowCounts.session_summaries).toBe(0);
    expect(report.rowCounts.sdk_sessions).toBe(0);
    expect(report.tables).toEqual(['observations']);
  });
});
