import { DEFAULT_WORKER_PORT } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { MachineRegistryLike } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { proxyWorkerRequest } from '../proxy-worker-request.js';
import { resolveWorkerUrl } from '../resolve-worker-url.js';

const PROXY_TIMEOUT_MS = 15_000;

export type EmergencyStopRoutesOptions = {
  registry: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry | null;
  workerPort?: number;
};

/**
 * Fastify plugin that registers emergency stop proxy routes.
 *
 * Single-agent stop is proxied to the worker running that agent.
 * Stop-all fans out to ALL known online worker machines.
 */
export const emergencyStopProxyRoutes: FastifyPluginAsync<EmergencyStopRoutesOptions> = async (
  app,
  opts,
) => {
  const { registry, dbRegistry, workerPort = DEFAULT_WORKER_PORT } = opts;

  // POST /api/agents/:id/emergency-stop — Emergency stop a single agent (proxy to worker)
  app.post<{
    Params: { id: string };
    Querystring: { workerUrl?: string; machineId?: string };
  }>(
    '/:id/emergency-stop',
    { schema: { tags: ['agents'], summary: 'Emergency stop a single agent' } },
    async (request, reply) => {
      const agentId = request.params.id;

      app.log.error({ agentId }, 'Emergency stop requested via control plane');

      const resolved = await resolveWorkerUrl(agentId, request.query, {
        registry,
        dbRegistry,
        workerPort,
      });
      if (!resolved.ok) {
        return reply
          .status(resolved.status)
          .send({ error: resolved.error, message: resolved.message });
      }

      const result = await proxyWorkerRequest({
        workerBaseUrl: resolved.url,
        path: `/api/agents/${encodeURIComponent(agentId)}/emergency-stop`,
        method: 'POST',
        timeoutMs: PROXY_TIMEOUT_MS,
      });
      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      // Update agent status in the database to 'stopped'
      if (dbRegistry) {
        try {
          await dbRegistry.updateAgentStatus(agentId, 'stopped');
        } catch {
          // Best-effort: don't fail the emergency stop if the DB update fails
          app.log.warn({ agentId }, 'Failed to update agent status in DB after emergency stop');
        }
      }

      return reply.status(result.status).send(result.data);
    },
  );

  // POST /api/agents/emergency-stop-all — Emergency stop ALL agents on ALL workers
  app.post(
    '/emergency-stop-all',
    { schema: { tags: ['agents'], summary: 'Emergency stop all agents on all workers' } },
    async (_request, reply) => {
      app.log.error('Emergency stop ALL requested via control plane');

      type MachineResult = {
        machineId: string;
        stoppedCount: number;
        error?: string;
      };

      const results: MachineResult[] = [];

      // Get all registered machines
      let allMachines: { hostname: string; tailscaleIp?: string; [key: string]: unknown }[];

      if (dbRegistry) {
        allMachines = await dbRegistry.listMachines();
      } else {
        allMachines = await registry.listMachines();
      }

      // Fan out emergency-stop-all to each online machine
      const proxyPromises = allMachines.map(async (machine) => {
        const machineId = (machine.id ?? machine.machineId ?? machine.hostname) as string;
        const machineStatus = machine.status as string | undefined;

        // Skip offline machines
        if (machineStatus === 'offline') {
          results.push({ machineId, stoppedCount: 0, error: 'machine_offline' });
          return;
        }

        const address = machine.tailscaleIp ?? machine.hostname;
        const workerUrl = `http://${address}:${String(workerPort)}`;

        const result = await proxyWorkerRequest({
          workerBaseUrl: workerUrl,
          path: '/api/agents/emergency-stop-all',
          method: 'POST',
          timeoutMs: PROXY_TIMEOUT_MS,
        });

        if (!result.ok) {
          results.push({ machineId, stoppedCount: 0, error: result.message });
          return;
        }

        const data = result.data as { stoppedCount?: number };
        results.push({ machineId, stoppedCount: data.stoppedCount ?? 0 });
      });

      await Promise.all(proxyPromises);

      app.log.error({ results }, 'Emergency stop ALL completed across all machines');

      return reply.status(200).send({
        ok: true,
        results,
      });
    },
  );
};
