import { readFileSync } from 'node:fs';
import { generateDispatchSigningKeyPair, signDispatchPayload } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../db/index.js';
import { syncPeersRoutes } from './sync-peers.js';

const REGISTRATION_TOKEN = 'registration-token';

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
    last_ping_error: null,
    last_ping_status_code: null,
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

function makeValidUpsertPayload(overrides: Record<string, unknown> = {}) {
  return {
    machineId: 'machine-9',
    hostname: 'mesh-worker',
    syncUrl: 'http://100.64.0.9:8080',
    tailscaleIp: '100.64.0.9',
    publicKey: 'pk-9',
    ...overrides,
  };
}

function makeRegistrationPayload(
  overrides: Record<string, unknown> = {},
  signer = generateDispatchSigningKeyPair(),
  signatureOverrides: { issuedAt?: string } = {},
) {
  const body = {
    machineId: 'machine-9',
    hostname: 'mesh-worker',
    syncUrl: 'http://100.64.0.9:8080',
    tailscaleIp: '100.64.0.9',
    publicKey: signer.publicKey,
    ...overrides,
  };
  const registrationSignature = signDispatchPayload(
    {
      action: 'register-peer',
      machineId: body.machineId,
      hostname: body.hostname,
      syncUrl: body.syncUrl,
      tailscaleIp: body.tailscaleIp,
      publicKey: body.publicKey,
    },
    {
      agentId: 'register-peer',
      machineId: String(body.machineId),
      secretKey: signer.secretKey,
      issuedAt: signatureOverrides.issuedAt,
    },
  );

  return {
    payload: {
      ...body,
      registrationSignature,
    },
    signer,
  };
}

