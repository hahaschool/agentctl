// ---------------------------------------------------------------------------
// Tests for GET /api/memory/timeline (§4.15 / PR H first timeline slice).
//
// This first control-plane slice stays read-only and uses the same pg-pool
// mock style as memory-traverse.test.ts: one query loads the requested start
// fact, and a second bounded query returns timeline rows derived from
// memory_edges plus memory_facts.valid_from/valid_until windows.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryTimelineRoutes } from './memory-timeline.js';
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

type TimelineRowInput = {
  edgeId: string;
  source: string;
  target: string;
  relation?: string;
  edgeCreatedAt?: string;
  otherFactId?: string;
  otherContent?: string;
  effectiveFrom?: string;
  effectiveUntil?: string | null;
};

function makeTimelineRow(input: TimelineRowInput): Record<string, unknown> {
  return {
    edge_id: input.edgeId,
    source_fact_id: input.source,
    target_fact_id: input.target,
    relation: input.relation ?? 'related_to',
    edge_created_at: input.edgeCreatedAt ?? '2026-04-03T00:00:00.000Z',
    other_fact_id: input.otherFactId ?? input.target,
    other_content: input.otherContent ?? `fact ${input.otherFactId ?? input.target}`,
    effective_from: input.effectiveFrom ?? '2026-04-02T00:00:00.000Z',
    effective_until: input.effectiveUntil ?? null,
  };
}

async function buildApp(pool: { query: QueryFn }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(memoryTimelineRoutes, {
    prefix: '/api/memory/timeline',
    pool: pool as never,
    logger: createMockLogger(),
  });
  await app.ready();
  return app;
}

