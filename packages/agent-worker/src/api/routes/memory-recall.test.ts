import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { memoryRecallRoutes } from './memory-recall.js';

const CONTROL_PLANE_URL = 'http://localhost:8080';

function makeApp(controlPlaneUrl = CONTROL_PLANE_URL): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(memoryRecallRoutes, {
    prefix: '/api/mcp',
    controlPlaneUrl,
    logger: createSilentLogger(),
  });
  return app;
}

describe('memoryRecallRoutes', () => {
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
      url: '/api/mcp/memory-recall',
      payload: { maxHops: 2 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PARAMS');
  });

  it('returns related facts via BFS traversal', async () => {
    const neighbour = { id: 'fact-2', content: 'related fact' };
    globalThis.fetch = vi
      .fn()
      // First call: get edges for seed fact
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          edges: [{ source_fact_id: 'fact-1', target_fact_id: 'fact-2', relation: 'related_to' }],
        }),
      })
      // Second call: fetch neighbour fact
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ fact: neighbour }),
      })
      // Third call: get edges for neighbour (no further edges)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ edges: [] }),
      });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-recall',
      payload: { factId: 'fact-1', maxHops: 2 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.seedFactId).toBe('fact-1');
    expect(body.facts).toHaveLength(1);
    expect(body.facts[0].id).toBe('fact-2');
  });

  it('returns 503 when control-plane is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-recall',
      payload: { factId: 'fact-1' },
    });

    expect(response.statusCode).toBe(200);
    // Returns empty facts on fetch failure (graceful degradation)
    expect(response.json().ok).toBe(true);
    expect(response.json().facts).toHaveLength(0);
  });
});
