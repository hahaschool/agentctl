import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { memoryDedupCheckRoutes } from './memory-dedup-check.js';
import { memoryFeedbackRoutes } from './memory-feedback.js';
import { memoryPromoteRoutes } from './memory-promote.js';
import { memoryRecallRoutes } from './memory-recall.js';
import { memoryReportRoutes } from './memory-report.js';
import { memorySearchRoutes } from './memory-search.js';
import { memoryStoreRoutes } from './memory-store-route.js';

const CONTROL_PLANE_URL = 'http://localhost:8080';

function makeApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  const logger = createSilentLogger();
  const routeOptions = { prefix: '/api/mcp', controlPlaneUrl: CONTROL_PLANE_URL, logger };

  void app.register(memorySearchRoutes, routeOptions);
  void app.register(memoryRecallRoutes, routeOptions);
  void app.register(memoryReportRoutes, routeOptions);
  void app.register(memoryStoreRoutes, routeOptions);
  void app.register(memoryFeedbackRoutes, routeOptions);
  void app.register(memoryPromoteRoutes, routeOptions);
  void app.register(memoryDedupCheckRoutes, routeOptions);

  return app;
}

async function expectFastNullArgumentsRejection(
  app: FastifyInstance,
  route: string,
): Promise<void> {
  const response = await Promise.race([
    app.inject({
      method: 'POST',
      url: route,
      payload: { arguments: null },
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${route} did not reject null arguments in time`)), 1000);
    }),
  ]);

  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({
    error: 'INVALID_ARGUMENTS',
    message: 'arguments must be a non-null object when provided',
  });
}

describe('memory MCP cold-start contract', () => {
  let app: FastifyInstance;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    app = makeApp();
    await app.ready();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  it('returns structured empty results for first-run memory search', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, facts: [], total: 0 }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-search',
      payload: { query: 'anything', scope: 'global', limit: 5 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      facts: [],
      results: [],
      total: 0,
    });
  });

  it('returns an empty graph shape when recall starts from a missing fact', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, edges: [] }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-recall',
      payload: { factId: 'missing-fact', maxHops: 2 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      seedFactId: 'missing-fact',
      facts: [],
      edges: [],
    });
  });

  it('returns zero-valued report stats for an empty memory store', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, stats: {} }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-report',
      payload: { reportType: 'health' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().report.data).toEqual({
      totalFacts: 0,
      avgConfidence: 0,
      strengthDistribution: {},
      byScope: {},
      byEntityType: {},
    });
  });

  it('rejects null arguments on every current memory MCP route without hanging', async () => {
    await expectFastNullArgumentsRejection(app, '/api/mcp/memory-search');
    await expectFastNullArgumentsRejection(app, '/api/mcp/memory-recall');
    await expectFastNullArgumentsRejection(app, '/api/mcp/memory-report');
    await expectFastNullArgumentsRejection(app, '/api/mcp/memory-store');
    await expectFastNullArgumentsRejection(app, '/api/mcp/memory-feedback');
    await expectFastNullArgumentsRejection(app, '/api/mcp/memory-promote');
    await expectFastNullArgumentsRejection(app, '/api/mcp/memory-dedup-check');
  });
});
