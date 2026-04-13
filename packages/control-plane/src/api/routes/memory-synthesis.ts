// ---------------------------------------------------------------------------
// POST /api/memory/synthesis
//
// Knowledge synthesis endpoint — §3.6 Knowledge Engineering
//
// Phase 1 (lint): identifies candidate facts for review:
//   - near-duplicates  (0.85 ≤ similarity < 0.90)
//   - stale facts      (not accessed in 30+ days)
//   - orphan facts     (no edges to any other fact)
//
// Phase 2 (synthesize): groups related facts by entity_type and proposes
//   higher-level principle candidates.
//
// This endpoint does NOT call an LLM. Synthesis proposals are structural
// candidates ready for human review or an async LLM step.
// ---------------------------------------------------------------------------

import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import type { KnowledgeSynthesisOptions } from '../../memory/knowledge-synthesis.js';
import { KnowledgeSynthesis } from '../../memory/knowledge-synthesis.js';
import { readRateLimitEnv } from '../rate-limit.js';

export type MemorySynthesisRoutesOptions = Pick<KnowledgeSynthesisOptions, 'pool' | 'logger'>;

// Rate-limit synthesis: every request runs four parallel scans over
// memory_facts/memory_edges; a flood pins DB connections and CPU.
const MEMORY_SYNTHESIS_RATE_LIMIT = {
  max: 20,
  timeWindow: 60_000,
} as const;

export const memorySynthesisRoutes: FastifyPluginAsync<MemorySynthesisRoutesOptions> = async (
  app,
  opts,
) => {
  const synthesis = new KnowledgeSynthesis({ pool: opts.pool, logger: opts.logger });

  const memorySynthesisRateLimitMax = readRateLimitEnv(
    'MEMORY_SYNTHESIS_RATE_LIMIT_MAX',
    MEMORY_SYNTHESIS_RATE_LIMIT.max,
  );
  const memorySynthesisRateLimitWindowMs = readRateLimitEnv(
    'MEMORY_SYNTHESIS_RATE_LIMIT_WINDOW_MS',
    MEMORY_SYNTHESIS_RATE_LIMIT.timeWindow,
  );
  const memorySynthesisRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many memory synthesis requests',
  });
  const memorySynthesisFastifyRateLimit = {
    max: memorySynthesisRateLimitMax,
    timeWindow: memorySynthesisRateLimitWindowMs,
    errorResponseBuilder: memorySynthesisRateLimitError,
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) =>
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown'),
    errorResponseBuilder: memorySynthesisRateLimitError,
  });

  app.post<{
    Body: { scope?: string };
  }>(
    '/',
    {
      schema: { tags: ['memory'], summary: 'Run knowledge synthesis — lint + group proposals' },
      config: { rateLimit: memorySynthesisFastifyRateLimit },
      preHandler: [app.rateLimit(memorySynthesisFastifyRateLimit)],
    },
    async (request) => {
      const scope = typeof request.body?.scope === 'string' ? request.body.scope : undefined;
      const result = await synthesis.runSynthesis(scope);
      return { ok: true, result };
    },
  );
};
