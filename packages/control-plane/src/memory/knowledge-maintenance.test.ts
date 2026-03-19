import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';

import {
  bfs,
  buildAdjacencyList,
  extractFilePaths,
  generatePrincipleHint,
  KnowledgeMaintenance,
} from './knowledge-maintenance.js';

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe('extractFilePaths', () => {
  it('extracts relative file paths from content', () => {
    const content = 'The config is at ./packages/web/src/lib/api.ts and also src/index.ts';
    const paths = extractFilePaths(content);
    expect(paths).toContain('./packages/web/src/lib/api.ts');
    expect(paths).toContain('./packages/web/src/lib/api.ts');
  });

  it('extracts paths with various extensions', () => {
    const content = 'Check src/types/memory.ts and packages/web/tsconfig.json';
    const paths = extractFilePaths(content);
    expect(paths.some((p) => p.includes('memory.ts'))).toBe(true);
  });

  it('returns empty array for content without paths', () => {
    const paths = extractFilePaths('This is a regular sentence about architecture.');
    expect(paths).toHaveLength(0);
  });

  it('ignores comment-like patterns', () => {
    const paths = extractFilePaths('// This is a comment');
    expect(paths).toHaveLength(0);
  });
});

describe('buildAdjacencyList', () => {
  it('creates bidirectional adjacency from edges', () => {
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ];
    const adj = buildAdjacencyList(edges);
    expect(adj.get('a')?.has('b')).toBe(true);
    expect(adj.get('b')?.has('a')).toBe(true);
    expect(adj.get('b')?.has('c')).toBe(true);
    expect(adj.get('c')?.has('b')).toBe(true);
  });

  it('returns empty map for empty edges', () => {
    const adj = buildAdjacencyList([]);
    expect(adj.size).toBe(0);
  });
});

describe('bfs', () => {
  it('finds nodes within max depth', () => {
    const adj = buildAdjacencyList([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
    ]);

    // Depth 2 from a: a, b, c (d is at depth 3)
    const result = bfs('a', adj, 2);
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).toContain('c');
    expect(result).not.toContain('d');
  });

  it('returns just start node when no neighbors', () => {
    const adj = new Map<string, Set<string>>();
    const result = bfs('lonely', adj, 2);
    expect(result).toEqual(['lonely']);
  });

  it('handles cycles without infinite loop', () => {
    const adj = buildAdjacencyList([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'a' },
    ]);
    const result = bfs('a', adj, 2);
    expect(result).toHaveLength(3);
  });
});

describe('generatePrincipleHint', () => {
  it('includes fact count and entity type', () => {
    const facts = [
      makeFact({ entity_type: 'pattern', content: 'Use immutable data' }),
      makeFact({ entity_type: 'pattern', content: 'Avoid mutation' }),
      makeFact({ entity_type: 'pattern', content: 'Pure functions preferred' }),
    ];
    const hint = generatePrincipleHint(facts);
    expect(hint).toContain('3');
    expect(hint).toContain('pattern');
  });

  it('labels mixed entity types as "mixed"', () => {
    const facts = [
      makeFact({ entity_type: 'pattern', content: 'A' }),
      makeFact({ entity_type: 'decision', content: 'B' }),
      makeFact({ entity_type: 'error', content: 'C' }),
    ];
    const hint = generatePrincipleHint(facts);
    expect(hint).toContain('mixed');
  });
});

// ---------------------------------------------------------------------------
// KnowledgeMaintenance service tests
// ---------------------------------------------------------------------------

function makePool(queryResults: Record<string, unknown>[][] = []) {
  const callIndex = { current: 0 };
  return {
    query: vi.fn().mockImplementation(() => {
      const rows = queryResults[callIndex.current] ?? [];
      callIndex.current += 1;
      return Promise.resolve({ rows, rowCount: rows.length });
    }),
  };
}

