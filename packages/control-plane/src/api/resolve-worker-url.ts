import { ControlPlaneError } from '@agentctl/shared';

import type { MachineRegistryLike } from '../registry/agent-registry.js';
import type { DbAgentRegistry } from '../registry/db-registry.js';

// ---------------------------------------------------------------------------
// SSRF protection: validate that a URL points to an internal network address
// ---------------------------------------------------------------------------

/** Tailscale CGNAT range: 100.64.0.0/10 */
const TAILSCALE_PREFIX = '100.';

/**
 * Validate that a user-supplied worker URL points to an internal address only.
 * Rejects external URLs to prevent SSRF (js/request-forgery).
 *
 * Allowed targets:
 * - localhost / 127.0.0.1 / [::1]
 * - Tailscale CGNAT range (100.64.0.0 - 100.127.255.255)
 * - Private RFC1918 ranges (10.x, 172.16-31.x, 192.168.x)
 * - MagicDNS .ts.net hostnames
 */
function validateInternalUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ControlPlaneError('INVALID_WORKER_URL', `"${raw}" is not a valid URL`);
  }

  const { hostname } = parsed;

  // Allow localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return;
  }

  // Allow Tailscale MagicDNS
  if (hostname.endsWith('.ts.net')) {
    return;
  }

  // Allow private IP ranges
  if (hostname.startsWith(TAILSCALE_PREFIX)) {
    // Tailscale CGNAT 100.64.0.0/10 — check second octet
    const parts = hostname.split('.');
    const secondOctet = Number(parts[1]);
    if (secondOctet >= 64 && secondOctet <= 127) {
      return;
    }
  }

  if (hostname.startsWith('10.')) {
    return;
  }

  if (hostname.startsWith('192.168.')) {
    return;
  }

  if (hostname.startsWith('172.')) {
    const parts = hostname.split('.');
    const secondOctet = Number(parts[1]);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return;
    }
  }

  throw new ControlPlaneError(
    'SSRF_BLOCKED',
    `Worker URL "${raw}" points to a non-internal address. Only localhost, Tailscale, and private network addresses are allowed.`,
    { hostname },
  );
}

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
    // Security: validate that user-provided URL targets internal network only
    // to prevent SSRF (js/request-forgery).
    validateInternalUrl(explicitUrl);
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

    const address = machine.tailscaleIp ?? machine.hostname;
    return { ok: true, url: `http://${address}:${String(workerPort)}` };
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

// ---------------------------------------------------------------------------
// Machine-centric resolution (used by proxy routes: terminal, files, git)
// ---------------------------------------------------------------------------

export type ResolveByMachineIdDeps = {
  dbRegistry: DbAgentRegistry;
  workerPort: number;
};

/**
 * Resolve the base URL of the worker running on a specific machine.
 *
 * Unlike {@link resolveWorkerUrl} (which resolves via agent → machine), this
 * function resolves directly from a `machineId`. Used by machine-scoped proxy
 * routes (terminal, files, git) that already know the target machine.
 *
 * Returns a discriminated union — inspect `ok` to determine success/failure.
 */
export async function resolveWorkerUrlByMachineId(
  machineId: string,
  deps: ResolveByMachineIdDeps,
): Promise<ResolvedWorkerUrl> {
  const { dbRegistry, workerPort } = deps;

  const machine = await dbRegistry.getMachine(machineId);

  if (!machine) {
    return {
      ok: false,
      status: 404,
      error: 'MACHINE_NOT_FOUND',
      message: `Machine '${machineId}' is not registered`,
    };
  }

  if (machine.status === 'offline') {
    return {
      ok: false,
      status: 503,
      error: 'MACHINE_OFFLINE',
      message: `Machine '${machineId}' (${machine.hostname}) is offline`,
    };
  }

  const address = machine.tailscaleIp ?? machine.hostname;
  return { ok: true, url: `http://${address}:${String(workerPort)}` };
}

/**
 * Resolve worker URL by machine ID or throw a {@link ControlPlaneError}.
 *
 * Convenience wrapper for callers that prefer exception-based control flow
 * (e.g. `terminal.ts`, `files.ts`, `git.ts`).
 */
export async function resolveWorkerUrlByMachineIdOrThrow(
  machineId: string,
  deps: ResolveByMachineIdDeps,
): Promise<string> {
  const result = await resolveWorkerUrlByMachineId(machineId, deps);

  if (!result.ok) {
    throw new ControlPlaneError(result.error, result.message, { machineId });
  }

  return result.url;
}
