import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { agentConfigPreviewRoutes } from './agent-config-preview.js';
import { createFullMockDbRegistry, makeMachine, saveOriginalFetch } from './test-helpers.js';

const originalFetch = saveOriginalFetch();

async function buildApp(dbRegistry: DbAgentRegistry): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(agentConfigPreviewRoutes, {
    prefix: '/api/agents',
    dbRegistry,
    workerPort: 9000,
  });
  await app.ready();
  return app;
}

function buildAgent() {
  return {
    id: 'agent-1',
    machineId: 'machine-1',
    name: 'Preview Agent',
    type: 'manual',
    runtime: 'claude-code',
    status: 'running',
    schedule: null,
    projectPath: null,
    worktreeBranch: null,
    currentSessionId: null,
    config: {
      mcpOverride: {
        excluded: [],
        custom: [
          {
            name: 'custom-mcp',
            command: 'node',
            args: ['custom-mcp.js'],
            env: { LOG_LEVEL: 'debug' },
          },
        ],
      },
      skillOverride: {
        excluded: ['global-skill'],
        custom: [
          {
            id: 'custom-skill',
            path: '/custom/skills/custom-skill/SKILL.md',
            enabled: true,
            source: 'project',
          },
        ],
      },
    },
    lastRunAt: null,
    lastCostUsd: null,
    totalCostUsd: 0,
    accountId: null,
    createdAt: new Date('2026-03-15T00:00:00.000Z'),
  };
}

function okJson(body: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

describe('Agent config preview routes — /api/agents/:id/config-preview', () => {
  let app: FastifyInstance;
  let mockDbRegistry: DbAgentRegistry;

  beforeAll(async () => {
    mockDbRegistry = createFullMockDbRegistry({
      getAgent: vi.fn().mockResolvedValue(buildAgent()),
      getMachine: vi.fn().mockResolvedValue(makeMachine({ id: 'machine-1', status: 'online' })),
    });

    app = await buildApp(mockDbRegistry);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
    vi.mocked(mockDbRegistry.getAgent).mockResolvedValue(buildAgent() as never);
    vi.mocked(mockDbRegistry.getMachine).mockResolvedValue(
      makeMachine({ id: 'machine-1', status: 'online' }) as never,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('discovers skills for both runtimes and forwards merged skills into preview config', async () => {
    let forwardedPreviewConfig: Record<string, unknown> | null = null;
    let forwardedInstructionsStrategy: string | null = null;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/mcp/discover?runtime=claude-code')) {
        return okJson({
          discovered: [
            {
              name: 'filesystem',
              config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
              source: 'global',
            },
          ],
        });
      }

      if (url.includes('/api/mcp/discover?runtime=codex')) {
        return okJson({ discovered: [] });
      }

      if (url.includes('/api/skills/discover?runtime=claude-code')) {
        return okJson({
          discovered: [
            {
              id: 'global-skill',
              name: 'Global Skill',
              description: 'From claude runtime',
              path: '/home/user/.claude/skills/global-skill/SKILL.md',
              source: 'global',
              runtime: 'claude-code',
            },
            {
              id: 'duplicate-skill',
              name: 'Duplicate Skill',
              description: 'From claude runtime',
              path: '/home/user/.claude/skills/duplicate-skill/SKILL.md',
              source: 'global',
              runtime: 'claude-code',
            },
          ],
        });
      }

      if (url.includes('/api/skills/discover?runtime=codex')) {
        return okJson({
          discovered: [
            {
              id: 'duplicate-skill',
              name: 'Duplicate Skill',
              description: 'From codex runtime',
              path: '/home/user/.codex/skills/duplicate-skill/SKILL.md',
              source: 'global',
              runtime: 'codex',
            },
            {
              id: 'codex-skill',
              name: 'Codex Skill',
              description: 'From codex runtime',
              path: '/home/user/.codex/skills/codex-skill/SKILL.md',
              source: 'global',
              runtime: 'codex',
            },
          ],
        });
      }

      if (url.includes('/api/config/preview?')) {
        const parsed = new URL(url);
        forwardedPreviewConfig = JSON.parse(
          parsed.searchParams.get('configJson') ?? '{}',
        ) as Record<string, unknown>;
        forwardedInstructionsStrategy = parsed.searchParams.get('instructionsStrategy');
        return okJson({ ok: true, runtime: 'claude-code', files: [] });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/agent-1/config-preview',
    });

    expect(res.statusCode).toBe(200);

    const urls = vi.mocked(globalThis.fetch).mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('/api/skills/discover?runtime=claude-code'))).toBe(true);
    expect(urls.some((url) => url.includes('/api/skills/discover?runtime=codex'))).toBe(true);

    const skills = (forwardedPreviewConfig?.skills as Array<{ id: string; path: string }>) ?? [];
    const skillIds = skills.map((skill) => skill.id);

    const mcpServers =
      (forwardedPreviewConfig?.mcpServers as Array<{ name: string; source?: string }>) ?? [];
    const filesystem = mcpServers.find((server) => server.name === 'filesystem');
    const customMcp = mcpServers.find((server) => server.name === 'custom-mcp');

    expect(skillIds).not.toContain('global-skill');
    expect(skillIds).toContain('duplicate-skill');
    expect(skillIds).toContain('codex-skill');
    expect(skillIds).toContain('custom-skill');

    const duplicateSkillCount = skillIds.filter((id) => id === 'duplicate-skill').length;
    expect(duplicateSkillCount).toBe(1);

    expect(filesystem?.source).toBe('global');
    expect(customMcp?.source).toBe('custom');
    expect(forwardedInstructionsStrategy).toBe('project');
  });

  it('omits instruction files from preview when instructionsStrategy is project', async () => {
    vi.mocked(mockDbRegistry.getAgent).mockResolvedValue({
      ...buildAgent(),
      config: {
        ...buildAgent().config,
        instructionsStrategy: 'project',
      },
    } as never);

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/mcp/discover?') || url.includes('/api/skills/discover?')) {
        return okJson({ discovered: [] });
      }

      if (url.includes('/api/config/preview?')) {
        return okJson({
          ok: true,
          runtime: 'claude-code',
          files: [
            { path: '.mcp.json', scope: 'workspace', content: '{}', status: 'managed' },
            { path: 'CLAUDE.md', scope: 'workspace', content: 'managed', status: 'managed' },
          ],
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/agent-1/config-preview',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { files: Array<{ path: string }> };
    expect(body.files.map((file) => file.path)).toEqual(['.mcp.json']);
  });
});
