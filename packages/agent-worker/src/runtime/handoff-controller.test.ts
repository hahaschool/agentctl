import type { HandoffSnapshot } from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import { HandoffController } from './handoff-controller.js';
import { RuntimeRegistry } from './runtime-registry.js';

function makeSnapshot(overrides: Partial<HandoffSnapshot> = {}): HandoffSnapshot {
  return {
    sourceRuntime: 'claude-code',
    sourceSessionId: 'ms-source',
    sourceNativeSessionId: 'claude-native-source',
    projectPath: '/workspace/app',
    worktreePath: '/workspace/app/.trees/agent-1',
    branch: 'main',
    headSha: 'abc123',
    dirtyFiles: ['packages/agent-worker/src/runtime/handoff-controller.ts'],
    diffSummary: 'Added snapshot handoff support.',
    conversationSummary: 'Continue from the latest runtime snapshot.',
    openTodos: ['wire control-plane handoff route'],
    nextSuggestedPrompt: 'Continue with snapshot handoff.',
    activeConfigRevision: 9,
    activeMcpServers: ['mem0'],
    activeSkills: ['systematic-debugging'],
    reason: 'manual',
    ...overrides,
  };
}

describe('HandoffController', () => {
  it('prefers native import before snapshot handoff when enabled across runtimes', () => {
    const controller = new HandoffController({
      machineId: 'machine-1',
      logger: createMockLogger(),
      runtimeRegistry: new RuntimeRegistry(),
      inspectWorkspace: vi.fn(),
      allowExperimentalNativeImport: true,
    });

    expect(
      controller.pickStrategies({
        sourceRuntime: 'claude-code',
        targetRuntime: 'codex',
      }),
    ).toEqual(['native-import', 'snapshot-handoff']);
  });

  it('uses native import directly when the importer succeeds', async () => {
    const startSession = vi.fn(async () => ({
      runtime: 'codex' as const,
      sessionId: 'worker-fallback',
      nativeSessionId: 'codex-fallback',
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      model: 'gpt-5-codex',
      status: 'active' as const,
      pid: 3333,
      startedAt: new Date('2026-03-09T12:00:00Z'),
      lastActivity: new Date('2026-03-09T12:01:00Z'),
    }));

    const runtimeRegistry = new RuntimeRegistry();
    runtimeRegistry.register({
      runtime: 'codex',
      startSession,
      resumeSession: vi.fn(async () => ({
        runtime: 'codex' as const,
        sessionId: 'worker-native',
        nativeSessionId: 'codex-native-1',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        model: 'gpt-5-codex',
        status: 'active' as const,
        pid: 2222,
        startedAt: new Date('2026-03-09T11:58:00Z'),
        lastActivity: new Date('2026-03-09T11:59:00Z'),
      })),
      forkSession: vi.fn(),
      getCapabilities: vi.fn(async () => ({
        runtime: 'codex',
        supportsResume: true,
        supportsFork: true,
      })),
    });

    const controller = new HandoffController({
      machineId: 'machine-1',
      logger: createMockLogger(),
      runtimeRegistry,
      inspectWorkspace: vi.fn(),
      allowExperimentalNativeImport: true,
      nativeImporters: {
        'claude-code:codex': vi.fn(async () => ({
          ok: true,
          sourceRuntime: 'claude-code',
          targetRuntime: 'codex',
          reason: 'succeeded',
          metadata: { probe: 'claude-to-codex' },
          session: {
            runtime: 'codex',
            sessionId: 'worker-native',
            nativeSessionId: 'codex-native-1',
            agentId: 'agent-1',
            projectPath: '/workspace/app',
            model: 'gpt-5-codex',
            status: 'active',
            pid: 2222,
            startedAt: new Date('2026-03-09T11:58:00Z'),
            lastActivity: new Date('2026-03-09T11:59:00Z'),
          },
        })),
      },
    });

    const result = await controller.handoff({
      targetRuntime: 'codex',
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      prompt: 'Continue through native import.',
      snapshot: makeSnapshot(),
    });

    expect(result.strategy).toBe('native-import');
    expect(result.nativeImportAttempt?.ok).toBe(true);
    expect(result.session.nativeSessionId).toBe('codex-native-1');
    expect(startSession).not.toHaveBeenCalled();
  });

  it('exports a portable handoff snapshot from workspace inspection data', async () => {
    const inspectWorkspace = vi.fn(async () => ({
      worktreePath: '/workspace/app/.trees/agent-1',
      branch: 'feature/runtime-handoff',
      headSha: 'deadbeef',
      dirtyFiles: ['packages/shared/src/protocol/handoff.ts'],
      diffSummary: 'Added shared handoff protocol.',
    }));

    const controller = new HandoffController({
      machineId: 'machine-1',
      logger: createMockLogger(),
      runtimeRegistry: new RuntimeRegistry(),
      inspectWorkspace,
    });

    const snapshot = await controller.exportSnapshot({
      sourceRuntime: 'codex',
      sourceSessionId: 'ms-source',
      nativeSessionId: 'codex-native-1',
      projectPath: '/workspace/app',
      worktreePath: null,
      activeConfigRevision: 9,
      reason: 'manual',
      prompt: 'Continue from the current worktree.',
      activeMcpServers: ['mem0'],
      activeSkills: ['systematic-debugging'],
    });

    expect(snapshot.sourceRuntime).toBe('codex');
    expect(snapshot.branch).toBe('feature/runtime-handoff');
    expect(snapshot.sourceNativeSessionId).toBe('codex-native-1');
    expect(snapshot.nextSuggestedPrompt).toBe('Continue from the current worktree.');
  });

  it('starts the target runtime through snapshot handoff', async () => {
    const startSession = vi.fn(async () => ({
      runtime: 'codex' as const,
      sessionId: 'worker-1',
      nativeSessionId: 'codex-native-2',
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      model: 'gpt-5-codex',
      status: 'active' as const,
      pid: 1234,
      startedAt: new Date('2026-03-09T12:00:00Z'),
      lastActivity: new Date('2026-03-09T12:01:00Z'),
    }));

    const runtimeRegistry = new RuntimeRegistry();
    runtimeRegistry.register({
      runtime: 'codex',
      startSession,
      resumeSession: vi.fn(),
      forkSession: vi.fn(),
      getCapabilities: vi.fn(async () => ({
        runtime: 'codex',
        supportsResume: true,
        supportsFork: true,
      })),
    });

    const controller = new HandoffController({
      machineId: 'machine-1',
      logger: createMockLogger(),
      runtimeRegistry,
      inspectWorkspace: vi.fn(),
    });

    const result = await controller.handoff({
      targetRuntime: 'codex',
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      prompt: 'Continue with snapshot handoff.',
      snapshot: makeSnapshot(),
    });

    expect(result.strategy).toBe('snapshot-handoff');
    expect(result.attemptedStrategies).toEqual(['snapshot-handoff']);
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        prompt: expect.stringContaining('Continue with snapshot handoff.'),
      }),
    );
    expect(result.session.nativeSessionId).toBe('codex-native-2');
  });

  it('falls back to snapshot handoff when native import is enabled but unavailable', async () => {
    const startSession = vi.fn(async () => ({
      runtime: 'codex' as const,
      sessionId: 'worker-2',
      nativeSessionId: 'codex-native-3',
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      model: 'gpt-5-codex',
      status: 'active' as const,
      pid: 4321,
      startedAt: new Date('2026-03-09T12:05:00Z'),
      lastActivity: new Date('2026-03-09T12:06:00Z'),
    }));

    const runtimeRegistry = new RuntimeRegistry();
    runtimeRegistry.register({
      runtime: 'codex',
      startSession,
      resumeSession: vi.fn(),
      forkSession: vi.fn(),
      getCapabilities: vi.fn(async () => ({
        runtime: 'codex',
        supportsResume: true,
        supportsFork: true,
      })),
    });

    const controller = new HandoffController({
      machineId: 'machine-1',
      logger: createMockLogger(),
      runtimeRegistry,
      inspectWorkspace: vi.fn(),
      allowExperimentalNativeImport: true,
      nativeImporters: {
        'claude-code:codex': vi.fn(async () => ({
          ok: false,
          sourceRuntime: 'claude-code',
          targetRuntime: 'codex',
          reason: 'not_implemented',
          metadata: {
            probe: 'claude-to-codex',
            sourceSessionSummary: {
              recentMessages: [
                { role: 'user', text: 'Continue the managed runtime implementation.' },
                { role: 'assistant', text: 'I am probing the native import path next.' },
              ],
            },
          },
        })),
      },
    });

    const result = await controller.handoff({
      targetRuntime: 'codex',
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      prompt: 'Continue after native import fallback.',
      snapshot: makeSnapshot(),
    });

    expect(result.attemptedStrategies).toEqual(['native-import', 'snapshot-handoff']);
    expect(result.strategy).toBe('snapshot-handoff');
    expect(result.nativeImportAttempt?.ok).toBe(false);
    expect(result.nativeImportAttempt?.reason).toBe('not_implemented');
    expect(result.session.nativeSessionId).toBe('codex-native-3');
    expect(startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Recent native messages:'),
      }),
    );
  });
});
