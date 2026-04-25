import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { memoryTimelineRoutes } from './memory-timeline.js';

const CONTROL_PLANE_URL = 'http://localhost:8080';
const ENTITY_ID = 'fact-A';
const TIMELINE_LIMITATIONS = [
  'This slice resolves `entity` as `memory_facts.id`; canonical entity joins are not wired yet.',
  'Timeline windows are derived from `memory_facts.valid_from` / `valid_until` because `memory_edges` does not yet store temporal fields.',
];

function makeApp(controlPlaneUrl = CONTROL_PLANE_URL): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(memoryTimelineRoutes, {
    prefix: '/api/mcp',
    controlPlaneUrl,
    logger: createSilentLogger(),
  });
  return app;
}

function makeCursor(): string {
  return `mtl_v1:${Buffer.from(
    JSON.stringify({
      effectiveFrom: '2026-04-04T00:00:00.000Z',
      edgeCreatedAt: '2026-04-05T00:00:00.000Z',
      edgeId: 'edge-2',
    }),
    'utf8',
  ).toString('base64url')}`;
}

function makeTimelineResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    entity: {
      requested_id: ENTITY_ID,
      resolved_fact_id: ENTITY_ID,
      content_preview: 'fact fact-A',
      valid_from: '2026-04-01T00:00:00.000Z',
      valid_until: null,
      confidence: 0.9,
      active_at_as_of: null,
      canonicalization_mode: 'fact-id-fallback',
    },
    as_of: null,
    limit: 20,
    next_cursor: null,
    events: [
      {
        edge_id: 'edge-1',
        relation: 'related_to',
        direction: 'outgoing',
        other_fact_id: 'fact-B',
        other_fact_preview: 'fact fact-B',
        effective_from: '2026-04-02T00:00:00.000Z',
        effective_until: null,
        edge_created_at: '2026-04-03T00:00:00.000Z',
        source_fact_id: ENTITY_ID,
        target_fact_id: 'fact-B',
      },
    ],
    limitations: TIMELINE_LIMITATIONS,
    ...overrides,
  };
}

describe('memoryTimelineRoutes', () => {
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

  it('proxies successful control-plane timeline responses without reshaping them', async () => {
    const timelineResponse = makeTimelineResponse();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => timelineResponse,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-timeline',
      payload: {
        arguments: {
          entity: ENTITY_ID,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(timelineResponse);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${CONTROL_PLANE_URL}/api/memory/timeline?entity=${ENTITY_ID}&limit=20`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it.each([
    ['asOf', '2026-04-10T05:06:07Z', '2026-04-10T05:06:07.000Z'],
    ['as_of', '2026-04-11T08:09:10Z', '2026-04-11T08:09:10.000Z'],
  ])('accepts %s and forwards it as as_of', async (field, value, expectedIso) => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeTimelineResponse({ as_of: expectedIso }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-timeline',
      payload: {
        arguments: {
          entity: ENTITY_ID,
          [field]: value,
          cursor: makeCursor(),
          limit: 5,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${CONTROL_PLANE_URL}/api/memory/timeline?entity=${ENTITY_ID}&limit=5&cursor=${encodeURIComponent(makeCursor())}&as_of=${encodeURIComponent(expectedIso)}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('maps no-data control-plane responses to a stable empty timeline response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'MEMORY_TIMELINE_ENTITY_NOT_FOUND' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-timeline',
      payload: {
        arguments: {
          entity: ENTITY_ID,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      entity: {
        requested_id: ENTITY_ID,
        resolved_fact_id: ENTITY_ID,
        content_preview: '',
        valid_from: '',
        valid_until: null,
        confidence: null,
        active_at_as_of: null,
        canonicalization_mode: 'fact-id-fallback',
      },
      as_of: null,
      limit: 20,
      next_cursor: null,
      events: [],
      limitations: TIMELINE_LIMITATIONS,
    });
  });

  it('rejects null arguments with a structured 400 without calling control-plane', async () => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-timeline',
      payload: { arguments: null },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_ARGUMENTS',
      message: 'arguments must be a non-null object when provided',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing entity', {}, 'entity must be a non-empty safe id'],
    ['empty entity', { entity: '   ' }, 'entity must be a non-empty safe id'],
    [
      'invalid timestamp',
      { entity: ENTITY_ID, asOf: 'not-a-date' },
      'asOf must be a valid timestamp string',
    ],
    [
      'limit too small',
      { entity: ENTITY_ID, limit: 0 },
      'limit must be an integer between 1 and 100',
    ],
    [
      'limit too large',
      { entity: ENTITY_ID, limit: 101 },
      'limit must be an integer between 1 and 100',
    ],
    [
      'invalid cursor',
      { entity: ENTITY_ID, cursor: 'not-a-real-cursor' },
      'cursor must be a valid opaque pagination token',
    ],
  ])('rejects %s before calling control-plane', async (_caseName, payload, message) => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-timeline',
      payload: { arguments: payload },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_PARAMS',
      message,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects conflicting as_of and asOf aliases before calling control-plane', async () => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-timeline',
      payload: {
        arguments: {
          entity: ENTITY_ID,
          as_of: '2026-04-10T00:00:00.000Z',
          asOf: '2026-04-11T00:00:00.000Z',
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_PARAMS',
      message: 'as_of and asOf must match when both are provided',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns 503 when the control-plane is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-timeline',
      payload: {
        arguments: {
          entity: ENTITY_ID,
        },
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: 'MEMORY_TIMELINE_UNREACHABLE',
      message: 'Control-plane unreachable while reading memory timeline',
    });
  });
});
