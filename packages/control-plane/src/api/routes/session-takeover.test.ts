import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionTakeoverRoutes } from './session-takeover.js';
import {
  createMockDbRegistry,
  mockFetchError,
  mockFetchOk,
  saveOriginalFetch,
} from './test-helpers.js';

function flattenDrizzleSql(chunks: unknown[]): { sql: string; params: unknown[] } {
  let sqlStr = '';
  const params: unknown[] = [];

  for (const chunk of chunks) {
    if (chunk && typeof chunk === 'object' && 'queryChunks' in chunk) {
      const nested = flattenDrizzleSql((chunk as { queryChunks: unknown[] }).queryChunks);
      sqlStr += nested.sql;
      params.push(...nested.params);
    } else if (chunk && typeof chunk === 'object' && 'value' in chunk) {
      sqlStr += (chunk as { value: string[] }).value.join('');
    } else {
      params.push(chunk);
      sqlStr += `$${params.length}`;
    }
  }

  return { sql: sqlStr, params };
}

function extractQuery(query: unknown): { sql: string; params: unknown[] } {
  if (query && typeof query === 'object' && 'queryChunks' in query) {
    return flattenDrizzleSql((query as { queryChunks: unknown[] }).queryChunks);
  }
  if (query && typeof query === 'object' && 'sql' in query) {
    return query as { sql: string; params: unknown[] };
  }
  return { sql: '', params: [] };
}

function createMockDb() {
  let queuedResults: unknown[][] = [];
  const setCalls: Record<string, unknown>[] = [];

  const chain: Record<string, unknown> = {};
  const chainMethods = [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'insert',
    'update',
    'delete',
    'values',
    'returning',
    'onConflictDoUpdate',
  ];

  for (const method of chainMethods) {
    chain[method] = vi.fn(() => chain);
  }

  chain.set = vi.fn((value: Record<string, unknown>) => {
    setCalls.push(value);
    return chain;
  });

  // biome-ignore lint/suspicious/noThenProperty: Drizzle query builder mock requires a thenable
  chain.then = (resolve: (value: unknown) => void) => {
    resolve(queuedResults.shift() ?? []);
    return chain;
  };

  return {
    db: chain,
    queueRows: (...nextRows: unknown[][]) => {
      queuedResults = [...queuedResults, ...nextRows];
    },
    setCalls,
  };
}

function findTakeoverStatusPayload(setArg: Record<string, unknown> | undefined) {
  const metadata = setArg?.metadata;
  const { sql, params } = extractQuery(metadata);
  const payload = params.find(
    (value): value is string => typeof value === 'string' && value.includes('"takeoverStatus"'),
  );
  return {
    sql,
    payload: payload ? (JSON.parse(payload) as { takeoverStatus: Record<string, unknown> }) : null,
  };
}

async function buildApp(
  mockDb: ReturnType<typeof createMockDb>,
  dbRegistry = createMockDbRegistry(),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sessionTakeoverRoutes, {
    prefix: '/api/sessions',
    db: mockDb.db as never,
    dbRegistry,
    workerPort: 9000,
  });
  await app.ready();
  return app;
}

const originalFetch = saveOriginalFetch();

describe('sessionTakeoverRoutes', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('returns 404 when the session does not exist', async () => {
    const mockDb = createMockDb();
    mockDb.queueRows([]);
    app = await buildApp(mockDb);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/session-missing/takeover',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'SESSION_NOT_FOUND',
      message: "Session 'session-missing' does not exist",
    });
  });

  it('returns 400 when the session has no machineId', async () => {
    const mockDb = createMockDb();
    mockDb.queueRows([{ id: 'session-1', machineId: '', metadata: {} }]);
    app = await buildApp(mockDb);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/session-1/takeover',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'SESSION_NO_MACHINE',
      message: "Session 'session-1' has no associated machineId",
    });
  });

  it('proxies takeover to the worker, persists takeoverStatus, and includes machineId', async () => {
    const mockDb = createMockDb();
    mockDb.queueRows([{ id: 'session-1', machineId: 'machine-1', metadata: {} }], []);
    app = await buildApp(mockDb);
    mockFetchOk({ ok: true, terminalId: 'term-1', takeoverToken: 'takeover-1' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/session-1/takeover',
    });

    expect(response.statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://100.64.0.1:9000/api/sessions/session-1/takeover',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(response.json()).toEqual({
      ok: true,
      terminalId: 'term-1',
      takeoverToken: 'takeover-1',
      machineId: 'machine-1',
    });

    expect(mockDb.setCalls).toHaveLength(1);
    const persisted = findTakeoverStatusPayload(mockDb.setCalls[0]);
    expect(persisted.sql).toContain('COALESCE');
    expect(persisted.payload?.takeoverStatus).toMatchObject({
      active: true,
      terminalId: 'term-1',
      machineId: 'machine-1',
    });
    expect(typeof persisted.payload?.takeoverStatus.startedAt).toBe('string');
  });

  it('returns worker errors without persisting takeover metadata', async () => {
    const mockDb = createMockDb();
    mockDb.queueRows([{ id: 'session-2', machineId: 'machine-1', metadata: {} }]);
    app = await buildApp(mockDb);
    mockFetchError(502);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/session-2/takeover',
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: 'WORKER_ERROR',
      message: 'Something went wrong',
    });
    expect(mockDb.setCalls).toHaveLength(0);
  });

  it('proxies release, persists inactive takeoverStatus, and returns the worker result', async () => {
    const mockDb = createMockDb();
    mockDb.queueRows([{ id: 'session-3', machineId: 'machine-1', metadata: {} }], []);
    app = await buildApp(mockDb);
    mockFetchOk({ ok: true, released: true });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/session-3/release',
    });

    expect(response.statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://100.64.0.1:9000/api/sessions/session-3/release',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(response.json()).toEqual({ ok: true, released: true });

    expect(mockDb.setCalls).toHaveLength(1);
    const persisted = findTakeoverStatusPayload(mockDb.setCalls[0]);
    expect(persisted.payload?.takeoverStatus).toMatchObject({
      active: false,
    });
    expect(typeof persisted.payload?.takeoverStatus.releasedAt).toBe('string');
  });

  it('GET proxies the current takeover state from the worker', async () => {
    const mockDb = createMockDb();
    mockDb.queueRows([{ id: 'session-4', machineId: 'machine-1', metadata: {} }]);
    app = await buildApp(mockDb);
    mockFetchOk({
      ok: true,
      takeoverStatus: {
        active: true,
        terminalId: 'term-4',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/sessions/session-4/takeover',
    });

    expect(response.statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://100.64.0.1:9000/api/sessions/session-4/takeover',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(response.json()).toEqual({
      ok: true,
      takeoverStatus: {
        active: true,
        terminalId: 'term-4',
      },
    });
  });
});
