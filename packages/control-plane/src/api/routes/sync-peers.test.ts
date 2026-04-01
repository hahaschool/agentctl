import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../db/index.js';
import { syncPeersRoutes } from './sync-peers.js';

function makePeerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'machine-2',
    hostname: 'peer-host',
    tailscale_ip: '100.64.0.2',
    sync_url: 'http://100.64.0.2:8080',
    role: 'full',
    sync_status: 'unknown',
    sync_interval_ms: 30000,
    is_self: false,
    public_key: 'peer-public-key',
    last_seen: null,
    created_at: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockDb(): Database {
  return {
    execute: vi.fn(),
  } as unknown as Database;
}

async function buildApp(db: Database): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(syncPeersRoutes, {
    prefix: '/api/sync/peers',
    db,
  });
  await app.ready();
  return app;
}

describe('syncPeersRoutes', () => {
  let app: FastifyInstance;
  let db: Database;
  let execute: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    db = createMockDb();
    execute = vi.mocked(db.execute);
    app = await buildApp(db);
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
    vi.restoreAllMocks();
  });

  it('lists sync peers', async () => {
    execute.mockResolvedValueOnce({
      rows: [makePeerRow(), makePeerRow({ id: 'machine-3', hostname: 'another-peer' })],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/sync/peers',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      peers: [
        { machineId: 'machine-2', hostname: 'peer-host' },
        { machineId: 'machine-3', hostname: 'another-peer' },
      ],
    });
  });

  it('upserts a sync peer', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        makePeerRow({
          id: 'machine-9',
          hostname: 'mesh-worker',
          sync_url: 'http://100.64.0.9:8080',
          tailscale_ip: '100.64.0.9',
        }),
      ],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers',
      payload: {
        machineId: 'machine-9',
        hostname: 'mesh-worker',
        syncUrl: 'http://100.64.0.9:8080',
        tailscaleIp: '100.64.0.9',
        publicKey: 'pk-9',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      ok: true,
      peer: {
        machineId: 'machine-9',
        hostname: 'mesh-worker',
        syncUrl: 'http://100.64.0.9:8080',
      },
    });
  });

  it('rejects peer upserts without a machineId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers',
      payload: {
        machineId: '',
        hostname: 'mesh-worker',
        syncUrl: 'http://100.64.0.9:8080',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_MACHINE_ID' });
  });

  it('deletes a sync peer', async () => {
    execute.mockResolvedValueOnce({
      rows: [makePeerRow({ id: 'machine-2' })],
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/sync/peers/machine-2',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      peer: { machineId: 'machine-2' },
    });
  });

  it('returns 404 when deleting a missing sync peer', async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/sync/peers/missing-peer',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'SYNC_PEER_NOT_FOUND' });
  });

  it('pings a peer and marks it reachable', async () => {
    execute
      .mockResolvedValueOnce({
        rows: [makePeerRow({ id: 'machine-2', sync_status: 'unknown', sync_interval_ms: 30000 })],
      })
      .mockResolvedValueOnce({
        rows: [makePeerRow({ id: 'machine-2', sync_status: 'reachable', sync_interval_ms: 30000 })],
      });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok' }),
    }) as typeof globalThis.fetch;

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/machine-2/ping',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      status: 'reachable',
      peer: { machineId: 'machine-2', syncStatus: 'reachable' },
    });
  });

  it('pings a peer and marks it unreachable when health check fails', async () => {
    execute
      .mockResolvedValueOnce({
        rows: [makePeerRow({ id: 'machine-2', sync_status: 'reachable', sync_interval_ms: 30000 })],
      })
      .mockResolvedValueOnce({
        rows: [
          makePeerRow({ id: 'machine-2', sync_status: 'unreachable', sync_interval_ms: 60000 }),
        ],
      });
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('connection refused')) as typeof globalThis.fetch;

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/machine-2/ping',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      status: 'unreachable',
      peer: { machineId: 'machine-2', syncStatus: 'unreachable', syncIntervalMs: 60000 },
    });
  });
});
