import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { Logger } from 'pino';

import type { AgentEvent } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';

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
      startedAt: null,
      stoppedAt: null,
      costUsd: 0,
      projectPath: '/my/project',
    });
  });
});
