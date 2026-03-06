// ---------------------------------------------------------------------------
// Control-plane git proxy routes — forwards git status requests to the correct
// worker machine. Follows the same proxy pattern used for file browsing.
//
// Mounted at /api/machines/:machineId/git
// ---------------------------------------------------------------------------

import { ControlPlaneError, DEFAULT_WORKER_PORT } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { resolveWorkerUrlByMachineIdOrThrow } from '../resolve-worker-url.js';

const GIT_REQUEST_TIMEOUT_MS = 10_000;

export type GitProxyRoutesOptions = {
  dbRegistry: DbAgentRegistry;
  workerPort?: number;
};

export const gitProxyRoutes: FastifyPluginAsync<GitProxyRoutesOptions> = async (app, opts) => {
  const { dbRegistry, workerPort = DEFAULT_WORKER_PORT } = opts;

  /** Resolve the worker base URL for a machine. */
  const resolveWorker = (machineId: string): Promise<string> =>
    resolveWorkerUrlByMachineIdOrThrow(machineId, { dbRegistry, workerPort });

  // -------------------------------------------------------------------------
  // GET /:machineId/git/status — proxy git status from a worker
  // -------------------------------------------------------------------------

  app.get<{
    Params: { machineId: string };
    Querystring: { path?: string };
  }>(
    '/:machineId/git/status',
    { schema: { tags: ['git'], summary: 'Get git repository status from a worker machine' } },
    async (request, reply) => {
      const { machineId } = request.params;
      const { path } = request.query;

      if (!path || typeof path !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_PATH',
          message: 'A non-empty "path" query parameter is required',
        });
      }

      const workerBaseUrl = await resolveWorker(machineId);
      const qs = new URLSearchParams({ path });
      const url = `${workerBaseUrl}/api/git/status?${qs.toString()}`;

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(GIT_REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
          const body = await res
            .json()
            .catch(() => ({ error: 'UNKNOWN', message: res.statusText }));
          return reply.code(res.status).send(body);
        }

        return await res.json();
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'WORKER_UNREACHABLE',
          `Failed to get git status from worker at ${workerBaseUrl}: ${errMessage}`,
          { machineId },
        );
      }
    },
  );
};
