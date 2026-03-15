import { join, normalize, resolve } from 'node:path';
import type { McpServerSource } from '@agentctl/shared';
import { parse } from 'smol-toml';
import {
  DEFAULT_DENIED_PATH_SEGMENTS,
  findDeniedPathSegment,
  safeReadFileAtomic,
  sanitizePath,
} from '../../utils/path-security.js';

import type { DiscoveredMcpServerWithProvenance } from './_type-stubs.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CodexTomlMcpEntry = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

type CodexTomlConfig = {
  mcp_servers?: Record<string, CodexTomlMcpEntry>;
};

const MAX_CODEX_CONFIG_FILE_SIZE_BYTES = 1024 * 1024;

function resolveCodexConfigPath(
  basePath: string,
): { configPath: string; resolvedBase: string } | null {
  if (typeof basePath !== 'string' || basePath.trim().length === 0) {
    return null;
  }

  const resolvedBase = resolve(normalize(basePath));
  const deniedSegment = findDeniedPathSegment(resolvedBase, DEFAULT_DENIED_PATH_SEGMENTS);
  if (deniedSegment) {
    return null;
  }

  try {
    return {
      configPath: sanitizePath(join(resolvedBase, '.codex', 'config.toml'), resolvedBase),
      resolvedBase,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Discover MCP servers from a Codex `.codex/config.toml` file.
 *
 * Parses the `[mcp_servers]` TOML table and maps each entry to a
 * `DiscoveredMcpServerWithProvenance`. Returns an empty array when the
 * config file is missing, unreadable, or malformed.
 */
export async function discoverCodexMcpServers(
  basePath: string,
  sourceType: McpServerSource = 'global',
): Promise<DiscoveredMcpServerWithProvenance[]> {
  const configLocation = resolveCodexConfigPath(basePath);
  if (!configLocation) {
    return [];
  }

  const { configPath, resolvedBase } = configLocation;

  try {
    const { content } = safeReadFileAtomic(
      configPath,
      resolvedBase,
      MAX_CODEX_CONFIG_FILE_SIZE_BYTES,
    );
    const parsed = parse(content) as CodexTomlConfig;

    if (!parsed.mcp_servers) {
      return [];
    }

    return Object.entries(parsed.mcp_servers).map(([name, server]) => ({
      name,
      config: {
        command: server.command,
        args: server.args ?? [],
        env: server.env ?? {},
      },
      source: sourceType,
      configFile: configPath,
    }));
  } catch {
    return [];
  }
}
