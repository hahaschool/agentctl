/**
 * Codex sandbox constraint tests.
 *
 * These tests verify that the sandbox level flows end-to-end from
 * StartCodexSessionOptions / ForkCodexSessionOptions all the way through
 * to the `--sandbox` flag passed to the Codex CLI process.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { CodexRuntimeAdapter } from './codex-runtime-adapter.js';
import { type CodexSandboxLevel, CodexSessionManager } from './codex-session-manager.js';

// ---------------------------------------------------------------------------
// Mock spawn
// ---------------------------------------------------------------------------

const spawnSpy = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnSpy(...args),
}));

type MockChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  pid: number;
  kill: ReturnType<typeof vi.fn>;
};

function createMockChild(pid = 5000): MockChild {
  const emitter = new EventEmitter() as MockChild;
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.pid = pid;
  emitter.kill = vi.fn(() => true);
  return emitter;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function startWithSandbox(
  sandboxLevel: CodexSandboxLevel | null | undefined,
): Promise<{ args: string[] }> {
  const child = createMockChild();
  spawnSpy.mockReturnValue(child);

  const manager = new CodexSessionManager({
    codexPath: '/usr/local/bin/codex',
    startupTimeoutMs: 50,
  });

  const promise = manager.startSession({
    agentId: 'agent-sandbox',
    projectPath: '/workspace/app',
    prompt: 'Do work',
    model: 'gpt-5-codex',
    sandboxLevel,
  });

  // Emit native session id so startup resolves immediately
  child.stdout.write('{"session_id":"native-abc"}\n');
  await tick();
  await promise;

  const [, args] = spawnSpy.mock.calls[0] as [string, string[], unknown];
  await manager.stopAll();
  return { args };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Codex sandbox constraint enforcement', () => {
  it('passes --sandbox read-only when sandboxLevel is read-only', async () => {
    spawnSpy.mockClear();
    const { args } = await startWithSandbox('read-only');
    expect(args).toContain('--sandbox');
    const sandboxIdx = args.indexOf('--sandbox');
    expect(args[sandboxIdx + 1]).toBe('read-only');
  });

  it('passes --sandbox workspace-write when sandboxLevel is workspace-write', async () => {
    spawnSpy.mockClear();
    const { args } = await startWithSandbox('workspace-write');
    expect(args).toContain('--sandbox');
    const sandboxIdx = args.indexOf('--sandbox');
    expect(args[sandboxIdx + 1]).toBe('workspace-write');
  });

  it('omits --sandbox flag when sandboxLevel is danger-full-access', async () => {
    spawnSpy.mockClear();
    const { args } = await startWithSandbox('danger-full-access');
    expect(args).not.toContain('--sandbox');
  });

  it('omits --sandbox flag when sandboxLevel is null', async () => {
    spawnSpy.mockClear();
    const { args } = await startWithSandbox(null);
    expect(args).not.toContain('--sandbox');
  });

  it('omits --sandbox flag when sandboxLevel is omitted', async () => {
    spawnSpy.mockClear();
    const { args } = await startWithSandbox(undefined);
    expect(args).not.toContain('--sandbox');
  });

  it('propagates sandboxLevel through CodexRuntimeAdapter.startSession', async () => {
    spawnSpy.mockClear();

    const startSessionMock = vi.fn(async () => ({
      runtime: 'codex' as const,
      id: 'codex-w-1',
      nativeSessionId: 'native-1',
      agentId: 'agent-1',
      projectPath: '/workspace',
      status: 'running' as const,
      model: 'gpt-5-codex',
      pid: 1111,
      startedAt: new Date(),
      lastActivity: new Date(),
      isResumed: false,
      lastError: null,
    }));

    const resumeSessionMock = vi.fn(async () => ({
      runtime: 'codex' as const,
      id: 'codex-w-2',
      nativeSessionId: 'native-2',
      agentId: 'agent-1',
      projectPath: '/workspace',
      status: 'running' as const,
      model: 'gpt-5-codex',
      pid: 1112,
      startedAt: new Date(),
      lastActivity: new Date(),
      isResumed: true,
      lastError: null,
    }));

    const forkSessionMock = vi.fn(async () => ({
      runtime: 'codex' as const,
      id: 'codex-w-3',
      nativeSessionId: 'native-3',
      agentId: 'agent-1',
      projectPath: '/workspace',
      status: 'running' as const,
      model: 'gpt-5-codex',
      pid: 1113,
      startedAt: new Date(),
      lastActivity: new Date(),
      isResumed: false,
      lastError: null,
    }));

    const adapter = new CodexRuntimeAdapter({
      startSession: startSessionMock,
      resumeSession: resumeSessionMock,
      forkSession: forkSessionMock,
    });

    await adapter.startSession({
      agentId: 'agent-1',
      projectPath: '/workspace',
      prompt: 'Do work',
      model: 'gpt-5-codex',
      sandboxLevel: 'read-only',
    });

    expect(startSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxLevel: 'read-only' }),
    );
  });

  it('propagates sandboxLevel through CodexRuntimeAdapter.forkSession', async () => {
    spawnSpy.mockClear();

    const startSessionMock = vi.fn();
    const resumeSessionMock = vi.fn();
    const forkSessionMock = vi.fn(async () => ({
      runtime: 'codex' as const,
      id: 'codex-w-fork',
      nativeSessionId: 'native-fork',
      agentId: 'agent-1',
      projectPath: '/workspace',
      status: 'running' as const,
      model: 'gpt-5-codex',
      pid: 2222,
      startedAt: new Date(),
      lastActivity: new Date(),
      isResumed: false,
      lastError: null,
    }));

    const adapter = new CodexRuntimeAdapter({
      startSession: startSessionMock,
      resumeSession: resumeSessionMock,
      forkSession: forkSessionMock,
    });

    await adapter.forkSession({
      agentId: 'agent-1',
      projectPath: '/workspace',
      nativeSessionId: 'native-parent',
      prompt: 'Fork work',
      model: 'gpt-5-codex',
      sandboxLevel: 'workspace-write',
    });

    expect(forkSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxLevel: 'workspace-write' }),
    );
  });
});
