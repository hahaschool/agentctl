import type { ManagedRuntimeConfig } from '@agentctl/shared';

import {
  renderManagedInstructions,
  renderSkillsManifest,
  type RenderedRuntimeConfig,
} from './shared-rendering.js';

export class CodexConfigRenderer {
  render(config: ManagedRuntimeConfig): RenderedRuntimeConfig {
    return {
      runtime: 'codex',
      files: [
        {
          scope: 'home',
          path: '.codex/config.toml',
          content: renderConfigToml(config),
        },
        {
          scope: 'home',
          path: '.codex/AGENTS.md',
          content: renderManagedInstructions('Codex', config),
        },
        {
          scope: 'workspace',
          path: 'AGENTS.md',
          content: renderManagedInstructions('Codex', config),
        },
        {
          scope: 'workspace',
          path: '.agents/skills/agentctl-managed-skills.json',
          content: renderSkillsManifest(config),
        },
      ],
    };
  }
}

function renderConfigToml(config: ManagedRuntimeConfig): string {
  const lines = [
    '# Managed by AgentCTL',
    `model = ${quoteToml(String(config.runtimeOverrides.codex?.model ?? 'gpt-5-codex'))}`,
    `approval_policy = ${quoteToml(config.approvalPolicy)}`,
    `sandbox_mode = ${quoteToml(config.sandbox)}`,
    '',
  ];

  for (const server of config.mcpServers) {
    lines.push(`[mcp_servers.${server.name}]`);
    lines.push(`command = ${quoteToml(server.command)}`);
    lines.push(`args = [${server.args.map((arg) => quoteToml(arg)).join(', ')}]`);
    if (Object.keys(server.env).length > 0) {
      lines.push(`[mcp_servers.${server.name}.env]`);
      for (const [key, value] of Object.entries(server.env)) {
        lines.push(`${key} = ${quoteToml(value)}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function quoteToml(value: string): string {
  return JSON.stringify(value);
}
