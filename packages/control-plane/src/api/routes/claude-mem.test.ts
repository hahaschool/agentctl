import { readFileSync } from 'node:fs';

import fastifyRateLimit from '@fastify/rate-limit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock better-sqlite3 BEFORE imports.
// vi.mock is hoisted, so we must use vi.hoisted() for shared state.
const { mockAll, mockGet, mockPrepare, mockClose, mockDbConstructor } = vi.hoisted(() => {
  const mockAll = vi.fn().mockReturnValue([]);
  const mockGet = vi.fn().mockReturnValue(null);
  const mockPrepare = vi.fn().mockReturnValue({ all: mockAll, get: mockGet });
  const mockClose = vi.fn();
  const mockDbConstructor = vi.fn().mockReturnValue({
    prepare: mockPrepare,
    close: mockClose,
  });
  return { mockAll, mockGet, mockPrepare, mockClose, mockDbConstructor };
});

vi.mock('better-sqlite3', () => ({
  default: mockDbConstructor,
}));

const { mockExistsSync } = vi.hoisted(() => {
  const mockExistsSync = vi.fn().mockReturnValue(true);
  return { mockExistsSync };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: mockExistsSync,
  };
});

// Now import after mocks
import Fastify from 'fastify';
import { claudeMemRoutes } from './claude-mem.js';

async function buildApp() {
  const app = Fastify();
  await app.register(fastifyRateLimit, {
    global: false,
    max: 1_000,
    timeWindow: '1 minute',
  });
  await app.register(claudeMemRoutes, { prefix: '/api/claude-mem' });
  return app;
}

