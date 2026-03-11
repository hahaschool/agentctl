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
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'fact-1' }], rowCount: 1 }),
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
    expect(pool.query).toHaveBeenCalledOnce();
    expect(result.scope).toBe('global');
    expect(result.content).toBe('Use Biome instead of ESLint');
    expect(result.source.agent_id).toBe('agent-1');
  });

  it('stores a fact even when embedding generation fails', async () => {
    const pool = createMockPool();
    pool.query = vi.fn().mockResolvedValue({ rows: [{ id: 'fact-2' }], rowCount: 1 });
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
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it('inserts an edge between two facts', async () => {
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

  it('executes delete, strength update, and invalidation mutations', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const { store } = makeStore({ query });

    await store.deleteFact('fact-1');
    await store.updateStrength('fact-1', 0.75);
    await store.invalidateFact('fact-1');

    expect(query).toHaveBeenCalledTimes(3);
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
      .mockResolvedValueOnce({ rows: [{ total_facts: '12', new_this_week: '3', avg_confidence: '0.75' }] })
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
});
