import { describe, expect, it } from 'vitest';

import type {
  AgentMcpOverride,
  AgentSkillOverride,
  DiscoveredMcpServer,
  DiscoveredSkill,
} from './agent.js';

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

describe('AgentMcpOverride', () => {
  it('represents opt-out override model', () => {
    const override: AgentMcpOverride = {
      excluded: ['filesystem', 'memory'],
      custom: [{ name: 'my-server', command: 'npx', args: ['-y', 'my-server'] }],
    };

    expect(override.excluded).toHaveLength(2);
    expect(override.custom).toHaveLength(1);
  });

  it('works with empty lists', () => {
    const override: AgentMcpOverride = {
      excluded: [],
      custom: [],
    };

    expect(override.excluded).toHaveLength(0);
    expect(override.custom).toHaveLength(0);
  });
});

describe('AgentSkillOverride', () => {
  it('represents opt-out override model for skills', () => {
    const override: AgentSkillOverride = {
      excluded: ['systematic-debugging'],
      custom: [{ id: 'my-skill', path: '/path/SKILL.md', enabled: true }],
    };

    expect(override.excluded).toEqual(['systematic-debugging']);
    expect(override.custom[0].id).toBe('my-skill');
  });
});
