import type { LoopConfig } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';

import type { AgentPool } from '../../runtime/agent-pool.js';
import { LoopController } from '../../runtime/loop-controller.js';

type LoopRouteOptions = FastifyPluginOptions & {
  pool: AgentPool;
  machineId: string;
  logger: Logger;
};

type AgentIdParams = {
  id: string;
};

type StartLoopBody = {
  prompt: string;
  config: LoopConfig;
};

type UpdateLoopBody = {
  action: 'pause' | 'resume';
};

const ERROR_STATUS_MAP: Record<string, number> = {
  AGENT_NOT_FOUND: 404,
  LOOP_NOT_FOUND: 404,
  LOOP_ALREADY_RUNNING: 409,
  LOOP_NOT_RUNNING: 409,
  LOOP_NOT_PAUSED: 409,
  LOOP_NO_LIMITS: 400,
  LOOP_INVALID_DELAY: 400,
  LOOP_MISSING_FIXED_PROMPT: 400,
  INVALID_INPUT: 400,
  POOL_FULL: 503,
  AGENT_EXISTS: 409,
};

function errorToStatusCode(err: unknown): number {
  if (err instanceof AgentError) {
    return ERROR_STATUS_MAP[err.code] ?? 500;
  }
  return 500;
}

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

/** Active loop controllers keyed by agent ID. */
const activeLoops: Map<string, LoopController> = new Map();

/**
 * Return the active loops map. Exported for testing so tests can inspect
 * or clear state between runs.
 */
export function getActiveLoops(): Map<string, LoopController> {
  return activeLoops;
}

export async function loopRoutes(app: FastifyInstance, options: LoopRouteOptions): Promise<void> {
  const { pool, machineId, logger } = options;

  // POST /api/agents/:id/loop — Start a loop for an agent
  app.post<{ Params: AgentIdParams; Body: StartLoopBody }>('/:id/loop', async (request, reply) => {
    const { id } = request.params;
    const { prompt, config } = request.body ?? {};

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return reply.status(400).send({
        error: 'A non-empty "prompt" string is required',
        code: 'INVALID_INPUT',
      });
    }

    if (!config || typeof config !== 'object') {
      return reply.status(400).send({
        error: 'A "config" object is required',
        code: 'INVALID_INPUT',
      });
    }

    if (activeLoops.has(id)) {
      return reply.status(409).send({
        error: `Loop for agent '${id}' is already active`,
        code: 'LOOP_ALREADY_RUNNING',
      });
    }

    try {
      // Create the agent in the pool if it doesn't exist yet.
      let instance = pool.getAgent(id);

      if (!instance) {
        instance = await pool.createAgent({
          agentId: id,
          machineId,
          config: {},
          projectPath: process.cwd(),
          logger,
        });
      }

      const controller = new LoopController(instance, config, logger);
      activeLoops.set(id, controller);

      // Start the loop in the background. When the loop finishes
      // (completed, stopped, or error), remove it from the active map.
      controller
        .start(prompt)
        .catch((err) => {
          logger.error({ err, agentId: id }, 'Loop encountered an unhandled error');
        })
        .finally(() => {
          activeLoops.delete(id);
        });

      // Give the loop a tick to transition to running state
      await new Promise((resolve) => {
        process.nextTick(resolve);
      });

      return reply.status(200).send({
        ok: true,
        agentId: id,
        loop: controller.getState(),
      });
    } catch (err) {
      // Clean up if we failed to start
      activeLoops.delete(id);
      const statusCode = errorToStatusCode(err);
      return reply.status(statusCode).send(errorToResponse(err));
    }
  });

  // PUT /api/agents/:id/loop — Pause or resume a loop
  app.put<{ Params: AgentIdParams; Body: UpdateLoopBody }>('/:id/loop', async (request, reply) => {
    const { id } = request.params;
    const { action } = request.body ?? {};

    if (!action || (action !== 'pause' && action !== 'resume')) {
      return reply.status(400).send({
        error: 'An "action" of "pause" or "resume" is required',
        code: 'INVALID_INPUT',
      });
    }

    const controller = activeLoops.get(id);

    if (!controller) {
      return reply.status(404).send({
        error: `No active loop found for agent '${id}'`,
        code: 'LOOP_NOT_FOUND',
      });
    }

    try {
      if (action === 'pause') {
        controller.pause();
      } else {
        controller.resume();
      }

      return reply.status(200).send({
        ok: true,
        agentId: id,
        loop: controller.getState(),
      });
    } catch (err) {
      const statusCode = errorToStatusCode(err);
      return reply.status(statusCode).send(errorToResponse(err));
    }
  });

  // DELETE /api/agents/:id/loop — Stop a loop
  app.delete<{ Params: AgentIdParams }>('/:id/loop', async (request, reply) => {
    const { id } = request.params;

    const controller = activeLoops.get(id);

    if (!controller) {
      return reply.status(404).send({
        error: `No active loop found for agent '${id}'`,
        code: 'LOOP_NOT_FOUND',
      });
    }

    // Capture state before stop — stop() is synchronous and the loop
    // will transition to 'stopped' asynchronously.
    controller.stop();

    // Give the loop a tick to process the stop and update state.
    await new Promise((resolve) => {
      process.nextTick(resolve);
    });

    const finalState = controller.getState();

    // The .finally() handler on start() will remove it from activeLoops
    // after the loop coroutine exits.

    return reply.status(200).send({
      ok: true,
      agentId: id,
      loop: finalState,
    });
  });

  // GET /api/agents/:id/loop — Get loop status
  app.get<{ Params: AgentIdParams }>('/:id/loop', async (request, reply) => {
    const { id } = request.params;

    const controller = activeLoops.get(id);

    if (!controller) {
      return reply.status(404).send({
        error: `No active loop found for agent '${id}'`,
        code: 'LOOP_NOT_FOUND',
      });
    }

    return reply.status(200).send({
      agentId: id,
      loop: controller.getState(),
    });
  });
}
