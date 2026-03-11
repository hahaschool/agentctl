import type { FastifyPluginAsync } from 'fastify';

import type { MemoryStore } from '../../memory/memory-store.js';

type MemoryStatsRoutesOptions = {
  memoryStore: Pick<MemoryStore, 'getStats'>;
};

export const memoryStatsRoutes: FastifyPluginAsync<MemoryStatsRoutesOptions> = async (
  app,
  opts,
) => {
  app.get(
    '/',
    { schema: { tags: ['memory'], summary: 'Get memory dashboard statistics' } },
    async () => {
      const stats = await opts.memoryStore.getStats();
      return { ok: true, stats };
    },
  );
};
