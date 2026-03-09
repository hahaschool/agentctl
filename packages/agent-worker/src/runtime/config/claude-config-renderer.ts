import type { ManagedRuntimeConfig } from '@agentctl/shared';

import {
  renderManagedInstructions,
  renderMcpServerMap,
  renderSkillsManifest,
  type RenderedRuntimeConfig,
} from './shared-rendering.js';

export class ClaudeConfigRenderer {
  render(config: ManagedRuntimeConfig): RenderedRuntimeConfig {
    const settings = {
      managedBy: 'agentctl',
      configVersion: config.version,
      configHash: config.hash,
      sandbox: config.sandbox,
      approvalPolicy: config.approvalPolicy,
      model: config.runtimeOverrides.claudeCode?.model ?? null,
      environmentPolicy: config.environmentPolicy,
    };

    const mcpPayload = {
      mcpServers: renderMcpServerMap(config),
    };

    return {
      runtime: 'claude-code',
      files: [
        {
          scope: 'home',
          path: '.claude/settings.json',
          content: JSON.stringify(settings, null, 2),
        },
        {
          scope: 'home',
          path: '.claude.json',
          content: JSON.stringify(mcpPayload, null, 2),
        },
        {
          scope: 'workspace',
          path: '.mcp.json',
          content: JSON.stringify(mcpPayload, null, 2),
        },
        {
          scope: 'workspace',
          path: 'CLAUDE.md',
          content: renderManagedInstructions('Claude Code', config),
        },
        {
          scope: 'workspace',
          path: '.claude/skills/agentctl-managed-skills.json',
          content: renderSkillsManifest(config),
        },
      ],
    };
  }
}
