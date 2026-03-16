import type {
  AgentConfig,
  AgentRuntimeConfigOverrides,
  ManagedRuntimeConfig,
} from '@agentctl/shared';
import { resolveInstructionContent } from './instructions-strategy.js';
import {
  type RenderedRuntimeConfig,
  renderManagedInstructions,
  renderSkillsManifest,
} from './shared-rendering.js';

export class CodexConfigRenderer {
  render(
    baseConfig: ManagedRuntimeConfig,
    overrides?: AgentRuntimeConfigOverrides,
    options: {
      instructionsStrategy?: AgentConfig['instructionsStrategy'];
      projectPath?: string | null;
    } = {},
  ): RenderedRuntimeConfig {
    const config = applyCodexOverrides(baseConfig, overrides);
    const configToml = renderConfigToml(config);
    const managedInstructions = renderManagedInstructions('Codex', config);
    const workspaceAgentsContent = resolveInstructionContent({
      instructionsStrategy: options.instructionsStrategy,
      projectPath: options.projectPath,
      fileName: 'AGENTS.md',
      managedContent: managedInstructions,
    });
    const homeAgentsContent = resolveInstructionContent({
      instructionsStrategy: options.instructionsStrategy,
      projectPath: undefined,
      fileName: 'AGENTS.md',
      managedContent: managedInstructions,
    });

    const files: RenderedRuntimeConfig['files'] = [
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
    ];

    if (homeAgentsContent) {
      files.push({
        scope: 'home',
        path: '.codex/AGENTS.md',
        content: homeAgentsContent,
      });
    }

    if (workspaceAgentsContent) {
      files.push({
        scope: 'workspace',
        path: 'AGENTS.md',
        content: workspaceAgentsContent,
      });
    }

    files.push({
      scope: 'workspace',
      path: '.agents/skills/agentctl-managed-skills.json',
      content: renderSkillsManifest(config),
    });

    return {
      runtime: 'codex',
      files,
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

function applyCodexOverrides(
  config: ManagedRuntimeConfig,
  overrides?: AgentRuntimeConfigOverrides,
): ManagedRuntimeConfig {
  if (!overrides) return config;

  let result = {
    ...config,
    ...(overrides.sandbox ? { sandbox: overrides.sandbox } : {}),
    ...(overrides.approvalPolicy ? { approvalPolicy: overrides.approvalPolicy } : {}),
  };

  if (overrides.codexReasoningEffort || overrides.codexModelProvider) {
    result = {
      ...result,
      runtimeOverrides: {
        ...result.runtimeOverrides,
        codex: {
          ...result.runtimeOverrides.codex,
          ...(overrides.codexReasoningEffort
            ? { reasoningEffort: overrides.codexReasoningEffort }
            : {}),
          ...(overrides.codexModelProvider ? { modelProvider: overrides.codexModelProvider } : {}),
        },
      },
    };
  }

  return result;
}
