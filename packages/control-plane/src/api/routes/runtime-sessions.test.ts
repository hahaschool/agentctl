import type { RunHandoffDecision } from '@agentctl/shared';
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

type RunHandoffDecisionStoreMock = {
  create: ReturnType<typeof vi.fn>;
  listForRun: ReturnType<typeof vi.fn>;
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

function makeRunHandoffDecision(overrides: Partial<RunHandoffDecision> = {}): RunHandoffDecision {
  return {
    id: 'decision-1',
    sourceRunId: 'run-1',
    sourceManagedSessionId: 'ms-1',
    targetRunId: null,
    handoffId: null,
    trigger: 'task-affinity',
    stage: 'dispatch',
    mode: 'dry-run',
    status: 'suggested',
    dedupeKey: 'run-1:dispatch:task-affinity:claude-code',
    reason: 'Frontend-heavy interface work benefits from Claude Code session context.',
    skippedReason: null,
    policySnapshot: {
      enabled: true,
      mode: 'dry-run',
      maxAutomaticHandoffsPerRun: 1,
      cooldownMs: 600000,
    },
    signalPayload: {
      prompt: 'Polish the React CSS UI for this page.',
      targetRuntime: 'claude-code',
    },
    createdAt: '2026-03-11T10:00:00.000Z',
    updatedAt: '2026-03-11T10:00:00.000Z',
    ...overrides,
  };
}

async function buildApp(
  managedSessionStore: ManagedSessionStoreMock,
  runtimeConfigStore: RuntimeConfigStoreMock,
  runHandoffDecisionStore: RunHandoffDecisionStoreMock,
  options?: {
    dbRegistry?: ReturnType<typeof createMockDbRegistry>;
  },
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(runtimeSessionRoutes, {
    prefix: '/api/runtime-sessions',
    managedSessionStore: managedSessionStore as never,
    runtimeConfigStore: runtimeConfigStore as never,
    runHandoffDecisionStore: runHandoffDecisionStore as never,
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
  let runHandoffDecisionStore: RunHandoffDecisionStoreMock;

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
    runHandoffDecisionStore = {
      create: vi.fn(),
      listForRun: vi.fn().mockResolvedValue([]),
    };
    app = await buildApp(managedSessionStore, runtimeConfigStore, runHandoffDecisionStore);
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
    expect(runHandoffDecisionStore.listForRun).not.toHaveBeenCalled();
    expect(runHandoffDecisionStore.create).not.toHaveBeenCalled();
    expect(response.json().session.status).toBe('active');
  });

  it('POST /api/runtime-sessions records a dry-run task-affinity suggestion when runId is present', async () => {
    managedSessionStore.create.mockResolvedValue(
      makeManagedSession({
        id: 'ms-affinity',
        runtime: 'codex',
        nativeSessionId: null,
        status: 'starting',
      }),
    );
    managedSessionStore.updateStatus.mockResolvedValue(
      makeManagedSession({
        id: 'ms-affinity',
        runtime: 'codex',
        nativeSessionId: 'codex-native-1',
        status: 'active',
      }),
    );
    runHandoffDecisionStore.listForRun.mockResolvedValue([]);
    runHandoffDecisionStore.create.mockImplementation(async (input: RunHandoffDecision) =>
      makeRunHandoffDecision({
        ...input,
        id: 'decision-affinity',
        sourceRunId: input.sourceRunId,
        sourceManagedSessionId: input.sourceManagedSessionId,
        status: input.status,
        dedupeKey: input.dedupeKey,
        reason: input.reason,
        skippedReason: input.skippedReason,
        policySnapshot: input.policySnapshot,
        signalPayload: input.signalPayload,
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
        projectPath: '/workspace/app',
        prompt: 'Polish the React CSS UI for this page.',
        runId: 'run-affinity-1',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(runHandoffDecisionStore.listForRun).toHaveBeenCalledWith('run-affinity-1', 100);
    expect(runHandoffDecisionStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRunId: 'run-affinity-1',
        sourceManagedSessionId: 'ms-affinity',
        trigger: 'task-affinity',
        stage: 'dispatch',
        status: 'suggested',
        dedupeKey: 'run-affinity-1:dispatch:task-affinity:claude-code',
        signalPayload: expect.objectContaining({
          prompt: 'Polish the React CSS UI for this page.',
          targetRuntime: 'claude-code',
          matchedRuleId: 'frontend-heavy-to-claude',
        }),
      }),
    );
  });

  it('POST /api/runtime-sessions collapses duplicate task-affinity evaluations within the same run', async () => {
    managedSessionStore.create
      .mockResolvedValueOnce(
        makeManagedSession({
          id: 'ms-affinity-1',
          runtime: 'codex',
          nativeSessionId: null,
          status: 'starting',
        }),
      )
      .mockResolvedValueOnce(
        makeManagedSession({
          id: 'ms-affinity-2',
          runtime: 'codex',
          nativeSessionId: null,
          status: 'starting',
        }),
      );
    managedSessionStore.updateStatus
      .mockResolvedValueOnce(
        makeManagedSession({
          id: 'ms-affinity-1',
          runtime: 'codex',
          nativeSessionId: 'codex-native-1',
          status: 'active',
        }),
      )
      .mockResolvedValueOnce(
        makeManagedSession({
          id: 'ms-affinity-2',
          runtime: 'codex',
          nativeSessionId: 'codex-native-2',
          status: 'active',
        }),
      );
    const existingDecision = makeRunHandoffDecision({
      id: 'decision-existing',
      sourceRunId: 'run-affinity-dup',
      sourceManagedSessionId: 'ms-affinity-1',
      dedupeKey: 'run-affinity-dup:dispatch:task-affinity:claude-code',
    });
    runHandoffDecisionStore.listForRun
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existingDecision]);
    runHandoffDecisionStore.create.mockResolvedValue(existingDecision);
    mockFetchOk({
      ok: true,
      session: {
        runtime: 'codex',
        sessionId: 'managed-worker-1',
        nativeSessionId: 'codex-native-1',
        status: 'active',
      },
    });

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions',
      payload: {
        runtime: 'codex',
        machineId: 'machine-1',
        projectPath: '/workspace/app',
        prompt: 'Polish the React CSS UI for this page.',
        runId: 'run-affinity-dup',
      },
    });
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions',
      payload: {
        runtime: 'codex',
        machineId: 'machine-1',
        projectPath: '/workspace/app',
        prompt: 'Polish the React CSS UI for this page.',
        runId: 'run-affinity-dup',
      },
    });

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(201);
    expect(runHandoffDecisionStore.create).toHaveBeenCalledTimes(1);
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
    const appWithTargetRegistry = await buildApp(
      managedSessionStore,
      runtimeConfigStore,
      runHandoffDecisionStore,
      {
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
      },
    );

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
