import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { memoryFeedbackRoutes } from './memory-feedback.js';

const CONTROL_PLANE_URL = 'http://localhost:8080';

function makeApp(controlPlaneUrl = CONTROL_PLANE_URL): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(memoryFeedbackRoutes, {
    prefix: '/api/mcp',
    controlPlaneUrl,
    logger: createSilentLogger(),
  });
  return app;
}

describe('memoryFeedbackRoutes', () => {
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
      url: '/api/mcp/memory-feedback',
      payload: { signal: 'used' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PARAMS');
  });

  it('returns 400 when signal is invalid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-feedback',
      payload: { factId: 'fact-1', signal: 'bogus' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_SIGNAL');
  });

  it('proxies used signal to control-plane and returns ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, fact: { id: 'fact-1', strength: 0.9 } }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-feedback',
      payload: { factId: 'fact-1', signal: 'used' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${CONTROL_PLANE_URL}/api/memory/facts/fact-1/feedback`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ signal: 'used' }),
      }),
    );
  });

  it('proxies irrelevant signal to control-plane', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, fact: { id: 'fact-1', strength: 0.7 } }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-feedback',
      payload: { factId: 'fact-1', signal: 'irrelevant' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('proxies outdated signal to control-plane', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, fact: { id: 'fact-1', confidence: 0.6 } }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-feedback',
      payload: { factId: 'fact-1', signal: 'outdated' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 404 when control-plane says not found', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'NOT_FOUND', message: 'Memory fact not found' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-feedback',
      payload: { factId: 'missing-fact', signal: 'used' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('throws WorkerError when control-plane is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-feedback',
      payload: { factId: 'fact-1', signal: 'used' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('MEMORY_FEEDBACK_UNREACHABLE');
  });
});
