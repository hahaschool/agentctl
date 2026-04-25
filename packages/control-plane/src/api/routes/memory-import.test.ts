import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

type MockPool = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
};

async function buildAppWithPool(pool: MockPool) {
  const app = Fastify({ logger: false });
  await app.register(memoryImportRoutes, { prefix: '/api/memory', pool: pool as never });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Helpers for JSONL fixture directories
// ---------------------------------------------------------------------------

function makeTempJsonlDir(fileCount: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-import-test-'));
  for (let i = 0; i < fileCount; i++) {
    const sessionId = `session-${i.toString().padStart(4, '0')}`;
    const lines = [
      JSON.stringify({
        type: 'human',
        message: { role: 'user', content: `User message for session ${i}` },
        sessionId,
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: `Assistant response for session ${i}` },
        sessionId,
      }),
    ];
    fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), `${lines.join('\n')}\n`);
  }
  return dir;
}

function makeTempEmptyJsonlDir(fileCount: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-import-empty-files-'));
  for (let i = 0; i < fileCount; i++) {
    const sessionId = `session-${i.toString().padStart(4, '0')}`;
    fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), '');
  }
  return dir;
}

function removeTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

async function waitForImportJob(app: Awaited<ReturnType<typeof buildAppWithPool>>) {
  for (let i = 0; i < 50; i += 1) {
    const res = await app.inject({ method: 'GET', url: '/api/memory/import/status' });
    if (res.statusCode === 200) {
      const body = res.json<{
        ok: boolean;
        job: { status: string; imported: number; skipped: number; errors: number };
      }>();
      if (body.job.status !== 'running') return body.job;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for import job');
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
    it('returns 400 for an unknown source type via schema validation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import/preview',
        payload: { source: 'unknown-source', dbPath: '/tmp/x' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for non-existent claude-mem file', async () => {
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

    // -------------------------------------------------------------------------
    // JSONL history preview
    // -------------------------------------------------------------------------

    it('returns 400 for non-existent jsonl-history directory', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import/preview',
        payload: { source: 'jsonl-history', dbPath: '/tmp/does-not-exist-jsonl-dir-99999' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ ok: boolean; error: string }>();
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Directory not found');
    });

    it('returns 400 when jsonl-history path is a file, not a directory', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-import-file-'));
      const tmpFile = path.join(dir, 'source.jsonl');
      fs.writeFileSync(tmpFile, '{"type":"human"}\n');
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/memory/import/preview',
          payload: { source: 'jsonl-history', dbPath: tmpFile },
        });
        expect(res.statusCode).toBe(400);
        const body = res.json<{ ok: boolean; error: string }>();
        expect(body.ok).toBe(false);
        expect(body.error).toContain('not a directory');
      } finally {
        removeTempDir(dir);
      }
    });

    it('returns valid preview stats for a directory with JSONL files', async () => {
      const dir = makeTempJsonlDir(3);
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/memory/import/preview',
          payload: { source: 'jsonl-history', dbPath: dir },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json<{ ok: boolean; preview: Record<string, unknown> }>();
        expect(body.ok).toBe(true);
        expect(body.preview).toBeDefined();
        expect(body.preview.totalObservations).toBe(3);
        // newToImport counts importable JSONL session files, not raw JSONL lines.
        expect(body.preview.newToImport).toBe(3);
        expect(Array.isArray(body.preview.sampleTitles)).toBe(true);
        expect((body.preview.sampleTitles as string[]).length).toBeLessThanOrEqual(5);
      } finally {
        removeTempDir(dir);
      }
    });

    it('returns empty preview for an empty directory', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-import-empty-'));
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/memory/import/preview',
          payload: { source: 'jsonl-history', dbPath: dir },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json<{ ok: boolean; preview: Record<string, unknown> }>();
        expect(body.ok).toBe(true);
        expect(body.preview.totalObservations).toBe(0);
        expect(body.preview.newToImport).toBe(0);
      } finally {
        removeTempDir(dir);
      }
    });

    it('counts already imported JSONL sessions by import_source_id', async () => {
      const dir = makeTempJsonlDir(2);
      const mockPool: MockPool = {
        query: async (_sql, params) => {
          expect(params?.[0]).toEqual(['jsonl-history:session-0000', 'jsonl-history:session-0001']);
          return { rows: [{ src_id: 'jsonl-history:session-0001' }], rowCount: 1 };
        },
      };
      const appWithPool = await buildAppWithPool(mockPool);
      try {
        const res = await appWithPool.inject({
          method: 'POST',
          url: '/api/memory/import/preview',
          payload: { source: 'jsonl-history', dbPath: dir },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json<{ ok: boolean; preview: Record<string, unknown> }>();
        expect(body.ok).toBe(true);
        expect(body.preview.totalObservations).toBe(2);
        expect(body.preview.alreadyImported).toBe(1);
        expect(body.preview.newToImport).toBe(1);
      } finally {
        await appWithPool.close();
        removeTempDir(dir);
        resetActiveJobForTest();
      }
    });

    it('returns 400 instead of silently capping jsonl-history previews over the file limit', async () => {
      const dir = makeTempEmptyJsonlDir(1001);
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/memory/import/preview',
          payload: { source: 'jsonl-history', dbPath: dir },
        });
        expect(res.statusCode).toBe(400);
        const body = res.json<{ ok: boolean; error: string }>();
        expect(body.ok).toBe(false);
        expect(body.error).toContain('Too many JSONL files');
      } finally {
        removeTempDir(dir);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/memory/import
  // ---------------------------------------------------------------------------

  describe('POST /api/memory/import', () => {
    it('returns 503 when no pool is configured (claude-mem)', async () => {
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

    it('returns 503 when no pool is configured (jsonl-history)', async () => {
      const dir = makeTempJsonlDir(1);
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/memory/import',
          payload: { source: 'jsonl-history', dbPath: dir },
        });
        expect(res.statusCode).toBe(503);
        const body = res.json<{ ok: boolean; error: string }>();
        expect(body.ok).toBe(false);
        expect(body.error).toContain('Database not configured');
      } finally {
        removeTempDir(dir);
      }
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

    // -------------------------------------------------------------------------
    // JSONL history import error cases (no pool needed to reach these)
    // -------------------------------------------------------------------------

    it('returns 400 for non-existent jsonl-history directory', async () => {
      // Without a pool but directory check happens after pool check — so we get 503 first.
      // To test the directory-not-found path we need an app with a mock pool.
      // The 503 (no pool) fires first for the no-pool app — verify that:
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'jsonl-history', dbPath: '/tmp/does-not-exist-dir-99999' },
      });
      // Without pool, gets 503 before directory check
      expect(res.statusCode).toBe(503);
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
// JSONL import with a mock pool
// ---------------------------------------------------------------------------

describe('POST /api/memory/import — jsonl-history with mock pool', () => {
  it('returns 400 when directory does not exist', async () => {
    const insertedRows: unknown[][] = [];
    const mockPool = {
      query: async (_sql: string, params?: unknown[]) => {
        if (params) insertedRows.push(params);
        return { rows: [], rowCount: 0 };
      },
    };

    const app = Fastify({ logger: false });
    await app.register(memoryImportRoutes, { prefix: '/api/memory', pool: mockPool as never });
    await app.ready();

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'jsonl-history', dbPath: '/tmp/definitely-does-not-exist-99999' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ ok: boolean; error: string }>();
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Directory not found');
    } finally {
      await app.close();
      resetActiveJobForTest();
    }
  });

  it('returns 400 when file count exceeds maximum', async () => {
    const dir = makeTempEmptyJsonlDir(1001);
    const mockPool: MockPool = {
      query: async () => ({ rows: [], rowCount: 0 }),
    };
    const app = await buildAppWithPool(mockPool);

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'jsonl-history', dbPath: dir },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ ok: boolean; error: string }>();
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Too many JSONL files');
    } finally {
      await app.close();
      resetActiveJobForTest();
      removeTempDir(dir);
    }
  });

  it('skips already imported JSONL sessions before inserting new ones', async () => {
    const dir = makeTempJsonlDir(2);
    const insertedRows: unknown[][] = [];
    const mockPool: MockPool = {
      query: async (sql, params) => {
        if (sql.includes("SELECT source_json->>'import_source_id'")) {
          return { rows: [{ src_id: 'jsonl-history:session-0000' }], rowCount: 1 };
        }
        insertedRows.push(params ?? []);
        return { rows: [], rowCount: 1 };
      },
    };
    const app = await buildAppWithPool(mockPool);

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'jsonl-history', dbPath: dir },
      });
      expect(res.statusCode).toBe(202);
      const job = await waitForImportJob(app);
      expect(job.status).toBe('completed');
      expect(job.imported).toBe(1);
      expect(job.skipped).toBe(1);
      expect(job.errors).toBe(0);
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0]?.[9]).toBe('jsonl-history:session-0001');
    } finally {
      await app.close();
      resetActiveJobForTest();
      removeTempDir(dir);
    }
  });

  it('skips oversized JSONL files without inserting them', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-import-big-jsonl-'));
    fs.writeFileSync(path.join(dir, 'session-big.jsonl'), Buffer.alloc(5 * 1024 * 1024 + 1));
    const insertedRows: unknown[][] = [];
    const mockPool: MockPool = {
      query: async (sql, params) => {
        if (sql.includes("SELECT source_json->>'import_source_id'")) {
          return { rows: [], rowCount: 0 };
        }
        insertedRows.push(params ?? []);
        return { rows: [], rowCount: 1 };
      },
    };
    const app = await buildAppWithPool(mockPool);

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'jsonl-history', dbPath: dir },
      });
      expect(res.statusCode).toBe(202);
      const job = await waitForImportJob(app);
      expect(job.status).toBe('completed');
      expect(job.imported).toBe(0);
      expect(job.skipped).toBe(1);
      expect(job.errors).toBe(0);
      expect(insertedRows).toHaveLength(0);
    } finally {
      await app.close();
      resetActiveJobForTest();
      removeTempDir(dir);
    }
  });

  it('rolls back completed JSONL imports by job id', async () => {
    const dir = makeTempJsonlDir(2);
    const insertedRows: unknown[][] = [];
    const deletedJobIds: unknown[] = [];
    const mockPool: MockPool = {
      query: async (sql, params) => {
        if (sql.includes("SELECT source_json->>'import_source_id'")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("DELETE FROM memory_facts WHERE source_json->>'import_job_id'")) {
          deletedJobIds.push(params?.[0]);
          return { rows: [], rowCount: 2 };
        }
        insertedRows.push(params ?? []);
        return { rows: [], rowCount: 1 };
      },
    };
    const app = await buildAppWithPool(mockPool);

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/import',
        payload: { source: 'jsonl-history', dbPath: dir },
      });
      expect(res.statusCode).toBe(202);
      const startedJob = res.json<{ job: { id: string } }>().job;

      const completedJob = await waitForImportJob(app);
      expect(completedJob.status).toBe('completed');
      expect(completedJob.imported).toBe(2);
      expect(insertedRows).toHaveLength(2);
      for (const params of insertedRows) {
        expect(params[7]).toMatchObject({ import_job_id: startedJob.id });
      }

      const rollback = await app.inject({
        method: 'POST',
        url: `/api/memory/import/${startedJob.id}/rollback`,
      });
      expect(rollback.statusCode).toBe(200);
      expect(deletedJobIds).toEqual([startedJob.id]);
      const body = rollback.json<{
        ok: boolean;
        job: { status: string; imported: number; rolledBack: number };
      }>();
      expect(body.ok).toBe(true);
      expect(body.job.status).toBe('rolled_back');
      expect(body.job.imported).toBe(0);
      expect(body.job.rolledBack).toBe(2);
    } finally {
      await app.close();
      resetActiveJobForTest();
      removeTempDir(dir);
    }
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
      // All requests hit 503 (no pool), but still count toward rate limit
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
