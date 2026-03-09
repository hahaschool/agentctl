import type { ApplyRuntimeConfigRequest, ManagedRuntimeConfig } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

import { mkdir, writeFile } from 'node:fs/promises';

import { RuntimeConfigApplier } from './runtime-config-applier.js';

function makeConfig(overrides: Partial<ManagedRuntimeConfig> = {}): ManagedRuntimeConfig {
  return {
    version: 11,
    hash: 'sha256:cfg-11',
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
    skills: [{ id: 'systematic-debugging', path: '/skills/systematic-debugging/SKILL.md', enabled: true }],
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

describe('RuntimeConfigApplier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies rendered files and reports hashes plus runtime capabilities', async () => {
    const applier = new RuntimeConfigApplier({
      workspaceRoot: '/workspace/project',
      homeDir: '/Users/tester',
      probeRuntime: async (runtime) => ({
        installed: true,
        authenticated: runtime === 'claude-code',
      }),
    });

    const response = await applier.apply({
      machineId: 'machine-1',
      config: makeConfig(),
    } satisfies ApplyRuntimeConfigRequest);

    expect(response.applied).toBe(true);
    expect(response.machineId).toBe('machine-1');
    expect(response.configVersion).toBe(11);
    expect(response.files).toContainEqual(
      expect.objectContaining({ path: '.mcp.json', hash: expect.stringMatching(/^sha256:/) }),
    );
    expect(response.files).toContainEqual(
      expect.objectContaining({ path: '.codex/config.toml', hash: expect.stringMatching(/^sha256:/) }),
    );
    expect(response.runtimes['claude-code']).toEqual({ installed: true, authenticated: true });
    expect(response.runtimes.codex).toEqual({ installed: true, authenticated: false });
    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalled();
  });

  it('reports last applied state for the worker', async () => {
    const applier = new RuntimeConfigApplier({
      workspaceRoot: '/workspace/project',
      homeDir: '/Users/tester',
      probeRuntime: async () => ({ installed: true, authenticated: true }),
    });

    await applier.apply({ machineId: 'machine-1', config: makeConfig() });
    const state = await applier.getState('machine-1');

    expect(state.machineId).toBe('machine-1');
    expect(state.lastAppliedConfigVersion).toBe(11);
    expect(state.lastAppliedConfigHash).toBe('sha256:cfg-11');
    expect(state.runtimes.codex.installed).toBe(true);
  });
});
