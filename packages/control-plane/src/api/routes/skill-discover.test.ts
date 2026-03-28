import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { skillDiscoverRoutes } from './skill-discover.js';
import {
  createMockDbRegistry,
  mockFetchError,
  mockFetchOk,
  mockFetchThrow,
  saveOriginalFetch,
} from './test-helpers.js';

const originalFetch = saveOriginalFetch();

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(dbRegistry: DbAgentRegistry): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(skillDiscoverRoutes, {
    prefix: '/api/skills',
    dbRegistry,
    workerPort: 9000,
  });
  await app.ready();
  return app;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Skill discover proxy routes — /api/skills', () => {
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
  // GET /api/skills/discover
  // -------------------------------------------------------------------------

  describe('GET /discover', () => {
    it('returns 400 when machineId is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/skills/discover' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_INPUT');
    });

    it('proxies to worker skill discover endpoint', async () => {
      const mockBody = {
        ok: true,
        discovered: [
          {
            id: 'commit',
            name: 'commit',
            description: 'Create a git commit',
            path: '/home/user/.claude/skills/commit/SKILL.md',
            source: 'global',
            runtime: 'claude-code',
          },
        ],
        cached: false,
      };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'GET',
        url: '/api/skills/discover?machineId=machine-1',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockBody);
    });

    it('forwards runtime and projectPath params', async () => {
      const mockBody = { ok: true, discovered: [], cached: false };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'GET',
        url: '/api/skills/discover?machineId=machine-1&runtime=codex&projectPath=/home/user/project',
      });

      expect(res.statusCode).toBe(200);
      const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as string;
      expect(url).toContain('runtime=codex');
      expect(url).toContain('projectPath=');
    });

    it('defaults runtime to claude-code when not provided', async () => {
      const mockBody = { ok: true, discovered: [], cached: false };
      mockFetchOk(mockBody);

      await app.inject({
        method: 'GET',
        url: '/api/skills/discover?machineId=machine-1',
      });

      const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as string;
      expect(url).toContain('runtime=claude-code');
    });

    it('returns 400 for invalid runtime value', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/skills/discover?machineId=machine-1&runtime=invalid-rt',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_RUNTIME');
    });

    it('returns 502 when worker is unreachable', async () => {
      mockFetchThrow('ECONNREFUSED');

      const res = await app.inject({
        method: 'GET',
        url: '/api/skills/discover?machineId=machine-1',
      });

      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe('WORKER_UNREACHABLE');
    });

    it('forwards worker error status codes', async () => {
      mockFetchError(500);

      const res = await app.inject({
        method: 'GET',
        url: '/api/skills/discover?machineId=machine-1',
      });

      expect(res.statusCode).toBe(500);
    });

    it('returns 404 when machine not found', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(undefined as never);

      const res = await app.inject({
        method: 'GET',
        url: '/api/skills/discover?machineId=unknown',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 503 when dbRegistry is not configured', async () => {
      const appNoDB = Fastify({ logger: false });
      await appNoDB.register(skillDiscoverRoutes, {
        prefix: '/api/skills',
        workerPort: 9000,
        // no dbRegistry
      });
      await appNoDB.ready();

      const res = await appNoDB.inject({
        method: 'GET',
        url: '/api/skills/discover?machineId=machine-1',
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('REGISTRY_UNAVAILABLE');

      await appNoDB.close();
    });
  });
});
