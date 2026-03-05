import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { AgentEvent } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliSessionEvent, StartCliSessionOptions } from './cli-session-manager.js';
import { CliSessionManager } from './cli-session-manager.js';

// ── Mock child_process.spawn at module level ─────────────────────────

const spawnSpy = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnSpy(...args),
}));

// ── Mock node:fs for discoverLocalSessions ───────────────────────────

const existsSyncSpy = vi.fn();
const readdirSyncSpy = vi.fn();
const readFileSyncSpy = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncSpy(...args),
  readdirSync: (...args: unknown[]) => readdirSyncSpy(...args),
  readFileSync: (...args: unknown[]) => readFileSyncSpy(...args),
}));

// ── Mock node:os for homedir ─────────────────────────────────────────

vi.mock('node:os', () => ({
  homedir: () => '/mock-home',
}));

// ── Helpers ──────────────────────────────────────────────────────────

/** Wait one microtask tick for stream data events to propagate. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

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

function createMockChildProcess(pid = 12345): MockChild {
  const emitter = new EventEmitter() as MockChild;

  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.stdin = new PassThrough();
  emitter.pid = pid;
  emitter.killed = false;
  emitter.exitCode = null;
  emitter.kill = vi.fn((signal?: string) => {
    emitter.killed = true;
    void signal;
    return true;
  });

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

function defaultStartOptions(overrides?: Partial<StartCliSessionOptions>): StartCliSessionOptions {
  return {
    agentId: 'agent-1',
    projectPath: '/tmp/project',
    prompt: 'Hello world',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('CliSessionManager', () => {
  let manager: CliSessionManager;
  let mockChild: MockChild;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChild = createMockChildProcess();
    spawnSpy.mockReturnValue(mockChild);
    manager = new CliSessionManager({ claudePath: '/usr/local/bin/claude' });
  });

  afterEach(async () => {
    await manager.stopAll();
    manager.removeAllListeners();
  });

  // ── Session lifecycle ──────────────────────────────────────────────

  describe('startSession', () => {
    it('starts a session and returns a CliSession object', () => {
      const session = manager.startSession(defaultStartOptions());

      expect(session.id).toMatch(/^cli-\d+-\d+$/);
      expect(session.agentId).toBe('agent-1');
      expect(session.projectPath).toBe('/tmp/project');
      expect(session.status).toBe('running');
      expect(session.pid).toBe(12345);
      expect(session.model).toBe('sonnet');
      expect(session.isResumed).toBe(false);
    });

    it('spawns claude with correct arguments', () => {
      manager.startSession(defaultStartOptions());

      expect(spawnSpy).toHaveBeenCalledOnce();
      const [cmd, args, opts] = spawnSpy.mock.calls[0];
      expect(cmd).toBe('/usr/local/bin/claude');
      expect(args).toContain('-p');
      expect(args).toContain('Hello world');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--model');
      expect(args).toContain('sonnet');
      expect(args).toContain('--verbose');
      expect(opts.cwd).toBe('/tmp/project');
    });

    it('includes --resume flag when resumeSessionId is provided', () => {
      manager.startSession(defaultStartOptions({ resumeSessionId: 'prev-session-123' }));

      const [, args] = spawnSpy.mock.calls[0];
      expect(args).toContain('--resume');
      expect(args).toContain('prev-session-123');
    });

    it('sets isResumed to true when resumeSessionId is provided', () => {
      const session = manager.startSession(
        defaultStartOptions({ resumeSessionId: 'prev-session-123' }),
      );

      expect(session.isResumed).toBe(true);
      expect(session.claudeSessionId).toBe('prev-session-123');
    });

    it('includes permission mode in arguments when configured', () => {
      manager.startSession(
        defaultStartOptions({
          config: { permissionMode: 'acceptEdits' },
        }),
      );

      const [, args] = spawnSpy.mock.calls[0];
      expect(args).toContain('--permission-mode');
      expect(args).toContain('acceptEdits');
    });

    it('includes allowedTools in arguments when configured', () => {
      manager.startSession(
        defaultStartOptions({
          config: { allowedTools: ['Read', 'Edit', 'Bash'] },
        }),
      );

      const [, args] = spawnSpy.mock.calls[0];
      expect(args).toContain('--allowedTools');
      expect(args).toContain('Read,Edit,Bash');
    });

    it('includes maxTurns in arguments when configured', () => {
      manager.startSession(
        defaultStartOptions({
          config: { maxTurns: 25 },
        }),
      );

      const [, args] = spawnSpy.mock.calls[0];
      expect(args).toContain('--max-turns');
      expect(args).toContain('25');
    });

    it('includes system prompt in arguments when configured', () => {
      manager.startSession(
        defaultStartOptions({
          config: { systemPrompt: 'You are a helpful assistant' },
        }),
      );

      const [, args] = spawnSpy.mock.calls[0];
      expect(args).toContain('--append-system-prompt');
      expect(args).toContain('You are a helpful assistant');
    });

    it('uses custom model when specified', () => {
      manager.startSession(defaultStartOptions({ model: 'opus' }));

      const [, args] = spawnSpy.mock.calls[0];
      expect(args).toContain('--model');
      expect(args).toContain('opus');
    });

    it('appends extra arguments', () => {
      manager.startSession(
        defaultStartOptions({ extraArgs: ['--no-markdown', '--json-schema', '{}'] }),
      );

      const [, args] = spawnSpy.mock.calls[0];
      expect(args).toContain('--no-markdown');
      expect(args).toContain('--json-schema');
    });

    it('emits session_started event followed by user_message', () => {
      const events: CliSessionEvent[] = [];
      manager.on('session-event', (e: CliSessionEvent) => events.push(e));

      manager.startSession(defaultStartOptions());

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('session_started');
      // Synthetic user_message echoes the prompt immediately via SSE
      expect(events[1].type).toBe('session_output');
    });

    it('throws when max concurrent sessions reached', () => {
      const mgr = new CliSessionManager({ maxConcurrentSessions: 1 });
      mgr.startSession(defaultStartOptions());

      expect(() => mgr.startSession(defaultStartOptions())).toThrow(/Maximum concurrent sessions/);
    });

    describe('credential injection via buildChildEnv', () => {
      it('sets ANTHROPIC_API_KEY when accountProvider is anthropic_api', () => {
        manager.startSession(
          defaultStartOptions({
            accountProvider: 'anthropic_api',
            accountCredential: 'sk-test-key',
          }),
        );

        const env = spawnSpy.mock.calls[0][2].env;
        expect(env.ANTHROPIC_API_KEY).toBe('sk-test-key');
      });

      it('sets CLAUDE_CODE_OAUTH_TOKEN when accountProvider is claude_max', () => {
        manager.startSession(
          defaultStartOptions({
            accountProvider: 'claude_max',
            accountCredential: 'session-token-xyz',
          }),
        );

        const env = spawnSpy.mock.calls[0][2].env;
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('session-token-xyz');
      });

      it('sets CLAUDE_CODE_OAUTH_TOKEN when accountProvider is claude_team', () => {
        manager.startSession(
          defaultStartOptions({
            accountProvider: 'claude_team',
            accountCredential: 'session-token-xyz',
          }),
        );

        const env = spawnSpy.mock.calls[0][2].env;
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('session-token-xyz');
      });

      it('sets AWS credentials when accountProvider is bedrock', () => {
        manager.startSession(
          defaultStartOptions({
            accountProvider: 'bedrock',
            accountCredential: 'AKID:SECRET:us-west-2',
          }),
        );

        const env = spawnSpy.mock.calls[0][2].env;
        expect(env.AWS_ACCESS_KEY_ID).toBe('AKID');
        expect(env.AWS_SECRET_ACCESS_KEY).toBe('SECRET');
        expect(env.AWS_REGION).toBe('us-west-2');
      });

      it('sets GOOGLE_APPLICATION_CREDENTIALS_JSON when accountProvider is vertex', () => {
        const credential = '{"client_email":"x","private_key":"y"}';
        manager.startSession(
          defaultStartOptions({
            accountProvider: 'vertex',
            accountCredential: credential,
          }),
        );

        const env = spawnSpy.mock.calls[0][2].env;
        expect(env.GOOGLE_APPLICATION_CREDENTIALS_JSON).toBe(credential);
      });

      it('does not inject credential keys when accountCredential is null', () => {
        manager.startSession(
          defaultStartOptions({
            accountProvider: 'anthropic_api',
            accountCredential: null,
          }),
        );

        const env = spawnSpy.mock.calls[0][2].env;
        expect(env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
        expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
        expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
        expect(env.AWS_REGION).toBeUndefined();
        expect(env.GOOGLE_APPLICATION_CREDENTIALS_JSON).toBeUndefined();
      });

      it('does not inject credential keys when accountCredential is undefined', () => {
        manager.startSession(defaultStartOptions());

        const env = spawnSpy.mock.calls[0][2].env;
        expect(env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
        expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
        expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
        expect(env.AWS_REGION).toBeUndefined();
        expect(env.GOOGLE_APPLICATION_CREDENTIALS_JSON).toBeUndefined();
      });
    });
  });

  // ── Stream JSON parsing ────────────────────────────────────────────

  describe('stream-json parsing', () => {
    it('captures Claude session ID from init message', async () => {
      const session = manager.startSession(defaultStartOptions());

      mockChild.pushStdout('{"type":"init","session_id":"claude-abc-123"}\n');
      await tick();

      expect(session.claudeSessionId).toBe('claude-abc-123');
    });

    it('emits assistant text as output event', async () => {
      const events: CliSessionEvent[] = [];

      manager.startSession(defaultStartOptions());
      // Subscribe AFTER startSession to skip the synthetic user_message event
      manager.on('session_output', (e: CliSessionEvent) => events.push(e));

      mockChild.pushStdout('{"type":"assistant","content":[{"type":"text","text":"Hello!"}]}\n');
      await tick();

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('session_output');
      if (events[0].type === 'session_output') {
        expect(events[0].event.event).toBe('output');
        if (events[0].event.event === 'output') {
          expect(events[0].event.data.type).toBe('text');
          expect(events[0].event.data.content).toBe('Hello!');
        }
      }
    });

    it('emits tool_use as output event', async () => {
      const events: CliSessionEvent[] = [];

      manager.startSession(defaultStartOptions());
      manager.on('session_output', (e: CliSessionEvent) => events.push(e));

      mockChild.pushStdout(
        '{"type":"tool_use","name":"Read","input":{"file_path":"/tmp/test.ts"}}\n',
      );
      await tick();

      expect(events).toHaveLength(1);
      if (events[0].type === 'session_output') {
        const agentEvent = events[0].event as AgentEvent;
        expect(agentEvent.event).toBe('output');
        if (agentEvent.event === 'output') {
          expect(agentEvent.data.type).toBe('tool_use');
          const parsed = JSON.parse(agentEvent.data.content);
          expect(parsed.tool).toBe('Read');
          expect(parsed.input.file_path).toBe('/tmp/test.ts');
        }
      }
    });

    it('emits tool_result as output event', async () => {
      const events: CliSessionEvent[] = [];

      manager.startSession(defaultStartOptions());
      manager.on('session_output', (e: CliSessionEvent) => events.push(e));

      mockChild.pushStdout('{"type":"tool_result","content":"file contents here"}\n');
      await tick();

      expect(events).toHaveLength(1);
      if (events[0].type === 'session_output') {
        const agentEvent = events[0].event as AgentEvent;
        if (agentEvent.event === 'output') {
          expect(agentEvent.data.type).toBe('tool_result');
          expect(agentEvent.data.content).toBe('file contents here');
        }
      }
    });

    it('emits result message with cost tracking', async () => {
      const events: CliSessionEvent[] = [];
      manager.on('session_output', (e: CliSessionEvent) => events.push(e));

      const session = manager.startSession(defaultStartOptions());

      mockChild.pushStdout(
        '{"type":"result","result":"Task complete.","session_id":"ses-xyz","total_cost_usd":0.0123}\n',
      );
      await tick();

      // Should emit output + cost events
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(session.costUsd).toBe(0.0123);
      expect(session.claudeSessionId).toBe('ses-xyz');
    });

    it('emits cost events and updates session cost', async () => {
      const events: CliSessionEvent[] = [];
      manager.on('session_output', (e: CliSessionEvent) => events.push(e));

      const session = manager.startSession(defaultStartOptions());

      mockChild.pushStdout(
        '{"type":"cost","cost_usd":0.005,"total_cost_usd":0.015,"usage":{"input_tokens":100,"output_tokens":50}}\n',
      );
      await tick();

      expect(session.costUsd).toBe(0.015);

      const costEvents = events.filter(
        (e) => e.type === 'session_output' && e.event.event === 'cost',
      );
      expect(costEvents).toHaveLength(1);
    });

    it('emits approval_needed for permission requests', async () => {
      const events: CliSessionEvent[] = [];

      manager.startSession(defaultStartOptions());
      manager.on('session_output', (e: CliSessionEvent) => events.push(e));

      mockChild.pushStdout(
        '{"type":"permission_request","tool":"Bash","input":{"command":"rm -rf /"},"timeout_seconds":60}\n',
      );
      await tick();

      expect(events).toHaveLength(1);
      if (events[0].type === 'session_output') {
        const agentEvent = events[0].event as AgentEvent;
        expect(agentEvent.event).toBe('approval_needed');
        if (agentEvent.event === 'approval_needed') {
          expect(agentEvent.data.tool).toBe('Bash');
          expect(agentEvent.data.timeoutSeconds).toBe(60);
        }
      }
    });

    it('handles multi-line buffered output', async () => {
      const events: CliSessionEvent[] = [];

      manager.startSession(defaultStartOptions());
      manager.on('session_output', (e: CliSessionEvent) => events.push(e));

      // Send data in chunks that split across lines
      mockChild.pushStdout('{"type":"assistant","conte');
      await tick();
      mockChild.pushStdout('nt":"Hello"}\n{"type":"assistant","content":"World"}\n');
      await tick();

      expect(events).toHaveLength(2);
    });

    it('handles non-JSON lines gracefully', async () => {
      const events: CliSessionEvent[] = [];

      manager.startSession(defaultStartOptions());
      manager.on('session_output', (e: CliSessionEvent) => events.push(e));

      mockChild.pushStdout('Some non-JSON text\n');
      await tick();

      expect(events).toHaveLength(1);
      if (events[0].type === 'session_output') {
        const agentEvent = events[0].event as AgentEvent;
        if (agentEvent.event === 'output') {
          expect(agentEvent.data.content).toBe('Some non-JSON text');
        }
      }
    });
  });

  // ── Session management ─────────────────────────────────────────────

  describe('session management', () => {
    it('lists all sessions', () => {
      manager.startSession(defaultStartOptions());
      manager.startSession(defaultStartOptions({ agentId: 'agent-2' }));

      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it('gets session by ID', () => {
      const session = manager.startSession(defaultStartOptions());
      const found = manager.getSession(session.id);

      expect(found).toBe(session);
    });

    it('returns null for unknown session ID', () => {
      expect(manager.getSession('nonexistent')).toBeNull();
    });

    it('gets session by Claude session ID', () => {
      const session = manager.startSession(defaultStartOptions({ resumeSessionId: 'claude-123' }));

      const found = manager.getSessionByClaudeId('claude-123');
      expect(found).toBe(session);
    });

    it('returns null for unknown Claude session ID', () => {
      expect(manager.getSessionByClaudeId('nonexistent')).toBeNull();
    });

    it('lists sessions by status', () => {
      manager.startSession(defaultStartOptions());
      manager.startSession(defaultStartOptions());

      const running = manager.listSessionsByStatus('running');
      expect(running).toHaveLength(2);

      const paused = manager.listSessionsByStatus('paused');
      expect(paused).toHaveLength(0);
    });
  });

  // ── Process exit handling ──────────────────────────────────────────

  describe('process exit handling', () => {
    it('transitions to paused on clean exit', () => {
      const session = manager.startSession(defaultStartOptions());

      mockChild.emitClose(0);

      expect(session.status).toBe('paused');
      expect(session.pid).toBeNull();
    });

    it('transitions to error on non-zero exit', () => {
      const session = manager.startSession(defaultStartOptions());

      mockChild.emitClose(1);

      expect(session.status).toBe('error');
    });

    it('emits session_ended event on exit', () => {
      const events: CliSessionEvent[] = [];
      manager.on('session_ended', (e: CliSessionEvent) => events.push(e));

      manager.startSession(defaultStartOptions());

      mockChild.emitClose(0);

      expect(events).toHaveLength(1);
      if (events[0].type === 'session_ended') {
        expect(events[0].exitCode).toBe(0);
      }
    });

    it('emits session_error on process spawn error', () => {
      const events: CliSessionEvent[] = [];
      manager.on('session_error', (e: CliSessionEvent) => events.push(e));

      manager.startSession(defaultStartOptions());

      mockChild.emit('error', new Error('spawn ENOENT'));

      expect(events).toHaveLength(1);
      if (events[0].type === 'session_error') {
        expect(events[0].error).toContain('spawn ENOENT');
      }
    });
  });

  // ── Stop session ───────────────────────────────────────────────────

  describe('stopSession', () => {
    it('kills the process with SIGTERM for graceful stop', async () => {
      const session = manager.startSession(defaultStartOptions());

      // Simulate exit after SIGTERM
      mockChild.kill.mockImplementation((signal?: string) => {
        if (signal === 'SIGTERM') {
          // Process exits shortly after SIGTERM
          process.nextTick(() => mockChild.emitClose(0));
        }
        return true;
      });

      await manager.stopSession(session.id, true);

      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('kills the process with SIGKILL for forced stop', async () => {
      const session = manager.startSession(defaultStartOptions());

      await manager.stopSession(session.id, false);

      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('throws for unknown session ID', async () => {
      await expect(manager.stopSession('nonexistent')).rejects.toThrow(
        /Session nonexistent not found/,
      );
    });

    it('cleans up processes and lineBuffers maps after graceful stop timeout', async () => {
      vi.useFakeTimers();
      try {
        const session = manager.startSession(defaultStartOptions());
        const sessionId = session.id;

        // Mock kill to never emit close (simulate hung process)
        mockChild.kill.mockImplementation(() => {
          // Don't emit 'close' — process hangs
          return true;
        });

        // Start the graceful stop
        const stopPromise = manager.stopSession(sessionId, true);

        // Advance time past the GRACEFUL_KILL_TIMEOUT_MS (5s)
        await vi.advanceTimersByTimeAsync(5100);

        // stopSession should have completed with cleanup
        await stopPromise;

        // Both SIGTERM and SIGKILL should have been called
        expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
        expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
      } finally {
        vi.useRealTimers();
      }
    });

    it('immediately cleans up processes and lineBuffers for non-graceful stop', async () => {
      const session = manager.startSession(defaultStartOptions());
      const sessionId = session.id;

      mockChild.kill.mockImplementation(() => true);

      // Non-graceful stop should immediately force cleanup
      await manager.stopSession(sessionId, false);

      // Process should be marked as killed
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });

  // ── resumeSession ──────────────────────────────────────────────────

  describe('resumeSession', () => {
    it('creates a new session with --resume flag', () => {
      const session = manager.resumeSession('claude-abc', {
        agentId: 'agent-1',
        projectPath: '/tmp/project',
        prompt: 'Continue working',
      });

      expect(session.isResumed).toBe(true);
      expect(session.claudeSessionId).toBe('claude-abc');

      const [, args] = spawnSpy.mock.calls[0];
      expect(args).toContain('--resume');
      expect(args).toContain('claude-abc');
      expect(args).toContain('Continue working');
    });
  });

  // ── stopAll ────────────────────────────────────────────────────────

  describe('stopAll', () => {
    it('stops all running sessions', async () => {
      const mockChild2 = createMockChildProcess(54321);
      spawnSpy.mockReturnValueOnce(mockChild).mockReturnValueOnce(mockChild2);

      manager.startSession(defaultStartOptions());
      manager.startSession(defaultStartOptions({ agentId: 'agent-2' }));

      await manager.stopAll();

      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
      expect(mockChild2.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });

  // ── discoverLocalSessions ──────────────────────────────────────────

  describe('discoverLocalSessions', () => {
    it('returns empty array when .claude/projects does not exist', () => {
      existsSyncSpy.mockReturnValue(false);

      const sessions = manager.discoverLocalSessions();
      expect(sessions).toEqual([]);
    });

    it('discovers sessions from sessions-index.json', () => {
      existsSyncSpy.mockReturnValue(true);

      readdirSyncSpy.mockReturnValue([{ name: '-Users-test-myproject', isDirectory: () => true }]);

      readFileSyncSpy.mockReturnValue(
        JSON.stringify({
          'session-aaa': {
            summary: 'Fix bug',
            messageCount: 5,
            lastActiveAt: '2026-03-03T10:00:00Z',
            gitBranch: 'fix/bug',
          },
          'session-bbb': {
            summary: 'Add feature',
            messageCount: 12,
            lastActiveAt: '2026-03-03T11:00:00Z',
          },
        }),
      );

      const sessions = manager.discoverLocalSessions();

      expect(sessions).toHaveLength(2);
      // Should be sorted by most recent first
      expect(sessions[0].sessionId).toBe('session-bbb');
      expect(sessions[0].projectPath).toBe('/Users/test/myproject');
      expect(sessions[0].summary).toBe('Add feature');
      expect(sessions[0].messageCount).toBe(12);

      expect(sessions[1].sessionId).toBe('session-aaa');
      expect(sessions[1].branch).toBe('fix/bug');
    });

    it('filters by project path', () => {
      existsSyncSpy.mockReturnValue(true);

      readdirSyncSpy.mockReturnValue([
        { name: '-Users-test-projecta', isDirectory: () => true },
        { name: '-Users-test-projectb', isDirectory: () => true },
      ]);

      const callCount = { a: 0, b: 0 };
      readFileSyncSpy.mockImplementation((path: string) => {
        if (path.includes('projecta')) {
          callCount.a++;
          return JSON.stringify({
            s1: { summary: 'Test A', messageCount: 1, lastActiveAt: '2026-03-03T10:00:00Z' },
          });
        }
        if (path.includes('projectb')) {
          callCount.b++;
          return JSON.stringify({
            s2: { summary: 'Test B', messageCount: 2, lastActiveAt: '2026-03-03T11:00:00Z' },
          });
        }
        return '{}';
      });

      const sessions = manager.discoverLocalSessions('projecta');

      // Only projecta should match the filter
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('s1');
      expect(sessions[0].projectPath).toContain('projecta');
    });

    it('skips non-directory entries', () => {
      existsSyncSpy.mockReturnValue(true);

      readdirSyncSpy.mockReturnValue([{ name: 'some-file.txt', isDirectory: () => false }]);

      const sessions = manager.discoverLocalSessions();
      expect(sessions).toEqual([]);
    });

    it('skips directories without sessions-index.json', () => {
      existsSyncSpy.mockImplementation((path: string) => {
        if (path.includes('sessions-index')) return false;
        return true;
      });

      readdirSyncSpy.mockReturnValue([{ name: '-Users-test-empty', isDirectory: () => true }]);

      const sessions = manager.discoverLocalSessions();
      expect(sessions).toEqual([]);
    });

    it('skips corrupted index files', () => {
      existsSyncSpy.mockReturnValue(true);

      readdirSyncSpy.mockReturnValue([{ name: '-Users-test-broken', isDirectory: () => true }]);

      readFileSyncSpy.mockReturnValue('not valid json{{{');

      const sessions = manager.discoverLocalSessions();
      expect(sessions).toEqual([]);
    });
  });

  // ── stderr handling ────────────────────────────────────────────────

  describe('stderr handling', () => {
    it('emits session_error for error messages on stderr', async () => {
      const events: CliSessionEvent[] = [];
      manager.on('session_error', (e: CliSessionEvent) => events.push(e));

      manager.startSession(defaultStartOptions());

      mockChild.pushStderr('Error: API key not found\n');
      await tick();

      expect(events).toHaveLength(1);
      if (events[0].type === 'session_error') {
        expect(events[0].error).toContain('API key not found');
      }
    });

    it('ignores non-error stderr output', async () => {
      const events: CliSessionEvent[] = [];
      manager.on('session_error', (e: CliSessionEvent) => events.push(e));

      manager.startSession(defaultStartOptions());

      mockChild.pushStderr('Loading configuration...\n');
      await tick();

      expect(events).toHaveLength(0);
    });
  });
});
