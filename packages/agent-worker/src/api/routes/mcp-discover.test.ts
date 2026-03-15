import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../../test-helpers.js';

// Mock the discovery functions so we don't touch the filesystem
vi.mock('../../runtime/discovery/codex-mcp-discovery.js', () => ({
  discoverCodexMcpServers: vi.fn().mockResolvedValue([]),
}));

import { discoverCodexMcpServers } from '../../runtime/discovery/codex-mcp-discovery.js';
import { mcpDiscoverCache, mcpDiscoverRoutes } from './mcp-discover.js';

const mockDiscoverCodex = vi.mocked(discoverCodexMcpServers);

describe('GET /api/mcp/discover', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const logger = createMockLogger();
    app = Fastify({ logger: false });
    await app.register(mcpDiscoverRoutes, { prefix: '/api/mcp', logger });
    await app.ready();
    mcpDiscoverCache.invalidateAll();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  it('defaults to claude-code when runtime param is missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/mcp/discover',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.discovered).toBeDefined();
    // Codex discovery should NOT have been called when runtime defaults to claude-code
    expect(mockDiscoverCodex).not.toHaveBeenCalled();
  });

  it('calls Codex discovery when runtime=codex', async () => {
    mockDiscoverCodex.mockResolvedValue([
      {
        name: 'test-server',
        config: { command: 'test', args: [], env: {} },
        source: 'global',
        configFile: '/home/user/.codex/config.toml',
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/mcp/discover?runtime=codex',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.discovered).toHaveLength(1);
    expect(body.discovered[0].name).toBe('test-server');
    expect(mockDiscoverCodex).toHaveBeenCalled();
  });

  it('returns 400 for invalid runtime value', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/mcp/discover?runtime=invalid',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 when projectPath is relative', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/mcp/discover?runtime=codex&projectPath=relative/path',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('INVALID_PATH');
  });

  it('returns 400 when projectPath includes denied segments', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/mcp/discover?runtime=codex&projectPath=/Users/test/.ssh/project',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('INVALID_PATH');
    expect(body.message).toContain('.ssh');
  });

  it('uses cached results on second call within TTL', async () => {
    mockDiscoverCodex.mockResolvedValue([
      {
        name: 'cached-server',
        config: { command: 'test', args: [], env: {} },
        source: 'global',
        configFile: '/home/user/.codex/config.toml',
      },
    ]);

    // First call
    const response1 = await app.inject({
      method: 'GET',
      url: '/api/mcp/discover?runtime=codex',
    });
    expect(response1.statusCode).toBe(200);
    expect(response1.json().cached).toBe(false);

    // Second call should use cache
    const response2 = await app.inject({
      method: 'GET',
      url: '/api/mcp/discover?runtime=codex',
    });
    expect(response2.statusCode).toBe(200);
    expect(response2.json().cached).toBe(true);

    // Discovery function should only have been called once
    expect(mockDiscoverCodex).toHaveBeenCalledTimes(1);
  });

  it('passes projectPath to Codex discovery for project-scoped servers', async () => {
    mockDiscoverCodex.mockResolvedValue([]);

    await app.inject({
      method: 'GET',
      url: '/api/mcp/discover?runtime=codex&projectPath=/my/project',
    });

    // Should be called twice: once for global, once for project
    expect(mockDiscoverCodex).toHaveBeenCalledTimes(2);
    expect(mockDiscoverCodex).toHaveBeenCalledWith(expect.any(String), 'global');
    expect(mockDiscoverCodex).toHaveBeenCalledWith('/my/project', 'project');
  });
});
