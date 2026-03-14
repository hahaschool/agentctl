/**
 * Temporary type stubs for types being added by Chunk 1 (shared types PR).
 *
 * Once Chunk 1 merges and adds `configFile` to `DiscoveredMcpServer` and
 * the new `DiscoveredSkill` type to `@agentctl/shared`, replace all imports
 * of this file with imports from `@agentctl/shared`.
 */
import type { McpServerConfig, McpServerSource } from '@agentctl/shared';

/**
 * Extended DiscoveredMcpServer with `configFile` provenance field.
 * TODO: Remove once Chunk 1 adds `configFile` to the shared type.
 */
export type DiscoveredMcpServerWithProvenance = {
  name: string;
  config: McpServerConfig;
  source: McpServerSource;
  description?: string;
  configFile?: string;
};

/**
 * A skill discovered from SKILL.md frontmatter on disk.
 * TODO: Remove once Chunk 1 adds `DiscoveredSkill` to `@agentctl/shared`.
 */
export type DiscoveredSkill = {
  id: string;
  name: string;
  description: string;
  path: string;
  source: 'global' | 'project';
  runtime: 'claude-code' | 'codex';
  userInvokable?: boolean;
  args?: string;
};
