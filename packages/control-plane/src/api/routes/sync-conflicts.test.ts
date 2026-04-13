import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { syncConflictsRoutes } from './sync-conflicts.js';
import { createMockLogger } from './test-helpers.js';

function createMockDb() {
  const executeResults: Array<{ rows: Record<string, unknown>[] }> = [];
  const txExecute = vi.fn(async () => ({ rows: [] }));

  const db = {
    execute: vi.fn(async () => executeResults.shift() ?? { rows: [] }),
    transaction: vi.fn(async (fn: (tx: { execute: typeof txExecute }) => Promise<unknown>) =>
      fn({ execute: txExecute }),
    ),
  };

  return {
    db,
    txExecute,
    queueRows: (...rows: Record<string, unknown>[][]) => {
      executeResults.push(...rows.map((set) => ({ rows: set })));
    },
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  const mockDb = createMockDb();
  const logger = createMockLogger();

  await app.register(syncConflictsRoutes, {
    prefix: '/api/sync/conflicts',
    db: mockDb.db as never,
    logger,
    selfMachineId: 'node-self',
  });
  await app.ready();

  return { app, mockDb, logger };
}

describe('syncConflictsRoutes', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('lists conflicts with camel-cased response fields', async () => {
    const built = await buildApp();
    app = built.app;
    built.mockDb.queueRows([
      {
        id: 'conflict-1',
        table_name: 'agents',
        row_id: 'agent-123',
        local_vclock: { 'node-a': 2 },
        local_payload: { id: 'agent-123', name: 'Local Agent' },
        remote_vclock: { 'node-b': 3 },
        remote_payload: { id: 'agent-123', name: 'Remote Agent' },
        remote_node_id: 'node-b',
        status: 'pending',
        resolution: null,
        resolved_at: null,
        created_at: '2026-04-01T09:00:00.000Z',
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/sync/conflicts?status=pending',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      conflicts: [
        {
          id: 'conflict-1',
          tableName: 'agents',
          rowId: 'agent-123',
          localVclock: { 'node-a': 2 },
          localPayload: { id: 'agent-123', name: 'Local Agent' },
          remoteVclock: { 'node-b': 3 },
          remotePayload: { id: 'agent-123', name: 'Remote Agent' },
          remoteNodeId: 'node-b',
          status: 'pending',
          resolution: null,
          resolvedAt: null,
          createdAt: '2026-04-01T09:00:00.000Z',
        },
      ],
      total: 1,
    });
  });

  it('returns 404 when a requested conflict is missing', async () => {
    const built = await buildApp();
    app = built.app;
    built.mockDb.queueRows([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/sync/conflicts/conflict-missing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'CONFLICT_NOT_FOUND',
      message: "Sync conflict 'conflict-missing' not found",
    });
  });

  it('rejects merged resolutions without a payload', async () => {
    const built = await buildApp();
    app = built.app;

    const response = await app.inject({
      method: 'PUT',
      url: '/api/sync/conflicts/conflict-1/resolve',
      payload: { resolution: 'merged' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'MISSING_PAYLOAD',
      message: 'payload is required when resolution is "merged"',
    });
    expect(built.mockDb.db.execute).not.toHaveBeenCalled();
  });

  it('resolves a pending conflict and writes through the guarded transaction path', async () => {
    const built = await buildApp();
    app = built.app;
    built.mockDb.queueRows([
      {
        id: 'conflict-2',
        table_name: 'agents',
        row_id: 'agent-456',
        local_vclock: { 'node-a': 1 },
        local_payload: { id: 'agent-456', name: 'Local Agent' },
        remote_vclock: { 'node-b': 2 },
        remote_payload: { id: 'agent-456', name: 'Remote Agent' },
        remote_node_id: 'node-b',
        status: 'pending',
        existing_resolution: null,
        resolution: null,
        resolved_at: null,
        created_at: '2026-04-01T09:10:00.000Z',
      },
    ]);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/sync/conflicts/conflict-2/resolve',
      payload: { resolution: 'remote' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, resolution: 'remote' });
    expect(built.mockDb.db.transaction).toHaveBeenCalledTimes(1);
    expect(built.mockDb.txExecute).toHaveBeenCalledTimes(4);
    expect(built.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        conflictId: 'conflict-2',
        resolution: 'remote',
        tableName: 'agents',
        rowId: 'agent-456',
      }),
      'sync conflict resolved',
    );
  });

  it('returns the pending conflict count for sidebar polling', async () => {
    const built = await buildApp();
    app = built.app;
    built.mockDb.queueRows([{ count: 3 }]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/sync/conflicts/count',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ count: 3 });
  });

  it('rejects overlong resolution payload on PUT /:id/resolve with 400', async () => {
    const built = await buildApp();
    app = built.app;

    const bigPayload: Record<string, string> = {};
    for (let i = 0; i < 2000; i += 1) {
      bigPayload[`key${i}`] = 'x'.repeat(64);
    }

    const response = await app.inject({
      method: 'PUT',
      url: '/api/sync/conflicts/conflict-1/resolve',
      payload: {
        resolution: 'merged',
        payload: bigPayload,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PAYLOAD');
  });
});
