import type { MemoryEdge, MemoryFact } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemoryStore } from '../../memory/memory-store.js';
import { createServer } from '../server.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'fact-start',
    scope: 'project:agentctl',
    content: 'AgentCTL uses bounded memory traversal',
    content_model: 'text-embedding-3-small',
    entity_type: 'concept',
    confidence: 0.9,
    strength: 0.8,
    source: {
      session_id: 'session-1',
      agent_id: 'agent-1',
      machine_id: 'machine-1',
      turn_index: 4,
      extraction_method: 'manual',
    },
    valid_from: '2026-04-20T10:00:00.000Z',
    valid_until: null,
    created_at: '2026-04-20T10:00:00.000Z',
    accessed_at: '2026-04-20T10:00:00.000Z',
    ...overrides,
  };
}

function makeEdge(overrides: Partial<MemoryEdge> = {}): MemoryEdge {
  return {
    id: 'edge-1',
    source_fact_id: 'fact-start',
    target_fact_id: 'fact-mid',
    relation: 'depends_on',
    weight: 0.8,
    created_at: '2026-04-20T10:05:00.000Z',
    ...overrides,
  };
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
    recordFeedback: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as MemoryStore;
}

describe('memory traverse route', () => {
  let app: FastifyInstance;
  let memoryStore: MemoryStore;

  beforeEach(async () => {
    memoryStore = createMockMemoryStore();
    app = await createServer({ logger, memoryStore });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns an empty graph when the start entity is not present', async () => {
    vi.mocked(memoryStore.getFact).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/traverse',
      payload: {
        start_entity_canonical_id: 'missing-fact',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      start_entity_canonical_id: 'missing-fact',
      max_hops: 3,
      node_cap: 100,
      nodes: [],
      edges: [],
      partial: false,
    });
    expect(memoryStore.listEdges).not.toHaveBeenCalled();
  });

  it('walks fact edges within the hop limit and applies relation/confidence filters', async () => {
    const facts = new Map([
      ['fact-start', makeFact()],
      [
        'fact-mid',
        makeFact({
          id: 'fact-mid',
          content: 'Memory traversal depends on fact graph edges',
          valid_from: '2026-04-20T10:10:00.000Z',
        }),
      ],
      [
        'fact-weak',
        makeFact({
          id: 'fact-weak',
          content: 'This weak edge should be filtered out',
          valid_from: '2026-04-20T10:20:00.000Z',
        }),
      ],
    ]);
    vi.mocked(memoryStore.getFact).mockImplementation(async (id) => facts.get(id) ?? null);
    vi.mocked(memoryStore.listEdges)
      .mockResolvedValueOnce([
        makeEdge(),
        makeEdge({
          id: 'edge-weak',
          target_fact_id: 'fact-weak',
          relation: 'related_to',
          weight: 0.4,
        }),
      ])
      .mockResolvedValueOnce([]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/traverse',
      payload: {
        start_entity_canonical_id: 'fact-start',
        max_hops: 2,
        relation_types: ['depends_on', 'related_to'],
        min_confidence: 0.5,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      start_entity_canonical_id: 'fact-start',
      max_hops: 2,
      node_cap: 100,
      nodes: [
        {
          canonical_id: 'fact-start',
          entity_name: 'AgentCTL uses bounded memory traversal',
          hop_distance: 0,
          earliest_seen: '2026-04-20T10:00:00.000Z',
        },
        {
          canonical_id: 'fact-mid',
          entity_name: 'Memory traversal depends on fact graph edges',
          hop_distance: 1,
          earliest_seen: '2026-04-20T10:10:00.000Z',
        },
      ],
      edges: [
        {
          subject_id: 'fact-start',
          object_id: 'fact-mid',
          relation: 'depends_on',
          confidence: 0.8,
          valid_from: null,
          valid_until: null,
        },
      ],
      partial: false,
    });
    expect(memoryStore.listEdges).toHaveBeenNthCalledWith(1, { factIds: ['fact-start'] });
    expect(memoryStore.listEdges).toHaveBeenNthCalledWith(2, { factIds: ['fact-mid'] });
  });

  it('applies as_of to the current fact validity windows', async () => {
    const facts = new Map([
      ['fact-start', makeFact()],
      [
        'fact-expired',
        makeFact({
          id: 'fact-expired',
          content: 'Expired before the traversal timestamp',
          valid_from: '2026-04-19T00:00:00.000Z',
          valid_until: '2026-04-20T09:00:00.000Z',
        }),
      ],
      [
        'fact-future',
        makeFact({
          id: 'fact-future',
          content: 'Created after the traversal timestamp',
          valid_from: '2026-04-21T00:00:00.000Z',
        }),
      ],
    ]);
    vi.mocked(memoryStore.getFact).mockImplementation(async (id) => facts.get(id) ?? null);
    vi.mocked(memoryStore.listEdges).mockResolvedValueOnce([
      makeEdge({ id: 'edge-expired', target_fact_id: 'fact-expired' }),
      makeEdge({ id: 'edge-future', target_fact_id: 'fact-future' }),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/traverse',
      payload: {
        start_entity_canonical_id: 'fact-start',
        as_of: '2026-04-20T12:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      nodes: [
        {
          canonical_id: 'fact-start',
          hop_distance: 0,
        },
      ],
      edges: [],
      partial: false,
    });
  });

  it('enforces hop and node caps before traversing', async () => {
    const invalidHopResponse = await app.inject({
      method: 'POST',
      url: '/api/memory/traverse',
      payload: {
        start_entity_canonical_id: 'fact-start',
        max_hops: 11,
      },
    });
    const invalidNodeResponse = await app.inject({
      method: 'POST',
      url: '/api/memory/traverse',
      payload: {
        start_entity_canonical_id: 'fact-start',
        max_nodes: 101,
      },
    });

    expect(invalidHopResponse.statusCode).toBe(400);
    expect(invalidHopResponse.json()).toEqual({
      error: 'INVALID_PARAMS',
      message: 'max_hops must be an integer between 1 and 10',
    });
    expect(invalidNodeResponse.statusCode).toBe(400);
    expect(invalidNodeResponse.json()).toEqual({
      error: 'INVALID_PARAMS',
      message: 'max_nodes must be an integer between 1 and 100',
    });
    expect(memoryStore.getFact).not.toHaveBeenCalled();
  });
});
