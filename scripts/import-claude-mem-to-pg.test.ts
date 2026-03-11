import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ClaudeMemObservation,
  ImportCheckpoint,
  ImportedFactStore,
} from './import-claude-mem-to-pg.js';
import {
  importObservation,
  parseImportArgs,
  shouldSkipByCheckpoint,
} from './import-claude-mem-to-pg.js';

function makeObservation(
  overrides: Partial<ClaudeMemObservation> = {},
): ClaudeMemObservation {
  return {
    id: 42,
    type: 'decision',
    title: 'Prefer Biome for formatting',
    subtitle: 'Keep linting unified',
    facts: '["Biome replaces ESLint for formatting", "Run biome check in CI"]',
    narrative: 'Repeated lint drift pushed the team toward one formatter.',
    files_modified: '["package.json"]',
    project: 'agentctl',
    created_at: '2026-03-11T12:00:00.000Z',
    created_at_epoch: 1741694400,
    memory_session_id: 'memory-session-1',
    ...overrides,
  };
}

function makeStore(): ImportedFactStore {
  return {
    addFact: vi.fn(async (input) => ({
      id: `fact-${String(input.content).slice(0, 8)}`,
      scope: input.scope,
      content: input.content,
      content_model: 'text-embedding-3-small',
      entity_type: input.entity_type,
      confidence: input.confidence ?? 0.8,
      strength: 1,
      source: input.source,
      valid_from: '2026-03-11T12:00:00.000Z',
      valid_until: null,
      created_at: '2026-03-11T12:00:00.000Z',
      accessed_at: '2026-03-11T12:00:00.000Z',
    })),
    addEdge: vi.fn(async (input) => ({
      id: `edge-${input.source_fact_id}`,
      source_fact_id: input.source_fact_id,
      target_fact_id: input.target_fact_id,
      relation: input.relation,
      weight: input.weight ?? 0.5,
      created_at: '2026-03-11T12:00:00.000Z',
    })),
    findImportedFactBySourceKey: vi.fn().mockResolvedValue(null),
    findSimilarFact: vi.fn().mockResolvedValue(null),
  };
}

describe('parseImportArgs()', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses required db path and database URL plus safe defaults', () => {
    const result = parseImportArgs([
      'node',
      'import-claude-mem-to-pg.ts',
      './claude-mem.db',
      '--database-url',
      'postgresql://localhost/agentctl',
    ]);

    expect(result.dbPath).toMatch(/claude-mem\.db$/);
    expect(result.databaseUrl).toBe('postgresql://localhost/agentctl');
    expect(result.dryRun).toBe(false);
    expect(result.skipDedup).toBe(false);
    expect(result.batchSize).toBe(50);
  });

  it('supports dry-run, checkpoint, project override, and explicit embedding config', () => {
    const result = parseImportArgs([
      'node',
      'import-claude-mem-to-pg.ts',
      './claude-mem.db',
      '--database-url',
      'postgresql://localhost/agentctl',
      '--dry-run',
      '--skip-dedup',
      '--batch-size',
      '10',
      '--project',
      'agentctl',
      '--checkpoint-file',
      './checkpoint.json',
      '--embedding-base-url',
      'http://localhost:4000',
      '--embedding-model',
      'text-embedding-3-small',
    ]);

    expect(result.dryRun).toBe(true);
    expect(result.skipDedup).toBe(true);
    expect(result.batchSize).toBe(10);
    expect(result.project).toBe('agentctl');
    expect(result.checkpointFile).toMatch(/checkpoint\.json$/);
    expect(result.embeddingBaseUrl).toBe('http://localhost:4000');
    expect(result.embeddingModel).toBe('text-embedding-3-small');
  });

  it('exits with code 1 when required args are missing', () => {
    parseImportArgs(['node', 'import-claude-mem-to-pg.ts', './claude-mem.db']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('shouldSkipByCheckpoint()', () => {
  it('skips rows at or below the stored checkpoint and processes newer rows', () => {
    const checkpoint: ImportCheckpoint = {
      lastObservationId: 10,
      lastSessionSummaryId: 4,
      updatedAt: '2026-03-11T12:00:00.000Z',
    };

    expect(shouldSkipByCheckpoint('observations', 9, checkpoint)).toBe(true);
    expect(shouldSkipByCheckpoint('observations', 10, checkpoint)).toBe(true);
    expect(shouldSkipByCheckpoint('observations', 11, checkpoint)).toBe(false);
    expect(shouldSkipByCheckpoint('session_summaries', 4, checkpoint)).toBe(true);
    expect(shouldSkipByCheckpoint('session_summaries', 5, checkpoint)).toBe(false);
  });
});

describe('importObservation()', () => {
  it('creates a parent fact, child facts, and summarizes edges for structured observations', async () => {
    const store = makeStore();

    const result = await importObservation(makeObservation(), store, {
      dryRun: false,
      skipDedup: false,
      machineId: 'machine-a',
      projectOverride: null,
      sessionIdMap: new Map([['memory-session-1', 'claude-session-1']]),
      importedAt: '2026-03-11T12:00:00.000Z',
    });

    expect(result.status).toBe('imported');
    expect(store.addFact).toHaveBeenCalledTimes(3);
    expect(store.addEdge).toHaveBeenCalledTimes(2);
    expect(store.findImportedFactBySourceKey).toHaveBeenCalledWith('observations:42:parent');
    expect(store.findSimilarFact).toHaveBeenCalled();
  });

  it('skips rows that were already imported by source key', async () => {
    const store = makeStore();
    vi.mocked(store.findImportedFactBySourceKey).mockResolvedValue({
      id: 'fact-existing',
      scope: 'project:agentctl',
      content: 'existing',
      content_model: 'text-embedding-3-small',
      entity_type: 'decision',
      confidence: 0.95,
      strength: 1,
      source: {
        extraction_method: 'import',
        session_id: null,
        agent_id: null,
        machine_id: null,
        turn_index: null,
      },
      valid_from: '2026-03-11T12:00:00.000Z',
      valid_until: null,
      created_at: '2026-03-11T12:00:00.000Z',
      accessed_at: '2026-03-11T12:00:00.000Z',
    });

    const result = await importObservation(makeObservation(), store, {
      dryRun: false,
      skipDedup: false,
      machineId: null,
      projectOverride: null,
      sessionIdMap: new Map(),
      importedAt: '2026-03-11T12:00:00.000Z',
    });

    expect(result.status).toBe('skipped_existing');
    expect(store.addFact).not.toHaveBeenCalled();
    expect(store.addEdge).not.toHaveBeenCalled();
  });

  it('supports dry-run mode without writing to PostgreSQL', async () => {
    const store = makeStore();

    const result = await importObservation(makeObservation(), store, {
      dryRun: true,
      skipDedup: true,
      machineId: null,
      projectOverride: 'override-project',
      sessionIdMap: new Map(),
      importedAt: '2026-03-11T12:00:00.000Z',
    });

    expect(result.status).toBe('dry_run');
    expect(result.parentScope).toBe('project:override-project');
    expect(store.addFact).not.toHaveBeenCalled();
    expect(store.addEdge).not.toHaveBeenCalled();
  });
});
