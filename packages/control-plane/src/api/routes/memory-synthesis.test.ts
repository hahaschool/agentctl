import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from './test-helpers.js';
import { memorySynthesisRoutes } from './memory-synthesis.js';

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
});
