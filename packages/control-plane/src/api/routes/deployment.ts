import type { EventEmitter } from 'node:events';

import type { TierConfig } from '@agentctl/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';

import type { Database } from '../../db/index.js';
import { promotionHistory } from '../../db/schema-deployment.js';
import { pm2List } from '../../utils/pm2-client.js';
import { createPromotionMutex, PromotionRunner } from '../../utils/promotion-runner.js';
import { isValidSourceTier, loadTierConfigs } from '../../utils/tier-config.js';

// ── Constants ────────────────────────────────────────────────────

const HEALTH_TIMEOUT_MS = 5_000;

// ── Types ────────────────────────────────────────────────────────

export type DeploymentRoutesOptions = {
  readonly db: Database;
  readonly logger: Logger;
};

type ServiceHealthResult = {
  readonly name: 'cp' | 'worker' | 'web';
  readonly port: number;
  readonly healthy: boolean;
  readonly memoryMb?: number;
  readonly uptimeSeconds?: number;
  readonly restarts?: number;
  readonly pid?: number;
};

// ── Helpers ──────────────────────────────────────────────────────

async function probeHealth(
  url: string,
  method: 'GET' | 'HEAD' = 'GET',
): Promise<{ healthy: boolean; data?: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (method === 'HEAD') {
      // Any 2xx/3xx = healthy
      return { healthy: res.status >= 200 && res.status < 400 };
    }
    const data = (await res.json()) as Record<string, unknown>;
    return { healthy: res.ok, data };
  } catch {
    return { healthy: false };
  }
}

async function probeTierServices(tier: TierConfig): Promise<readonly ServiceHealthResult[]> {
  const [cpResult, workerResult, webResult] = await Promise.all([
    probeHealth(`http://localhost:${tier.cpPort}/health`),
    probeHealth(`http://localhost:${tier.workerPort}/health`),
    probeHealth(`http://localhost:${tier.webPort}/`, 'HEAD'),
  ]);

  return [
    { name: 'cp' as const, port: tier.cpPort, healthy: cpResult.healthy },
    { name: 'worker' as const, port: tier.workerPort, healthy: workerResult.healthy },
    { name: 'web' as const, port: tier.webPort, healthy: webResult.healthy },
  ];
}

function deriveTierStatus(
  services: readonly ServiceHealthResult[],
): 'running' | 'degraded' | 'stopped' {
  const healthyCount = services.filter((s) => s.healthy).length;
  if (healthyCount === services.length) {
    return 'running';
  }
  if (healthyCount > 0) {
    return 'degraded';
  }
  return 'stopped';
}

// ── Route Plugin ─────────────────────────────────────────────────

