import type { Machine } from '@agentctl/shared';
import { isManagedRuntime, MANAGED_RUNTIMES } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { DbAgentRegistry } from '../../registry/db-registry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MachineCapabilitiesRoutesOptions = {
  dbRegistry?: DbAgentRegistry;
  workerPort?: number;
};

type SyncCapabilitiesBody = {
  runtime?: string;
  projectPath?: string;
};

type McpDiscoverResponse = {
  discovered: ReadonlyArray<{ name: string; [key: string]: unknown }>;
  [key: string]: unknown;
};

type SkillDiscoverResponse = {
  discovered: ReadonlyArray<{ id: string; [key: string]: unknown }>;
  [key: string]: unknown;
};

export type SyncCapabilitiesResult = {
  machineId: string;
  runtime: string;
  mcpServerSources: Record<string, 'discovered' | 'manual'>;
  skillSources: Record<string, 'discovered' | 'manual'>;
  lastDiscoveredAt: string;
  mcpDiscovered: number;
  skillsDiscovered: number;
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchDiscovery<T>(
  url: string,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return { ok: false, error: `Worker returned ${String(response.status)}` };
    }

    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// Core sync logic — reusable from heartbeat and route
// ---------------------------------------------------------------------------

/**
 * Run MCP + skill discovery against a machine's worker and update capabilities.
 * The machine must already be verified as existing and online.
 */
export async function syncMachineCapabilities(opts: {
  machine: Machine;
  dbRegistry: DbAgentRegistry;
  workerPort: number;
  runtime?: string;
  projectPath?: string;
}): Promise<SyncCapabilitiesResult> {
  const { machine, dbRegistry, workerPort, runtime = 'claude-code', projectPath } = opts;

  const address = machine.tailscaleIp ?? machine.hostname;
  const workerBase = `http://${address}:${String(workerPort)}`;

  // Build query string for discovery calls
  const qs = new URLSearchParams();
  qs.set('runtime', runtime);
  if (projectPath) qs.set('projectPath', projectPath);
  const queryStr = qs.toString();

  // Call both discovery endpoints in parallel
  const [mcpResult, skillResult] = await Promise.all([
    fetchDiscovery<McpDiscoverResponse>(`${workerBase}/api/mcp/discover?${queryStr}`),
    fetchDiscovery<SkillDiscoverResponse>(`${workerBase}/api/skills/discover?${queryStr}`),
  ]);

  // Collect warnings for failed discovery calls
  const warnings: string[] = [];

  // Build provenance maps, preserving manual entries from existing capabilities
  const existingCaps = machine.capabilities ?? {};
  const existingMcpSources: Record<string, 'discovered' | 'manual'> =
    (existingCaps.mcpServerSources as Record<string, 'discovered' | 'manual'> | undefined) ?? {};
  const existingSkillSources: Record<string, 'discovered' | 'manual'> =
    (existingCaps.skillSources as Record<string, 'discovered' | 'manual'> | undefined) ?? {};

  // Start with manual entries preserved
  const mcpServerSources: Record<string, 'discovered' | 'manual'> = {};
  const skillSources: Record<string, 'discovered' | 'manual'> = {};

  // Preserve manual entries
  for (const [key, value] of Object.entries(existingMcpSources)) {
    if (value === 'manual') {
      mcpServerSources[key] = 'manual';
    }
  }
  for (const [key, value] of Object.entries(existingSkillSources)) {
    if (value === 'manual') {
      skillSources[key] = 'manual';
    }
  }

  // Add discovered MCP servers
  if (mcpResult.ok) {
    for (const server of mcpResult.data.discovered) {
      if (server.name && !mcpServerSources[server.name]) {
        mcpServerSources[server.name] = 'discovered';
      }
    }
  } else {
    warnings.push(`MCP discovery failed: ${mcpResult.error}`);
  }

  // Add discovered skills
  if (skillResult.ok) {
    for (const skill of skillResult.data.discovered) {
      if (skill.id && !skillSources[skill.id]) {
        skillSources[skill.id] = 'discovered';
      }
    }
  } else {
    warnings.push(`Skill discovery failed: ${skillResult.error}`);
  }

  const lastDiscoveredAt = new Date().toISOString();

  // Update machine capabilities via heartbeat (which accepts capabilities)
  const updatedCapabilities = {
    ...existingCaps,
    mcpServerSources,
    skillSources,
    lastDiscoveredAt,
  };

  try {
    await dbRegistry.heartbeat(machine.id, updatedCapabilities);
  } catch {
    // heartbeat might fail if machine was removed between checks — non-fatal
    warnings.push('Failed to persist updated capabilities');
  }

  return {
    machineId: machine.id,
    runtime,
    mcpServerSources,
    skillSources,
    lastDiscoveredAt,
    mcpDiscovered: mcpResult.ok ? mcpResult.data.discovered.length : 0,
    skillsDiscovered: skillResult.ok ? skillResult.data.discovered.length : 0,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const machineCapabilitiesRoutes: FastifyPluginAsync<
  MachineCapabilitiesRoutesOptions
> = async (app, opts) => {
  const { dbRegistry, workerPort = 9000 } = opts;

  // POST /api/machines/:machineId/sync-capabilities
  app.post<{
    Params: { machineId: string };
    Body: SyncCapabilitiesBody;
  }>(
    '/:machineId/sync-capabilities',
    {
      schema: {
        tags: ['machines'],
        summary: 'Sync machine capabilities via discovery',
        description:
          'Runs MCP server and skill discovery on the target machine, then updates the machine capabilities record with provenance information.',
      },
    },
    async (request, reply) => {
      const { machineId } = request.params;
      const body = request.body ?? {};
      const runtime = body.runtime ?? 'claude-code';
      const { projectPath } = body;

      if (!dbRegistry) {
        return reply.code(503).send({
          error: 'REGISTRY_UNAVAILABLE',
          message: 'Database registry is not configured',
        });
      }

      if (!isManagedRuntime(runtime)) {
        return reply.code(400).send({
          error: 'INVALID_RUNTIME',
          message: `Invalid runtime: ${runtime}. Must be one of: ${MANAGED_RUNTIMES.join(', ')}`,
        });
      }

      // Fetch machine to verify existence and get address
      const machine = await dbRegistry.getMachine(machineId);

      if (!machine) {
        return reply.code(404).send({
          error: 'MACHINE_NOT_FOUND',
          message: `Machine '${machineId}' is not registered`,
        });
      }

      if (machine.status === 'offline') {
        return reply.code(503).send({
          error: 'MACHINE_OFFLINE',
          message: `Machine '${machineId}' (${machine.hostname}) is offline`,
        });
      }

      const result = await syncMachineCapabilities({
        machine,
        dbRegistry,
        workerPort,
        runtime,
        projectPath,
      });

      return reply.send(result);
    },
  );
};
