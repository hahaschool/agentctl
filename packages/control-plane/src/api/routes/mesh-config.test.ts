import { ControlPlaneError } from '@agentctl/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MeshConfigProvider } from '../../mesh/mesh-config-provider.js';
import { meshConfigRoutes } from './mesh-config.js';

// ---------------------------------------------------------------------------
// Mock MeshConfigProvider
// ---------------------------------------------------------------------------

function createMockProvider(overrides: Partial<MeshConfigProvider> = {}): MeshConfigProvider {
  const defaultConfig = {
    tailscaleIp: '100.64.0.5',
    tailscaleIpSource: 'auto-detect' as const,
    syncUrl: 'http://100.64.0.5:8080',
    syncUrlSource: 'derived' as const,
    registrationToken: 'secret-token',
    registrationTokenSource: 'env' as const,
  };

  return {
    resolve: vi.fn().mockResolvedValue(defaultConfig),
    update: vi.fn().mockResolvedValue(defaultConfig),
    ...overrides,
  } as unknown as MeshConfigProvider;
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(
  provider: MeshConfigProvider,
  opts: { machineId?: string; hostname?: string; publicKey?: string | null } = {},
): Promise<FastifyInstance> {
  const app = Fastify();

  // Mirror the error handler from createServer so ControlPlaneError
  // is serialized consistently (code → status code, error field).
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof ControlPlaneError) {
      const statusCode = err.code.startsWith('INVALID_') ? 400 : 500;
      return reply.status(statusCode).send({ error: err.code, message: err.message });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: err.message });
  });

  await app.register(meshConfigRoutes, {
    prefix: '/api',
    meshConfigProvider: provider,
    machineId: opts.machineId ?? 'machine-1',
    hostname: opts.hostname ?? 'test-host',
    publicKey: opts.publicKey ?? 'pk-base64',
  });
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/mesh/config', () => {
  let app: FastifyInstance;
  let provider: MeshConfigProvider;

  beforeAll(async () => {
    provider = createMockProvider();
    app = await buildApp(provider);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns resolved config with token redacted', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/mesh/config' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.machineId).toBe('machine-1');
    expect(body.hostname).toBe('test-host');
    expect(body.tailscaleIp).toBe('100.64.0.5');
    expect(body.tailscaleIpSource).toBe('auto-detect');
    expect(body.syncUrl).toBe('http://100.64.0.5:8080');
    expect(body.syncUrlSource).toBe('derived');
    expect(body.registrationTokenConfigured).toBe(true);
    expect(body.registrationTokenSource).toBe('env');
    expect(body.publicKey).toBe('pk-base64');
    // Token value must NOT be exposed
    expect(body.registrationToken).toBeUndefined();
  });

  it('shows registrationTokenConfigured=false when no token', async () => {
    const noTokenProvider = createMockProvider({
      resolve: vi.fn().mockResolvedValue({
        tailscaleIp: null,
        tailscaleIpSource: null,
        syncUrl: 'http://localhost:8080',
        syncUrlSource: 'derived',
        registrationToken: null,
        registrationTokenSource: null,
      }),
    });
    const testApp = await buildApp(noTokenProvider);

    const res = await testApp.inject({ method: 'GET', url: '/api/mesh/config' });
    expect(res.json().registrationTokenConfigured).toBe(false);

    await testApp.close();
  });
});

