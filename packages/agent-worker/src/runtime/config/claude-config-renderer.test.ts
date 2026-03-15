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

  it('omits CLAUDE.md when managed instructions are empty', () => {
    const renderer = new ClaudeConfigRenderer();
    const rendered = renderer.render(
      makeConfig({
        instructions: {
          userGlobal: '',
          projectTemplate: '',
        },
      }),
    );

    const claudeMd = rendered.files.find((file) => file.path === 'CLAUDE.md');
    expect(claudeMd).toBeUndefined();
  });

  it('splits MCP payload by source between .claude.json and .mcp.json', () => {
    const renderer = new ClaudeConfigRenderer();
    const rendered = renderer.render(
      makeConfig({
        mcpServers: [
          {
            id: 'global-filesystem',
            name: 'global-filesystem',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem'],
            env: { ROOT: '/home/user' },
            source: 'global',
          },
          {
            id: 'project-filesystem',
            name: 'project-filesystem',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem'],
            env: { ROOT: '/workspace' },
            source: 'project',
          },
          {
            id: 'custom-memory',
            name: 'custom-memory',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory'],
            env: {},
            source: 'custom',
          },
        ] as unknown as ManagedRuntimeConfig['mcpServers'],
      }),
    );

    const homeMcp = rendered.files.find((file) => file.path === '.claude.json');
    const workspaceMcp = rendered.files.find((file) => file.path === '.mcp.json');

    const homePayload = JSON.parse(homeMcp?.content ?? '{}') as {
      mcpServers: Record<string, unknown>;
    };
    const workspacePayload = JSON.parse(workspaceMcp?.content ?? '{}') as {
      mcpServers: Record<string, unknown>;
    };

    expect(Object.keys(homePayload.mcpServers)).toEqual(['global-filesystem']);
    expect(Object.keys(workspacePayload.mcpServers)).toContain('project-filesystem');
    expect(Object.keys(workspacePayload.mcpServers)).toContain('custom-memory');
    expect(Object.keys(workspacePayload.mcpServers)).not.toContain('global-filesystem');
  });
});
