import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { memoryImportRoutes, resetActiveJobForTest } from './memory-import.js';

async function buildApp() {
  const app = Fastify({ logger: false });
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
  // POST /api/memory/import
  // ---------------------------------------------------------------------------

  describe('POST /api/memory/import', () => {
    it('returns 202 and a running job when no job is active', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'claude-mem', dbPath: '/tmp/claude-mem.db' },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json<{ ok: boolean; job: { status: string; id: string } }>();
      expect(body.ok).toBe(true);
      expect(body.job.status).toBe('running');
      expect(typeof body.job.id).toBe('string');
    });

    it('returns 409 when a job is already running', async () => {
      // Start first job
      await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'claude-mem', dbPath: '/tmp/claude-mem.db' },
      });
      // Second attempt should fail
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'jsonl-history', dbPath: '/tmp/history.jsonl' },
      });
      expect(res.statusCode).toBe(409);
      const body = res.json<{ ok: boolean }>();
      expect(body.ok).toBe(false);
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

    it('sets importedAt and startedAt timestamps', async () => {
      const before = Date.now();
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'jsonl-history', dbPath: '/tmp/history.jsonl' },
      });
      const body = res.json<{ job: { startedAt: string; completedAt: string | null } }>();
      expect(new Date(body.job.startedAt).getTime()).toBeGreaterThanOrEqual(before);
      expect(body.job.completedAt).toBeNull();
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

    it('returns 200 with the active job after starting one', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'claude-mem', dbPath: '/tmp/x.db' },
      });
      const res = await app.inject({ method: 'GET', url: '/api/memory/import/status' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ ok: boolean; job: { status: string } }>();
      expect(body.ok).toBe(true);
      expect(body.job.status).toBeDefined();
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
      await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'claude-mem', dbPath: '/tmp/x.db' },
      });
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/memory/import/wrong-id',
      });
      expect(res.statusCode).toBe(404);
    });

    it('cancels the active job and returns 200', async () => {
      const startRes = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'claude-mem', dbPath: '/tmp/x.db' },
      });
      const { job } = startRes.json<{ job: { id: string } }>();
      const cancelRes = await app.inject({
        method: 'DELETE',
        url: `/api/memory/import/${job.id}`,
      });
      expect(cancelRes.statusCode).toBe(200);
      const body = cancelRes.json<{ ok: boolean; job: { status: string; completedAt: string } }>();
      expect(body.ok).toBe(true);
      expect(body.job.status).toBe('cancelled');
      expect(body.job.completedAt).toBeDefined();
    });
  });
});
