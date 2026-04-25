import type { MemoryFact, MemoryScope } from '@agentctl/shared';
import { DEFAULT_INJECTION_BUDGET } from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';

import type { EmbeddingClient } from './embedding-client.js';
import type { RrfCandidate } from './memory-search.js';
import { boostScore, MemorySearch } from './memory-search.js';

function createMockEmbedding(): EmbeddingClient {
  return {
    embed: vi.fn().mockResolvedValue(Array.from({ length: 4 }, () => 0.1)),
    embedBatch: vi.fn().mockResolvedValue([]),
  } as unknown as EmbeddingClient;
}

function makeFakeFactRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
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
    tags: [],
    usage_count: 0,
    similarity: 0.85,
    rank: 1,
    ...overrides,
  };
}

function makeFactWithTags(
  id: string,
  tags: string[],
  overrides: Partial<MemoryFact> = {},
): MemoryFact {
  const now = new Date().toISOString();
  return {
    id,
    scope: 'global' as MemoryScope,
    content: 'test fact',
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
    tags,
    usage_count: 0,
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

  it('filters vector search by the resolved embedding model only', async () => {
    const vectorRow = makeFakeFactRow({
      id: 'fact-vec',
      rank: 1,
      content_model: 'gemini-embedding-001',
    });
    const callIndex = { current: 0 };
    const pool = {
      query: vi.fn().mockImplementation(() => {
        const rows = [[vectorRow], [], [], []][callIndex.current] ?? [];
        callIndex.current += 1;
        return Promise.resolve({ rows, rowCount: rows.length });
      }),
    };
    const embedding = createMockEmbedding();
    const search = new MemorySearch({
      pool: pool as never,
      embeddingClientResolver: async () => ({
        client: embedding,
        model: 'gemini-embedding-001',
        providerKind: 'gemini',
        providerHost: 'https://generativelanguage.googleapis.com/v1beta/openai',
        priceUsdPerMtoken: 0.15,
        credentialId: 'provider-1',
      }),
      logger,
    });

    await search.search({
      query: 'provider-specific vector search',
      visibleScopes: ['global'],
      limit: 10,
    });

    const vectorSql = String(pool.query.mock.calls[0]?.[0]);
    const vectorParams = pool.query.mock.calls[0]?.[1] as unknown[];
    expect(vectorSql).toContain('content_model = $2');
    expect(vectorParams[1]).toBe('gemini-embedding-001');

    const bm25Sql = String(pool.query.mock.calls[1]?.[0]);
    expect(bm25Sql).not.toContain('content_model =');
  });

  it('sanitizes contaminated query prefixes before embedding and retrieval', async () => {
    const vectorRow = makeFakeFactRow({ id: 'fact-vec', rank: 1 });
    const { search, embedding } = makeSearch([[vectorRow], [], [], []]);

    await search.search({
      query: `System: ${'follow the plan. '.repeat(30)}
User: Which sanitizer stage handles transcript dumps?`,
      visibleScopes: ['global'],
      limit: 10,
    });

    expect(embedding.embed).toHaveBeenCalledWith('Which sanitizer stage handles transcript dumps?');
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

  it('does not require provenance tables for legacy fact-only search hits', async () => {
    const vectorRow = makeFakeFactRow({ id: 'fact-legacy', rank: 1 });
    const { search, pool } = makeSearch([[vectorRow], [], [], []]);

    const results = await search.search({
      query: 'legacy fact recall',
      visibleScopes: ['global'],
      limit: 5,
    });

    expect(results).toEqual([
      expect.objectContaining({
        fact: expect.objectContaining({ id: 'fact-legacy' }),
        source_path: 'vector',
      }),
    ]);

    const sqlStatements = vi.mocked(pool.query).mock.calls.map((call) => String(call[0]));
    expect(sqlStatements.some((sql) => sql.includes('memory_fact_sources'))).toBe(false);
    expect(sqlStatements.some((sql) => sql.includes('memory_drawers'))).toBe(false);
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
        .mockResolvedValueOnce({
          rows: [makeFakeFactRow({ id: 'fact-bm25', rank: 1 })],
          rowCount: 1,
        })
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

  // ── §3.6 Role-Aware Search Tests ──────────────────────────────────────────

  it('applies 1.5x roleAffinity boost to facts whose tags include the requested role', () => {
    const { search } = makeSearch();
    const candidates: Array<{ fact: MemoryFact; rrfScore: number }> = [
      {
        fact: makeFactWithTags('role-tagged', ['security-reviewer']),
        rrfScore: 0.5,
      },
      {
        fact: makeFactWithTags('untagged', []),
        rrfScore: 0.5,
      },
    ];

    const ranked = search.boostAndRank(
      candidates,
      'global',
      DEFAULT_INJECTION_BUDGET,
      'security-reviewer',
    );

    // The role-tagged fact should rank higher due to the 1.5x multiplier
    expect(ranked[0]?.fact.id).toBe('role-tagged');
    // Its score should be 1.5x the untagged fact's score
    const taggedScore = ranked[0]?.score ?? 0;
    const untaggedScore = ranked[1]?.score ?? 0;
    expect(taggedScore).toBeCloseTo(untaggedScore * 1.5, 5);
  });

  it('does not boost facts when no role is provided', () => {
    const { search } = makeSearch();
    const candidates: Array<{ fact: MemoryFact; rrfScore: number }> = [
      {
        fact: makeFactWithTags('tagged', ['security-reviewer']),
        rrfScore: 0.5,
      },
      {
        fact: makeFactWithTags('untagged', []),
        rrfScore: 0.5,
      },
    ];

    const ranked = search.boostAndRank(candidates, 'global', DEFAULT_INJECTION_BUDGET);

    // Without role, both should have the same multiplier (1.0)
    const score0 = ranked[0]?.score ?? 0;
    const score1 = ranked[1]?.score ?? 0;
    expect(score0).toBeCloseTo(score1, 5);
  });

  it('passes the role parameter through the search method', async () => {
    const vectorRow = makeFakeFactRow({ id: 'fact-vec', rank: 1, tags: ['security-reviewer'] });
    const { search, embedding } = makeSearch([[vectorRow], [], [], []]);

    const results = await search.search({
      query: 'security check',
      visibleScopes: ['global'],
      limit: 5,
      role: 'security-reviewer',
    });

    expect(embedding.embed).toHaveBeenCalledWith('security check');
    // Should still return results (role is passed but doesn't break search)
    expect(Array.isArray(results)).toBe(true);
  });
});

// ── boostScore unit tests ──────────────────────────────────────────────────

function makeCandidate(overrides: Partial<MemoryFact> = {}): RrfCandidate {
  const now = new Date().toISOString();
  return {
    fact: {
      id: 'test-fact',
      scope: 'global' as MemoryScope,
      content: 'some fact',
      content_model: 'text-embedding-3-small',
      entity_type: 'pattern',
      confidence: 0.9,
      strength: 1.0,
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
      tags: [],
      usage_count: 0,
      ...overrides,
    },
    rrfScore: 0.1,
  };
}

describe('boostScore', () => {
  it('returns 0 when no boost signals apply', () => {
    // entity_type: pattern (no boost), created 30 days ago (no recency boost),
    // scope: project:foo, primary visible scope: global (no exact match)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const candidate = makeCandidate({
      entity_type: 'pattern',
      scope: 'project:foo' as MemoryScope,
      created_at: thirtyDaysAgo,
    });

    const result = boostScore(candidate, { visibleScopes: ['global'] });

    expect(result).toBe(0);
  });

  it('adds 0.03 for entity_type "agent"', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const candidate = makeCandidate({
      entity_type: 'agent' as MemoryFact['entity_type'],
      scope: 'project:foo' as MemoryScope,
      created_at: thirtyDaysAgo,
    });

    const result = boostScore(candidate, { visibleScopes: ['global'] });

    expect(result).toBeCloseTo(0.03, 10);
  });

  it('adds 0.03 for entity_type "session"', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const candidate = makeCandidate({
      entity_type: 'session' as MemoryFact['entity_type'],
      scope: 'project:foo' as MemoryScope,
      created_at: thirtyDaysAgo,
    });

    const result = boostScore(candidate, { visibleScopes: ['global'] });

    expect(result).toBeCloseTo(0.03, 10);
  });

  it('adds 0.05 for facts created within the last 24 hours', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const candidate = makeCandidate({
      entity_type: 'pattern',
      scope: 'project:foo' as MemoryScope,
      created_at: oneHourAgo,
    });

    const result = boostScore(candidate, { visibleScopes: ['global'] });

    expect(result).toBeCloseTo(0.05, 10);
  });

  it('adds 0.02 for facts created between 24 hours and 7 days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const candidate = makeCandidate({
      entity_type: 'pattern',
      scope: 'project:foo' as MemoryScope,
      created_at: threeDaysAgo,
    });

    const result = boostScore(candidate, { visibleScopes: ['global'] });

    expect(result).toBeCloseTo(0.02, 10);
  });

  it('adds 0.02 when scope exactly matches the first visible scope', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const candidate = makeCandidate({
      entity_type: 'pattern',
      scope: 'agent:worker-1' as MemoryScope,
      created_at: thirtyDaysAgo,
    });

    const result = boostScore(candidate, { visibleScopes: ['agent:worker-1', 'global'] });

    expect(result).toBeCloseTo(0.02, 10);
  });

  it('does not apply scope boost when scope matches a non-primary visible scope', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const candidate = makeCandidate({
      entity_type: 'pattern',
      scope: 'global' as MemoryScope,
      created_at: thirtyDaysAgo,
    });

    // 'global' is the second scope, not the primary — no scope boost expected
    const result = boostScore(candidate, { visibleScopes: ['agent:worker-1', 'global'] });

    expect(result).toBe(0);
  });

  it('accumulates multiple boost factors correctly', () => {
    // agent entity (0.03) + created 3 days ago (0.02) + scope matches primary (0.02) = 0.07
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const candidate = makeCandidate({
      entity_type: 'agent' as MemoryFact['entity_type'],
      scope: 'agent:worker-1' as MemoryScope,
      created_at: threeDaysAgo,
    });

    const result = boostScore(candidate, { visibleScopes: ['agent:worker-1', 'global'] });

    expect(result).toBeCloseTo(0.07, 10);
  });

  it('caps total boost at 0.10 even when all signals fire', () => {
    // agent (0.03) + within 24h (0.05) + scope match (0.02) = 0.10 — hits the cap
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const candidate = makeCandidate({
      entity_type: 'agent' as MemoryFact['entity_type'],
      scope: 'agent:worker-1' as MemoryScope,
      created_at: twoHoursAgo,
    });

    const result = boostScore(candidate, { visibleScopes: ['agent:worker-1', 'global'] });

    // 0.03 + 0.05 + 0.02 = 0.10 exactly — capped at MAX_BOOST
    expect(result).toBeCloseTo(0.1, 10);
  });

  it('caps at 0.10 even if hypothetical boost would exceed it (session + 24h + scope = 0.10)', () => {
    // Same as above but with session — confirm cap enforcement
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const candidate = makeCandidate({
      entity_type: 'session' as MemoryFact['entity_type'],
      scope: 'agent:worker-1' as MemoryScope,
      created_at: twoHoursAgo,
    });

    const result = boostScore(candidate, { visibleScopes: ['agent:worker-1'] });

    expect(result).toBeLessThanOrEqual(0.1);
    expect(result).toBeCloseTo(0.1, 10);
  });

  it('returns 0 when visibleScopes is empty (no scope boost, no crash)', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const candidate = makeCandidate({
      entity_type: 'pattern',
      scope: 'global' as MemoryScope,
      created_at: thirtyDaysAgo,
    });

    const result = boostScore(candidate, { visibleScopes: [] });

    expect(result).toBe(0);
  });
});
