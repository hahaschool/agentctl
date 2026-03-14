import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverSkills } from './skill-discovery.js';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn(),
}));

import { access, readFile, readdir } from 'node:fs/promises';

const mockReaddir = vi.mocked(readdir);
const mockReadFile = vi.mocked(readFile);
const mockAccess = vi.mocked(access);

describe('discoverSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discovers claude-code global skills from ~/.claude/skills/', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([
      { name: 'systematic-debugging', isDirectory: () => true },
      { name: 'tdd', isDirectory: () => true },
    ] as any);
    mockReadFile.mockImplementation(async (path) => {
      if (String(path).includes('systematic-debugging')) {
        return `---
name: Systematic Debugging
description: Use when encountering any bug or test failure
---
Content here`;
      }
      if (String(path).includes('tdd')) {
        return `---
name: Test-Driven Development
description: Use when implementing features
user-invokable: true
args: optional feature name
---
TDD content`;
      }
      throw new Error('ENOENT');
    });

    const result = await discoverSkills('claude-code', '/home/user');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('systematic-debugging');
    expect(result[0].name).toBe('Systematic Debugging');
    expect(result[0].source).toBe('global');
    expect(result[0].runtime).toBe('claude-code');

    expect(result[1].id).toBe('tdd');
    expect(result[1].userInvokable).toBe(true);
    expect(result[1].args).toBe('optional feature name');
  });

  it('discovers codex skills from ~/.agents/skills/', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([
      { name: 'code-review', isDirectory: () => true },
    ] as any);
    mockReadFile.mockResolvedValue(`---
name: Code Review
description: Automated code review
---
Content`);

    const result = await discoverSkills('codex', '/home/user');

    expect(result).toHaveLength(1);
    expect(result[0].runtime).toBe('codex');
  });

  it('returns empty when skills directory does not exist', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await discoverSkills('claude-code', '/home/user');
    expect(result).toEqual([]);
  });

  it('skips entries without SKILL.md', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([
      { name: 'valid-skill', isDirectory: () => true },
      { name: 'no-skill-md', isDirectory: () => true },
    ] as any);
    mockReadFile.mockImplementation(async (path) => {
      if (String(path).includes('valid-skill')) {
        return `---
name: Valid
description: A valid skill
---
Content`;
      }
      throw new Error('ENOENT');
    });

    const result = await discoverSkills('claude-code', '/home/user');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('valid-skill');
  });

  it('skips skills with missing frontmatter', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([
      { name: 'no-frontmatter', isDirectory: () => true },
    ] as any);
    mockReadFile.mockResolvedValue('Just content, no frontmatter');

    const result = await discoverSkills('claude-code', '/home/user');
    expect(result).toEqual([]);
  });

  it('skips non-directory entries', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([
      { name: 'README.md', isDirectory: () => false },
      { name: 'valid-skill', isDirectory: () => true },
    ] as any);
    mockReadFile.mockResolvedValue(`---
name: Valid
description: A valid skill
---
Content`);

    const result = await discoverSkills('claude-code', '/home/user');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('valid-skill');
  });

  it('discovers project-scoped skills when projectPath provided', async () => {
    mockAccess.mockImplementation(async (path) => {
      // Global path fails, project path succeeds
      if (String(path).includes('/home/user')) {
        throw new Error('ENOENT');
      }
    });
    mockReaddir.mockResolvedValue([
      { name: 'project-skill', isDirectory: () => true },
    ] as any);
    mockReadFile.mockResolvedValue(`---
name: Project Skill
description: A project skill
---
Content`);

    const result = await discoverSkills('claude-code', '/home/user', '/project');

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('project');
  });
});
