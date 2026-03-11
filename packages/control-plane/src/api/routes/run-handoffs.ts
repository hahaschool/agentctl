import type { FastifyPluginAsync } from 'fastify';

import type { RunHandoffDecisionStore } from '../../runtime-management/run-handoff-decision-store.js';

export type RunHandoffRoutesOptions = {
  runHandoffDecisionStore: Pick<RunHandoffDecisionStore, 'listForRun'>;
};

export const runHandoffRoutes: FastifyPluginAsync<RunHandoffRoutesOptions> = async (app, opts) => {
  const { runHandoffDecisionStore } = opts;

  app.get<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>(
    '/:id/handoff-history',
    {
      schema: {
        tags: ['runtime-sessions'],
        summary: 'Get automatic handoff decision history for a run',
      },
    },
    async (request) => {
      const limit = request.query.limit ? Number(request.query.limit) : 50;
      const decisions = await runHandoffDecisionStore.listForRun(request.params.id, limit);

      return {
        decisions,
        count: decisions.length,
      };
    },
  );
};
