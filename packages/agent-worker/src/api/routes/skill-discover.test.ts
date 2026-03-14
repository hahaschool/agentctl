import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../../test-helpers.js';

// Mock the skill discovery function
vi.mock('../../runtime/discovery/skill-discovery.js', () => ({
  discoverSkills: vi.fn().mockResolvedValue([]),
}));

import { discoverSkills } from '../../runtime/discovery/skill-discovery.js';
import { skillDiscoverCache, skillDiscoverRoutes } from './skill-discover.js';

const mockDiscoverSkills = vi.mocked(discoverSkills);

describe('GET /api/skills/discover', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const logger = createMockLogger();
    app = Fastify({ logger: false });
    await app.register(skillDiscoverRoutes, { prefix: '/api/skills', logger });
    await app.ready();
    skillDiscoverCache.invalidateAll();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns discovered skills for claude-code runtime', async () => {
    mockDiscoverSkills.mockResolvedValue([
      {
        id: 'systematic-debugging',
        name: 'Systematic Debugging',
        description: 'Use when encountering any bug',
        path: '/home/user/.claude/skills/systematic-debugging/SKILL.md',
        source: 'global',
        runtime: 'claude-code',
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/discover?runtime=claude-code',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.discovered).toHaveLength(1);
    expect(body.discovered[0].id).toBe('systematic-debugging');
    expect(body.cached).toBe(false);
  });

  it('defaults to claude-code when runtime is not provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/discover',
    });

    expect(response.statusCode).toBe(200);
    expect(mockDiscoverSkills).toHaveBeenCalledWith(
      'claude-code',
      expect.any(String),
      undefined,
    );
  });

  it('returns 400 for invalid runtime', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/discover?runtime=invalid',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Invalid runtime');
  });

  it('includes project skills when projectPath provided', async () => {
    mockDiscoverSkills.mockResolvedValue([
      {
        id: 'project-skill',
        name: 'Project Skill',
        description: 'A project skill',
        path: '/project/.claude/skills/project-skill/SKILL.md',
        source: 'project',
        runtime: 'claude-code',
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/discover?runtime=claude-code&projectPath=/project',
    });

    expect(response.statusCode).toBe(200);
    expect(mockDiscoverSkills).toHaveBeenCalledWith(
      'claude-code',
      expect.any(String),
      '/project',
    );
  });

  it('uses cached results on second call within TTL', async () => {
    mockDiscoverSkills.mockResolvedValue([
      {
        id: 'cached-skill',
        name: 'Cached',
        description: 'Cached skill',
        path: '/home/user/.claude/skills/cached-skill/SKILL.md',
        source: 'global',
        runtime: 'claude-code',
      },
    ]);

    // First call
    const response1 = await app.inject({
      method: 'GET',
      url: '/api/skills/discover?runtime=claude-code',
    });
    expect(response1.statusCode).toBe(200);
    expect(response1.json().cached).toBe(false);

    // Second call should use cache
    const response2 = await app.inject({
      method: 'GET',
      url: '/api/skills/discover?runtime=claude-code',
    });
    expect(response2.statusCode).toBe(200);
    expect(response2.json().cached).toBe(true);

    // Discovery function should only have been called once
    expect(mockDiscoverSkills).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when no skills found', async () => {
    mockDiscoverSkills.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills/discover?runtime=codex',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.discovered).toEqual([]);
  });
});
