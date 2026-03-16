import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  it('renders Codex config and skills manifest files', () => {
    const renderer = new CodexConfigRenderer();
    const rendered = renderer.render(makeConfig());

    expect(rendered.runtime).toBe('codex');
    expect(rendered.files).toContainEqual(
      expect.objectContaining({ scope: 'home', path: '.codex/config.toml' }),
    );
    expect(rendered.files).toContainEqual(
      expect.objectContaining({ scope: 'workspace', path: '.codex/config.toml' }),
    );
    expect(rendered.files).toContainEqual(
      expect.objectContaining({
        scope: 'workspace',
        path: '.agents/skills/agentctl-managed-skills.json',
      }),
    );
    expect(rendered.files.find((file) => file.path === '.codex/AGENTS.md')).toBeUndefined();
    expect(rendered.files.find((file) => file.path === 'AGENTS.md')).toBeUndefined();
  });

  it('renders managed AGENTS.md files when instructionsStrategy is managed', () => {
    const renderer = new CodexConfigRenderer();
    const rendered = renderer.render(makeConfig(), undefined, { instructionsStrategy: 'managed' });

    expect(rendered.files).toContainEqual(
      expect.objectContaining({ scope: 'home', path: '.codex/AGENTS.md' }),
    );
    expect(rendered.files).toContainEqual(
      expect.objectContaining({ scope: 'workspace', path: 'AGENTS.md' }),
    );
  });

  it('serializes config.toml with runtime settings and MCP servers', () => {
    const renderer = new CodexConfigRenderer();
    const rendered = renderer.render(makeConfig());
    const configFile = rendered.files.find(
      (file) => file.scope === 'home' && file.path === '.codex/config.toml',
    );

    expect(configFile?.content).toContain('model = "gpt-5-codex"');
    expect(configFile?.content).toContain('approval_policy = "on-request"');
    expect(configFile?.content).toContain('sandbox_mode = "workspace-write"');
    expect(configFile?.content).toContain('[shell_environment_policy]');
    expect(configFile?.content).toContain('inherit = ["PATH"]');
    expect(configFile?.content).toContain('[shell_environment_policy.set]');
    expect(configFile?.content).toContain('NODE_ENV = "development"');
    expect(configFile?.content).toContain('[mcp_servers.filesystem]');
    expect(configFile?.content).toContain('command = "npx"');
  });

  it('serializes supported Codex runtime overrides for provider selection and reasoning effort', () => {
    const renderer = new CodexConfigRenderer();
    const rendered = renderer.render(
      makeConfig({
        runtimeOverrides: {
          claudeCode: { model: 'sonnet' },
          codex: {
            model: 'gpt-5.2-codex',
            modelProvider: 'openai',
            reasoningEffort: 'high',
          },
        },
      }),
    );
    const configFile = rendered.files.find(
      (file) => file.scope === 'home' && file.path === '.codex/config.toml',
    );

    expect(configFile?.content).toContain('model = "gpt-5.2-codex"');
    expect(configFile?.content).toContain('model_provider = "openai"');
    expect(configFile?.content).toContain('model_reasoning_effort = "high"');
  });

  it.each([
    'read-only',
    'workspace-write',
    'danger-full-access',
  ] as const)('serializes sandbox mode %s without rewriting the managed value', (sandbox) => {
    const renderer = new CodexConfigRenderer();
    const rendered = renderer.render(makeConfig({ sandbox }));
    const configFile = rendered.files.find(
      (file) => file.scope === 'home' && file.path === '.codex/config.toml',
    );

    expect(configFile?.content).toContain(`sandbox_mode = "${sandbox}"`);
  });

  it('merges project AGENTS.md with managed instructions for merge strategy', () => {
    const renderer = new CodexConfigRenderer();
    const projectPath = mkdtempSync(path.join(tmpdir(), 'agentctl-codex-render-'));
    const existingContent = '# Existing AGENTS\n\nUse project style first.';
    writeFileSync(path.join(projectPath, 'AGENTS.md'), existingContent, 'utf-8');

    try {
      const rendered = renderer.render(makeConfig(), undefined, {
        instructionsStrategy: 'merge',
        projectPath,
      });

      const agentsMd = rendered.files.find((file) => file.path === 'AGENTS.md');
      expect(agentsMd?.content).toContain(existingContent);
      expect(agentsMd?.content).toContain('<!-- agentctl:managed-instructions:start -->');
      expect(agentsMd?.content).toContain('# Codex Instructions');
      expect(agentsMd?.content).toContain('<!-- agentctl:managed-instructions:end -->');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
