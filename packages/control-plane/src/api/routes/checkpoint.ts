import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import { agentRuns, agents } from '../../db/index.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';

const VALID_CHECKPOINT_STATUSES = ['running', 'paused', 'completed', 'failed'] as const;
type CheckpointStatus = (typeof VALID_CHECKPOINT_STATUSES)[number];

type CheckpointBody = {
  agentId: string;
  runId: string;
  iteration: number;
  totalCost: number;
  elapsedMs: number;
  lastResult?: string;
  status: CheckpointStatus;
};

export type CheckpointRoutesOptions = {
  dbRegistry: DbAgentRegistry;
  db: Database;
};

/**
 * Fastify plugin that registers the loop checkpoint endpoint.
 *
 * POST /api/agents/:id/checkpoint
 *   Receives CheckpointData from the agent worker and updates
 *   the agent's status and loop state in the database.
 */
export const checkpointRoutes: FastifyPluginAsync<CheckpointRoutesOptions> = async (app, opts) => {
  const { dbRegistry, db } = opts;

  app.post<{ Params: { id: string }; Body: CheckpointBody }>(
    '/:id/checkpoint',
    { schema: { tags: ['agents'], summary: 'Receive loop checkpoint from agent worker' } },
    async (request, reply) => {
      const agentId = request.params.id;
      const body = request.body;

      // --- Validate required fields ---
      if (!body || typeof body !== 'object') {
        return reply.code(400).send({
          error: 'INVALID_BODY',
          message: 'Request body must be a JSON object',
        });
      }

      if (!body.runId || typeof body.runId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_RUN_ID',
          message: 'A non-empty "runId" string is required',
        });
      }

      if (
        typeof body.iteration !== 'number' ||
        !Number.isInteger(body.iteration) ||
        body.iteration < 0
      ) {
        return reply.code(400).send({
          error: 'INVALID_ITERATION',
          message: '"iteration" must be a non-negative integer',
        });
      }

      if (typeof body.totalCost !== 'number' || body.totalCost < 0) {
        return reply.code(400).send({
          error: 'INVALID_TOTAL_COST',
          message: '"totalCost" must be a non-negative number',
        });
      }

      if (typeof body.elapsedMs !== 'number' || body.elapsedMs < 0) {
        return reply.code(400).send({
          error: 'INVALID_ELAPSED_MS',
          message: '"elapsedMs" must be a non-negative number',
        });
      }

      if (!body.status || !VALID_CHECKPOINT_STATUSES.includes(body.status)) {
        return reply.code(400).send({
          error: 'INVALID_STATUS',
          message: `"status" must be one of: ${VALID_CHECKPOINT_STATUSES.join(', ')}`,
        });
      }

      // --- Verify agent exists ---
      const agent = await dbRegistry.getAgent(agentId);
      if (!agent) {
        return reply.code(404).send({
          error: 'AGENT_NOT_FOUND',
          message: `Agent '${agentId}' does not exist in the registry`,
        });
      }

      // --- Update agent status based on checkpoint ---
      try {
        const agentStatus = mapCheckpointStatusToAgentStatus(body.status);
        await db
          .update(agents)
          .set({
            status: agentStatus,
            totalCostUsd: String(body.totalCost),
            lastRunAt: new Date(),
          })
          .where(eq(agents.id, agentId));

        // Update the run record with loop iteration data
        await db
          .update(agentRuns)
          .set({
            loopIteration: body.iteration,
            resultSummary: body.lastResult ?? null,
          })
          .where(eq(agentRuns.id, body.runId));

        app.log.info(
          {
            agentId,
            runId: body.runId,
            iteration: body.iteration,
            totalCost: body.totalCost,
            elapsedMs: body.elapsedMs,
            status: body.status,
          },
          'Loop checkpoint received',
        );

        return reply.code(200).send({
          ok: true,
          agentId,
          runId: body.runId,
          iteration: body.iteration,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        app.log.error({ err, agentId, runId: body.runId }, 'Failed to process checkpoint');

        return reply.code(500).send({
          error: 'CHECKPOINT_FAILED',
          message: `Failed to process checkpoint: ${message}`,
        });
      }
    },
  );
};

/**
 * Map a checkpoint status to an agent status for the agents table.
 */
function mapCheckpointStatusToAgentStatus(checkpointStatus: CheckpointStatus): string {
  switch (checkpointStatus) {
    case 'running':
      return 'running';
    case 'paused':
      return 'stopping';
    case 'completed':
      return 'stopped';
    case 'failed':
      return 'error';
  }
}
