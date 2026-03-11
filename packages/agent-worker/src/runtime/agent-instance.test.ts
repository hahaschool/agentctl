import type { AgentEvent } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import { AgentInstance, type AgentInstanceOptions } from './agent-instance.js';

// Mock the sdk-runner module so start() doesn't launch a real agent.
// Returning null causes the instance to fall back to stub simulation.
vi.mock('./sdk-runner.js', () => ({
  runWithSdk: vi.fn().mockResolvedValue(null),
}));

// Mock the AuditLogger to avoid real filesystem writes
vi.mock('../hooks/audit-logger.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../hooks/audit-logger.js')>();
  return {
    ...original,
    AuditLogger: vi.fn().mockImplementation(() => ({
      write: vi.fn().mockResolvedValue(undefined),
      getLogFilePath: vi.fn().mockReturnValue('/tmp/audit.ndjson'),
    })),
  };
});

// Mock AuditReporter to avoid real file system / network operations
vi.mock('../hooks/audit-reporter.js', () => ({
  AuditReporter: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock the hook factories so we don't rely on real implementations
vi.mock('../hooks/pre-tool-use.js', () => ({
  createPreToolUseHook: vi.fn().mockReturnValue(vi.fn().mockResolvedValue('allow')),
}));

vi.mock('../hooks/post-tool-use.js', () => ({
  createPostToolUseHook: vi.fn().mockReturnValue(vi.fn().mockResolvedValue(undefined)),
}));

vi.mock('../hooks/stop-hook.js', () => ({
  createStopHook: vi.fn().mockReturnValue(vi.fn().mockResolvedValue(undefined)),
}));

vi.mock('./workdir-safety.js', () => ({
  checkWorkdirSafety: vi.fn().mockResolvedValue({
    tier: 'safe',
    isGitRepo: true,
    hasUncommittedChanges: false,
    parallelTaskCount: 1,
  }),
  createSandbox: vi.fn().mockResolvedValue({
    sandboxPath: '/tmp/agentctl-sandbox',
    originalPath: '/tmp/test-project',
    copyBack: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockLogger = createMockLogger();

function makeOptions(overrides?: Partial<AgentInstanceOptions>): AgentInstanceOptions {
  return {
    agentId: 'agent-1',
    machineId: 'machine-1',
    config: {},
    projectPath: '/tmp/test-project',
    logger: mockLogger,
    ...overrides,
  };
}

describe('AgentInstance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initial status is registered', () => {
    const agent = new AgentInstance(makeOptions());

    expect(agent.getStatus()).toBe('registered');
  });

  it('start() transitions to starting then running', async () => {
    const agent = new AgentInstance(makeOptions());
    const statuses: string[] = [];

    agent.onEvent((event: AgentEvent) => {
      if (event.event === 'status') {
        statuses.push(event.data.status);
      }
    });

    const startPromise = agent.start('test prompt');

    // Allow microtasks to settle so the async start() proceeds
    await vi.advanceTimersByTimeAsync(0);

    expect(statuses).toContain('starting');
    expect(statuses).toContain('running');
    expect(agent.getStatus()).toBe('running');

    // Clean up: stop the agent so timers are cleared
    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('emits safety_approval_needed and stays in starting when workdir is risky', async () => {
    const { checkWorkdirSafety } = await import('./workdir-safety.js');
    const { runWithSdk } = await import('./sdk-runner.js');

    vi.mocked(checkWorkdirSafety).mockResolvedValueOnce({
      tier: 'risky',
      isGitRepo: false,
      hasUncommittedChanges: false,
      parallelTaskCount: 1,
      warning: 'Working directory is not a git repository.',
    });

    const agent = new AgentInstance(makeOptions());
    const events: AgentEvent[] = [];
    agent.onEvent((event) => events.push(event));

    await agent.start('needs approval');
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getStatus()).toBe('starting');
    expect(runWithSdk).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      event: 'safety_approval_needed',
      data: expect.objectContaining({
        tier: 'risky',
      }),
    });
  });

  it('applySafetyDecision("approve") resumes execution after a risky workdir gate', async () => {
    const { checkWorkdirSafety } = await import('./workdir-safety.js');
    const { runWithSdk } = await import('./sdk-runner.js');

    vi.mocked(checkWorkdirSafety).mockResolvedValueOnce({
      tier: 'risky',
      isGitRepo: false,
      hasUncommittedChanges: false,
      parallelTaskCount: 1,
      warning: 'Working directory is not a git repository.',
    });

    const agent = new AgentInstance(makeOptions());

    await agent.start('resume after approval');
    await vi.advanceTimersByTimeAsync(0);

    await agent.applySafetyDecision('approve');
    await vi.advanceTimersByTimeAsync(0);

    expect(runWithSdk).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/tmp/test-project',
      }),
    );
    expect(agent.getStatus()).toBe('running');
  });

  it('applySafetyDecision("sandbox") runs the agent inside the sandbox path', async () => {
    const { checkWorkdirSafety, createSandbox } = await import('./workdir-safety.js');
    const { runWithSdk } = await import('./sdk-runner.js');

    vi.mocked(checkWorkdirSafety).mockResolvedValueOnce({
      tier: 'risky',
      isGitRepo: false,
      hasUncommittedChanges: false,
      parallelTaskCount: 1,
      warning: 'Working directory is not a git repository.',
    });

    vi.mocked(createSandbox).mockResolvedValueOnce({
      sandboxPath: '/tmp/custom-sandbox',
      originalPath: '/tmp/test-project',
      copyBack: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
    });

    const agent = new AgentInstance(makeOptions());

    await agent.start('sandbox decision');
    await vi.advanceTimersByTimeAsync(0);

    await agent.applySafetyDecision('sandbox');
    await vi.advanceTimersByTimeAsync(0);

    expect(createSandbox).toHaveBeenCalledWith('/tmp/test-project', 'agent-1');
    expect(runWithSdk).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/tmp/custom-sandbox',
      }),
    );
  });

  it('rejects start when workdir is unsafe', async () => {
    const { checkWorkdirSafety } = await import('./workdir-safety.js');

    vi.mocked(checkWorkdirSafety).mockResolvedValueOnce({
      tier: 'unsafe',
      isGitRepo: false,
      hasUncommittedChanges: false,
      parallelTaskCount: 2,
      blockReason: 'Parallel tasks detected in a non-git directory.',
    });

    const agent = new AgentInstance(makeOptions());

    await expect(agent.start('blocked')).rejects.toThrow('Parallel tasks detected');
    expect(agent.getStatus()).toBe('stopped');
  });

  it('stop() transitions to stopped', async () => {
    const agent = new AgentInstance(makeOptions());

    const startPromise = agent.start('test prompt');
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getStatus()).toBe('running');

    await agent.stop(true);

    expect(agent.getStatus()).toBe('stopped');
    expect(agent.getStoppedAt()).toBeInstanceOf(Date);

    vi.runAllTimers();
    await startPromise;
  });

  it('stop() on already stopped agent is a no-op', async () => {
    const agent = new AgentInstance(makeOptions());

    const startPromise = agent.start('test prompt');
    await vi.advanceTimersByTimeAsync(0);

    await agent.stop(true);
    expect(agent.getStatus()).toBe('stopped');

    // Second stop should not throw and status remains stopped
    await agent.stop(true);
    expect(agent.getStatus()).toBe('stopped');

    vi.runAllTimers();
    await startPromise;
  });

  it('invalid transition throws AgentError with INVALID_TRANSITION', async () => {
    const agent = new AgentInstance(makeOptions());

    // Agent is in 'registered' state.
    // Calling stop(true) on a registered agent will try to transition
    // to 'stopping', which is not a valid transition from 'registered'.
    // The 'stopped'/'stopping' early-return guard does not apply here.
    await expect(agent.stop(true)).rejects.toThrow(AgentError);

    try {
      await agent.stop(true);
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_TRANSITION');
    }
  });

  it('emits status events on transitions', async () => {
    const agent = new AgentInstance(makeOptions());
    const events: AgentEvent[] = [];

    agent.onEvent((event: AgentEvent) => {
      events.push(event);
    });

    const startPromise = agent.start('hello');
    await vi.advanceTimersByTimeAsync(0);

    const statusEvents = events.filter((e) => e.event === 'status');

    expect(statusEvents.length).toBeGreaterThanOrEqual(2);
    expect(statusEvents[0].data).toEqual({ status: 'starting' });
    expect(statusEvents[1].data).toEqual({ status: 'running' });

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('toJSON() returns expected shape', () => {
    const agent = new AgentInstance(
      makeOptions({
        agentId: 'test-id',
        machineId: 'test-machine',
        projectPath: '/my/project',
      }),
    );

    const json = agent.toJSON();

    expect(json).toEqual({
      agentId: 'test-id',
      machineId: 'test-machine',
      status: 'registered',
      sessionId: null,
      runId: null,
      startedAt: null,
      stoppedAt: null,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      projectPath: '/my/project',
      isResumed: false,
    });
  });

  // ── Edge case tests ──────────────────────────────────────────────

  it('getSessionId() returns null before start', () => {
    const agent = new AgentInstance(makeOptions());

    expect(agent.getSessionId()).toBeNull();
  });

  it('getSessionId() returns a UUID after start', async () => {
    const agent = new AgentInstance(makeOptions());

    const startPromise = agent.start('test prompt');
    await vi.advanceTimersByTimeAsync(0);

    const sessionId = agent.getSessionId();

    expect(sessionId).toBeDefined();
    expect(sessionId).not.toBeNull();
    // UUID v4 format check
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('getStartedAt() returns null before start, Date after start', async () => {
    const agent = new AgentInstance(makeOptions());

    expect(agent.getStartedAt()).toBeNull();

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getStartedAt()).toBeInstanceOf(Date);

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('getCostUsd() starts at 0 and accumulates during stub simulation', async () => {
    const agent = new AgentInstance(makeOptions());

    expect(agent.getCostUsd()).toBe(0);

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    // Let a few stub turns run (interval = 1000ms, cost = 0.003 per turn)
    await vi.advanceTimersByTimeAsync(2000);

    expect(agent.getCostUsd()).toBeGreaterThan(0);

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('stub simulation emits output and cost events', async () => {
    const agent = new AgentInstance(makeOptions());
    const events: AgentEvent[] = [];

    agent.onEvent((event: AgentEvent) => {
      events.push(event);
    });

    const startPromise = agent.start('hello world');
    await vi.advanceTimersByTimeAsync(0);

    // Let one stub turn complete (1000ms interval)
    await vi.advanceTimersByTimeAsync(1000);

    const outputEvents = events.filter((e) => e.event === 'output');
    const costEvents = events.filter((e) => e.event === 'cost');

    expect(outputEvents.length).toBeGreaterThanOrEqual(1);
    expect(costEvents.length).toBeGreaterThanOrEqual(1);

    // Cost event should have turnCost and totalCost
    expect(costEvents[0].data).toHaveProperty('turnCost');
    expect(costEvents[0].data).toHaveProperty('totalCost');

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('stub simulation completes and transitions to stopped after duration', async () => {
    const agent = new AgentInstance(makeOptions());
    const statuses: string[] = [];

    agent.onEvent((event: AgentEvent) => {
      if (event.event === 'status') {
        statuses.push(event.data.status);
      }
    });

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    // Advance past the full stub run duration (5000ms)
    await vi.advanceTimersByTimeAsync(6000);
    await startPromise;

    expect(statuses).toContain('stopped');
    expect(agent.getStatus()).toBe('stopped');
    expect(agent.getStoppedAt()).toBeInstanceOf(Date);
  });

  it('offEvent removes a previously registered listener', async () => {
    const agent = new AgentInstance(makeOptions());
    const events: AgentEvent[] = [];

    const listener = (event: AgentEvent) => {
      events.push(event);
    };

    agent.onEvent(listener);

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    const countAfterStart = events.length;
    expect(countAfterStart).toBeGreaterThan(0);

    // Remove the listener
    agent.offEvent(listener);

    // Let more events fire
    await vi.advanceTimersByTimeAsync(1000);

    // No new events should have been captured
    expect(events.length).toBe(countAfterStart);

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('force stop (graceful=false) transitions directly to stopped', async () => {
    const agent = new AgentInstance(makeOptions());

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getStatus()).toBe('running');

    await agent.stop(false);

    expect(agent.getStatus()).toBe('stopped');

    vi.runAllTimers();
    await startPromise;
  });

  it('graceful stop transitions through stopping to stopped', async () => {
    const agent = new AgentInstance(makeOptions());
    const statuses: string[] = [];

    agent.onEvent((event: AgentEvent) => {
      if (event.event === 'status') {
        statuses.push(event.data.status);
      }
    });

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    await agent.stop(true);

    // Graceful stop should go through 'stopping' status
    expect(statuses).toContain('stopping');
    expect(statuses).toContain('stopped');
    expect(agent.getStatus()).toBe('stopped');

    vi.runAllTimers();
    await startPromise;
  });

  it('toJSON() reflects running state after start', async () => {
    const agent = new AgentInstance(
      makeOptions({
        agentId: 'running-test',
        machineId: 'machine-x',
      }),
    );

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    const json = agent.toJSON();

    expect(json.status).toBe('running');
    expect(json.sessionId).toBeDefined();
    expect(json.sessionId).not.toBeNull();
    expect(json.startedAt).toBeDefined();
    expect(json.startedAt).not.toBeNull();
    expect(json.stoppedAt).toBeNull();

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('toJSON() reflects stopped state after stop', async () => {
    const agent = new AgentInstance(makeOptions());

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    await agent.stop(false);

    const json = agent.toJSON();

    expect(json.status).toBe('stopped');
    expect(json.stoppedAt).toBeDefined();
    expect(json.stoppedAt).not.toBeNull();

    vi.runAllTimers();
    await startPromise;
  });

  it('runId is null by default and set when provided', () => {
    const agentNoRun = new AgentInstance(makeOptions());
    expect(agentNoRun.runId).toBeNull();

    const agentWithRun = new AgentInstance(makeOptions({ runId: 'run-123' }));
    expect(agentWithRun.runId).toBe('run-123');
  });

  it('toJSON() includes runId when provided', () => {
    const agent = new AgentInstance(makeOptions({ runId: 'run-abc' }));
    const json = agent.toJSON();

    expect(json.runId).toBe('run-abc');
  });

  it('outputBuffer is populated with events during run', async () => {
    const agent = new AgentInstance(makeOptions());

    expect(agent.outputBuffer.size).toBe(0);

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    // At minimum, 'starting' and 'running' status events should be in the buffer
    expect(agent.outputBuffer.size).toBeGreaterThanOrEqual(2);

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('agentId and machineId are publicly accessible readonly properties', () => {
    const agent = new AgentInstance(
      makeOptions({
        agentId: 'my-agent',
        machineId: 'my-machine',
      }),
    );

    expect(agent.agentId).toBe('my-agent');
    expect(agent.machineId).toBe('my-machine');
  });

  it('projectPath is publicly accessible and matches provided option', () => {
    const agent = new AgentInstance(makeOptions({ projectPath: '/custom/path' }));

    expect(agent.projectPath).toBe('/custom/path');
  });

  it('config is publicly accessible', () => {
    const config = { model: 'opus', maxTurns: 10 };
    const agent = new AgentInstance(makeOptions({ config }));

    expect(agent.config).toEqual(config);
  });

  it('execution timeout transitions to timeout status', async () => {
    const agent = new AgentInstance(
      makeOptions({
        maxExecutionMs: 500,
      }),
    );
    const statuses: string[] = [];

    agent.onEvent((event: AgentEvent) => {
      if (event.event === 'status') {
        statuses.push(event.data.status);
      }
    });

    const startPromise = agent.start('long task');
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getStatus()).toBe('running');

    // Advance past the execution timeout
    await vi.advanceTimersByTimeAsync(600);

    expect(agent.getStatus()).toBe('timeout');
    expect(statuses).toContain('timeout');

    vi.runAllTimers();
    await startPromise;
  });

  it('execution timeout emits a status event with reason', async () => {
    const agent = new AgentInstance(
      makeOptions({
        maxExecutionMs: 200,
      }),
    );
    const events: AgentEvent[] = [];

    agent.onEvent((event: AgentEvent) => {
      events.push(event);
    });

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    // Trigger timeout
    await vi.advanceTimersByTimeAsync(300);

    const timeoutEvent = events.find((e) => e.event === 'status' && e.data.status === 'timeout');

    expect(timeoutEvent).toBeDefined();
    expect(timeoutEvent?.event).toBe('status');
    if (timeoutEvent?.event === 'status') {
      expect(timeoutEvent.data.reason).toBe('execution_timeout');
    }

    vi.runAllTimers();
    await startPromise;
  });

  it('each start generates a new sessionId', async () => {
    const agent = new AgentInstance(makeOptions());

    // First start
    const p1 = agent.start('first');
    await vi.advanceTimersByTimeAsync(0);
    const session1 = agent.getSessionId();

    await agent.stop(false);
    vi.runAllTimers();
    await p1;

    // Second start (stopped -> starting is valid)
    const p2 = agent.start('second');
    await vi.advanceTimersByTimeAsync(0);
    const session2 = agent.getSessionId();

    expect(session1).not.toBeNull();
    expect(session2).not.toBeNull();
    expect(session1).not.toBe(session2);

    await agent.stop(false);
    vi.runAllTimers();
    await p2;
  });

  it('startedAt is reset on each start', async () => {
    const agent = new AgentInstance(makeOptions());

    // First start
    const p1 = agent.start('first');
    await vi.advanceTimersByTimeAsync(0);
    const started1 = agent.getStartedAt();

    await agent.stop(false);
    vi.runAllTimers();
    await p1;

    // Advance time so second start has a different timestamp
    await vi.advanceTimersByTimeAsync(5000);

    // Second start
    const p2 = agent.start('second');
    await vi.advanceTimersByTimeAsync(0);
    const started2 = agent.getStartedAt();

    expect(started1).not.toBeNull();
    expect(started2).not.toBeNull();
    expect(started2?.getTime()).toBeGreaterThan(started1?.getTime() ?? 0);

    await agent.stop(false);
    vi.runAllTimers();
    await p2;
  });

  it('costUsd resets to 0 on each new start', async () => {
    const agent = new AgentInstance(makeOptions());

    // First start — let turns accumulate cost
    const p1 = agent.start('first');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);

    expect(agent.getCostUsd()).toBeGreaterThan(0);

    await agent.stop(false);
    vi.runAllTimers();
    await p1;

    // Second start — cost should be reset
    const p2 = agent.start('second');
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getCostUsd()).toBe(0);

    await agent.stop(false);
    vi.runAllTimers();
    await p2;
  });

  it('stoppedAt is null while running and set after stop', async () => {
    const agent = new AgentInstance(makeOptions());

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getStoppedAt()).toBeNull();

    await agent.stop(false);

    expect(agent.getStoppedAt()).toBeInstanceOf(Date);

    vi.runAllTimers();
    await startPromise;
  });

  it('stop on a registered (never started) agent with graceful=false goes to stopped via finishStop', async () => {
    const agent = new AgentInstance(makeOptions());

    // Agent is 'registered'. Force stop bypasses the 'stopping' transition.
    // finishStop sets status to 'stopped' directly, but 'registered' does not
    // have 'stopped' in VALID_TRANSITIONS via transitionTo — finishStop sets
    // status directly. Let's verify: the code in stop() calls finishStop when
    // not graceful, which sets this.state.status = 'stopped' directly.
    // But first it checks status !== 'stopped' && status !== 'stopping' — registered passes.
    // Then it checks the abortController (null for never-started).
    // Then if !graceful, it calls finishStop('user') which directly sets status.
    await agent.stop(false);

    expect(agent.getStatus()).toBe('stopped');
  });

  // ── Session resume tests ──────────────────────────────────────────

  it('isResumed is false by default in toJSON()', () => {
    const agent = new AgentInstance(makeOptions());
    const json = agent.toJSON();

    expect(json.isResumed).toBe(false);
  });

  it('isResumed is false during stub simulation even when resumeSession is set', async () => {
    const agent = new AgentInstance(
      makeOptions({
        resumeSession: 'old-session-id',
      }),
    );

    const startPromise = agent.start('test with resume');
    await vi.advanceTimersByTimeAsync(0);

    // In stub mode, resume is not supported so isResumed stays false
    const json = agent.toJSON();
    expect(json.isResumed).toBe(false);

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('logs a message when resumeSession is set but SDK is not available', async () => {
    const agent = new AgentInstance(
      makeOptions({
        resumeSession: 'session-to-resume',
      }),
    );

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    // Should log that resume is not supported in stub mode
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Session resume is not supported in stub simulation mode',
    );

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('passes resumeSessionId to runWithSdk when resumeSession is provided', async () => {
    const { runWithSdk } = await import('./sdk-runner.js');

    const agent = new AgentInstance(
      makeOptions({
        resumeSession: 'resume-from-options',
      }),
    );

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    expect(runWithSdk).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeSessionId: 'resume-from-options',
      }),
    );

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('does not pass resumeSessionId when no resumeSession is provided', async () => {
    const { runWithSdk } = await import('./sdk-runner.js');

    const agent = new AgentInstance(makeOptions());

    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    expect(runWithSdk).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeSessionId: undefined,
      }),
    );

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  // ── Session resume via SDK ───────────────────────────────────

  describe('session resume via SDK', () => {
    it('SDK run with resumeSessionId succeeds and sets isResumed=true', async () => {
      const { runWithSdk } = await import('./sdk-runner.js');

      (runWithSdk as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        sessionId: 'resumed-session-abc',
        costUsd: 0.05,
        tokensIn: 1000,
        tokensOut: 500,
        result: 'completed',
      });

      const agent = new AgentInstance(
        makeOptions({
          resumeSession: 'old-session-id',
        }),
      );

      const startPromise = agent.start('resume test');
      await vi.advanceTimersByTimeAsync(0);
      await startPromise;

      const json = agent.toJSON();
      expect(json.isResumed).toBe(true);
      expect(json.sessionId).toBe('resumed-session-abc');
      expect(json.costUsd).toBe(0.05);
      expect(json.status).toBe('stopped');
    });

    it('resume failure falls back to fresh session', async () => {
      const { runWithSdk } = await import('./sdk-runner.js');

      // First call (with resumeSessionId) throws AgentError
      (runWithSdk as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new AgentError('SDK_RUN_FAILED', 'Session not found', {}))
        // Second call (without resume) succeeds
        .mockResolvedValueOnce({
          sessionId: 'fresh-session-xyz',
          costUsd: 0.02,
          tokensIn: 500,
          tokensOut: 200,
          result: 'ok',
        });

      const agent = new AgentInstance(
        makeOptions({
          resumeSession: 'stale-session',
        }),
      );

      const startPromise = agent.start('resume test');
      await vi.advanceTimersByTimeAsync(0);
      await startPromise;

      // Should have called runWithSdk twice
      expect(runWithSdk).toHaveBeenCalledTimes(2);
      // First with resumeSessionId
      expect((runWithSdk as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveProperty(
        'resumeSessionId',
        'stale-session',
      );
      // Second without resumeSessionId
      expect((runWithSdk as ReturnType<typeof vi.fn>).mock.calls[1][0]).toHaveProperty(
        'resumeSessionId',
        undefined,
      );

      const json = agent.toJSON();
      expect(json.isResumed).toBe(false);
      expect(json.status).toBe('stopped');
    });

    it('resume not supported in stub mode logs info message', async () => {
      const { runWithSdk } = await import('./sdk-runner.js');

      // SDK not available — returns null
      (runWithSdk as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const agent = new AgentInstance(
        makeOptions({
          resumeSession: 'session-to-resume',
        }),
      );

      const startPromise = agent.start('test');
      await vi.advanceTimersByTimeAsync(0);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Session resume is not supported in stub simulation mode',
      );

      await agent.stop(false);
      vi.runAllTimers();
      await startPromise;
    });
  });

  // ── Execution timeout ──────────────────────────────────────────

  describe('execution timeout', () => {
    it('fires timeout, transitions to timeout status, and emits event with reason', async () => {
      const agent = new AgentInstance(
        makeOptions({
          maxExecutionMs: 300,
        }),
      );
      const events: AgentEvent[] = [];

      agent.onEvent((event: AgentEvent) => {
        events.push(event);
      });

      const startPromise = agent.start('long running task');
      await vi.advanceTimersByTimeAsync(0);

      expect(agent.getStatus()).toBe('running');

      // Trigger timeout
      await vi.advanceTimersByTimeAsync(400);

      expect(agent.getStatus()).toBe('timeout');
      expect(agent.getStoppedAt()).toBeInstanceOf(Date);

      const timeoutEvent = events.find((e) => e.event === 'status' && e.data.status === 'timeout');
      expect(timeoutEvent).toBeDefined();
      if (timeoutEvent?.event === 'status') {
        expect(timeoutEvent.data.reason).toBe('execution_timeout');
      }

      vi.runAllTimers();
      await startPromise;
    });
  });

  // ── notifyRunCompletion ────────────────────────────────────────

  describe('notifyRunCompletion', () => {
    it('posts a structured resultSummary and token usage to control plane after a successful SDK run', async () => {
      const { runWithSdk } = await import('./sdk-runner.js');
      vi.mocked(runWithSdk).mockResolvedValueOnce({
        sessionId: 'sess-summary-1',
        costUsd: 0.42,
        tokensIn: 1200,
        tokensOut: 450,
        result: 'Implemented the structured execution summary end-to-end.',
      });

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const agent = new AgentInstance(
        makeOptions({
          controlPlaneUrl: 'http://localhost:4000',
          runId: 'run-summary-1',
        }),
      );

      await agent.start('finish structured summaries');
      await vi.advanceTimersByTimeAsync(0);

      const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(callBody.tokensIn).toBe(1200);
      expect(callBody.tokensOut).toBe(450);
      expect(callBody.resultSummary).toMatchObject({
        status: 'success',
        workCompleted: 'Implemented the structured execution summary end-to-end.',
        executiveSummary: 'Implemented the structured execution summary end-to-end.',
        tokensUsed: { input: 1200, output: 450 },
        costUsd: 0.42,
      });

      fetchSpy.mockRestore();
    });

    it('posts completion to control plane when controlPlaneUrl and runId are set', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      const agent = new AgentInstance(
        makeOptions({
          controlPlaneUrl: 'http://localhost:4000',
          runId: 'run-42',
        }),
      );

      const startPromise = agent.start('test');
      await vi.advanceTimersByTimeAsync(0);

      await agent.stop(false);

      // Advance timers so fire-and-forget fetch resolves
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/agents/agent-1/complete'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(callBody.runId).toBe('run-42');
      expect(callBody.status).toBe('success');

      fetchSpy.mockRestore();
      vi.runAllTimers();
      await startPromise;
    });

    it('handles non-OK response from control plane gracefully', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

      const agent = new AgentInstance(
        makeOptions({
          controlPlaneUrl: 'http://localhost:4000',
          runId: 'run-err',
        }),
      );

      const startPromise = agent.start('test');
      await vi.advanceTimersByTimeAsync(0);

      // Should not throw
      await agent.stop(false);
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchSpy).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ httpStatus: 500 }),
        expect.stringContaining('non-OK response'),
      );

      fetchSpy.mockRestore();
      vi.runAllTimers();
      await startPromise;
    });

    it('handles fetch error gracefully', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('Network unreachable'));

      const agent = new AgentInstance(
        makeOptions({
          controlPlaneUrl: 'http://localhost:4000',
          runId: 'run-net-err',
        }),
      );

      const startPromise = agent.start('test');
      await vi.advanceTimersByTimeAsync(0);

      // Should not throw
      await agent.stop(false);
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchSpy).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('Failed to send run completion callback'),
      );

      fetchSpy.mockRestore();
      vi.runAllTimers();
      await startPromise;
    });

    it('does not call fetch when controlPlaneUrl is not set', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const agent = new AgentInstance(makeOptions());

      const startPromise = agent.start('test');
      await vi.advanceTimersByTimeAsync(0);

      await agent.stop(false);
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
      vi.runAllTimers();
      await startPromise;
    });
  });

  // ── stopAuditReporter ──────────────────────────────────────────

  describe('stopAuditReporter', () => {
    it('stops the audit reporter on finish when controlPlaneUrl and runId are set', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));
      const { AuditReporter } = await import('../hooks/audit-reporter.js');

      const agent = new AgentInstance(
        makeOptions({
          controlPlaneUrl: 'http://localhost:4000',
          runId: 'run-reporter',
        }),
      );

      const startPromise = agent.start('test');
      await vi.advanceTimersByTimeAsync(0);

      // AuditReporter should have been constructed
      expect(AuditReporter).toHaveBeenCalled();

      await agent.stop(false);
      await vi.advanceTimersByTimeAsync(0);

      // The reporter's stop method should have been called
      const reporterInstance = (AuditReporter as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(reporterInstance.stop).toHaveBeenCalled();

      fetchSpy.mockRestore();
      vi.runAllTimers();
      await startPromise;
    });

    it('handles audit reporter stop error gracefully', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));
      const { AuditReporter } = await import('../hooks/audit-reporter.js');

      // Make the reporter's stop throw
      (AuditReporter as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
        start: vi.fn(),
        stop: vi.fn().mockRejectedValue(new Error('Reporter flush failed')),
      }));

      const agent = new AgentInstance(
        makeOptions({
          controlPlaneUrl: 'http://localhost:4000',
          runId: 'run-reporter-err',
        }),
      );

      const startPromise = agent.start('test');
      await vi.advanceTimersByTimeAsync(0);

      // Should not throw
      await agent.stop(false);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('Failed to stop per-instance audit reporter'),
      );

      fetchSpy.mockRestore();
      vi.runAllTimers();
      await startPromise;
    });
  });

  // ── handleError ────────────────────────────────────────────────

  describe('handleError', () => {
    it('transitions to error status when SDK throws a non-AgentError', async () => {
      const { runWithSdk } = await import('./sdk-runner.js');

      // Make runWithSdk throw a generic error (not AgentError, so it won't be treated as resume_failed)
      (runWithSdk as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Unexpected SDK failure'),
      );

      const agent = new AgentInstance(makeOptions());
      const events: AgentEvent[] = [];

      agent.onEvent((event: AgentEvent) => {
        events.push(event);
      });

      const startPromise = agent.start('test');
      await vi.advanceTimersByTimeAsync(0);
      await startPromise;

      expect(agent.getStatus()).toBe('error');

      const errorEvent = events.find((e) => e.event === 'status' && e.data.status === 'error');
      expect(errorEvent).toBeDefined();
      if (errorEvent?.event === 'status') {
        expect(errorEvent.data.reason).toContain('Unexpected SDK failure');
      }
    });

    it('handleError notifies control plane on failure', async () => {
      const { runWithSdk } = await import('./sdk-runner.js');

      (runWithSdk as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('SDK crashed'));

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));

      const agent = new AgentInstance(
        makeOptions({
          controlPlaneUrl: 'http://localhost:4000',
          runId: 'run-error',
        }),
      );

      const startPromise = agent.start('test');
      await vi.advanceTimersByTimeAsync(0);
      await startPromise;

      expect(agent.getStatus()).toBe('error');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/agents/agent-1/complete'),
        expect.objectContaining({ method: 'POST' }),
      );

      const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(callBody.status).toBe('failure');
      expect(callBody.errorMessage).toContain('SDK crashed');
      expect(callBody.resultSummary).toMatchObject({
        status: 'failure',
        executiveSummary: expect.stringContaining('SDK crashed'),
      });

      fetchSpy.mockRestore();
      vi.runAllTimers();
    });
  });

  // ── Invalid state transition ───────────────────────────────────

  describe('invalid state transitions', () => {
    it('throws AgentError with INVALID_TRANSITION code for invalid transition', async () => {
      const agent = new AgentInstance(makeOptions());

      // Agent is in 'registered' state. Graceful stop tries 'stopping' which is invalid.
      try {
        await agent.stop(true);
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe('INVALID_TRANSITION');
        expect((err as AgentError).message).toContain('registered');
        expect((err as AgentError).message).toContain('stopping');
      }
    });
  });

  // ── toJSON ─────────────────────────────────────────────────────

  describe('toJSON', () => {
    it('returns correct structure with all fields after SDK run', async () => {
      const { runWithSdk } = await import('./sdk-runner.js');

      (runWithSdk as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        sessionId: 'sdk-session-123',
        costUsd: 0.1,
        tokensIn: 2000,
        tokensOut: 1000,
        result: 'done',
      });

      const agent = new AgentInstance(
        makeOptions({
          agentId: 'json-test',
          machineId: 'machine-json',
          projectPath: '/path/to/project',
          runId: 'run-json',
        }),
      );

      const startPromise = agent.start('test');
      await vi.advanceTimersByTimeAsync(0);
      await startPromise;

      const json = agent.toJSON();

      expect(json.agentId).toBe('json-test');
      expect(json.machineId).toBe('machine-json');
      expect(json.status).toBe('stopped');
      expect(json.sessionId).toBe('sdk-session-123');
      expect(json.runId).toBe('run-json');
      expect(json.startedAt).toBeDefined();
      expect(json.stoppedAt).toBeDefined();
      expect(json.costUsd).toBe(0.1);
      expect(json.projectPath).toBe('/path/to/project');
      expect(json.isResumed).toBe(false);
    });
  });

  // ── reportAction ───────────────────────────────────────────────

  describe('reportAction', () => {
    it('writes an audit entry via the audit logger', async () => {
      const { AuditLogger } = await import('../hooks/audit-logger.js');

      const agent = new AgentInstance(makeOptions());

      const auditEntry = {
        kind: 'pre_tool_use' as const,
        timestamp: new Date().toISOString(),
        sessionId: 'session-report',
        agentId: 'agent-1',
        tool: 'Bash',
        inputHash: 'abc123',
        decision: 'allow' as const,
      };

      await agent.reportAction(auditEntry);

      // Get the mocked AuditLogger instance
      const loggerInstance = (AuditLogger as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(loggerInstance.write).toHaveBeenCalledWith(auditEntry);
    });
  });
});
