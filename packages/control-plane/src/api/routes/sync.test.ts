import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateSyncAuthHook } = vi.hoisted(() => ({
  mockCreateSyncAuthHook: vi.fn(() => async (request: { headers: Record<string, unknown> }) => {
    request.headers['x-verified-peer-id'] = String(request.headers['x-test-peer-id'] ?? 'node-a');
  }),
}));

vi.mock('../../sync/sync-auth.js', () => ({
  createSyncAuthHook: mockCreateSyncAuthHook,
}));

import { syncRoutes } from './sync.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

async function buildApp() {
  const app = Fastify({ logger: false });
  const db = {
    execute: vi.fn(async () => ({ rows: [] })),
  };

  await app.register(syncRoutes, {
    prefix: '/api/sync',
    db: db as never,
    logger,
    selfMachineId: 'node-self',
  });
  await app.ready();
  return { app, db };
}

describe('syncRoutes rate limiting', () => {
  let app: Awaited<ReturnType<typeof buildApp>>['app'];

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.SYNC_ROUTE_RATE_LIMIT_MAX = '2';
    process.env.SYNC_ROUTE_RATE_LIMIT_WINDOW_MS = '60000';
    ({ app } = await buildApp());
  });

  afterEach(async () => {
    delete process.env.SYNC_ROUTE_RATE_LIMIT_MAX;
    delete process.env.SYNC_ROUTE_RATE_LIMIT_WINDOW_MS;
    await app.close();
  });

  it('adds rate-limit headers to GET /api/sync/changes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/sync/changes?since=0&limit=1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('returns 429 after repeated requests exceed the sync route limit', async () => {
    let response: Awaited<ReturnType<typeof app.inject>> | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await app.inject({
        method: 'GET',
        url: '/api/sync/changes?since=0&limit=1',
      });
    }

    expect(response?.statusCode).toBe(429);
    expect(response?.json()).toEqual({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Too many requests',
    });
  });

  it('keys sync rate limiting by verified peer id when auth has resolved one', async () => {
    const firstPeer = await app.inject({
      method: 'POST',
      url: '/api/sync/ack',
      headers: { 'x-test-peer-id': 'node-a' },
      payload: { machineId: 'node-a', cursor: 1 },
    });
    const secondPeer = await app.inject({
      method: 'POST',
      url: '/api/sync/ack',
      headers: { 'x-test-peer-id': 'node-b' },
      payload: { machineId: 'node-b', cursor: 1 },
    });

    expect(firstPeer.statusCode).toBe(200);
    expect(secondPeer.statusCode).toBe(200);
  });
});
