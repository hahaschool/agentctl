import { isManagedRuntime, MANAGED_RUNTIMES } from '@agentctl/shared';
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
    let discoveredMcp: Array<{ name: string; config: Record<string, unknown> }> = [];
    try {
      const [res1, res2] = await Promise.all([
        fetch(`${workerResult.url}/api/mcp/discover?runtime=claude-code`, { signal: AbortSignal.timeout(5_000) }).then((r) => r.ok ? r.json() : { discovered: [] }),
        fetch(`${workerResult.url}/api/mcp/discover?runtime=codex`, { signal: AbortSignal.timeout(5_000) }).then((r) => r.ok ? r.json() : { discovered: [] }),
      ]);
      const primary = (res1 as any).discovered ?? [];
      const secondary = ((res2 as any).discovered ?? []).filter(
        (s: any) => !primary.some((p: any) => p.name === s.name),
      );
      discoveredMcp = [...primary, ...secondary];
    } catch {
      // Discovery failed — preview will show empty MCP (acceptable degradation)
    }

    // Resolve effective MCP: discovery defaults - excluded + custom
    const mcpOverride = agent.config?.mcpOverride as
      | { excluded?: string[]; custom?: Array<Record<string, unknown>> }
      | undefined;
    const excludedSet = new Set(mcpOverride?.excluded ?? []);
    const effectiveMcpServers = discoveredMcp
      .filter((s) => !excludedSet.has(s.name))
      .map((s) => ({
        id: s.name,
        name: s.name,
        command: (s.config as any)?.command ?? '',
        args: (s.config as any)?.args ?? [],
        env: (s.config as any)?.env ?? {},
      }));
    for (const custom of mcpOverride?.custom ?? []) {
      const c = custom as Record<string, unknown>;
      effectiveMcpServers.push({
        id: String(c.name ?? ''),
        name: String(c.name ?? ''),
        command: String(c.command ?? ''),
        args: (c.args as string[]) ?? [],
        env: (c.env as Record<string, string>) ?? {},
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
