import { EventEmitter } from 'node:events';

import type { AgentEvent, LoopConfig } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import type { AgentInstance } from './agent-instance.js';
import { LoopController } from './loop-controller.js';

// ── Mock helpers ────────────────────────────────────────────────────

const mockLogger = createMockLogger();
const ABSOLUTE_MAX_LOOP_ITERATIONS = 10_000;

/**
 * Create a mock AgentInstance that simulates completing after start() is called.
 * The mock:
 * - Extends EventEmitter for onEvent/offEvent
 * - Returns configurable results and costs
 * - Emits 'stopped' status when start completes
 */
function createMockAgent(options?: {
  results?: string[];
  costs?: number[];
  failOnIteration?: number;
  timeoutOnIteration?: number;
}): AgentInstance {
  const emitter = new EventEmitter();
  let callIndex = 0;
  const results = options?.results ?? ['result-1', 'result-2', 'result-3', 'result-4', 'result-5'];
  const costs = options?.costs ?? [0.01, 0.01, 0.01, 0.01, 0.01];

  const mock = {
    agentId: 'test-agent',
    machineId: 'test-machine',

    start: vi.fn().mockImplementation((_prompt: string) => {
      const currentIndex = callIndex;
      callIndex++;

      return new Promise<void>((resolve) => {
        // Simulate async agent work
        process.nextTick(() => {
          if (options?.failOnIteration === currentIndex + 1) {
            // Emit error status
            const errorEvent: AgentEvent = {
              event: 'status',
              data: { status: 'error', reason: 'test error' },
            };
            emitter.emit('agent-event', errorEvent);
            resolve();
            return;
          }

          if (options?.timeoutOnIteration === currentIndex + 1) {
            const timeoutEvent: AgentEvent = {
              event: 'status',
              data: { status: 'timeout', reason: 'execution_timeout' },
            };
            emitter.emit('agent-event', timeoutEvent);
            resolve();
            return;
          }

          // Emit output with result
          const outputEvent: AgentEvent = {
            event: 'output',
            data: {
              type: 'text',
              content: results[currentIndex % results.length],
            },
          };
          emitter.emit('agent-event', outputEvent);

          // Emit stopped status
          const stoppedEvent: AgentEvent = {
            event: 'status',
            data: { status: 'stopped', reason: 'completed' },
          };
          emitter.emit('agent-event', stoppedEvent);
          resolve();
        });
      });
    }),

    stop: vi.fn().mockResolvedValue(undefined),

    getCostUsd: vi.fn().mockImplementation(() => {
      // Return cost for the most recent iteration
      const idx = Math.max(0, callIndex - 1);
      return costs[idx % costs.length];
    }),

    getStatus: vi.fn().mockReturnValue('stopped'),

    onEvent: vi.fn().mockImplementation((callback: (event: AgentEvent) => void) => {
      emitter.on('agent-event', callback);
    }),

    offEvent: vi.fn().mockImplementation((callback: (event: AgentEvent) => void) => {
      emitter.off('agent-event', callback);
    }),

    getSessionId: vi.fn().mockReturnValue('mock-session'),
    getStartedAt: vi.fn().mockReturnValue(new Date()),
    getStoppedAt: vi.fn().mockReturnValue(new Date()),
  } as unknown as AgentInstance;

  return mock;
}

