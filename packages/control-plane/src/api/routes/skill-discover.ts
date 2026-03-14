import { MANAGED_RUNTIMES, isManagedRuntime } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { resolveWorkerUrlByMachineId } from '../resolve-worker-url.js';

// ---------------------------------------------------------------------------
// Route options
// ---------------------------------------------------------------------------

export type SkillDiscoverRoutesOptions = {
  dbRegistry?: DbAgentRegistry;
  workerPort?: number;
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const skillDiscoverRoutes: FastifyPluginAsync<SkillDiscoverRoutesOptions> = async (
  app,
  opts,
) => {
  const { dbRegistry, workerPort = 9000 } = opts;

  // GET /api/skills/discover — proxy skill discovery to a worker
  app.get<{
    Querystring: { machineId: string; projectPath?: string; runtime?: string };
  }>(
    '/discover',
    {
      schema: {
        tags: ['skills'],
        summary: 'Discover skills on a machine',
        description:
          'Proxies a discovery request to the specified worker machine to find skills from global and project SKILL.md files',
      },
    },
    async (request, reply) => {
      const { machineId, projectPath } = request.query;
      const runtime = request.query.runtime ?? 'claude-code';

      if (!machineId) {
        return reply.code(400).send({
          error: 'INVALID_INPUT',
          message: 'machineId query parameter is required',
        });
      }

      if (!isManagedRuntime(runtime)) {
        return reply.code(400).send({
          error: 'INVALID_RUNTIME',
          message: `Invalid runtime: ${runtime}. Must be one of: ${MANAGED_RUNTIMES.join(', ')}`,
        });
      }

      if (!dbRegistry) {
        return reply.code(503).send({
          error: 'REGISTRY_UNAVAILABLE',
          message: 'Database registry is not configured',
        });
      }

      const workerResult = await resolveWorkerUrlByMachineId(machineId, {
        dbRegistry,
        workerPort,
      });

      if (!workerResult.ok) {
        return reply
          .code(workerResult.status)
          .send({ error: workerResult.error, message: workerResult.message });
      }

      // Proxy the request to the worker
      const qs = new URLSearchParams();
      qs.set('runtime', runtime);
      if (projectPath) qs.set('projectPath', projectPath);
      const workerUrl = `${workerResult.url}/api/skills/discover?${qs.toString()}`;

      try {
        const response = await fetch(workerUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(10_000),
        });

        const data = await response.json();

        if (!response.ok) {
          return reply.code(response.status).send(data);
        }

        return reply.send(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({
          error: 'WORKER_UNREACHABLE',
          message: `Failed to reach worker for skill discovery: ${message}`,
        });
      }
    },
  );
};
