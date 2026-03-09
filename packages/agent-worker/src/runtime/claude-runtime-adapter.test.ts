import type { CliSessionManager } from './cli-session-manager.js';
import { describe, expect, it, vi } from 'vitest';

import { ClaudeRuntimeAdapter } from './claude-runtime-adapter.js';

function createMockCliSessionManager(): Pick<CliSessionManager, 'startSession'> {
  return {
    startSession: vi.fn((options) => ({
      id: 'cli-1',
      claudeSessionId: options.resumeSessionId ?? 'claude-native-1',
      agentId: options.agentId,
      projectPath: options.projectPath,
      status: 'running',
      model: options.model ?? 'sonnet',
      pid: 1234,
      costUsd: 0,
      messageCount: 1,
      startedAt: new Date('2026-03-09T10:00:00Z'),
      lastActivity: new Date('2026-03-09T10:01:00Z'),
      isResumed: Boolean(options.resumeSessionId),
      lastError: null,
    })),
  };
}

describe('ClaudeRuntimeAdapter', () => {
  it('starts a managed Claude session by delegating to CliSessionManager', async () => {
    const manager = createMockCliSessionManager();
    const adapter = new ClaudeRuntimeAdapter(manager as CliSessionManager);

    const session = await adapter.startSession({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      prompt: 'Fix the auth bug',
      model: 'opus',
    });

    expect(manager.startSession).toHaveBeenCalledWith({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      prompt: 'Fix the auth bug',
      model: 'opus',
      resumeSessionId: undefined,
    });
    expect(session).toMatchObject({
      runtime: 'claude-code',
      nativeSessionId: 'claude-native-1',
      status: 'active',
      projectPath: '/workspace/app',
    });
  });

  it('resumes a managed Claude session using the native session id', async () => {
    const manager = createMockCliSessionManager();
    const adapter = new ClaudeRuntimeAdapter(manager as CliSessionManager);

    const session = await adapter.resumeSession({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      nativeSessionId: 'claude-native-existing',
      prompt: 'Continue from the previous state',
      model: 'sonnet',
    });

    expect(manager.startSession).toHaveBeenCalledWith({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      prompt: 'Continue from the previous state',
      model: 'sonnet',
      resumeSessionId: 'claude-native-existing',
    });
    expect(session).toMatchObject({
      runtime: 'claude-code',
      nativeSessionId: 'claude-native-existing',
      status: 'active',
    });
  });

  it('reports Claude runtime capabilities', async () => {
    const adapter = new ClaudeRuntimeAdapter(createMockCliSessionManager() as CliSessionManager);

    await expect(adapter.getCapabilities()).resolves.toMatchObject({
      runtime: 'claude-code',
      supportsResume: true,
      supportsFork: false,
    });
  });
});
