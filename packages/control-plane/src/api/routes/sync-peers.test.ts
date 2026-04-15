import { readFileSync } from 'node:fs';
import { generateDispatchSigningKeyPair, signDispatchPayload } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../db/index.js';
import type { SelfIdentity } from '../../sync/peer-reverse-registration.js';
import { syncPeersRoutes } from './sync-peers.js';

const REGISTRATION_TOKEN = 'registration-token';

const REVERSE_SIGNING_KEYS = generateDispatchSigningKeyPair();

const SELF_IDENTITY: SelfIdentity = {
  machineId: 'self-machine',
  hostname: 'self-host',
  tailscaleIp: '100.64.0.1',
  syncUrl: 'http://100.64.0.1:8080',
  publicKey: REVERSE_SIGNING_KEYS.publicKey,
};

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
    peer_version: null,
    peer_git_sha: null,
    peer_schema_version: null,
    reverse_registration_status: null,
    reverse_registration_error: null,
    reverse_registration_at: null,
    last_schema_ahead_version: null,
    last_schema_ahead_at: null,
    schema_ahead_count: 0,
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

  it('exposes schema-ahead rejection fields on the /api/sync/peers response (§33.10)', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        makePeerRow({
          id: 'machine-ahead',
          hostname: 'peer-ahead',
          last_schema_ahead_version: 42,
          last_schema_ahead_at: '2026-04-15T12:00:00.000Z',
          schema_ahead_count: 3,
        }),
        makePeerRow({
          id: 'machine-clean',
          hostname: 'peer-clean',
        }),
      ],
    });

    const response = await app.inject({ method: 'GET', url: '/api/sync/peers' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      peers: Array<{
        machineId: string;
        lastSchemaAheadVersion?: number | null;
        lastSchemaAheadAt?: string | null;
        schemaAheadCount?: number | null;
      }>;
    };
    expect(body.peers).toHaveLength(2);
    expect(body.peers[0]).toMatchObject({
      machineId: 'machine-ahead',
      lastSchemaAheadVersion: 42,
      lastSchemaAheadAt: '2026-04-15T12:00:00.000Z',
      schemaAheadCount: 3,
    });
    expect(body.peers[1]).toMatchObject({
      machineId: 'machine-clean',
      lastSchemaAheadVersion: null,
      lastSchemaAheadAt: null,
      schemaAheadCount: 0,
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

  it('persists peer version fields parsed from /health body (33.9)', async () => {
    execute
      .mockResolvedValueOnce({
        rows: [makePeerRow({ id: 'machine-2', sync_status: 'unknown' })],
      })
      .mockResolvedValueOnce({
        rows: [
          makePeerRow({
            id: 'machine-2',
            sync_status: 'reachable',
            peer_version: '0.4.0',
            peer_git_sha: 'abc1234',
            peer_schema_version: 24,
          }),
        ],
      });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'ok',
        appVersion: '0.4.0',
        gitSha: 'abc1234',
        schemaVersion: 24,
      }),
    }) as typeof globalThis.fetch;

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/machine-2/ping',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      status: 'reachable',
      peer: {
        machineId: 'machine-2',
        syncStatus: 'reachable',
        peerVersion: '0.4.0',
        peerGitSha: 'abc1234',
        peerSchemaVersion: 24,
      },
    });

    // The UPDATE (second execute call) must carry the extracted version fields
    // as bound params. Drizzle `sql` puts raw params directly in `queryChunks`
    // alongside SQL string-piece objects — we filter out the latter.
    const updateCall = execute.mock.calls[1]?.[0] as { queryChunks?: unknown[] };
    const bindParams = (updateCall?.queryChunks ?? []).filter(
      (chunk) => !(chunk && typeof chunk === 'object' && 'value' in chunk),
    );
    expect(bindParams).toEqual(expect.arrayContaining(['0.4.0', 'abc1234', 24, 'machine-2']));
  });

  it('leaves peer version columns null when /health omits the new fields (older peer)', async () => {
    execute
      .mockResolvedValueOnce({
        rows: [makePeerRow({ id: 'machine-2', sync_status: 'unknown' })],
      })
      .mockResolvedValueOnce({
        rows: [
          makePeerRow({
            id: 'machine-2',
            sync_status: 'reachable',
            peer_version: null,
            peer_git_sha: null,
            peer_schema_version: null,
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
      peer: {
        machineId: 'machine-2',
        syncStatus: 'reachable',
        peerVersion: null,
        peerGitSha: null,
        peerSchemaVersion: null,
      },
    });
  });

  it('tolerates malformed JSON in /health body without failing the ping', async () => {
    execute
      .mockResolvedValueOnce({
        rows: [makePeerRow({ id: 'machine-2', sync_status: 'unknown' })],
      })
      .mockResolvedValueOnce({
        rows: [
          makePeerRow({
            id: 'machine-2',
            sync_status: 'reachable',
          }),
        ],
      });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    }) as typeof globalThis.fetch;

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/machine-2/ping',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      status: 'reachable',
      peer: {
        machineId: 'machine-2',
        syncStatus: 'reachable',
        peerVersion: null,
        peerGitSha: null,
        peerSchemaVersion: null,
      },
    });
  });
});