async function buildApp(
  db: Database,
  options: { registrationToken?: string } = { registrationToken: REGISTRATION_TOKEN },
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(syncPeersRoutes, {
    prefix: '/api/sync/peers',
    db,
    ...options,
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
    delete process.env.SYNC_PEER_REGISTRATION_RATE_LIMIT_MAX;
    delete process.env.SYNC_PEER_REGISTRATION_RATE_LIMIT_WINDOW_MS;
    vi.useRealTimers();
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
      payload: makeValidUpsertPayload(),
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

  it('registers a reverse sync peer with a bootstrap token and register-peer signature', async () => {
    const { payload } = makeRegistrationPayload();
    execute.mockResolvedValueOnce({
      rows: [
        makePeerRow({
          id: 'machine-9',
          hostname: 'mesh-worker',
          sync_url: 'http://100.64.0.9:8080',
          tailscale_ip: '100.64.0.9',
          public_key: payload.publicKey,
        }),
      ],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/register',
      headers: { 'x-sync-registration-token': REGISTRATION_TOKEN },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      ok: true,
      peer: {
        machineId: 'machine-9',
        hostname: 'mesh-worker',
        syncUrl: 'http://100.64.0.9:8080',
        publicKey: payload.publicKey,
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects reverse peer registration without a bootstrap token', async () => {
    const { payload } = makeRegistrationPayload();

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/register',
      payload,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'PEER_REGISTRATION_TOKEN_MISSING' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps reverse peer registration disabled when no operator token is configured', async () => {
    await app.close();
    app = await buildApp(db, { registrationToken: '' });
    const { payload } = makeRegistrationPayload();

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/register',
      headers: { 'x-sync-registration-token': REGISTRATION_TOKEN },
      payload,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'PEER_REGISTRATION_DISABLED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects reverse peer registration with an invalid bootstrap token', async () => {
    const { payload } = makeRegistrationPayload();

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/register',
      headers: { 'x-sync-registration-token': 'wrong-token' },
      payload,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'PEER_REGISTRATION_TOKEN_INVALID' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects reverse peer registration when the signature does not match the advertised public key', async () => {
    const signer = generateDispatchSigningKeyPair();
    const advertised = generateDispatchSigningKeyPair();
    const { payload } = makeRegistrationPayload({ publicKey: advertised.publicKey }, signer);

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/register',
      headers: { 'x-sync-registration-token': REGISTRATION_TOKEN },
      payload,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'PEER_REGISTRATION_INVALID_SIGNATURE' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects reverse peer registration with a stale register-peer signature', async () => {
    const { payload } = makeRegistrationPayload({}, generateDispatchSigningKeyPair(), {
      issuedAt: '2026-04-01T00:00:00.000Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/register',
      headers: { 'x-sync-registration-token': REGISTRATION_TOKEN },
      payload,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'PEER_REGISTRATION_INVALID_SIGNATURE' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('upserts an already registered reverse peer idempotently', async () => {
    const { payload } = makeRegistrationPayload({ hostname: 'mesh-worker-renamed' });
    execute.mockResolvedValueOnce({
      rows: [
        makePeerRow({
          id: 'machine-9',
          hostname: 'mesh-worker-renamed',
          sync_url: 'http://100.64.0.9:8080',
          tailscale_ip: '100.64.0.9',
          public_key: payload.publicKey,
        }),
      ],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/register',
      headers: { 'x-sync-registration-token': REGISTRATION_TOKEN },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      ok: true,
      peer: {
        machineId: 'machine-9',
        hostname: 'mesh-worker-renamed',
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rate limits reverse peer registration attempts', async () => {
    await app.close();
    process.env.SYNC_PEER_REGISTRATION_RATE_LIMIT_MAX = '1';
    process.env.SYNC_PEER_REGISTRATION_RATE_LIMIT_WINDOW_MS = '60000';
    app = await buildApp(db);
    const first = makeRegistrationPayload({ machineId: 'machine-9' });
    const second = makeRegistrationPayload({ machineId: 'machine-10' });
    execute.mockResolvedValue({
      rows: [makePeerRow({ id: 'machine-9', public_key: first.payload.publicKey })],
    });

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/register',
      headers: { 'x-sync-registration-token': REGISTRATION_TOKEN },
      payload: first.payload,
    });
    const blockedResponse = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/register',
      headers: { 'x-sync-registration-token': REGISTRATION_TOKEN },
      payload: second.payload,
    });

    expect(firstResponse.statusCode).toBe(201);
    expect(blockedResponse.statusCode).toBe(429);
    expect(blockedResponse.json()).toMatchObject({ error: 'RATE_LIMITED' });
  });

  it('keeps reverse peer registration rate-limited before bootstrap authorization', () => {
    const source = readFileSync(new URL('./sync-peers.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/await app\.register\(rateLimit,\s*\{/);
    expect(source).toMatch(
      /'\/register'[\s\S]*?config:\s*\{\s*rateLimit:\s*registrationRateLimitConfig\s*\}[\s\S]*?preHandler:\s*\[\s*app\.rateLimit\(registrationRateLimitConfig\),\s*authorizePeerRegistration\s*\][\s\S]*?\/\/ @fastify\/rate-limit runs before bootstrap token and register-peer signature verification;[\s\S]*?\/\/ CodeQL only models legacy fastify-rate-limit for this rule\.[\s\S]*?\n\s*\/\/ codeql\[js\/missing-rate-limiting\]\n\s*async \(request, reply\) =>/,
    );
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

  it.each([
    ['unsupported protocol', 'ftp://100.64.0.9:8080'],
    ['localhost hostname', 'http://localhost:8080'],
    ['localhost loopback IPv4', 'http://127.0.0.1:8080'],
    ['IPv6 loopback', 'http://[::1]:8080'],
    ['unspecified address', 'http://0.0.0.0:8080'],
    ['link-local metadata address', 'http://169.254.169.254/latest/meta-data'],
    ['link-local range', 'http://169.254.10.20:8080'],
    ['metadata hostname', 'http://metadata.google.internal/computeMetadata/v1'],
  ])('rejects peer upserts with an unsafe syncUrl: %s', async (_name, syncUrl) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers',
      payload: makeValidUpsertPayload({ syncUrl }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVALID_SYNC_URL' });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid role', { role: 'admin' }, 'INVALID_ROLE'],
    ['invalid sync status', { syncStatus: 'ready' }, 'INVALID_SYNC_STATUS'],
    ['zero interval', { syncIntervalMs: 0 }, 'INVALID_SYNC_INTERVAL'],
    ['negative interval', { syncIntervalMs: -1 }, 'INVALID_SYNC_INTERVAL'],
    ['fractional interval', { syncIntervalMs: 1500.5 }, 'INVALID_SYNC_INTERVAL'],
    ['excessive interval', { syncIntervalMs: 3_600_000 }, 'INVALID_SYNC_INTERVAL'],
  ])('rejects peer upserts with %s', async (_name, overrides: Record<
    string,
    unknown
  >, error: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers',
      payload: makeValidUpsertPayload(overrides),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error });
    expect(execute).not.toHaveBeenCalled();
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
          makePeerRow({
            id: 'machine-2',
            sync_status: 'unreachable',
            sync_interval_ms: 60000,
            last_ping_error: 'connect_refused',
          }),
        ],
      });
    const refused = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 100.64.0.2:8080'), {
        code: 'ECONNREFUSED',
      }),
    });
    globalThis.fetch = vi.fn().mockRejectedValue(refused) as typeof globalThis.fetch;

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/machine-2/ping',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      status: 'unreachable',
      pingError: { category: 'connect_refused', httpStatusCode: null },
      peer: {
        machineId: 'machine-2',
        syncStatus: 'unreachable',
        syncIntervalMs: 60000,
        lastPingError: 'connect_refused',
        lastPingStatusCode: null,
      },
    });
  });

  it('classifies TLS handshake failures from scheme mismatch as tls_handshake', async () => {
    execute
      .mockResolvedValueOnce({
        rows: [
          makePeerRow({
            id: 'machine-2',
            sync_url: 'https://100.64.0.2:8080',
            sync_status: 'reachable',
          }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          makePeerRow({
            id: 'machine-2',
            sync_url: 'https://100.64.0.2:8080',
            sync_status: 'unreachable',
            sync_interval_ms: 60000,
            last_ping_error: 'tls_handshake',
          }),
        ],
      });
    const tlsError = Object.assign(new Error('fetch failed'), {
      cause: Object.assign(new Error('ssl3_get_record:wrong version number'), { code: 'EPROTO' }),
    });
    globalThis.fetch = vi.fn().mockRejectedValue(tlsError) as typeof globalThis.fetch;

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/machine-2/ping',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      status: 'unreachable',
      pingError: { category: 'tls_handshake', httpStatusCode: null },
      peer: { machineId: 'machine-2', lastPingError: 'tls_handshake' },
    });
  });

  it('classifies ping timeouts as timeout', async () => {
    execute
      .mockResolvedValueOnce({
        rows: [makePeerRow({ id: 'machine-2', sync_status: 'reachable' })],
      })
      .mockResolvedValueOnce({
        rows: [
          makePeerRow({
            id: 'machine-2',
            sync_status: 'unreachable',
            sync_interval_ms: 60000,
            last_ping_error: 'timeout',
          }),
        ],
      });
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    globalThis.fetch = vi.fn().mockRejectedValue(timeout) as typeof globalThis.fetch;

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/machine-2/ping',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      status: 'unreachable',
      pingError: { category: 'timeout', httpStatusCode: null },
      peer: { machineId: 'machine-2', lastPingError: 'timeout' },
    });
  });

  it('persists non-2xx health responses as http_status with status code', async () => {
    execute
      .mockResolvedValueOnce({
        rows: [makePeerRow({ id: 'machine-2', sync_status: 'reachable' })],
      })
      .mockResolvedValueOnce({
        rows: [
          makePeerRow({
            id: 'machine-2',
            sync_status: 'unreachable',
            sync_interval_ms: 60000,
            last_ping_error: 'http_status',
            last_ping_status_code: 503,
          }),
        ],
      });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ status: 'degraded' }),
    }) as typeof globalThis.fetch;

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/machine-2/ping',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      status: 'unreachable',
      pingError: { category: 'http_status', httpStatusCode: 503 },
      peer: {
        machineId: 'machine-2',
        lastPingError: 'http_status',
        lastPingStatusCode: 503,
      },
    });
  });

  it('does not fetch and persists bad_url when pinging a peer with an unsafe stored syncUrl', async () => {
    execute
      .mockResolvedValueOnce({
        rows: [
          makePeerRow({
            id: 'machine-2',
            sync_url: 'http://169.254.169.254/latest/meta-data',
          }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          makePeerRow({
            id: 'machine-2',
            sync_url: 'http://169.254.169.254/latest/meta-data',
            sync_status: 'unreachable',
            sync_interval_ms: 60000,
            last_ping_error: 'bad_url',
          }),
        ],
      });
    globalThis.fetch = vi.fn() as typeof globalThis.fetch;

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/machine-2/ping',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'INVALID_SYNC_URL',
      peer: {
        machineId: 'machine-2',
        syncStatus: 'unreachable',
        lastPingError: 'bad_url',
      },
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('clears persisted ping errors after a successful health check', async () => {
    execute
      .mockResolvedValueOnce({
        rows: [
          makePeerRow({
            id: 'machine-2',
            sync_status: 'unreachable',
            sync_interval_ms: 60000,
            last_ping_error: 'timeout',
          }),
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          makePeerRow({
            id: 'machine-2',
            sync_status: 'reachable',
            sync_interval_ms: 30000,
            last_ping_error: null,
            last_ping_status_code: null,
          }),
        ],
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
      pingError: null,
      peer: {
        machineId: 'machine-2',
        syncStatus: 'reachable',
        lastPingError: null,
        lastPingStatusCode: null,
      },
    });
  });
});
