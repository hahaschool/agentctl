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

const MAX_BATCH_SIZE = 1000;

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
};
