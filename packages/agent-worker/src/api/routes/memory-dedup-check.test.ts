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
      match_id: null,
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

  it('recommends skip when top candidate score meets the skip threshold', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [
          {
            fact: { id: 'fact-skip-1', content: 'AgentCTL stores memory facts in PostgreSQL.' },
            score: 0.92,
            source_path: 'vector',
          },
        ],
        total: 1,
      }),
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
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.is_duplicate).toBe(true);
    expect(body.recommendation).toBe('skip');
    expect(body.match_id).toBe('fact-skip-1');
    expect(body.rationale).toContain('near-duplicate');
    expect(body.rationale).toContain('0.920');
    expect(body.nearest_matches).toHaveLength(1);
    expect(body.nearest_matches[0]).toMatchObject({ id: 'fact-skip-1', score: 0.92 });
  });

  it('recommends merge when top candidate score sits between merge and skip thresholds', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [
          {
            fact: { id: 'fact-merge-1', content: 'AgentCTL memory uses a hybrid retrieval layer.' },
            score: 0.82,
            source_path: 'vector',
          },
        ],
        total: 1,
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-dedup-check',
      payload: {
        arguments: {
          scope: 'global',
          entity_type: 'concept',
          content_preview: 'AgentCTL memory layer mixes vector and keyword search.',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.is_duplicate).toBe(false);
    expect(body.recommendation).toBe('merge');
    expect(body.match_id).toBe('fact-merge-1');
    expect(body.rationale).toContain('similar but not identical');
    expect(body.rationale).toContain('0.820');
  });

  it('recommends store_new when top candidate score is below the merge threshold', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [
          {
            fact: { id: 'fact-lowsim-1', content: 'Unrelated memory entry about something else.' },
            score: 0.4,
            source_path: 'bm25',
          },
        ],
        total: 1,
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-dedup-check',
      payload: {
        arguments: {
          scope: 'global',
          content_preview: 'Brand new fact to remember.',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.is_duplicate).toBe(false);
    expect(body.recommendation).toBe('store_new');
    expect(body.match_id).toBeNull();
    expect(body.rationale).toContain('low');
    expect(body.rationale).toContain('0.400');
    expect(body.nearest_matches).toHaveLength(1);
  });

  it('defensively recommends store_new when the top candidate has no score', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [
          {
            fact: { id: 'fact-noscore-1', content: 'A candidate without any similarity score.' },
            source_path: 'graph',
          },
        ],
        total: 1,
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-dedup-check',
      payload: {
        arguments: {
          scope: 'global',
          content_preview: 'Content preview that should be scored defensively.',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.is_duplicate).toBe(false);
    expect(body.recommendation).toBe('store_new');
    expect(body.match_id).toBeNull();
    expect(body.rationale).toContain('no similarity score');
    expect(body.nearest_matches).toHaveLength(1);
    expect(body.nearest_matches[0].score).toBeNull();
  });

  it('sorts multiple candidates by score descending and chooses the top scored one', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: [
          {
            fact: { id: 'fact-mid', content: 'Mid similarity candidate.' },
            score: 0.5,
            source_path: 'bm25',
          },
          {
            fact: { id: 'fact-top', content: 'Highest similarity candidate.' },
            score: 0.95,
            source_path: 'vector',
          },
          {
            fact: { id: 'fact-low', content: 'Low similarity candidate.' },
            score: 0.1,
            source_path: 'bm25',
          },
        ],
        total: 3,
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/mcp/memory-dedup-check',
      payload: {
        arguments: {
          scope: 'global',
          content_preview: 'Probe preview for sort-order coverage.',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.recommendation).toBe('skip');
    expect(body.match_id).toBe('fact-top');
    expect(body.is_duplicate).toBe(true);
    expect(body.nearest_matches.map((match: { id: string }) => match.id)).toEqual([
      'fact-top',
      'fact-mid',
      'fact-low',
    ]);
    expect(body.nearest_matches.map((match: { score: number }) => match.score)).toEqual([
      0.95, 0.5, 0.1,
    ]);
  });
});
