import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { DiscoveredMcpServer, McpServerConfig, McpServerSource } from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type McpDiscoverRouteOptions = FastifyPluginOptions & {
  logger: Logger;
};

type DiscoverQuerystring = {
  projectPath?: string;
};

type DiscoverResult = {
  discovered: DiscoveredMcpServer[];
  sources: Array<{ path: string; count: number }>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely read and parse a JSON file. Returns null on any error. */
async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Extract MCP servers from a parsed config object.
 *
 * Supports two shapes:
 *   1. `{ mcpServers: { ... } }` (`.mcp.json`, `.claude/settings.json`)
 *   2. Top-level `{ name: { command, args, env } }` (some `.mcp.json` files)
 */
function extractMcpServers(
  data: unknown,
  source: McpServerSource,
  filePath: string,
): DiscoveredMcpServer[] {
  if (!data || typeof data !== 'object') return [];

  const record = data as Record<string, unknown>;

  // Shape 1: nested under `mcpServers`
  const mcpBlock = record.mcpServers;
  if (mcpBlock && typeof mcpBlock === 'object') {
    return objectToDiscoveredServers(mcpBlock as Record<string, unknown>, source, filePath);
  }

  // Shape 2: top-level keys with `command` field
  const results: DiscoveredMcpServer[] = [];
  for (const [name, value] of Object.entries(record)) {
    if (value && typeof value === 'object' && 'command' in value) {
      const cfg = value as McpServerConfig;
      results.push({
        name,
        config: {
          command: cfg.command,
          ...(cfg.args ? { args: cfg.args } : {}),
          ...(cfg.env ? { env: cfg.env } : {}),
        },
        source,
        description: `From ${filePath}`,
      });
    }
  }

  return results;
}

function objectToDiscoveredServers(
  obj: Record<string, unknown>,
  source: McpServerSource,
  filePath: string,
): DiscoveredMcpServer[] {
  const results: DiscoveredMcpServer[] = [];

  for (const [name, value] of Object.entries(obj)) {
    if (!value || typeof value !== 'object') continue;

    const cfg = value as McpServerConfig;
    if (!cfg.command || typeof cfg.command !== 'string') continue;

    results.push({
      name,
      config: {
        command: cfg.command,
        ...(cfg.args ? { args: cfg.args } : {}),
        ...(cfg.env ? { env: cfg.env } : {}),
      },
      source,
      description: `From ${filePath}`,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Core discovery function (exported for use in heartbeat)
// ---------------------------------------------------------------------------

/**
 * Discover MCP servers from the global Claude configuration.
 * Scans `~/.claude.json` and `~/.claude/settings.json`.
 */
export async function discoverGlobalMcpServers(): Promise<DiscoveredMcpServer[]> {
  const home = homedir();
  const globalPaths = [join(home, '.claude.json'), join(home, '.claude', 'settings.json')];

  const results: DiscoveredMcpServer[] = [];

  for (const filePath of globalPaths) {
    const data = await readJsonFile(filePath);
    if (data) {
      results.push(...extractMcpServers(data, 'global', filePath));
    }
  }

  return results;
}

/**
 * Discover MCP servers from a project directory.
 * Scans `<projectPath>/.mcp.json` and `<projectPath>/.claude/settings.json`.
 */
export async function discoverProjectMcpServers(
  projectPath: string,
): Promise<DiscoveredMcpServer[]> {
  const projectPaths = [
    join(projectPath, '.mcp.json'),
    join(projectPath, '.claude', 'settings.json'),
  ];

  const results: DiscoveredMcpServer[] = [];

  for (const filePath of projectPaths) {
    const data = await readJsonFile(filePath);
    if (data) {
      results.push(...extractMcpServers(data, 'project', filePath));
    }
  }

  return results;
}

/**
 * Discover all MCP servers from a project + global configs.
 * Deduplicates by name (project-level takes priority over global).
 */
export async function discoverAllMcpServers(projectPath?: string): Promise<DiscoveredMcpServer[]> {
  const [projectServers, globalServers] = await Promise.all([
    projectPath ? discoverProjectMcpServers(projectPath) : Promise.resolve([]),
    discoverGlobalMcpServers(),
  ]);

  // Deduplicate: project-level entries win over global
  const seen = new Set<string>();
  const results: DiscoveredMcpServer[] = [];

  for (const server of projectServers) {
    if (!seen.has(server.name)) {
      seen.add(server.name);
      results.push(server);
    }
  }

  for (const server of globalServers) {
    if (!seen.has(server.name)) {
      seen.add(server.name);
      results.push(server);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function mcpDiscoverRoutes(
  app: FastifyInstance,
  options: McpDiscoverRouteOptions,
): Promise<void> {
  const { logger } = options;

  // GET /api/mcp/discover?projectPath=...
  app.get<{ Querystring: DiscoverQuerystring }>('/discover', async (request, reply) => {
    const { projectPath } = request.query;

    try {
      const discovered = await discoverAllMcpServers(projectPath);

      // Build source summary
      const sourceMap = new Map<string, number>();
      for (const server of discovered) {
        const key = server.description ?? server.source;
        sourceMap.set(key, (sourceMap.get(key) ?? 0) + 1);
      }

      const sources = Array.from(sourceMap.entries()).map(([path, count]) => ({
        path,
        count,
      }));

      const result: DiscoverResult = { discovered, sources };

      logger.info(
        { projectPath, discoveredCount: discovered.length },
        'MCP server discovery completed',
      );

      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, projectPath }, 'MCP discovery failed');
      return reply.status(500).send({
        error: 'MCP_DISCOVER_FAILED',
        message: `Failed to discover MCP servers: ${message}`,
      });
    }
  });
}
