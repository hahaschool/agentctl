import type { ManagedRuntimeConfig } from '@agentctl/shared';
import { describe, expect, it } from 'vitest';

import { ClaudeConfigRenderer } from './claude-config-renderer.js';

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

describe('ClaudeConfigRenderer', () => {
  it('renders Claude settings, MCP, instructions, and skills manifest files', () => {
    const renderer = new ClaudeConfigRenderer();
    const rendered = renderer.render(makeConfig());

    expect(rendered.runtime).toBe('claude-code');
    expect(rendered.files).toContainEqual(
      expect.objectContaining({ scope: 'home', path: '.claude/settings.json' }),
    );
    expect(rendered.files).toContainEqual(
      expect.objectContaining({ scope: 'home', path: '.claude.json' }),
    );
    expect(rendered.files).toContainEqual(
      expect.objectContaining({ scope: 'workspace', path: '.mcp.json' }),
    );
    expect(rendered.files).toContainEqual(
      expect.objectContaining({ scope: 'workspace', path: 'CLAUDE.md' }),
    );
    expect(rendered.files).toContainEqual(
      expect.objectContaining({
        scope: 'workspace',
        path: '.claude/skills/agentctl-managed-skills.json',
      }),
    );
  });

  it('serializes the Claude settings payload with managed sandbox and model defaults', () => {
    const renderer = new ClaudeConfigRenderer();
    const rendered = renderer.render(makeConfig());
    const settings = rendered.files.find((file) => file.path === '.claude/settings.json');

    expect(settings).toBeDefined();
    const parsed = JSON.parse(settings?.content ?? '{}');
    expect(parsed.managedBy).toBe('agentctl');
    expect(parsed.sandbox).toBe('workspace-write');
    expect(parsed.approvalPolicy).toBe('on-request');
    expect(parsed.model).toBe('sonnet');
  });
});
