// ---------------------------------------------------------------------------
// Memory Decay Routes — §3.6 Knowledge Engineering
//
// POST /api/memory/decay/run   — trigger a decay cycle manually
// GET  /api/memory/decay/stats — retrieve strength distribution statistics
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from 'fastify';
import type { MemoryDecayOptions } from '../../memory/memory-decay.js';
import { MemoryDecay } from '../../memory/memory-decay.js';

export type MemoryDecayRoutesOptions = Pick<MemoryDecayOptions, 'pool' | 'logger'>;

export const memoryDecayRoutes: FastifyPluginAsync<MemoryDecayRoutesOptions> = async (
  app,
  opts,
) => {
  const decay = new MemoryDecay({ pool: opts.pool, logger: opts.logger });

  app.post(
    '/run',
    {
      schema: {
        tags: ['memory'],
        summary: 'Run Ebbinghaus memory decay cycle',
      },
    },
    async () => {
      const result = await decay.runDecay();
      return { ok: true, result };
    },
  );

  app.get(
    '/stats',
    {
      schema: {
        tags: ['memory'],
        summary: 'Get memory strength distribution statistics',
      },
    },
    async () => {
      const stats = await decay.getDecayStats();
      return { ok: true, stats };
    },
  );
};
