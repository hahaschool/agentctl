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
    content: 'Use the unified memory UI route shell',
    content_model: 'text-embedding-3-small',
    entity_type: 'decision',
    confidence: 0.9,
    strength: 0.8,
    source: {
      session_id: 'session-1',
      agent_id: 'agent-1',
      machine_id: 'machine-1',
      turn_index: 4,
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
    relation: 'related_to',
    weight: 0.6,
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
    recordFeedback: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as MemoryStore;
}

describe('memory fact routes', () => {
  let app: FastifyInstance;
  let memorySearch: MemorySearch;
  let memoryStore: MemoryStore;

  beforeEach(async () => {
    memorySearch = createMockMemorySearch();
    memoryStore = createMockMemoryStore();
    app = await createServer({ logger, memorySearch, memoryStore });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists facts via hybrid search when q is provided', async () => {
    vi.mocked(memorySearch.search).mockResolvedValueOnce([
      { fact: makeFact(), score: 0.92, source_path: 'vector' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?q=memory&scope=project:agentctl&entityType=decision&limit=5',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      facts: [makeFact()],
      total: 1,
    });
    expect(memorySearch.search).toHaveBeenCalledWith({
      query: 'memory',
      visibleScopes: ['project:agentctl'],
      limit: 5,
      entityType: 'decision',
    });
  });

  it('lists facts with source filters', async () => {
    vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([makeFact()]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?sessionId=session-1&agentId=agent-1&machineId=machine-1&minConfidence=0.7&limit=10&offset=2',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, facts: [makeFact()], total: 1 });
    expect(memoryStore.listFacts).toHaveBeenCalledWith({
      sessionId: 'session-1',
      agentId: 'agent-1',
      machineId: 'machine-1',
      minConfidence: 0.7,
      limit: 10,
      offset: 2,
    });
  });

  it('creates a fact', async () => {
    vi.mocked(memoryStore.addFact).mockResolvedValueOnce(makeFact());

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/facts',
      payload: {
        content: 'Remember the memory route shell',
        scope: 'project:agentctl',
        entityType: 'decision',
        confidence: 0.75,
        source: {
          session_id: 'session-1',
          agent_id: 'agent-1',
          machine_id: 'machine-1',
          turn_index: 2,
          extraction_method: 'manual',
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(memoryStore.addFact).toHaveBeenCalledWith({
      content: 'Remember the memory route shell',
      scope: 'project:agentctl',
      entity_type: 'decision',
      confidence: 0.75,
      source: {
        session_id: 'session-1',
        agent_id: 'agent-1',
        machine_id: 'machine-1',
        turn_index: 2,
        extraction_method: 'manual',
      },
    });
  });

  it('gets a fact with its edges', async () => {
    vi.mocked(memoryStore.getFact).mockResolvedValueOnce(makeFact());
    vi.mocked(memoryStore.listEdges).mockResolvedValueOnce([makeEdge()]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts/fact-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      fact: makeFact(),
      edges: [makeEdge()],
    });
    expect(memoryStore.listEdges).toHaveBeenCalledWith({ factId: 'fact-1' });
  });

  it('updates a fact', async () => {
    vi.mocked(memoryStore.updateFact).mockResolvedValueOnce(
      makeFact({ content: 'Updated memory', confidence: 0.7 }),
    );

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/memory/facts/fact-1',
      payload: {
        content: 'Updated memory',
        confidence: 0.7,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(memoryStore.updateFact).toHaveBeenCalledWith('fact-1', {
      content: 'Updated memory',
      confidence: 0.7,
    });
    expect(response.json()).toEqual({
      ok: true,
      fact: makeFact({ content: 'Updated memory', confidence: 0.7 }),
    });
  });

  it('soft deletes a fact', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/memory/facts/fact-1',
    });

    expect(response.statusCode).toBe(200);
    expect(memoryStore.invalidateFact).toHaveBeenCalledWith('fact-1');
    expect(response.json()).toEqual({ ok: true, id: 'fact-1' });
  });

  // ── §3.6 Feedback Endpoint Tests ──────────────────────────────────────────

  it('records used feedback signal and returns updated fact', async () => {
    const updatedFact = makeFact({ strength: 0.9 });
    vi.mocked(memoryStore.recordFeedback).mockResolvedValueOnce(updatedFact);

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/facts/fact-1/feedback',
      payload: { signal: 'used' },
    });

    expect(response.statusCode).toBe(200);
    expect(memoryStore.recordFeedback).toHaveBeenCalledWith('fact-1', 'used');
    expect(response.json()).toEqual({ ok: true, fact: updatedFact });
  });

  it('records irrelevant feedback signal', async () => {
    const updatedFact = makeFact({ strength: 0.7 });
    vi.mocked(memoryStore.recordFeedback).mockResolvedValueOnce(updatedFact);

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/facts/fact-1/feedback',
      payload: { signal: 'irrelevant' },
    });

    expect(response.statusCode).toBe(200);
    expect(memoryStore.recordFeedback).toHaveBeenCalledWith('fact-1', 'irrelevant');
  });

  it('records outdated feedback signal', async () => {
    const updatedFact = makeFact({ confidence: 0.7 });
    vi.mocked(memoryStore.recordFeedback).mockResolvedValueOnce(updatedFact);

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/facts/fact-1/feedback',
      payload: { signal: 'outdated' },
    });

    expect(response.statusCode).toBe(200);
    expect(memoryStore.recordFeedback).toHaveBeenCalledWith('fact-1', 'outdated');
  });

  it('returns 400 for an invalid feedback signal', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/facts/fact-1/feedback',
      payload: { signal: 'unknown-signal' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_SIGNAL' });
    expect(memoryStore.recordFeedback).not.toHaveBeenCalled();
  });

  it('returns 404 when fact is not found during feedback', async () => {
    vi.mocked(memoryStore.recordFeedback).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/facts/nonexistent/feedback',
      payload: { signal: 'used' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'NOT_FOUND' });
  });
});
