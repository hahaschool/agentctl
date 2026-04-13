import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySynthesisRoutes } from './memory-synthesis.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

function makeEmptyPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
}

describe('memorySynthesisRoutes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const pool = makeEmptyPool();
    app = Fastify({ logger: false });
    await app.register(memorySynthesisRoutes, {
      prefix: '/api/memory/synthesis',
      pool: pool as never,
      logger,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns ok with empty result when no facts exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/synthesis',
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      ok: boolean;
      result: {
        lint: { nearDuplicates: unknown[]; staleFacts: unknown[]; orphanFacts: unknown[] };
        synthesisGroups: unknown[];
      };
    };
    expect(body.ok).toBe(true);
    expect(body.result.lint.nearDuplicates).toHaveLength(0);
    expect(body.result.lint.staleFacts).toHaveLength(0);
    expect(body.result.lint.orphanFacts).toHaveLength(0);
    expect(body.result.synthesisGroups).toHaveLength(0);
  });

  it('accepts a scope parameter and passes it through', async () => {
    const pool = makeEmptyPool();
    const scopedApp = Fastify({ logger: false });
    await scopedApp.register(memorySynthesisRoutes, {
      prefix: '/api/memory/synthesis',
      pool: pool as never,
      logger,
    });
    await scopedApp.ready();

    const response = await scopedApp.inject({
      method: 'POST',
      url: '/api/memory/synthesis',
      payload: { scope: 'project:agentctl' },
    });

    expect(response.statusCode).toBe(200);
    // All 4 pool queries should include the scope parameter
    for (const call of vi.mocked(pool.query).mock.calls as [string, unknown[]][]) {
      expect(call[1]).toContain('project:agentctl');
    }

    await scopedApp.close();
  });
});

// Rate limiting — synthesis runs parallel DB scans; must bound CPU/IO.
describe('memorySynthesisRoutes rate limiting', () => {
  const originalMax = process.env.MEMORY_SYNTHESIS_RATE_LIMIT_MAX;
  const originalWindow = process.env.MEMORY_SYNTHESIS_RATE_LIMIT_WINDOW_MS;

  beforeAll(() => {
    process.env.MEMORY_SYNTHESIS_RATE_LIMIT_MAX = '3';
    process.env.MEMORY_SYNTHESIS_RATE_LIMIT_WINDOW_MS = '60000';
  });

  afterAll(() => {
    if (originalMax === undefined) delete process.env.MEMORY_SYNTHESIS_RATE_LIMIT_MAX;
    else process.env.MEMORY_SYNTHESIS_RATE_LIMIT_MAX = originalMax;
    if (originalWindow === undefined) delete process.env.MEMORY_SYNTHESIS_RATE_LIMIT_WINDOW_MS;
    else process.env.MEMORY_SYNTHESIS_RATE_LIMIT_WINDOW_MS = originalWindow;
  });

  it('returns 429 after exceeding the configured limit on POST /', async () => {
    const pool = makeEmptyPool();
    const app = Fastify({ logger: false });
    await app.register(memorySynthesisRoutes, {
      prefix: '/api/memory/synthesis',
      pool: pool as never,
      logger,
    });
    await app.ready();
    try {
      for (let i = 0; i < 3; i += 1) {
        const ok = await app.inject({
          method: 'POST',
          url: '/api/memory/synthesis',
          payload: {},
          headers: { 'x-forwarded-for': '10.0.0.72' },
          remoteAddress: '10.0.0.72',
        });
        expect(ok.statusCode).toBe(200);
      }

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/memory/synthesis',
        payload: {},
        headers: { 'x-forwarded-for': '10.0.0.72' },
        remoteAddress: '10.0.0.72',
      });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error).toBe('RATE_LIMITED');
    } finally {
      await app.close();
    }
  });
});
