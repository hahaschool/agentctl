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

    it('returns 400 when limit is negative', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=hello&limit=-3',
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when limit is not an integer', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/memory/drawers/search?q=hello&limit=abc',
      });
      expect(res.statusCode).toBe(400);
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
        // The route clamps to 100 but then uses CANDIDATE_LIMIT (50) for the
        // per-path fetch; assert the SQL placeholder received <= 100 either way.
        const limitArg = (call[1] as unknown[])[(call[1] as unknown[]).length - 1];
        expect(Number(limitArg)).toBeLessThanOrEqual(100);
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
});
