import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ManagedSessionRecord } from '../../runtime-management/managed-session-store.js';
import { runtimeSessionRoutes } from './runtime-sessions.js';
import {
  createMockDbRegistry,
  makeMachine,
  mockFetchOk,
  saveOriginalFetch,
} from './test-helpers.js';

const originalFetch = saveOriginalFetch();

type ManagedSessionStoreMock = {
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  updateStatus: ReturnType<typeof vi.fn>;
};

type RuntimeConfigStoreMock = {
  getLatestRevision: ReturnType<typeof vi.fn>;
};

function makeManagedSession(overrides: Partial<ManagedSessionRecord> = {}): ManagedSessionRecord {
  return {
    id: 'ms-1',
    runtime: 'codex',
    nativeSessionId: 'codex-native-1',
    machineId: 'machine-1',
    agentId: 'agent-1',
    projectPath: '/workspace/app',
    worktreePath: null,
    status: 'active',
    configRevision: 9,
    handoffStrategy: null,
    handoffSourceSessionId: null,
    metadata: {},
    startedAt: new Date('2026-03-09T10:00:00Z'),
    lastHeartbeat: new Date('2026-03-09T10:05:00Z'),
    endedAt: null,
    ...overrides,
  };
}

async function buildApp(
  managedSessionStore: ManagedSessionStoreMock,
  runtimeConfigStore: RuntimeConfigStoreMock,
  options?: {
    dbRegistry?: ReturnType<typeof createMockDbRegistry>;
  },
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(runtimeSessionRoutes, {
    prefix: '/api/runtime-sessions',
    managedSessionStore: managedSessionStore as never,
    runtimeConfigStore: runtimeConfigStore as never,
    dbRegistry: (options?.dbRegistry ?? createMockDbRegistry()) as never,
    workerPort: 9000,
  });
  await app.ready();
  return app;
}

