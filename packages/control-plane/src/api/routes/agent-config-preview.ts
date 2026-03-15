import { type DiscoveredMcpServer, isManagedRuntime, MANAGED_RUNTIMES } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { resolveWorkerUrl } from '../resolve-worker-url.js';

// ---------------------------------------------------------------------------
// Route options
// ---------------------------------------------------------------------------

export type AgentConfigPreviewRoutesOptions = {
  dbRegistry?: DbAgentRegistry;
  workerPort?: number;
};

type DiscoverMcpResponse = {
  discovered?: DiscoveredMcpServer[];
};

const fetchDiscoveredMcp = async (
  workerUrl: string,
  runtime: 'claude-code' | 'codex',
): Promise<DiscoveredMcpServer[]> => {
  const response = await fetch(`${workerUrl}/api/mcp/discover?runtime=${runtime}`, {
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as DiscoverMcpResponse;
  return data.discovered ?? [];
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const agentConfigPreviewRoutes: FastifyPluginAsync<AgentConfigPreviewRoutesOptions> = async (
  app,
  opts,
) => {
  const { dbRegistry, workerPort = 9000 } = opts;

  /**
   * GET /api/agents/:id/config-preview
   *
   * Looks up the agent from the database, resolves its worker, and proxies
   * the config preview request. Returns the rendered config files.
   */
  app.get<{
    Params: { id: string };
  }>('/:id/config-preview', async (request, reply) => {
    const { id } = request.params;

    if (!dbRegistry) {
      return reply.code(503).send({
        error: 'REGISTRY_UNAVAILABLE',
        message: 'Database registry is not configured',
      });
    }

    const agent = await dbRegistry.getAgent(id);

    if (!agent) {
      return reply.code(404).send({
        error: 'AGENT_NOT_FOUND',
        message: `Agent '${id}' not found`,
      });
    }

    const runtime = agent.runtime ?? 'claude-code';

    if (!isManagedRuntime(runtime)) {
      return reply.code(400).send({
        error: 'INVALID_RUNTIME',
        message: `Agent runtime "${runtime}" is not managed. Must be one of: ${MANAGED_RUNTIMES.join(', ')}`,
      });
    }

    const workerResult = await resolveWorkerUrl(
      id,
      { machineId: agent.machineId },
      {
        dbRegistry,
        workerPort,
      },
    );

    if (!workerResult.ok) {
      return reply
        .code(workerResult.status)
        .send({ error: workerResult.error, message: workerResult.message });
    }

    // Fetch discovered MCP servers from worker — query BOTH runtimes and merge
    let discoveredMcp: DiscoveredMcpServer[] = [];
    try {
      const [primary, secondaryCandidates] = await Promise.all([
        fetchDiscoveredMcp(workerResult.url, 'claude-code'),
        fetchDiscoveredMcp(workerResult.url, 'codex'),
      ]);

      const secondary = secondaryCandidates.filter(
        (server) => !primary.some((existing) => existing.name === server.name),
      );

      discoveredMcp = [...primary, ...secondary];
    } catch {
      // Discovery failed — preview will show empty MCP (acceptable degradation)
    }

    // Resolve effective MCP: discovery defaults - excluded + custom
    const mcpOverride = agent.config?.mcpOverride;
    const excludedSet = new Set(mcpOverride?.excluded ?? []);
    const effectiveMcpServers = discoveredMcp
      .filter((server) => !excludedSet.has(server.name))
      .map((server) => ({
        id: server.name,
        name: server.name,
        command: server.config.command,
        args: server.config.args ?? [],
        env: server.config.env ?? {},
      }));

    for (const custom of mcpOverride?.custom ?? []) {
      effectiveMcpServers.push({
        id: custom.name,
        name: custom.name,
        command: custom.command,
        args: custom.args ?? [],
        env: custom.env ?? {},
      });
    }

    // Pass only mcpServers — the worker's buildDefaultPreviewConfig() handles the rest
    // We pass it as a partial config that gets merged with defaults on the worker side
    const previewConfig: Record<string, unknown> = {
      mcpServers: effectiveMcpServers,
      skills: [],
      instructions: { userGlobal: '', projectTemplate: '' },
      sandbox: 'workspace-write',
      approvalPolicy: 'on-failure',
      environmentPolicy: { inherit: ['HOME', 'PATH', 'SHELL'], set: {} },
      runtimeOverrides: { claudeCode: {}, codex: {} },
    };

    // Build query string for worker preview endpoint
    const qs = new URLSearchParams({ runtime });
    qs.set('configJson', JSON.stringify(previewConfig));

    const overrides = agent.config?.runtimeConfigOverrides;
    if (overrides && Object.keys(overrides).length > 0) {
      qs.set('overridesJson', JSON.stringify(overrides));
    }

    const workerUrl = `${workerResult.url}/api/config/preview?${qs.toString()}`;

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
        message: `Failed to reach worker for config preview: ${message}`,
      });
    }
  });
};
