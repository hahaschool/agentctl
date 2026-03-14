import { describe, expect, it } from 'vitest';

import type { AgentMcpOverride, AgentSkillOverride } from '../types/agent.js';
import type { ManagedMcpServer, ManagedSkill } from '../types/runtime-management.js';

import { resolveEffectiveMcpServers, resolveEffectiveSkills } from './resolve-overrides.js';

describe('resolveEffectiveMcpServers', () => {
  const defaults: ManagedMcpServer[] = [
    { id: '1', name: 'filesystem', command: 'npx', args: ['-y', 'fs-server'], env: {} },
    { id: '2', name: 'memory', command: 'npx', args: ['-y', 'mem-server'], env: {} },
    { id: '3', name: 'github', command: 'npx', args: ['-y', 'gh-server'], env: {} },
  ];

  it('returns all defaults when override is undefined', () => {
    const result = resolveEffectiveMcpServers(defaults, undefined);
    expect(result).toHaveLength(3);
    expect(result.map(s => s.name)).toEqual(['filesystem', 'memory', 'github']);
  });

  it('excludes servers in excluded list', () => {
    const override: AgentMcpOverride = { excluded: ['memory'], custom: [] };
    const result = resolveEffectiveMcpServers(defaults, override);
    expect(result).toHaveLength(2);
    expect(result.map(s => s.name)).toEqual(['filesystem', 'github']);
  });

  it('appends custom servers after defaults', () => {
    const override: AgentMcpOverride = {
      excluded: [],
      custom: [{ name: 'my-server', command: 'my-cmd', args: ['--flag'] }],
    };
    const result = resolveEffectiveMcpServers(defaults, override);
    expect(result).toHaveLength(4);
    expect(result[3].name).toBe('my-server');
    expect(result[3].command).toBe('my-cmd');
  });

  it('handles all-excluded with custom only', () => {
    const override: AgentMcpOverride = {
      excluded: ['filesystem', 'memory', 'github'],
      custom: [{ name: 'solo', command: 'solo', args: [] }],
    };
    const result = resolveEffectiveMcpServers(defaults, override);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('solo');
  });

  it('handles empty defaults', () => {
    const override: AgentMcpOverride = {
      excluded: [],
      custom: [{ name: 'solo', command: 'solo', args: [] }],
    };
    const result = resolveEffectiveMcpServers([], override);
    expect(result).toHaveLength(1);
  });

  it('ignores excluded names not in defaults (no-op)', () => {
    const override: AgentMcpOverride = { excluded: ['nonexistent'], custom: [] };
    const result = resolveEffectiveMcpServers(defaults, override);
    expect(result).toHaveLength(3);
  });

  it('does not mutate the original defaults array', () => {
    const override: AgentMcpOverride = { excluded: ['memory'], custom: [] };
    const originalLength = defaults.length;
    resolveEffectiveMcpServers(defaults, override);
    expect(defaults).toHaveLength(originalLength);
  });
});

describe('resolveEffectiveSkills', () => {
  const defaults: ManagedSkill[] = [
    { id: 'tdd', path: '/skills/tdd/SKILL.md', enabled: true },
    { id: 'debug', path: '/skills/debug/SKILL.md', enabled: true },
  ];

  it('returns all defaults when override is undefined', () => {
    const result = resolveEffectiveSkills(defaults, undefined);
    expect(result).toHaveLength(2);
  });

  it('excludes skills by id', () => {
    const override: AgentSkillOverride = { excluded: ['debug'], custom: [] };
    const result = resolveEffectiveSkills(defaults, override);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('tdd');
  });

  it('appends custom skills', () => {
    const override: AgentSkillOverride = {
      excluded: [],
      custom: [{ id: 'custom', path: '/custom/SKILL.md', enabled: true }],
    };
    const result = resolveEffectiveSkills(defaults, override);
    expect(result).toHaveLength(3);
    expect(result[2].id).toBe('custom');
  });

  it('does not mutate the original defaults array', () => {
    const override: AgentSkillOverride = { excluded: ['tdd'], custom: [] };
    const originalLength = defaults.length;
    resolveEffectiveSkills(defaults, override);
    expect(defaults).toHaveLength(originalLength);
  });
});
