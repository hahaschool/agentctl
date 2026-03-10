import type { MemoryFact, MemoryScope } from '@agentctl/shared';
import { DEFAULT_INJECTION_BUDGET } from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';

import type { EmbeddingClient } from './embedding-client.js';
import { MemorySearch } from './memory-search.js';

function createMockEmbedding(): EmbeddingClient {
  return {
    embed: vi.fn().mockResolvedValue(Array.from({ length: 4 }, () => 0.1)),
    embedBatch: vi.fn().mockResolvedValue([]),
  } as unknown as EmbeddingClient;
}

function makeFakeFactRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: 'fact-1',
    scope: 'global',
    content: 'Use Biome for linting',
    content_model: 'text-embedding-3-small',
    entity_type: 'pattern',
    confidence: 0.9,
    strength: 1.0,
    source_json: {},
    valid_from: now,
    valid_until: null,
    created_at: now,
    accessed_at: now,
    similarity: 0.85,
    rank: 1,
    ...overrides,
  };
}

describe('MemorySearch', () => {
  const logger = createMockLogger();

  function makeSearch(queryResults: Record<string, unknown>[][] = []) {
    const callIndex = { current: 0 };
    const pool = {
      query: vi.fn().mockImplementation(() => {
        const rows = queryResults[callIndex.current] ?? [];
        callIndex.current += 1;
        return Promise.resolve({ rows, rowCount: rows.length });
      }),
    };
    const embedding = createMockEmbedding();
    const search = new MemorySearch({
      pool: pool as never,
      embeddingClient: embedding,
      logger,
    });
    return { search, pool, embedding };
  }

  it('embeds the query and returns fused results', async () => {
    const vectorRow = makeFakeFactRow({ id: 'fact-vec', rank: 1 });
    const bm25Row = makeFakeFactRow({ id: 'fact-bm25', rank: 1 });
    const graphSeedRow = { id: 'fact-seed' };
    const graphFactRow = makeFakeFactRow({ id: 'fact-graph', rank: 1 });

    const { search, embedding } = makeSearch([
      [vectorRow],
      [bm25Row],
      [graphSeedRow],
      [{ target_fact_id: 'fact-graph' }],
      [graphFactRow],
      [],
    ]);

    const results = await search.search({
      query: 'linting tool',
      visibleScopes: ['global'],
      limit: 10,
    });

    expect(embedding.embed).toHaveBeenCalledWith('linting tool');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.fact.id).toBeDefined();
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it('returns an empty array when no retrieval path produces results', async () => {
    const { search } = makeSearch([[], [], [], []]);

    await expect(
      search.search({
        query: 'nonexistent topic',
        visibleScopes: ['global'],
        limit: 10,
      }),
    ).resolves.toEqual([]);
  });

  it('filters queries by visible scopes', async () => {
    const { search, pool } = makeSearch([[], [], [], []]);

    await search.search({
      query: 'test',
      visibleScopes: ['agent:worker-1', 'project:agentctl', 'global'],
      limit: 5,
    });

    const [sql] = vi.mocked(pool.query).mock.calls[0] as [string];
    expect(sql).toContain('scope IN');
  });

  it('falls back to BM25 and graph search when embedding generation fails', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [makeFakeFactRow({ id: 'fact-bm25', rank: 1 })], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };
    const embedding = {
      embed: vi.fn().mockRejectedValue(new Error('API down')),
      embedBatch: vi.fn(),
    } as unknown as EmbeddingClient;
    const search = new MemorySearch({
      pool: pool as never,
      embeddingClient: embedding,
      logger,
    });

    const results = await search.search({
      query: 'test',
      visibleScopes: ['global'],
      limit: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.fact.id).toBe('fact-bm25');
  });

  it('applies scope proximity boost during ranking', () => {
    const { search } = makeSearch();
    const now = new Date().toISOString();
    const candidates: Array<{ fact: MemoryFact; rrfScore: number }> = [
      {
        fact: {
          id: 'f1',
          scope: 'agent:w1' as MemoryScope,
          content: 'a',
          content_model: 'm',
          entity_type: 'pattern',
          confidence: 0.9,
          strength: 1,
          source: {
            session_id: null,
            agent_id: null,
            machine_id: null,
            turn_index: null,
            extraction_method: 'manual',
          },
          valid_from: now,
          valid_until: null,
          created_at: now,
          accessed_at: now,
        },
        rrfScore: 0.5,
      },
      {
        fact: {
          id: 'f2',
          scope: 'global' as MemoryScope,
          content: 'b',
          content_model: 'm',
          entity_type: 'pattern',
          confidence: 0.9,
          strength: 1,
          source: {
            session_id: null,
            agent_id: null,
            machine_id: null,
            turn_index: null,
            extraction_method: 'manual',
          },
          valid_from: now,
          valid_until: null,
          created_at: now,
          accessed_at: now,
        },
        rrfScore: 0.5,
      },
    ];

    const ranked = search.boostAndRank(candidates, 'agent:w1', DEFAULT_INJECTION_BUDGET);
    expect(ranked[0]?.fact.id).toBe('f1');
  });
});
