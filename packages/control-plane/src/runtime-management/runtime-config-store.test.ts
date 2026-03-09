import type { ManagedRuntimeConfig } from '@agentctl/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';
import type { Database } from '../db/index.js';
import { createMockDb, type MockDb } from './test-helpers.js';
import { RuntimeConfigStore } from './runtime-config-store.js';

function makeConfig(overrides: Partial<ManagedRuntimeConfig> = {}): ManagedRuntimeConfig {
  return {
    version: 7,
    hash: 'sha256:cfg-7',
    instructions: {
      userGlobal: 'Global guidance',
      projectTemplate: 'Project guidance',
    },
    mcpServers: [
      {
        id: 'filesystem',
        name: 'Filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: { ROOT: '/workspace' },
      },
    ],
    skills: [{ id: 'systematic-debugging', path: '.claude/skills/systematic-debugging.md', enabled: true }],
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

describe('RuntimeConfigStore', () => {
  let mockDb: MockDb;
  let store: RuntimeConfigStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    store = new RuntimeConfigStore(mockDb as unknown as Database, createMockLogger());
  });

  it('saves a config revision and returns the stored row', async () => {
    const config = makeConfig();
    mockDb.returning.mockResolvedValue([
      {
        id: 'rev-1',
        version: config.version,
        hash: config.hash,
        config,
        createdAt: new Date('2026-03-09T10:00:00Z'),
      },
    ]);

    const saved = await store.saveRevision(config);

    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockDb.values).toHaveBeenCalledWith({
      version: 7,
      hash: 'sha256:cfg-7',
      config,
    });
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalledOnce();
    expect(saved).toMatchObject({
      id: 'rev-1',
      version: 7,
      hash: 'sha256:cfg-7',
      config,
    });
  });

  it('returns the latest revision when one exists', async () => {
    const config = makeConfig();
    mockDb.limit.mockResolvedValue([
      {
        id: 'rev-2',
        version: 8,
        hash: 'sha256:cfg-8',
        config,
        createdAt: new Date('2026-03-09T11:00:00Z'),
      },
    ]);

    const revision = await store.getLatestRevision();

    expect(mockDb.select).toHaveBeenCalledOnce();
    expect(mockDb.from).toHaveBeenCalledOnce();
    expect(mockDb.orderBy).toHaveBeenCalledOnce();
    expect(mockDb.limit).toHaveBeenCalledWith(1);
    expect(revision?.version).toBe(8);
  });

  it('upserts machine runtime state and returns the stored row', async () => {
    mockDb.returning
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'mrs-1',
          machineId: 'machine-1',
          runtime: 'codex',
          isInstalled: true,
          isAuthenticated: true,
          syncStatus: 'in-sync',
          configVersion: 7,
          configHash: 'sha256:cfg-7',
          metadata: { lastSyncReason: 'manual' },
          lastConfigAppliedAt: new Date('2026-03-09T12:00:00Z'),
          createdAt: new Date('2026-03-09T12:00:00Z'),
          updatedAt: new Date('2026-03-09T12:00:00Z'),
        },
      ]);

    const state = await store.upsertMachineState({
      machineId: 'machine-1',
      runtime: 'codex',
      isInstalled: true,
      isAuthenticated: true,
      syncStatus: 'in-sync',
      configVersion: 7,
      configHash: 'sha256:cfg-7',
      metadata: { lastSyncReason: 'manual' },
    });

    expect(mockDb.update).toHaveBeenCalledOnce();
    expect(mockDb.set).toHaveBeenCalledOnce();
    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(state).toMatchObject({
      machineId: 'machine-1',
      runtime: 'codex',
      syncStatus: 'in-sync',
      configVersion: 7,
    });
  });
});
