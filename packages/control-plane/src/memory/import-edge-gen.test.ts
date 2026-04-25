import { describe, expect, it, vi } from 'vitest';
import type { EdgeSourceData } from './import-edge-gen.js';
import {
  buildConceptEdges,
  buildJsonlSessionEdges,
  buildSessionEdges,
  computeConceptWeight,
  countSharedConcepts,
  generateImportEdges,
  pairKey,
  shareProjectComponent,
} from './import-edge-gen.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<EdgeSourceData> & { factId: string }): EdgeSourceData {
  return {
    sessionId: null,
    concepts: [],
    projectPath: null,
    ...overrides,
  };
}

function createMockPool(rowCount = 1) {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount }),
  };
}

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe('computeConceptWeight', () => {
  it('returns 0.2 for 1 shared concept', () => {
    expect(computeConceptWeight(1)).toBe(0.2);
  });

  it('returns 0.4 for 2 shared concepts', () => {
    expect(computeConceptWeight(2)).toBeCloseTo(0.4);
  });

  it('caps at 0.8 for 4 or more shared concepts', () => {
    expect(computeConceptWeight(4)).toBe(0.8);
    expect(computeConceptWeight(10)).toBe(0.8);
  });

  it('returns 0 for 0 shared concepts', () => {
    expect(computeConceptWeight(0)).toBe(0);
  });
});

describe('pairKey', () => {
  it('returns the same key regardless of argument order', () => {
    expect(pairKey('fact-a', 'fact-b')).toBe(pairKey('fact-b', 'fact-a'));
  });

  it('puts the lexicographically smaller id first', () => {
    const key = pairKey('zzz', 'aaa');
    expect(key).toBe('aaa::zzz');
  });
});

describe('countSharedConcepts', () => {
  it('counts exact matches', () => {
    expect(countSharedConcepts(['typescript', 'testing'], ['testing', 'vitest'])).toBe(1);
  });

  it('is case-insensitive', () => {
    expect(countSharedConcepts(['TypeScript'], ['typescript'])).toBe(1);
  });

  it('returns 0 when no overlap', () => {
    expect(countSharedConcepts(['alpha'], ['beta'])).toBe(0);
  });

  it('returns 0 for empty arrays', () => {
    expect(countSharedConcepts([], ['alpha'])).toBe(0);
    expect(countSharedConcepts(['alpha'], [])).toBe(0);
  });
});

describe('shareProjectComponent', () => {
  it('returns true when paths share a non-trivial component', () => {
    expect(shareProjectComponent('agentctl/packages/web', 'agentctl/packages/control-plane')).toBe(
      true,
    );
  });

  it('returns false when no shared components', () => {
    expect(shareProjectComponent('project-a/src', 'project-b/lib')).toBe(false);
  });

  it('returns false for null paths', () => {
    expect(shareProjectComponent(null, 'project/src')).toBe(false);
    expect(shareProjectComponent('project/src', null)).toBe(false);
    expect(shareProjectComponent(null, null)).toBe(false);
  });

  it('ignores trivially short components like single-character segments', () => {
    // Components must be > 2 chars to count; single chars like 'a' are ignored
    expect(shareProjectComponent('a/b', 'a/c')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildConceptEdges
// ---------------------------------------------------------------------------

describe('buildConceptEdges', () => {
  it('creates a related_to edge for two facts sharing a concept', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', concepts: ['typescript', 'testing'] }),
      makeItem({ factId: 'fact-b', concepts: ['testing', 'vitest'] }),
    ];

    const edgeMap = buildConceptEdges(items);
    expect(edgeMap.size).toBe(1);

    const [edge] = [...edgeMap.values()];
    expect(edge.relation).toBe('related_to');
    expect(edge.weight).toBeCloseTo(0.2);
  });

  it('accumulates weight for multiple shared concepts', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', concepts: ['alpha', 'beta', 'gamma'] }),
      makeItem({ factId: 'fact-b', concepts: ['alpha', 'beta', 'delta'] }),
    ];

    const edgeMap = buildConceptEdges(items);
    const [edge] = [...edgeMap.values()];
    // 2 shared concepts → weight 0.4
    expect(edge.weight).toBeCloseTo(0.4);
  });

  it('caps weight at 0.8 regardless of concept count', () => {
    const concepts = ['a', 'b', 'c', 'd', 'e', 'f'];
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', concepts }),
      makeItem({ factId: 'fact-b', concepts }),
    ];

    const edgeMap = buildConceptEdges(items);
    const [edge] = [...edgeMap.values()];
    expect(edge.weight).toBe(0.8);
  });

  it('creates no edge when there is no concept overlap', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', concepts: ['alpha'] }),
      makeItem({ factId: 'fact-b', concepts: ['beta'] }),
    ];

    const edgeMap = buildConceptEdges(items);
    expect(edgeMap.size).toBe(0);
  });

  it('creates no edge when facts have no concepts', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', concepts: [] }),
      makeItem({ factId: 'fact-b', concepts: [] }),
    ];

    const edgeMap = buildConceptEdges(items);
    expect(edgeMap.size).toBe(0);
  });

  it('creates N*(N-1)/2 edges for N facts all sharing a concept', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', concepts: ['shared'] }),
      makeItem({ factId: 'fact-b', concepts: ['shared'] }),
      makeItem({ factId: 'fact-c', concepts: ['shared'] }),
    ];

    const edgeMap = buildConceptEdges(items);
    // 3 pairs: (a,b), (a,c), (b,c)
    expect(edgeMap.size).toBe(3);
  });

  it('edge sourceFactId is lexicographically smaller than targetFactId', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'zzz-fact', concepts: ['shared'] }),
      makeItem({ factId: 'aaa-fact', concepts: ['shared'] }),
    ];

    const edgeMap = buildConceptEdges(items);
    const [edge] = [...edgeMap.values()];
    expect(edge.sourceFactId).toBe('aaa-fact');
    expect(edge.targetFactId).toBe('zzz-fact');
  });
});

