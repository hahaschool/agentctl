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

  it('executes delete, strength update, and invalidation mutations', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const { store } = makeStore({ query });

    await store.deleteFact('fact-1');
    await store.updateStrength('fact-1', 0.75);
    await store.invalidateFact('fact-1');

    expect(query).toHaveBeenCalledTimes(3);
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
