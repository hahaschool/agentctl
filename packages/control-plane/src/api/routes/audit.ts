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

const MAX_BATCH_SIZE = 1000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export const auditRoutes: FastifyPluginAsync<AuditRoutesOptions> = async (app, opts) => {
  const { dbRegistry } = opts;

  // ---------------------------------------------------------------------------
  // POST /api/audit/actions — batch-ingest audit actions from agent workers
  // ---------------------------------------------------------------------------

  app.post<{ Body: IngestBody }>('/actions', async (request, reply) => {
    const { runId, actions } = request.body;

    if (!runId || typeof runId !== 'string') {
      return reply.code(400).send({ error: 'A non-empty "runId" string is required' });
    }

    if (!Array.isArray(actions) || actions.length === 0) {
      return reply.code(400).send({ error: 'A non-empty "actions" array is required' });
    }

    if (actions.length > MAX_BATCH_SIZE) {
      return reply.code(400).send({
        error: `Batch size ${actions.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
        code: 'BATCH_SIZE_EXCEEDED',
      });
    }

    for (const action of actions) {
      if (!action.actionType || typeof action.actionType !== 'string') {
        return reply.code(400).send({
          error: 'Each action must have a non-empty "actionType" string',
        });
      }
    }

    try {
      const insertedCount = await dbRegistry.insertActions(runId, actions);

      return { ok: true, insertedCount };
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        return reply.code(502).send({ error: error.message, code: error.code });
      }
      return reply.code(500).send({ error: 'Failed to ingest audit actions' });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/audit — query audit actions with filters and pagination
  // ---------------------------------------------------------------------------

  app.get<{ Querystring: AuditQuerystring }>('/', async (request, reply) => {
    const { agentId, from, to, tool, limit: limitStr, offset: offsetStr } = request.query;

    // Validate limit
    let limit = DEFAULT_LIMIT;
    if (limitStr !== undefined) {
      const parsed = Number(limitStr);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return reply.code(400).send({ error: '"limit" must be a positive integer' });
      }
      limit = Math.min(Math.floor(parsed), MAX_LIMIT);
    }

    // Validate offset
    let offset = 0;
    if (offsetStr !== undefined) {
      const parsed = Number(offsetStr);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return reply.code(400).send({ error: '"offset" must be a non-negative integer' });
      }
      offset = Math.floor(parsed);
    }

    // Validate ISO date strings
    if (from !== undefined && Number.isNaN(Date.parse(from))) {
      return reply.code(400).send({ error: '"from" must be a valid ISO date string' });
    }
    if (to !== undefined && Number.isNaN(Date.parse(to))) {
      return reply.code(400).send({ error: '"to" must be a valid ISO date string' });
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
        return reply.code(502).send({ error: error.message, code: error.code });
      }
      return reply.code(500).send({ error: 'Failed to query audit actions' });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/audit/summary — aggregated audit statistics
  // ---------------------------------------------------------------------------

  app.get<{ Querystring: AuditSummaryQuerystring }>('/summary', async (request, reply) => {
    const { agentId, from, to } = request.query;

    // Validate ISO date strings
    if (from !== undefined && Number.isNaN(Date.parse(from))) {
      return reply.code(400).send({ error: '"from" must be a valid ISO date string' });
    }
    if (to !== undefined && Number.isNaN(Date.parse(to))) {
      return reply.code(400).send({ error: '"to" must be a valid ISO date string' });
    }

    try {
      const summary = await dbRegistry.getAuditSummary({ agentId, from, to });

      return summary;
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        return reply.code(502).send({ error: error.message, code: error.code });
      }
      return reply.code(500).send({ error: 'Failed to get audit summary' });
    }
  });
};
