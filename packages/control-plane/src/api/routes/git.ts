// ---------------------------------------------------------------------------
// Control-plane git proxy routes — forwards git status requests to the correct
// worker machine. Follows the same proxy pattern used for file browsing.
//
// Mounted at /api/machines/:machineId/git
// ---------------------------------------------------------------------------

import { DEFAULT_WORKER_PORT } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { WORKER_REQUEST_TIMEOUT_MS } from '../constants.js';
import { proxyWorkerRequest, replyWithProxyResult } from '../proxy-worker-request.js';
import { resolveWorkerUrlByMachineIdOrThrow } from '../resolve-worker-url.js';

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

      const result = await proxyWorkerRequest({
        workerBaseUrl,
        path: `/api/git/status?${qs.toString()}`,
        method: 'GET',
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      return replyWithProxyResult(reply, result);
    },
  );
};
