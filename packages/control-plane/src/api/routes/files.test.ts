import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { fileProxyRoutes } from './files.js';

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

function mockFetchOk(body: Record<string, unknown> = { entries: [] }) {
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
  await app.register(fileProxyRoutes, {
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

describe('File proxy routes — /api/machines/:machineId/files', () => {
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
  // GET /:machineId/files — list directory
  // -------------------------------------------------------------------------

  describe('GET /:machineId/files', () => {
    it('returns 400 when path query param is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/machines/machine-1/files' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PATH');
    });

    it('proxies directory listing to the worker', async () => {
      const mockBody = {
        entries: [
          { name: 'src', isDirectory: true },
          { name: 'README.md', isDirectory: false },
        ],
      };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/files?path=/home/user/project',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockBody);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('http://100.64.0.1:9000/api/files?path='),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('uses tailscaleIp when available', async () => {
      mockFetchOk({ entries: [] });
      await app.inject({ method: 'GET', url: '/api/machines/machine-1/files?path=/tmp' });

      const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as string;
      expect(url).toContain('100.64.0.1');
    });

    it('falls back to hostname when tailscaleIp is null', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(
        makeMachine({ tailscaleIp: null }) as never,
      );
      mockFetchOk({ entries: [] });

      await app.inject({ method: 'GET', url: '/api/machines/machine-1/files?path=/tmp' });

      const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as string;
      expect(url).toContain('test-host');
    });

    it('returns 500 when machine is not found', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(undefined as never);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/unknown/files?path=/tmp',
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
        url: '/api/machines/machine-1/files?path=/tmp',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('MACHINE_OFFLINE');
    });

    it('forwards worker error status codes', async () => {
      mockFetchError(404);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/files?path=/nonexistent',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('WORKER_ERROR');
    });

    it('returns 500 when worker is unreachable', async () => {
      mockFetchThrow('ECONNREFUSED');

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/files?path=/tmp',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('WORKER_UNREACHABLE');
    });
  });

  // -------------------------------------------------------------------------
  // GET /:machineId/files/content — read file
  // -------------------------------------------------------------------------

  describe('GET /:machineId/files/content', () => {
    it('returns 400 when path is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/machines/machine-1/files/content' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PATH');
    });

    it('proxies file content from worker', async () => {
      const mockBody = { content: 'console.log("hello")', encoding: 'utf-8' };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/files/content?path=/home/user/index.ts',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockBody);
    });

    it('forwards worker errors', async () => {
      mockFetchError(403);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/files/content?path=/etc/shadow',
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 500 when worker is unreachable', async () => {
      mockFetchThrow();

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/files/content?path=/tmp/test.ts',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('WORKER_UNREACHABLE');
    });
  });

  // -------------------------------------------------------------------------
  // PUT /:machineId/files/content — write file
  // -------------------------------------------------------------------------

  describe('PUT /:machineId/files/content', () => {
    it('returns 400 when path is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/machines/machine-1/files/content',
        payload: { content: 'hello' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PATH');
    });

    it('returns 400 when content is missing', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/machines/machine-1/files/content',
        payload: { path: '/tmp/test.ts' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_CONTENT');
    });

    it('returns 400 when content exceeds 5 MB', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/machines/machine-1/files/content',
        payload: { path: '/tmp/test.ts', content: 'x'.repeat(5_000_001) },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('CONTENT_TOO_LARGE');
    });

    it('proxies file write to worker', async () => {
      const mockBody = { ok: true };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/machines/machine-1/files/content',
        payload: { path: '/tmp/test.ts', content: 'const x = 1;' },
      });

      expect(res.statusCode).toBe(200);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://100.64.0.1:9000/api/files/content',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('forwards worker errors on write', async () => {
      mockFetchError(500);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/machines/machine-1/files/content',
        payload: { path: '/tmp/test.ts', content: 'hello' },
      });

      expect(res.statusCode).toBe(500);
    });

    it('returns WORKER_UNREACHABLE when fetch throws', async () => {
      mockFetchThrow();

      const res = await app.inject({
        method: 'PUT',
        url: '/api/machines/machine-1/files/content',
        payload: { path: '/tmp/test.ts', content: 'hello' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('WORKER_UNREACHABLE');
    });
  });
});
