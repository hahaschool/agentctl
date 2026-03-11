import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { memoryPromoteRoutes } from './memory-promote.js';

const CONTROL_PLANE_URL = 'http://localhost:8080';

function makeApp(controlPlaneUrl = CONTROL_PLANE_URL): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(memoryPromoteRoutes, {
    prefix: '/api/mcp',
    controlPlaneUrl,
    logger: createSilentLogger(),
  });
  return app;
}

describe('memoryPromoteRoutes', () => {
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

  it('returns 400 when factId is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-promote',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PARAMS');
  });

  it('returns 400 when fact is already at global scope', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ fact: { id: 'fact-1', scope: 'global' } }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-promote',
      payload: { factId: 'fact-1' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('NO_PARENT_SCOPE');
  });

  it('promotes an agent-scoped fact to project scope', async () => {
    const updatedFact = { id: 'fact-1', scope: 'project:my-agent' };
    globalThis.fetch = vi
      .fn()
      // First call: fetch the fact
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ fact: { id: 'fact-1', scope: 'agent:my-agent' } }),
      })
      // Second call: patch the fact scope
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, fact: updatedFact }),
      });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-promote',
      payload: { factId: 'fact-1' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.fromScope).toBe('agent:my-agent');
    expect(body.toScope).toBe('project:my-agent');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      `${CONTROL_PLANE_URL}/api/memory/facts/fact-1`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ scope: 'project:my-agent' }),
      }),
    );
  });

  it('promotes a project-scoped fact to global scope', async () => {
    const updatedFact = { id: 'fact-2', scope: 'global' };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ fact: { id: 'fact-2', scope: 'project:myapp' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, fact: updatedFact }),
      });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-promote',
      payload: { factId: 'fact-2' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.fromScope).toBe('project:myapp');
    expect(body.toScope).toBe('global');
  });

  it('returns 404 when fact is not found', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'NOT_FOUND', message: 'Memory fact not found' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-promote',
      payload: { factId: 'missing-fact' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 503 when control-plane is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-promote',
      payload: { factId: 'fact-1' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('MEMORY_PROMOTE_UNREACHABLE');
  });
});
