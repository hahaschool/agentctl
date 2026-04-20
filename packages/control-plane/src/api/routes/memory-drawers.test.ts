// ---------------------------------------------------------------------------
// Tests for GET /api/memory/drawers/search + /:drawerId
//
// §4.16 MemPalace-inspired Memory Evolution Plan — PR F / Phase 4 Step 6.
//
// Mirrors the pg-pool mock style already used by memory-traverse.test.ts and
// memory-consolidation.test.ts (see ./test-helpers.ts). Each test seeds the
// `pool.query` mock with the rows the route would expect to see at each SQL
// call site. The search handler issues BOTH the keyword and vector queries in
// parallel, so mocks are attached via `mockImplementation` that routes off the
// SQL text instead of sequential `mockResolvedValueOnce`.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServer } from '../server.js';
import type { DrawerEmbeddingClient } from './memory-drawers.js';
import { memoryDrawerRoutes } from './memory-drawers.js';
import { createMockLogger } from './test-helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type QueryFn = ReturnType<typeof vi.fn>;

type PoolMock = {
  query: QueryFn;
};

function createMockPool(): PoolMock {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

type SearchRow = {
  id: string;
  scope: string;
  topic: string;
  source_type: string;
  source_id: string;
  chunk_index: number;
  content: string;
  score: number;
  rank: number;
};

function makeSearchRow(overrides: Partial<SearchRow> = {}): SearchRow {
  return {
    id: 'drawer-A',
    scope: 'session:sess-1',
    topic: 'general',
    source_type: 'session-jsonl',
    source_id: 'sess-1',
    chunk_index: 0,
    content: 'hello world of drawer content'.repeat(4),
    score: 0.5,
    rank: 1,
    ...overrides,
  };
}

function makeDrawerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date('2026-04-20T12:00:00.000Z');
  return {
    id: 'drawer-A',
    scope: 'session:sess-1',
    topic: 'general',
    source_type: 'session-jsonl',
    source_id: 'sess-1',
    source_uri: null,
    chunk_index: 0,
    content: 'drawer body content',
    content_sha256: 'sha256-abc123',
    embedding_model: 'text-embedding-3-small',
    embedding_version: 1,
    token_count: 12,
    source_json: { session_id: 'sess-1' },
    sync_visibility: 'local',
    retention_expires_at: null,
    archived_at: null,
    redaction_status: 'unreviewed',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/**
 * Route the `pool.query` mock by SQL text. Lets us mock keyword + vector
 * paths independently even though they run in parallel via Promise.all().
 */
function routeQueries(
  pool: PoolMock,
  routes: {
    keyword?: SearchRow[];
    vector?: SearchRow[];
    getById?: Record<string, unknown> | null;
  },
): void {
  pool.query.mockImplementation(async (sql: string) => {
    if (sql.includes('content_tsv_simple')) {
      return { rows: routes.keyword ?? [] };
    }
    if (sql.includes('embedding <=>')) {
      return { rows: routes.vector ?? [] };
    }
    if (sql.includes('WHERE id = $1')) {
      // Simulate the archived-at filter in the drawer-by-id SQL: rows with a
      // non-null `archived_at` must not be returned when the query includes
      // `archived_at IS NULL` (matches the production contract).
      if (sql.includes('archived_at IS NULL') && routes.getById?.archived_at) {
        return { rows: [] };
      }
      return { rows: routes.getById ? [routes.getById] : [] };
    }
    return { rows: [] };
  });
}

async function buildApp(
  pool: PoolMock,
  embeddingClient?: DrawerEmbeddingClient,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(memoryDrawerRoutes, {
    prefix: '/api/memory/drawers',
    pool: pool as never,
    logger: createMockLogger(),
    embeddingClient,
  });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('memory-drawers routes', () => {
  let app: FastifyInstance;
  let pool: PoolMock;

  beforeEach(async () => {
    pool = createMockPool();
    app = await buildApp(pool);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  // ── GET /search — validation ─────────────────────────────────────────────

  describe('GET /search validation', () => {
    it('returns 400 when q is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/memory/drawers/search' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'INVALID_PARAMS' });
    });

    it('returns 200 with empty results when q sanitizes to empty', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=%20%20%20',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, results: [] });
      // Critical: must NOT run any SQL when the query sanitizes to empty.
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('returns 400 when q exceeds MAX_QUERY_LENGTH', async () => {
      const q = 'a'.repeat(1_025);
      const res = await app.inject({
        method: 'GET',
        url: `/api/memory/drawers/search?q=${q}`,
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when scope is an empty string', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=hello&scope=%20',
      });
      expect(res.statusCode).toBe(400);
    });

    it.each([
      '-3',
      'abc',
      '10abc',
      '1.5',
      '+5',
      '0x10',
    ])('returns 400 when limit is malformed: %s', async (limit) => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/memory/drawers/search?q=hello&limit=${encodeURIComponent(limit)}`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'INVALID_PARAMS' });
    });
  });

  // ── GET /search — error handling ─────────────────────────────────────────

  describe('GET /search error handling', () => {
    it('surfaces total DB failures as 5xx instead of a false empty index', async () => {
      // Both keyword and vector paths hit the pool; rejecting every call
      // simulates a Postgres outage.
      pool.query.mockRejectedValue(new Error('database unavailable'));

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=hello',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({
        error: 'MEMORY_DRAWER_SEARCH_DB_ERROR',
      });
    });
  });

  // ── GET /search — happy paths ────────────────────────────────────────────

  describe('GET /search happy path', () => {
    it('returns 200 with empty results when DB has no matches', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=hello',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, results: [] });
    });

    it('returns keyword-only matches when no embedding client is provided', async () => {
      routeQueries(pool, {
        keyword: [
          makeSearchRow({ id: 'drawer-A', score: 0.8, rank: 1 }),
          makeSearchRow({ id: 'drawer-B', score: 0.4, rank: 2 }),
        ],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=hello',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.results).toHaveLength(2);
      expect(body.results[0]).toMatchObject({
        id: 'drawer-A',
        match_type: 'keyword',
        scope: 'session:sess-1',
        topic: 'general',
        source_type: 'session-jsonl',
        chunk_index: 0,
      });
      // content_preview is capped and derived from content column
      expect(body.results[0].content_preview.length).toBeLessThanOrEqual(240);
      // RRF score, not raw tsvector rank
      expect(typeof body.results[0].score).toBe('number');
    });

    it('fuses keyword + vector matches via RRF when embedding client is provided', async () => {
      const embeddingClient: DrawerEmbeddingClient = {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      };
      await app.close();
      app = await buildApp(pool, embeddingClient);

      routeQueries(pool, {
        keyword: [makeSearchRow({ id: 'drawer-A', rank: 1 })],
        vector: [
          makeSearchRow({ id: 'drawer-A', rank: 1 }),
          makeSearchRow({ id: 'drawer-B', rank: 2 }),
        ],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=hello',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Drawer-A surfaces from both paths, so its RRF score is larger than B's
      expect(body.results[0].id).toBe('drawer-A');
      expect(body.results[0].match_type).toBe('vector');
      expect(body.results[1].id).toBe('drawer-B');
      expect(body.results[0].score).toBeGreaterThan(body.results[1].score);
    });

    it('falls back to keyword-only when the embedding client throws', async () => {
      const embeddingClient: DrawerEmbeddingClient = {
        embed: vi.fn().mockRejectedValue(new Error('LiteLLM unreachable')),
      };
      await app.close();
      app = await buildApp(pool, embeddingClient);

      routeQueries(pool, {
        keyword: [makeSearchRow({ id: 'drawer-A', rank: 1 })],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=hello',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().results).toHaveLength(1);
      expect(res.json().results[0].id).toBe('drawer-A');
    });

    it('passes scope filter through to both SQL paths', async () => {
      const embeddingClient: DrawerEmbeddingClient = {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      };
      await app.close();
      app = await buildApp(pool, embeddingClient);

      routeQueries(pool, {
        keyword: [makeSearchRow({ scope: 'session:sess-1' })],
        vector: [makeSearchRow({ scope: 'session:sess-1' })],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=hello&scope=session%3Asess-1',
      });
      expect(res.statusCode).toBe(200);

      // Both calls should carry the scope parameter.
      const calls = pool.query.mock.calls;
      const keywordCall = calls.find((call) => String(call[0]).includes('content_tsv_simple'));
      const vectorCall = calls.find((call) => String(call[0]).includes('embedding <=>'));
      expect(keywordCall).toBeDefined();
      expect(vectorCall).toBeDefined();
      if (keywordCall) {
        expect(keywordCall[1]).toEqual(expect.arrayContaining(['session:sess-1']));
      }
      if (vectorCall) {
        expect(vectorCall[1]).toEqual(expect.arrayContaining(['session:sess-1']));
      }
    });

    it('clamps limit to MAX_LIMIT', async () => {
      routeQueries(pool, {
        keyword: [makeSearchRow()],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=hello&limit=5000',
      });
      expect(res.statusCode).toBe(200);

      const call = pool.query.mock.calls.find((c) => String(c[0]).includes('content_tsv_simple'));
      expect(call).toBeDefined();
      if (call) {
        // Requested limit clamps to MAX_LIMIT=100. Per-path candidate fetch
        // = max(CANDIDATE_LIMIT, clamped limit) = max(50, 100) = 100.
        const limitArg = (call[1] as unknown[])[(call[1] as unknown[]).length - 1];
        expect(Number(limitArg)).toBeLessThanOrEqual(100);
      }
    });

    it('raises per-path fetch window to the requested limit up to MAX_LIMIT', async () => {
      routeQueries(pool, {
        keyword: [makeSearchRow()],
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=hello&limit=75',
      });
      expect(res.statusCode).toBe(200);

      const call = pool.query.mock.calls.find((c) => String(c[0]).includes('content_tsv_simple'));
      expect(call).toBeDefined();
      if (call) {
        // Per-path candidate fetch = max(CANDIDATE_LIMIT=50, requested=75) = 75.
        // Without this change, the keyword path would only fetch 50 rows and
        // silently cap results below the user's `limit=75`.
        const limitArg = (call[1] as unknown[])[(call[1] as unknown[]).length - 1];
        expect(Number(limitArg)).toBe(75);
      }
    });

    it('defaults to limit=10 when unspecified', async () => {
      // Seed 15 keyword rows — the route should only return 10 after fusion.
      const rows = Array.from({ length: 15 }, (_, i) =>
        makeSearchRow({ id: `drawer-${i}`, rank: i + 1 }),
      );
      routeQueries(pool, { keyword: rows });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=hello',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().results).toHaveLength(10);
    });

    it('returns 200 empty results when keyword query is unusable (all short tokens)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=a',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, results: [] });
      // No SQL run because tokens were all dropped before reaching the DB.
      const calls = pool.query.mock.calls.filter((c) => String(c[0]).includes('memory_drawers'));
      // Keyword path early-returns when no tokens remain, so only the vector
      // path may run — but we have no embedding client here so neither runs.
      expect(calls).toHaveLength(0);
    });
  });

  // ── GET /:drawerId — validation ─────────────────────────────────────────

  describe('GET /:drawerId validation', () => {
    it('returns 400 when drawerId contains path traversal tokens', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/..%2Fetc%2Fpasswd',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'INVALID_PARAMS' });
    });

    it('returns 400 when drawerId contains a null byte', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/abc%00def',
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when drawerId is URL-decoded to an unsafe id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/foo%20bar',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /:drawerId — happy/404 ──────────────────────────────────────────

  describe('GET /:drawerId lookups', () => {
    it('returns 404 DRAWER_NOT_FOUND when no row exists', async () => {
      routeQueries(pool, { getById: null });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/drawer-missing',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'DRAWER_NOT_FOUND' });
    });

    it('returns 200 with the full MemoryDrawer when the row exists', async () => {
      routeQueries(pool, { getById: makeDrawerRow({ id: 'drawer-A' }) });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/drawer-A',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.drawer).toMatchObject({
        id: 'drawer-A',
        scope: 'session:sess-1',
        content: 'drawer body content',
        contentSha256: 'sha256-abc123',
        embeddingModel: 'text-embedding-3-small',
        sourceType: 'session-jsonl',
        redactionStatus: 'unreviewed',
      });
      // Timestamps are ISO strings
      expect(typeof body.drawer.createdAt).toBe('string');
      expect(typeof body.drawer.updatedAt).toBe('string');
    });

    it('returns 404 when row exists but required worker fields are missing', async () => {
      // Worker requires: id, scope, content, contentSha256, embeddingModel.
      // Drop content_sha256 to simulate an incomplete record.
      routeQueries(pool, {
        getById: makeDrawerRow({ id: 'drawer-A', content_sha256: '' }),
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/drawer-A',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'DRAWER_NOT_FOUND' });
    });

    it('returns 404 when the drawer row is archived (archived_at IS NOT NULL)', async () => {
      // Simulates a soft-deleted drawer. The route SQL includes
      // `archived_at IS NULL` so the pool returns no row.
      routeQueries(pool, {
        getById: makeDrawerRow({
          id: 'drawer-A',
          archived_at: new Date('2026-04-20T13:00:00Z'),
        }),
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/drawer-A',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'DRAWER_NOT_FOUND' });

      // Verify the route SQL actually carries the archived-at filter.
      const call = pool.query.mock.calls.find((c) => String(c[0]).includes('WHERE id = $1'));
      expect(call).toBeDefined();
      expect(String(call?.[0])).toContain('archived_at IS NULL');
    });

    it('URL-decodes the :drawerId param before DB lookup', async () => {
      routeQueries(pool, { getById: makeDrawerRow({ id: 'drawer.A:1' }) });

      const res = await app.inject({
        method: 'GET',
        url: `/api/memory/drawers/${encodeURIComponent('drawer.A:1')}`,
      });
      expect(res.statusCode).toBe(200);

      const call = pool.query.mock.calls.find((c) => String(c[0]).includes('WHERE id = $1'));
      expect(call).toBeDefined();
      if (call) {
        expect(call[1]).toEqual(['drawer.A:1']);
      }
    });
  });

  // ── createServer-level wiring (#704 follow-up) ──────────────────────────
  //
  // The plugin-level tests above prove `memoryDrawerRoutes` uses the
  // embeddingClient when it's forwarded via `opts`. These tests prove the
  // `createServer({ embeddingClient, pgPool })` contract now forwards the
  // option all the way down to the registered plugin — so production drawer
  // search will actually exercise the vector path when LITELLM_URL is set.

  describe('createServer forwards embeddingClient to memoryDrawerRoutes', () => {
    it('invokes embeddingClient.embed() via GET /api/memory/drawers/search when wired through createServer', async () => {
      const serverPool: PoolMock = createMockPool();
      routeQueries(serverPool, {
        keyword: [makeSearchRow({ id: 'drawer-A', rank: 1 })],
        vector: [makeSearchRow({ id: 'drawer-A', rank: 1 })],
      });

      const embed = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
      const embeddingClient: DrawerEmbeddingClient = { embed };

      const server = await createServer({
        logger: createMockLogger(),
        pgPool: serverPool as never,
        embeddingClient,
      });
      await server.ready();

      try {
        const res = await server.inject({
          method: 'GET',
          url: '/api/memory/drawers/search?q=hello',
        });
        expect(res.statusCode).toBe(200);

        // Embedding client was consumed — proves createServer forwards the
        // option into memoryDrawerRoutes registration.
        expect(embed).toHaveBeenCalledTimes(1);
        expect(embed).toHaveBeenCalledWith('hello');

        // And the vector SQL path ran with the returned vector.
        const vectorCall = serverPool.query.mock.calls.find((c) =>
          String(c[0]).includes('embedding <=>'),
        );
        expect(vectorCall).toBeDefined();
      } finally {
        await server.close();
      }
    });

    it('falls back to keyword-only when createServer is called without embeddingClient', async () => {
      const serverPool: PoolMock = createMockPool();
      routeQueries(serverPool, {
        keyword: [makeSearchRow({ id: 'drawer-A', rank: 1 })],
      });

      const server = await createServer({
        logger: createMockLogger(),
        pgPool: serverPool as never,
        // No embeddingClient — drawer search must still work.
      });
      await server.ready();

      try {
        const res = await server.inject({
          method: 'GET',
          url: '/api/memory/drawers/search?q=hello',
        });
        expect(res.statusCode).toBe(200);

        // No vector SQL path should have run.
        const vectorCall = serverPool.query.mock.calls.find((c) =>
          String(c[0]).includes('embedding <=>'),
        );
        expect(vectorCall).toBeUndefined();
      } finally {
        await server.close();
      }
    });
  });
});
