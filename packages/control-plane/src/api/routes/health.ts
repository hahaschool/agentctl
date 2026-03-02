import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import type { Mem0Client } from '../../memory/mem0-client.js';
import type { LiteLLMClient } from '../../router/litellm-client.js';

const HEALTH_CHECK_TIMEOUT_MS = 2_000;

export type HealthRoutesOptions = {
  db?: Database;
  redis?: { ping: () => Promise<string> };
  mem0Client?: Mem0Client;
  litellmClient?: LiteLLMClient;
};

type DependencyStatus = {
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
};

type HealthResponse = {
  status: 'ok' | 'degraded';
  timestamp: string;
  dependencies?: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
    mem0: DependencyStatus;
    litellm: DependencyStatus;
  };
};

/**
 * Execute a health check with a timeout. Returns a DependencyStatus indicating
 * success or failure along with the measured latency.
 */
async function checkWithTimeout(
  name: string,
  fn: () => Promise<void>,
): Promise<DependencyStatus> {
  const start = performance.now();

  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`${name} health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)), HEALTH_CHECK_TIMEOUT_MS);
      }),
    ]);

    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      latencyMs: Math.round(performance.now() - start),
      error: message,
    };
  }
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, opts) => {
  const { db, redis, mem0Client, litellmClient } = opts;

  app.get<{ Querystring: { detail?: string } }>('/health', async (request) => {
    const detail = request.query.detail === 'true';
    const timestamp = new Date().toISOString();

    if (!detail) {
      // Fast path for load balancer polls — no dependency checks.
      // Still compute overall status based on configured dependencies
      // so that callers can distinguish between healthy and degraded.
      const [pgResult, redisResult, mem0Result, litellmResult] = await Promise.allSettled([
        db
          ? checkWithTimeout('postgres', async () => { await db.execute(sql`SELECT 1`); })
          : Promise.resolve({ status: 'ok' as const, latencyMs: 0 }),
        redis
          ? checkWithTimeout('redis', async () => { await redis.ping(); })
          : Promise.resolve({ status: 'ok' as const, latencyMs: 0 }),
        mem0Client
          ? checkWithTimeout('mem0', async () => {
              const healthy = await mem0Client.health();
              if (!healthy) throw new Error('Mem0 health endpoint returned non-OK');
            })
          : Promise.resolve({ status: 'ok' as const, latencyMs: 0 }),
        litellmClient
          ? checkWithTimeout('litellm', async () => {
              const healthy = await litellmClient.health();
              if (!healthy) throw new Error('LiteLLM health endpoint returned non-OK');
            })
          : Promise.resolve({ status: 'ok' as const, latencyMs: 0 }),
      ]);

      const results = [pgResult, redisResult, mem0Result, litellmResult];
      const anyError = results.some(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status === 'error'),
      );

      return { status: anyError ? 'degraded' : 'ok', timestamp } satisfies HealthResponse;
    }

    // Detailed path — run all checks in parallel and return per-dependency results.
    const [pgResult, redisResult, mem0Result, litellmResult] = await Promise.allSettled([
      db
        ? checkWithTimeout('postgres', async () => { await db.execute(sql`SELECT 1`); })
        : Promise.resolve({ status: 'ok' as const, latencyMs: 0 }),
      redis
        ? checkWithTimeout('redis', async () => { await redis.ping(); })
        : Promise.resolve({ status: 'ok' as const, latencyMs: 0 }),
      mem0Client
        ? checkWithTimeout('mem0', async () => {
            const healthy = await mem0Client.health();
            if (!healthy) throw new Error('Mem0 health endpoint returned non-OK');
          })
        : Promise.resolve({ status: 'ok' as const, latencyMs: 0 }),
      litellmClient
        ? checkWithTimeout('litellm', async () => {
            const healthy = await litellmClient.health();
            if (!healthy) throw new Error('LiteLLM health endpoint returned non-OK');
          })
        : Promise.resolve({ status: 'ok' as const, latencyMs: 0 }),
    ]);

    const toDepStatus = (result: PromiseSettledResult<DependencyStatus>): DependencyStatus => {
      if (result.status === 'fulfilled') return result.value;
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      return { status: 'error', latencyMs: 0, error: message };
    };

    const dependencies = {
      postgres: toDepStatus(pgResult),
      redis: toDepStatus(redisResult),
      mem0: toDepStatus(mem0Result),
      litellm: toDepStatus(litellmResult),
    };

    const anyError = Object.values(dependencies).some((d) => d.status === 'error');

    return {
      status: anyError ? 'degraded' : 'ok',
      timestamp,
      dependencies,
    } satisfies HealthResponse;
  });
};