describe('syncPeersRoutes reverse registration (§33.8)', () => {
  let app: FastifyInstance;
  let db: Database;
  let execute: ReturnType<typeof vi.fn>;
  let fetchImpl: ReturnType<typeof vi.fn>;

  async function buildReverseApp(
    options: {
      selfIdentity?: SelfIdentity | null;
      signingSecretKey?: string | null;
      reverseRegistrationToken?: string | null;
    } = {},
  ): Promise<FastifyInstance> {
    const instance = Fastify({ logger: false });
    await instance.register(syncPeersRoutes, {
      prefix: '/api/sync/peers',
      db,
      registrationToken: REGISTRATION_TOKEN,
      selfIdentity: 'selfIdentity' in options ? options.selfIdentity : SELF_IDENTITY,
      signingSecretKey:
        'signingSecretKey' in options ? options.signingSecretKey : REVERSE_SIGNING_KEYS.secretKey,
      reverseRegistrationToken:
        'reverseRegistrationToken' in options ? options.reverseRegistrationToken : 'reverse-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await instance.ready();
    return instance;
  }

  beforeEach(async () => {
    db = createMockDb();
    execute = vi.mocked(db.execute);
    fetchImpl = vi.fn();
    app = await buildReverseApp();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('persists reverse_registration_status=ok after successful upsert handshake', async () => {
    fetchImpl.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    // First call: INSERT ... ON CONFLICT ... RETURNING
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
    // Second call: UPDATE ... SET reverse_registration_status ... RETURNING
    execute.mockResolvedValueOnce({
      rows: [
        makePeerRow({
          id: 'machine-9',
          hostname: 'mesh-worker',
          sync_url: 'http://100.64.0.9:8080',
          tailscale_ip: '100.64.0.9',
          reverse_registration_status: 'ok',
          reverse_registration_error: null,
          reverse_registration_at: '2026-04-01T00:00:00.000Z',
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
        reverseRegistrationStatus: 'ok',
        reverseRegistrationError: null,
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://100.64.0.9:8080/api/sync/peers/register');
    expect(init?.method).toBe('POST');
    expect(init?.headers?.['x-sync-registration-token']).toBe('reverse-token');
  });

  it('persists reverse_registration_status=failed when peer returns 401', async () => {
    fetchImpl.mockResolvedValueOnce(
      new Response('bootstrap token invalid', { status: 401, statusText: 'Unauthorized' }),
    );

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
    execute.mockResolvedValueOnce({
      rows: [
        makePeerRow({
          id: 'machine-9',
          hostname: 'mesh-worker',
          sync_url: 'http://100.64.0.9:8080',
          tailscale_ip: '100.64.0.9',
          reverse_registration_status: 'failed',
          reverse_registration_error: 'HTTP 401 Unauthorized bootstrap token invalid',
          reverse_registration_at: '2026-04-01T00:00:00.000Z',
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
        reverseRegistrationStatus: 'failed',
        reverseRegistrationError: 'HTTP 401 Unauthorized bootstrap token invalid',
      },
    });
    // Confirm the UPDATE path received a 'failed' status
    const updateCall = execute.mock.calls[1]?.[0];
    expect(JSON.stringify(updateCall)).toContain('failed');
  });

  it('skips reverse registration on upsert when selfIdentity is missing', async () => {
    await app.close();
    app = await buildReverseApp({ selfIdentity: null });

    execute.mockResolvedValueOnce({
      rows: [
        makePeerRow({
          id: 'machine-9',
          hostname: 'mesh-worker',
          sync_url: 'http://100.64.0.9:8080',
        }),
      ],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers',
      payload: makeValidUpsertPayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(fetchImpl).not.toHaveBeenCalled();
    // Only the INSERT executed — no follow-up UPDATE
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when register-reverse targets an unknown peer', async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/machine-missing/register-reverse',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'SYNC_PEER_NOT_FOUND' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 200 and refreshed peer when register-reverse succeeds', async () => {
    // fetchPeer
    execute.mockResolvedValueOnce({
      rows: [
        makePeerRow({
          id: 'machine-9',
          sync_url: 'http://100.64.0.9:8080',
          reverse_registration_status: 'failed',
          reverse_registration_error: 'HTTP 401 Unauthorized',
        }),
      ],
    });
    // updateReverseRegistration
    execute.mockResolvedValueOnce({
      rows: [
        makePeerRow({
          id: 'machine-9',
          sync_url: 'http://100.64.0.9:8080',
          reverse_registration_status: 'ok',
          reverse_registration_error: null,
          reverse_registration_at: '2026-04-01T00:00:00.000Z',
        }),
      ],
    });
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 201 }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/machine-9/register-reverse',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      status: 'ok',
      peer: {
        machineId: 'machine-9',
        reverseRegistrationStatus: 'ok',
      },
    });
  });

  it('returns 502 with REVERSE_REGISTRATION_FAILED when the retry handshake fails', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        makePeerRow({
          id: 'machine-9',
          sync_url: 'http://100.64.0.9:8080',
          reverse_registration_status: null,
        }),
      ],
    });
    execute.mockResolvedValueOnce({
      rows: [
        makePeerRow({
          id: 'machine-9',
          sync_url: 'http://100.64.0.9:8080',
          reverse_registration_status: 'failed',
          reverse_registration_error: 'HTTP 500 Internal Server Error',
          reverse_registration_at: '2026-04-01T00:00:00.000Z',
        }),
      ],
    });
    fetchImpl.mockResolvedValueOnce(
      new Response('boom', { status: 500, statusText: 'Internal Server Error' }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/machine-9/register-reverse',
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      ok: false,
      error: 'REVERSE_REGISTRATION_FAILED',
      peer: {
        machineId: 'machine-9',
        reverseRegistrationStatus: 'failed',
        reverseRegistrationError: 'HTTP 500 Internal Server Error',
      },
    });
  });

  it('returns 400 when register-reverse targets self row', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        makePeerRow({
          id: 'self-machine',
          sync_url: 'http://100.64.0.1:8080',
          is_self: true,
        }),
      ],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/self-machine/register-reverse',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'REVERSE_REGISTRATION_NOT_APPLICABLE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 503 when register-reverse is disabled (no signing key)', async () => {
    await app.close();
    app = await buildReverseApp({ signingSecretKey: null });

    execute.mockResolvedValueOnce({
      rows: [
        makePeerRow({
          id: 'machine-9',
          sync_url: 'http://100.64.0.9:8080',
        }),
      ],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/sync/peers/machine-9/register-reverse',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'REVERSE_REGISTRATION_DISABLED' });
  });

  // --------------------------------------------------------------------
  // §33.8 — mesh health panel: peer cursor drill-down endpoint.
  // --------------------------------------------------------------------

  describe('GET /api/sync/peers/:machineId/cursors (§33.8)', () => {
    it('returns the cursor row for a peer', async () => {
      execute.mockResolvedValueOnce({ rows: [makePeerRow({ id: 'machine-2' })] });
      execute.mockResolvedValueOnce({
        rows: [
          {
            local_node_id: 'self-machine',
            remote_node_id: 'machine-2',
            pulled_cursor: 42,
            acked_cursor: 40,
            updated_at: '2026-04-15T12:00:00.000Z',
          },
        ],
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/peers/machine-2/cursors',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        machineId: 'machine-2',
        localNodeId: 'self-machine',
        remoteNodeId: 'machine-2',
        pulledCursor: 42,
        ackedCursor: 40,
        lastPullAt: '2026-04-15T12:00:00.000Z',
        lastAckAt: '2026-04-15T12:00:00.000Z',
        updatedAt: '2026-04-15T12:00:00.000Z',
      });
    });

    it('returns 404 when the peer does not exist', async () => {
      execute.mockResolvedValueOnce({ rows: [] });

      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/peers/ghost-machine/cursors',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'SYNC_PEER_NOT_FOUND' });
    });

    it('returns 404 when no cursor row has been materialized yet', async () => {
      execute.mockResolvedValueOnce({ rows: [makePeerRow({ id: 'machine-2' })] });
      execute.mockResolvedValueOnce({ rows: [] });

      const response = await app.inject({
        method: 'GET',
        url: '/api/sync/peers/machine-2/cursors',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'SYNC_PEER_CURSORS_NOT_FOUND' });
    });

    it('exposes lastPullAt on GET /api/sync/peers via the cursor JOIN', async () => {
      execute.mockResolvedValueOnce({
        rows: [
          {
            ...makePeerRow({ id: 'machine-fresh' }),
            last_pull_at: '2026-04-15T12:00:00.000Z',
            last_ack_at: '2026-04-15T12:00:00.000Z',
          },
          {
            ...makePeerRow({ id: 'machine-stale' }),
            last_pull_at: null,
            last_ack_at: null,
          },
        ],
      });

      const response = await app.inject({ method: 'GET', url: '/api/sync/peers' });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        peers: Array<{
          machineId: string;
          lastPullAt?: string | null;
          lastAckAt?: string | null;
        }>;
      };
      expect(body.peers).toEqual([
        expect.objectContaining({
          machineId: 'machine-fresh',
          lastPullAt: '2026-04-15T12:00:00.000Z',
          lastAckAt: '2026-04-15T12:00:00.000Z',
        }),
        expect.objectContaining({
          machineId: 'machine-stale',
          lastPullAt: null,
          lastAckAt: null,
        }),
      ]);
    });
  });
});
