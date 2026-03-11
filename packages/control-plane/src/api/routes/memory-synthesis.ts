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

import type { FastifyPluginAsync } from 'fastify';
import type { KnowledgeSynthesisOptions } from '../../memory/knowledge-synthesis.js';
import { KnowledgeSynthesis } from '../../memory/knowledge-synthesis.js';

export type MemorySynthesisRoutesOptions = Pick<KnowledgeSynthesisOptions, 'pool' | 'logger'>;

export const memorySynthesisRoutes: FastifyPluginAsync<MemorySynthesisRoutesOptions> = async (
  app,
  opts,
) => {
  const synthesis = new KnowledgeSynthesis({ pool: opts.pool, logger: opts.logger });

  app.post<{
    Body: { scope?: string };
  }>(
    '/',
    { schema: { tags: ['memory'], summary: 'Run knowledge synthesis — lint + group proposals' } },
    async (request) => {
      const scope = typeof request.body?.scope === 'string' ? request.body.scope : undefined;
      const result = await synthesis.runSynthesis(scope);
      return { ok: true, result };
    },
  );
};
