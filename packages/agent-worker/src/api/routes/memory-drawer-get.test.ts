import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { memoryDrawerGetRoutes } from './memory-drawer-get.js';

const CONTROL_PLANE_URL = 'http://localhost:8080';
const DRAWER_ID = 'drawer-abc_123';

function makeApp(controlPlaneUrl = CONTROL_PLANE_URL): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(memoryDrawerGetRoutes, {
    prefix: '/api/mcp',
    controlPlaneUrl,
    logger: createSilentLogger(),
  });
  return app;
}

describe('memoryDrawerGetRoutes', () => {
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

  it('returns DRAWER_NOT_FOUND when control-plane has no drawer with that id (404)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'NOT_FOUND' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-get',
      payload: {
        arguments: { drawer_id: DRAWER_ID },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'DRAWER_NOT_FOUND',
      message: `Drawer "${DRAWER_ID}" was not found`,
    });
  });

  it('rejects null arguments with a structured 400 within 1 second', async () => {
    globalThis.fetch = vi.fn();

    const response = await Promise.race([
      app.inject({
        method: 'POST',
        url: '/api/mcp/memory-drawer-get',
        payload: { arguments: null },
      }),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('memory-drawer-get did not reject null arguments in time')),
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

  it('rejects missing drawer_id with INVALID_PARAMS', async () => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-get',
      payload: { arguments: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_PARAMS',
      message: 'drawer_id must be a non-empty safe identifier',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['path traversal', '../etc/passwd'],
    ['control characters', 'drawer\u0000abc'],
    ['leading dot', '.hidden'],
  ])('rejects unsafe drawer_id with %s', async (_label, drawerId) => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-get',
      payload: { arguments: { drawer_id: drawerId } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_PARAMS',
      message: 'drawer_id must be a non-empty safe identifier',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns the drawer payload on a happy-path control-plane response', async () => {
    const drawer = {
      id: DRAWER_ID,
      scope: 'global',
      topic: 'agent-memory',
      sourceType: 'session-jsonl',
      sourceId: 'session-abc',
      chunkIndex: 0,
      content: 'AgentCTL stores drawer evidence in postgres.',
      contentSha256: 'a'.repeat(64),
      embeddingModel: 'text-embedding-3-small',
      embeddingVersion: 1,
      tokenCount: 12,
      redactionStatus: 'sanitized',
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, drawer }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-get',
      payload: { arguments: { drawer_id: DRAWER_ID } },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.drawer).toEqual(drawer);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${CONTROL_PLANE_URL}/api/memory/drawers/${encodeURIComponent(DRAWER_ID)}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns 404 when the control-plane response is missing required drawer fields', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, drawer: { id: DRAWER_ID } }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-get',
      payload: { arguments: { drawer_id: DRAWER_ID } },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'DRAWER_NOT_FOUND',
      message: `Drawer "${DRAWER_ID}" was not found`,
    });
  });

  it('returns 503 when control-plane is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-drawer-get',
      payload: { arguments: { drawer_id: DRAWER_ID } },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: 'MEMORY_DRAWER_GET_UNREACHABLE',
      message: 'Control-plane unreachable while fetching memory drawer',
    });
  });
});
