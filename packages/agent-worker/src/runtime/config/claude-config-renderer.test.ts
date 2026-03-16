import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  it('renders Claude settings, MCP, and skills manifest files', () => {
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
      expect.objectContaining({
        scope: 'workspace',
        path: '.claude/skills/agentctl-managed-skills.json',
      }),
    );
    expect(rendered.files.find((file) => file.path === 'CLAUDE.md')).toBeUndefined();
  });

  it('renders managed CLAUDE.md when instructionsStrategy is managed', () => {
    const renderer = new ClaudeConfigRenderer();
    const rendered = renderer.render(makeConfig(), undefined, { instructionsStrategy: 'managed' });

    expect(rendered.files).toContainEqual(
      expect.objectContaining({ scope: 'workspace', path: 'CLAUDE.md' }),
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
      undefined,
      { instructionsStrategy: 'managed' },
    );

    const claudeMd = rendered.files.find((file) => file.path === 'CLAUDE.md');
    expect(claudeMd).toBeUndefined();
  });

  it('merges project CLAUDE.md with managed instructions for merge strategy', () => {
    const renderer = new ClaudeConfigRenderer();
    const projectPath = mkdtempSync(path.join(tmpdir(), 'agentctl-claude-render-'));
    const existingContent = '# Project CLAUDE\n\nFollow local conventions first.';
    writeFileSync(path.join(projectPath, 'CLAUDE.md'), existingContent, 'utf-8');

    try {
      const rendered = renderer.render(makeConfig(), undefined, {
        instructionsStrategy: 'merge',
        projectPath,
      });

      const claudeMd = rendered.files.find((file) => file.path === 'CLAUDE.md');
      expect(claudeMd?.content).toContain(existingContent);
      expect(claudeMd?.content).toContain('<!-- agentctl:managed-instructions:start -->');
      expect(claudeMd?.content).toContain('# Claude Code Instructions');
      expect(claudeMd?.content).toContain('<!-- agentctl:managed-instructions:end -->');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
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
