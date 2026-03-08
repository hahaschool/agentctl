import { ControlPlaneError, checkWithTimeout } from '@agentctl/shared';
import type { DependencyStatus } from '@agentctl/shared';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import type { Mem0Client } from '../../memory/mem0-client.js';
import type { LiteLLMClient } from '../../router/litellm-client.js';
import { HEALTH_CHECK_TIMEOUT_MS } from '../constants.js';

export type HealthRoutesOptions = {
  db?: Database;
  redis?: { ping: () => Promise<string> };
  mem0Client?: Mem0Client;
  litellmClient?: LiteLLMClient;
};

type MemoryUsage = {
  rss: number;
  heapUsed: number;
  heapTotal: number;
};

type HealthResponse = {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptime: number;
  nodeVersion: string;
  memoryUsage: MemoryUsage;
  dependencies?: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
    mem0: DependencyStatus;
    litellm: DependencyStatus;
  };
};

const OK_STATUS: DependencyStatus = { status: 'ok', latencyMs: 0 };

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, opts) => {
  const { db, redis, mem0Client, litellmClient } = opts;

  /** Run all dependency health checks in parallel. */
  function runHealthChecks(): Promise<
    [
      PromiseSettledResult<DependencyStatus>,
      PromiseSettledResult<DependencyStatus>,
      PromiseSettledResult<DependencyStatus>,
      PromiseSettledResult<DependencyStatus>,
    ]
  > {
    return Promise.allSettled([
      db
        ? checkWithTimeout('postgres', async () => {
            await db.execute(sql`SELECT 1`);
          }, HEALTH_CHECK_TIMEOUT_MS)
        : Promise.resolve(OK_STATUS),
      redis
        ? checkWithTimeout('redis', async () => {
            await redis.ping();
          }, HEALTH_CHECK_TIMEOUT_MS)
        : Promise.resolve(OK_STATUS),
      mem0Client
        ? checkWithTimeout('mem0', async () => {
            const healthy = await mem0Client.health();
            if (!healthy)
              throw new ControlPlaneError(
                'HEALTH_CHECK_FAILED',
                'Mem0 health endpoint returned non-OK',
                { component: 'mem0' },
              );
          }, HEALTH_CHECK_TIMEOUT_MS)
        : Promise.resolve(OK_STATUS),
      litellmClient
        ? checkWithTimeout('litellm', async () => {
            const healthy = await litellmClient.health();
            if (!healthy)
              throw new ControlPlaneError(
                'HEALTH_CHECK_FAILED',
                'LiteLLM health endpoint returned non-OK',
                { component: 'litellm' },
              );
          }, HEALTH_CHECK_TIMEOUT_MS)
        : Promise.resolve(OK_STATUS),
    ]) as Promise<
      [
        PromiseSettledResult<DependencyStatus>,
        PromiseSettledResult<DependencyStatus>,
        PromiseSettledResult<DependencyStatus>,
        PromiseSettledResult<DependencyStatus>,
      ]
    >;
  }

  app.get<{ Querystring: { detail?: string } }>(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Health check',
        description:
          'Returns system health status. Pass ?detail=true for per-dependency breakdown.',
      },
    },
    async (request) => {
      const detail = request.query.detail === 'true';
      const timestamp = new Date().toISOString();
      const mem = process.memoryUsage();
      const toMb = (bytes: number): number => Math.round((bytes / 1_048_576) * 100) / 100;
      const memoryUsage: MemoryUsage = {
        rss: toMb(mem.rss),
        heapUsed: toMb(mem.heapUsed),
        heapTotal: toMb(mem.heapTotal),
      };

      const [pgResult, redisResult, mem0Result, litellmResult] = await runHealthChecks();

      const toDepStatus = (result: PromiseSettledResult<DependencyStatus>): DependencyStatus => {
        if (result.status === 'fulfilled') return result.value;
        const message =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        return { status: 'error', latencyMs: 0, error: message };
      };

      const results = [pgResult, redisResult, mem0Result, litellmResult];
      const anyError = results.some(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status === 'error'),
      );

      const base = {
        status: anyError ? ('degraded' as const) : ('ok' as const),
        timestamp,
        uptime: process.uptime(),
        nodeVersion: process.version,
        memoryUsage,
      };

      if (!detail) {
        return base satisfies HealthResponse;
      }

      return {
        ...base,
        dependencies: {
          postgres: toDepStatus(pgResult),
          redis: toDepStatus(redisResult),
          mem0: toDepStatus(mem0Result),
          litellm: toDepStatus(litellmResult),
        },
      } satisfies HealthResponse;
    },
  );
};
