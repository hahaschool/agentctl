import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { knowledgeMaintenanceRoutes } from './knowledge-maintenance.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

const { mockRun, MockKnowledgeMaintenance } = vi.hoisted(() => {
  const mockRun = vi.fn();
  const MockKnowledgeMaintenance = vi.fn().mockImplementation(() => ({
    run: mockRun,
  }));

  return { mockRun, MockKnowledgeMaintenance };
});

vi.mock('../../memory/knowledge-maintenance.js', () => ({
  KnowledgeMaintenance: MockKnowledgeMaintenance,
}));

type MockPool = {
  query: ReturnType<typeof vi.fn>;
};

type MockMemoryStore = {
  addConsolidationItem: ReturnType<typeof vi.fn>;
  recordFeedback: ReturnType<typeof vi.fn>;
  addFact: ReturnType<typeof vi.fn>;
};

function createMockPool(): MockPool {
  return {
    query: vi.fn(),
  };
}

function createMockMemoryStore(): MockMemoryStore {
  return {
    addConsolidationItem: vi.fn(),
    recordFeedback: vi.fn(),
    addFact: vi.fn(),
  };
}

function makeMaintenanceResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    staleEntries: [
      { factId: 'fact-1', content: 'stale fact', referencedPaths: [], reason: 'stale' },
    ],
    deletedFileEntries: [
      { factId: 'fact-2', content: 'deleted file fact', deletedFile: 'packages/app/old.ts' },
    ],
    synthesisClusters: [
      {
        seedFactId: 'fact-3',
        factIds: ['fact-3', 'fact-4', 'fact-5'],
        factContents: ['a', 'b', 'c'],
        proposedPrinciple: 'Group related facts',
      },
    ],
    coverageReport: {
      covered: [{ directory: 'packages/control-plane/src', factCount: 3 }],
      gaps: [{ directory: 'packages/web/src', factCount: 0 }],
      totalDirectories: 4,
      coveredCount: 3,
      gapCount: 1,
    },
    consolidationItems: [
      {
        id: 'ci-1',
        type: 'stale',
        severity: 'medium',
        factIds: ['fact-1'],
        suggestion: 'Update stale fact',
        reason: 'stale',
        status: 'pending',
        createdAt: '2026-03-19T00:00:00.000Z',
      },
    ],
    report: {
      id: 'report-1',
      scope: 'project:agentctl',
      reportType: 'knowledge-health',
      timeRange: 'all-time',
      markdown: '# Report',
      createdAt: '2026-03-19T00:00:00.000Z',
    },
    ...overrides,
  };
}

async function buildApp(options: { projectRoot?: string } = {}) {
  const pool = createMockPool();
  const memoryStore = createMockMemoryStore();
  const app = Fastify({ logger: false });

  await app.register(knowledgeMaintenanceRoutes, {
    prefix: '/api/memory/maintenance',
    pool: pool as never,
    memoryStore: memoryStore as never,
    logger,
    ...options,
  });
  await app.ready();

  return { app, pool, memoryStore };
}

describe('knowledgeMaintenanceRoutes', () => {
  let app: FastifyInstance;
  let pool: MockPool;
  let memoryStore: MockMemoryStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue(makeMaintenanceResult());

    ({ app, pool, memoryStore } = await buildApp({ projectRoot: '/repo/default' }));
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns a summarized maintenance response and the raw result payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/maintenance',
      payload: { scope: 'project:agentctl' },
    });

    expect(response.statusCode).toBe(200);
    expect(MockKnowledgeMaintenance).toHaveBeenCalledWith({
      pool,
      memoryStore,
      logger,
      projectRoot: '/repo/default',
    });

    expect(response.json()).toMatchObject({
      ok: true,
      summary: {
        staleEntries: 1,
        deletedFileEntries: 1,
        synthesisClusters: 1,
        consolidationItems: 1,
        coverageReport: {
          totalDirectories: 4,
          covered: 3,
          gaps: 1,
        },
        reportId: 'report-1',
      },
      result: {
        report: {
          id: 'report-1',
        },
      },
    });
  });

  it('passes the provided scope through to the maintenance run', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/maintenance',
      payload: { scope: 'project:agentctl' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRun).toHaveBeenCalledWith('project:agentctl');
  });

  it('ignores non-string scope values and falls back to the route projectRoot', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/maintenance',
      payload: { scope: 42, projectRoot: 99 },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRun).toHaveBeenCalledWith(undefined);
    expect(MockKnowledgeMaintenance).toHaveBeenCalledWith({
      pool,
      memoryStore,
      logger,
      projectRoot: '/repo/default',
    });
  });

  it('prefers the request projectRoot over the route default', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/maintenance',
      payload: { projectRoot: '/repo/override' },
    });

    expect(response.statusCode).toBe(200);
    expect(MockKnowledgeMaintenance).toHaveBeenCalledWith({
      pool,
      memoryStore,
      logger,
      projectRoot: '/repo/override',
    });
  });

  it('returns a null reportId when maintenance does not create a report', async () => {
    mockRun.mockResolvedValueOnce(
      makeMaintenanceResult({
        staleEntries: [],
        deletedFileEntries: [],
        synthesisClusters: [],
        consolidationItems: [],
        coverageReport: {
          covered: [],
          gaps: [],
          totalDirectories: 0,
          coveredCount: 0,
          gapCount: 0,
        },
        report: null,
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/maintenance',
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      summary: {
        reportId: null,
        staleEntries: 0,
        deletedFileEntries: 0,
        synthesisClusters: 0,
        consolidationItems: 0,
      },
    });
  });

  it('returns a 500 response when the maintenance run throws', async () => {
    mockRun.mockRejectedValueOnce(new Error('maintenance failed'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/maintenance',
      payload: { scope: 'project:agentctl' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'maintenance failed',
    });
  });
});
