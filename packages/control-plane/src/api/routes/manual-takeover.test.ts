import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ManualTakeoverState } from '@agentctl/shared';

import type { ManagedSessionRecord } from '../../runtime-management/managed-session-store.js';
import { manualTakeoverRoutes } from './manual-takeover.js';
import {
  createMockDbRegistry,
  mockFetchOk,
  saveOriginalFetch,
} from './test-helpers.js';

const originalFetch = saveOriginalFetch();

type ManagedSessionStoreMock = {
  get: ReturnType<typeof vi.fn>;
  patchMetadata: ReturnType<typeof vi.fn>;
};

function makeManagedSession(overrides: Partial<ManagedSessionRecord> = {}): ManagedSessionRecord {
  return {
    id: 'ms-1',
    runtime: 'claude-code',
    nativeSessionId: 'claude-native-1',
    machineId: 'machine-1',
    agentId: 'agent-1',
    projectPath: '/workspace/app',
    worktreePath: null,
    status: 'active',
    configRevision: 7,
    handoffStrategy: null,
    handoffSourceSessionId: null,
    metadata: {},
    startedAt: new Date('2026-03-11T10:00:00Z'),
    lastHeartbeat: new Date('2026-03-11T10:05:00Z'),
    endedAt: null,
    ...overrides,
  };
}

function makeManualTakeover(overrides: Partial<ManualTakeoverState> = {}): ManualTakeoverState {
  return {
    workerSessionId: 'worker-1',
    nativeSessionId: 'claude-native-1',
    projectPath: '/workspace/app',
    status: 'online',
    permissionMode: 'plan',
    sessionUrl: 'https://claude.ai/code/session-123',
    startedAt: '2026-03-11T10:01:00.000Z',
    lastHeartbeat: '2026-03-11T10:06:00.000Z',
    lastVerifiedAt: '2026-03-11T10:06:30.000Z',
    error: null,
    ...overrides,
  };
}

async function buildApp(
  managedSessionStore: ManagedSessionStoreMock,
  dbRegistry = createMockDbRegistry(),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(manualTakeoverRoutes, {
    prefix: '/api/runtime-sessions',
    managedSessionStore: managedSessionStore as never,
    dbRegistry,
    workerPort: 9000,
  });
  await app.ready();
  return app;
}

describe('manualTakeoverRoutes', () => {
  let app: FastifyInstance;
  let managedSessionStore: ManagedSessionStoreMock;

  beforeAll(async () => {
    managedSessionStore = {
      get: vi.fn(),
      patchMetadata: vi.fn(),
    };
    app = await buildApp(managedSessionStore);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/runtime-sessions/:id/manual-takeover rejects non-Claude sessions', async () => {
    managedSessionStore.get.mockResolvedValue(makeManagedSession({ runtime: 'codex' }));
    globalThis.fetch = vi.fn();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/ms-1/manual-takeover',
      payload: { permissionMode: 'plan' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_MANUAL_TAKEOVER_RUNTIME',
      message: 'Manual takeover is only available for Claude Code managed sessions',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POST proxies to the worker and stores metadata.manualTakeover', async () => {
    const manualTakeover = makeManualTakeover();
    managedSessionStore.get.mockResolvedValue(makeManagedSession());
    managedSessionStore.patchMetadata.mockResolvedValue(
      makeManagedSession({ metadata: { manualTakeover } }),
    );
    mockFetchOk({
      ok: true,
      manualTakeover,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/ms-1/manual-takeover',
      payload: { permissionMode: 'plan' },
    });

    expect(response.statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://100.64.0.1:9000/api/runtime-sessions/claude-native-1/manual-takeover',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          agentId: 'agent-1',
          projectPath: '/workspace/app',
          permissionMode: 'plan',
        }),
      }),
    );
    expect(managedSessionStore.patchMetadata).toHaveBeenCalledWith('ms-1', {
      manualTakeover,
    });
    expect(response.json()).toEqual({ ok: true, manualTakeover });
  });

  it('GET reconciles stale stored state when the worker no longer has the RC session', async () => {
    const storedTakeover = makeManualTakeover({
      status: 'online',
      lastVerifiedAt: '2026-03-11T10:06:30.000Z',
    });
    managedSessionStore.get.mockResolvedValue(
      makeManagedSession({
        metadata: {
          manualTakeover: storedTakeover,
          sourceRuntime: 'claude-code',
        },
      }),
    );
    managedSessionStore.patchMetadata.mockResolvedValue(
      makeManagedSession({
        metadata: {
          manualTakeover: {
            ...storedTakeover,
            status: 'stopped',
            sessionUrl: null,
          },
        },
      }),
    );
    mockFetchOk({
      ok: true,
      manualTakeover: null,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/runtime-sessions/ms-1/manual-takeover',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.manualTakeover).toMatchObject({
      workerSessionId: 'worker-1',
      nativeSessionId: 'claude-native-1',
      status: 'stopped',
      sessionUrl: null,
      permissionMode: 'plan',
    });
    expect(managedSessionStore.patchMetadata).toHaveBeenCalledWith('ms-1', {
      manualTakeover: expect.objectContaining({
        status: 'stopped',
        sessionUrl: null,
      }),
    });
  });

  it('DELETE proxies revoke and persists a terminal takeover state', async () => {
    const manualTakeover = makeManualTakeover({
      status: 'stopped',
      sessionUrl: null,
      lastVerifiedAt: '2026-03-11T10:07:00.000Z',
    });
    managedSessionStore.get.mockResolvedValue(
      makeManagedSession({
        metadata: { manualTakeover: makeManualTakeover() },
      }),
    );
    managedSessionStore.patchMetadata.mockResolvedValue(
      makeManagedSession({ metadata: { manualTakeover } }),
    );
    mockFetchOk({
      ok: true,
      manualTakeover,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/runtime-sessions/ms-1/manual-takeover',
    });

    expect(response.statusCode).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      'http://100.64.0.1:9000/api/runtime-sessions/claude-native-1/manual-takeover',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
    expect(managedSessionStore.patchMetadata).toHaveBeenCalledWith('ms-1', {
      manualTakeover,
    });
    expect(response.json()).toEqual({ ok: true, manualTakeover });
  });
});