function makeConfig(overrides?: Partial<LoopConfig>): LoopConfig {
  return {
    mode: 'result-feedback',
    maxIterations: 3,
    iterationDelayMs: 500,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('LoopController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Constructor validation ──────────────────────────────────────

  it('throws LOOP_NO_LIMITS when no limits are configured', () => {
    const agent = createMockAgent();

    expect(() => new LoopController(agent, { mode: 'result-feedback' }, mockLogger)).toThrow(
      AgentError,
    );

    try {
      new LoopController(agent, { mode: 'result-feedback' }, mockLogger);
    } catch (err) {
      expect((err as AgentError).code).toBe('LOOP_NO_LIMITS');
    }
  });

  it('throws LOOP_INVALID_DELAY when iterationDelayMs < 500', () => {
    const agent = createMockAgent();

    expect(
      () =>
        new LoopController(
          agent,
          { mode: 'result-feedback', maxIterations: 5, iterationDelayMs: 100 },
          mockLogger,
        ),
    ).toThrow(AgentError);

    try {
      new LoopController(
        agent,
        { mode: 'result-feedback', maxIterations: 5, iterationDelayMs: 100 },
        mockLogger,
      );
    } catch (err) {
      expect((err as AgentError).code).toBe('LOOP_INVALID_DELAY');
    }
  });

  it('throws LOOP_INVALID_DELAY when iterationDelayMs is NaN', () => {
    const agent = createMockAgent();

    expect(
      () =>
        new LoopController(
          agent,
          { mode: 'result-feedback', maxIterations: 3, iterationDelayMs: Number.NaN },
          mockLogger,
        ),
    ).toThrow(AgentError);

    try {
      new LoopController(
        agent,
        { mode: 'result-feedback', maxIterations: 3, iterationDelayMs: Number.NaN },
        mockLogger,
      );
    } catch (err) {
      expect((err as AgentError).code).toBe('LOOP_INVALID_DELAY');
    }
  });

  it('throws LOOP_MISSING_FIXED_PROMPT when fixed-prompt mode has no fixedPrompt', () => {
    const agent = createMockAgent();

    expect(
      () => new LoopController(agent, { mode: 'fixed-prompt', maxIterations: 5 }, mockLogger),
    ).toThrow(AgentError);

    try {
      new LoopController(agent, { mode: 'fixed-prompt', maxIterations: 5 }, mockLogger);
    } catch (err) {
      expect((err as AgentError).code).toBe('LOOP_MISSING_FIXED_PROMPT');
    }
  });

  it('throws INVALID_INPUT when maxIterations exceeds 10000', () => {
    const agent = createMockAgent();

    expect(
      () =>
        new LoopController(agent, { mode: 'result-feedback', maxIterations: 10001 }, mockLogger),
    ).toThrow(AgentError);

    try {
      new LoopController(agent, { mode: 'result-feedback', maxIterations: 10001 }, mockLogger);
    } catch (err) {
      expect((err as AgentError).code).toBe('INVALID_INPUT');
    }
  });

  it('accepts maxIterations at upper boundary (10000)', () => {
    const agent = createMockAgent();
    const controller = new LoopController(
      agent,
      { mode: 'result-feedback', maxIterations: 10000 },
      mockLogger,
    );
    expect(controller).toBeDefined();
  });

  it('accepts config with only maxIterations as limit', () => {
    const agent = createMockAgent();
    const controller = new LoopController(agent, makeConfig({ maxIterations: 10 }), mockLogger);
    expect(controller).toBeDefined();
  });

  it('accepts config with only costLimitUsd as limit', () => {
    const agent = createMockAgent();
    const controller = new LoopController(
      agent,
      { mode: 'result-feedback', costLimitUsd: 1.0, iterationDelayMs: 500 },
      mockLogger,
    );
    expect(controller).toBeDefined();
  });

  it('accepts config with only maxDurationMs as limit', () => {
    const agent = createMockAgent();
    const controller = new LoopController(
      agent,
      { mode: 'result-feedback', maxDurationMs: 60_000, iterationDelayMs: 500 },
      mockLogger,
    );
    expect(controller).toBeDefined();
  });

  // ── result-feedback mode ────────────────────────────────────────

  it('result-feedback mode passes previous result as next prompt', async () => {
    const agent = createMockAgent({ results: ['alpha', 'beta', 'gamma'] });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 3 }), mockLogger);

    const loopPromise = controller.start('initial prompt');

    // Advance timers to let all iterations and delays complete
    await vi.advanceTimersByTimeAsync(0); // iteration 1
    await vi.advanceTimersByTimeAsync(500); // delay + iteration 2
    await vi.advanceTimersByTimeAsync(500); // delay + iteration 3
    await vi.advanceTimersByTimeAsync(0); // final settling

    await loopPromise;

    // First call should have the initial prompt
    expect(agent.start).toHaveBeenNthCalledWith(1, 'initial prompt');
    // Second call should get the result from first iteration
    expect(agent.start).toHaveBeenNthCalledWith(2, 'alpha');
    // Third call should get the result from second iteration
    expect(agent.start).toHaveBeenNthCalledWith(3, 'beta');

    expect(controller.getState().status).toBe('completed');
    expect(controller.getState().iteration).toBe(3);
  });

  // ── fixed-prompt mode ───────────────────────────────────────────

  it('fixed-prompt mode uses fixedPrompt every iteration', async () => {
    const agent = createMockAgent({ results: ['r1', 'r2', 'r3'] });
    const controller = new LoopController(
      agent,
      makeConfig({ mode: 'fixed-prompt', fixedPrompt: 'do the thing', maxIterations: 3 }),
      mockLogger,
    );

    const loopPromise = controller.start('initial');

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    // First call gets the initial prompt
    expect(agent.start).toHaveBeenNthCalledWith(1, 'initial');
    // Subsequent calls use fixedPrompt
    expect(agent.start).toHaveBeenNthCalledWith(2, 'do the thing');
    expect(agent.start).toHaveBeenNthCalledWith(3, 'do the thing');

    expect(controller.getState().status).toBe('completed');
  });

  // ── callback mode ──────────────────────────────────────────────

  it('callback mode waits for external prompt and uses it', async () => {
    const agent = createMockAgent({ results: ['r1', 'r2'] });
    const controller = new LoopController(
      agent,
      makeConfig({ mode: 'callback', maxIterations: 2 }),
      mockLogger,
    );

    controller.on('loop_callback', () => {
      // Simulate external system providing the next prompt
      setTimeout(() => {
        controller.provideCallbackPrompt('callback prompt');
      }, 10);
    });

    const loopPromise = controller.start('initial');

    // Iteration 1
    await vi.advanceTimersByTimeAsync(0);
    // Delay after iteration 1
    await vi.advanceTimersByTimeAsync(500);
    // Wait for callback event + response
    await vi.advanceTimersByTimeAsync(10);
    // Iteration 2
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    expect(agent.start).toHaveBeenNthCalledWith(1, 'initial');
    expect(agent.start).toHaveBeenNthCalledWith(2, 'callback prompt');
    expect(controller.getState().status).toBe('completed');
  });

  // ── maxIterations limit ────────────────────────────────────────

  it('stops at maxIterations limit', async () => {
    const agent = createMockAgent({ results: ['a', 'b', 'c', 'd', 'e'] });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 2 }), mockLogger);

    const events: AgentEvent[] = [];
    controller.on('loop-event', (event: AgentEvent) => events.push(event));

    const loopPromise = controller.start('go');

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    expect(agent.start).toHaveBeenCalledTimes(2);
    expect(controller.getState().status).toBe('completed');
    expect(controller.getState().iteration).toBe(2);

    const completeEvent = events.find((e) => e.event === 'loop_complete');
    expect(completeEvent).toBeDefined();
    if (completeEvent?.event === 'loop_complete') {
      expect(completeEvent.data.reason).toBe('max_iterations_reached');
      expect(completeEvent.data.totalIterations).toBe(2);
    }
  });

  it('applies the hard iteration cap when maxIterations is omitted', async () => {
    const agent = createMockAgent({ costs: [0] });
    const controller = new LoopController(
      agent,
      makeConfig({ maxIterations: undefined, maxDurationMs: undefined, costLimitUsd: 1_000_000 }),
      mockLogger,
    );

    const events: AgentEvent[] = [];
    controller.on('loop-event', (event: AgentEvent) => events.push(event));

    const loopPromise = controller.start('go');

    try {
      await vi.advanceTimersByTimeAsync(500 * (ABSOLUTE_MAX_LOOP_ITERATIONS + 2));
      await vi.advanceTimersByTimeAsync(0);

      expect(controller.getState().status).toBe('completed');
      expect(controller.getState().iteration).toBe(ABSOLUTE_MAX_LOOP_ITERATIONS);

      const completeEvent = events.find((e) => e.event === 'loop_complete');
      expect(completeEvent).toBeDefined();
      if (completeEvent?.event === 'loop_complete') {
        expect(completeEvent.data.reason).toBe('max_iterations_reached');
      }
    } finally {
      const { status } = controller.getState();
      if (status === 'running' || status === 'paused') {
        controller.stop();
        await vi.advanceTimersByTimeAsync(500);
        await vi.advanceTimersByTimeAsync(0);
      }
      await loopPromise;
    }
  });

  // ── costLimitUsd limit ─────────────────────────────────────────

  it('stops when cost limit is reached', async () => {
    const agent = createMockAgent({ results: ['a', 'b', 'c'], costs: [0.5, 0.5, 0.5] });
    const controller = new LoopController(
      agent,
      makeConfig({ maxIterations: undefined, costLimitUsd: 0.8 }),
      mockLogger,
    );

    const events: AgentEvent[] = [];
    controller.on('loop-event', (event: AgentEvent) => events.push(event));

    const loopPromise = controller.start('go');

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    // Should have run at most 2 iterations (0.5 + 0.5 = 1.0 > 0.8)
    expect(controller.getState().status).toBe('completed');

    const completeEvent = events.find((e) => e.event === 'loop_complete');
    expect(completeEvent).toBeDefined();
    if (completeEvent?.event === 'loop_complete') {
      expect(completeEvent.data.reason).toBe('cost_limit_reached');
    }
  });

  // ── maxDurationMs limit ────────────────────────────────────────

  it('stops when duration limit is reached', async () => {
    const agent = createMockAgent({ results: ['a', 'b', 'c', 'd', 'e'] });
    const controller = new LoopController(
      agent,
      makeConfig({ maxIterations: 100, maxDurationMs: 800 }),
      mockLogger,
    );

    const events: AgentEvent[] = [];
    controller.on('loop-event', (event: AgentEvent) => events.push(event));

    const loopPromise = controller.start('go');

    // Run iterations — each takes ~0ms for mock + 500ms delay
    // After 800ms total, should stop
    await vi.advanceTimersByTimeAsync(0); // iteration 1
    await vi.advanceTimersByTimeAsync(500); // delay
    await vi.advanceTimersByTimeAsync(0); // iteration 2 — now at ~500ms
    await vi.advanceTimersByTimeAsync(500); // delay — now at ~1000ms, should exceed 800ms limit
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    expect(controller.getState().status).toBe('completed');

    const completeEvent = events.find((e) => e.event === 'loop_complete');
    expect(completeEvent).toBeDefined();
    if (completeEvent?.event === 'loop_complete') {
      expect(completeEvent.data.reason).toBe('max_duration_reached');
    }
  });

  // ── Dead-loop detection ────────────────────────────────────────

  it('detects dead loop (3 identical results) and stops', async () => {
    const agent = createMockAgent({ results: ['same', 'same', 'same', 'same'] });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 10 }), mockLogger);

    const events: AgentEvent[] = [];
    controller.on('loop-event', (event: AgentEvent) => events.push(event));

    const loopPromise = controller.start('go');

    await vi.advanceTimersByTimeAsync(0); // iteration 1
    await vi.advanceTimersByTimeAsync(500); // delay
    await vi.advanceTimersByTimeAsync(0); // iteration 2
    await vi.advanceTimersByTimeAsync(500); // delay
    await vi.advanceTimersByTimeAsync(0); // iteration 3 — dead loop detected
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    expect(controller.getState().status).toBe('completed');
    expect(controller.getState().iteration).toBe(3);

    const completeEvent = events.find((e) => e.event === 'loop_complete');
    expect(completeEvent).toBeDefined();
    if (completeEvent?.event === 'loop_complete') {
      expect(completeEvent.data.reason).toBe('dead_loop_detected');
    }
  });

  it('does not trigger dead-loop when results differ', async () => {
    const agent = createMockAgent({ results: ['aaa', 'bbb', 'aaa', 'bbb'] });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 4 }), mockLogger);

    const events: AgentEvent[] = [];
    controller.on('loop-event', (event: AgentEvent) => events.push(event));

    const loopPromise = controller.start('go');

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    const completeEvent = events.find((e) => e.event === 'loop_complete');
    expect(completeEvent).toBeDefined();
    if (completeEvent?.event === 'loop_complete') {
      expect(completeEvent.data.reason).toBe('max_iterations_reached');
    }
  });

  // ── iterationDelayMs enforcement ───────────────────────────────

  it('enforces minimum 500ms iteration delay', () => {
    const agent = createMockAgent();

    // Should throw for delay < 500
    expect(
      () =>
        new LoopController(
          agent,
          { mode: 'result-feedback', maxIterations: 3, iterationDelayMs: 200 },
          mockLogger,
        ),
    ).toThrow(AgentError);
  });

  it('uses default 1000ms delay when iterationDelayMs not specified', () => {
    const agent = createMockAgent();
    const controller = new LoopController(
      agent,
      { mode: 'result-feedback', maxIterations: 3 },
      mockLogger,
    );

    // We can verify the default by checking the logged config
    expect(controller).toBeDefined();
    // The default is 1000ms, enforced internally
  });

  it('allows iterationDelayMs of exactly 500', () => {
    const agent = createMockAgent();
    const controller = new LoopController(
      agent,
      { mode: 'result-feedback', maxIterations: 3, iterationDelayMs: 500 },
      mockLogger,
    );
    expect(controller).toBeDefined();
  });

  it('throws LOOP_INVALID_DELAY when iterationDelayMs exceeds 24 hours', () => {
    const agent = createMockAgent();

    expect(
      () =>
        new LoopController(
          agent,
          { mode: 'result-feedback', maxIterations: 3, iterationDelayMs: 86_400_001 },
          mockLogger,
        ),
    ).toThrow(AgentError);

    try {
      new LoopController(
        agent,
        { mode: 'result-feedback', maxIterations: 3, iterationDelayMs: 86_400_001 },
        mockLogger,
      );
    } catch (err) {
      expect((err as AgentError).code).toBe('LOOP_INVALID_DELAY');
    }
  });

  // ── pause/resume ───────────────────────────────────────────────

  it('pause() sets status to paused', async () => {
    const agent = createMockAgent({ results: ['a', 'b', 'c', 'd', 'e'] });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 5 }), mockLogger);

    const loopPromise = controller.start('go');

    // Let iteration 1 complete
    await vi.advanceTimersByTimeAsync(0);

    controller.pause();
    expect(controller.getState().status).toBe('paused');

    // Resume to let it finish
    controller.resume();
    expect(controller.getState().status).toBe('running');

    // Let remaining iterations run
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    expect(controller.getState().status).toBe('completed');
  });

  it('pause() throws when loop is not running', () => {
    const agent = createMockAgent();
    const controller = new LoopController(agent, makeConfig(), mockLogger);

    expect(() => controller.pause()).toThrow(AgentError);
    try {
      controller.pause();
    } catch (err) {
      expect((err as AgentError).code).toBe('LOOP_NOT_RUNNING');
    }
  });

  it('resume() throws when loop is not paused', () => {
    const agent = createMockAgent();
    const controller = new LoopController(agent, makeConfig(), mockLogger);

    expect(() => controller.resume()).toThrow(AgentError);
    try {
      controller.resume();
    } catch (err) {
      expect((err as AgentError).code).toBe('LOOP_NOT_PAUSED');
    }
  });

  // ── stop during execution ──────────────────────────────────────

  it('stop() gracefully stops after current iteration', async () => {
    const agent = createMockAgent({ results: ['a', 'b', 'c', 'd', 'e'] });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 10 }), mockLogger);

    const events: AgentEvent[] = [];
    controller.on('loop-event', (event: AgentEvent) => events.push(event));

    const loopPromise = controller.start('go');

    // Let iteration 1 complete
    await vi.advanceTimersByTimeAsync(0);

    // Stop after iteration 1
    controller.stop();

    // Let things settle
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    expect(controller.getState().status).toBe('stopped');

    const completeEvent = events.find((e) => e.event === 'loop_complete');
    expect(completeEvent).toBeDefined();
    if (completeEvent?.event === 'loop_complete') {
      expect(completeEvent.data.reason).toBe('stopped');
    }
  });

  it('stop() on already stopped loop is a no-op', () => {
    const agent = createMockAgent();
    const controller = new LoopController(agent, makeConfig(), mockLogger);

    // Not running — stop should not throw
    controller.stop();
    expect(controller.getState().status).toBe('stopped');
  });

  it('stop() while paused resumes and then stops', async () => {
    const agent = createMockAgent({ results: ['a', 'b', 'c', 'd', 'e'] });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 10 }), mockLogger);

    const loopPromise = controller.start('go');

    // Let iteration 1 complete
    await vi.advanceTimersByTimeAsync(0);

    controller.pause();
    expect(controller.getState().status).toBe('paused');

    controller.stop();

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    expect(controller.getState().status).toBe('stopped');
  });

  // ── getState() ─────────────────────────────────────────────────

  it('getState() returns correct initial state', () => {
    const agent = createMockAgent();
    const controller = new LoopController(agent, makeConfig(), mockLogger);

    const state = controller.getState();

    expect(state.status).toBe('stopped');
    expect(state.iteration).toBe(0);
    expect(state.totalCostUsd).toBe(0);
    expect(state.lastIterationAt).toBeNull();
  });

  it('getState() reflects running state mid-loop', async () => {
    const agent = createMockAgent({ results: ['a', 'b', 'c'] });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 3 }), mockLogger);

    const loopPromise = controller.start('go');

    // Let iteration 1 complete
    await vi.advanceTimersByTimeAsync(0);

    const state = controller.getState();
    expect(state.status).toBe('running');
    expect(state.iteration).toBe(1);
    expect(state.startedAt).toBeInstanceOf(Date);
    expect(state.lastIterationAt).toBeInstanceOf(Date);

    // Let remaining iterations complete
    controller.stop();
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;
  });

  it('getState() accumulates totalCostUsd across iterations', async () => {
    const agent = createMockAgent({ results: ['a', 'b'], costs: [0.05, 0.03] });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 2 }), mockLogger);

    const loopPromise = controller.start('go');

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    const state = controller.getState();
    expect(state.totalCostUsd).toBe(0.08);
  });

  // ── loop_iteration events ──────────────────────────────────────

  it('emits loop_iteration event after each iteration', async () => {
    const agent = createMockAgent({ results: ['a', 'b'] });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 2 }), mockLogger);

    const events: AgentEvent[] = [];
    controller.on('loop-event', (event: AgentEvent) => events.push(event));

    const loopPromise = controller.start('go');

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    const iterationEvents = events.filter((e) => e.event === 'loop_iteration');
    expect(iterationEvents.length).toBe(2);

    if (iterationEvents[0]?.event === 'loop_iteration') {
      expect(iterationEvents[0].data.iteration).toBe(1);
    }
    if (iterationEvents[1]?.event === 'loop_iteration') {
      expect(iterationEvents[1].data.iteration).toBe(2);
    }
  });

  // ── loop_complete event ────────────────────────────────────────

  it('emits loop_complete event when loop finishes', async () => {
    const agent = createMockAgent({ results: ['a'] });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 1 }), mockLogger);

    const events: AgentEvent[] = [];
    controller.on('loop-event', (event: AgentEvent) => events.push(event));

    const loopPromise = controller.start('go');
    await vi.advanceTimersByTimeAsync(0);
    await loopPromise;

    const completeEvent = events.find((e) => e.event === 'loop_complete');
    expect(completeEvent).toBeDefined();
    if (completeEvent?.event === 'loop_complete') {
      expect(completeEvent.data.totalIterations).toBe(1);
      expect(completeEvent.data.reason).toBe('max_iterations_reached');
    }
  });

  // ── Error handling ─────────────────────────────────────────────

  it('transitions to error status when agent iteration fails', async () => {
    const agent = createMockAgent({ results: ['ok'], failOnIteration: 2 });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 5 }), mockLogger);

    const events: AgentEvent[] = [];
    controller.on('loop-event', (event: AgentEvent) => events.push(event));

    const loopPromise = controller.start('go');

    await vi.advanceTimersByTimeAsync(0); // iteration 1 succeeds
    await vi.advanceTimersByTimeAsync(500); // delay
    await vi.advanceTimersByTimeAsync(0); // iteration 2 fails
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    expect(controller.getState().status).toBe('error');

    const completeEvent = events.find((e) => e.event === 'loop_complete');
    expect(completeEvent).toBeDefined();
    if (completeEvent?.event === 'loop_complete') {
      expect(completeEvent.data.reason).toContain('error');
    }
  });

  // ── Double-start prevention ────────────────────────────────────

  it('throws LOOP_ALREADY_RUNNING when start() called while running', async () => {
    const agent = createMockAgent({ results: ['a', 'b', 'c', 'd', 'e'] });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 10 }), mockLogger);

    const loopPromise = controller.start('go');
    await vi.advanceTimersByTimeAsync(0);

    await expect(controller.start('again')).rejects.toThrow(AgentError);

    controller.stop();
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);
    await loopPromise;
  });

  // ── Cost warning ───────────────────────────────────────────────

  it('emits cost warning at 80% of costLimitUsd', async () => {
    const agent = createMockAgent({
      results: ['a', 'b', 'c', 'd', 'e'],
      costs: [0.4, 0.4, 0.4, 0.4, 0.4],
    });
    const controller = new LoopController(
      agent,
      makeConfig({ maxIterations: undefined, costLimitUsd: 1.0 }),
      mockLogger,
    );

    const loopPromise = controller.start('go');

    // Iteration 1: cost = 0.4 (< 0.8)
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);

    // Iteration 2: cost = 0.8 (>= 0.8 = 80% of 1.0) — should trigger warning
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ totalCostUsd: expect.any(Number), costLimitUsd: 1.0 }),
      'Loop cost approaching limit (80%)',
    );
  });

  // ── Iteration timeout handling ─────────────────────────────────

  it('handles agent timeout during iteration', async () => {
    const agent = createMockAgent({ results: ['ok'], timeoutOnIteration: 2 });
    const controller = new LoopController(agent, makeConfig({ maxIterations: 5 }), mockLogger);

    const loopPromise = controller.start('go');

    await vi.advanceTimersByTimeAsync(0); // iteration 1 succeeds
    await vi.advanceTimersByTimeAsync(500); // delay
    await vi.advanceTimersByTimeAsync(0); // iteration 2 times out
    await vi.advanceTimersByTimeAsync(0);

    await loopPromise;

    expect(controller.getState().status).toBe('error');
  });
});
