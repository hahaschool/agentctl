import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';

import { KnowledgeSynthesis } from './knowledge-synthesis.js';

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

describe('KnowledgeSynthesis', () => {
  const logger = createMockLogger();

  it('returns empty results when there are no facts', async () => {
    // runSynthesis runs lint (3 queries: near-dups, stale, orphans)
    // + buildSynthesisGroups (1 query)
    const pool = makePool([[], [], [], []]);
    const synthesis = new KnowledgeSynthesis({ pool: pool as never, logger });

    const result = await synthesis.runSynthesis();

    expect(result.lint.nearDuplicates).toHaveLength(0);
    expect(result.lint.staleFacts).toHaveLength(0);
    expect(result.lint.orphanFacts).toHaveLength(0);
    expect(result.synthesisGroups).toHaveLength(0);
  });

  it('returns near-duplicate candidates when similar facts exist', async () => {
    const nearDupRow = {
      fact_id_a: 'fact-1',
      fact_id_b: 'fact-2',
      similarity: 0.87,
      content_a: 'Use TypeScript for type safety',
      content_b: 'TypeScript provides type safety',
    };
    // near-dups query returns 1 row; stale + orphan + synthesis return empty
    const pool = makePool([[nearDupRow], [], [], []]);
    const synthesis = new KnowledgeSynthesis({ pool: pool as never, logger });

    const result = await synthesis.runSynthesis();

    expect(result.lint.nearDuplicates).toHaveLength(1);
    const dup = result.lint.nearDuplicates[0];
    expect(dup?.factIdA).toBe('fact-1');
    expect(dup?.factIdB).toBe('fact-2');
    expect(dup?.similarity).toBe(0.87);
  });

  it('returns stale fact candidates not accessed in 30 days', async () => {
    const staleRow = {
      fact_id: 'stale-fact',
      content: 'An old architectural decision',
      days_since_access: 45,
    };
    // near-dups empty; stale returns 1 row; orphan + synthesis empty
    const pool = makePool([[], [staleRow], [], []]);
    const synthesis = new KnowledgeSynthesis({ pool: pool as never, logger });

    const result = await synthesis.runSynthesis();

    expect(result.lint.staleFacts).toHaveLength(1);
    const stale = result.lint.staleFacts[0];
    expect(stale?.factId).toBe('stale-fact');
    expect(stale?.lastAccessedDaysAgo).toBe(45);
  });

  it('returns orphan facts with no edges', async () => {
    const orphanRow = {
      fact_id: 'orphan-fact',
      content: 'An isolated decision',
      entity_type: 'decision',
      created_at: new Date('2026-01-01'),
    };
    // near-dups + stale empty; orphan returns 1 row; synthesis empty
    const pool = makePool([[], [], [orphanRow], []]);
    const synthesis = new KnowledgeSynthesis({ pool: pool as never, logger });

    const result = await synthesis.runSynthesis();

    expect(result.lint.orphanFacts).toHaveLength(1);
    const orphan = result.lint.orphanFacts[0];
    expect(orphan?.factId).toBe('orphan-fact');
    expect(orphan?.entityType).toBe('decision');
  });

  it('returns synthesis groups for entity types with enough facts', async () => {
    const groupRow = {
      entity_type: 'decision',
      fact_ids: ['fact-1', 'fact-2', 'fact-3'],
      fact_contents: ['Decision A', 'Decision B', 'Decision C'],
      fact_count: 3,
    };
    // near-dups + stale + orphan empty; synthesis returns 1 group
    const pool = makePool([[], [], [], [groupRow]]);
    const synthesis = new KnowledgeSynthesis({ pool: pool as never, logger });

    const result = await synthesis.runSynthesis();

    expect(result.synthesisGroups).toHaveLength(1);
    const group = result.synthesisGroups[0];
    expect(group?.entityType).toBe('decision');
    expect(group?.factIds).toEqual(['fact-1', 'fact-2', 'fact-3']);
    expect(group?.proposalHint).toContain('decision');
  });

  it('filters results by scope when a scope is provided', async () => {
    const pool = makePool([[], [], [], []]);
    const synthesis = new KnowledgeSynthesis({ pool: pool as never, logger });

    await synthesis.runSynthesis('project:agentctl');

    // All 4 queries should include a scope parameter
    expect(pool.query).toHaveBeenCalledTimes(4);
    const calls = vi.mocked(pool.query).mock.calls as [string, unknown[]][];
    for (const [, params] of calls) {
      expect(params).toContain('project:agentctl');
    }
  });
});
