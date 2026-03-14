import { describe, expect, it } from 'vitest';

import type { DiscoveredMcpServer, DiscoveredSkill } from './agent.js';

describe('DiscoveredMcpServer', () => {
  it('supports configFile field for provenance', () => {
    const server: DiscoveredMcpServer = {
      name: 'filesystem',
      config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
      source: 'global',
      configFile: '~/.claude.json',
    };

    expect(server.configFile).toBe('~/.claude.json');
  });

  it('is backward compatible without configFile', () => {
    const server: DiscoveredMcpServer = {
      name: 'filesystem',
      config: { command: 'npx' },
      source: 'global',
    };

    expect(server.configFile).toBeUndefined();
  });
});

describe('DiscoveredSkill', () => {
  it('holds all required fields from SKILL.md frontmatter', () => {
    const skill: DiscoveredSkill = {
      id: 'systematic-debugging',
      name: 'Systematic Debugging',
      description: 'Use when encountering any bug',
      path: '/Users/user/.claude/skills/systematic-debugging/SKILL.md',
      source: 'global',
      runtime: 'claude-code',
      userInvokable: true,
      args: 'optional args description',
    };

    expect(skill.id).toBe('systematic-debugging');
    expect(skill.runtime).toBe('claude-code');
    expect(skill.userInvokable).toBe(true);
  });

  it('works with minimal fields', () => {
    const skill: DiscoveredSkill = {
      id: 'my-skill',
      name: 'My Skill',
      description: 'Does things',
      path: '/path/to/SKILL.md',
      source: 'project',
      runtime: 'codex',
    };

    expect(skill.userInvokable).toBeUndefined();
    expect(skill.args).toBeUndefined();
  });
});
