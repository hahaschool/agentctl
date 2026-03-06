import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { gitProxyRoutes } from './git.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();

function makeMachine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'machine-1',
    hostname: 'test-host',
    tailscaleIp: '100.64.0.1',
    os: 'linux',
    arch: 'x64',
    status: 'online',
    lastHeartbeat: NOW,
    capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
    createdAt: NOW,
    ...overrides,
  };
}

function createMockDbRegistry(overrides: Partial<DbAgentRegistry> = {}) {
  return {
    getMachine: vi.fn().mockResolvedValue(makeMachine()),
    ...overrides,
  } as unknown as DbAgentRegistry;
}

const originalFetch = globalThis.fetch;

function mockFetchOk(body: Record<string, unknown> = {}) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

function mockFetchError(status = 500) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: 'WORKER_ERROR', message: 'Something went wrong' }),
    statusText: 'Internal Server Error',
  });
}

function mockFetchThrow(message = 'Connection refused') {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error(message));
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(dbRegistry: DbAgentRegistry): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(gitProxyRoutes, {
    prefix: '/api/machines',
    dbRegistry,
    workerPort: 9000,
  });
  await app.ready();
  return app;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Git proxy routes — /api/machines/:machineId/git', () => {
  let app: FastifyInstance;
  let mockDbRegistry: DbAgentRegistry;

  beforeAll(async () => {
    mockDbRegistry = createMockDbRegistry();
    app = await buildApp(mockDbRegistry);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // GET /:machineId/git/status
  // -------------------------------------------------------------------------

  describe('GET /:machineId/git/status', () => {
    it('returns 400 when path query param is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/machines/machine-1/git/status' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PATH');
    });

    it('proxies git status to the worker', async () => {
      const mockBody = {
        branch: 'main',
        isClean: true,
        ahead: 0,
        behind: 0,
        worktrees: [],
      };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/git/status?path=/home/user/project',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockBody);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('http://100.64.0.1:9000/api/git/status?path='),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('uses tailscaleIp when available', async () => {
      mockFetchOk({});
      await app.inject({ method: 'GET', url: '/api/machines/machine-1/git/status?path=/tmp' });

      const url = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
      expect(url).toContain('100.64.0.1');
    });

    it('falls back to hostname when tailscaleIp is null', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(
        makeMachine({ tailscaleIp: null }) as never,
      );
      mockFetchOk({});

      await app.inject({ method: 'GET', url: '/api/machines/machine-1/git/status?path=/tmp' });

      const url = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
      expect(url).toContain('test-host');
    });

    it('returns 500 when machine is not found', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(undefined as never);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/unknown/git/status?path=/tmp',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('MACHINE_NOT_FOUND');
    });

    it('returns 500 when machine is offline', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(
        makeMachine({ status: 'offline' }) as never,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/git/status?path=/tmp',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('MACHINE_OFFLINE');
    });

    it('forwards worker error status codes', async () => {
      mockFetchError(404);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/git/status?path=/nonexistent',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('WORKER_ERROR');
    });

    it('returns WORKER_UNREACHABLE when fetch throws', async () => {
      mockFetchThrow('ECONNREFUSED');

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/git/status?path=/tmp',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('WORKER_UNREACHABLE');
    });
  });
});
