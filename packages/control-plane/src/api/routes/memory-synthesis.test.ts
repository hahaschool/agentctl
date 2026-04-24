import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySynthesisRoutes } from './memory-synthesis.js';
import { createMockLogger } from './test-helpers.js';

const logger = createMockLogger();

function makeEmptyPool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
}

describe('memorySynthesisRoutes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const pool = makeEmptyPool();
    app = Fastify({ logger: false });
    await app.register(memorySynthesisRoutes, {
      prefix: '/api/memory/synthesis',
      pool: pool as never,
      logger,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns ok with empty result when no facts exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/memory/synthesis',
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      ok: boolean;
      result: {
        lint: { nearDuplicates: unknown[]; staleFacts: unknown[]; orphanFacts: unknown[] };
        synthesisGroups: unknown[];
      };
    };
    expect(body.ok).toBe(true);
    expect(body.result.lint.nearDuplicates).toHaveLength(0);
    expect(body.result.lint.staleFacts).toHaveLength(0);
    expect(body.result.lint.orphanFacts).toHaveLength(0);
    expect(body.result.synthesisGroups).toHaveLength(0);
  });

  it('accepts a scope parameter and passes it through', async () => {
    const pool = makeEmptyPool();
    const scopedApp = Fastify({ logger: false });
    await scopedApp.register(memorySynthesisRoutes, {
      prefix: '/api/memory/synthesis',
      pool: pool as never,
      logger,
    });
    await scopedApp.ready();

    const response = await scopedApp.inject({
      method: 'POST',
      url: '/api/memory/synthesis',
      payload: { scope: 'project:agentctl' },
    });

    expect(response.statusCode).toBe(200);
    // All 4 pool queries should include the scope parameter
    for (const call of vi.mocked(pool.query).mock.calls as [string, unknown[]][]) {
      expect(call[1]).toContain('project:agentctl');
    }

    await scopedApp.close();
  });

  it('surfaces deterministic principle candidate metadata for synthesis groups', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              fact_id_a: 'fact-1',
              fact_id_b: 'fact-2',
              similarity: 0.88,
              content_a: 'Small deploy batches keep rollback easy.',
              content_b: 'Prefer small deploy batches for safer rollback.',
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [
            {
              entity_type: 'decision',
              fact_ids: ['fact-1', 'fact-2', 'fact-3'],
              fact_contents: [
                'Small deploy batches keep rollback easy.',
                'Prefer small deploy batches for safer rollback.',
                'Rollback stays safer with small deploy batches.',
              ],
              scopes: ['project:agentctl', 'project:agentctl', 'project:agentctl'],
              fact_count: 3,
            },
          ],
          rowCount: 1,
        }),
    };
    const richApp = Fastify({ logger: false });
    await richApp.register(memorySynthesisRoutes, {
      prefix: '/api/memory/synthesis',
      pool: pool as never,
      logger,
    });
    await richApp.ready();

    try {
      const response = await richApp.inject({
        method: 'POST',
        url: '/api/memory/synthesis',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        ok: boolean;
        result: {
          synthesisGroups: Array<{
            principleCandidate?: {
              title: string;
              evidenceCount: number;
              scope: string;
              actionHint: string;
              confidence: number;
            };
          }>;
        };
      };
      expect(body.ok).toBe(true);
      expect(body.result.synthesisGroups[0]?.principleCandidate).toMatchObject({
        title: 'Small deploy batches keep rollback easy',
        evidenceCount: 3,
        scope: 'project:agentctl',
        actionHint:
          'Draft one reviewed principle for this decision cluster, then link the strongest evidence facts under it.',
      });
      expect(body.result.synthesisGroups[0]?.principleCandidate?.confidence).toBeCloseTo(0.68, 2);
    } finally {
      await richApp.close();
    }
  });
});

// Rate limiting — synthesis runs parallel DB scans; must bound CPU/IO.
describe('memorySynthesisRoutes rate limiting', () => {
  const originalMax = process.env.MEMORY_SYNTHESIS_RATE_LIMIT_MAX;
  const originalWindow = process.env.MEMORY_SYNTHESIS_RATE_LIMIT_WINDOW_MS;

  beforeAll(() => {
    process.env.MEMORY_SYNTHESIS_RATE_LIMIT_MAX = '3';
    process.env.MEMORY_SYNTHESIS_RATE_LIMIT_WINDOW_MS = '60000';
  });

  afterAll(() => {
    if (originalMax === undefined) delete process.env.MEMORY_SYNTHESIS_RATE_LIMIT_MAX;
    else process.env.MEMORY_SYNTHESIS_RATE_LIMIT_MAX = originalMax;
    if (originalWindow === undefined) delete process.env.MEMORY_SYNTHESIS_RATE_LIMIT_WINDOW_MS;
    else process.env.MEMORY_SYNTHESIS_RATE_LIMIT_WINDOW_MS = originalWindow;
  });

  it('returns 429 after exceeding the configured limit on POST /', async () => {
    const pool = makeEmptyPool();
    const app = Fastify({ logger: false });
    await app.register(memorySynthesisRoutes, {
      prefix: '/api/memory/synthesis',
      pool: pool as never,
      logger,
    });
    await app.ready();
    try {
      for (let i = 0; i < 3; i += 1) {
        const ok = await app.inject({
          method: 'POST',
          url: '/api/memory/synthesis',
          payload: {},
          headers: { 'x-forwarded-for': '10.0.0.72' },
          remoteAddress: '10.0.0.72',
        });
        expect(ok.statusCode).toBe(200);
      }

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/memory/synthesis',
        payload: {},
        headers: { 'x-forwarded-for': '10.0.0.72' },
        remoteAddress: '10.0.0.72',
      });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error).toBe('RATE_LIMITED');
    } finally {
      await app.close();
    }
  });
});