describe('memory-timeline routes', () => {
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

  describe('validation', () => {
    it('rejects missing entity with 400 INVALID_PARAMS', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/timeline',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'INVALID_PARAMS' });
      expect(res.json().message).toMatch(/entity/);
    });

    it('rejects malformed as_of strings', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/timeline?entity=fact-A&as_of=not-a-date',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/as_of/i);
    });

    it('rejects malformed asOf strings', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/timeline?entity=fact-A&asOf=not-a-date',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/asOf/i);
    });

    it('rejects conflicting as_of and asOf values', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/timeline?entity=fact-A&as_of=2026-04-10T00:00:00.000Z&asOf=2026-04-11T00:00:00.000Z',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'INVALID_PARAMS' });
      expect(res.json().message).toMatch(/as_of/i);
      expect(res.json().message).toMatch(/asOf/);
    });

    it('rejects invalid cursor payloads', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/timeline?entity=fact-A&cursor=not-a-real-cursor',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/cursor/i);
    });

    it('rejects limit outside the allowed range', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/timeline?entity=fact-A&limit=0',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/limit/i);
    });
  });

  it('returns 404 MEMORY_TIMELINE_ENTITY_NOT_FOUND when the requested entity is absent', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/timeline?entity=missing-fact',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'MEMORY_TIMELINE_ENTITY_NOT_FOUND' });
  });

  it('returns a bounded timeline page with explicit phase-6 limitations', async () => {
    pool.query.mockResolvedValueOnce({ rows: [makeFactRow('fact-A')] }).mockResolvedValueOnce({
      rows: [
        makeTimelineRow({
          edgeId: 'edge-2',
          source: 'fact-A',
          target: 'fact-C',
          relation: 'depends_on',
          edgeCreatedAt: '2026-04-05T00:00:00.000Z',
          otherFactId: 'fact-C',
          otherContent: 'fact C depends on deployment context',
          effectiveFrom: '2026-04-04T00:00:00.000Z',
        }),
        makeTimelineRow({
          edgeId: 'edge-1',
          source: 'fact-B',
          target: 'fact-A',
          relation: 'related_to',
          edgeCreatedAt: '2026-04-03T00:00:00.000Z',
          otherFactId: 'fact-B',
          otherContent: 'fact B mentions earlier context',
          effectiveFrom: '2026-04-02T00:00:00.000Z',
        }),
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/timeline?entity=fact-A&limit=2',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.as_of).toBeNull();
    expect(body.limit).toBe(2);
    expect(body.next_cursor).toBeNull();
    expect(body.entity).toMatchObject({
      requested_id: 'fact-A',
      resolved_fact_id: 'fact-A',
      canonicalization_mode: 'fact-id-fallback',
      active_at_as_of: null,
    });
    expect(body.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('memory_facts.id'),
        expect.stringContaining('memory_edges'),
      ]),
    );
    expect(body.events).toEqual([
      expect.objectContaining({
        edge_id: 'edge-2',
        relation: 'depends_on',
        direction: 'outgoing',
        other_fact_id: 'fact-C',
        effective_from: '2026-04-04T00:00:00.000Z',
      }),
      expect.objectContaining({
        edge_id: 'edge-1',
        relation: 'related_to',
        direction: 'incoming',
        other_fact_id: 'fact-B',
        effective_from: '2026-04-02T00:00:00.000Z',
      }),
    ]);
  });

  it('returns an opaque next_cursor and reuses it on the next page', async () => {
    pool.query
      // first page
      .mockResolvedValueOnce({ rows: [makeFactRow('fact-A')] })
      .mockResolvedValueOnce({
        rows: [
          makeTimelineRow({
            edgeId: 'edge-2',
            source: 'fact-A',
            target: 'fact-C',
            effectiveFrom: '2026-04-04T00:00:00.000Z',
            edgeCreatedAt: '2026-04-05T00:00:00.000Z',
          }),
          makeTimelineRow({
            edgeId: 'edge-1',
            source: 'fact-A',
            target: 'fact-B',
            effectiveFrom: '2026-04-02T00:00:00.000Z',
            edgeCreatedAt: '2026-04-03T00:00:00.000Z',
          }),
        ],
      })
      // second page
      .mockResolvedValueOnce({ rows: [makeFactRow('fact-A')] })
      .mockResolvedValueOnce({
        rows: [
          makeTimelineRow({
            edgeId: 'edge-0',
            source: 'fact-Z',
            target: 'fact-A',
            otherFactId: 'fact-Z',
            effectiveFrom: '2026-04-01T00:00:00.000Z',
            edgeCreatedAt: '2026-04-01T12:00:00.000Z',
          }),
        ],
      });

    const first = await app.inject({
      method: 'GET',
      url: '/api/memory/timeline?entity=fact-A&limit=1',
    });

    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.events).toHaveLength(1);
    expect(firstBody.next_cursor).toEqual(expect.any(String));

    const firstEdgeQuery = pool.query.mock.calls[1] as [string, unknown[]];
    expect(firstEdgeQuery[0]).toContain('ORDER BY effective_from DESC');
    expect(firstEdgeQuery[1]).toContain(2);

    const second = await app.inject({
      method: 'GET',
      url: `/api/memory/timeline?entity=fact-A&limit=1&cursor=${encodeURIComponent(firstBody.next_cursor)}`,
    });

    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.events).toHaveLength(1);
    expect(secondBody.next_cursor).toBeNull();

    const secondEdgeQuery = pool.query.mock.calls[3] as [string, unknown[]];
    expect(secondEdgeQuery[1]).toEqual(
      expect.arrayContaining(['2026-04-04T00:00:00.000Z', '2026-04-05T00:00:00.000Z', 'edge-2']),
    );
  });

  it('echoes as_of, marks entity activity, and pushes the validity filter into SQL', async () => {
    const asOf = '2026-04-10T00:00:00.000Z';
    pool.query
      .mockResolvedValueOnce({
        rows: [
          makeFactRow('fact-A', {
            valid_from: '2026-04-01T00:00:00.000Z',
            valid_until: '2026-04-09T00:00:00.000Z',
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await app.inject({
      method: 'GET',
      url: `/api/memory/timeline?entity=fact-A&as_of=${encodeURIComponent(asOf)}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.as_of).toBe(asOf);
    expect(body.entity.active_at_as_of).toBe(false);
    expect(body.events).toEqual([]);

    const edgeCall = pool.query.mock.calls.find((call) => String(call[0]).includes('memory_edges'));
    expect(edgeCall).toBeDefined();
    const [, values] = edgeCall as [string, unknown[]];
    expect(values).toEqual(expect.arrayContaining([asOf]));
  });

  it('accepts asOf as an alias for as_of', async () => {
    const asOf = '2026-04-10T00:00:00.000Z';
    pool.query.mockResolvedValueOnce({ rows: [makeFactRow('fact-A')] }).mockResolvedValueOnce({
      rows: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/memory/timeline?entity=fact-A&asOf=${encodeURIComponent(asOf)}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.as_of).toBe(asOf);

    const edgeCall = pool.query.mock.calls.find((call) => String(call[0]).includes('memory_edges'));
    expect(edgeCall).toBeDefined();
    const [, values] = edgeCall as [string, unknown[]];
    expect(values).toEqual(expect.arrayContaining([asOf]));
  });

  it('accepts matching as_of and asOf aliases', async () => {
    const normalizedAsOf = '2026-04-10T00:00:00.000Z';
    pool.query.mockResolvedValueOnce({ rows: [makeFactRow('fact-A')] }).mockResolvedValueOnce({
      rows: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/memory/timeline?entity=fact-A&as_of=${encodeURIComponent('2026-04-10T00:00:00Z')}&asOf=${encodeURIComponent(normalizedAsOf)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().as_of).toBe(normalizedAsOf);
  });
});
