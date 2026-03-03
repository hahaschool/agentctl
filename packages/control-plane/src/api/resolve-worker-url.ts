import { ControlPlaneError } from '@agentctl/shared';

import type { MachineRegistryLike } from '../registry/agent-registry.js';
import type { DbAgentRegistry } from '../registry/db-registry.js';

export type ResolvedWorkerUrl =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string; message: string };

export type ResolveWorkerUrlDeps = {
  registry?: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry | null;
  workerPort: number;
};

/**
 * Resolve the base URL of the worker running a given agent.
 *
 * Resolution order:
 *   1. Explicit `workerUrl` query parameter.
 *   2. `machineId` query parameter resolved via the machine registry.
 *   3. Automatic lookup via `dbRegistry` — agent -> machine -> tailscaleIp.
 */
export async function resolveWorkerUrl(
  agentId: string,
  query: { workerUrl?: string; machineId?: string },
  deps: ResolveWorkerUrlDeps,
): Promise<ResolvedWorkerUrl> {
  const { registry, dbRegistry, workerPort } = deps;
  const { workerUrl: explicitUrl, machineId } = query;

  if (explicitUrl) {
    return { ok: true, url: explicitUrl };
  }

  if (machineId && registry) {
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
    return { ok: true, url: `http://${address}:${String(workerPort)}` };
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

    return { ok: true, url: `http://${machine.tailscaleIp}:${String(workerPort)}` };
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
 * Resolve worker URL or throw a {@link ControlPlaneError}.
 *
 * Convenience wrapper for callers that prefer exception-based control flow
 * (e.g. `stream.ts`, `ws.ts`) rather than inspecting a result union.
 */
export async function resolveWorkerUrlOrThrow(
  agentId: string,
  query: { workerUrl?: string; machineId?: string },
  deps: ResolveWorkerUrlDeps,
): Promise<string> {
  const result = await resolveWorkerUrl(agentId, query, deps);

  if (!result.ok) {
    throw new ControlPlaneError(result.error, result.message, { agentId });
  }

  return result.url;
}