export const deploymentRoutes: FastifyPluginAsync<DeploymentRoutesOptions> = async (app, opts) => {
  const { db, logger } = opts;
  const repoRoot = process.env.REPO_ROOT ?? process.cwd();
  const runner = new PromotionRunner(repoRoot, db, logger);
  const mutex = createPromotionMutex();

  /** In-flight promotion event emitters, keyed by promotion ID. */
  const activePromotions = new Map<string, EventEmitter>();

  // ── GET /tiers ──────────────────────────────────────────────────

  app.get('/tiers', async (_request, reply) => {
    try {
      const tierConfigs = loadTierConfigs(repoRoot);

      const tiers = await Promise.all(
        tierConfigs.map(async (tier) => {
          const services = await probeTierServices(tier);
          const enrichedServices = [...services];

          // For beta tier, enrich with PM2 process info
          if (tier.name === 'beta') {
            try {
              const pm2Processes = await pm2List(logger);
              for (let i = 0; i < enrichedServices.length; i++) {
                const svc = enrichedServices[i];
                const pm2Match = pm2Processes.find(
                  (p) =>
                    p.name.includes(`beta`) && p.name.includes(svc.name === 'cp' ? 'cp' : svc.name),
                );
                if (pm2Match) {
                  enrichedServices[i] = {
                    ...svc,
                    memoryMb: pm2Match.memoryMb,
                    uptimeSeconds: Math.round(pm2Match.uptimeMs / 1000),
                    restarts: pm2Match.restarts,
                    pid: pm2Match.pid ?? undefined,
                  };
                }
              }
            } catch (err) {
              logger.warn(
                { error: err instanceof Error ? err.message : String(err) },
                'Failed to fetch PM2 info for beta tier',
              );
            }
          }

          return {
            name: tier.name,
            label: tier.label,
            status: deriveTierStatus(enrichedServices),
            services: enrichedServices,
            config: tier,
          };
        }),
      );

      return reply.send({ tiers });
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        'Failed to load tier status',
      );
      return reply
        .status(500)
        .send({ error: 'TIER_LOAD_FAILED', message: 'Failed to load tier status' });
    }
  });

  // ── POST /promote/preflight ─────────────────────────────────────

  app.post<{ Body: { source: string } }>('/promote/preflight', async (request, reply) => {
    const { source } = request.body ?? {};

    if (!source || typeof source !== 'string') {
      return reply.status(400).send({ error: 'INVALID_SOURCE', message: 'source is required' });
    }

    const tierConfigs = loadTierConfigs(repoRoot);

    if (!isValidSourceTier(source, tierConfigs)) {
      return reply.status(400).send({
        error: 'INVALID_SOURCE',
        message: `"${source}" is not a valid source tier`,
      });
    }

    try {
      const result = await runner.runPreflight(source, tierConfigs);
      return reply.send({ ready: result.passed, checks: result.checks });
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err), source },
        'Preflight check failed unexpectedly',
      );
      return reply.status(500).send({
        error: 'PREFLIGHT_FAILED',
        message: 'Preflight check failed unexpectedly',
      });
    }
  });

  // ── POST /promote ───────────────────────────────────────────────

  app.post<{ Body: { source: string } }>(
    '/promote',
    { config: { rateLimit: { max: 1, timeWindow: 30_000 } } },
    async (request, reply) => {
      const { source } = request.body ?? {};

      if (!source || typeof source !== 'string') {
        return reply.status(400).send({ error: 'INVALID_SOURCE', message: 'source is required' });
      }

      const tierConfigs = loadTierConfigs(repoRoot);

      if (!isValidSourceTier(source, tierConfigs)) {
        return reply.status(400).send({
          error: 'INVALID_SOURCE',
          message: `"${source}" is not a valid source tier`,
        });
      }

      if (mutex.isLocked) {
        return reply.status(409).send({
          error: 'PROMOTION_IN_PROGRESS',
          message: 'Another promotion is already running',
        });
      }

      try {
        const handle = await runner.promote(source, tierConfigs, mutex);
        activePromotions.set(handle.id, handle.events);

        // Clean up emitter on completion
        handle.events.on('event', (event: { type: string }) => {
          if (event.type === 'complete') {
            activePromotions.delete(handle.id);
          }
        });

        return reply.status(202).send({ id: handle.id, status: 'pending' });
      } catch (err) {
        logger.error(
          { error: err instanceof Error ? err.message : String(err), source },
          'Promotion failed to start',
        );
        return reply.status(500).send({
          error: 'PROMOTION_START_FAILED',
          message: 'Failed to start promotion',
        });
      }
    },
  );

  // ── GET /promote/:id/stream ─────────────────────────────────────

  app.get<{ Params: { id: string } }>('/promote/:id/stream', async (request, reply) => {
    const { id } = request.params;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const emitter = activePromotions.get(id);

    if (emitter) {
      const handler = (event: unknown): void => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        if ((event as { type?: string }).type === 'complete') {
          emitter.removeListener('event', handler);
          activePromotions.delete(id);
          reply.raw.end();
        }
      };

      emitter.on('event', handler);

      request.raw.on('close', () => {
        emitter.removeListener('event', handler);
      });
    } else {
      // Not in-flight — try to find the completed record in DB
      try {
        const rows = await db
          .select()
          .from(promotionHistory)
          .where(eq(promotionHistory.id, id))
          .limit(1);

        if (rows.length > 0) {
          const record = rows[0];
          reply.raw.write(
            `data: ${JSON.stringify({
              type: 'complete',
              status: record.status,
              durationMs: record.durationMs ?? 0,
              error: record.error ?? undefined,
            })}\n\n`,
          );
        } else {
          reply.raw.write(
            `data: ${JSON.stringify({ type: 'error', message: 'Promotion not found' })}\n\n`,
          );
        }
      } catch (err) {
        logger.error(
          { error: err instanceof Error ? err.message : String(err), promotionId: id },
          'Failed to look up promotion record',
        );
        reply.raw.write(
          `data: ${JSON.stringify({ type: 'error', message: 'Failed to look up promotion' })}\n\n`,
        );
      }

      reply.raw.end();
    }
  });

  // ── GET /history ────────────────────────────────────────────────

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/history',
    async (request, reply) => {
      const limit = Math.min(
        Math.max(Number.parseInt(request.query.limit ?? '20', 10) || 20, 1),
        100,
      );
      const offset = Math.max(Number.parseInt(request.query.offset ?? '0', 10) || 0, 0);

      try {
        const records = await db
          .select()
          .from(promotionHistory)
          .orderBy(desc(promotionHistory.startedAt))
          .limit(limit)
          .offset(offset);

        const [countResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(promotionHistory);

        return reply.send({
          records,
          total: countResult?.count ?? 0,
        });
      } catch (err) {
        logger.error(
          { error: err instanceof Error ? err.message : String(err) },
          'Failed to fetch promotion history',
        );
        return reply.status(500).send({
          error: 'HISTORY_FETCH_FAILED',
          message: 'Failed to fetch promotion history',
        });
      }
    },
  );
};
