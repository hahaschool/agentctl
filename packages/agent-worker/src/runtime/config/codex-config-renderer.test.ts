import type { ManagedRuntimeConfig } from '@agentctl/shared';
import { describe, expect, it } from 'vitest';

import { CodexConfigRenderer } from './codex-config-renderer.js';

function makeConfig(overrides: Partial<ManagedRuntimeConfig> = {}): ManagedRuntimeConfig {
  return {
    version: 5,
    hash: 'sha256:cfg-5',
    instructions: {
      userGlobal: 'Global runtime guidance',
      projectTemplate: 'Project runtime guidance',
    },
    mcpServers: [
      {
        id: 'filesystem',
        name: 'filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: { ROOT: '/workspace' },
      },
    ],
    skills: [
      { id: 'systematic-debugging', path: '/skills/systematic-debugging/SKILL.md', enabled: true },
    ],
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    environmentPolicy: {
      inherit: ['PATH'],
      set: { NODE_ENV: 'development' },
    },
    runtimeOverrides: {
      claudeCode: { model: 'sonnet' },
      codex: { model: 'gpt-5-codex' },
    },
    ...overrides,
  };
}

describe('CodexConfigRenderer', () => {
  it('renders Codex config, instructions, and skills manifest files', () => {
    const renderer = new CodexConfigRenderer();
    const rendered = renderer.render(makeConfig());

    expect(rendered.runtime).toBe('codex');
    expect(rendered.files).toContainEqual(
      expect.objectContaining({ scope: 'home', path: '.codex/config.toml' }),
    );
    expect(rendered.files).toContainEqual(
      expect.objectContaining({ scope: 'home', path: '.codex/AGENTS.md' }),
    );
    expect(rendered.files).toContainEqual(
      expect.objectContaining({ scope: 'workspace', path: 'AGENTS.md' }),
    );
    expect(rendered.files).toContainEqual(
      expect.objectContaining({
        scope: 'workspace',
        path: '.agents/skills/agentctl-managed-skills.json',
      }),
    );
  });

  it('serializes config.toml with runtime settings and MCP servers', () => {
    const renderer = new CodexConfigRenderer();
    const rendered = renderer.render(makeConfig());
    const configFile = rendered.files.find((file) => file.path === '.codex/config.toml');

    expect(configFile?.content).toContain('model = "gpt-5-codex"');
    expect(configFile?.content).toContain('approval_policy = "on-request"');
    expect(configFile?.content).toContain('[mcp_servers.filesystem]');
    expect(configFile?.content).toContain('command = "npx"');
  });
});
