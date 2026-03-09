import type { FastifyInstance } from 'fastify';
import type { HandoffSnapshot } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandoffController } from '../../runtime/handoff-controller.js';
import { RuntimeRegistry } from '../../runtime/runtime-registry.js';
import { createSilentLogger } from '../../test-helpers.js';
import { runtimeSessionsRoutes } from './runtime-sessions.js';

function makeSnapshot(overrides: Partial<HandoffSnapshot> = {}): HandoffSnapshot {
  return {
    sourceRuntime: 'claude-code',
    sourceSessionId: 'ms-source',
    sourceNativeSessionId: 'claude-native-source',
    projectPath: '/workspace/app',
    worktreePath: '/workspace/app/.trees/agent-1',
    branch: 'main',
    headSha: 'abc123',
    dirtyFiles: ['packages/agent-worker/src/api/routes/runtime-sessions.ts'],
    diffSummary: 'Added runtime handoff routes.',
    conversationSummary: 'Continue from the latest Claude runtime state.',
    openTodos: ['start the target runtime'],
    nextSuggestedPrompt: 'Continue from the handoff snapshot.',
    activeConfigRevision: 9,
    activeMcpServers: ['mem0'],
    activeSkills: ['systematic-debugging'],
    reason: 'manual',
    ...overrides,
  };
}

async function buildApp(
  registry: RuntimeRegistry,
  handoffController: Pick<HandoffController, 'exportSnapshot' | 'handoff' | 'preflightNativeImport'>,
): Promise<FastifyInstance> {
  const Fastify = await import('fastify');
  const app = Fastify.default({ logger: false });
  await app.register(runtimeSessionsRoutes, {
    prefix: '/api/runtime-sessions',
    machineId: 'machine-1',
    runtimeRegistry: registry,
    handoffController,
    logger: createSilentLogger(),
  });
  return app;
}

describe('runtimeSessionsRoutes', () => {
  let app: FastifyInstance;
  let registry: RuntimeRegistry;
  let handoffController: {
    exportSnapshot: ReturnType<typeof vi.fn>;
    handoff: ReturnType<typeof vi.fn>;
    preflightNativeImport: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    registry = new RuntimeRegistry();
    handoffController = {
      exportSnapshot: vi.fn(async () => makeSnapshot()),
      handoff: vi.fn(async () => ({
        ok: true,
        strategy: 'snapshot-handoff',
        attemptedStrategies: ['snapshot-handoff'],
        snapshot: makeSnapshot(),
        session: {
          runtime: 'codex',
          sessionId: 'managed-4',
          nativeSessionId: 'codex-native-handoff',
          agentId: 'agent-1',
          projectPath: '/workspace/app',
          model: 'gpt-5-codex',
          status: 'active',
          pid: 2222,
          startedAt: new Date('2026-03-09T10:00:00Z'),
          lastActivity: new Date('2026-03-09T10:01:00Z'),
        },
      })),
      preflightNativeImport: vi.fn(async () => ({
        ok: true,
        nativeImportCapable: true,
        attempt: {
          ok: false,
          sourceRuntime: 'claude-code',
          targetRuntime: 'codex',
          reason: 'not_implemented',
          metadata: { targetCli: { command: 'codex', available: true, version: 'codex-cli test' } },
        },
      })),
    };
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
    app = await buildApp(registry, handoffController as never);
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

  it('exports a handoff snapshot for the source runtime session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/codex-native-existing/handoff/export',
      payload: {
        sourceRuntime: 'codex',
        sourceSessionId: 'ms-source',
        projectPath: '/workspace/app',
        worktreePath: '/workspace/app/.trees/agent-1',
        activeConfigRevision: 9,
        reason: 'manual',
        prompt: 'Continue from the latest worktree state.',
        activeMcpServers: ['mem0'],
        activeSkills: ['systematic-debugging'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().strategy).toBe('snapshot-handoff');
    expect(response.json().snapshot.reason).toBe('manual');
    expect(response.json().snapshot.sourceNativeSessionId).toBe('claude-native-source');
  });

  it('starts a target runtime from a snapshot handoff request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/handoff',
      payload: {
        targetRuntime: 'codex',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        prompt: 'Continue from the exported snapshot.',
        snapshot: makeSnapshot(),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().strategy).toBe('snapshot-handoff');
    expect(response.json().session.nativeSessionId).toBe('codex-native-handoff');
  });

  it('probes native import prerequisites before handoff', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/handoff/preflight',
      payload: {
        targetRuntime: 'codex',
        projectPath: '/workspace/app',
        snapshot: makeSnapshot(),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().nativeImportCapable).toBe(true);
    expect(handoffController.preflightNativeImport).toHaveBeenCalledWith({
      sourceRuntime: 'claude-code',
      targetRuntime: 'codex',
      projectPath: '/workspace/app',
      snapshot: makeSnapshot(),
    });
  });
});
