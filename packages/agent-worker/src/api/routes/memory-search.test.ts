import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { memorySearchRoutes } from './memory-search.js';

const CONTROL_PLANE_URL = 'http://localhost:8080';

function makeApp(controlPlaneUrl = CONTROL_PLANE_URL): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(memorySearchRoutes, {
    prefix: '/api/mcp',
    controlPlaneUrl,
    logger: createSilentLogger(),
  });
  return app;
}

describe('memorySearchRoutes', () => {
  let app: FastifyInstance;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    app = makeApp();
    await app.ready();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  it('returns 400 when query is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-search',
      payload: { limit: 5 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PARAMS');
  });

  it('proxies search to control-plane and returns facts', async () => {
    const fakeFacts = [{ id: 'fact-1', content: 'test fact', tags: [] }];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, facts: fakeFacts, total: 1 }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-search',
      payload: { query: 'test query', scope: 'global', limit: 10 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.facts).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/memory/facts?q=test+query'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('filters by tags client-side', async () => {
    const fakeFacts = [
      { id: 'fact-1', content: 'relevant', tags: ['typescript'] },
      { id: 'fact-2', content: 'irrelevant', tags: ['python'] },
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, facts: fakeFacts, total: 2 }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-search',
      payload: { query: 'test', tags: ['typescript'] },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.facts).toHaveLength(1);
    expect(body.facts[0].id).toBe('fact-1');
  });

  it('returns 503 when control-plane is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-search',
      payload: { query: 'test' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('MEMORY_SEARCH_UNREACHABLE');
  });
});
