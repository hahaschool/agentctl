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
import { readRateLimitEnv } from '../rate-limit.js';

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
  const memoryDecayRouteRateLimit = {
    max: memoryDecayRateLimitMax,
    timeWindow: memoryDecayRateLimitWindowMs,
  } as const;
  const memoryDecayRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many requests',
  });
  const memoryDecayFastifyRateLimit = {
    ...memoryDecayRouteRateLimit,
    errorResponseBuilder: memoryDecayRateLimitError,
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) =>
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown'),
    errorResponseBuilder: memoryDecayRateLimitError,
  });

  app.post(
    '/run',
    {
      config: { rateLimit: memoryDecayFastifyRateLimit },
      schema: {
        tags: ['memory'],
        summary: 'Run Ebbinghaus memory decay cycle',
      },
      preHandler: app.rateLimit(memoryDecayFastifyRateLimit),
    },
    async () => {
      const result = await decay.runDecay();
      return { ok: true, result };
    },
  );

  app.get(
    '/stats',
    {
      config: { rateLimit: memoryDecayFastifyRateLimit },
      schema: {
        tags: ['memory'],
        summary: 'Get memory strength distribution statistics',
      },
      preHandler: app.rateLimit(memoryDecayFastifyRateLimit),
    },
    async () => {
      const stats = await decay.getDecayStats();
      return { ok: true, stats };
    },
  );
};
