// ---------------------------------------------------------------------------
// Memory Decay Routes — §3.6 Knowledge Engineering
//
// POST /api/memory/decay/run   — trigger a decay cycle manually
// GET  /api/memory/decay/stats — retrieve strength distribution statistics
// ---------------------------------------------------------------------------

import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import type { MemoryDecayOptions } from '../../memory/memory-decay.js';
import { MemoryDecay } from '../../memory/memory-decay.js';
import {
  createInMemoryRateLimiter,
  createIpRateLimitPreHandler,
  readRateLimitEnv,
} from '../rate-limit.js';

export type MemoryDecayRoutesOptions = Pick<MemoryDecayOptions, 'pool' | 'logger'>;

// Per-route rate limit config for memory decay operations
const MEMORY_DECAY_RATE_LIMIT = {
  max: 30,
  timeWindow: '1 minute',
} as const;

export const memoryDecayRoutes: FastifyPluginAsync<MemoryDecayRoutesOptions> = async (
  app,
  opts,
) => {
  const decay = new MemoryDecay({ pool: opts.pool, logger: opts.logger });
  const memoryDecayRateLimitMax = readRateLimitEnv(
    'MEMORY_DECAY_RATE_LIMIT_MAX',
    MEMORY_DECAY_RATE_LIMIT.max,
  );
  const memoryDecayRateLimitWindowMs = readRateLimitEnv(
    'MEMORY_DECAY_RATE_LIMIT_WINDOW_MS',
    60_000,
  );

  await app.register(rateLimit, {
    global: false,
    max: memoryDecayRateLimitMax + 1,
    timeWindow: memoryDecayRateLimitWindowMs,
  });

  const frameworkMemoryDecayRateLimit = app.rateLimit({
    max: memoryDecayRateLimitMax + 1,
    timeWindow: '1 minute',
  });

  const enforceMemoryDecayRateLimit = createIpRateLimitPreHandler(
    createInMemoryRateLimiter(memoryDecayRateLimitMax, memoryDecayRateLimitWindowMs),
    'Too many requests',
  );

  app.post(
    '/run',
    {
      schema: {
        tags: ['memory'],
        summary: 'Run Ebbinghaus memory decay cycle',
      },
      preHandler: [frameworkMemoryDecayRateLimit, enforceMemoryDecayRateLimit],
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
      preHandler: [frameworkMemoryDecayRateLimit, enforceMemoryDecayRateLimit],
    },
    async () => {
      const stats = await decay.getDecayStats();
      return { ok: true, stats };
    },
  );
};
