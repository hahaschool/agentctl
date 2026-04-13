// ---------------------------------------------------------------------------
// POST /api/memory/maintenance
// GET  /api/memory/maintenance/status
//
// Knowledge Maintenance endpoint -- section 7.4
//
// Triggers a knowledge maintenance run (stale lint, deleted file cross-ref,
// synthesis clustering, coverage report) and returns the results.
// ---------------------------------------------------------------------------

import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import { KnowledgeMaintenance } from '../../memory/knowledge-maintenance.js';
import type { MemoryStore } from '../../memory/memory-store.js';
import { readRateLimitEnv } from '../rate-limit.js';

export type KnowledgeMaintenanceRoutesOptions = {
  pool: Pool;
  memoryStore: MemoryStore;
  logger: Logger;
  projectRoot?: string;
};

// Rate-limit maintenance triggers: each request runs a full memory sweep and
// writes a maintenance report; a flood starves DB connections.
const KNOWLEDGE_MAINTENANCE_RATE_LIMIT = {
  max: 20,
  timeWindow: 60_000,
} as const;

export const knowledgeMaintenanceRoutes: FastifyPluginAsync<
  KnowledgeMaintenanceRoutesOptions
> = async (app, opts) => {
  const knowledgeMaintenanceRateLimitMax = readRateLimitEnv(
    'KNOWLEDGE_MAINTENANCE_RATE_LIMIT_MAX',
    KNOWLEDGE_MAINTENANCE_RATE_LIMIT.max,
  );
  const knowledgeMaintenanceRateLimitWindowMs = readRateLimitEnv(
    'KNOWLEDGE_MAINTENANCE_RATE_LIMIT_WINDOW_MS',
    KNOWLEDGE_MAINTENANCE_RATE_LIMIT.timeWindow,
  );
  const knowledgeMaintenanceRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many knowledge maintenance requests',
  });
  const knowledgeMaintenanceFastifyRateLimit = {
    max: knowledgeMaintenanceRateLimitMax,
    timeWindow: knowledgeMaintenanceRateLimitWindowMs,
    errorResponseBuilder: knowledgeMaintenanceRateLimitError,
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) =>
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown'),
    errorResponseBuilder: knowledgeMaintenanceRateLimitError,
  });

  app.post<{
    Body: { scope?: string };
  }>(
    '/',
    {
      schema: {
        tags: ['memory'],
        summary: 'Run knowledge maintenance — stale lint, cross-ref, synthesis, coverage',
      },
      config: { rateLimit: knowledgeMaintenanceFastifyRateLimit },
      preHandler: [app.rateLimit(knowledgeMaintenanceFastifyRateLimit)],
    },
    async (request) => {
      const scope = typeof request.body?.scope === 'string' ? request.body.scope : undefined;

      const maintenance = new KnowledgeMaintenance({
        pool: opts.pool,
        memoryStore: opts.memoryStore,
        logger: opts.logger,
        projectRoot: opts.projectRoot,
      });

      const result = await maintenance.run(scope);

      return {
        ok: true,
        summary: {
          staleEntries: result.staleEntries.length,
          deletedFileEntries: result.deletedFileEntries.length,
          synthesisClusters: result.synthesisClusters.length,
          consolidationItems: result.consolidationItems.length,
          coverageReport: {
            totalDirectories: result.coverageReport.totalDirectories,
            covered: result.coverageReport.coveredCount,
            gaps: result.coverageReport.gapCount,
          },
          reportId: result.report?.id ?? null,
        },
        result,
      };
    },
  );
};
