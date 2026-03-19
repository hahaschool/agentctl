import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryConsolidationRoutes } from './memory-consolidation.js';
import { createMockLogger } from './test-helpers.js';

// ---------------------------------------------------------------------------
// Pool mock
// ---------------------------------------------------------------------------

function createMockPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  };
}

// ---------------------------------------------------------------------------
// Row factories
// ---------------------------------------------------------------------------

function makeContradictionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    edge_id: 'edge-1',
    source_fact_id: 'fact-a',
    target_fact_id: 'fact-b',
    source_content: 'The sky is blue',
    target_content: 'The sky is green',
    edge_created_at: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeNearDuplicateRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fact_id_a: 'fact-1',
    fact_id_b: 'fact-2',
    similarity: 0.92,
    content_a: 'Use functional components in React',
    content_b: 'React functional components are preferred',
    ...overrides,
  };
}

function makeStaleRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fact_id: 'fact-stale-1',
    content: 'Old API pattern for v1',
    accessed_at: new Date('2024-01-01T00:00:00Z'),
    days_since_access: 45,
    ...overrides,
  };
}

function makeOrphanRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fact_id: 'fact-orphan-1',
    content: 'Isolated note about caching',
    entity_type: 'pattern',
    created_at: new Date('2024-06-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('memory-consolidation routes', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createMockPool>;

  beforeEach(async () => {
    pool = createMockPool();

    app = Fastify({ logger: false });
    await app.register(memoryConsolidationRoutes, {
      prefix: '/api/memory/consolidation',
      pool: pool as never,
      logger: createMockLogger(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  // ── GET / ─────────────────────────────────────────────────────────────────

  describe('GET /api/memory/consolidation', () => {
    it('returns all item types when no filter is provided', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeContradictionRow()] }) // contradictions
        .mockResolvedValueOnce({ rows: [makeNearDuplicateRow()] }) // near-duplicates
        .mockResolvedValueOnce({ rows: [makeStaleRow()] }) // stale
        .mockResolvedValueOnce({ rows: [makeOrphanRow()] }); // orphans

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.total).toBe(4);
      expect(body.items).toHaveLength(4);
    });

    it('filters by type=contradiction', async () => {
      pool.query.mockResolvedValueOnce({ rows: [makeContradictionRow()] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation?type=contradiction',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].type).toBe('contradiction');
      expect(body.items[0].id).toBe('contradiction-edge-1');
    });

    it('filters by type=near-duplicate', async () => {
      pool.query.mockResolvedValueOnce({ rows: [makeNearDuplicateRow()] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation?type=near-duplicate',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].type).toBe('near-duplicate');
      expect(body.items[0].id).toBe('near-duplicate-fact-1-fact-2');
    });

    it('filters by type=stale', async () => {
      pool.query.mockResolvedValueOnce({ rows: [makeStaleRow()] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation?type=stale',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].type).toBe('stale');
      expect(body.items[0].id).toBe('stale-fact-stale-1');
    });

    it('filters by type=orphan', async () => {
      pool.query.mockResolvedValueOnce({ rows: [makeOrphanRow()] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation?type=orphan',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].type).toBe('orphan');
      expect(body.items[0].id).toBe('orphan-fact-orphan-1');
    });

    it('returns empty list for unknown type filter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation?type=unknown',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
      // pool should NOT be queried for invalid types
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns empty list for status=accepted', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation?status=accepted',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.items).toHaveLength(0);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns empty list for status=skipped', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation?status=skipped',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.items).toHaveLength(0);
    });

    it('returns all items for status=pending', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeContradictionRow()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation?status=pending',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.items).toHaveLength(1);
    });

    it('returns empty list for unknown status filter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation?status=invalid-status',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.items).toHaveLength(0);
    });

    it('respects custom limit parameter', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation?limit=10',
      });

      expect(res.statusCode).toBe(200);
      // Verify limit was passed to pool.query — all 4 queries use limit=10
      expect(pool.query).toHaveBeenCalledTimes(4);
      const firstCallArgs = pool.query.mock.calls[0];
      expect(firstCallArgs[1]).toContain(10);
    });

    it('clamps limit to a minimum of 1', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation?limit=-100',
      });

      expect(res.statusCode).toBe(200);
      const firstCallArgs = pool.query.mock.calls[0];
      expect(firstCallArgs[1][0]).toBeGreaterThanOrEqual(1);
    });

    it('clamps limit to a maximum of 200', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation?limit=9999',
      });

      expect(res.statusCode).toBe(200);
      const firstCallArgs = pool.query.mock.calls[0];
      expect(firstCallArgs[1][0]).toBeLessThanOrEqual(200);
    });

    it('returns empty results and continues when one query fails', async () => {
      pool.query
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ rows: [makeNearDuplicateRow()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation',
      });

      // Should still return 200 — failed type is silently skipped
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.items).toHaveLength(1);
    });

    it('returns correct item shape for contradiction', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [makeContradictionRow()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation',
      });

      const body = res.json();
      const item = body.items[0];
      expect(item.type).toBe('contradiction');
      expect(item.severity).toBe('high');
      expect(item.status).toBe('pending');
      expect(item.factIds).toEqual(['fact-a', 'fact-b']);
      expect(item.suggestion).toBeTruthy();
      expect(item.reason).toBeTruthy();
      expect(item.createdAt).toBeTruthy();
    });

    it('returns correct item shape for near-duplicate', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeNearDuplicateRow()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation',
      });

      const body = res.json();
      const item = body.items[0];
      expect(item.type).toBe('near-duplicate');
      expect(item.severity).toBe('medium');
      expect(item.factIds).toEqual(['fact-1', 'fact-2']);
    });

    it('returns correct item shape for stale', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeStaleRow()] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation',
      });

      const body = res.json();
      const item = body.items[0];
      expect(item.type).toBe('stale');
      expect(item.severity).toBe('low');
      expect(item.factIds).toEqual(['fact-stale-1']);
    });

    it('returns correct item shape for orphan', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeOrphanRow()] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation',
      });

      const body = res.json();
      const item = body.items[0];
      expect(item.type).toBe('orphan');
      expect(item.severity).toBe('low');
      expect(item.factIds).toEqual(['fact-orphan-1']);
    });

    it('returns empty list when no items exist', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/consolidation',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });
  });

  // ── POST /:id/action ──────────────────────────────────────────────────────

  describe('POST /api/memory/consolidation/:id/action', () => {
    it('accepts a consolidation item with action=accept and status=accepted', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/consolidation/contradiction-edge-1/action',
        payload: { action: 'accept', status: 'accepted' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
    });

    it('skips a consolidation item with action=skip and status=skipped', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/consolidation/stale-fact-1/action',
        payload: { action: 'skip', status: 'skipped' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
    });

    it('accepts status=pending for reset scenarios', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/consolidation/orphan-fact-1/action',
        payload: { action: 'reset', status: 'pending' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
    });

    it('returns 400 when action is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/consolidation/contradiction-edge-1/action',
        payload: { status: 'accepted' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when status is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/consolidation/contradiction-edge-1/action',
        payload: { action: 'accept' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when status is not a valid enum value', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/consolidation/contradiction-edge-1/action',
        payload: { action: 'accept', status: 'invalid-status' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when body is entirely missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/consolidation/contradiction-edge-1/action',
      });

      expect(res.statusCode).toBe(400);
    });

    it('works with arbitrary id formats', async () => {
      const ids = [
        'contradiction-abc-123',
        'near-duplicate-fact-a-fact-b',
        'stale-00000000-0000-4000-a000-000000000001',
        'orphan-42',
      ];

      for (const id of ids) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/memory/consolidation/${id}/action`,
          payload: { action: 'accept', status: 'accepted' },
        });
        expect(res.statusCode).toBe(200);
      }
    });
  });
});
