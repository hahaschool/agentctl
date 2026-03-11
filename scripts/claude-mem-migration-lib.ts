import * as path from 'node:path';

import type { EntityType, FactSource, MemoryScope } from '@agentctl/shared';

export type SqliteStatement = {
  all(...params: unknown[]): Record<string, unknown>[];
};

export type ClaudeMemDatabase = {
  prepare(sql: string): SqliteStatement;
  close(): void;
};

export type BetterSqlite3Module = {
  default: new (dbPath: string, options?: { readonly?: boolean }) => ClaudeMemDatabase;
};

export type ClaudeMemObservation = {
  id: number;
  type: string;
  title: string;
  subtitle: string | null;
  facts: string | null;
  narrative: string | null;
  files_modified: string | null;
  project: string | null;
  created_at: string | null;
  created_at_epoch: number | null;
  memory_session_id: string | null;
};

export type ClaudeMemSessionSummary = {
  id: number;
  session_id: string;
  summary: string;
  created_at: string | null;
};

export type ImportedFactSource = FactSource & {
  source: 'claude-mem';
  source_table: 'observations' | 'session_summaries';
  source_id: string;
  source_key: string;
  memory_session_id?: string | null;
  files_modified?: string[];
  original_created_at?: string | null;
  imported_at?: string;
};

const OBSERVATION_TYPE_MAP: Record<string, EntityType> = {
  decision: 'decision',
  bugfix: 'error',
  feature: 'code_artifact',
  refactor: 'pattern',
  discovery: 'concept',
  change: 'code_artifact',
};

export function parseStringArray(value: string | null | undefined): string[] {
  if (!value || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  } catch {
    return [];
  }
}

export function mapObservationType(value: string | null | undefined): EntityType {
  if (!value) {
    return 'concept';
  }

  return OBSERVATION_TYPE_MAP[value] ?? 'concept';
}

export function assembleObservationContent(observation: ClaudeMemObservation): string {
  const parts: string[] = [];

  if (observation.title?.trim()) {
    parts.push(observation.title.trim());
  }

  if (observation.subtitle?.trim()) {
    parts.push(observation.subtitle.trim());
  }

  if (observation.narrative?.trim()) {
    parts.push(`Context: ${observation.narrative.trim()}`);
  }

  return parts.join('\n\n').trim();
}

export function computeObservationConfidence(observation: ClaudeMemObservation): number {
  const hasNarrative = Boolean(observation.narrative?.trim());
  const hasFacts = parseStringArray(observation.facts).length > 0;
  const hasTitle = Boolean(observation.title?.trim() || observation.subtitle?.trim());

  if (hasNarrative && hasFacts) {
    return 0.95;
  }

  if (hasFacts) {
    return 0.9;
  }

  if (hasTitle) {
    return 0.8;
  }

  return 0.6;
}

export function resolveObservationScope(
  observation: ClaudeMemObservation,
  projectOverride?: string | null,
): MemoryScope {
  const project = projectOverride?.trim() || observation.project?.trim();
  return project ? `project:${project}` : 'global';
}

export function buildImportedSource(params: {
  sourceTable: 'observations' | 'session_summaries';
  sourceId: number | string;
  sourceKey: string;
  sessionId: string | null;
  memorySessionId: string | null;
  machineId: string | null;
  importedAt: string;
  filesModified?: string[];
  originalCreatedAt?: string | null;
}): ImportedFactSource {
  return {
    session_id: params.sessionId,
    agent_id: null,
    machine_id: params.machineId,
    turn_index: null,
    extraction_method: 'import',
    source: 'claude-mem',
    source_table: params.sourceTable,
    source_id: String(params.sourceId),
    source_key: params.sourceKey,
    memory_session_id: params.memorySessionId,
    files_modified: params.filesModified ?? [],
    original_created_at: params.originalCreatedAt ?? null,
    imported_at: params.importedAt,
  };
}

export async function loadBetterSqlite3(): Promise<BetterSqlite3Module> {
  try {
    return (await import('better-sqlite3')) as unknown as BetterSqlite3Module;
  } catch {
    console.error('Error: better-sqlite3 is not installed.');
    console.error('Install it from the monorepo root with:');
    console.error('  pnpm add -Dw better-sqlite3 @types/better-sqlite3');
    process.exit(1);
  }
}

export function resolveDbPath(input: string): string {
  return path.resolve(input);
}
