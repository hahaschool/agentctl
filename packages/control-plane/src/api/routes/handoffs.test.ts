import type { HandoffSnapshot } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SessionHandoffRecord } from '../../runtime-management/handoff-store.js';
import type { ManagedSessionRecord } from '../../runtime-management/managed-session-store.js';
import { createMockDbRegistry, saveOriginalFetch } from './test-helpers.js';
import { handoffRoutes } from './handoffs.js';

const originalFetch = saveOriginalFetch();

type ManagedSessionStoreMock = {
  get: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
};

type HandoffStoreMock = {
  create: ReturnType<typeof vi.fn>;
  listForSession: ReturnType<typeof vi.fn>;
  recordNativeImportAttempt: ReturnType<typeof vi.fn>;
  summarizeRecent: ReturnType<typeof vi.fn>;
};

type RuntimeConfigStoreMock = {
  getLatestRevision: ReturnType<typeof vi.fn>;
};

function makeManagedSession(overrides: Partial<ManagedSessionRecord> = {}): ManagedSessionRecord {
  return {
    id: 'ms-source',
    runtime: 'codex',
    nativeSessionId: 'codex-native-1',
    machineId: 'machine-1',
    agentId: 'agent-1',
    projectPath: '/workspace/app',
    worktreePath: '/workspace/app/.trees/agent-1',
    status: 'active',
    configRevision: 9,
    handoffStrategy: null,
    handoffSourceSessionId: null,
    metadata: {},
    startedAt: new Date('2026-03-09T10:00:00Z'),
    lastHeartbeat: new Date('2026-03-09T10:10:00Z'),
    endedAt: null,
    ...overrides,
  };
}

function makeSnapshot(): HandoffSnapshot {
  return {
    sourceRuntime: 'codex',
    sourceSessionId: 'ms-source',
    sourceNativeSessionId: 'codex-native-1',
    projectPath: '/workspace/app',
    worktreePath: '/workspace/app/.trees/agent-1',
    branch: 'main',
    headSha: 'abc123',
    dirtyFiles: ['packages/control-plane/src/api/routes/handoffs.ts'],
    diffSummary: 'Added control-plane handoff route.',
    conversationSummary: 'Continue from the exported Codex runtime snapshot.',
    openTodos: ['start the target runtime'],
    nextSuggestedPrompt: 'Continue from the handoff snapshot.',
    activeConfigRevision: 9,
    activeMcpServers: ['mem0'],
    activeSkills: ['systematic-debugging'],
    reason: 'manual',
  };
}

function makeHandoffRecord(overrides: Partial<SessionHandoffRecord> = {}): SessionHandoffRecord {
  return {
    id: 'handoff-1',
    sourceSessionId: 'ms-source',
    targetSessionId: 'ms-target',
    sourceRuntime: 'codex',
    targetRuntime: 'claude-code',
    reason: 'manual',
    strategy: 'snapshot-handoff',
    status: 'succeeded',
    snapshot: makeSnapshot(),
    errorMessage: null,
    createdAt: new Date('2026-03-09T10:20:00Z'),
    completedAt: new Date('2026-03-09T10:21:00Z'),
    ...overrides,
  };
}

async function buildApp(
  managedSessionStore: ManagedSessionStoreMock,
  handoffStore: HandoffStoreMock,
  runtimeConfigStore: RuntimeConfigStoreMock,
  options?: {
    dbRegistry?: ReturnType<typeof createMockDbRegistry>;
  },
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(handoffRoutes, {
    prefix: '/api/runtime-sessions',
    managedSessionStore: managedSessionStore as never,
    handoffStore: handoffStore as never,
    runtimeConfigStore: runtimeConfigStore as never,
    dbRegistry: (options?.dbRegistry ?? createMockDbRegistry()) as never,
    workerPort: 9000,
  });
  await app.ready();
  return app;
}

