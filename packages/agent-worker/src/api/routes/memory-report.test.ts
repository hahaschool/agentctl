import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { memoryReportRoutes } from './memory-report.js';

const CONTROL_PLANE_URL = 'http://localhost:8080';

function makeApp(controlPlaneUrl = CONTROL_PLANE_URL): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(memoryReportRoutes, {
    prefix: '/api/mcp',
    controlPlaneUrl,
    logger: createSilentLogger(),
  });
  return app;
}

const MOCK_STATS = {
  totalFacts: 42,
  newThisWeek: 7,
  avgConfidence: 0.85,
  pendingConsolidation: 3,
  byScope: { global: 20, 'project:myapp': 22 },
  byEntityType: { concept: 30, decision: 12 },
  strengthDistribution: { active: 35, decaying: 5, archived: 2 },
  growthTrend: [{ date: '2026-03-04', count: 5 }],
};

describe('memoryReportRoutes', () => {
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

  it('returns 400 when reportType is invalid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-report',
      payload: { reportType: 'unknown' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_REPORT_TYPE');
  });

  it('generates a health report from stats', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, stats: MOCK_STATS }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-report',
      payload: { reportType: 'health', scope: 'global' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.report.type).toBe('health');
    expect(body.report.data.totalFacts).toBe(42);
  });

  it('generates a progress report from stats', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, stats: MOCK_STATS }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-report',
      payload: { reportType: 'progress' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.report.type).toBe('progress');
    expect(body.report.data.newThisWeek).toBe(7);
  });

  it('generates an activity report with recent facts', async () => {
    const fakeFacts = [{ id: 'fact-1', content: 'recent thing' }];
    globalThis.fetch = vi
      .fn()
      // First call for stats
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, stats: MOCK_STATS }),
      })
      // Second call for facts
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, facts: fakeFacts, total: 1 }),
      });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-report',
      payload: { reportType: 'activity', scope: 'global', timeRange: '7d' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.report.type).toBe('activity');
    expect(body.report.data.recentFacts).toHaveLength(1);
  });

  it('returns 503 when control-plane is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-report',
      payload: { reportType: 'health' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('MEMORY_REPORT_UNREACHABLE');
  });
});
