// ---------------------------------------------------------------------------
// Tests for POST /api/memory/traverse (§4.15 / PR H control-plane slice).
//
// The traversal route runs raw SQL against a Postgres pool. Like every other
// memory-* route test in this directory (memory-consolidation.test.ts,
// memory-decay.test.ts, memory-synthesis.test.ts), we mock `pool.query` and
// drive the route through a real Fastify instance. Each test queues the row
// sets the BFS expects: first `loadStartFact`, then one `fetchEdgesFromFrontier`
// call per hop.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryTraverseRoutes } from './memory-traverse.js';
import { createMockLogger } from './test-helpers.js';

type QueryFn = ReturnType<typeof vi.fn>;

function createMockPool(): { query: QueryFn } {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  };
}

function makeFactRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    content: `fact ${id}`,
    valid_from: '2026-04-01T00:00:00.000Z',
    valid_until: null,
    confidence: 0.9,
    ...overrides,
  };
}

type EdgeRowInput = {
  source: string;
  target: string;
  relation?: string;
  sourceConfidence?: number;
  targetConfidence?: number;
  sourceValidFrom?: string;
  sourceValidUntil?: string | null;
  targetValidFrom?: string;
  targetValidUntil?: string | null;
  sourceContent?: string;
  targetContent?: string;
};

function makeEdgeRow(input: EdgeRowInput): Record<string, unknown> {
  return {
    source_fact_id: input.source,
    target_fact_id: input.target,
    relation: input.relation ?? 'related_to',
    source_content: input.sourceContent ?? `fact ${input.source}`,
    source_valid_from: input.sourceValidFrom ?? '2026-04-01T00:00:00.000Z',
    source_valid_until: input.sourceValidUntil ?? null,
    source_confidence: input.sourceConfidence ?? 0.9,
    target_content: input.targetContent ?? `fact ${input.target}`,
    target_valid_from: input.targetValidFrom ?? '2026-04-01T00:00:00.000Z',
    target_valid_until: input.targetValidUntil ?? null,
    target_confidence: input.targetConfidence ?? 0.9,
  };
}

async function buildApp(pool: { query: QueryFn }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(memoryTraverseRoutes, {
    prefix: '/api/memory/traverse',
    pool: pool as never,
    logger: createMockLogger(),
  });
  await app.ready();
  return app;
}

