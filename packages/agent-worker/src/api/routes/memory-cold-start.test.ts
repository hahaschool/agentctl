import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { memoryDedupCheckRoutes } from './memory-dedup-check.js';
import { memoryDrawerGetRoutes } from './memory-drawer-get.js';
import { memoryDrawerSearchRoutes } from './memory-drawer-search.js';
import { memoryFeedbackRoutes } from './memory-feedback.js';
import { memoryPromoteRoutes } from './memory-promote.js';
import { memoryRecallRoutes } from './memory-recall.js';
import { memoryReportRoutes } from './memory-report.js';
import { memorySearchRoutes } from './memory-search.js';
import { memoryStoreRoutes } from './memory-store-route.js';
import { memoryTraverseRoutes } from './memory-traverse.js';

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
  void app.register(memoryTraverseRoutes, routeOptions);
  void app.register(memoryDrawerSearchRoutes, routeOptions);
  void app.register(memoryDrawerGetRoutes, routeOptions);

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

  it('returns an empty result list when drawer search runs against an empty drawer index', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'NOT_FOUND' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-search',
      payload: {
        arguments: { query: 'cold-start probe' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, results: [] });
  });

  it('returns DRAWER_NOT_FOUND when drawer get runs against an empty drawer index', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'NOT_FOUND' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-get',
      payload: {
        arguments: { drawer_id: 'missing-drawer' },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'DRAWER_NOT_FOUND',
      message: 'Drawer "missing-drawer" was not found',
    });
  });

  it('returns an empty traverse graph when no entity graph exists yet', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, nodes: [], edges: [], partial: false }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-traverse',
      payload: {
        start_entity_canonical_id: '550e8400-e29b-41d4-a716-446655440000',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      nodes: [],
      edges: [],
      partial: false,
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
    await expectFastNullArgumentsRejection(app, '/api/mcp/memory-traverse');
    await expectFastNullArgumentsRejection(app, '/api/mcp/memory-drawer-search');
    await expectFastNullArgumentsRejection(app, '/api/mcp/memory-drawer-get');
  });
});
