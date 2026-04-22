import type { MemoryEdge, MemoryFact } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DrawerEmbeddingClient } from '../../memory/memory-drawer-search.js';
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
      results: [{ fact: makeFact(), score: 0.92, source_path: 'vector' }],
      total: 1,
    });
    expect(memorySearch.search).toHaveBeenCalledWith({
      query: 'memory',
      visibleScopes: ['project:agentctl'],
      limit: 5,
      entityType: 'decision',
    });
  });

  it('surfaces score and source_path on semantic-search results for dedup consumers', async () => {
    const factA = makeFact({ id: 'fact-a' });
    const factB = makeFact({ id: 'fact-b' });
    const factC = makeFact({ id: 'fact-c' });
    vi.mocked(memorySearch.search).mockResolvedValueOnce([
      { fact: factA, score: 0.99, source_path: 'vector' },
      { fact: factB, score: 0.81, source_path: 'bm25' },
      { fact: factC, score: 0.42, source_path: 'graph' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?q=scoring&scope=project:agentctl',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results).toEqual([
      { fact: factA, score: 0.99, source_path: 'vector' },
      { fact: factB, score: 0.81, source_path: 'bm25' },
      { fact: factC, score: 0.42, source_path: 'graph' },
    ]);
    expect(body.facts).toEqual([factA, factB, factC]);
    expect(body.total).toBe(3);
  });

  it('applies identical pagination to facts and results', async () => {
    const factA = makeFact({ id: 'fact-a' });
    const factB = makeFact({ id: 'fact-b' });
    const factC = makeFact({ id: 'fact-c' });
    vi.mocked(memorySearch.search).mockResolvedValueOnce([
      { fact: factA, score: 0.9, source_path: 'vector' },
      { fact: factB, score: 0.7, source_path: 'bm25' },
      { fact: factC, score: 0.5, source_path: 'graph' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?q=pagination&scope=project:agentctl&limit=1&offset=1',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.facts).toEqual([factB]);
    expect(body.results).toEqual([{ fact: factB, score: 0.7, source_path: 'bm25' }]);
    // total still counts all filtered results, not just the page
    expect(body.total).toBe(3);
  });

  it('applies source filters before building results (dedup consumers see same subset)', async () => {
    const factMatch = makeFact({
      id: 'fact-match',
      source: {
        session_id: 'session-1',
        agent_id: 'agent-1',
        machine_id: 'machine-1',
        turn_index: 1,
        extraction_method: 'manual',
      },
    });
    const factOther = makeFact({
      id: 'fact-other',
      source: {
        session_id: 'session-2',
        agent_id: 'agent-1',
        machine_id: 'machine-1',
        turn_index: 2,
        extraction_method: 'manual',
      },
    });
    vi.mocked(memorySearch.search).mockResolvedValueOnce([
      { fact: factMatch, score: 0.88, source_path: 'vector' },
      { fact: factOther, score: 0.77, source_path: 'bm25' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?q=filters&scope=project:agentctl&sessionId=session-1',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.facts).toEqual([factMatch]);
    expect(body.results).toEqual([{ fact: factMatch, score: 0.88, source_path: 'vector' }]);
    expect(body.total).toBe(1);
  });

  it('omits results field when empty q falls through to listFacts (no semantic scoring)', async () => {
    vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([makeFact()]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?scope=project:agentctl',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({ ok: true, facts: [makeFact()], total: 1 });
    expect(body.results).toBeUndefined();
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

  // ── §4.8 Cross-entity query filters ────────────────────────────────────────

  it('filters facts by sessionId alone', async () => {
    const factForSession = makeFact({
      source: { ...makeFact().source, agent_id: null, machine_id: null },
    });
    vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([factForSession]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?sessionId=session-1',
    });

    expect(response.statusCode).toBe(200);
    expect(memoryStore.listFacts).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
    );
    expect(response.json().facts).toHaveLength(1);
  });

  it('filters facts by agentId alone', async () => {
    const factForAgent = makeFact({
      source: { ...makeFact().source, session_id: null, machine_id: null },
    });
    vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([factForAgent]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?agentId=agent-1',
    });

    expect(response.statusCode).toBe(200);
    expect(memoryStore.listFacts).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1' }),
    );
    expect(response.json().facts).toHaveLength(1);
  });

  it('filters facts by machineId alone', async () => {
    const factForMachine = makeFact({
      source: { ...makeFact().source, session_id: null, agent_id: null },
    });
    vi.mocked(memoryStore.listFacts).mockResolvedValueOnce([factForMachine]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?machineId=machine-1',
    });

    expect(response.statusCode).toBe(200);
    expect(memoryStore.listFacts).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: 'machine-1' }),
    );
    expect(response.json().facts).toHaveLength(1);
  });

  it('rejects unsafe name filters in query parameters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?sessionId=../session-1',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_FACT_QUERY' });
    expect(memoryStore.listFacts).not.toHaveBeenCalled();
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

  it('passes drawer source spans when creating a fact', async () => {
    vi.mocked(memoryStore.addFact).mockResolvedValueOnce(makeFact());

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/facts',
      payload: {
        content: 'Remember the evidence drawer span',
        scope: 'project:agentctl',
        entityType: 'decision',
        sourceSpans: [
          {
            drawerId: 'drawer-1',
            startOffset: 12,
            endOffset: 48,
            sourceJson: { extractor: 'memory-write' },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(memoryStore.addFact).toHaveBeenCalledWith({
      content: 'Remember the evidence drawer span',
      scope: 'project:agentctl',
      entity_type: 'decision',
      confidence: undefined,
      source: {
        session_id: null,
        agent_id: null,
        machine_id: null,
        turn_index: null,
        extraction_method: 'manual',
      },
      sourceSpans: [
        {
          drawerId: 'drawer-1',
          startOffset: 12,
          endOffset: 48,
          sourceJson: { extractor: 'memory-write' },
        },
      ],
    });
  });

  it('rejects invalid drawer source spans', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/facts',
      payload: {
        content: 'Invalid span',
        scope: 'project:agentctl',
        entityType: 'decision',
        sourceSpans: [{ drawerId: 'drawer-1', startOffset: 50, endOffset: 10 }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_SOURCE_SPANS' });
    expect(memoryStore.addFact).not.toHaveBeenCalled();
  });

  it('rejects unsafe memory scope values when creating a fact', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/facts',
      payload: {
        content: 'Invalid scope',
        scope: '../project',
        entityType: 'decision',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_SCOPE' });
    expect(memoryStore.addFact).not.toHaveBeenCalled();
  });

  it('rejects unsafe drawer ids in source spans', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/facts',
      payload: {
        content: 'Invalid span',
        scope: 'project:agentctl',
        entityType: 'decision',
        sourceSpans: [{ drawerId: '../drawer', startOffset: 0, endOffset: 10 }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_SOURCE_SPANS' });
    expect(memoryStore.addFact).not.toHaveBeenCalled();
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

  it('adds fact source previews to the detail envelope when pgPool is available', async () => {
    const pgPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            drawer_id: 'drawer-1',
            drawer_scope: 'project:agentctl',
            drawer_topic: 'release-checklist',
            drawer_chunk_index: 0,
            drawer_source_type: 'session-jsonl',
            drawer_source_id: 'session-1',
            start_offset: 5,
            end_offset: 29,
            drawer_content: '12345beta gate review happens before promote and rollback',
            drawer_archived_at: null,
            created_at: '2026-03-11T10:00:00.000Z',
          },
          {
            drawer_id: 'drawer-2',
            drawer_scope: 'project:agentctl',
            drawer_topic: 'ops-notes',
            drawer_chunk_index: 1,
            drawer_source_type: 'session-jsonl',
            drawer_source_id: 'session-2',
            start_offset: 0,
            end_offset: 10,
            drawer_content: 'archived content',
            drawer_archived_at: '2026-03-12T10:00:00.000Z',
            created_at: '2026-03-11T11:00:00.000Z',
          },
        ],
      }),
    } as unknown as Pool;
    const fact = makeFact();
    const edge = makeEdge();
    vi.mocked(memoryStore.getFact).mockResolvedValueOnce(fact);
    vi.mocked(memoryStore.listEdges).mockResolvedValueOnce([edge]);

    const detailApp = await createServer({ logger, memorySearch, memoryStore, pgPool });
    await detailApp.ready();

    const response = await detailApp.inject({
      method: 'GET',
      url: '/api/memory/facts/fact-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      fact,
      edges: [edge],
      sourcePreviews: [
        {
          drawer_id: 'drawer-1',
          drawer_scope: 'project:agentctl',
          drawer_topic: 'release-checklist',
          drawer_chunk_index: 0,
          drawer_source_type: 'session-jsonl',
          drawer_source_id: 'session-1',
          start_offset: 5,
          end_offset: 29,
          quote_preview: 'beta gate review happens',
          status: 'available',
          created_at: '2026-03-11T10:00:00.000Z',
        },
        {
          drawer_id: 'drawer-2',
          drawer_scope: 'project:agentctl',
          drawer_topic: 'ops-notes',
          drawer_chunk_index: 1,
          drawer_source_type: 'session-jsonl',
          drawer_source_id: 'session-2',
          start_offset: 0,
          end_offset: 10,
          quote_preview: null,
          status: 'archived',
          created_at: '2026-03-11T11:00:00.000Z',
        },
      ],
    });
    expect(pgPool.query).toHaveBeenCalledWith(expect.stringContaining('FROM memory_fact_sources'), [
      'fact-1',
    ]);

    await detailApp.close();
  });

  it('returns an empty provenance array when a fact has no source spans', async () => {
    const pgPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;
    const fact = makeFact();
    const edge = makeEdge();
    vi.mocked(memoryStore.getFact).mockResolvedValueOnce(fact);
    vi.mocked(memoryStore.listEdges).mockResolvedValueOnce([edge]);

    const detailApp = await createServer({ logger, memorySearch, memoryStore, pgPool });
    await detailApp.ready();

    const response = await detailApp.inject({
      method: 'GET',
      url: '/api/memory/facts/fact-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      fact,
      edges: [edge],
      sourcePreviews: [],
    });

    await detailApp.close();
  });

  it('falls back to an empty provenance array when source preview lookup fails', async () => {
    vi.mocked(logger.warn).mockClear();
    const lookupError = new Error('preview lookup failed');
    const pgPool = {
      query: vi.fn().mockRejectedValue(lookupError),
    } as unknown as Pool;
    const fact = makeFact();
    const edge = makeEdge();
    vi.mocked(memoryStore.getFact).mockResolvedValueOnce(fact);
    vi.mocked(memoryStore.listEdges).mockResolvedValueOnce([edge]);

    const detailApp = await createServer({ logger, memorySearch, memoryStore, pgPool });
    await detailApp.ready();

    const response = await detailApp.inject({
      method: 'GET',
      url: '/api/memory/facts/fact-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      fact,
      edges: [edge],
      sourcePreviews: [],
    });
    await detailApp.close();
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

  it('rejects overlong content on POST / with 400 INVALID_CONTENT', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/facts',
      payload: {
        content: 'x'.repeat(10_000),
        scope: 'project:agentctl',
        entityType: 'decision',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_CONTENT');
  });
});

describe('memory fact routes — SQL ILIKE fallback (no memorySearch)', () => {
  let app: FastifyInstance;
  let memoryStore: MemoryStore;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('returns facts only (no results field) when embeddings are unavailable', async () => {
    const factRow = {
      id: 'fact-sql',
      scope: 'project:agentctl',
      content: 'Use SQL ILIKE fallback when embeddings are missing',
      content_model: 'none',
      entity_type: 'decision',
      confidence: 0.8,
      strength: 1.0,
      source_json: {
        session_id: null,
        agent_id: null,
        machine_id: null,
        turn_index: null,
        extraction_method: 'manual',
      },
      valid_from: '2026-03-11T10:00:00.000Z',
      valid_until: null,
      created_at: '2026-03-11T10:00:00.000Z',
      accessed_at: '2026-03-11T10:00:00.000Z',
      tags: [],
      usage_count: 0,
    };
    const pgPool = { query: vi.fn().mockResolvedValue({ rows: [factRow] }) };
    memoryStore = createMockMemoryStore();
    // No memorySearch provided — forces SQL ILIKE fallback path
    app = await createServer({
      logger,
      memoryStore,
      pgPool: pgPool as never,
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?q=fallback&scope=project:agentctl',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.facts)).toBe(true);
    expect(body.facts).toHaveLength(1);
    expect(body.facts[0].id).toBe('fact-sql');
    // SQL fallback does not emit results — consumers treat missing score as defensive path
    expect(body.results).toBeUndefined();
    expect(body.total).toBe(1);
    expect(pgPool.query).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// §4.16 MemPalace drawer-aware fusion feature flag
//
// These tests exercise the additive `drawerResults` envelope field that only
// appears when MEMORY_DRAWER_FUSION=true AND an embedding client + pg pool are
// wired. The default (flag off) path must keep byte-identical behaviour.
// ---------------------------------------------------------------------------

function makeDrawerSearchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'drawer-A',
    scope: 'session:sess-1',
    topic: 'general',
    source_type: 'session-jsonl',
    source_id: 'sess-1',
    chunk_index: 0,
    content: 'drawer snippet content',
    score: 0.5,
    rank: 1,
    ...overrides,
  };
}

type PoolMock = { query: ReturnType<typeof vi.fn> };

function createDrawerAwarePgPool(
  rows: Array<Record<string, unknown>> = [makeDrawerSearchRow()],
): PoolMock {
  return {
    query: vi.fn().mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('content_tsv_simple')) {
        return { rows };
      }
      if (typeof sql === 'string' && sql.includes('embedding <=>')) {
        return { rows };
      }
      return { rows: [] };
    }),
  };
}

describe('memory fact routes — drawer-aware fusion flag', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    vi.unstubAllEnvs();
  });

  it('excludes drawerResults when MEMORY_DRAWER_FUSION is not set (byte-identical envelope)', async () => {
    const memorySearch = createMockMemorySearch();
    const memoryStore = createMockMemoryStore();
    vi.mocked(memorySearch.search).mockResolvedValueOnce([
      { fact: makeFact(), score: 0.9, source_path: 'vector' },
    ]);
    const embed = vi.fn();
    const embeddingClient: DrawerEmbeddingClient = { embed };
    const pgPool = createDrawerAwarePgPool();

    app = await createServer({
      logger,
      memorySearch,
      memoryStore,
      embeddingClient,
      pgPool: pgPool as never,
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?q=flag-off',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.drawerResults).toBeUndefined();
    // Base envelope is preserved
    expect(body).toEqual({
      ok: true,
      facts: [makeFact()],
      results: [{ fact: makeFact(), score: 0.9, source_path: 'vector' }],
      total: 1,
    });
    // Flag off → drawer SQL + embedding pipeline must not fire
    expect(embed).not.toHaveBeenCalled();
    const drawerSqlCall = pgPool.query.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        (call[0].includes('content_tsv_simple') || call[0].includes('embedding <=>')),
    );
    expect(drawerSqlCall).toBeUndefined();
  });

  it('includes drawerResults when flag is on and embeddings + drawers are available', async () => {
    vi.stubEnv('MEMORY_DRAWER_FUSION', 'true');
    const memorySearch = createMockMemorySearch();
    const memoryStore = createMockMemoryStore();
    vi.mocked(memorySearch.search).mockResolvedValueOnce([
      { fact: makeFact(), score: 0.9, source_path: 'vector' },
    ]);
    const embeddingClient: DrawerEmbeddingClient = {
      embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };
    const pgPool = createDrawerAwarePgPool([
      makeDrawerSearchRow({ id: 'drawer-A', rank: 1 }),
      makeDrawerSearchRow({ id: 'drawer-B', rank: 2 }),
    ]);

    app = await createServer({
      logger,
      memorySearch,
      memoryStore,
      embeddingClient,
      pgPool: pgPool as never,
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?q=flag-on',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.drawerResults)).toBe(true);
    expect(body.drawerResults.length).toBeGreaterThan(0);
    // Fused score ordering: first result should have the highest score
    const scores = body.drawerResults.map((r: { score: number | null }) => r.score);
    const sortedDesc = [...scores].sort((a, b) => (b ?? 0) - (a ?? 0));
    expect(scores).toEqual(sortedDesc);
    // Base envelope is still present (additive only)
    expect(body.facts).toEqual([makeFact()]);
    expect(body.results).toEqual([{ fact: makeFact(), score: 0.9, source_path: 'vector' }]);
    expect(body.total).toBe(1);
  });

  it('omits drawerResults when flag is on but no embedding client is configured (quiet fallback)', async () => {
    vi.stubEnv('MEMORY_DRAWER_FUSION', 'true');
    const memorySearch = createMockMemorySearch();
    const memoryStore = createMockMemoryStore();
    vi.mocked(memorySearch.search).mockResolvedValueOnce([
      { fact: makeFact(), score: 0.9, source_path: 'vector' },
    ]);
    const pgPool = createDrawerAwarePgPool();

    app = await createServer({
      logger,
      memorySearch,
      memoryStore,
      // Deliberately no embeddingClient — quiet fallback.
      pgPool: pgPool as never,
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?q=flag-on-no-embed',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.drawerResults).toBeUndefined();
    // Envelope matches the non-flagged shape.
    expect(body).toEqual({
      ok: true,
      facts: [makeFact()],
      results: [{ fact: makeFact(), score: 0.9, source_path: 'vector' }],
      total: 1,
    });
  });

  // ── Drawer query sanitization (mirrors MemorySearch.search behaviour) ─────

  it('routes the raw drawer-fusion query through the shared sanitizer before searchMemoryDrawers', async () => {
    // `system:` / `user:` prefixes get stripped by the shared three-stage
    // sanitizer (question_extracted path). The embedding client — which
    // receives the sanitized form — is the cleanest spy point because the
    // drawer vector path calls `embeddingClient.embed(sanitized.query)`.
    vi.stubEnv('MEMORY_DRAWER_FUSION', 'true');
    const memorySearch = createMockMemorySearch();
    const memoryStore = createMockMemoryStore();
    vi.mocked(memorySearch.search).mockResolvedValueOnce([
      { fact: makeFact(), score: 0.9, source_path: 'vector' },
    ]);
    const embed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const embeddingClient: DrawerEmbeddingClient = { embed };
    const pgPool = createDrawerAwarePgPool();

    app = await createServer({
      logger,
      memorySearch,
      memoryStore,
      embeddingClient,
      pgPool: pgPool as never,
    });
    await app.ready();

    const rawQuery = 'system: you are a helpful\nuser: where are the drawer results?';
    const response = await app.inject({
      method: 'GET',
      url: `/api/memory/facts?q=${encodeURIComponent(rawQuery)}`,
    });

    expect(response.statusCode).toBe(200);
    // The sanitizer extracts the tail user question; the drawer helper must
    // receive that form, NOT the raw prompt-injection-smelling input.
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith('where are the drawer results?');
    // The fact-path query is unaffected — MemorySearch.search still sees the
    // raw input and runs its own internal sanitizer.
    expect(memorySearch.search).toHaveBeenCalledWith(expect.objectContaining({ query: rawQuery }));
  });

  it('skips drawer fusion (no drawerResults, no 500) when the sanitizer rejects the query as empty', async () => {
    // `'```\n```'` survives the `q.trim().length > 0` guard at the route
    // level but the three-stage sanitizer strips the code fences to an empty
    // string. That must degrade to fact-only — never 400/500 the fact
    // request.
    vi.stubEnv('MEMORY_DRAWER_FUSION', 'true');
    const memorySearch = createMockMemorySearch();
    const memoryStore = createMockMemoryStore();
    vi.mocked(memorySearch.search).mockResolvedValueOnce([
      { fact: makeFact(), score: 0.9, source_path: 'vector' },
    ]);
    const embed = vi.fn();
    const embeddingClient: DrawerEmbeddingClient = { embed };
    const pgPool = createDrawerAwarePgPool();

    app = await createServer({
      logger,
      memorySearch,
      memoryStore,
      embeddingClient,
      pgPool: pgPool as never,
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/api/memory/facts?q=${encodeURIComponent('```\n```')}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Drawer fusion skipped entirely: the envelope matches the non-flagged
    // shape (no `drawerResults` field present).
    expect(body.drawerResults).toBeUndefined();
    expect(body).toEqual({
      ok: true,
      facts: [makeFact()],
      results: [{ fact: makeFact(), score: 0.9, source_path: 'vector' }],
      total: 1,
    });
    // The drawer vector pipeline must not fire — the sanitizer short-circuits
    // before we touch the embedding client or the drawer SQL.
    expect(embed).not.toHaveBeenCalled();
    const drawerSqlCall = pgPool.query.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        (call[0].includes('content_tsv_simple') || call[0].includes('embedding <=>')),
    );
    expect(drawerSqlCall).toBeUndefined();
  });

  it('passes a passthrough sanitizer verdict straight through (no regression vs. pre-sanitizer tests)', async () => {
    // A plain query hits the sanitizer `passthrough` branch — the drawer
    // helper receives the exact input. This is the sanity check that the
    // sanitizer refactor did not regress the existing flag-on happy path.
    vi.stubEnv('MEMORY_DRAWER_FUSION', 'true');
    const memorySearch = createMockMemorySearch();
    const memoryStore = createMockMemoryStore();
    vi.mocked(memorySearch.search).mockResolvedValueOnce([
      { fact: makeFact(), score: 0.9, source_path: 'vector' },
    ]);
    const embed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const embeddingClient: DrawerEmbeddingClient = { embed };
    const pgPool = createDrawerAwarePgPool([makeDrawerSearchRow({ id: 'drawer-A', rank: 1 })]);

    app = await createServer({
      logger,
      memorySearch,
      memoryStore,
      embeddingClient,
      pgPool: pgPool as never,
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?q=find%20drawer%20snippet',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.drawerResults)).toBe(true);
    expect(body.drawerResults.length).toBeGreaterThan(0);
    // Passthrough: drawer helper receives the unchanged input.
    expect(embed).toHaveBeenCalledWith('find drawer snippet');
  });
});

// ---------------------------------------------------------------------------
// `drawerLimit` strict validation
//
// These tests exercise the Zod-based rejection path: `drawerLimit` must be a
// positive integer within `[1, 100]`. Malformed values (`25abc`, `1.5`, `0`,
// `101`) short-circuit to 400 `INVALID_DRAWER_LIMIT` before the handler runs,
// so a `Number.parseInt`-tolerated string like `25abc` never silently becomes
// `25`.
// ---------------------------------------------------------------------------

describe('memory fact routes — drawerLimit strict validation', () => {
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

  it.each([
    ['drawerLimit=25abc', '25abc'],
    ['drawerLimit=1.5', '1.5'],
    ['drawerLimit=0', '0'],
    ['drawerLimit=101', '101'],
    ['drawerLimit=-1', '-1'],
  ])('returns 400 INVALID_DRAWER_LIMIT for %s', async (_label, value) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/memory/facts?q=anything&drawerLimit=${encodeURIComponent(value)}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_DRAWER_LIMIT' });
    // The handler must not run — MemorySearch was never invoked.
    expect(memorySearch.search).not.toHaveBeenCalled();
  });

  it('accepts drawerLimit=25 as a valid integer and runs the handler', async () => {
    vi.mocked(memorySearch.search).mockResolvedValueOnce([
      { fact: makeFact(), score: 0.9, source_path: 'vector' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?q=any&drawerLimit=25',
    });

    expect(response.statusCode).toBe(200);
    expect(memorySearch.search).toHaveBeenCalledTimes(1);
  });

  it('accepts drawerLimit=100 (boundary) as a valid integer', async () => {
    vi.mocked(memorySearch.search).mockResolvedValueOnce([
      { fact: makeFact(), score: 0.9, source_path: 'vector' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?q=any&drawerLimit=100',
    });

    expect(response.statusCode).toBe(200);
  });

  it('accepts drawerLimit=1 (boundary) as a valid integer', async () => {
    vi.mocked(memorySearch.search).mockResolvedValueOnce([
      { fact: makeFact(), score: 0.9, source_path: 'vector' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/facts?q=any&drawerLimit=1',
    });

    expect(response.statusCode).toBe(200);
  });
});
