import type { ManagedRuntimeConfig } from '@agentctl/shared';

import {
  type RenderedRuntimeConfig,
  renderManagedInstructions,
  renderSkillsManifest,
} from './shared-rendering.js';

export class CodexConfigRenderer {
  render(config: ManagedRuntimeConfig): RenderedRuntimeConfig {
    const configToml = renderConfigToml(config);

    return {
      runtime: 'codex',
      files: [
        {
          scope: 'home',
          path: '.codex/config.toml',
          content: configToml,
        },
        {
          scope: 'workspace',
          path: '.codex/config.toml',
          content: configToml,
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
  const codexOverrides = (config.runtimeOverrides.codex ?? {}) as Record<string, unknown>;
  const lines = [
    '# Managed by AgentCTL',
    `model = ${quoteToml(String(codexOverrides.model ?? 'gpt-5-codex'))}`,
    `approval_policy = ${quoteToml(config.approvalPolicy)}`,
    `sandbox_mode = ${quoteToml(config.sandbox)}`,
  ];

  const modelProvider =
    typeof codexOverrides.modelProvider === 'string' && codexOverrides.modelProvider.length > 0
      ? codexOverrides.modelProvider
      : null;
  if (modelProvider) {
    lines.push(`model_provider = ${quoteToml(modelProvider)}`);
  }

  const reasoningEffort =
    typeof codexOverrides.reasoningEffort === 'string' && codexOverrides.reasoningEffort.length > 0
      ? codexOverrides.reasoningEffort
      : null;
  if (reasoningEffort) {
    lines.push(`model_reasoning_effort = ${quoteToml(reasoningEffort)}`);
  }

  renderShellEnvironmentPolicy(lines, config);
  lines.push('');

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

function renderShellEnvironmentPolicy(lines: string[], config: ManagedRuntimeConfig): void {
  lines.push('[shell_environment_policy]');
  lines.push(
    `inherit = [${config.environmentPolicy.inherit.map((value) => quoteToml(value)).join(', ')}]`,
  );

  lines.push('[shell_environment_policy.set]');
  for (const [key, value] of Object.entries(config.environmentPolicy.set)) {
    lines.push(`${key} = ${quoteToml(value)}`);
  }
}

function quoteToml(value: string): string {
  return JSON.stringify(value);
}
