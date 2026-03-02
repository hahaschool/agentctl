import { AgentError } from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';

import type { AgentPool } from '../../runtime/agent-pool.js';
import type { LoopController } from '../../runtime/loop-controller.js';

type EmergencyStopRouteOptions = FastifyPluginOptions & {
  pool: AgentPool;
  machineId: string;
  logger: Logger;
  /** Accessor for the active loops map managed by the loop routes plugin. */
  getActiveLoops: () => Map<string, LoopController>;
};

type AgentIdParams = {
  id: string;
};

function errorToResponse(err: unknown): {
  error: string;
  code: string;
  context?: Record<string, unknown>;
} {
  if (err instanceof AgentError) {
    return {
      error: err.message,
      code: err.code,
      context: err.context,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return { error: message, code: 'INTERNAL_ERROR' };
}

export async function emergencyStopRoutes(
  app: FastifyInstance,
  options: EmergencyStopRouteOptions,
): Promise<void> {
  const { pool, logger, getActiveLoops } = options;

  // POST /api/agents/:id/emergency-stop — emergency stop a single agent
  app.post<{ Params: AgentIdParams }>('/:id/emergency-stop', async (request, reply) => {
    const { id } = request.params;

    logger.error({ agentId: id }, 'Emergency stop requested for agent');

    try {
      // Stop any active loop for this agent first
      const activeLoops = getActiveLoops();
      const loopController = activeLoops.get(id);

      if (loopController) {
        loopController.stop();
        activeLoops.delete(id);
        logger.error({ agentId: id }, 'Active loop stopped during emergency stop');
      }

      // Force-kill the agent and clean up worktree
      const { stoppedAt } = await pool.emergencyStop(id);

      return reply.status(200).send({
        ok: true,
        agentId: id,
        stoppedAt: stoppedAt.toISOString(),
      });
    } catch (err) {
      if (err instanceof AgentError && err.code === 'AGENT_NOT_FOUND') {
        return reply.status(404).send(errorToResponse(err));
      }

      logger.error({ err, agentId: id }, 'Emergency stop failed');
      return reply.status(500).send(errorToResponse(err));
    }
  });

  // POST /api/agents/emergency-stop-all — emergency stop ALL agents and loops
  app.post('/emergency-stop-all', async (_request, reply) => {
    logger.error('Emergency stop ALL requested');

    try {
      // Stop all active loops first
      const activeLoops = getActiveLoops();
      const loopCount = activeLoops.size;

      for (const [agentId, controller] of activeLoops) {
        controller.stop();
        logger.error({ agentId }, 'Active loop stopped during emergency stop all');
      }

      activeLoops.clear();

      // Force-kill all agents and clean up worktrees
      const { stoppedCount } = await pool.emergencyStopAll();

      logger.error({ stoppedCount, loopsStopped: loopCount }, 'Emergency stop ALL completed');

      return reply.status(200).send({
        ok: true,
        stoppedCount,
        loopsStopped: loopCount,
      });
    } catch (err) {
      logger.error({ err }, 'Emergency stop ALL failed');
      return reply.status(500).send(errorToResponse(err));
    }
  });
}
