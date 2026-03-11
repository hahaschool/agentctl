import type { MemoryStats } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemorySearch } from '../../memory/memory-search.js';
import type { MemoryStore } from '../../memory/memory-store.js';
import { createServer } from '../server.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

function createMockMemorySearch(overrides: Partial<MemorySearch> = {}): MemorySearch {
  return {
    search: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as MemorySearch;
}

function createMockMemoryStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    addFact: vi.fn(),
    listFacts: vi.fn().mockResolvedValue([]),
    deleteFact: vi.fn().mockResolvedValue(undefined),
    getFact: vi.fn().mockResolvedValue(null),
    updateFact: vi.fn().mockResolvedValue(null),
    invalidateFact: vi.fn().mockResolvedValue(undefined),
    listEdges: vi.fn().mockResolvedValue([]),
    addEdge: vi.fn(),
    deleteEdge: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn(),
    ...overrides,
  } as unknown as MemoryStore;
}

describe('memory stats routes', () => {
  let app: FastifyInstance;
  let memoryStore: MemoryStore;

  beforeEach(async () => {
    memoryStore = createMockMemoryStore();
    app = await createServer({
      logger,
      memorySearch: createMockMemorySearch(),
      memoryStore,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns memory stats', async () => {
    const stats: MemoryStats = {
      totalFacts: 12,
      newThisWeek: 3,
      avgConfidence: 0.75,
      pendingConsolidation: 0,
      byScope: { global: 4, 'project:agentctl': 8 },
      byEntityType: { decision: 5, pattern: 7 },
      strengthDistribution: { active: 9, decaying: 2, archived: 1 },
      growthTrend: [
        { date: '2026-03-10', count: 1 },
        { date: '2026-03-11', count: 2 },
      ],
    };
    vi.mocked(memoryStore.getStats).mockResolvedValueOnce(stats);

    const response = await app.inject({
      method: 'GET',
      url: '/api/memory/stats',
    });

    expect(response.statusCode).toBe(200);
    expect(memoryStore.getStats).toHaveBeenCalledTimes(1);
    expect(response.json()).toEqual({ ok: true, stats });
  });
});
