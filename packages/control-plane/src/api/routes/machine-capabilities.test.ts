import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { machineCapabilitiesRoutes } from './machine-capabilities.js';
import { createMockDbRegistry, makeMachine, saveOriginalFetch } from './test-helpers.js';

const originalFetch = saveOriginalFetch();

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(dbRegistry: DbAgentRegistry): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(machineCapabilitiesRoutes, {
    prefix: '/api/machines',
    dbRegistry,
    workerPort: 9000,
  });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Mock discovery responses
// ---------------------------------------------------------------------------

const MOCK_MCP_RESPONSE = {
  discovered: [
    {
      name: 'filesystem',
      config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
      source: 'global',
      description: 'From ~/.claude.json',
    },
  ],
  sources: [{ path: 'From ~/.claude.json', count: 1 }],
  cached: false,
};

const MOCK_SKILL_RESPONSE = {
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

function mockBothDiscoveryFetches(): void {
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/api/mcp/discover')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => MOCK_MCP_RESPONSE,
      });
    }
    if (typeof url === 'string' && url.includes('/api/skills/discover')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => MOCK_SKILL_RESPONSE,
      });
    }
    return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
  });
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Machine capabilities routes — /api/machines/:machineId/sync-capabilities', () => {
  let app: FastifyInstance;
  let mockDbRegistry: DbAgentRegistry;

  beforeAll(async () => {
    mockDbRegistry = createMockDbRegistry({
      heartbeat: vi.fn().mockResolvedValue(undefined),
    });
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
  // POST /:machineId/sync-capabilities
  // -------------------------------------------------------------------------

  describe('POST /:machineId/sync-capabilities', () => {
    it('calls MCP and skill discovery on the target machine', async () => {
      mockBothDiscoveryFetches();

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/machine-1/sync-capabilities',
      });

      expect(res.statusCode).toBe(200);

      // Verify both discovery endpoints were called
      const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
      const urls = fetchCalls.map((call) => call[0] as string);
      expect(urls.some((u) => u.includes('/api/mcp/discover'))).toBe(true);
      expect(urls.some((u) => u.includes('/api/skills/discover'))).toBe(true);
    });

    it('updates machine capabilities with discovery provenance', async () => {
      mockBothDiscoveryFetches();

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/machine-1/sync-capabilities',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Verify response includes provenance data
      expect(body.mcpServerSources).toBeDefined();
      expect(body.mcpServerSources.filesystem).toBe('discovered');
      expect(body.skillSources).toBeDefined();
      expect(body.skillSources.commit).toBe('discovered');
      expect(body.lastDiscoveredAt).toBeDefined();

      // Verify heartbeat was called with updated capabilities
      expect(mockDbRegistry.heartbeat).toHaveBeenCalled();
    });

    it('preserves manual entries when syncing', async () => {
      // Machine has a manual MCP server and skill in capabilities
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(
        makeMachine({
          capabilities: {
            gpu: false,
            docker: true,
            maxConcurrentAgents: 4,
            mcpServerSources: { 'custom-server': 'manual' },
            skillSources: { 'custom-skill': 'manual' },
          },
        }) as never,
      );
      mockBothDiscoveryFetches();

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/machine-1/sync-capabilities',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Manual entries must be preserved
      expect(body.mcpServerSources['custom-server']).toBe('manual');
      expect(body.skillSources['custom-skill']).toBe('manual');

      // Discovered entries are also present
      expect(body.mcpServerSources.filesystem).toBe('discovered');
      expect(body.skillSources.commit).toBe('discovered');
    });

    it('returns 404 when machine not found', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(undefined as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/unknown/sync-capabilities',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('MACHINE_NOT_FOUND');
    });

    it('returns 503 when machine is offline', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(
        makeMachine({ status: 'offline' }) as never,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/machine-1/sync-capabilities',
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('MACHINE_OFFLINE');
    });

    it('continues if one discovery call fails', async () => {
      // MCP discover fails, skills succeed
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/api/mcp/discover')) {
          return Promise.reject(new Error('Connection refused'));
        }
        if (typeof url === 'string' && url.includes('/api/skills/discover')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => MOCK_SKILL_RESPONSE,
          });
        }
        return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/machine-1/sync-capabilities',
      });

      // Should still succeed with partial results
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.skillSources.commit).toBe('discovered');
      // MCP sources should be empty (or only manual if any)
      expect(body.warnings).toBeDefined();
      expect(body.warnings.length).toBeGreaterThan(0);
    });

    it('forwards runtime param if provided', async () => {
      mockBothDiscoveryFetches();

      const res = await app.inject({
        method: 'POST',
        url: '/api/machines/machine-1/sync-capabilities',
        payload: { runtime: 'codex' },
      });

      expect(res.statusCode).toBe(200);

      const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
      const urls = fetchCalls.map((call) => call[0] as string);
      // Both should have runtime=codex
      for (const url of urls) {
        expect(url).toContain('runtime=codex');
      }
    });
  });
});
