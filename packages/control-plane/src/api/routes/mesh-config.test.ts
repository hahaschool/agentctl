import { ControlPlaneError } from '@agentctl/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
