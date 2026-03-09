import type { CodexSessionManager } from './codex-session-manager.js';
import { describe, expect, it, vi } from 'vitest';

import { CodexRuntimeAdapter } from './codex-runtime-adapter.js';

function createMockManager(): Pick<CodexSessionManager, 'startSession' | 'resumeSession' | 'forkSession'> {
  return {
    startSession: vi.fn(async (input) => ({
      runtime: 'codex',
      id: 'codex-worker-1',
      nativeSessionId: 'codex-native-1',
      agentId: input.agentId,
      projectPath: input.projectPath,
      status: 'running',
      model: input.model ?? 'gpt-5-codex',
      pid: 3333,
      startedAt: new Date('2026-03-09T10:00:00Z'),
      lastActivity: new Date('2026-03-09T10:01:00Z'),
      isResumed: false,
      lastError: null,
    })),
    resumeSession: vi.fn(async (input) => ({
      runtime: 'codex',
      id: 'codex-worker-2',
      nativeSessionId: input.nativeSessionId,
      agentId: input.agentId,
      projectPath: input.projectPath,
      status: 'running',
      model: input.model ?? 'gpt-5-codex',
      pid: 3333,
      startedAt: new Date('2026-03-09T10:00:00Z'),
      lastActivity: new Date('2026-03-09T10:01:00Z'),
      isResumed: true,
      lastError: null,
    })),
    forkSession: vi.fn(async (input) => ({
      runtime: 'codex',
      id: 'codex-worker-3',
      nativeSessionId: 'codex-native-fork',
      agentId: input.agentId,
      projectPath: input.projectPath,
      status: 'running',
      model: input.model ?? 'gpt-5-codex',
      pid: 3333,
      startedAt: new Date('2026-03-09T10:00:00Z'),
      lastActivity: new Date('2026-03-09T10:01:00Z'),
      isResumed: false,
      lastError: null,
    })),
  };
}

describe('CodexRuntimeAdapter', () => {
  it('starts a managed Codex session', async () => {
    const manager = createMockManager();
    const adapter = new CodexRuntimeAdapter(manager as CodexSessionManager);

    const session = await adapter.startSession({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      prompt: 'Start working',
      model: 'gpt-5-codex',
    });

    expect(manager.startSession).toHaveBeenCalledOnce();
    expect(session).toMatchObject({
      runtime: 'codex',
      nativeSessionId: 'codex-native-1',
      status: 'active',
    });
  });

  it('forks a managed Codex session', async () => {
    const manager = createMockManager();
    const adapter = new CodexRuntimeAdapter(manager as CodexSessionManager);

    const session = await adapter.forkSession({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      nativeSessionId: 'codex-native-1',
      prompt: 'Explore another solution',
      model: 'gpt-5-codex',
    });

    expect(manager.forkSession).toHaveBeenCalledOnce();
    expect(session).toMatchObject({
      runtime: 'codex',
      nativeSessionId: 'codex-native-fork',
      status: 'active',
    });
  });
});
