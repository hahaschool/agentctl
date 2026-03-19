import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { knowledgeMaintenanceRoutes } from './knowledge-maintenance.js';
import { createMockLogger } from './test-helpers.js';

// ---------------------------------------------------------------------------
// Mock KnowledgeMaintenance — the route instantiates it directly
// ---------------------------------------------------------------------------

const mockRun = vi.fn();

vi.mock('../../memory/knowledge-maintenance.js', () => ({
  KnowledgeMaintenance: vi.fn().mockImplementation(() => ({
    run: mockRun,
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMaintenanceResult(overrides: Record<string, unknown> = {}) {
  return {
    staleEntries: [],
    deletedFileEntries: [],
    synthesisClusters: [],
    coverageReport: {
      covered: [],
      gaps: [],
      totalDirectories: 0,
      coveredCount: 0,
      gapCount: 0,
    },
    consolidationItems: [],
    report: null,
    ...overrides,
  };
}

function createMockPool() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

function createMockMemoryStore() {
  return {
    addFact: vi.fn(),
    addConsolidationItem: vi.fn().mockResolvedValue({ id: 'ci-1' }),
    recordFeedback: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('knowledge-maintenance routes', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createMockPool>;
  let memoryStore: ReturnType<typeof createMockMemoryStore>;

  beforeEach(async () => {
    pool = createMockPool();
    memoryStore = createMockMemoryStore();
    mockRun.mockResolvedValue(makeMaintenanceResult());

    app = Fastify({ logger: false });
    await app.register(knowledgeMaintenanceRoutes, {
      prefix: '/api/memory/maintenance',
      pool: pool as never,
      memoryStore: memoryStore as never,
      logger: createMockLogger(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  // ── POST / ────────────────────────────────────────────────────────────────

  describe('POST /api/memory/maintenance', () => {
    it('returns 200 with summary when maintenance runs successfully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/maintenance',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.summary).toBeDefined();
    });

    it('runs maintenance with empty body provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/maintenance',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
    });

    it('passes scope to maintenance.run when provided', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/memory/maintenance',
        payload: { scope: 'project:my-project' },
      });

      expect(mockRun).toHaveBeenCalledWith('project:my-project');
    });

    it('calls maintenance.run with undefined when scope is omitted', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/memory/maintenance',
        payload: {},
      });

      expect(mockRun).toHaveBeenCalledWith(undefined);
    });

    it('returns the correct summary shape for empty results', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/maintenance',
        payload: {},
      });

      const body = res.json();
      expect(body.summary).toMatchObject({
        staleEntries: 0,
        deletedFileEntries: 0,
        synthesisClusters: 0,
        consolidationItems: 0,
        coverageReport: {
          totalDirectories: 0,
          covered: 0,
          gaps: 0,
        },
        reportId: null,
      });
    });

    it('returns correct summary counts when maintenance finds items', async () => {
      mockRun.mockResolvedValueOnce(
        makeMaintenanceResult({
          staleEntries: [{ factId: 'f-1', content: 'x', referencedPaths: [], reason: 'r' }],
          deletedFileEntries: [
            { factId: 'f-2', content: 'y', deletedFile: 'old.ts' },
            { factId: 'f-3', content: 'z', deletedFile: 'gone.ts' },
          ],
          synthesisClusters: [
            {
              seedFactId: 'f-4',
              factIds: ['f-4', 'f-5', 'f-6'],
              factContents: ['a', 'b', 'c'],
              proposedPrinciple: 'P',
            },
          ],
          consolidationItems: [{ id: 'ci-1' }, { id: 'ci-2' }],
          coverageReport: {
            covered: [{ directory: 'packages/cp', factCount: 3 }],
            gaps: [{ directory: 'packages/web', factCount: 0 }],
            totalDirectories: 2,
            coveredCount: 1,
            gapCount: 1,
          },
          report: { id: 'rpt_abc123', type: 'knowledge-health', scope: 'global' },
        }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/maintenance',
        payload: {},
      });

      const body = res.json();
      expect(body.summary.staleEntries).toBe(1);
      expect(body.summary.deletedFileEntries).toBe(2);
      expect(body.summary.synthesisClusters).toBe(1);
      expect(body.summary.consolidationItems).toBe(2);
      expect(body.summary.coverageReport.totalDirectories).toBe(2);
      expect(body.summary.coverageReport.covered).toBe(1);
      expect(body.summary.coverageReport.gaps).toBe(1);
      expect(body.summary.reportId).toBe('rpt_abc123');
    });

    it('includes full result in response body', async () => {
      const fullResult = makeMaintenanceResult({
        staleEntries: [{ factId: 'f-1', content: 'x', referencedPaths: [], reason: 'r' }],
      });
      mockRun.mockResolvedValueOnce(fullResult);

      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/maintenance',
        payload: {},
      });

      const body = res.json();
      expect(body.result).toBeDefined();
      expect(body.result.staleEntries).toHaveLength(1);
    });

    it('ignores body.projectRoot overrides and uses opts.projectRoot', async () => {
      const { KnowledgeMaintenance } = await import('../../memory/knowledge-maintenance.js');

      const localApp = Fastify({ logger: false });
      await localApp.register(knowledgeMaintenanceRoutes, {
        prefix: '/api/memory/maintenance',
        pool: pool as never,
        memoryStore: memoryStore as never,
        logger: createMockLogger(),
        projectRoot: '/default/root',
      });
      await localApp.ready();

      await localApp.inject({
        method: 'POST',
        url: '/api/memory/maintenance',
        payload: { projectRoot: '/custom/root' },
      });

      expect(KnowledgeMaintenance).toHaveBeenCalledWith(
        expect.objectContaining({ projectRoot: '/default/root' }),
      );

      await localApp.close();
    });

    it('falls back to opts.projectRoot when body.projectRoot is absent', async () => {
      const { KnowledgeMaintenance } = await import('../../memory/knowledge-maintenance.js');

      // Re-register with a default projectRoot
      const localApp = Fastify({ logger: false });
      await localApp.register(knowledgeMaintenanceRoutes, {
        prefix: '/api/memory/maintenance',
        pool: pool as never,
        memoryStore: memoryStore as never,
        logger: createMockLogger(),
        projectRoot: '/default/root',
      });
      await localApp.ready();

      await localApp.inject({
        method: 'POST',
        url: '/api/memory/maintenance',
        payload: {},
      });

      expect(KnowledgeMaintenance).toHaveBeenCalledWith(
        expect.objectContaining({ projectRoot: '/default/root' }),
      );

      await localApp.close();
    });

    it('returns reportId=null when report is null', async () => {
      mockRun.mockResolvedValueOnce(makeMaintenanceResult({ report: null }));

      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/maintenance',
        payload: {},
      });

      const body = res.json();
      expect(body.summary.reportId).toBeNull();
    });

    it('returns 500 when maintenance.run throws', async () => {
      mockRun.mockRejectedValueOnce(new Error('Unexpected DB failure'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/memory/maintenance',
        payload: {},
      });

      expect(res.statusCode).toBe(500);
    });
  });
});
