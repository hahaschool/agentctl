import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { terminalProxyRoutes } from './terminal.js';

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

const silentLogger = pino({ level: 'silent' });

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(dbRegistry: DbAgentRegistry): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(terminalProxyRoutes, {
    prefix: '/api/machines',
    dbRegistry,
    workerPort: 9000,
    logger: silentLogger,
  });
  await app.ready();
  return app;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Terminal proxy routes — /api/machines/:machineId/terminal', () => {
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
  // GET /:machineId/terminal — list terminals
  // -------------------------------------------------------------------------

  describe('GET /:machineId/terminal', () => {
    it('proxies terminal listing to the worker', async () => {
      const mockBody = {
        terminals: [
          { id: 'term-1', shell: '/bin/bash', cols: 80, rows: 24 },
        ],
      };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/terminal',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockBody);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://100.64.0.1:9000/api/terminal',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns 500 when machine is not found', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(undefined as never);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/unknown/terminal',
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
        url: '/api/machines/machine-1/terminal',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('MACHINE_OFFLINE');
    });

    it('forwards worker error status codes', async () => {
      mockFetchError(503);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/terminal',
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('WORKER_ERROR');
    });

    it('returns WORKER_UNREACHABLE when fetch throws', async () => {
      mockFetchThrow('ECONNREFUSED');

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/terminal',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('WORKER_UNREACHABLE');
    });
  });

  // -------------------------------------------------------------------------
  // POST /:machineId/terminal — spawn terminal
  // -------------------------------------------------------------------------

  describe('POST /:machineId/terminal', () => {
    it('proxies spawn request to the worker', async () => {
      const mockBody = { id: 'term-new', shell: '/bin/zsh', cols: 120, rows: 40 };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/machine-1/terminal',
        payload: { shell: '/bin/zsh', cols: 120, rows: 40 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockBody);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://100.64.0.1:9000/api/terminal',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('returns 500 when machine is not found', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(undefined as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/unknown/terminal',
        payload: {},
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('MACHINE_NOT_FOUND');
    });

    it('forwards worker error status codes', async () => {
      mockFetchError(400);

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/machine-1/terminal',
        payload: { shell: '/bin/invalid' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('WORKER_ERROR');
    });

    it('returns WORKER_UNREACHABLE when fetch throws', async () => {
      mockFetchThrow();

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/machine-1/terminal',
        payload: {},
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('WORKER_UNREACHABLE');
    });
  });

  // -------------------------------------------------------------------------
  // GET /:machineId/terminal/:termId — get terminal info
  // -------------------------------------------------------------------------

  describe('GET /:machineId/terminal/:termId', () => {
    it('proxies terminal info request to the worker', async () => {
      const mockBody = { id: 'term-1', shell: '/bin/bash', cols: 80, rows: 24 };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/terminal/term-1',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockBody);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://100.64.0.1:9000/api/terminal/term-1',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns 500 when machine is not found', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(undefined as never);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/unknown/terminal/term-1',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('MACHINE_NOT_FOUND');
    });

    it('forwards worker error status codes', async () => {
      mockFetchError(404);

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/terminal/nonexistent',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('WORKER_ERROR');
    });

    it('returns WORKER_UNREACHABLE when fetch throws', async () => {
      mockFetchThrow();

      const res = await app.inject({
        method: 'GET',
        url: '/api/machines/machine-1/terminal/term-1',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('WORKER_UNREACHABLE');
    });
  });

  // -------------------------------------------------------------------------
  // POST /:machineId/terminal/:termId/resize — resize terminal
  // -------------------------------------------------------------------------

  describe('POST /:machineId/terminal/:termId/resize', () => {
    it('proxies resize request to the worker', async () => {
      const mockBody = { ok: true };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/machine-1/terminal/term-1/resize',
        payload: { cols: 160, rows: 48 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockBody);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://100.64.0.1:9000/api/terminal/term-1/resize',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('returns 500 when machine is not found', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(undefined as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/unknown/terminal/term-1/resize',
        payload: { cols: 80, rows: 24 },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('MACHINE_NOT_FOUND');
    });

    it('forwards worker error status codes', async () => {
      mockFetchError(404);

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/machine-1/terminal/nonexistent/resize',
        payload: { cols: 80, rows: 24 },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('WORKER_ERROR');
    });

    it('returns WORKER_UNREACHABLE when fetch throws', async () => {
      mockFetchThrow();

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/machine-1/terminal/term-1/resize',
        payload: { cols: 80, rows: 24 },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('WORKER_UNREACHABLE');
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /:machineId/terminal/:termId — kill terminal
  // -------------------------------------------------------------------------

  describe('DELETE /:machineId/terminal/:termId', () => {
    it('proxies kill request to the worker', async () => {
      const mockBody = { ok: true };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/machines/machine-1/terminal/term-1',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockBody);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://100.64.0.1:9000/api/terminal/term-1',
        expect.objectContaining({
          method: 'DELETE',
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('returns 500 when machine is not found', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(undefined as never);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/machines/unknown/terminal/term-1',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('MACHINE_NOT_FOUND');
    });

    it('returns 500 when machine is offline', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(
        makeMachine({ status: 'offline' }) as never,
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/machines/machine-1/terminal/term-1',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('MACHINE_OFFLINE');
    });

    it('forwards worker error status codes', async () => {
      mockFetchError(404);

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/machines/machine-1/terminal/nonexistent',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('WORKER_ERROR');
    });

    it('returns WORKER_UNREACHABLE when fetch throws', async () => {
      mockFetchThrow();

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/machines/machine-1/terminal/term-1',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().code).toBe('WORKER_UNREACHABLE');
    });
  });
});
