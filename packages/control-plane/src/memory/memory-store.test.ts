import type { EntityType, FactSource, MemoryScope } from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';

import type { EmbeddingClient } from './embedding-client.js';
import { MemoryStore } from './memory-store.js';

function createMockEmbedding(): EmbeddingClient {
  return {
    embed: vi.fn().mockResolvedValue(Array.from({ length: 4 }, () => 0.1)),
    embedBatch: vi.fn().mockResolvedValue([Array.from({ length: 4 }, () => 0.1)]),
  } as unknown as EmbeddingClient;
}

function createMockPool() {
  const rows: Record<string, unknown>[] = [];
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: 0 }),
  };
}

describe('MemoryStore', () => {
  const logger = createMockLogger();

  function makeStore(poolOverrides?: Record<string, unknown>) {
    const pool = createMockPool();
    if (poolOverrides) {
      Object.assign(pool, poolOverrides);
    }
    const embedding = createMockEmbedding();
    const store = new MemoryStore({
      pool: pool as never,
      embeddingClient: embedding,
      logger,
    });
    return { store, pool, embedding };
  }

  it('generates an embedding and inserts a fact into the database', async () => {
    const { store, pool, embedding } = makeStore({
      // 1. INSERT fact; 2. SELECT pre-existing edges; 3. SELECT embedding (no rows → exits early)
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    });

    const result = await store.addFact({
      scope: 'global' as MemoryScope,
      content: 'Use Biome instead of ESLint',
      entity_type: 'decision' as EntityType,
      source: {
        session_id: null,
        agent_id: 'agent-1',
        machine_id: null,
        turn_index: null,
        extraction_method: 'manual',
      } satisfies FactSource,
    });

    expect(embedding.embed).toHaveBeenCalledWith('Use Biome instead of ESLint');
    // 3 calls: INSERT fact + SELECT edges + SELECT embedding
    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(result.scope).toBe('global');
    expect(result.content).toBe('Use Biome instead of ESLint');
    expect(result.source.agent_id).toBe('agent-1');
  });

  it('writes resolved provider model to content_model when using an embedding resolver', async () => {
    const pool = createMockPool();
    pool.query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const embedding = createMockEmbedding();
    const store = new MemoryStore({
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

    const result = await store.addFact({
      scope: 'global' as MemoryScope,
      content: 'Use provider-specific embedding metadata',
      entity_type: 'decision' as EntityType,
      source: {
        session_id: null,
        agent_id: 'agent-1',
        machine_id: null,
        turn_index: null,
        extraction_method: 'manual',
      } satisfies FactSource,
    });

    expect(result.content_model).toBe('gemini-embedding-001');
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO memory_facts'),
      expect.arrayContaining(['gemini-embedding-001']),
    );
  });

  it('links a new fact to supporting drawer offsets when source spans are provided', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { store } = makeStore({ query });

    const result = await store.addFact({
      scope: 'global' as MemoryScope,
      content: 'MemPalace facts point back to sanitized drawer spans',
      entity_type: 'decision' as EntityType,
      source: {
        session_id: null,
        agent_id: 'agent-1',
        machine_id: null,
        turn_index: null,
        extraction_method: 'manual',
      } satisfies FactSource,
      sourceSpans: [
        {
          drawerId: 'drawer-1',
          startOffset: 0,
          endOffset: 42,
          sourceJson: { extractor: 'unit-test' },
        },
        {
          drawerId: 'drawer-2',
          startOffset: 7,
          endOffset: 19,
        },
      ],
    });

    const sourceCalls = query.mock.calls.filter(([sql]) =>
      String(sql).includes('memory_fact_sources'),
    );
    expect(sourceCalls).toHaveLength(2);
    expect(sourceCalls[0]?.[1]).toEqual([
      expect.any(String),
      result.id,
      'drawer-1',
      0,
      42,
      { extractor: 'unit-test' },
      expect.any(String),
    ]);
    expect(sourceCalls[1]?.[1]).toEqual([
      expect.any(String),
      result.id,
      'drawer-2',
      7,
      19,
      {},
      expect.any(String),
    ]);
  });

  it('stores a fact even when embedding generation fails', async () => {
    const pool = createMockPool();
    // 1. INSERT fact; 2. SELECT pre-existing edges; 3. SELECT embedding (no rows → exits early)
    pool.query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const embedding = {
      embed: vi.fn().mockRejectedValue(new Error('API down')),
      embedBatch: vi.fn(),
    } as unknown as EmbeddingClient;
    const store = new MemoryStore({ pool: pool as never, embeddingClient: embedding, logger });

    const result = await store.addFact({
      scope: 'global' as MemoryScope,
      content: 'Some fact',
      entity_type: 'pattern' as EntityType,
      source: {
        session_id: null,
        agent_id: null,
        machine_id: null,
        turn_index: null,
        extraction_method: 'manual',
      },
    });

    expect(result.id).toBeTruthy();
    // 3 calls: INSERT fact + SELECT edges + SELECT embedding
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('rejects unsafe fact scopes before writing', async () => {
    const { store, pool } = makeStore();

    await expect(
      store.addFact({
        scope: '../global' as MemoryScope,
        content: 'Some fact',
        entity_type: 'pattern' as EntityType,
        source: {
          session_id: null,
          agent_id: null,
          machine_id: null,
          turn_index: null,
          extraction_method: 'manual',
        },
      }),
    ).rejects.toThrow('Invalid memory scope');

    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects unsafe fact-source drawer ids before writing', async () => {
    const { store, pool } = makeStore();

    await expect(
      store.addFact({
        scope: 'global' as MemoryScope,
        content: 'Some fact',
        entity_type: 'pattern' as EntityType,
        source: {
          session_id: null,
          agent_id: null,
          machine_id: null,
          turn_index: null,
          extraction_method: 'manual',
        },
        sourceSpans: [{ drawerId: '../drawer', startOffset: 0, endOffset: 5 }],
      }),
    ).rejects.toThrow('Invalid memory fact source span drawerId');

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('inserts an edge between two facts (non-contradiction)', async () => {
    const { store, pool } = makeStore({
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'edge-1' }], rowCount: 1 }),
    });

    const result = await store.addEdge({
      source_fact_id: 'fact-1',
      target_fact_id: 'fact-2',
      relation: 'related_to',
    });

    expect(result.source_fact_id).toBe('fact-1');
    expect(result.target_fact_id).toBe('fact-2');
    // Only 1 call for related_to edges (no consolidation item)
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it('returns a fact by id when found', async () => {
    const now = new Date().toISOString();
    const { store } = makeStore({
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'fact-1',
            scope: 'global',
            content: 'test',
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
          },
        ],
        rowCount: 1,
      }),
    });

    const result = await store.getFact('fact-1');

    expect(result?.id).toBe('fact-1');
    expect(result?.entity_type).toBe('pattern');
  });

  it('returns null when a fact does not exist', async () => {
    const { store } = makeStore({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    });

    await expect(store.getFact('missing')).resolves.toBeNull();
  });

  it('lists facts within explicit visible scopes', async () => {
    const now = new Date().toISOString();
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'fact-1',
          scope: 'agent:agent-1',
          content: 'agent fact',
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
        },
      ],
      rowCount: 1,
    });
    const { store } = makeStore({ query });

    const results = await store.listFacts({
      visibleScopes: ['agent:agent-1', 'global'],
      limit: 25,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('fact-1');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('scope IN ($1, $2)'), [
      'agent:agent-1',
      'global',
      25,
      0,
    ]);
  });

  it('rejects unsafe source filters before listing facts', async () => {
    const { store, pool } = makeStore();

    await expect(store.listFacts({ sessionId: '../session-1' })).rejects.toThrow(
      'Invalid memory session id',
    );

    expect(pool.query).not.toHaveBeenCalled();
  });

  it('lists fact source previews with archived markers', async () => {
    const createdAt = new Date().toISOString();
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          drawer_id: 'drawer-1',
          drawer_scope: 'global',
          drawer_topic: 'tooling',
          drawer_chunk_index: 0,
          drawer_source_type: 'manual',
          drawer_source_id: 'source-1',
          start_offset: 5,
          end_offset: 15,
          drawer_content: '01234abcdefghij67890',
          drawer_archived_at: null,
          created_at: createdAt,
        },
        {
          drawer_id: 'drawer-2',
          drawer_scope: 'global',
          drawer_topic: 'archived-tooling',
          drawer_chunk_index: 1,
          drawer_source_type: 'manual',
          drawer_source_id: 'source-2',
          start_offset: 0,
          end_offset: 10,
          drawer_content: 'should-not-show',
          drawer_archived_at: createdAt,
          created_at: createdAt,
        },
      ],
      rowCount: 2,
    });
    const { store } = makeStore({ query });

    const previews = await store.listFactSourcePreviews('fact-1');

    expect(previews).toEqual([
      {
        drawer_id: 'drawer-1',
        drawer_scope: 'global',
        drawer_topic: 'tooling',
        drawer_chunk_index: 0,
        drawer_source_type: 'manual',
        drawer_source_id: 'source-1',
        start_offset: 5,
        end_offset: 15,
        quote_preview: 'abcdefghij',
        status: 'available',
        created_at: createdAt,
      },
      {
        drawer_id: 'drawer-2',
        drawer_scope: 'global',
        drawer_topic: 'archived-tooling',
        drawer_chunk_index: 1,
        drawer_source_type: 'manual',
        drawer_source_id: 'source-2',
        start_offset: 0,
        end_offset: 10,
        quote_preview: null,
        status: 'archived',
        created_at: createdAt,
      },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM memory_fact_sources mfs'), [
      'fact-1',
    ]);
  });

  it('executes delete, strength update, and invalidation mutations', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const { store } = makeStore({ query });

    await store.deleteFact('fact-1');
    await store.updateStrength('fact-1', 0.75);
    await store.invalidateFact('fact-1');

    expect(query).toHaveBeenCalledTimes(3);
  });

  it('copies duplicate fact source spans onto a survivor fact without overwriting existing spans', async () => {
    const createdAt = '2026-04-22T00:00:00.000Z';
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            drawer_id: 'drawer-1',
            start_offset: 5,
            end_offset: 15,
            source_json: { source: 'duplicate-a' },
            created_at: createdAt,
          },
          {
            drawer_id: 'drawer-2',
            start_offset: 0,
            end_offset: 8,
            source_json: null,
            created_at: createdAt,
          },
        ],
        rowCount: 2,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { store } = makeStore({ query });

    const copied = await store.copyFactSourceSpansToFact({
      survivorFactId: 'fact-survivor',
      duplicateFactIds: [
        'fact-duplicate-a',
        'fact-duplicate-a',
        'fact-survivor',
        'fact-duplicate-b',
      ],
    });

    expect(copied).toBe(1);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]?.[0]).toContain('FROM memory_fact_sources');
    expect(query.mock.calls[0]?.[1]).toEqual([['fact-duplicate-a', 'fact-duplicate-b']]);
    expect(query.mock.calls[1]?.[0]).toContain('DO NOTHING');
    expect(query.mock.calls[1]?.[1]).toEqual([
      expect.any(String),
      'fact-survivor',
      'drawer-1',
      5,
      15,
      { source: 'duplicate-a' },
      createdAt,
    ]);
    expect(query.mock.calls[2]?.[1]).toEqual([
      expect.any(String),
      'fact-survivor',
      'drawer-2',
      0,
      8,
      {},
      createdAt,
    ]);
  });

  it('does not query source spans when there are no duplicate fact ids to copy', async () => {
    const query = vi.fn();
    const { store } = makeStore({ query });

    await expect(
      store.copyFactSourceSpansToFact({
        survivorFactId: 'fact-survivor',
        duplicateFactIds: ['', 'fact-survivor'],
      }),
    ).resolves.toBe(0);

    expect(query).not.toHaveBeenCalled();
  });

  it('merges duplicate facts by copying source spans before invalidating duplicates', async () => {
    const createdAt = '2026-04-23T00:00:00.000Z';
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            drawer_id: 'drawer-1',
            start_offset: 0,
            end_offset: 12,
            source_json: { source: 'duplicate' },
            created_at: createdAt,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { store } = makeStore({ query });

    const result = await store.mergeDuplicateFactsPreservingSources({
      survivorFactId: 'fact-survivor',
      duplicateFactIds: ['fact-duplicate', 'fact-duplicate', 'fact-survivor', 'fact-already-old'],
    });

    expect(result).toEqual({
      survivorFactId: 'fact-survivor',
      duplicateFactIds: ['fact-duplicate', 'fact-already-old'],
      copiedSourceSpans: 1,
      invalidatedFacts: 1,
    });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[0]?.[0]).toContain('FROM memory_fact_sources');
    expect(query.mock.calls[1]?.[0]).toContain('INSERT INTO memory_fact_sources');
    expect(query.mock.calls[2]?.[0]).toContain('UPDATE memory_facts SET valid_until = now()');
    expect(query.mock.calls[2]?.[1]).toEqual(['fact-duplicate']);
    expect(query.mock.calls[3]?.[1]).toEqual(['fact-already-old']);
  });

  it('updates a fact and regenerates embeddings when the content changes', async () => {
    const now = new Date().toISOString();
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'fact-1',
            scope: 'project:agentctl',
            content: 'Updated fact',
            content_model: 'text-embedding-3-small',
            entity_type: 'decision',
            confidence: 0.75,
            strength: 0.9,
            source_json: {},
            valid_from: now,
            valid_until: null,
            created_at: now,
            accessed_at: now,
            tags: [],
            usage_count: 0,
          },
        ],
        rowCount: 1,
      });
    const { store, embedding } = makeStore({ query });

    const result = await store.updateFact('fact-1', {
      content: 'Updated fact',
      entity_type: 'decision',
      confidence: 0.75,
    });

    expect(embedding.embed).toHaveBeenCalledWith('Updated fact');
    expect(query).toHaveBeenCalledTimes(2);
    expect(result?.content).toBe('Updated fact');
  });

  it('lists edges filtered by fact id and source id', async () => {
    const now = new Date().toISOString();
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'edge-1',
          source_fact_id: 'fact-1',
          target_fact_id: 'fact-2',
          relation: 'related_to',
          weight: 0.7,
          created_at: now,
        },
      ],
      rowCount: 1,
    });
    const { store } = makeStore({ query });

    const results = await store.listEdges({ factId: 'fact-1', sourceFactId: 'fact-1' });

    expect(results).toHaveLength(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('source_fact_id = $1'), [
      'fact-1',
      'fact-1',
    ]);
  });

  it('executes edge deletion mutations', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const { store } = makeStore({ query });

    await store.deleteEdge('edge-1');

    expect(query).toHaveBeenCalledWith('DELETE FROM memory_edges WHERE id = $1', ['edge-1']);
  });

  it('aggregates memory stats', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ total_facts: '12', new_this_week: '3', avg_confidence: '0.75' }],
      })
      .mockResolvedValueOnce({
        rows: [
          { key: 'global', count: '4' },
          { key: 'project:agentctl', count: '8' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { key: 'decision', count: '5' },
          { key: 'pattern', count: '7' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ active: '9', decaying: '2', archived: '1' }],
      })
      .mockResolvedValueOnce({
        rows: [
          { date: '2026-03-10', count: '1' },
          { date: '2026-03-11', count: '2' },
        ],
      });
    const { store } = makeStore({ query });

    const stats = await store.getStats();

    expect(stats).toEqual({
      totalFacts: 12,
      newThisWeek: 3,
      avgConfidence: 0.75,
      pendingConsolidation: 0,
      byScope: { global: 4, 'project:agentctl': 8 },
      byEntityType: { decision: 5, pattern: 7 },
      strengthDistribution: { active: 9, decaying: 2, archived: 1 },
      growthTrend: [
        { date: '2026-03-10', count: 1 },
        { date: '2026-03-11', count: 2 },
      ],
    });
  });

  it('resolves visible scopes from agent/project context', () => {
    const { store } = makeStore();

    expect(store.resolveVisibleScopes('agent:worker-1', 'project:agentctl')).toEqual([
      'agent:worker-1',
      'project:agentctl',
      'global',
    ]);
    expect(store.resolveVisibleScopes(undefined, 'project:agentctl')).toEqual([
      'project:agentctl',
      'global',
    ]);
    expect(store.resolveVisibleScopes(undefined, undefined)).toEqual(['global']);
  });

  // ── §3.6 Knowledge Engineering Tests ─────────────────────────────────────

  it('stores a fact with tags and includes them in the returned result', async () => {
    const { store, pool } = makeStore({
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // SELECT edges (contradiction detection)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // SELECT embedding (semantic detection → exits early)
    });

    const result = await store.addFact({
      scope: 'global' as MemoryScope,
      content: 'Security review checklist item',
      entity_type: 'pattern' as EntityType,
      source: {
        session_id: null,
        agent_id: null,
        machine_id: null,
        turn_index: null,
        extraction_method: 'manual',
      },
      tags: ['security-reviewer', 'code-reviewer'],
    });

    expect(result.tags).toEqual(['security-reviewer', 'code-reviewer']);
    // tags should be passed as $11 parameter in the INSERT (index 10, 0-based)
    const insertCall = vi.mocked(pool.query).mock.calls[0] as [string, unknown[]];
    const insertParams = insertCall[1];
    expect(insertParams[10]).toEqual(['security-reviewer', 'code-reviewer']);
  });

  it('defaults tags to empty array when not provided', async () => {
    const { store } = makeStore({
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // SELECT embedding → exits early
    });

    const result = await store.addFact({
      scope: 'global' as MemoryScope,
      content: 'Simple fact without tags',
      entity_type: 'pattern' as EntityType,
      source: {
        session_id: null,
        agent_id: null,
        machine_id: null,
        turn_index: null,
        extraction_method: 'manual',
      },
    });

    expect(result.tags).toEqual([]);
    expect(result.usage_count).toBe(0);
  });

  it('records used feedback: increments usage_count and boosts strength', async () => {
    const now = new Date().toISOString();
    const factRow = {
      id: 'fact-1',
      scope: 'global',
      content: 'test fact',
      content_model: 'text-embedding-3-small',
      entity_type: 'pattern',
      confidence: 0.9,
      strength: 0.8,
      source_json: {},
      valid_from: now,
      valid_until: null,
      created_at: now,
      accessed_at: now,
      tags: [],
      usage_count: 1,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE
      .mockResolvedValueOnce({ rows: [factRow], rowCount: 1 }); // getFact SELECT
    const { store } = makeStore({ query });

    const result = await store.recordFeedback('fact-1', 'used');

    expect(query).toHaveBeenCalledTimes(2);
    const updateCall = vi.mocked(query).mock.calls[0] as [string, unknown[]];
    expect(updateCall[0]).toContain('usage_count = usage_count + 1');
    expect(result?.id).toBe('fact-1');
  });

  it('records irrelevant feedback: decreases strength', async () => {
    const now = new Date().toISOString();
    const factRow = {
      id: 'fact-1',
      scope: 'global',
      content: 'test',
      content_model: 'text-embedding-3-small',
      entity_type: 'pattern',
      confidence: 0.9,
      strength: 0.7,
      source_json: {},
      valid_from: now,
      valid_until: null,
      created_at: now,
      accessed_at: now,
      tags: [],
      usage_count: 0,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE strength
      .mockResolvedValueOnce({ rows: [factRow], rowCount: 1 }); // getFact
    const { store } = makeStore({ query });

    await store.recordFeedback('fact-1', 'irrelevant');

    const updateCall = vi.mocked(query).mock.calls[0] as [string, unknown[]];
    expect(updateCall[0]).toContain('strength = GREATEST(0.0, strength - 0.1)');
  });

  it('records outdated feedback: decreases confidence and creates stale consolidation item', async () => {
    const now = new Date().toISOString();
    const factRow = {
      id: 'fact-1',
      scope: 'global',
      content: 'test',
      content_model: 'text-embedding-3-small',
      entity_type: 'pattern',
      confidence: 0.6,
      strength: 0.8,
      source_json: {},
      valid_from: now,
      valid_until: null,
      created_at: now,
      accessed_at: now,
      tags: [],
      usage_count: 0,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE confidence
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // addConsolidationItem INSERT
      .mockResolvedValueOnce({ rows: [factRow], rowCount: 1 }); // final getFact
    const { store } = makeStore({ query });

    const result = await store.recordFeedback('fact-1', 'outdated');

    const updateCall = vi.mocked(query).mock.calls[0] as [string, unknown[]];
    expect(updateCall[0]).toContain('confidence = GREATEST(0.0, confidence - 0.2)');
    // Should insert a consolidation item (second query call)
    const consolidationCall = vi.mocked(query).mock.calls[1] as [string, unknown[]];
    expect(consolidationCall[0]).toContain('memory_consolidation_items');
    expect(result).toBeDefined();
  });

  it('creates a contradiction consolidation item when a contradicts edge is added', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const { store } = makeStore({ query });

    const result = await store.addEdge({
      source_fact_id: 'fact-a',
      target_fact_id: 'fact-b',
      relation: 'contradicts',
    });

    expect(result.relation).toBe('contradicts');
    // 2 calls: INSERT edge + INSERT consolidation item
    expect(query).toHaveBeenCalledTimes(2);
    const consolidationCall = vi.mocked(query).mock.calls[1] as [string, unknown[]];
    expect(consolidationCall[0]).toContain('memory_consolidation_items');
    expect(consolidationCall[1]).toContain('contradiction');
    expect(consolidationCall[1]).toContain('high');
  });

  it('does NOT create a consolidation item for non-contradicts edges', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const { store } = makeStore({ query });

    await store.addEdge({
      source_fact_id: 'fact-a',
      target_fact_id: 'fact-b',
      relation: 'related_to',
    });

    // Only 1 call: the edge INSERT — no consolidation item
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('flags contradiction via detectAndFlagContradictions when adding a new fact with existing contradicts edge', async () => {
    const query = vi
      .fn()
      // 1. INSERT fact
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // 2. detectAndFlagContradictions: SELECT from memory_edges
      .mockResolvedValueOnce({
        rows: [{ source_fact_id: 'existing-fact', target_fact_id: 'new-fact-id' }],
        rowCount: 1,
      })
      // 3. addConsolidationItem INSERT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // 4. detectSemanticContradictions: SELECT embedding for new fact
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no embedding found → exits early

    const { store } = makeStore({ query });

    await store.addFact({
      scope: 'global' as MemoryScope,
      content: 'New fact that contradicts existing one',
      entity_type: 'decision' as EntityType,
      source: {
        session_id: null,
        agent_id: null,
        machine_id: null,
        turn_index: null,
        extraction_method: 'llm',
      },
    });

    // Should have: INSERT fact, SELECT edges, INSERT consolidation, SELECT embedding
    expect(query).toHaveBeenCalledTimes(4);
    const consolidationCall = vi.mocked(query).mock.calls[2] as [string, unknown[]];
    expect(consolidationCall[0]).toContain('memory_consolidation_items');
    expect(consolidationCall[1]).toContain('contradiction');
  });

  it('creates contradicts edge for semantically similar facts with different content', async () => {
    const query = vi
      .fn()
      // 1. INSERT fact
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // 2. detectAndFlagContradictions: SELECT pre-existing edges (none)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // 3. detectSemanticContradictions: SELECT embedding for new fact
      .mockResolvedValueOnce({
        rows: [{ content: 'New conflicting fact', embedding: '[0.1,0.2,0.3,0.4]' }],
        rowCount: 1,
      })
      // 4. detectSemanticContradictions: find similar facts
      .mockResolvedValueOnce({
        rows: [
          { id: 'similar-fact', content: 'Different but similar fact', cosine_similarity: 0.95 },
        ],
        rowCount: 1,
      })
      // 5. detectSemanticContradictions: check existing contradicts edge (none)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // 6. addEdge INSERT (contradicts relation)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // 7. addConsolidationItem INSERT (from addEdge for contradicts)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const { store } = makeStore({ query });

    await store.addFact({
      scope: 'global' as MemoryScope,
      content: 'New conflicting fact',
      entity_type: 'decision' as EntityType,
      source: {
        session_id: null,
        agent_id: null,
        machine_id: null,
        turn_index: null,
        extraction_method: 'llm',
      },
    });

    // Edge INSERT call should use 'contradicts' relation
    const edgeCall = vi.mocked(query).mock.calls[5] as [string, unknown[]];
    expect(edgeCall[0]).toContain('memory_edges');
    expect(edgeCall[1]).toContain('contradicts');
    // Consolidation item should be created
    const consolidationCall = vi.mocked(query).mock.calls[6] as [string, unknown[]];
    expect(consolidationCall[0]).toContain('memory_consolidation_items');
  });

  it('skips semantic contradiction detection when fact has no embedding', async () => {
    const query = vi
      .fn()
      // 1. INSERT fact
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      // 2. detectAndFlagContradictions: SELECT pre-existing edges (none)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // 3. detectSemanticContradictions: SELECT embedding — not found
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const { store } = makeStore({ query });

    await store.addFact({
      scope: 'global' as MemoryScope,
      content: 'Fact without embedding',
      entity_type: 'concept' as EntityType,
      source: {
        session_id: null,
        agent_id: null,
        machine_id: null,
        turn_index: null,
        extraction_method: 'manual',
      },
    });

    // Only 3 queries: INSERT, SELECT edges, SELECT embedding (exits early)
    expect(query).toHaveBeenCalledTimes(3);
  });
});
