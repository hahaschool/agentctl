// ---------------------------------------------------------------------------
// Tests for the shared drawer-search helper. Mirrors the per-path SQL routing
// approach from `memory-drawers.test.ts` so the fusion behaviour is covered
// both at the helper level and at the Fastify route level.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';
import {
  type DrawerEmbeddingClient,
  fuseRankedMatches,
  keywordSearch,
  searchMemoryDrawers,
  vectorSearch,
} from './memory-drawer-search.js';

type PoolMock = { query: ReturnType<typeof vi.fn> };

function createMockPool(): PoolMock {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

type SearchRow = {
  id: string;
  scope: string;
  topic: string;
  source_type: string;
  source_id: string;
  chunk_index: number;
  content: string;
  score: number;
  rank: number;
};

function makeSearchRow(overrides: Partial<SearchRow> = {}): SearchRow {
  return {
    id: 'drawer-A',
    scope: 'session:sess-1',
    topic: 'general',
    source_type: 'session-jsonl',
    source_id: 'sess-1',
    chunk_index: 0,
    content: 'hello drawer content'.repeat(4),
    score: 0.5,
    rank: 1,
    ...overrides,
  };
}

function routeQueries(
  pool: PoolMock,
  routes: { keyword?: SearchRow[]; vector?: SearchRow[] },
): void {
  pool.query.mockImplementation(async (sql: string) => {
    if (sql.includes('content_tsv_simple')) {
      return { rows: routes.keyword ?? [] };
    }
    if (sql.includes('embedding <=>')) {
      return { rows: routes.vector ?? [] };
    }
    return { rows: [] };
  });
}

describe('searchMemoryDrawers helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array for empty query (no SQL issued)', async () => {
    const pool = createMockPool();
    const results = await searchMemoryDrawers(
      { query: '   ', limit: 10 },
      { pool: pool as never, logger: createMockLogger() },
    );
    expect(results).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('keyword-only path when no embedding client is provided', async () => {
    const pool = createMockPool();
    routeQueries(pool, {
      keyword: [makeSearchRow({ id: 'drawer-A', rank: 1 })],
    });

    const results = await searchMemoryDrawers(
      { query: 'hello', limit: 10 },
      { pool: pool as never, logger: createMockLogger() },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('drawer-A');
    expect(results[0]?.match_type).toBe('keyword');
    expect(typeof results[0]?.score).toBe('number');
  });

  it('fuses keyword + vector matches via RRF when embedding client is provided', async () => {
    const pool = createMockPool();
    const embeddingClient: DrawerEmbeddingClient = {
      embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };
    routeQueries(pool, {
      keyword: [makeSearchRow({ id: 'drawer-A', rank: 1 })],
      vector: [
        makeSearchRow({ id: 'drawer-A', rank: 1 }),
        makeSearchRow({ id: 'drawer-B', rank: 2 }),
      ],
    });

    const results = await searchMemoryDrawers(
      { query: 'hello', limit: 10 },
      {
        pool: pool as never,
        embeddingClient,
        logger: createMockLogger(),
      },
    );

    // Drawer-A surfaces from both paths, so its RRF score is larger than B's.
    expect(results[0]?.id).toBe('drawer-A');
    expect(results[0]?.match_type).toBe('vector');
    expect(results[1]?.id).toBe('drawer-B');
    expect(results[0]?.score).toBeDefined();
    expect(results[1]?.score).toBeDefined();
    if (results[0]?.score !== null && results[1]?.score !== null) {
      expect(Number(results[0]?.score)).toBeGreaterThan(Number(results[1]?.score));
    }
  });

  it('degrades to keyword-only when embed() throws', async () => {
    const pool = createMockPool();
    const embeddingClient: DrawerEmbeddingClient = {
      embed: vi.fn().mockRejectedValue(new Error('LiteLLM down')),
    };
    routeQueries(pool, {
      keyword: [makeSearchRow({ id: 'drawer-A', rank: 1 })],
    });

    const results = await searchMemoryDrawers(
      { query: 'hello', limit: 10 },
      {
        pool: pool as never,
        embeddingClient,
        logger: createMockLogger(),
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('drawer-A');
  });

  it('propagates scope through both paths', async () => {
    const pool = createMockPool();
    const embeddingClient: DrawerEmbeddingClient = {
      embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };
    routeQueries(pool, {
      keyword: [makeSearchRow({ scope: 'session:sess-1' })],
      vector: [makeSearchRow({ scope: 'session:sess-1' })],
    });

    await searchMemoryDrawers(
      { query: 'hello', scope: 'session:sess-1', limit: 10 },
      {
        pool: pool as never,
        embeddingClient,
        logger: createMockLogger(),
      },
    );

    const calls = pool.query.mock.calls;
    const keywordCall = calls.find((call) => String(call[0]).includes('content_tsv_simple'));
    const vectorCall = calls.find((call) => String(call[0]).includes('embedding <=>'));
    expect(keywordCall?.[1]).toEqual(expect.arrayContaining(['session:sess-1']));
    expect(vectorCall?.[1]).toEqual(expect.arrayContaining(['session:sess-1']));
  });

  it('caps fused results to the requested limit', async () => {
    const pool = createMockPool();
    routeQueries(pool, {
      keyword: Array.from({ length: 12 }, (_, i) =>
        makeSearchRow({ id: `drawer-${i}`, rank: i + 1 }),
      ),
    });

    const results = await searchMemoryDrawers(
      { query: 'hello', limit: 5 },
      { pool: pool as never, logger: createMockLogger() },
    );
    expect(results).toHaveLength(5);
  });
});

describe('fuseRankedMatches primitive', () => {
  it('returns empty when both paths are empty', () => {
    const fused = fuseRankedMatches([], [], 10);
    expect(fused).toEqual([]);
  });

  it('labels match_type as keyword when only keyword path surfaces the row', () => {
    const keywordMatch = {
      rank: 1,
      result: {
        id: 'only-keyword',
        scope: 'session:sess',
        topic: 'general',
        source_type: 'session-jsonl' as const,
        source_id: 'sess',
        chunk_index: 0,
        content_preview: 'x',
        score: null,
        match_type: 'keyword' as const,
      },
    };
    const fused = fuseRankedMatches([keywordMatch], [], 10);
    expect(fused[0]?.match_type).toBe('keyword');
  });
});

describe('keywordSearch + vectorSearch return [] on pool failure', () => {
  it('logs a warning and returns [] when the SQL query rejects', async () => {
    const pool: PoolMock = {
      query: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const logger = createMockLogger();

    const keyword = await keywordSearch(pool as never, 'hello', null, 10, logger);
    expect(keyword).toEqual([]);

    const vector = await vectorSearch(
      pool as never,
      'hello',
      null,
      10,
      { embed: vi.fn().mockResolvedValue([0.1]) },
      logger,
    );
    expect(vector).toEqual([]);
  });
});
