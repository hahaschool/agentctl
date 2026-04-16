import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { memoryImportRoutes, resetActiveJobForTest } from './memory-import.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  // Register without pool — preview/import will return 503/400 for DB-dependent paths
  await app.register(memoryImportRoutes, { prefix: '/api/memory' });
  await app.ready();
  return app;
}

describe('memoryImportRoutes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    resetActiveJobForTest();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    resetActiveJobForTest();
  });

  // ---------------------------------------------------------------------------
  // POST /api/memory/import/preview
  // ---------------------------------------------------------------------------

  describe('POST /api/memory/import/preview', () => {
    it('returns 400 for unsupported source type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import/preview',
        payload: { source: 'jsonl-history', dbPath: '/tmp/x' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ ok: boolean; error: string }>();
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Only claude-mem');
    });

    it('returns 400 for non-existent file', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import/preview',
        payload: { source: 'claude-mem', dbPath: '/tmp/nonexistent-test-db-12345.db' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ ok: boolean; error: string }>();
      expect(body.ok).toBe(false);
      expect(body.error).toContain('File not found');
    });

    it('returns 400 when body is missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import/preview',
        payload: { source: 'claude-mem' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/memory/import
  // ---------------------------------------------------------------------------

  describe('POST /api/memory/import', () => {
    it('returns 503 when no pool is configured', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'claude-mem', dbPath: '/tmp/claude-mem.db' },
      });
      expect(res.statusCode).toBe(503);
      const body = res.json<{ ok: boolean; error: string }>();
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Database not configured');
    });

    it('returns 400 for unsupported source type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'jsonl-history', dbPath: '/tmp/history.jsonl' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when body is missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'claude-mem' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when source is an invalid value', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'unknown-source', dbPath: '/tmp/x.db' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/memory/import/status
  // ---------------------------------------------------------------------------

  describe('GET /api/memory/import/status', () => {
    it('returns 404 when no job is active', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/memory/import/status' });
      expect(res.statusCode).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/memory/import/:id
  // ---------------------------------------------------------------------------

  describe('DELETE /api/memory/import/:id', () => {
    it('returns 404 when no job is active', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/memory/import/nonexistent-id',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when id does not match active job', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/memory/import/wrong-id',
      });
      expect(res.statusCode).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------
// Rate limiting — memory-import write paths mutate a singleton job state and
// spawn a long-running progress interval. A flood can repeatedly toggle the
// interval or exhaust the in-memory job slot.
// ---------------------------------------------------------------------------

describe('Memory import rate limiting — /api/memory/import', () => {
  const originalMax = process.env.MEMORY_IMPORT_RATE_LIMIT_MAX;
  const originalWindow = process.env.MEMORY_IMPORT_RATE_LIMIT_WINDOW_MS;

  beforeAll(() => {
    process.env.MEMORY_IMPORT_RATE_LIMIT_MAX = '3';
    process.env.MEMORY_IMPORT_RATE_LIMIT_WINDOW_MS = '60000';
  });

  afterAll(() => {
    if (originalMax === undefined) delete process.env.MEMORY_IMPORT_RATE_LIMIT_MAX;
    else process.env.MEMORY_IMPORT_RATE_LIMIT_MAX = originalMax;
    if (originalWindow === undefined) delete process.env.MEMORY_IMPORT_RATE_LIMIT_WINDOW_MS;
    else process.env.MEMORY_IMPORT_RATE_LIMIT_WINDOW_MS = originalWindow;
  });

  it('returns 429 after exceeding the configured limit on POST /import', async () => {
    resetActiveJobForTest();
    const app = Fastify({ logger: false });
    await app.register(memoryImportRoutes, { prefix: '/api/memory' });
    await app.ready();

    try {
      const payload = { source: 'claude-mem', dbPath: '/tmp/claude-mem.db' };
      // All requests hit 503 (no pool) or 400 (unsupported), but still count toward rate limit
      for (let i = 0; i < 3; i += 1) {
        const ok = await app.inject({
          method: 'POST',
          url: '/api/memory/import',
          payload,
          headers: { 'x-forwarded-for': '10.0.0.70' },
          remoteAddress: '10.0.0.70',
        });
        expect([400, 503]).toContain(ok.statusCode);
      }

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload,
        headers: { 'x-forwarded-for': '10.0.0.70' },
        remoteAddress: '10.0.0.70',
      });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error).toBe('RATE_LIMITED');
    } finally {
      await app.close();
      resetActiveJobForTest();
    }
  });
});
