import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { mcpTemplateRoutes } from './mcp-templates.js';
import {
  createMockDbRegistry,
  makeMachine,
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
  await app.register(mcpTemplateRoutes, {
    prefix: '/api/mcp',
    dbRegistry,
    workerPort: 9000,
  });
  await app.ready();
  return app;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('MCP template routes — /api/mcp', () => {
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
  // GET /api/mcp/templates
  // -------------------------------------------------------------------------

  describe('GET /templates', () => {
    it('returns template list', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/mcp/templates' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.templates).toBeDefined();
      expect(body.count).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/mcp/discover
  // -------------------------------------------------------------------------

  describe('GET /discover', () => {
    it('returns 400 when machineId is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/mcp/discover' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_INPUT');
    });

    it('forwards runtime param to worker', async () => {
      const mockBody = { discovered: [], sources: [], cached: false };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'GET',
        url: '/api/mcp/discover?machineId=machine-1&runtime=codex',
      });

      expect(res.statusCode).toBe(200);
      const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as string;
      expect(url).toContain('runtime=codex');
    });

    it('defaults runtime to claude-code when not provided', async () => {
      const mockBody = { discovered: [], sources: [], cached: false };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'GET',
        url: '/api/mcp/discover?machineId=machine-1',
      });

      expect(res.statusCode).toBe(200);
      const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as string;
      expect(url).toContain('runtime=claude-code');
    });

    it('returns 400 for invalid runtime value', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/mcp/discover?machineId=machine-1&runtime=invalid-rt',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_RUNTIME');
    });

    it('forwards projectPath param to worker', async () => {
      const mockBody = { discovered: [], sources: [], cached: false };
      mockFetchOk(mockBody);

      const res = await app.inject({
        method: 'GET',
        url: '/api/mcp/discover?machineId=machine-1&projectPath=/home/user/project',
      });

      expect(res.statusCode).toBe(200);
      const url = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as string;
      expect(url).toContain('projectPath=');
    });

    it('returns 502 when worker is unreachable', async () => {
      mockFetchThrow('ECONNREFUSED');

      const res = await app.inject({
        method: 'GET',
        url: '/api/mcp/discover?machineId=machine-1',
      });

      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe('WORKER_UNREACHABLE');
    });

    it('returns 404 when machine not found', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(undefined as never);

      const res = await app.inject({
        method: 'GET',
        url: '/api/mcp/discover?machineId=unknown',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 503 when dbRegistry is not configured', async () => {
      const appNoDB = Fastify({ logger: false });
      await appNoDB.register(mcpTemplateRoutes, {
        prefix: '/api/mcp',
        workerPort: 9000,
        // no dbRegistry
      });
      await appNoDB.ready();

      const res = await appNoDB.inject({
        method: 'GET',
        url: '/api/mcp/discover?machineId=machine-1',
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('REGISTRY_UNAVAILABLE');

      await appNoDB.close();
    });
  });
});
