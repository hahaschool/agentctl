import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

import { WorkerError } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import { RcSessionManager } from './rc-session-manager.js';

// ── Mock child_process.spawn at module level ─────────────────────────

const spawnSpy = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnSpy(...args),
}));

type MockChild = EventEmitter & {
  stdout: Readable;
  stderr: Readable;
  stdin: Writable;
  pid: number;
  killed: boolean;
  exitCode: number | null;
  signalCode: string | null;
  connected: boolean;
  kill: ReturnType<typeof vi.fn>;
  pushStdout: (data: string) => void;
  emitExit: (code: number | null, signal: string | null) => void;
};

function createMockChildProcess(): MockChild {
  const emitter = new EventEmitter() as MockChild;

  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.stdin = stdin;
  emitter.pid = 12345;
  emitter.killed = false;
  emitter.exitCode = null;
  emitter.signalCode = null;
  emitter.connected = false;

  emitter.kill = vi.fn().mockImplementation(() => {
    emitter.killed = true;
    return true;
  });

  emitter.pushStdout = (data: string) => {
    stdout.push(data);
  };

  emitter.emitExit = (code, signal) => {
    emitter.exitCode = code;
    emitter.emit('exit', code, signal);
  };

  return emitter;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('RcSessionManager', () => {
  let manager: RcSessionManager;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockChild: MockChild;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockChild = createMockChildProcess();
    spawnSpy.mockReturnValue(mockChild);

    manager = new RcSessionManager({
      logger: mockLogger,
      machineId: 'test-machine',
      claudeBinary: '/usr/local/bin/claude',
    });
  });

  afterEach(async () => {
    await manager.stopAll();
    vi.restoreAllMocks();
    spawnSpy.mockReset();
  });

  describe('constructor', () => {
    it('creates with default claude binary', () => {
      const m = new RcSessionManager({
        logger: mockLogger,
        machineId: 'test',
      });
      expect(m).toBeInstanceOf(RcSessionManager);
    });
  });

  describe('listSessions', () => {
    it('returns empty array when no sessions exist', () => {
      expect(manager.listSessions()).toEqual([]);
    });
  });

  describe('getSession', () => {
    it('returns null for non-existent session', () => {
      expect(manager.getSession('nonexistent')).toBeNull();
    });
  });

  describe('startSession', () => {
    it('spawns claude remote-control process and parses session URL', async () => {
      setTimeout(() => {
        mockChild.pushStdout(
          'Remote Control session started.\nSession URL: https://claude.ai/code/session-abc123\n',
        );
      }, 50);

      const session = await manager.startSession({
        agentId: 'agent-1',
        projectPath: '/home/user/project',
      });

      expect(spawnSpy).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        ['remote-control'],
        expect.objectContaining({
          cwd: '/home/user/project',
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      );

      expect(session.agentId).toBe('agent-1');
      expect(session.status).toBe('online');
      expect(session.sessionUrl).toBe('https://claude.ai/code/session-abc123');
      expect(session.pid).toBe(12345);
      expect(session.projectPath).toBe('/home/user/project');
      expect(session.lastHeartbeat).toBeInstanceOf(Date);
      expect(session.error).toBeNull();
    });

    it('passes --resume and --remote-control flags when resumeSessionId is provided', async () => {
      setTimeout(() => {
        mockChild.pushStdout('https://claude.ai/code/resumed-session\n');
      }, 50);

      await manager.startSession({
        agentId: 'agent-2',
        projectPath: '/tmp/project',
        resumeSessionId: 'prev-session-id',
      });

      expect(spawnSpy).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        ['--resume', 'prev-session-id', '--remote-control'],
        expect.any(Object),
      );
    });

    it('passes extra args to the CLI', async () => {
      setTimeout(() => {
        mockChild.pushStdout('https://claude.ai/code/extra-session\n');
      }, 50);

      await manager.startSession({
        agentId: 'agent-3',
        projectPath: '/tmp/project',
        extraArgs: ['--model', 'opus'],
      });

      expect(spawnSpy).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        ['remote-control', '--model', 'opus'],
        expect.any(Object),
      );
    });

    it('throws WorkerError when process exits before producing session URL', async () => {
      setTimeout(() => {
        mockChild.emitExit(1, null);
      }, 50);

      await expect(
        manager.startSession({
          agentId: 'agent-fail',
          projectPath: '/tmp/project',
        }),
      ).rejects.toThrow(WorkerError);
    });

    it('emits session_online event when session starts successfully', async () => {
      const events: unknown[] = [];
      manager.on('session-event', (e: unknown) => events.push(e));

      setTimeout(() => {
        mockChild.pushStdout('https://claude.ai/code/online-session\n');
      }, 50);

      await manager.startSession({
        agentId: 'agent-events',
        projectPath: '/tmp/project',
      });

      const onlineEvent = events.find(
        (e) => (e as Record<string, unknown>).type === 'session_online',
      );
      expect(onlineEvent).toBeDefined();
      expect((onlineEvent as Record<string, unknown>).sessionId).toBeDefined();
    });

    it('adds session to the list after starting', async () => {
      setTimeout(() => {
        mockChild.pushStdout('https://claude.ai/code/listed-session\n');
      }, 50);

      const session = await manager.startSession({
        agentId: 'agent-list',
        projectPath: '/tmp/project',
      });

      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(session.id);
    });
  });

  describe('stopSession', () => {
    it('throws WorkerError for non-existent session', async () => {
      await expect(manager.stopSession('nonexistent')).rejects.toThrow(WorkerError);
    });

    it('kills the process and removes session from list', async () => {
      setTimeout(() => {
        mockChild.pushStdout('https://claude.ai/code/to-stop\n');
      }, 50);

      const session = await manager.startSession({
        agentId: 'agent-stop',
        projectPath: '/tmp/project',
      });

      // Force stop (non-graceful)
      await manager.stopSession(session.id, false);

      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
      expect(manager.listSessions()).toHaveLength(0);
    });
  });

  describe('session lifecycle events', () => {
    it('emits session_error when process dies unexpectedly', async () => {
      setTimeout(() => {
        mockChild.pushStdout('https://claude.ai/code/dying-session\n');
      }, 50);

      const session = await manager.startSession({
        agentId: 'agent-die',
        projectPath: '/tmp/project',
      });

      const events: unknown[] = [];
      manager.on('session-event', (e: unknown) => events.push(e));

      // Simulate process dying
      mockChild.emitExit(1, null);

      // Give the exit handler a tick to fire
      await new Promise((r) => setTimeout(r, 50));

      const errorEvent = events.find(
        (e) => (e as Record<string, unknown>).type === 'session_error',
      );
      expect(errorEvent).toBeDefined();

      const updated = manager.getSession(session.id);
      expect(updated?.status).toBe('error');
    });
  });

  describe('stopAll', () => {
    it('stops all sessions without throwing when empty', async () => {
      await expect(manager.stopAll()).resolves.toBeUndefined();
    });

    it('stops all active sessions', async () => {
      // Create two sessions with separate mocks
      const child1 = createMockChildProcess();
      const child2 = createMockChildProcess();
      let callCount = 0;
      spawnSpy.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? child1 : child2;
      });

      setTimeout(() => child1.pushStdout('https://claude.ai/code/session-1\n'), 50);
      await manager.startSession({ agentId: 'a1', projectPath: '/tmp' });

      setTimeout(() => child2.pushStdout('https://claude.ai/code/session-2\n'), 50);
      await manager.startSession({ agentId: 'a2', projectPath: '/tmp' });

      expect(manager.listSessions()).toHaveLength(2);

      await manager.stopAll();

      expect(manager.listSessions()).toHaveLength(0);
      expect(child1.kill).toHaveBeenCalled();
      expect(child2.kill).toHaveBeenCalled();
    });
  });
});
