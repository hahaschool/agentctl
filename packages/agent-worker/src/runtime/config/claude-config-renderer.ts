import type { AgentRuntimeConfigOverrides, ManagedRuntimeConfig } from '@agentctl/shared';

import {
  hasManagedInstructions,
  type RenderedRuntimeConfig,
  renderManagedInstructions,
  renderMcpServerMapFromServers,
  renderSkillsManifest,
} from './shared-rendering.js';

type ClaudeMcpServerSource = 'global' | 'project' | 'custom' | 'machine' | 'template';

type ClaudeMcpServerWithSource = {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  source?: ClaudeMcpServerSource;
};

export class ClaudeConfigRenderer {
  render(
    baseConfig: ManagedRuntimeConfig,
    overrides?: AgentRuntimeConfigOverrides,
  ): RenderedRuntimeConfig {
    const config = applyClaudeOverrides(baseConfig, overrides);
    const settings = {
      managedBy: 'agentctl',
      configVersion: config.version,
      configHash: config.hash,
      sandbox: config.sandbox,
      approvalPolicy: config.approvalPolicy,
      model: config.runtimeOverrides.claudeCode?.model ?? null,
      environmentPolicy: config.environmentPolicy,
    };

    const mcpServers = config.mcpServers as ClaudeMcpServerWithSource[];
    const hasSplitSources = mcpServers.some(
      (server) =>
        server.source === 'global' ||
        server.source === 'project' ||
        server.source === 'custom' ||
        server.source === 'machine' ||
        server.source === 'template',
    );

    const homeMcpServers = hasSplitSources
      ? mcpServers.filter((server) => server.source === 'global')
      : mcpServers;

    const workspaceMcpServers = hasSplitSources
      ? mcpServers.filter((server) => server.source !== 'global')
      : mcpServers;

    const homeMcpPayload = {
      mcpServers: renderMcpServerMapFromServers(homeMcpServers),
    };

    const workspaceMcpPayload = {
      mcpServers: renderMcpServerMapFromServers(workspaceMcpServers),
    };

    const files: RenderedRuntimeConfig['files'] = [
      {
        scope: 'home',
        path: '.claude/settings.json',
        content: JSON.stringify(settings, null, 2),
      },
      {
        scope: 'home',
        path: '.claude.json',
        content: JSON.stringify(homeMcpPayload, null, 2),
      },
      {
        scope: 'workspace',
        path: '.mcp.json',
        content: JSON.stringify(workspaceMcpPayload, null, 2),
      },
    ];

    if (hasManagedInstructions(config)) {
      files.push({
        scope: 'workspace',
        path: 'CLAUDE.md',
        content: renderManagedInstructions('Claude Code', config),
      });
    }

    files.push({
      scope: 'workspace',
      path: '.claude/skills/agentctl-managed-skills.json',
      content: renderSkillsManifest(config),
    });

    return {
      runtime: 'claude-code',
      files,
    };
  }
}

function applyClaudeOverrides(
  config: ManagedRuntimeConfig,
  overrides?: AgentRuntimeConfigOverrides,
): ManagedRuntimeConfig {
  if (!overrides) return config;
  return {
    ...config,
    ...(overrides.sandbox ? { sandbox: overrides.sandbox } : {}),
    ...(overrides.approvalPolicy ? { approvalPolicy: overrides.approvalPolicy } : {}),
  };
}
