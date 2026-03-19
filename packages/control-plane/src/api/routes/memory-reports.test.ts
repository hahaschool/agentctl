import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryReportsRoutes, resetReportCacheForTest } from './memory-reports.js';
import { createMockLogger } from './test-helpers.js';

type MockPool = {
  query: ReturnType<typeof vi.fn>;
};

const logger = createMockLogger();

function createMockPool(): MockPool {
  return {
    query: vi.fn(),
  };
}

async function buildApp(pool: MockPool): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(memoryReportsRoutes, {
    prefix: '/api/memory/reports',
    pool: pool as never,
    logger,
  });
  await app.ready();
  return app;
}

describe('memoryReportsRoutes', () => {
  let app: FastifyInstance;
  let pool: MockPool;

  beforeEach(async () => {
    resetReportCacheForTest();
    vi.restoreAllMocks();
    pool = createMockPool();
    app = await buildApp(pool);
  });

  afterEach(async () => {
    await app.close();
    resetReportCacheForTest();
    vi.restoreAllMocks();
  });

  describe('GET /api/memory/reports', () => {
    it('lists cached reports newest-first and honors filters + limits', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const firstCreate = await app.inject({
        method: 'POST',
        url: '/api/memory/reports/generate',
        payload: { reportType: 'activity-digest', scope: 'project:alpha', timeRange: 'last-7d' },
      });
      const secondCreate = await app.inject({
        method: 'POST',
        url: '/api/memory/reports/generate',
        payload: { reportType: 'project-progress', scope: 'project:beta', timeRange: 'all-time' },
      });
      const thirdCreate = await app.inject({
        method: 'POST',
        url: '/api/memory/reports/generate',
        payload: { reportType: 'activity-digest', scope: 'project:alpha', timeRange: 'last-30d' },
      });

      const firstId = firstCreate.json<{ report: { id: string } }>().report.id;
      const secondId = secondCreate.json<{ report: { id: string } }>().report.id;
      const thirdId = thirdCreate.json<{ report: { id: string } }>().report.id;
      expect(firstId).not.toBe(secondId);
      expect(secondId).not.toBe(thirdId);

      const response = await app.inject({
        method: 'GET',
        url: '/api/memory/reports?reportType=activity-digest&scope=project:alpha&limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        ok: boolean;
        total: number;
        reports: Array<{ id: string; reportType: string; scope: string | null }>;
      }>();
      expect(body.ok).toBe(true);
      expect(body.total).toBe(2);
      expect(body.reports).toHaveLength(1);
      expect(body.reports[0]).toMatchObject({
        id: thirdId,
        reportType: 'activity-digest',
        scope: 'project:alpha',
      });
    });
  });

  describe('POST /api/memory/reports/generate', () => {
    it('generates a project progress report', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            entity_type: 'decision',
            fact_count: '2',
            earliest: '2026-03-10T12:00:00.000Z',
            latest: '2026-03-11T12:00:00.000Z',
          },
          {
            entity_type: 'pattern',
            fact_count: '1',
            earliest: null,
            latest: '2026-03-12T12:00:00.000Z',
          },
        ],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/reports/generate',
        payload: {
          reportType: 'project-progress',
          scope: 'project:agentctl',
          timeRange: 'last-7d',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        ok: boolean;
        report: {
          id: string;
          reportType: string;
          scope: string | null;
          timeRange: string;
          markdown: string;
        };
      }>();
      expect(body.ok).toBe(true);
      expect(body.report.id).toEqual(expect.any(String));
      expect(body.report).toMatchObject({
        reportType: 'project-progress',
        scope: 'project:agentctl',
        timeRange: 'last-7d',
      });
      expect(body.report.markdown).toContain('# Project Progress Report');
      expect(body.report.markdown).toContain('**Total facts:** 3');
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM memory_facts'), [
        'project:agentctl',
        '7 days',
      ]);
    });

    it('generates a knowledge health report', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ total_facts: '10', avg_confidence: '0.875' }],
        })
        .mockResolvedValueOnce({
          rows: [{ cnt: '4' }],
        })
        .mockResolvedValueOnce({
          rows: [{ cnt: '6' }],
        })
        .mockResolvedValueOnce({
          rows: [{ cnt: '12' }],
        });

      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/reports/generate',
        payload: {
          reportType: 'knowledge-health',
          scope: 'project:agentctl',
          timeRange: 'last-90d',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ report: { markdown: string; timeRange: string } }>();
      expect(body.report.timeRange).toBe('last-90d');
      expect(body.report.markdown).toContain('# Knowledge Health Report');
      expect(body.report.markdown).toContain('| Total facts | 10 |');
      expect(body.report.markdown).toContain('**Score: 50/100**');
      expect(pool.query).toHaveBeenCalledTimes(4);
    });

    it('generates an activity digest report', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'fact-1',
              scope: 'project:agentctl',
              entity_type: 'decision',
              content: 'x'.repeat(140),
              created_at: '2026-03-19T09:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ day: '2026-03-19', cnt: '3' }],
        });

      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/reports/generate',
        payload: {
          reportType: 'activity-digest',
          scope: 'project:agentctl',
          timeRange: 'all-time',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ report: { markdown: string; timeRange: string } }>();
      expect(body.report.timeRange).toBe('all-time');
      expect(body.report.markdown).toContain('# Activity Digest');
      expect(body.report.markdown).toContain('| 2026-03-19 | 3 |');
      expect(body.report.markdown).toContain(`${'x'.repeat(120)}...`);
      expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it('returns 400 for an invalid reportType', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/reports/generate',
        payload: {
          reportType: 'unknown-report',
          timeRange: 'last-7d',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        ok: false,
        error: 'INVALID_REPORT_TYPE',
      });
    });

    it('falls back to last-30d for an invalid timeRange', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [],
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/reports/generate',
        payload: {
          reportType: 'project-progress',
          scope: '',
          timeRange: 'bad-range',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        report: { scope: string | null; timeRange: string; markdown: string };
      }>();
      expect(body.report.scope).toBeNull();
      expect(body.report.timeRange).toBe('last-30d');
      expect(body.report.markdown).toContain('**Time range:** last-30d');
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM memory_facts'), [
        '30 days',
      ]);
    });

    it('evicts the oldest cached report when capacity is exceeded', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      let firstId: string | null = null;
      let secondId: string | null = null;
      let lastId: string | null = null;

      for (let index = 0; index < 101; index += 1) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/memory/reports/generate',
          payload: {
            reportType: 'activity-digest',
            scope: `project:${index}`,
            timeRange: 'last-30d',
          },
        });
        expect(response.statusCode).toBe(200);
        const { report } = response.json<{ report: { id: string } }>();
        if (index === 0) {
          firstId = report.id;
        }
        if (index === 1) {
          secondId = report.id;
        }
        if (index === 100) {
          lastId = report.id;
        }
      }

      const listResponse = await app.inject({
        method: 'GET',
        url: '/api/memory/reports?limit=100',
      });

      expect(listResponse.statusCode).toBe(200);
      const body = listResponse.json<{ total: number; reports: Array<{ id: string }> }>();
      expect(body.total).toBe(100);
      expect(lastId).not.toBeNull();
      expect(firstId).not.toBeNull();
      expect(secondId).not.toBeNull();
      expect(body.reports[0]?.id).toBe(lastId);
      expect(body.reports.some((report) => report.id === firstId)).toBe(false);
      expect(body.reports.some((report) => report.id === secondId)).toBe(true);
    });
  });
});
