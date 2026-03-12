import type { preHandlerHookHandler } from 'fastify';

type RateLimitBucket = { count: number; resetAt: number };

export type InMemoryRateLimiter = {
  check: (key: string) => boolean;
};

export function createInMemoryRateLimiter(
  maxRequests: number,
  windowMs: number,
): InMemoryRateLimiter {
  const buckets = new Map<string, RateLimitBucket>();

  return {
    check(key: string): boolean {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket || now >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }

      bucket.count++;
      return bucket.count <= maxRequests;
    },
  };
}

export function readRateLimitEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createIpRateLimitPreHandler(
  limiter: InMemoryRateLimiter,
  message: string,
): preHandlerHookHandler {
  return async (request, reply) => {
    const key =
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown');

    if (limiter.check(key)) {
      return;
    }

    return reply.status(429).send({
      error: message,
      code: 'RATE_LIMITED',
    });
  };
}
