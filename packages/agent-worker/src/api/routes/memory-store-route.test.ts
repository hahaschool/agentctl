import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { memoryStoreRoutes } from './memory-store-route.js';

const CONTROL_PLANE_URL = 'http://localhost:8080';

function makeApp(controlPlaneUrl = CONTROL_PLANE_URL): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(memoryStoreRoutes, {
    prefix: '/api/mcp',
    controlPlaneUrl,
    logger: createSilentLogger(),
  });
  return app;
}

describe('memoryStoreRoutes', () => {
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

  it('returns 400 when content is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-store',
      payload: { scope: 'global', entityType: 'concept' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PARAMS');
  });

  it('returns 400 when entityType is invalid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-store',
      payload: { content: 'test', scope: 'global', entityType: 'bogus-type' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_ENTITY_TYPE');
  });

  it('proxies fact creation to control-plane and returns 201', async () => {
    const fakeFact = { id: 'fact-new', content: 'test fact', scope: 'global' };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, fact: fakeFact }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-store',
      payload: {
        content: 'test fact content',
        scope: 'global',
        entityType: 'concept',
        confidence: 0.9,
        tags: ['test'],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${CONTROL_PLANE_URL}/api/memory/facts`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('test fact content'),
      }),
    );
  });

  it('returns 503 when control-plane is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-store',
      payload: { content: 'test', scope: 'global', entityType: 'concept' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('MEMORY_STORE_UNREACHABLE');
  });
});