describe('runtimeSessionRoutes', () => {
  let app: FastifyInstance;
  let managedSessionStore: ManagedSessionStoreMock;
  let runtimeConfigStore: RuntimeConfigStoreMock;

  beforeAll(async () => {
    managedSessionStore = {
      list: vi.fn(),
      create: vi.fn(),
      get: vi.fn(),
      updateStatus: vi.fn(),
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
    app = await buildApp(managedSessionStore, runtimeConfigStore);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/runtime-sessions returns managed sessions with runtime info', async () => {
    managedSessionStore.list.mockResolvedValue([
      makeManagedSession(),
      makeManagedSession({ id: 'ms-2', runtime: 'claude-code' }),
    ]);

    const response = await app.inject({ method: 'GET', url: '/api/runtime-sessions' });

    expect(response.statusCode).toBe(200);
    expect(response.json().sessions).toHaveLength(2);
    expect(response.json().sessions[0].runtime).toBe('codex');
  });

  it('POST /api/runtime-sessions creates a managed session and proxies the start to the worker', async () => {
    managedSessionStore.create.mockResolvedValue(
      makeManagedSession({
        id: 'ms-start',
        nativeSessionId: null,
        status: 'starting',
      }),
    );
    managedSessionStore.updateStatus.mockResolvedValue(
      makeManagedSession({
        id: 'ms-start',
        nativeSessionId: 'codex-native-1',
        status: 'active',
      }),
    );
    mockFetchOk({
      ok: true,
      session: {
        runtime: 'codex',
        sessionId: 'managed-worker-1',
        nativeSessionId: 'codex-native-1',
        status: 'active',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions',
      payload: {
        runtime: 'codex',
        machineId: 'machine-1',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        prompt: 'Start working',
        model: 'gpt-5-codex',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(managedSessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: 'codex',
        machineId: 'machine-1',
        configRevision: 9,
      }),
    );
    expect(response.json().session.status).toBe('active');
  });

  it('POST /api/runtime-sessions/:id/resume resumes the stored runtime session', async () => {
    managedSessionStore.get.mockResolvedValue(
      makeManagedSession({
        id: 'ms-resume',
        nativeSessionId: 'codex-native-existing',
      }),
    );
    managedSessionStore.updateStatus.mockResolvedValue(
      makeManagedSession({
        id: 'ms-resume',
        nativeSessionId: 'codex-native-existing',
        status: 'active',
      }),
    );
    mockFetchOk({
      ok: true,
      session: {
        runtime: 'codex',
        nativeSessionId: 'codex-native-existing',
        status: 'active',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/ms-resume/resume',
      payload: {
        prompt: 'Continue working',
        model: 'gpt-5-codex',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().session.nativeSessionId).toBe('codex-native-existing');
  });

  it('POST /api/runtime-sessions/:id/fork creates a new managed fork session', async () => {
    managedSessionStore.get.mockResolvedValue(
      makeManagedSession({
        id: 'ms-parent',
        nativeSessionId: 'codex-native-existing',
      }),
    );
    managedSessionStore.create.mockResolvedValue(
      makeManagedSession({
        id: 'ms-fork',
        nativeSessionId: null,
        status: 'starting',
        handoffSourceSessionId: 'ms-parent',
      }),
    );
    managedSessionStore.updateStatus.mockResolvedValue(
      makeManagedSession({
        id: 'ms-fork',
        nativeSessionId: 'codex-native-fork',
        status: 'active',
        handoffSourceSessionId: 'ms-parent',
      }),
    );
    mockFetchOk({
      ok: true,
      session: {
        runtime: 'codex',
        nativeSessionId: 'codex-native-fork',
        status: 'active',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/ms-parent/fork',
      payload: {
        prompt: 'Try a different implementation',
        model: 'gpt-5-codex',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(managedSessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: 'codex',
        handoffSourceSessionId: 'ms-parent',
      }),
    );
    expect(response.json().session.nativeSessionId).toBe('codex-native-fork');
  });

  it('POST /api/runtime-sessions/:id/fork targets the requested machine worker', async () => {
    const appWithTargetRegistry = await buildApp(managedSessionStore, runtimeConfigStore, {
      dbRegistry: createMockDbRegistry({
        getMachine: vi.fn(async (machineId: string) => {
          if (machineId === 'machine-2') {
            return makeMachine({
              id: 'machine-2',
              hostname: 'ec2-runner',
              tailscaleIp: '100.64.0.2',
              os: 'linux',
            });
          }

          return makeMachine({
            id: 'machine-1',
            hostname: 'mac-mini',
            tailscaleIp: '100.64.0.1',
            os: 'darwin',
            arch: 'arm64',
          });
        }),
      }),
    });

    managedSessionStore.get.mockResolvedValue(
      makeManagedSession({
        id: 'ms-parent',
        machineId: 'machine-1',
        nativeSessionId: 'codex-native-existing',
      }),
    );
    managedSessionStore.create.mockResolvedValue(
      makeManagedSession({
        id: 'ms-fork',
        machineId: 'machine-2',
        nativeSessionId: null,
        status: 'starting',
        handoffSourceSessionId: 'ms-parent',
      }),
    );
    managedSessionStore.updateStatus.mockResolvedValue(
      makeManagedSession({
        id: 'ms-fork',
        machineId: 'machine-2',
        nativeSessionId: 'codex-native-fork',
        status: 'active',
        handoffSourceSessionId: 'ms-parent',
      }),
    );
    mockFetchOk({
      ok: true,
      session: {
        runtime: 'codex',
        nativeSessionId: 'codex-native-fork',
        status: 'active',
      },
    });

    const response = await appWithTargetRegistry.inject({
      method: 'POST',
      url: '/api/runtime-sessions/ms-parent/fork',
      payload: {
        prompt: 'Fork onto machine-2',
        model: 'gpt-5-codex',
        targetMachineId: 'machine-2',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(managedSessionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        handoffSourceSessionId: 'ms-parent',
        machineId: 'machine-2',
      }),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        'http://100.64.0.2:9000/api/runtime-sessions/codex-native-existing/fork',
      ),
      expect.any(Object),
    );

    await appWithTargetRegistry.close();
  });
});
