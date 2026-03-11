// ---------------------------------------------------------------------------
// POST /api/memory/maintenance
// GET  /api/memory/maintenance/status
//
// Knowledge Maintenance endpoint -- section 7.4
//
// Triggers a knowledge maintenance run (stale lint, deleted file cross-ref,
// synthesis clustering, coverage report) and returns the results.
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import { KnowledgeMaintenance } from '../../memory/knowledge-maintenance.js';
import type { MemoryStore } from '../../memory/memory-store.js';

export type KnowledgeMaintenanceRoutesOptions = {
  pool: Pool;
  memoryStore: MemoryStore;
  logger: Logger;
  projectRoot?: string;
};

export const knowledgeMaintenanceRoutes: FastifyPluginAsync<
  KnowledgeMaintenanceRoutesOptions
> = async (app, opts) => {
  app.post<{
    Body: { scope?: string; projectRoot?: string };
  }>(
    '/',
    {
      schema: {
        tags: ['memory'],
        summary: 'Run knowledge maintenance — stale lint, cross-ref, synthesis, coverage',
      },
    },
    async (request) => {
      const scope = typeof request.body?.scope === 'string' ? request.body.scope : undefined;
      const projectRoot =
        typeof request.body?.projectRoot === 'string' ? request.body.projectRoot : opts.projectRoot;

      const maintenance = new KnowledgeMaintenance({
        pool: opts.pool,
        memoryStore: opts.memoryStore,
        logger: opts.logger,
        projectRoot,
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
