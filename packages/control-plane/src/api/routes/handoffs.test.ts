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
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(handoffRoutes, {
    prefix: '/api/runtime-sessions',
    managedSessionStore: managedSessionStore as never,
    handoffStore: handoffStore as never,
    runtimeConfigStore: runtimeConfigStore as never,
    dbRegistry: createMockDbRegistry(),
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
          handoffStrategy: 'snapshot-handoff',
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
    expect(handoffStore.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSessionId: 'ms-source',
        targetRuntime: 'claude-code',
        status: 'succeeded',
      }),
    );
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
});
