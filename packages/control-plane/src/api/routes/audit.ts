import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { DbAgentRegistry } from '../../registry/db-registry.js';

export type AuditRoutesOptions = {
  dbRegistry: DbAgentRegistry;
};

type AuditActionPayload = {
  actionType: string;
  toolName?: string | null;
  toolInput?: Record<string, unknown> | null;
  toolOutputHash?: string | null;
  durationMs?: number | null;
  approvedBy?: string | null;
};

type IngestBody = {
  runId: string;
  actions: AuditActionPayload[];
};

type AuditQuerystring = {
  agentId?: string;
  from?: string;
  to?: string;
  tool?: string;
  limit?: string;
  offset?: string;
};

type AuditSummaryQuerystring = {
  agentId?: string;
  from?: string;
  to?: string;
};

import { BATCH_LIMITS, clampLimit, PAGINATION } from '../constants.js';

export const auditRoutes: FastifyPluginAsync<AuditRoutesOptions> = async (app, opts) => {
  const { dbRegistry } = opts;

  // ---------------------------------------------------------------------------
  // POST /api/audit/actions — batch-ingest audit actions from agent workers
  // ---------------------------------------------------------------------------

  app.post<{ Body: IngestBody }>(
    '/actions',
    { schema: { tags: ['audit'], summary: 'Batch-ingest audit actions from agent workers' } },
    async (request, reply) => {
      const { runId, actions } = request.body;

      if (!runId || typeof runId !== 'string') {
        return reply
          .code(400)
          .send({ error: 'INVALID_PARAMS', message: 'A non-empty "runId" string is required' });
      }

      if (!Array.isArray(actions) || actions.length === 0) {
        return reply
          .code(400)
          .send({ error: 'INVALID_PARAMS', message: 'A non-empty "actions" array is required' });
      }

      if (actions.length > BATCH_LIMITS.audit) {
        return reply.code(400).send({
          error: 'BATCH_SIZE_EXCEEDED',
          message: `Batch size ${actions.length} exceeds maximum of ${BATCH_LIMITS.audit}`,
        });
      }

      for (const action of actions) {
        if (!action.actionType || typeof action.actionType !== 'string') {
          return reply.code(400).send({
            error: 'INVALID_PARAMS',
            message: 'Each action must have a non-empty "actionType" string',
          });
        }
      }

      try {
        const insertedCount = await dbRegistry.insertActions(runId, actions);

        return { ok: true, insertedCount };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply
          .code(500)
          .send({ error: 'INGEST_FAILED', message: 'Failed to ingest audit actions' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/audit — query audit actions with filters and pagination
  // ---------------------------------------------------------------------------

  app.get<{ Querystring: AuditQuerystring }>(
    '/',
    { schema: { tags: ['audit'], summary: 'Query audit actions with filters and pagination' } },
    async (request, reply) => {
      const { agentId, from, to, tool, limit: limitStr, offset: offsetStr } = request.query;

      // Validate limit
      let limit = PAGINATION.audit.defaultLimit;
      if (limitStr !== undefined) {
        const parsed = Number(limitStr);
        if (!Number.isFinite(parsed) || parsed < 1) {
          return reply
            .code(400)
            .send({ error: 'INVALID_PARAMS', message: '"limit" must be a positive integer' });
        }
        limit = clampLimit(parsed, PAGINATION.audit);
      }

      // Validate offset
      let offset = 0;
      if (offsetStr !== undefined) {
        const parsed = Number(offsetStr);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return reply
            .code(400)
            .send({ error: 'INVALID_PARAMS', message: '"offset" must be a non-negative integer' });
        }
        offset = Math.floor(parsed);
      }

      // Validate ISO date strings
      if (from !== undefined && Number.isNaN(Date.parse(from))) {
        return reply
          .code(400)
          .send({ error: 'INVALID_PARAMS', message: '"from" must be a valid ISO date string' });
      }
      if (to !== undefined && Number.isNaN(Date.parse(to))) {
        return reply
          .code(400)
          .send({ error: 'INVALID_PARAMS', message: '"to" must be a valid ISO date string' });
      }

      try {
        const result = await dbRegistry.queryActions({
          agentId,
          from,
          to,
          tool,
          limit,
          offset,
        });

        return result;
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply
          .code(500)
          .send({ error: 'QUERY_FAILED', message: 'Failed to query audit actions' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/audit/summary — aggregated audit statistics
  // ---------------------------------------------------------------------------

  app.get<{ Querystring: AuditSummaryQuerystring }>(
    '/summary',
    { schema: { tags: ['audit'], summary: 'Get aggregated audit statistics' } },
    async (request, reply) => {
      const { agentId, from, to } = request.query;

      // Validate ISO date strings
      if (from !== undefined && Number.isNaN(Date.parse(from))) {
        return reply
          .code(400)
          .send({ error: 'INVALID_PARAMS', message: '"from" must be a valid ISO date string' });
      }
      if (to !== undefined && Number.isNaN(Date.parse(to))) {
        return reply
          .code(400)
          .send({ error: 'INVALID_PARAMS', message: '"to" must be a valid ISO date string' });
      }

      try {
        const summary = await dbRegistry.getAuditSummary({ agentId, from, to });

        return summary;
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply
          .code(500)
          .send({ error: 'SUMMARY_FAILED', message: 'Failed to get audit summary' });
      }
    },
  );
};