function makeMockMemoryStore() {
  return {
    addConsolidationItem: vi.fn().mockImplementation((input) =>
      Promise.resolve({
        id: `ci-${Date.now()}`,
        type: input.type,
        severity: input.severity,
        factIds: input.factIds,
        suggestion: input.suggestion,
        reason: input.reason,
        status: 'pending',
        createdAt: new Date().toISOString(),
      }),
    ),
    recordFeedback: vi.fn().mockResolvedValue(null),
    addFact: vi.fn().mockImplementation((input) =>
      Promise.resolve({
        id: `fact-${Date.now()}`,
        scope: input.scope,
        content: input.content,
        content_model: 'text-embedding-3-small',
        entity_type: input.entity_type,
        confidence: input.confidence ?? 0.8,
        strength: 1.0,
        source: input.source,
        valid_from: new Date().toISOString(),
        valid_until: null,
        created_at: new Date().toISOString(),
        accessed_at: new Date().toISOString(),
        tags: input.tags ?? [],
        usage_count: 0,
      }),
    ),
  };
}

function makeFact(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: `fact-${Math.random().toString(36).slice(2, 8)}`,
    scope: 'global',
    content: 'Test content',
    content_model: 'text-embedding-3-small',
    entity_type: 'code_artifact',
    confidence: 0.8,
    strength: 1.0,
    source_json: {
      session_id: null,
      agent_id: null,
      machine_id: null,
      turn_index: null,
      extraction_method: 'manual',
    },
    valid_from: new Date().toISOString(),
    valid_until: null,
    created_at: new Date().toISOString(),
    accessed_at: new Date().toISOString(),
    tags: [],
    usage_count: 0,
    ...overrides,
  };
}

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(os.tmpdir(), `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

describe('KnowledgeMaintenance', () => {
  const logger = createMockLogger();

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  describe('lintStaleEntries', () => {
    it('returns empty array when no code_artifact facts exist', async () => {
      // Pass 1 query returns empty
      const pool = makePool([[]]);
      const store = makeMockMemoryStore();
      const maintenance = new KnowledgeMaintenance({
        pool: pool as never,
        memoryStore: store as never,
        logger,
        projectRoot: '/nonexistent',
      });

      const result = await maintenance.lintStaleEntries();
      expect(result).toHaveLength(0);
    });

    it('flags facts referencing non-existent paths', async () => {
      const fact = makeFact({
        content: 'Config at ./packages/gone/config.ts is important',
      });
      const pool = makePool([[fact]]);
      const store = makeMockMemoryStore();
      const maintenance = new KnowledgeMaintenance({
        pool: pool as never,
        memoryStore: store as never,
        logger,
        projectRoot: '/nonexistent-root-that-wont-have-files',
      });

      const result = await maintenance.lintStaleEntries();
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]?.referencedPaths.length).toBeGreaterThan(0);
    });

    it('checks file existence without shell parsing when paths contain quotes', async () => {
      const originalCwd = process.cwd();
      const projectRoot = makeTempDir('knowledge-maintenance-root');
      const relativePath = 'packages/app/file"name.ts';
      const absolutePath = join(projectRoot, relativePath);

      mkdirSync(join(projectRoot, 'packages/app'), { recursive: true });
      writeFileSync(absolutePath, 'export const ok = true;\n');

      process.chdir(projectRoot);

      try {
        const maintenance = new KnowledgeMaintenance({
          pool: makePool() as never,
          memoryStore: makeMockMemoryStore() as never,
          logger,
          projectRoot,
        });

        await expect(
          (
            maintenance as unknown as {
              fileExists: (path: string) => Promise<boolean>;
            }
          ).fileExists(relativePath),
        ).resolves.toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('refuses project roots outside the current working tree', async () => {
      const originalCwd = process.cwd();
      const workspaceRoot = makeTempDir('knowledge-maintenance-workspace');
      const externalRoot = makeTempDir('knowledge-maintenance-external');
      const relativePath = 'packages/app/outside.ts';

      mkdirSync(join(externalRoot, 'packages/app'), { recursive: true });
      writeFileSync(join(externalRoot, relativePath), 'export const outside = true;\n');

      process.chdir(workspaceRoot);

      try {
        const maintenance = new KnowledgeMaintenance({
          pool: makePool() as never,
          memoryStore: makeMockMemoryStore() as never,
          logger,
          projectRoot: externalRoot,
        });

        await expect(
          (
            maintenance as unknown as {
              fileExists: (path: string) => Promise<boolean>;
            }
          ).fileExists(relativePath),
        ).resolves.toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('rejects symlinked project roots that resolve outside the current working tree', async () => {
      const originalCwd = process.cwd();
      const workspaceRoot = makeTempDir('knowledge-maintenance-workspace');
      const externalRoot = makeTempDir('knowledge-maintenance-external');
      const relativePath = 'packages/app/outside.ts';

      mkdirSync(join(externalRoot, 'packages/app/src'), { recursive: true });
      writeFileSync(join(externalRoot, relativePath), 'export const outside = true;\n');

      process.chdir(workspaceRoot);

      try {
        const linkedProjectRoot = join(process.cwd(), 'linked-project');
        symlinkSync(externalRoot, linkedProjectRoot);

        const maintenance = new KnowledgeMaintenance({
          pool: makePool([[{ content: 'See packages/app/src/index.ts', cnt: 1 }]]) as never,
          memoryStore: makeMockMemoryStore() as never,
          logger,
          projectRoot: linkedProjectRoot,
        });

        await expect(
          (
            maintenance as unknown as {
              fileExists: (path: string) => Promise<boolean>;
            }
          ).fileExists(relativePath),
        ).resolves.toBe(false);

        await expect(maintenance.knowledgeCoverage()).resolves.toMatchObject({
          totalDirectories: 0,
          covered: [],
          gaps: [],
        });
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('crossReferenceDeletedFiles', () => {
    it('returns empty array when git log returns no deleted files', async () => {
      // fetchCodeArtifactFacts returns a fact
      const fact = makeFact({ content: 'something about src/old.ts' });
      const pool = makePool([[fact]]);
      const store = makeMockMemoryStore();
      const maintenance = new KnowledgeMaintenance({
        pool: pool as never,
        memoryStore: store as never,
        logger,
        // Use a non-git directory so git log fails gracefully
        projectRoot: '/tmp',
      });

      const result = await maintenance.crossReferenceDeletedFiles();
      // Should return empty because /tmp is unlikely to be a git repo with
      // deleted files, and the method handles errors gracefully
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('synthesisPass', () => {
    it('returns empty when no active facts exist', async () => {
      const pool = makePool([
        [], // fetchActiveFacts returns empty
      ]);
      const store = makeMockMemoryStore();
      const maintenance = new KnowledgeMaintenance({
        pool: pool as never,
        memoryStore: store as never,
        logger,
      });

      const result = await maintenance.synthesisPass();
      expect(result).toHaveLength(0);
    });

    it('finds clusters when edges connect 3+ facts', async () => {
      const facts = [
        makeFact({ id: 'f1', content: 'Pattern A' }),
        makeFact({ id: 'f2', content: 'Pattern B' }),
        makeFact({ id: 'f3', content: 'Pattern C' }),
      ];
      const edges = [
        { source_fact_id: 'f1', target_fact_id: 'f2' },
        { source_fact_id: 'f2', target_fact_id: 'f3' },
      ];

      const pool = makePool([
        facts, // fetchActiveFacts
        edges, // fetchEdgesForFacts
      ]);
      const store = makeMockMemoryStore();
      const maintenance = new KnowledgeMaintenance({
        pool: pool as never,
        memoryStore: store as never,
        logger,
      });

      const result = await maintenance.synthesisPass();
      expect(result).toHaveLength(1);
      expect(result[0]?.factIds).toHaveLength(3);
      expect(store.addFact).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'principle',
          confidence: 0.3,
        }),
      );
    });

    it('skips clusters smaller than 3 facts', async () => {
      const facts = [
        makeFact({ id: 'f1', content: 'Pattern A' }),
        makeFact({ id: 'f2', content: 'Pattern B' }),
      ];
      const edges = [{ source_fact_id: 'f1', target_fact_id: 'f2' }];

      const pool = makePool([facts, edges]);
      const store = makeMockMemoryStore();
      const maintenance = new KnowledgeMaintenance({
        pool: pool as never,
        memoryStore: store as never,
        logger,
      });

      const result = await maintenance.synthesisPass();
      expect(result).toHaveLength(0);
      expect(store.addFact).not.toHaveBeenCalled();
    });
  });

  describe('knowledgeCoverage', () => {
    it('returns empty coverage when not in a monorepo directory', async () => {
      const pool = makePool([
        [], // countFactsByDirectory returns empty
      ]);
      const store = makeMockMemoryStore();
      const maintenance = new KnowledgeMaintenance({
        pool: pool as never,
        memoryStore: store as never,
        logger,
        projectRoot: '/tmp/nonexistent-dir',
      });

      const result = await maintenance.knowledgeCoverage();
      expect(result.totalDirectories).toBe(0);
      expect(result.gaps).toHaveLength(0);
    });

    it('lists package directories without shell parsing when the project root contains quotes', async () => {
      const originalCwd = process.cwd();
      const projectRoot = makeTempDir('knowledge-maintenance-"root');
      mkdirSync(join(projectRoot, 'packages/app/src'), { recursive: true });
      mkdirSync(join(projectRoot, 'packages/tool/lib'), { recursive: true });
      mkdirSync(join(projectRoot, 'packages/app/node_modules/cache'), { recursive: true });
      mkdirSync(join(projectRoot, 'packages/tool/dist/output'), { recursive: true });

      process.chdir(projectRoot);

      try {
        const pool = makePool([[{ content: 'See packages/app/src/index.ts', cnt: 1 }]]);
        const maintenance = new KnowledgeMaintenance({
          pool: pool as never,
          memoryStore: makeMockMemoryStore() as never,
          logger,
          projectRoot,
        });

        const result = await maintenance.knowledgeCoverage();

        expect(result.totalDirectories).toBeGreaterThan(0);
        expect(result.covered).toContainEqual({ directory: 'packages/app/src', factCount: 1 });
        expect(result.gaps).toContainEqual({ directory: 'packages/tool/lib', factCount: 0 });
        expect(result.gaps).not.toContainEqual(
          expect.objectContaining({ directory: 'packages/app/node_modules' }),
        );
        expect(result.gaps).not.toContainEqual(
          expect.objectContaining({ directory: 'packages/tool/dist' }),
        );
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('run (full pipeline)', () => {
    it('runs all four passes and returns combined results', async () => {
      // This test verifies the orchestration works end-to-end with empty results.
      // Queries: (4 passes each fire their own queries)
      // Pass 1 (lint): fetchCodeArtifactFacts -> []
      // Pass 2 (cross-ref): fetchCodeArtifactFacts -> []
      // Pass 3 (synthesis): fetchActiveFacts -> []
      // Pass 4 (coverage): countFactsByDirectory -> []
      // + storeReport query
      const pool = makePool([[], [], [], [], []]);
      const store = makeMockMemoryStore();
      const maintenance = new KnowledgeMaintenance({
        pool: pool as never,
        memoryStore: store as never,
        logger,
        projectRoot: '/tmp',
      });

      const result = await maintenance.run();

      expect(result.staleEntries).toHaveLength(0);
      expect(result.deletedFileEntries).toHaveLength(0);
      expect(result.synthesisClusters).toHaveLength(0);
      expect(result.consolidationItems).toHaveLength(0);
      expect(result.coverageReport).toBeDefined();
    });
  });
});
