// ---------------------------------------------------------------------------
// Control-plane git proxy routes — forwards git status requests to the correct
// worker machine. Follows the same proxy pattern used for file browsing.
//
// Mounted at /api/machines/:machineId/git
// ---------------------------------------------------------------------------

import { ControlPlaneError, DEFAULT_WORKER_PORT } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { DbAgentRegistry } from '../../registry/db-registry.js';

const GIT_REQUEST_TIMEOUT_MS = 10_000;

/** Get the best address for a machine, preferring tailscaleIp with hostname fallback. */
function machineAddress(machine: { tailscaleIp?: string | null; hostname: string }): string {
  return machine.tailscaleIp ?? machine.hostname;
}

export type GitProxyRoutesOptions = {
  dbRegistry: DbAgentRegistry;
  workerPort?: number;
};

export const gitProxyRoutes: FastifyPluginAsync<GitProxyRoutesOptions> = async (app, opts) => {
  const { dbRegistry, workerPort = DEFAULT_WORKER_PORT } = opts;

  /**
   * Look up a machine and build the worker base URL. Throws if the machine
   * is not found or is offline.
   */
  async function resolveWorker(machineId: string): Promise<string> {
    const machine = await dbRegistry.getMachine(machineId);

    if (!machine) {
      throw new ControlPlaneError(
        'MACHINE_NOT_FOUND',
        `Machine '${machineId}' is not registered`,
        { machineId },
      );
    }

    if (machine.status === 'offline') {
      throw new ControlPlaneError(
        'MACHINE_OFFLINE',
        `Machine '${machineId}' (${machine.hostname}) is offline`,
        { machineId },
      );
    }

    return `http://${machineAddress(machine)}:${String(workerPort)}`;
  }

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
          const body = await res.json().catch(() => ({ error: 'UNKNOWN', message: res.statusText }));
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
