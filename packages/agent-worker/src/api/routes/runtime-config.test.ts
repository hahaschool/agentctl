import type {
  ApplyRuntimeConfigRequest,
  ApplyRuntimeConfigResponse,
  ManagedRuntime,
} from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { runtimeConfigRoutes } from './runtime-config.js';

type RuntimeConfigApplierMock = {
  apply: ReturnType<typeof vi.fn>;
  getState: ReturnType<typeof vi.fn>;
};

function createApplierMock(): RuntimeConfigApplierMock {
  return {
    apply: vi.fn(),
    getState: vi.fn(),
  };
}

async function buildApp(applier: RuntimeConfigApplierMock): Promise<FastifyInstance> {
  const Fastify = await import('fastify');
  const app = Fastify.default({ logger: false });
  await app.register(runtimeConfigRoutes, {
    prefix: '/api/runtime-config',
    machineId: 'machine-1',
    runtimeConfigApplier: applier,
    logger: createSilentLogger(),
  });
  return app;
}

describe('worker runtimeConfigRoutes', () => {
  let app: FastifyInstance;
  let applier: RuntimeConfigApplierMock;

  beforeEach(async () => {
    applier = createApplierMock();
    app = await buildApp(applier);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('POST /apply applies the managed runtime config', async () => {
    applier.apply.mockResolvedValue({
      applied: true,
      machineId: 'machine-1',
      configVersion: 11,
      configHash: 'sha256:cfg-11',
      files: [{ path: '.mcp.json', hash: 'sha256:file-1' }],
      runtimes: {
        'claude-code': { installed: true, authenticated: true },
        codex: { installed: true, authenticated: false },
      },
    } satisfies ApplyRuntimeConfigResponse);

    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-config/apply',
      payload: {
        machineId: 'machine-1',
        config: {
          version: 11,
          hash: 'sha256:cfg-11',
          instructions: { userGlobal: 'global', projectTemplate: 'project' },
          mcpServers: [],
          skills: [],
          sandbox: 'workspace-write',
          approvalPolicy: 'on-request',
          environmentPolicy: { inherit: ['PATH'], set: {} },
          runtimeOverrides: { claudeCode: {}, codex: {} },
        },
      } satisfies ApplyRuntimeConfigRequest,
    });

    expect(response.statusCode).toBe(200);
    expect(applier.apply).toHaveBeenCalledOnce();
    expect(response.json().applied).toBe(true);
  });

  it('GET /state returns worker runtime config state', async () => {
    applier.getState.mockResolvedValue({
      machineId: 'machine-1',
      workspaceRoot: '/workspace/project',
      lastAppliedConfigVersion: 11,
      lastAppliedConfigHash: 'sha256:cfg-11',
      runtimes: {
        'claude-code': { installed: true, authenticated: true },
        codex: { installed: true, authenticated: false },
      } satisfies Record<ManagedRuntime, { installed: boolean; authenticated: boolean }>,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/runtime-config/state',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      machineId: 'machine-1',
      lastAppliedConfigVersion: 11,
    });
  });
});
