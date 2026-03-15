import { readFileSync } from 'node:fs';

import fastifyRateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDecayRoutes } from './memory-decay.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

const { mockRunDecay, MockMemoryDecay } = vi.hoisted(() => {
  const mockRunDecay = vi.fn().mockResolvedValue({
    decayed: 2,
    archived: 1,
    skipped: 3,
  });
  const mockGetDecayStats = vi.fn().mockResolvedValue({
    strengthDistribution: { low: 1, mediumLow: 2, mediumHigh: 3, high: 4 },
    pinnedCount: 5,
    archivedCount: 6,
  });
  const MockMemoryDecay = vi.fn().mockImplementation(() => ({
    runDecay: mockRunDecay,
    getDecayStats: mockGetDecayStats,
  }));
  return { mockRunDecay, MockMemoryDecay };
});

vi.mock('../../memory/memory-decay.js', () => ({
  MemoryDecay: MockMemoryDecay,
}));

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(fastifyRateLimit, {
    global: false,
    max: 1_000,
    timeWindow: '1 minute',
  });
  await app.register(memoryDecayRoutes, {
    prefix: '/api/memory/decay',
    pool: {} as never,
    logger,
  });
  await app.ready();
  return app;
}

describe('memoryDecayRoutes source shape', () => {
  it('declares direct Fastify rate-limit preHandlers and route config markers on both endpoints', () => {
    const source = readFileSync(new URL('./memory-decay.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/await app\.register\(rateLimit,\s*\{/);
    expect(source).toMatch(
      /'\/run'[\s\S]*?config:\s*\{\s*rateLimit:\s*memoryDecayFastifyRateLimit\s*\}[\s\S]*?preHandler:\s*app\.rateLimit\(memoryDecayFastifyRateLimit\)/,
    );
    expect(source).toMatch(
      /'\/stats'[\s\S]*?config:\s*\{\s*rateLimit:\s*memoryDecayFastifyRateLimit\s*\}[\s\S]*?preHandler:\s*app\.rateLimit\(memoryDecayFastifyRateLimit\)/,
    );
  });
});

describe('memoryDecayRoutes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRunDecay.mockResolvedValue({
      decayed: 2,
      archived: 1,
      skipped: 3,
    });
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns decay results for POST /api/memory/decay/run', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/decay/run',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      result: { decayed: 2, archived: 1, skipped: 3 },
    });
  });

  it('includes Fastify rate-limit headers on the route', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/decay/run',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('returns 429 after repeated requests exceed the route limit', async () => {
    let res: Awaited<ReturnType<typeof app.inject>> | undefined;
    for (let attempt = 0; attempt < 31; attempt += 1) {
      res = await app.inject({
        method: 'POST',
        url: '/api/memory/decay/run',
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
