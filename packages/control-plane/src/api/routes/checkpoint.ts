import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { Database } from '../../db/index.js';
import { agentRuns, agents } from '../../db/index.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';

const VALID_CHECKPOINT_STATUSES = ['running', 'paused', 'completed', 'failed'] as const;
type CheckpointStatus = (typeof VALID_CHECKPOINT_STATUSES)[number];

// Bound worker-supplied strings to prevent a misbehaving or compromised worker
// from writing unbounded blobs into agent_runs.result_summary / runId. UUID-
// style runIds are ~40 chars, so 128 is comfortable. Result summaries are used
// in UI cells — 8 KB keeps them render-friendly without truncating real data.
const MAX_RUN_ID_LENGTH = 128;
const MAX_LAST_RESULT_LENGTH = 8_192;

const checkpointBodySchema = z.object({
  agentId: z.string().optional(),
  runId: z.string().min(1).max(MAX_RUN_ID_LENGTH),
  iteration: z.number().int().nonnegative(),
  totalCost: z.number().nonnegative().finite(),
  elapsedMs: z.number().nonnegative().finite(),
  lastResult: z.string().max(MAX_LAST_RESULT_LENGTH).optional(),
  status: z.enum(VALID_CHECKPOINT_STATUSES),
});

type CheckpointBody = z.infer<typeof checkpointBodySchema>;

function checkpointIssueToResponse(issue: z.ZodIssue | undefined): {
  error: string;
  message: string;
} {
  const field = issue?.path[0];
  switch (field) {
    case 'runId':
      return {
        error: 'INVALID_RUN_ID',
        message: 'A non-empty "runId" string is required',
      };
    case 'iteration':
      return {
        error: 'INVALID_ITERATION',
        message: '"iteration" must be a non-negative integer',
      };
    case 'totalCost':
      return {
        error: 'INVALID_TOTAL_COST',
        message: '"totalCost" must be a non-negative number',
      };
    case 'elapsedMs':
      return {
        error: 'INVALID_ELAPSED_MS',
        message: '"elapsedMs" must be a non-negative number',
      };
    case 'status':
      return {
        error: 'INVALID_STATUS',
        message: `"status" must be one of: ${VALID_CHECKPOINT_STATUSES.join(', ')}`,
      };
    case 'lastResult':
      return {
        error: 'INVALID_LAST_RESULT',
        message: `"lastResult" must be a string of at most ${MAX_LAST_RESULT_LENGTH} characters`,
      };
    default:
      return {
        error: 'INVALID_BODY',
        message: 'Request body must be a JSON object matching the checkpoint schema',
      };
  }
}

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

      // --- Validate required fields via Zod schema ---
      const parsed = checkpointBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(checkpointIssueToResponse(parsed.error.issues[0]));
      }
      const body: CheckpointBody = parsed.data;

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
