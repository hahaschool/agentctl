import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { manualTakeoverRoutes } from './manual-takeover.js';

async function buildApp(rcSessionManager: {
  startSession: ReturnType<typeof vi.fn>;
  getSessionByNativeSessionId: ReturnType<typeof vi.fn>;
  getSessionByProjectPath: ReturnType<typeof vi.fn>;
  stopSession: ReturnType<typeof vi.fn>;
}): Promise<FastifyInstance> {
  const Fastify = await import('fastify');
  const app = Fastify.default({ logger: false });
  await app.register(manualTakeoverRoutes, {
    prefix: '/api/runtime-sessions',
    logger: createSilentLogger(),
    rcSessionManager,
  });
  return app;
}

describe('manualTakeoverRoutes', () => {
  let app: FastifyInstance;
  let rcSessionManager: {
    startSession: ReturnType<typeof vi.fn>;
    getSessionByNativeSessionId: ReturnType<typeof vi.fn>;
    getSessionByProjectPath: ReturnType<typeof vi.fn>;
    stopSession: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    rcSessionManager = {
      startSession: vi.fn(async () => ({
        id: 'rc-1',
        agentId: 'agent-1',
        pid: 1234,
        sessionUrl: 'https://claude.ai/code/session-123',
        nativeSessionId: 'claude-native-1',
        status: 'online',
        permissionMode: 'plan',
        projectPath: '/workspace/app',
        startedAt: new Date('2026-03-11T10:00:00Z'),
        lastHeartbeat: new Date('2026-03-11T10:00:10Z'),
        error: null,
      })),
      getSessionByNativeSessionId: vi.fn(),
      getSessionByProjectPath: vi.fn(),
      stopSession: vi.fn(async () => undefined),
    };
    app = await buildApp(rcSessionManager);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('starts a manual takeover for an existing native session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/claude-native-1/manual-takeover',
      payload: {
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        permissionMode: 'plan',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(rcSessionManager.startSession).toHaveBeenCalledWith({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      resumeSessionId: 'claude-native-1',
      permissionMode: 'plan',
    });
    expect(response.json().manualTakeover).toMatchObject({
      workerSessionId: 'rc-1',
      nativeSessionId: 'claude-native-1',
      status: 'online',
      permissionMode: 'plan',
    });
  });

  it('reuses an existing manual takeover for the same native session', async () => {
    rcSessionManager.getSessionByNativeSessionId.mockReturnValue({
      id: 'rc-existing',
      agentId: 'agent-1',
      pid: 1234,
      sessionUrl: 'https://claude.ai/code/session-existing',
      nativeSessionId: 'claude-native-1',
      status: 'online',
      permissionMode: 'default',
      projectPath: '/workspace/app',
      startedAt: new Date('2026-03-11T10:00:00Z'),
      lastHeartbeat: new Date('2026-03-11T10:00:10Z'),
      error: null,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/claude-native-1/manual-takeover',
      payload: {
        agentId: 'agent-1',
        projectPath: '/workspace/app',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(rcSessionManager.startSession).not.toHaveBeenCalled();
    expect(response.json().manualTakeover.workerSessionId).toBe('rc-existing');
  });

  it('reuses an existing manual takeover for the same project path', async () => {
    rcSessionManager.getSessionByProjectPath.mockReturnValue({
      id: 'rc-project',
      agentId: 'agent-1',
      pid: 1234,
      sessionUrl: 'https://claude.ai/code/session-existing',
      nativeSessionId: 'claude-native-2',
      status: 'online',
      permissionMode: 'default',
      projectPath: '/workspace/app',
      startedAt: new Date('2026-03-11T10:00:00Z'),
      lastHeartbeat: new Date('2026-03-11T10:00:10Z'),
      error: null,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/claude-native-1/manual-takeover',
      payload: {
        agentId: 'agent-1',
        projectPath: '/workspace/app',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(rcSessionManager.startSession).not.toHaveBeenCalled();
    expect(response.json().manualTakeover.workerSessionId).toBe('rc-project');
  });

  it('returns the current takeover state for GET', async () => {
    rcSessionManager.getSessionByNativeSessionId.mockReturnValue({
      id: 'rc-get',
      agentId: 'agent-1',
      pid: 1234,
      sessionUrl: 'https://claude.ai/code/session-get',
      nativeSessionId: 'claude-native-1',
      status: 'online',
      permissionMode: 'default',
      projectPath: '/workspace/app',
      startedAt: new Date('2026-03-11T10:00:00Z'),
      lastHeartbeat: new Date('2026-03-11T10:00:10Z'),
      error: null,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/runtime-sessions/claude-native-1/manual-takeover',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().manualTakeover.workerSessionId).toBe('rc-get');
  });

  it('stops a manual takeover and returns a stopped state', async () => {
    rcSessionManager.getSessionByNativeSessionId.mockReturnValue({
      id: 'rc-stop',
      agentId: 'agent-1',
      pid: 1234,
      sessionUrl: 'https://claude.ai/code/session-stop',
      nativeSessionId: 'claude-native-1',
      status: 'online',
      permissionMode: 'default',
      projectPath: '/workspace/app',
      startedAt: new Date('2026-03-11T10:00:00Z'),
      lastHeartbeat: new Date('2026-03-11T10:00:10Z'),
      error: null,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/runtime-sessions/claude-native-1/manual-takeover',
    });

    expect(response.statusCode).toBe(200);
    expect(rcSessionManager.stopSession).toHaveBeenCalledWith('rc-stop');
    expect(response.json().manualTakeover).toMatchObject({
      workerSessionId: 'rc-stop',
      nativeSessionId: 'claude-native-1',
      status: 'stopped',
    });
  });
});
