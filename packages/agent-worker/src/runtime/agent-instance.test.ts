import type { AgentEvent } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentInstance, type AgentInstanceOptions } from './agent-instance.js';

// Mock the sdk-runner module so start() doesn't launch a real agent.
// Returning null causes the instance to fall back to stub simulation.
vi.mock('./sdk-runner.js', () => ({
  runWithSdk: vi.fn().mockResolvedValue(null),
}));

const mockLogger = {
  child: () => mockLogger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
} as unknown as Logger;

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
      projectPath: '/my/project',
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
});
