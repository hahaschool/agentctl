import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { memoryTraverseRoutes } from './memory-traverse.js';

const CONTROL_PLANE_URL = 'http://localhost:8080';
const START_ENTITY_ID = '550e8400-e29b-41d4-a716-446655440000';

function makeApp(controlPlaneUrl = CONTROL_PLANE_URL): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(memoryTraverseRoutes, {
    prefix: '/api/mcp',
    controlPlaneUrl,
    logger: createSilentLogger(),
  });
  return app;
}

describe('memoryTraverseRoutes', () => {
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

  it('returns an empty graph when control-plane has no traverse data yet', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'NOT_FOUND' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-traverse',
      payload: {
        arguments: {
          start_entity_canonical_id: START_ENTITY_ID,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      start_entity_canonical_id: START_ENTITY_ID,
      max_hops: 3,
      node_cap: 100,
      nodes: [],
      edges: [],
      partial: false,
    });
  });

  it('rejects null arguments with a structured 400 without calling control-plane', async () => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-traverse',
      payload: { arguments: null },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_ARGUMENTS',
      message: 'arguments must be a non-null object when provided',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('defaults caps and forwards validated filters to the planned control-plane endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        nodes: [
          {
            canonical_id: START_ENTITY_ID,
            entity_name: 'AgentCTL',
            hop_distance: 0,
            earliest_seen: '2026-04-20T00:00:00.000Z',
          },
        ],
        edges: [],
        partial: false,
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-traverse',
      payload: {
        arguments: {
          start_entity_canonical_id: START_ENTITY_ID,
          relation_types: ['related_to', 'depends_on'],
          min_confidence: 0.6,
          as_of: '2026-04-20T12:00:00.000Z',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      start_entity_canonical_id: START_ENTITY_ID,
      max_hops: 3,
      node_cap: 100,
      partial: false,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${CONTROL_PLANE_URL}/api/memory/traverse`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          start_entity_canonical_id: START_ENTITY_ID,
          max_hops: 3,
          max_nodes: 100,
          relation_types: ['related_to', 'depends_on'],
          min_confidence: 0.6,
          as_of: '2026-04-20T12:00:00.000Z',
        }),
      }),
    );
  });

  it.each([
    ['missing', {}],
    ['empty', { start_entity_canonical_id: '   ' }],
    ['unsafe', { start_entity_canonical_id: '../secrets' }],
  ])('rejects %s start entity ids before calling control-plane', async (_caseName, payload) => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-traverse',
      payload: {
        arguments: payload,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_PARAMS',
      message: 'start_entity_canonical_id must be a non-empty safe canonical id',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects max_hops above the hard cap', async () => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-traverse',
      payload: {
        arguments: {
          start_entity_canonical_id: START_ENTITY_ID,
          max_hops: 11,
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_PARAMS',
      message: 'max_hops must be an integer between 1 and 10',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['relation_types', { relation_types: ['not_a_relation'] }],
    ['min_confidence', { min_confidence: 2 }],
    ['as_of', { as_of: 'not-a-date' }],
  ])('rejects invalid optional filter %s', async (_field, invalidFilter) => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-traverse',
      payload: {
        arguments: {
          start_entity_canonical_id: START_ENTITY_ID,
          ...invalidFilter,
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PARAMS');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('caps oversized control-plane graphs and marks the response partial', async () => {
    const nodes = Array.from({ length: 101 }, (_, index) => ({
      canonical_id: `entity-${index}`,
      entity_name: `Entity ${index}`,
      hop_distance: index === 0 ? 0 : 1,
      earliest_seen: null,
    }));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        nodes,
        edges: [],
        partial: false,
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-traverse',
      payload: {
        arguments: {
          start_entity_canonical_id: START_ENTITY_ID,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      node_cap: 100,
      partial: true,
    });
    expect(response.json().nodes).toHaveLength(100);
  });
});
