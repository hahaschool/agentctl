import type { FastifyPluginAsync } from 'fastify';

import type { MachineRegistryLike } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';

const WORKER_PORT = Number(process.env.WORKER_PORT) || 9000;
const PROXY_TIMEOUT_MS = 15_000;

export type EmergencyStopRoutesOptions = {
  registry: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry | null;
};

type ResolvedWorkerUrl =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string; message: string };

/**
 * Resolve the base URL of the worker running a given agent.
 *
 * Resolution order:
 *   1. Explicit `workerUrl` query parameter.
 *   2. `machineId` query parameter resolved via the machine registry.
 *   3. Automatic lookup via `dbRegistry` -- agent -> machine -> tailscaleIp.
 */
async function resolveWorkerUrl(
  agentId: string,
  query: { workerUrl?: string; machineId?: string },
  registry: MachineRegistryLike,
  dbRegistry: DbAgentRegistry | null | undefined,
): Promise<ResolvedWorkerUrl> {
  const { workerUrl: explicitUrl, machineId } = query;

  if (explicitUrl) {
    return { ok: true, url: explicitUrl };
  }

  if (machineId) {
    const machine = await registry.getMachine(machineId);

    if (!machine) {
      return {
        ok: false,
        status: 404,
        error: 'MACHINE_NOT_FOUND',
        message: `Machine '${machineId}' is not registered`,
      };
    }

    const address = machine.tailscaleIp ?? machine.hostname;
    return { ok: true, url: `http://${address}:${String(WORKER_PORT)}` };
  }

  if (dbRegistry) {
    const agent = await dbRegistry.getAgent(agentId);

    if (!agent) {
      return {
        ok: false,
        status: 404,
        error: 'AGENT_NOT_FOUND',
        message: `Agent '${agentId}' does not exist in the registry`,
      };
    }

    const machine = await dbRegistry.getMachine(agent.machineId);

    if (!machine) {
      return {
        ok: false,
        status: 404,
        error: 'MACHINE_NOT_FOUND',
        message: `Machine '${agent.machineId}' for agent '${agentId}' is not registered`,
      };
    }

    if (machine.status === 'offline') {
      return {
        ok: false,
        status: 503,
        error: 'MACHINE_OFFLINE',
        message: `Machine '${machine.id}' (${machine.hostname}) is offline`,
      };
    }

    return { ok: true, url: `http://${machine.tailscaleIp}:${String(WORKER_PORT)}` };
  }

  return {
    ok: false,
    status: 500,
    error: 'REGISTRY_UNAVAILABLE',
    message:
      'Cannot resolve worker URL: no machineId provided and database registry is not configured',
  };
}

/**
 * Proxy an emergency-stop request to a single agent worker.
 */
async function proxyEmergencyStop(
  workerBaseUrl: string,
  agentId: string,
): Promise<
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string; message: string }
> {
  const url = `${workerBaseUrl}/api/agents/${encodeURIComponent(agentId)}/emergency-stop`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 502,
      error: 'WORKER_UNREACHABLE',
      message: `Failed to connect to worker at ${workerBaseUrl}: ${message}`,
    };
  }

  const data: unknown = await response.json();
  return { ok: true, status: response.status, data };
}

/**
 * Proxy an emergency-stop-all request to a worker.
 */
async function proxyEmergencyStopAll(
  workerBaseUrl: string,
): Promise<
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string; message: string }
> {
  const url = `${workerBaseUrl}/api/agents/emergency-stop-all`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 502,
      error: 'WORKER_UNREACHABLE',
      message: `Failed to connect to worker at ${workerBaseUrl}: ${message}`,
    };
  }

  const data: unknown = await response.json();
  return { ok: true, status: response.status, data };
}

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
  const { registry, dbRegistry } = opts;

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

      const resolved = await resolveWorkerUrl(agentId, request.query, registry, dbRegistry);
      if (!resolved.ok) {
        return reply
          .status(resolved.status)
          .send({ error: resolved.error, message: resolved.message });
      }

      const result = await proxyEmergencyStop(resolved.url, agentId);
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
        const workerUrl = `http://${address}:${String(WORKER_PORT)}`;

        const result = await proxyEmergencyStopAll(workerUrl);

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