describe('PUT /api/mesh/config', () => {
  let app: FastifyInstance;
  let provider: MeshConfigProvider;

  beforeAll(async () => {
    provider = createMockProvider();
    app = await buildApp(provider);
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts valid IP override', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/mesh/config',
      payload: { tailscaleIpOverride: '100.64.0.20' },
    });

    expect(res.statusCode).toBe(200);
    expect(provider.update).toHaveBeenCalledWith(
      expect.objectContaining({ tailscaleIpOverride: '100.64.0.20' }),
    );
  });

  it('accepts null to clear IP override', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/mesh/config',
      payload: { tailscaleIpOverride: null },
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects loopback IP override', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/mesh/config',
      payload: { tailscaleIpOverride: '127.0.0.1' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('INVALID_TAILSCALE_IP');
  });

  it('rejects non-IPv4 IP override', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/mesh/config',
      payload: { tailscaleIpOverride: 'not-an-ip' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('INVALID_TAILSCALE_IP');
  });

  it('accepts valid sync URL override', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/mesh/config',
      payload: { syncUrlOverride: 'https://mesh.example.com:9090' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects invalid sync URL', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/mesh/config',
      payload: { syncUrlOverride: 'not-a-url' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('INVALID_SYNC_URL');
  });

  it('rejects non-http/https sync URL', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/mesh/config',
      payload: { syncUrlOverride: 'ftp://example.com' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('INVALID_SYNC_URL');
  });

  it('accepts valid registration token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/mesh/config',
      payload: { registrationToken: 'new-secret-token' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('accepts null to clear registration token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/mesh/config',
      payload: { registrationToken: null },
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects empty string token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/mesh/config',
      payload: { registrationToken: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('INVALID_TOKEN');
  });
});

// ---------------------------------------------------------------------------
// GET /api/mesh/config/preflight — §33.12 Phase 3.3
// ---------------------------------------------------------------------------

describe('GET /api/mesh/config/preflight', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await app?.close();
  });

  function mockFetchResponse(status: number, body: Record<string, unknown>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
    );
  }

  it('returns compatible when remote returns 400 with body validation error', async () => {
    mockFetchResponse(400, { error: 'INVALID_MACHINE_ID', message: 'machineId is required' });
    const provider = createMockProvider();
    app = await buildApp(provider);

    const res = await app.inject({
      method: 'GET',
      url: '/api/mesh/config/preflight?targetSyncUrl=http://100.64.0.10:8080',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tokenStatus).toBe('compatible');
  });

  it('returns mismatch when remote returns TOKEN_INVALID', async () => {
    mockFetchResponse(403, { error: 'PEER_REGISTRATION_TOKEN_INVALID' });
    const provider = createMockProvider();
    app = await buildApp(provider);

    const res = await app.inject({
      method: 'GET',
      url: '/api/mesh/config/preflight?targetSyncUrl=http://100.64.0.10:8080',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tokenStatus).toBe('mismatch');
    expect(res.json().errorCode).toBe('PEER_REGISTRATION_TOKEN_INVALID');
  });

  it('returns remote_disabled when remote has no token', async () => {
    mockFetchResponse(503, { error: 'PEER_REGISTRATION_DISABLED' });
    const provider = createMockProvider();
    app = await buildApp(provider);

    const res = await app.inject({
      method: 'GET',
      url: '/api/mesh/config/preflight?targetSyncUrl=http://100.64.0.10:8080',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tokenStatus).toBe('remote_disabled');
  });

  it('returns local_missing when no local token configured', async () => {
    const provider = createMockProvider({
      resolve: vi.fn().mockResolvedValue({
        tailscaleIp: null,
        tailscaleIpSource: null,
        syncUrl: 'http://localhost:8080',
        syncUrlSource: 'derived',
        registrationToken: null,
        registrationTokenSource: null,
      }),
    });
    app = await buildApp(provider);

    const res = await app.inject({
      method: 'GET',
      url: '/api/mesh/config/preflight?targetSyncUrl=http://100.64.0.10:8080',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tokenStatus).toBe('local_missing');
    expect(res.json().errorCode).toBe('PEER_REGISTRATION_TOKEN_MISSING');
  });

  it('returns error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
    const provider = createMockProvider();
    app = await buildApp(provider);

    const res = await app.inject({
      method: 'GET',
      url: '/api/mesh/config/preflight?targetSyncUrl=http://100.64.0.10:8080',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tokenStatus).toBe('error');
    expect(res.json().errorCode).toBe('NETWORK_ERROR');
  });

  it('rejects missing targetSyncUrl', async () => {
    const provider = createMockProvider();
    app = await buildApp(provider);

    const res = await app.inject({
      method: 'GET',
      url: '/api/mesh/config/preflight',
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects non-Tailscale hostname (SSRF guard)', async () => {
    const provider = createMockProvider();
    app = await buildApp(provider);

    const res = await app.inject({
      method: 'GET',
      url: '/api/mesh/config/preflight?targetSyncUrl=http://evil.example.com:8080',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('INVALID_SYNC_URL');
  });

  it('allows localhost for development', async () => {
    mockFetchResponse(400, { error: 'INVALID_MACHINE_ID', message: 'machineId is required' });
    const provider = createMockProvider();
    app = await buildApp(provider);

    const res = await app.inject({
      method: 'GET',
      url: '/api/mesh/config/preflight?targetSyncUrl=http://localhost:8080',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tokenStatus).toBe('compatible');
  });

  it('handles trailing slashes in targetSyncUrl safely', async () => {
    mockFetchResponse(400, { error: 'INVALID_MACHINE_ID', message: 'machineId is required' });
    const provider = createMockProvider();
    app = await buildApp(provider);

    const res = await app.inject({
      method: 'GET',
      url: '/api/mesh/config/preflight?targetSyncUrl=http://100.64.0.10:8080///',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tokenStatus).toBe('compatible');
  });

  it('rejects invalid targetSyncUrl', async () => {
    const provider = createMockProvider();
    app = await buildApp(provider);

    const res = await app.inject({
      method: 'GET',
      url: '/api/mesh/config/preflight?targetSyncUrl=not-a-url',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('INVALID_SYNC_URL');
  });
});