describe('claude-mem routes — /api/claude-mem', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-establish default mock returns after clearAllMocks
    mockExistsSync.mockReturnValue(true);
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet });
    mockAll.mockReturnValue([]);
    mockGet.mockReturnValue(null);
    app = await buildApp();
  });

  // ---------------------------------------------------------------------------
  // GET /api/claude-mem/search
  // ---------------------------------------------------------------------------

  describe('GET /api/claude-mem/search', () => {
    it('returns 400 when q is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/claude-mem/search' });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('MISSING_QUERY');
    });

    it('returns observations matching query', async () => {
      mockAll.mockReturnValueOnce([
        {
          id: 1,
          type: 'decision',
          title: 'Use PostgreSQL',
          facts: '[]',
          created_at: '2026-03-09',
        },
      ]);
      const res = await app.inject({
        method: 'GET',
        url: '/api/claude-mem/search?q=postgres',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.observations).toHaveLength(1);
      expect(body.observations[0].title).toBe('Use PostgreSQL');
    });

    it('includes Fastify rate-limit headers on the route', async () => {
      mockAll.mockReturnValueOnce([]);
      const res = await app.inject({
        method: 'GET',
        url: '/api/claude-mem/search?q=postgres',
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    });

    it('passes project filter to SQL', async () => {
      mockAll.mockReturnValueOnce([]);
      await app.inject({
        method: 'GET',
        url: '/api/claude-mem/search?q=test&project=agentctl',
      });
      expect(mockPrepare).toHaveBeenCalled();
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('project LIKE');
    });

    it('passes type filter to SQL', async () => {
      mockAll.mockReturnValueOnce([]);
      await app.inject({
        method: 'GET',
        url: '/api/claude-mem/search?q=test&type=decision',
      });
      expect(mockPrepare).toHaveBeenCalled();
      const sql = mockPrepare.mock.calls[0][0] as string;
      expect(sql).toContain('type = ?');
    });

    it('respects limit parameter', async () => {
      mockAll.mockReturnValueOnce([]);
      await app.inject({ method: 'GET', url: '/api/claude-mem/search?q=test&limit=5' });
      const lastArg = mockAll.mock.calls[0]?.at(-1);
      expect(lastArg).toBe(5);
    });

    it('caps limit at 100', async () => {
      mockAll.mockReturnValueOnce([]);
      await app.inject({ method: 'GET', url: '/api/claude-mem/search?q=test&limit=999' });
      const lastArg = mockAll.mock.calls[0]?.at(-1);
      expect(lastArg).toBe(100);
    });

    it('defaults limit to 20 when not specified', async () => {
      mockAll.mockReturnValueOnce([]);
      await app.inject({ method: 'GET', url: '/api/claude-mem/search?q=test' });
      const lastArg = mockAll.mock.calls[0]?.at(-1);
      expect(lastArg).toBe(20);
    });

    it('returns 503 when database file does not exist', async () => {
      mockExistsSync.mockReturnValueOnce(false);

      const res = await app.inject({ method: 'GET', url: '/api/claude-mem/search?q=test' });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('MEMORY_UNAVAILABLE');
    });

    it('closes the database after search', async () => {
      mockAll.mockReturnValueOnce([]);
      await app.inject({ method: 'GET', url: '/api/claude-mem/search?q=test' });
      expect(mockClose).toHaveBeenCalled();
    });

    it('returns 429 after repeated requests exceed the route limit', async () => {
      mockAll.mockReturnValue([]);

      let res: Awaited<ReturnType<typeof app.inject>> | undefined;
      for (let attempt = 0; attempt < 61; attempt += 1) {
        res = await app.inject({
          method: 'GET',
          url: '/api/claude-mem/search?q=rate-limit-test',
        });
      }

      expect(res?.statusCode).toBe(429);
      expect(res?.json()).toEqual({
        statusCode: 429,
        error: 'RATE_LIMITED',
        message: 'Too many requests',
      });
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/claude-mem/observations/:id
  // ---------------------------------------------------------------------------

  describe('GET /api/claude-mem/observations/:id', () => {
    it('returns 404 when not found', async () => {
      mockGet.mockReturnValueOnce(null);
      const res = await app.inject({
        method: 'GET',
        url: '/api/claude-mem/observations/999',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('NOT_FOUND');
    });

    it('returns observation by ID', async () => {
      mockGet.mockReturnValueOnce({
        id: 1,
        type: 'bugfix',
        title: 'Fix auth',
        narrative: 'Fixed JWT',
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/claude-mem/observations/1',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().observation.title).toBe('Fix auth');
    });

    it('returns 503 when database file does not exist', async () => {
      mockExistsSync.mockReturnValueOnce(false);

      const res = await app.inject({
        method: 'GET',
        url: '/api/claude-mem/observations/1',
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('MEMORY_UNAVAILABLE');
    });

    it('closes the database after lookup', async () => {
      mockGet.mockReturnValueOnce({ id: 1, title: 'Test' });
      await app.inject({ method: 'GET', url: '/api/claude-mem/observations/1' });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/claude-mem/timeline
  // ---------------------------------------------------------------------------

  describe('GET /api/claude-mem/timeline', () => {
    it('returns 400 when sessionId missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/claude-mem/timeline' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('MISSING_SESSION_ID');
    });

    it('returns observations for session', async () => {
      mockAll.mockReturnValueOnce([
        { id: 1, type: 'feature', title: 'Add auth', created_at: '2026-03-09' },
      ]);
      const res = await app.inject({
        method: 'GET',
        url: '/api/claude-mem/timeline?sessionId=sess-123',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().observations).toHaveLength(1);
    });

    it('returns empty array when sdk_sessions table does not exist', async () => {
      mockAll.mockImplementationOnce(() => {
        throw new Error('no such table: sdk_sessions');
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/claude-mem/timeline?sessionId=sess-123',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().observations).toEqual([]);
    });

    it('returns 503 when database file does not exist', async () => {
      mockExistsSync.mockReturnValueOnce(false);

      const res = await app.inject({
        method: 'GET',
        url: '/api/claude-mem/timeline?sessionId=sess-123',
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('MEMORY_UNAVAILABLE');
    });

    it('caps limit at 200', async () => {
      mockAll.mockReturnValueOnce([]);
      await app.inject({
        method: 'GET',
        url: '/api/claude-mem/timeline?sessionId=sess-123&limit=500',
      });
      const lastArg = mockAll.mock.calls[0]?.at(-1);
      expect(lastArg).toBe(200);
    });

    it('defaults limit to 50 when not specified', async () => {
      mockAll.mockReturnValueOnce([]);
      await app.inject({
        method: 'GET',
        url: '/api/claude-mem/timeline?sessionId=sess-123',
      });
      const lastArg = mockAll.mock.calls[0]?.at(-1);
      expect(lastArg).toBe(50);
    });

    it('closes the database after timeline query', async () => {
      mockAll.mockReturnValueOnce([]);
      await app.inject({
        method: 'GET',
        url: '/api/claude-mem/timeline?sessionId=sess-123',
      });
      expect(mockClose).toHaveBeenCalled();
    });
  });
});

describe('claudeMemRoutes source shape', () => {
  it('declares direct Fastify rate-limit preHandlers on all endpoints', () => {
    const source = readFileSync(new URL('./claude-mem.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/await app\.register\(rateLimit,\s*\{/);
    expect(source).toMatch(/'\/search'[\s\S]*?preHandler:\s*app\.rateLimit\(\{/);
    expect(source).toMatch(/'\/observations\/:id'[\s\S]*?preHandler:\s*app\.rateLimit\(\{/);
    expect(source).toMatch(/'\/timeline'[\s\S]*?preHandler:\s*app\.rateLimit\(\{/);
  });
});
