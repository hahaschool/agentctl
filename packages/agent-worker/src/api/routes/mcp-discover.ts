import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import type { DiscoveredMcpServer, McpServerConfig, McpServerSource } from '@agentctl/shared';
import { isManagedRuntime, MANAGED_RUNTIMES } from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';

import type { DiscoveredMcpServerWithProvenance } from '../../runtime/discovery/_type-stubs.js';
import { discoverCodexMcpServers } from '../../runtime/discovery/codex-mcp-discovery.js';
import { DiscoveryCache } from '../../runtime/discovery/discovery-cache.js';
import { DEFAULT_DENIED_PATH_SEGMENTS, findDeniedPathSegment } from '../../utils/path-security.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type McpDiscoverRouteOptions = FastifyPluginOptions & {
  logger: Logger;
};

type DiscoverQuerystring = {
  projectPath?: string;
  runtime?: string;
};

type DiscoverResult = {
  discovered: (DiscoveredMcpServer | DiscoveredMcpServerWithProvenance)[];
  sources: Array<{ path: string; count: number }>;
  cached: boolean;
};

// ---------------------------------------------------------------------------
// Cache (exported so sync-capabilities can call invalidateAll())
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;

export const mcpDiscoverCache = new DiscoveryCache<
  (DiscoveredMcpServer | DiscoveredMcpServerWithProvenance)[]
>(CACHE_TTL_MS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely read and parse a JSON file. Returns null on any error.
 * Security: validates that the resolved path stays under the given base
 * directory to prevent path traversal (js/path-injection).
 */
async function readJsonFile(filePath: string, allowedBase: string): Promise<unknown | null> {
  const resolvedBase = resolve(allowedBase);
  const resolvedPath = resolve(filePath);
  const prefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
  if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(prefix)) {
    return null; // Path escapes base — treat as missing
  }
  try {
    const raw = await readFile(resolvedPath, 'utf-8');
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

function parseProjectPath(
  raw: unknown,
): { ok: true; path: string } | { ok: false; message: string } {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, message: 'projectPath must be a non-empty string when provided' };
  }

  const candidate = raw.trim();

  if (!candidate.startsWith('/')) {
    return { ok: false, message: 'projectPath must be an absolute path' };
  }

  if (candidate.split('/').includes('..')) {
    return { ok: false, message: 'projectPath cannot contain path traversal segments' };
  }

  const resolved = resolve(candidate);
  const deniedSegment = findDeniedPathSegment(resolved, DEFAULT_DENIED_PATH_SEGMENTS);
  if (deniedSegment) {
    return {
      ok: false,
      message: `projectPath cannot include denied segment "${deniedSegment}"`,
    };
  }

  return { ok: true, path: resolved };
}

// ---------------------------------------------------------------------------
// Core discovery functions (exported for use in heartbeat)
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
    const data = await readJsonFile(filePath, home);
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
  const parsedProjectPath = parseProjectPath(projectPath);
  if (!parsedProjectPath.ok) {
    return [];
  }
  const resolvedProject = parsedProjectPath.path;
  const projectPaths = [
    join(resolvedProject, '.mcp.json'),
    join(resolvedProject, '.claude', 'settings.json'),
  ];

  const results: DiscoveredMcpServer[] = [];

  for (const filePath of projectPaths) {
    const data = await readJsonFile(filePath, resolvedProject);
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
// Codex discovery aggregator
// ---------------------------------------------------------------------------

/**
 * Discover MCP servers for the Codex runtime.
 * Scans global (~/) and project-scoped .codex/config.toml files.
 */
async function discoverAllCodexMcpServers(
  projectPath?: string,
): Promise<DiscoveredMcpServerWithProvenance[]> {
  const home = homedir();
  const parsedProjectPath = projectPath === undefined ? undefined : parseProjectPath(projectPath);
  const safeProjectPath = parsedProjectPath?.ok ? parsedProjectPath.path : undefined;
  const [globalServers, projectServers] = await Promise.all([
    discoverCodexMcpServers(home, 'global'),
    safeProjectPath ? discoverCodexMcpServers(safeProjectPath, 'project') : Promise.resolve([]),
  ]);

  // Deduplicate: project-level entries win over global
  const seen = new Set<string>();
  const results: DiscoveredMcpServerWithProvenance[] = [];

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

  // GET /api/mcp/discover?projectPath=...&runtime=...
  app.get<{ Querystring: DiscoverQuerystring }>('/discover', async (request, reply) => {
    const { projectPath } = request.query;
    const runtime = request.query.runtime ?? 'claude-code';
    let safeProjectPath: string | undefined;

    // Validate runtime
    if (!isManagedRuntime(runtime)) {
      return reply.status(400).send({
        error: 'INVALID_RUNTIME',
        message: `Invalid runtime: ${runtime}. Must be one of: ${MANAGED_RUNTIMES.join(', ')}`,
      });
    }

    if (projectPath !== undefined) {
      const parsed = parseProjectPath(projectPath);
      if (!parsed.ok) {
        return reply.status(400).send({
          error: 'INVALID_PATH',
          message: parsed.message,
        });
      }
      safeProjectPath = parsed.path;
    }

    const cacheKey = `mcp:${runtime}:${safeProjectPath ?? 'global'}`;

    // Check cache
    const cached = mcpDiscoverCache.get(cacheKey);
    if (cached) {
      const sourceMap = new Map<string, number>();
      for (const server of cached) {
        const key = server.description ?? server.source;
        sourceMap.set(key, (sourceMap.get(key) ?? 0) + 1);
      }
      const sources = Array.from(sourceMap.entries()).map(([path, count]) => ({
        path,
        count,
      }));
      return reply.send({ discovered: cached, sources, cached: true } satisfies DiscoverResult);
    }

    try {
      const discovered =
        runtime === 'codex'
          ? await discoverAllCodexMcpServers(safeProjectPath)
          : await discoverAllMcpServers(safeProjectPath);

      // Store in cache
      mcpDiscoverCache.set(cacheKey, discovered);

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

      const result: DiscoverResult = { discovered, sources, cached: false };

      logger.info(
        { projectPath: safeProjectPath, runtime, discoveredCount: discovered.length },
        'MCP server discovery completed',
      );

      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, projectPath: safeProjectPath, runtime }, 'MCP discovery failed');
      return reply.status(500).send({
        error: 'MCP_DISCOVER_FAILED',
        message: `Failed to discover MCP servers: ${message}`,
      });
    }
  });
}
