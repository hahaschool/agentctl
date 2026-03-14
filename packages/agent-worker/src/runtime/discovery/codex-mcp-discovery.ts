import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse } from 'smol-toml';

import type { McpServerSource } from '@agentctl/shared';

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
  const configPath = join(basePath, '.codex', 'config.toml');

  try {
    await access(configPath);
  } catch {
    return [];
  }

  try {
    const content = await readFile(configPath, 'utf-8');
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
