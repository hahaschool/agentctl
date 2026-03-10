import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodexSessionManager } from './codex-session-manager.js';

const spawnSpy = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnSpy(...args),
}));

type MockChild = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  pid: number;
  killed: boolean;
  exitCode: number | null;
  kill: ReturnType<typeof vi.fn>;
  pushStdout: (data: string) => void;
  pushStderr: (data: string) => void;
  emitClose: (code: number | null) => void;
};

function createMockChild(pid = 2222): MockChild {
  const emitter = new EventEmitter() as MockChild;
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.stdin = new PassThrough();
  emitter.pid = pid;
  emitter.killed = false;
  emitter.exitCode = null;
  emitter.kill = vi.fn(() => true);
  emitter.pushStdout = (data: string) => {
    emitter.stdout.write(data);
  };
  emitter.pushStderr = (data: string) => {
    emitter.stderr.write(data);
  };
  emitter.emitClose = (code: number | null) => {
    emitter.exitCode = code;
    emitter.emit('close', code);
  };
  return emitter;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('CodexSessionManager', () => {
  let manager: CodexSessionManager;
  let child: MockChild;

  beforeEach(() => {
    vi.clearAllMocks();
    child = createMockChild();
    spawnSpy.mockReturnValue(child);
    manager = new CodexSessionManager({ codexPath: '/usr/local/bin/codex' });
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  it('starts a Codex exec session and captures the native session id from JSONL output', async () => {
    const promise = manager.startSession({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      prompt: 'Fix the auth bug',
      model: 'gpt-5-codex',
    });

    child.pushStdout('{"type":"session.started","session_id":"codex-native-1"}\n');
    await tick();

    const session = await promise;

    const [cmd, args, opts] = spawnSpy.mock.calls[0];
    expect(cmd).toBe('/usr/local/bin/codex');
    expect(args).toContain('exec');
    expect(args).toContain('--json');
    expect(args).toContain('Fix the auth bug');
    expect(args).toContain('gpt-5-codex');
    expect(opts.cwd).toBe('/workspace/app');
    expect(session.nativeSessionId).toBe('codex-native-1');
    expect(session.runtime).toBe('codex');
  });

  it('resumes a Codex exec session with the native session id', async () => {
    const promise = manager.resumeSession({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      nativeSessionId: 'codex-native-existing',
      prompt: 'Continue the task',
      model: 'gpt-5-codex',
    });

    child.pushStdout('{"type":"session.started","session_id":"codex-native-existing"}\n');
    await tick();

    await promise;

    const [, args] = spawnSpy.mock.calls[0];
    expect(args).toContain('exec');
    expect(args).toContain('resume');
    expect(args).toContain('codex-native-existing');
    expect(args).toContain('Continue the task');
  });

  it('forks a Codex session using the interactive fork command mapping', async () => {
    const promise = manager.forkSession({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      nativeSessionId: 'codex-native-existing',
      prompt: 'Try an alternative implementation',
      model: 'gpt-5-codex',
    });

    child.pushStdout('{"type":"session.started","session_id":"codex-native-fork"}\n');
    await tick();

    const session = await promise;

    const [, args] = spawnSpy.mock.calls[0];
    expect(args).toContain('fork');
    expect(args).toContain('codex-native-existing');
    expect(args).toContain('Try an alternative implementation');
    expect(session.nativeSessionId).toBe('codex-native-fork');
  });
});
