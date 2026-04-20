import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { memoryDedupCheckRoutes } from './memory-dedup-check.js';

const CONTROL_PLANE_URL = 'http://localhost:8080';

function makeApp(controlPlaneUrl = CONTROL_PLANE_URL): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(memoryDedupCheckRoutes, {
    prefix: '/api/mcp',
    controlPlaneUrl,
    logger: createSilentLogger(),
  });
  return app;
}

describe('memoryDedupCheckRoutes', () => {
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

  it('returns store_new with no nearest matches when control-plane search has no candidates', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, facts: [], total: 0 }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-dedup-check',
      payload: {
        arguments: {
          scope: 'global',
          entity_type: 'concept',
          content_preview: 'AgentCTL stores memory facts in PostgreSQL.',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      is_duplicate: false,
      nearest_matches: [],
      recommendation: 'store_new',
      rationale: 'No existing memory candidates matched this content preview.',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/memory/facts?q=AgentCTL+stores+memory+facts+in+PostgreSQL.'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('scope=global'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=5'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects missing content_preview', async () => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-dedup-check',
      payload: {
        arguments: {
          scope: 'global',
          entity_type: 'concept',
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_PARAMS',
      message: 'content_preview must be a non-empty string',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid entity_type', async () => {
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-dedup-check',
      payload: {
        arguments: {
          scope: 'global',
          entity_type: 'invalid-type',
          content_preview: 'Remember this validated contract.',
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_ENTITY_TYPE',
      message:
        'entity_type must be one of: code_artifact, decision, pattern, error, person, concept, preference, skill, experience, principle, question',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
