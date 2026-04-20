import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { memoryDrawerSearchRoutes } from './memory-drawer-search.js';

const CONTROL_PLANE_URL = 'http://localhost:8080';

function makeApp(controlPlaneUrl = CONTROL_PLANE_URL): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(memoryDrawerSearchRoutes, {
    prefix: '/api/mcp',
    controlPlaneUrl,
    logger: createSilentLogger(),
  });
  return app;
}

describe('memoryDrawerSearchRoutes', () => {
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

  it('returns an empty result list when control-plane has no drawer index yet (404)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'NOT_FOUND' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-search',
      payload: {
        arguments: { query: 'how does AgentCTL store memory drawers?' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, results: [] });
  });

  it('rejects null arguments with a structured 400 within 1 second', async () => {
    globalThis.fetch = vi.fn();

    const response = await Promise.race([
      app.inject({
        method: 'POST',
        url: '/api/mcp/memory-drawer-search',
        payload: { arguments: null },
      }),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('memory-drawer-search did not reject null arguments in time')),
          1000,
        );
      }),
    ]);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_ARGUMENTS',
      message: 'arguments must be a non-null object when provided',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects missing query', async () => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-search',
      payload: {
        arguments: { scope: 'global' },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_PARAMS',
      message: 'query must be a non-empty string',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects an empty query after sanitization', async () => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-search',
      payload: {
        arguments: { query: '   ' },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'query_empty',
      message: 'query must be a non-empty string after sanitization',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range limit', async () => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-search',
      payload: {
        arguments: { query: 'probe', limit: 500 },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_PARAMS',
      message: 'limit must be an integer between 1 and 100',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a non-string scope', async () => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-search',
      payload: {
        arguments: { query: 'probe', scope: 42 },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_PARAMS',
      message: 'scope must be a string when provided',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('forwards sanitized query, scope, and limit to the control-plane drawer search endpoint', async () => {
    const drawerResult = {
      id: 'drawer-1',
      scope: 'global',
      topic: 'agent-memory',
      source_type: 'session-jsonl',
      source_id: 'session-abc',
      chunk_index: 2,
      content_preview: 'AgentCTL stores drawer evidence in postgres.',
      score: 0.82,
      match_type: 'vector',
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, results: [drawerResult] }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-search',
      payload: {
        arguments: { query: 'AgentCTL drawer evidence', scope: 'global', limit: 5 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, results: [drawerResult] });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/memory/drawers/search?q=AgentCTL+drawer+evidence&limit=5&scope=global',
      ),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns 503 when control-plane is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-search',
      payload: { arguments: { query: 'network down' } },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: 'MEMORY_DRAWER_SEARCH_UNREACHABLE',
      message: 'Control-plane unreachable while searching memory drawers',
    });
  });
});