describe('memory-traverse routes', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    pool = createMockPool();
    app = await buildApp(pool);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  // ── Validation ────────────────────────────────────────────────────────────

  describe('validation', () => {
    it('rejects a non-object body with 400 INVALID_PARAMS', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/traverse',
        payload: '"hello"',
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'INVALID_PARAMS' });
    });

    it('rejects missing start_entity_canonical_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/traverse',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/start_entity_canonical_id/);
    });

    it('rejects unsafe start_entity_canonical_id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/traverse',
        payload: { start_entity_canonical_id: '../etc/passwd' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects max_hops out of range', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/traverse',
        payload: { start_entity_canonical_id: 'fact-1', max_hops: 99 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/max_hops/);
    });

    it('rejects negative max_nodes', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/traverse',
        payload: { start_entity_canonical_id: 'fact-1', max_nodes: -1 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/max_nodes/);
    });

    it('rejects invalid relation_types entries', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/traverse',
        payload: {
          start_entity_canonical_id: 'fact-1',
          relation_types: ['not-a-relation'],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects min_confidence outside [0,1]', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/traverse',
        payload: {
          start_entity_canonical_id: 'fact-1',
          min_confidence: 1.5,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects malformed as_of string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/traverse',
        payload: {
          start_entity_canonical_id: 'fact-1',
          as_of: 'not-a-date',
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── 404 missing start entity ──────────────────────────────────────────────

  it('returns 404 MEMORY_TRAVERSE_START_NOT_FOUND when start entity is absent', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // loadStartFact
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/traverse',
      payload: { start_entity_canonical_id: 'missing-fact', max_hops: 2 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'MEMORY_TRAVERSE_START_NOT_FOUND' });
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('walks multi-hop edges and assigns hop_distance labels', async () => {
    pool.query
      // loadStartFact: fact-A
      .mockResolvedValueOnce({ rows: [makeFactRow('fact-A')] })
      // hop 1: A ↔ B
      .mockResolvedValueOnce({
        rows: [makeEdgeRow({ source: 'fact-A', target: 'fact-B' })],
      })
      // hop 2: B ↔ C
      .mockResolvedValueOnce({
        rows: [makeEdgeRow({ source: 'fact-B', target: 'fact-C' })],
      })
      // hop 3: no more edges
      .mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/traverse',
      payload: {
        start_entity_canonical_id: 'fact-A',
        max_hops: 3,
        max_nodes: 100,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.partial).toBe(false);
    expect(body.start_entity_canonical_id).toBe('fact-A');
    expect(body.node_cap).toBe(100);
    expect(body.max_hops).toBe(3);
    expect(body.nodes).toEqual([
      expect.objectContaining({ canonical_id: 'fact-A', hop_distance: 0 }),
      expect.objectContaining({ canonical_id: 'fact-B', hop_distance: 1 }),
      expect.objectContaining({ canonical_id: 'fact-C', hop_distance: 2 }),
    ]);
    expect(body.edges).toHaveLength(2);
    expect(body.edges[0]).toMatchObject({
      subject_id: 'fact-A',
      object_id: 'fact-B',
      relation: 'related_to',
    });
  });

  // ── Node cap ──────────────────────────────────────────────────────────────

  it('sets partial=true when node cap truncates the traversal', async () => {
    pool.query
      // loadStartFact
      .mockResolvedValueOnce({ rows: [makeFactRow('fact-A')] })
      // hop 1 returns three neighbors but max_nodes = 3 allows only two of them
      .mockResolvedValueOnce({
        rows: [
          makeEdgeRow({ source: 'fact-A', target: 'fact-B' }),
          makeEdgeRow({ source: 'fact-A', target: 'fact-C' }),
          makeEdgeRow({ source: 'fact-A', target: 'fact-D' }),
        ],
      });

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/traverse',
      payload: {
        start_entity_canonical_id: 'fact-A',
        max_hops: 2,
        max_nodes: 3,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.partial).toBe(true);
    // Start + 2 neighbors = node_cap reached
    expect(body.nodes).toHaveLength(3);
    // Only edges whose endpoints are in the final node set are returned.
    expect(body.edges.length).toBeLessThanOrEqual(2);
  });

  // ── Hop cap ───────────────────────────────────────────────────────────────

  it('sets partial=true when hop cap is hit with remaining frontier', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [makeFactRow('fact-A')] })
      // hop 1
      .mockResolvedValueOnce({
        rows: [makeEdgeRow({ source: 'fact-A', target: 'fact-B' })],
      })
      // hop 2 expands from B to C (more to explore would remain)
      .mockResolvedValueOnce({
        rows: [makeEdgeRow({ source: 'fact-B', target: 'fact-C' })],
      });

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/traverse',
      payload: {
        start_entity_canonical_id: 'fact-A',
        max_hops: 2,
        max_nodes: 100,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.partial).toBe(true);
    expect(body.nodes.map((node: { canonical_id: string }) => node.canonical_id)).toEqual([
      'fact-A',
      'fact-B',
      'fact-C',
    ]);
  });

  // ── Filters ───────────────────────────────────────────────────────────────

  it('passes relation_types filter through to the SQL query', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [makeFactRow('fact-A')] })
      .mockResolvedValueOnce({
        rows: [makeEdgeRow({ source: 'fact-A', target: 'fact-B', relation: 'modifies' })],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/traverse',
      payload: {
        start_entity_canonical_id: 'fact-A',
        max_hops: 2,
        max_nodes: 100,
        relation_types: ['modifies'],
      },
    });

    expect(res.statusCode).toBe(200);
    // 1 loadStartFact + N edge hop queries. The edge hop query must carry the
    // relation_types filter.
    const edgeCall = pool.query.mock.calls.find((call) => String(call[0]).includes('memory_edges'));
    expect(edgeCall).toBeDefined();
    const [, values] = edgeCall as [string, unknown[]];
    expect(values).toEqual(expect.arrayContaining([['modifies']]));
  });

  it('excludes low-confidence endpoints when min_confidence is set', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [makeFactRow('fact-A', { confidence: 0.95 })] })
      // hop 1 returns two edges but one has a low-confidence target
      .mockResolvedValueOnce({
        rows: [
          makeEdgeRow({
            source: 'fact-A',
            target: 'fact-B',
            sourceConfidence: 0.95,
            targetConfidence: 0.9,
          }),
          makeEdgeRow({
            source: 'fact-A',
            target: 'fact-C',
            sourceConfidence: 0.95,
            targetConfidence: 0.3,
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/traverse',
      payload: {
        start_entity_canonical_id: 'fact-A',
        max_hops: 2,
        max_nodes: 100,
        min_confidence: 0.7,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.nodes.map((n: { canonical_id: string }) => n.canonical_id);
    expect(ids).toContain('fact-B');
    expect(ids).not.toContain('fact-C');
  });

  it('applies as_of window to drop endpoints outside validity', async () => {
    const asOf = '2026-04-10T00:00:00.000Z';
    pool.query
      .mockResolvedValueOnce({
        rows: [makeFactRow('fact-A', { valid_from: '2026-04-01T00:00:00.000Z' })],
      })
      .mockResolvedValueOnce({
        rows: [
          // valid at as_of
          makeEdgeRow({
            source: 'fact-A',
            target: 'fact-B',
            sourceValidFrom: '2026-04-01T00:00:00.000Z',
            targetValidFrom: '2026-04-01T00:00:00.000Z',
          }),
          // target not yet valid at as_of
          makeEdgeRow({
            source: 'fact-A',
            target: 'fact-C',
            sourceValidFrom: '2026-04-01T00:00:00.000Z',
            targetValidFrom: '2026-04-15T00:00:00.000Z',
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/traverse',
      payload: {
        start_entity_canonical_id: 'fact-A',
        max_hops: 2,
        max_nodes: 100,
        as_of: asOf,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.nodes.map((n: { canonical_id: string }) => n.canonical_id);
    expect(ids).toContain('fact-B');
    expect(ids).not.toContain('fact-C');

    // Verify the edge query pushed the as_of parameter down to SQL too.
    const edgeCall = pool.query.mock.calls.find((call) => String(call[0]).includes('memory_edges'));
    expect(edgeCall).toBeDefined();
    const [, values] = edgeCall as [string, unknown[]];
    expect(values).toEqual(expect.arrayContaining([asOf]));
  });
});