describe('handoffRoutes', () => {
  let app: FastifyInstance;
  let managedSessionStore: ManagedSessionStoreMock;
  let handoffStore: HandoffStoreMock;
  let runtimeConfigStore: RuntimeConfigStoreMock;

  beforeAll(async () => {
    managedSessionStore = {
      get: vi.fn(),
      create: vi.fn(),
      updateStatus: vi.fn(),
    };
    handoffStore = {
      create: vi.fn(),
      listForSession: vi.fn(),
      recordNativeImportAttempt: vi.fn(),
      summarizeRecent: vi.fn().mockResolvedValue({
        total: 0,
        succeeded: 0,
        failed: 0,
        pending: 0,
        nativeImportSuccesses: 0,
        nativeImportFallbacks: 0,
      }),
    };
    runtimeConfigStore = {
      getLatestRevision: vi.fn().mockResolvedValue({
        id: 'rev-1',
        version: 9,
        hash: 'sha256:cfg-9',
        config: {},
        createdAt: new Date('2026-03-09T09:00:00Z'),
      }),
    };
    app = await buildApp(managedSessionStore, handoffStore, runtimeConfigStore);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/runtime-sessions/:id/handoff exports a snapshot and starts the target runtime', async () => {
    managedSessionStore.get.mockResolvedValue(makeManagedSession());
    managedSessionStore.create.mockResolvedValue(
      makeManagedSession({
        id: 'ms-target',
        runtime: 'claude-code',
        nativeSessionId: null,
        status: 'starting',
        handoffStrategy: 'snapshot-handoff',
        handoffSourceSessionId: 'ms-source',
      }),
    );
    managedSessionStore.updateStatus.mockImplementation(
      async (id: string, status: ManagedSessionRecord['status'], patch?: Record<string, unknown>) => {
        if (id === 'ms-source') {
          return makeManagedSession({ id, status });
        }

        return makeManagedSession({
          id,
          runtime: 'claude-code',
          nativeSessionId: (patch?.nativeSessionId as string | null | undefined) ?? 'claude-native-1',
          status,
          handoffStrategy:
            (patch?.handoffStrategy as ManagedSessionRecord['handoffStrategy'] | undefined) ??
            'snapshot-handoff',
          handoffSourceSessionId: 'ms-source',
        });
      },
    );
    handoffStore.create.mockResolvedValue(makeHandoffRecord());

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          strategy: 'snapshot-handoff',
          snapshot: makeSnapshot(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          strategy: 'snapshot-handoff',
          attemptedStrategies: ['snapshot-handoff'],
          nativeImportAttempt: {
            ok: false,
            sourceRuntime: 'codex',
            targetRuntime: 'claude-code',
            reason: 'not_implemented',
            metadata: { probe: 'codex-to-claude' },
          },
          session: {
            runtime: 'claude-code',
            sessionId: 'worker-1',
            nativeSessionId: 'claude-native-1',
            agentId: 'agent-1',
            projectPath: '/workspace/app',
            model: 'sonnet',
            status: 'active',
          },
        }),
      });

    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/ms-source/handoff',
      payload: {
        targetRuntime: 'claude-code',
        reason: 'manual',
        prompt: 'Continue from the exported snapshot.',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().strategy).toBe('snapshot-handoff');
    expect(response.json().session.runtime).toBe('claude-code');
    expect(response.json().session.handoffSourceSessionId).toBe('ms-source');
    expect(response.json().nativeImportAttempt.reason).toBe('not_implemented');
    expect(handoffStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSessionId: 'ms-source',
        targetRuntime: 'claude-code',
        status: 'succeeded',
      }),
    );
    expect(handoffStore.recordNativeImportAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        handoffId: 'handoff-1',
        sourceRuntime: 'codex',
        targetRuntime: 'claude-code',
        status: 'failed',
      }),
    );
  });

  it('persists native-import as the target managed session strategy when the worker imports successfully', async () => {
    managedSessionStore.get.mockResolvedValue(makeManagedSession());
    managedSessionStore.create.mockResolvedValue(
      makeManagedSession({
        id: 'ms-target',
        runtime: 'claude-code',
        nativeSessionId: null,
        status: 'starting',
        handoffStrategy: 'snapshot-handoff',
        handoffSourceSessionId: 'ms-source',
      }),
    );
    managedSessionStore.updateStatus.mockImplementation(
      async (id: string, status: ManagedSessionRecord['status'], patch?: Record<string, unknown>) => {
        if (id === 'ms-source') {
          return makeManagedSession({ id, status });
        }

        return makeManagedSession({
          id,
          runtime: 'claude-code',
          nativeSessionId: (patch?.nativeSessionId as string | null | undefined) ?? 'claude-native-2',
          status,
          handoffStrategy:
            (patch?.handoffStrategy as ManagedSessionRecord['handoffStrategy'] | undefined) ??
            'snapshot-handoff',
          handoffSourceSessionId: 'ms-source',
        });
      },
    );
    handoffStore.create.mockResolvedValue(
      makeHandoffRecord({
        strategy: 'native-import',
        targetRuntime: 'claude-code',
      }),
    );

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          strategy: 'snapshot-handoff',
          snapshot: makeSnapshot(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          strategy: 'native-import',
          attemptedStrategies: ['native-import', 'snapshot-handoff'],
          nativeImportAttempt: {
            ok: true,
            sourceRuntime: 'codex',
            targetRuntime: 'claude-code',
            reason: 'succeeded',
            metadata: { probe: 'codex-to-claude' },
          },
          session: {
            runtime: 'claude-code',
            sessionId: 'worker-2',
            nativeSessionId: 'claude-native-2',
            agentId: 'agent-1',
            projectPath: '/workspace/app',
            model: 'sonnet',
            status: 'active',
          },
        }),
      });

    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/ms-source/handoff',
      payload: {
        targetRuntime: 'claude-code',
        reason: 'manual',
        prompt: 'Continue through native import.',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().strategy).toBe('native-import');
    expect(response.json().session.handoffStrategy).toBe('native-import');
    expect(managedSessionStore.updateStatus).toHaveBeenCalledWith(
      'ms-target',
      'active',
      expect.objectContaining({
        nativeSessionId: 'claude-native-2',
        handoffStrategy: 'native-import',
      }),
    );
    expect(handoffStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'native-import',
        status: 'succeeded',
      }),
    );
    expect(handoffStore.recordNativeImportAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        handoffId: 'handoff-1',
        status: 'succeeded',
      }),
    );
  });

  it('GET /api/runtime-sessions/handoffs/summary returns fleet handoff analytics', async () => {
    handoffStore.summarizeRecent.mockResolvedValue({
      total: 5,
      succeeded: 4,
      failed: 1,
      pending: 0,
      nativeImportSuccesses: 2,
      nativeImportFallbacks: 2,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/runtime-sessions/handoffs/summary?limit=50',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      summary: {
        total: 5,
        succeeded: 4,
        failed: 1,
        pending: 0,
        nativeImportSuccesses: 2,
        nativeImportFallbacks: 2,
      },
      limit: 50,
    });
    expect(handoffStore.summarizeRecent).toHaveBeenCalledWith(50);
  });

  it('returns 404 when the source managed session does not exist', async () => {
    managedSessionStore.get.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/ms-missing/handoff',
      payload: {
        targetRuntime: 'claude-code',
        reason: 'manual',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('MANAGED_SESSION_NOT_FOUND');
  });

  it('GET /api/runtime-sessions/:id/handoff/preflight probes native import on the target worker', async () => {
    managedSessionStore.get.mockResolvedValue(makeManagedSession());

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        nativeImportCapable: true,
        attempt: {
          ok: false,
          sourceRuntime: 'codex',
          targetRuntime: 'claude-code',
          reason: 'not_implemented',
          metadata: {
            targetCli: { command: 'claude', available: true, version: '2.1.71' },
          },
        },
      }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/runtime-sessions/ms-source/handoff/preflight?targetRuntime=claude-code',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().nativeImportCapable).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/runtime-sessions/handoff/preflight'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"sourceNativeSessionId":"codex-native-1"'),
      }),
    );
  });

  it('GET /api/runtime-sessions/:id/handoff/preflight targets the requested machine worker', async () => {
    const appWithTargetRegistry = await buildApp(managedSessionStore, handoffStore, runtimeConfigStore, {
      dbRegistry: createMockDbRegistry({
        getMachine: vi.fn(async (machineId: string) => {
          if (machineId === 'machine-2') {
            return {
              id: 'machine-2',
              hostname: 'ec2-runner',
              tailscaleIp: '100.64.0.2',
              os: 'linux',
              arch: 'x64',
              status: 'online',
            };
          }

          return {
            id: 'machine-1',
            hostname: 'mac-mini',
            tailscaleIp: '100.64.0.1',
            os: 'darwin',
            arch: 'arm64',
            status: 'online',
          };
        }),
      }),
    });

    managedSessionStore.get.mockResolvedValue(makeManagedSession());
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        nativeImportCapable: false,
        attempt: {
          ok: false,
          sourceRuntime: 'codex',
          targetRuntime: 'claude-code',
          reason: 'not_implemented',
          metadata: {},
        },
      }),
    });

    const response = await appWithTargetRegistry.inject({
      method: 'GET',
      url: '/api/runtime-sessions/ms-source/handoff/preflight?targetRuntime=claude-code&targetMachineId=machine-2',
    });

    expect(response.statusCode).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('http://100.64.0.2:9000/api/runtime-sessions/handoff/preflight'),
      expect.any(Object),
    );

    await appWithTargetRegistry.close();
  });

  it('POST /api/runtime-sessions/:id/handoff creates the target session on the requested machine', async () => {
    const appWithTargetRegistry = await buildApp(managedSessionStore, handoffStore, runtimeConfigStore, {
      dbRegistry: createMockDbRegistry({
        getMachine: vi.fn(async (machineId: string) => {
          if (machineId === 'machine-2') {
            return {
              id: 'machine-2',
              hostname: 'ec2-runner',
              tailscaleIp: '100.64.0.2',
              os: 'linux',
              arch: 'x64',
              status: 'online',
            };
          }

          return {
            id: 'machine-1',
            hostname: 'mac-mini',
            tailscaleIp: '100.64.0.1',
            os: 'darwin',
            arch: 'arm64',
            status: 'online',
          };
        }),
      }),
    });

    managedSessionStore.get.mockResolvedValue(makeManagedSession());
    managedSessionStore.create.mockResolvedValue(
      makeManagedSession({
        id: 'ms-target',
        runtime: 'claude-code',
        machineId: 'machine-2',
        nativeSessionId: null,
        status: 'starting',
        handoffStrategy: 'snapshot-handoff',
        handoffSourceSessionId: 'ms-source',
      }),
    );
    managedSessionStore.updateStatus.mockImplementation(
      async (id: string, status: ManagedSessionRecord['status'], patch?: Record<string, unknown>) => {
        if (id === 'ms-source') {
          return makeManagedSession({ id, status });
        }

        return makeManagedSession({
          id,
          runtime: 'claude-code',
          machineId: 'machine-2',
          nativeSessionId: (patch?.nativeSessionId as string | null | undefined) ?? 'claude-native-1',
          status,
          handoffStrategy:
            (patch?.handoffStrategy as ManagedSessionRecord['handoffStrategy'] | undefined) ??
            'snapshot-handoff',
          handoffSourceSessionId: 'ms-source',
        });
      },
    );
    handoffStore.create.mockResolvedValue(makeHandoffRecord());
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          strategy: 'snapshot-handoff',
          snapshot: makeSnapshot(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          strategy: 'snapshot-handoff',
          attemptedStrategies: ['snapshot-handoff'],
          session: {
            runtime: 'claude-code',
            sessionId: 'worker-1',
            nativeSessionId: 'claude-native-1',
            agentId: 'agent-1',
            projectPath: '/workspace/app',
            model: 'sonnet',
            status: 'active',
          },
        }),
      });

    const response = await appWithTargetRegistry.inject({
      method: 'POST',
      url: '/api/runtime-sessions/ms-source/handoff',
      payload: {
        targetRuntime: 'claude-code',
        targetMachineId: 'machine-2',
        reason: 'manual',
        prompt: 'Continue on machine-2',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(managedSessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: 'claude-code',
        machineId: 'machine-2',
      }),
    );
    const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
    expect(String(fetchCalls[0]?.[0])).toContain('http://100.64.0.1:9000/api/runtime-sessions/codex-native-1/handoff/export');
    expect(String(fetchCalls[1]?.[0])).toContain('http://100.64.0.2:9000/api/runtime-sessions/handoff');

    await appWithTargetRegistry.close();
  });

  it('POST /api/runtime-sessions/:id/handoff preserves native-import strategy across machines', async () => {
    const appWithTargetRegistry = await buildApp(managedSessionStore, handoffStore, runtimeConfigStore, {
      dbRegistry: createMockDbRegistry({
        getMachine: vi.fn(async (machineId: string) => {
          if (machineId === 'machine-2') {
            return {
              id: 'machine-2',
              hostname: 'ec2-runner',
              tailscaleIp: '100.64.0.2',
              os: 'linux',
              arch: 'x64',
              status: 'online',
            };
          }

          return {
            id: 'machine-1',
            hostname: 'mac-mini',
            tailscaleIp: '100.64.0.1',
            os: 'darwin',
            arch: 'arm64',
            status: 'online',
          };
        }),
      }),
    });

    managedSessionStore.get.mockResolvedValue(makeManagedSession());
    managedSessionStore.create.mockResolvedValue(
      makeManagedSession({
        id: 'ms-target',
        runtime: 'claude-code',
        machineId: 'machine-2',
        nativeSessionId: null,
        status: 'starting',
        handoffStrategy: 'snapshot-handoff',
        handoffSourceSessionId: 'ms-source',
      }),
    );
    managedSessionStore.updateStatus.mockImplementation(
      async (id: string, status: ManagedSessionRecord['status'], patch?: Record<string, unknown>) => {
        if (id === 'ms-source') {
          return makeManagedSession({ id, status });
        }

        return makeManagedSession({
          id,
          runtime: 'claude-code',
          machineId: 'machine-2',
          nativeSessionId: (patch?.nativeSessionId as string | null | undefined) ?? 'claude-native-2',
          status,
          handoffStrategy:
            (patch?.handoffStrategy as ManagedSessionRecord['handoffStrategy'] | undefined) ??
            'snapshot-handoff',
          handoffSourceSessionId: 'ms-source',
        });
      },
    );
    handoffStore.create.mockResolvedValue(
      makeHandoffRecord({
        strategy: 'native-import',
        targetRuntime: 'claude-code',
      }),
    );
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          strategy: 'snapshot-handoff',
          snapshot: makeSnapshot(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          strategy: 'native-import',
          attemptedStrategies: ['native-import', 'snapshot-handoff'],
          nativeImportAttempt: {
            ok: true,
            sourceRuntime: 'codex',
            targetRuntime: 'claude-code',
            reason: 'succeeded',
            metadata: { probe: 'codex-to-claude' },
          },
          session: {
            runtime: 'claude-code',
            sessionId: 'worker-2',
            nativeSessionId: 'claude-native-2',
            agentId: 'agent-1',
            projectPath: '/workspace/app',
            model: 'sonnet',
            status: 'active',
          },
        }),
      });

    const response = await appWithTargetRegistry.inject({
      method: 'POST',
      url: '/api/runtime-sessions/ms-source/handoff',
      payload: {
        targetRuntime: 'claude-code',
        targetMachineId: 'machine-2',
        reason: 'manual',
        prompt: 'Continue on machine-2 via native import',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().strategy).toBe('native-import');
    expect(response.json().session.machineId).toBe('machine-2');
    expect(response.json().session.handoffStrategy).toBe('native-import');
    expect(managedSessionStore.updateStatus).toHaveBeenCalledWith(
      'ms-target',
      'active',
      expect.objectContaining({
        nativeSessionId: 'claude-native-2',
        handoffStrategy: 'native-import',
      }),
    );

    const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
    expect(String(fetchCalls[0]?.[0])).toContain('http://100.64.0.1:9000/api/runtime-sessions/codex-native-1/handoff/export');
    expect(String(fetchCalls[1]?.[0])).toContain('http://100.64.0.2:9000/api/runtime-sessions/handoff');

    await appWithTargetRegistry.close();
  });

  it('GET /api/runtime-sessions/:id/handoffs returns handoff history for the managed session', async () => {
    handoffStore.listForSession.mockResolvedValue([
      makeHandoffRecord(),
      makeHandoffRecord({
        id: 'handoff-2',
        targetRuntime: 'codex',
        status: 'failed',
      }),
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/runtime-sessions/ms-source/handoffs',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().count).toBe(2);
    expect(response.json().handoffs[0].id).toBe('handoff-1');
    expect(handoffStore.listForSession).toHaveBeenCalledWith('ms-source', 20);
  });
});
