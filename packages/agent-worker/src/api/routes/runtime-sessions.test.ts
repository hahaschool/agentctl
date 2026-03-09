import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeRegistry } from '../../runtime/runtime-registry.js';
import { createSilentLogger } from '../../test-helpers.js';
import { runtimeSessionsRoutes } from './runtime-sessions.js';

async function buildApp(registry: RuntimeRegistry): Promise<FastifyInstance> {
  const Fastify = await import('fastify');
  const app = Fastify.default({ logger: false });
  await app.register(runtimeSessionsRoutes, {
    prefix: '/api/runtime-sessions',
    machineId: 'machine-1',
    runtimeRegistry: registry,
    logger: createSilentLogger(),
  });
  return app;
}

describe('runtimeSessionsRoutes', () => {
  let app: FastifyInstance;
  let registry: RuntimeRegistry;

  beforeEach(async () => {
    registry = new RuntimeRegistry();
    registry.register({
      runtime: 'codex',
      startSession: vi.fn(async () => ({
        runtime: 'codex',
        sessionId: 'managed-1',
        nativeSessionId: 'codex-native-1',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        model: 'gpt-5-codex',
        status: 'active',
        pid: 2222,
        startedAt: new Date('2026-03-09T10:00:00Z'),
        lastActivity: new Date('2026-03-09T10:01:00Z'),
      })),
      resumeSession: vi.fn(async () => ({
        runtime: 'codex',
        sessionId: 'managed-2',
        nativeSessionId: 'codex-native-existing',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        model: 'gpt-5-codex',
        status: 'active',
        pid: 2222,
        startedAt: new Date('2026-03-09T10:00:00Z'),
        lastActivity: new Date('2026-03-09T10:01:00Z'),
      })),
      forkSession: vi.fn(async () => ({
        runtime: 'codex',
        sessionId: 'managed-3',
        nativeSessionId: 'codex-native-fork',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        model: 'gpt-5-codex',
        status: 'active',
        pid: 2222,
        startedAt: new Date('2026-03-09T10:00:00Z'),
        lastActivity: new Date('2026-03-09T10:01:00Z'),
      })),
      getCapabilities: vi.fn(async () => ({
        runtime: 'codex',
        supportsResume: true,
        supportsFork: true,
      })),
    });
    app = await buildApp(registry);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('starts a runtime-aware session and returns its runtime', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions',
      payload: {
        runtime: 'codex',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        prompt: 'Start working',
        model: 'gpt-5-codex',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().session.runtime).toBe('codex');
  });

  it('resumes a runtime-aware session with the native session id in the path', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/codex-native-existing/resume',
      payload: {
        runtime: 'codex',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        prompt: 'Continue working',
        model: 'gpt-5-codex',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().session.nativeSessionId).toBe('codex-native-existing');
  });

  it('forks a runtime-aware session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/codex-native-existing/fork',
      payload: {
        runtime: 'codex',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        prompt: 'Try a different path',
        model: 'gpt-5-codex',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().session.runtime).toBe('codex');
    expect(response.json().session.nativeSessionId).toBe('codex-native-fork');
  });
});