// ---------------------------------------------------------------------------
// buildSessionEdges
// ---------------------------------------------------------------------------

describe('buildSessionEdges', () => {
  it('creates a weak edge for facts in the same session with no concept overlap', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', sessionId: 'sess-1' }),
      makeItem({ factId: 'fact-b', sessionId: 'sess-1' }),
    ];

    const edges = buildSessionEdges(items, new Set());
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(0.1);
    expect(edges[0].relation).toBe('related_to');
  });

  it('skips the pair when a concept edge already exists', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', sessionId: 'sess-1' }),
      makeItem({ factId: 'fact-b', sessionId: 'sess-1' }),
    ];

    const existingKey = pairKey('fact-a', 'fact-b');
    const edges = buildSessionEdges(items, new Set([existingKey]));
    expect(edges).toHaveLength(0);
  });

  it('creates no edges for facts in different sessions', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', sessionId: 'sess-1' }),
      makeItem({ factId: 'fact-b', sessionId: 'sess-2' }),
    ];

    const edges = buildSessionEdges(items, new Set());
    expect(edges).toHaveLength(0);
  });

  it('creates no edge when session has only one fact', () => {
    const items: EdgeSourceData[] = [makeItem({ factId: 'fact-a', sessionId: 'sess-1' })];

    const edges = buildSessionEdges(items, new Set());
    expect(edges).toHaveLength(0);
  });

  it('handles facts with null sessionId', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', sessionId: null }),
      makeItem({ factId: 'fact-b', sessionId: null }),
    ];

    const edges = buildSessionEdges(items, new Set());
    // null sessionId facts should not be grouped
    expect(edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildJsonlSessionEdges
// ---------------------------------------------------------------------------

describe('buildJsonlSessionEdges', () => {
  it('links first facts of consecutive sessions that share a project component', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', sessionId: 'sess-1', projectPath: 'agentctl/packages/web' }),
      makeItem({ factId: 'fact-b', sessionId: 'sess-1', projectPath: 'agentctl/packages/web' }),
      makeItem({
        factId: 'fact-c',
        sessionId: 'sess-2',
        projectPath: 'agentctl/packages/control-plane',
      }),
    ];

    const edges = buildJsonlSessionEdges(items);
    // sess-1 → sess-2 share 'agentctl' and 'packages'
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(0.05);
    expect(edges[0].relation).toBe('related_to');
  });

  it('does not link sessions that share no project component', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', sessionId: 'sess-1', projectPath: 'project-alpha/src' }),
      makeItem({ factId: 'fact-b', sessionId: 'sess-2', projectPath: 'project-beta/lib' }),
    ];

    const edges = buildJsonlSessionEdges(items);
    expect(edges).toHaveLength(0);
  });

  it('only uses the first fact of each session', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', sessionId: 'sess-1', projectPath: 'agentctl/packages' }),
      makeItem({ factId: 'fact-b', sessionId: 'sess-1', projectPath: 'agentctl/packages' }),
      makeItem({ factId: 'fact-c', sessionId: 'sess-2', projectPath: 'agentctl/packages' }),
    ];

    const edges = buildJsonlSessionEdges(items);
    expect(edges).toHaveLength(1);
    // fact-a is first in sess-1, fact-c is first in sess-2
    const edge = edges[0];
    expect([edge.sourceFactId, edge.targetFactId].sort()).toEqual(['fact-a', 'fact-c'].sort());
  });

  it('returns no edges for a single session', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', sessionId: 'sess-1', projectPath: 'agentctl' }),
    ];

    const edges = buildJsonlSessionEdges(items);
    expect(edges).toHaveLength(0);
  });

  it('returns no edges when items have no session ids', () => {
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', sessionId: null, projectPath: 'agentctl' }),
      makeItem({ factId: 'fact-b', sessionId: null, projectPath: 'agentctl' }),
    ];

    const edges = buildJsonlSessionEdges(items);
    expect(edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// generateImportEdges (integration: calls pool.query)
// ---------------------------------------------------------------------------

describe('generateImportEdges', () => {
  it('returns zero counts for an empty batch', async () => {
    const pool = createMockPool();
    const result = await generateImportEdges(pool as never, [], 'claude-mem');
    expect(result).toEqual({ conceptEdges: 0, sessionEdges: 0, inserted: 0 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('inserts concept edges for claude-mem mode', async () => {
    const pool = createMockPool(1);
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', concepts: ['typescript'], sessionId: 'sess-1' }),
      makeItem({ factId: 'fact-b', concepts: ['typescript'], sessionId: 'sess-1' }),
    ];

    const result = await generateImportEdges(pool as never, items, 'claude-mem');
    expect(result.conceptEdges).toBe(1);
    // session edge is skipped because concept edge already exists for this pair
    expect(result.sessionEdges).toBe(0);
    expect(result.inserted).toBe(1);

    // Verify parameterized query was used (no string interpolation)
    // Params: [id, sourceFactId, targetFactId, relation, weight]
    const [firstCall] = pool.query.mock.calls;
    expect(firstCall[0]).toContain('$1');
    expect(firstCall[1]).toHaveLength(5);
    expect(firstCall[1][3]).toBe('related_to'); // relation
    expect(typeof firstCall[1][4]).toBe('number'); // weight
  });

  it('creates a session-context edge when facts share session but not concepts', async () => {
    const pool = createMockPool(1);
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', concepts: ['alpha'], sessionId: 'sess-1' }),
      makeItem({ factId: 'fact-b', concepts: ['beta'], sessionId: 'sess-1' }),
    ];

    const result = await generateImportEdges(pool as never, items, 'claude-mem');
    expect(result.conceptEdges).toBe(0);
    expect(result.sessionEdges).toBe(1);
    expect(result.inserted).toBe(1);

    const [firstCall] = pool.query.mock.calls;
    // Confirm weight is the session context weight
    expect(firstCall[1][4]).toBe(0.1);
  });

  it('does not double-count when ON CONFLICT fires (rowCount = 0)', async () => {
    // Simulate DB reporting 0 rows inserted (conflict already existed)
    const pool = createMockPool(0);
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', concepts: ['shared'], sessionId: null }),
      makeItem({ factId: 'fact-b', concepts: ['shared'], sessionId: null }),
    ];

    const result = await generateImportEdges(pool as never, items, 'claude-mem');
    expect(result.conceptEdges).toBe(1);
    expect(result.inserted).toBe(0); // DB reported no rows inserted
  });

  it('uses jsonl mode and creates cross-session co-occurrence edges', async () => {
    const pool = createMockPool(1);
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', sessionId: 'sess-1', projectPath: 'agentctl/packages' }),
      makeItem({ factId: 'fact-c', sessionId: 'sess-2', projectPath: 'agentctl/packages' }),
    ];

    const result = await generateImportEdges(pool as never, items, 'jsonl');
    expect(result.conceptEdges).toBe(0);
    expect(result.sessionEdges).toBe(1);
    expect(result.inserted).toBe(1);

    const [firstCall] = pool.query.mock.calls;
    expect(firstCall[1][4]).toBe(0.05); // JSONL weight
  });

  it('is idempotent: ON CONFLICT DO NOTHING is in the SQL', async () => {
    const pool = createMockPool(1);
    const items: EdgeSourceData[] = [
      makeItem({ factId: 'fact-a', concepts: ['typescript'] }),
      makeItem({ factId: 'fact-b', concepts: ['typescript'] }),
    ];

    await generateImportEdges(pool as never, items, 'claude-mem');

    // Verify that ON CONFLICT DO NOTHING is part of the query
    const [firstCall] = pool.query.mock.calls;
    expect(firstCall[0]).toMatch(/ON CONFLICT.*DO NOTHING/i);
  });
});
