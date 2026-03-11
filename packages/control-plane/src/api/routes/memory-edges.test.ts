import type { MemoryEdge, MemoryFact } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemorySearch } from '../../memory/memory-search.js';
import type { MemoryStore } from '../../memory/memory-store.js';
import { createServer } from '../server.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'fact-1',
    scope: 'project:agentctl',
    content: 'Fact node',
    content_model: 'text-embedding-3-small',
    entity_type: 'concept',
    confidence: 0.8,
    strength: 0.7,
    source: {
      session_id: 'session-1',
      agent_id: 'agent-1',
      machine_id: 'machine-1',
      turn_index: 1,
      extraction_method: 'manual',
    },
    valid_from: '2026-03-11T10:00:00.000Z',
    valid_until: null,
    created_at: '2026-03-11T10:00:00.000Z',
    accessed_at: '2026-03-11T10:00:00.000Z',
    ...overrides,
  };
}

function makeEdge(overrides: Partial<MemoryEdge> = {}): MemoryEdge {
  return {
    id: 'edge-1',
    source_fact_id: 'fact-1',
    target_fact_id: 'fact-2',
    relation: 'depends_on',
    weight: 0.5,
    created_at: '2026-03-11T10:00:00.000Z',
    ...overrides,
  };
}

function createMockMemorySearch(overrides: Partial<MemorySearch> = {}): MemorySearch {
  return {
    search: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as MemorySearch;
}

function createMockMemoryStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    addFact: vi.fn(),
    listFacts: vi.fn().mockResolvedValue([]),
    deleteFact: vi.fn().mockResolvedValue(undefined),
    getFact: vi.fn().mockResolvedValue(null),
    updateFact: vi.fn().mockResolvedValue(null),
    invalidateFact: vi.fn().mockResolvedValue(undefined),
    listEdges: vi.fn().mockResolvedValue([]),
    addEdge: vi.fn(),
    deleteEdge: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore;
}

describe('memory edge routes', () => {
  let app: FastifyInstance;
  let memoryStore: MemoryStore;

  beforeEach(async () => {
    memoryStore = createMockMemoryStore();
    app = await createServer({
      logger,
      memorySearch: createMockMemorySearch(),
      memoryStore,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists edges', async () => {
    vi.mocked(memoryStore.listEdges).mockResolvedValueOnce([makeEdge()]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/edges?sourceFactId=fact-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, edges: [makeEdge()] });
    expect(memoryStore.listEdges).toHaveBeenCalledWith({ sourceFactId: 'fact-1' });
  });

  it('creates an edge', async () => {
    vi.mocked(memoryStore.addEdge).mockResolvedValueOnce(makeEdge());

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/edges',
      payload: {
        sourceFactId: 'fact-1',
        targetFactId: 'fact-2',
        relation: 'depends_on',
        weight: 0.5,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(memoryStore.addEdge).toHaveBeenCalledWith({
      source_fact_id: 'fact-1',
      target_fact_id: 'fact-2',
      relation: 'depends_on',
      weight: 0.5,
    });
    expect(response.json()).toEqual({ ok: true, edge: makeEdge() });
  });

  it('deletes an edge', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/memory/edges/edge-1',
    });

    expect(response.statusCode).toBe(200);
    expect(memoryStore.deleteEdge).toHaveBeenCalledWith('edge-1');
    expect(response.json()).toEqual({ ok: true, id: 'edge-1' });
  });

  it('returns a graph payload', async () => {
    vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([
      makeFact(),
      makeFact({ id: 'fact-2', content: 'Related node' }),
    ]);
    vi.mocked(memoryStore.listEdges).mockResolvedValueOnce([makeEdge()]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/graph?scope=project:agentctl&entityType=concept&limit=20',
    });

    expect(response.statusCode).toBe(200);
    expect(memoryStore.listFacts).toHaveBeenCalledWith({
      scope: 'project:agentctl',
      entityType: 'concept',
      limit: 20,
      offset: 0,
    });
    expect(memoryStore.listEdges).toHaveBeenCalledWith({ factIds: ['fact-1', 'fact-2'] });
    expect(response.json()).toEqual({
      ok: true,
      nodes: [makeFact(), makeFact({ id: 'fact-2', content: 'Related node' })],
      edges: [makeEdge()],
    });
  });
});
