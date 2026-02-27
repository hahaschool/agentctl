import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';

import type { AgentConfig } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';

import type { AgentPool } from '../../runtime/agent-pool.js';

type AgentRouteOptions = FastifyPluginOptions & {
  pool: AgentPool;
  machineId: string;
  logger: Logger;
};

type StartAgentBody = {
  prompt: string;
  config?: AgentConfig;
  projectPath?: string;
};

type StopAgentBody = {
  graceful?: boolean;
};

type AgentIdParams = {
  id: string;
};

const ERROR_STATUS_MAP: Record<string, number> = {
  AGENT_NOT_FOUND: 404,
  AGENT_EXISTS: 409,
  POOL_FULL: 503,
  INVALID_TRANSITION: 409,
  AGENT_STILL_RUNNING: 409,
};

function errorToStatusCode(err: unknown): number {
  if (err instanceof AgentError) {
    return ERROR_STATUS_MAP[err.code] ?? 500;
  }
  return 500;
}

function errorToResponse(err: unknown): { error: string; code: string; context?: Record<string, unknown> } {
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

export async function agentRoutes(
  app: FastifyInstance,
  options: AgentRouteOptions,
): Promise<void> {
  const { pool, machineId, logger } = options;

  // GET /api/agents — list all agents in the pool
  app.get('/', async (_request, reply) => {
    const agents = pool.listAgents();
    return reply.send({
      agents,
      count: agents.length,
      maxConcurrent: pool.getMaxConcurrent(),
    });
  });

  // GET /api/agents/:id — get single agent details
  app.get<{ Params: AgentIdParams }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const instance = pool.getAgent(id);

    if (!instance) {
      return reply.status(404).send({
        error: `Agent '${id}' not found`,
        code: 'AGENT_NOT_FOUND',
      });
    }

    return reply.send(instance.toJSON());
  });

  // POST /api/agents/:id/start — create agent in pool (if needed) and start it
  app.post<{ Params: AgentIdParams; Body: StartAgentBody }>(
    '/:id/start',
    async (request, reply) => {
      const { id } = request.params;
      const { prompt, config, projectPath } = request.body;

      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return reply.status(400).send({
          error: 'A non-empty "prompt" string is required',
          code: 'INVALID_INPUT',
        });
      }

      try {
        // Create the agent in the pool if it doesn't exist yet.
        let instance = pool.getAgent(id);

        if (!instance) {
          instance = pool.createAgent({
            agentId: id,
            machineId,
            config: config ?? {},
            projectPath: projectPath ?? process.cwd(),
            logger,
          });
        }

        await instance.start(prompt);

        return reply.status(200).send({
          ok: true,
          agentId: id,
          sessionId: instance.getSessionId(),
          status: instance.getStatus(),
        });
      } catch (err) {
        const statusCode = errorToStatusCode(err);
        return reply.status(statusCode).send(errorToResponse(err));
      }
    },
  );

  // POST /api/agents/:id/stop — stop a running agent
  app.post<{ Params: AgentIdParams; Body: StopAgentBody }>(
    '/:id/stop',
    async (request, reply) => {
      const { id } = request.params;
      const { graceful = true } = request.body ?? {};

      try {
        await pool.stopAgent(id, graceful);

        const instance = pool.getAgent(id);
        return reply.status(200).send({
          ok: true,
          agentId: id,
          status: instance?.getStatus() ?? 'stopped',
        });
      } catch (err) {
        const statusCode = errorToStatusCode(err);
        return reply.status(statusCode).send(errorToResponse(err));
      }
    },
  );

  // DELETE /api/agents/:id — remove a stopped agent from the pool
  app.delete<{ Params: AgentIdParams }>('/:id', async (request, reply) => {
    const { id } = request.params;

    try {
      const removed = pool.removeAgent(id);

      if (!removed) {
        return reply.status(404).send({
          error: `Agent '${id}' not found`,
          code: 'AGENT_NOT_FOUND',
        });
      }

      return reply.status(200).send({
        ok: true,
        agentId: id,
      });
    } catch (err) {
      const statusCode = errorToStatusCode(err);
      return reply.status(statusCode).send(errorToResponse(err));
    }
  });
}
