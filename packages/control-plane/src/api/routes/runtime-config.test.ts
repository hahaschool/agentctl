import type { ManagedRuntimeConfig } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  MachineRuntimeStateRecord,
  RuntimeConfigRevisionRecord,
} from '../../runtime-management/runtime-config-store.js';
import { runtimeConfigRoutes } from './runtime-config.js';

function makeConfig(overrides: Partial<ManagedRuntimeConfig> = {}): ManagedRuntimeConfig {
  return {
    version: 9,
    hash: 'sha256:cfg-9',
    instructions: {
      userGlobal: 'Global instructions',
      projectTemplate: 'Project instructions',
    },
    mcpServers: [],
    skills: [],
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    environmentPolicy: {
      inherit: ['PATH'],
      set: {},
    },
    runtimeOverrides: {
      claudeCode: { model: 'sonnet' },
      codex: { model: 'gpt-5-codex' },
    },
    ...overrides,
  };
}

type RuntimeConfigRouteStoreMock = {
  getLatestRevision: ReturnType<typeof vi.fn>;
  saveRevision: ReturnType<typeof vi.fn>;
  listMachineStates: ReturnType<typeof vi.fn>;
};

function createRouteStoreMock(): RuntimeConfigRouteStoreMock {
  return {
    getLatestRevision: vi.fn(),
    saveRevision: vi.fn(),
    listMachineStates: vi.fn(),
  };
}

async function buildApp(store: RuntimeConfigRouteStoreMock): Promise<FastifyInstance> {
  const Fastify = await import('fastify');
  const app = Fastify.default({ logger: false });
  await app.register(runtimeConfigRoutes, {
    prefix: '/api/runtime-config',
    runtimeConfigStore: store,
  });
  return app;
}

describe('runtimeConfigRoutes', () => {
  let app: FastifyInstance;
  let store: RuntimeConfigRouteStoreMock;

  beforeEach(async () => {
    store = createRouteStoreMock();
    app = await buildApp(store);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('GET /defaults returns a default config when no revision exists', async () => {
    store.getLatestRevision.mockResolvedValue(null);

    const response = await app.inject({ method: 'GET', url: '/api/runtime-config/defaults' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('config');
    expect(body.config.runtimeOverrides).toHaveProperty('claudeCode');
    expect(body.config.runtimeOverrides).toHaveProperty('codex');
    expect(body.config.runtimeOverrides.codex).toMatchObject({
      configPath: '.codex/config.toml',
      modelProvider: 'openai',
      reasoningEffort: 'high',
    });
    expect(body.version).toBe(body.config.version);
    expect(body.hash).toBe(body.config.hash);
  });

  it('PUT /defaults saves a revision and returns the stored config', async () => {
    const config = makeConfig();
    store.saveRevision.mockResolvedValue({
      id: 'rev-1',
      version: config.version,
      hash: config.hash,
      config,
      createdAt: new Date('2026-03-09T14:00:00Z'),
    } satisfies RuntimeConfigRevisionRecord);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/runtime-config/defaults',
      payload: { config },
    });

    expect(response.statusCode).toBe(200);
    expect(store.saveRevision).toHaveBeenCalledWith(config);
    expect(response.json()).toMatchObject({
      version: 9,
      hash: 'sha256:cfg-9',
      config,
    });
  });

  it('POST /sync returns the queued machine count', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-config/sync',
      payload: {
        machineIds: ['machine-1', 'machine-2'],
        configVersion: 9,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      queued: 2,
      machineIds: ['machine-1', 'machine-2'],
      configVersion: 9,
    });
  });

  it('GET /drift reports in-sync and drifted machine runtime states', async () => {
    const config = makeConfig();
    store.getLatestRevision.mockResolvedValue({
      id: 'rev-1',
      version: config.version,
      hash: config.hash,
      config,
      createdAt: new Date('2026-03-09T14:00:00Z'),
    } satisfies RuntimeConfigRevisionRecord);
    store.listMachineStates.mockResolvedValue([
      {
        id: 'mrs-1',
        machineId: 'machine-1',
        runtime: 'claude-code',
        isInstalled: true,
        isAuthenticated: true,
        syncStatus: 'in-sync',
        configVersion: 9,
        configHash: 'sha256:cfg-9',
        metadata: {},
        lastConfigAppliedAt: new Date('2026-03-09T14:01:00Z'),
        createdAt: new Date('2026-03-09T14:01:00Z'),
        updatedAt: new Date('2026-03-09T14:01:00Z'),
      },
      {
        id: 'mrs-2',
        machineId: 'machine-1',
        runtime: 'codex',
        isInstalled: true,
        isAuthenticated: false,
        syncStatus: 'drifted',
        configVersion: 8,
        configHash: 'sha256:cfg-8',
        metadata: { reason: 'stale config' },
        lastConfigAppliedAt: new Date('2026-03-09T13:40:00Z'),
        createdAt: new Date('2026-03-09T13:40:00Z'),
        updatedAt: new Date('2026-03-09T13:40:00Z'),
      },
    ] satisfies MachineRuntimeStateRecord[]);

    const response = await app.inject({ method: 'GET', url: '/api/runtime-config/drift' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.activeVersion).toBe(9);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ runtime: 'claude-code', drifted: false });
    expect(body.items[1]).toMatchObject({ runtime: 'codex', drifted: true });
  });
});
