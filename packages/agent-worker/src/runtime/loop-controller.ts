import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { AgentEvent, LoopConfig, LoopState, LoopStatus } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { AgentInstance } from './agent-instance.js';

/** Minimum allowed delay between loop iterations (milliseconds). */
const MIN_ITERATION_DELAY_MS = 500;

/** Default delay between loop iterations (milliseconds). */
const DEFAULT_ITERATION_DELAY_MS = 1_000;

/** Maximum allowed delay between loop iterations (milliseconds). */
const MAX_ITERATION_DELAY_MS = 86_400_000;

/** Maximum allowed loop iterations in a single run. */
const MAX_LOOP_ITERATIONS = 10_000;

/** Number of consecutive identical results before dead-loop detection triggers. */
const DEAD_LOOP_THRESHOLD = 3;

/** Cost warning threshold as a fraction of costLimitUsd. */
const COST_WARNING_THRESHOLD = 0.8;

/**
 * Wraps an AgentInstance to provide continuous loop execution.
 *
 * Supports three modes:
 * - `result-feedback`: passes the previous iteration's result as the next prompt.
 * - `fixed-prompt`: re-uses `config.fixedPrompt` every iteration.
 * - `callback`: emits a `loop_callback` event and waits for an external prompt.
 *
 * Safety mechanisms:
 * - At least one limit required (maxIterations, costLimitUsd, maxDurationMs).
 * - Hard cap: maxIterations cannot exceed 10,000.
 * - Minimum iteration delay of 500ms.
 * - Dead-loop detection: stops after 3 consecutive identical results.
 * - Cost tracking with warning at 80% of limit.
 * - Duration tracking with wall-clock limit.
 */
export class LoopController extends EventEmitter {
  private readonly agent: AgentInstance;
  private readonly config: LoopConfig;
  private readonly log: Logger;
  private readonly iterationDelayMs: number;

  private status: LoopStatus = 'stopped';
  private iteration: number = 0;
  private totalCostUsd: number = 0;
  private startedAt: Date | null = null;
  private lastIterationAt: Date | null = null;

  /** Tracks content hashes of recent results for dead-loop detection. */
  private recentResultHashes: string[] = [];

  /** Whether a cost warning has been emitted for this loop run. */
  private costWarningEmitted: boolean = false;

  /** Resolves when a paused loop is resumed. */
  private resumeResolver: (() => void) | null = null;

  /** Set to true when stop() is called to signal the loop to exit after the current iteration. */
  private stopRequested: boolean = false;

  /** Resolves when the callback mode receives an external prompt. */
  private callbackResolver: ((prompt: string) => void) | null = null;

  /** Delay timer handle for cancellation on stop. */
  private delayTimer: ReturnType<typeof setTimeout> | null = null;

  /** Resolves the delay promise when the timer is cancelled. */
  private delayResolver: (() => void) | null = null;

  constructor(agent: AgentInstance, config: LoopConfig, logger: Logger) {
    super();
    this.agent = agent;
    this.config = config;
    this.log = logger.child({ component: 'loop-controller', agentId: agent.agentId });

    this.validateConfig(config);
    this.iterationDelayMs = this.resolveIterationDelayMs(config.iterationDelayMs);
  }

  /**
   * Start the loop with an initial prompt.
   * Resolves when the loop finishes (completed, stopped, or error).
   */
  async start(initialPrompt: string): Promise<void> {
    if (this.status === 'running' || this.status === 'paused') {
      throw new AgentError('LOOP_ALREADY_RUNNING', 'Loop is already running or paused', {
        agentId: this.agent.agentId,
        status: this.status,
      });
    }

    this.reset();
    this.status = 'running';
    this.startedAt = new Date();

    this.log.info(
      {
        mode: this.config.mode,
        maxIterations: this.config.maxIterations,
        costLimitUsd: this.config.costLimitUsd,
        maxDurationMs: this.config.maxDurationMs,
        iterationDelayMs: this.iterationDelayMs,
      },
      'Loop started',
    );

    let nextPrompt: string = initialPrompt;

    try {
      while (this.currentStatus() === 'running' || this.currentStatus() === 'paused') {
        // Check stop request first — takes priority over pause
        if (this.stopRequested) {
          break;
        }

        // Handle pause
        if (this.currentStatus() === 'paused') {
          await this.waitForResume();
          if (this.stopRequested) {
            break;
          }
          continue;
        }

        // Check limits before starting the next iteration
        const limitReason = this.checkLimits();
        if (limitReason) {
          this.completeLoop(limitReason);
          return;
        }

        // Run iteration
        this.iteration++;
        const iterationStart = Date.now();

        this.log.info(
          { iteration: this.iteration, prompt: nextPrompt.slice(0, 100) },
          'Loop iteration starting',
        );

        const result = await this.runIteration(nextPrompt);

        const iterationDurationMs = Date.now() - iterationStart;
        const iterationCost = this.agent.getCostUsd();
        this.totalCostUsd += iterationCost;
        this.lastIterationAt = new Date();

        // Emit loop_iteration event
        this.emitAgentEvent({
          event: 'loop_iteration',
          data: {
            iteration: this.iteration,
            costUsd: iterationCost,
            durationMs: iterationDurationMs,
          },
        });

        this.log.info(
          {
            iteration: this.iteration,
            costUsd: iterationCost,
            totalCostUsd: this.totalCostUsd,
            durationMs: iterationDurationMs,
          },
          'Loop iteration completed',
        );

        // Cost warning at 80% of limit
        if (
          this.config.costLimitUsd != null &&
          !this.costWarningEmitted &&
          this.totalCostUsd >= this.config.costLimitUsd * COST_WARNING_THRESHOLD
        ) {
          this.costWarningEmitted = true;
          this.log.warn(
            {
              totalCostUsd: this.totalCostUsd,
              costLimitUsd: this.config.costLimitUsd,
            },
            'Loop cost approaching limit (80%)',
          );
        }

        // Dead-loop detection
        if (result != null) {
          const hash = createHash('sha256').update(result).digest('hex');
          this.recentResultHashes.push(hash);

          if (this.recentResultHashes.length > DEAD_LOOP_THRESHOLD) {
            this.recentResultHashes.shift();
          }

          if (
            this.recentResultHashes.length === DEAD_LOOP_THRESHOLD &&
            this.recentResultHashes.every((h) => h === this.recentResultHashes[0])
          ) {
            this.log.warn(
              { iteration: this.iteration, hash: this.recentResultHashes[0] },
              'Dead loop detected: 3 consecutive identical results',
            );
            this.completeLoop('dead_loop_detected');
            return;
          }
        }

        // Check stop request after iteration
        if (this.stopRequested) {
          break;
        }

        // Check limits after cost update
        const postLimitReason = this.checkLimits();
        if (postLimitReason) {
          this.completeLoop(postLimitReason);
          return;
        }

        // Determine next prompt
        nextPrompt = await this.getNextPrompt(result ?? '');

        // Delay between iterations (unless stopping)
        if (this.currentStatus() === 'running' && !this.stopRequested) {
          await this.delay();
        }
      }

      // If we exited the loop via stopRequested
      if (this.stopRequested) {
        this.status = 'stopped';
        this.emitAgentEvent({
          event: 'loop_complete',
          data: {
            totalIterations: this.iteration,
            totalCostUsd: this.totalCostUsd,
            reason: 'stopped',
          },
        });
        this.log.info(
          { totalIterations: this.iteration, totalCostUsd: this.totalCostUsd },
          'Loop stopped by request',
        );
      }
    } catch (err) {
      this.status = 'error';
      const message = err instanceof Error ? err.message : String(err);
      this.log.error({ err, iteration: this.iteration }, 'Loop encountered an error');
      this.emitAgentEvent({
        event: 'loop_complete',
        data: {
          totalIterations: this.iteration,
          totalCostUsd: this.totalCostUsd,
          reason: `error: ${message}`,
        },
      });
    }
  }

  /**
   * Gracefully stop the loop after the current iteration completes.
   */
  stop(): void {
    if (this.status !== 'running' && this.status !== 'paused') {
      return;
    }

    this.stopRequested = true;

    // If paused, set status back to running so the loop can exit.
    // Also resolve the resume promise if we're waiting in waitForResume().
    if (this.status === 'paused') {
      this.status = 'running';
      if (this.resumeResolver) {
        this.resumeResolver();
        this.resumeResolver = null;
      }
    }

    // Cancel any pending delay and resolve the promise so the loop can exit
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = null;
    }
    if (this.delayResolver) {
      this.delayResolver();
      this.delayResolver = null;
    }

    // If waiting for callback, resolve with empty to break out
    if (this.callbackResolver) {
      this.callbackResolver('');
      this.callbackResolver = null;
    }

    this.log.info('Loop stop requested');
  }

  /**
   * Pause the loop. The current iteration will finish, then the loop waits.
   */
  pause(): void {
    if (this.status !== 'running') {
      throw new AgentError('LOOP_NOT_RUNNING', 'Cannot pause: loop is not running', {
        agentId: this.agent.agentId,
        status: this.status,
      });
    }

    this.status = 'paused';
    this.log.info({ iteration: this.iteration }, 'Loop paused');
  }

  /**
   * Resume a paused loop.
   */
  resume(): void {
    if (this.status !== 'paused') {
      throw new AgentError('LOOP_NOT_PAUSED', 'Cannot resume: loop is not paused', {
        agentId: this.agent.agentId,
        status: this.status,
      });
    }

    this.status = 'running';
    if (this.resumeResolver) {
      this.resumeResolver();
      this.resumeResolver = null;
    }
    this.log.info({ iteration: this.iteration }, 'Loop resumed');
  }

  /**
   * Provide a prompt for callback mode. The loop will use this as the next prompt.
   */
  provideCallbackPrompt(prompt: string): void {
    if (this.callbackResolver) {
      this.callbackResolver(prompt);
      this.callbackResolver = null;
    }
  }

  /**
   * Return the current loop state.
   */
  getState(): LoopState {
    return {
      status: this.status,
      iteration: this.iteration,
      totalCostUsd: this.totalCostUsd,
      startedAt: this.startedAt ?? new Date(),
      lastIterationAt: this.lastIterationAt,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  /**
   * Read the current status without TypeScript control-flow narrowing.
   * This is needed because `status` is mutated asynchronously (e.g. by
   * `pause()` or `stop()`) and the compiler would otherwise narrow the
   * type inside the `while` loop body based on the assignment before it.
   */
  private currentStatus(): LoopStatus {
    return this.status;
  }

  private resolveIterationDelayMs(iterationDelayMs: number | undefined): number {
    if (iterationDelayMs == null) {
      return DEFAULT_ITERATION_DELAY_MS;
    }

    if (
      !Number.isFinite(iterationDelayMs) ||
      iterationDelayMs < MIN_ITERATION_DELAY_MS ||
      iterationDelayMs > MAX_ITERATION_DELAY_MS
    ) {
      throw new AgentError(
        'LOOP_INVALID_DELAY',
        `iterationDelayMs must be between ${MIN_ITERATION_DELAY_MS}ms and ${MAX_ITERATION_DELAY_MS}ms, got ${iterationDelayMs}ms`,
        {
          iterationDelayMs,
          minimum: MIN_ITERATION_DELAY_MS,
          maximum: MAX_ITERATION_DELAY_MS,
        },
      );
    }

    return iterationDelayMs;
  }

  private validateConfig(config: LoopConfig): void {
    const hasMaxIterations = config.maxIterations != null && config.maxIterations > 0;
    const hasCostLimit = config.costLimitUsd != null && config.costLimitUsd > 0;
    const hasDurationLimit = config.maxDurationMs != null && config.maxDurationMs > 0;

    if (!hasMaxIterations && !hasCostLimit && !hasDurationLimit) {
      throw new AgentError(
        'LOOP_NO_LIMITS',
        'At least one limit is required: maxIterations, costLimitUsd, or maxDurationMs',
        { config },
      );
    }

    if (
      config.maxIterations != null &&
      (!Number.isInteger(config.maxIterations) ||
        config.maxIterations < 1 ||
        config.maxIterations > MAX_LOOP_ITERATIONS)
    ) {
      throw new AgentError(
        'INVALID_INPUT',
        `maxIterations must be an integer between 1 and ${MAX_LOOP_ITERATIONS}`,
        {
          maxIterations: config.maxIterations,
          minimum: 1,
          maximum: MAX_LOOP_ITERATIONS,
        },
      );
    }

    if (config.mode === 'fixed-prompt' && !config.fixedPrompt) {
      throw new AgentError(
        'LOOP_MISSING_FIXED_PROMPT',
        'fixedPrompt is required when mode is "fixed-prompt"',
        { mode: config.mode },
      );
    }
  }

  private reset(): void {
    this.iteration = 0;
    this.totalCostUsd = 0;
    this.startedAt = null;
    this.lastIterationAt = null;
    this.recentResultHashes = [];
    this.costWarningEmitted = false;
    this.stopRequested = false;
    this.resumeResolver = null;
    this.callbackResolver = null;
    this.delayTimer = null;
    this.delayResolver = null;
  }

  /**
   * Run a single iteration by starting the agent and waiting for it to stop.
   * Returns the text result captured from agent output events, or null.
   */
  private async runIteration(prompt: string): Promise<string | null> {
    return new Promise<string | null>((resolve, reject) => {
      let result: string | null = null;

      const onEvent = (event: AgentEvent): void => {
        if (event.event === 'output' && event.data.type === 'text') {
          // Capture the last text output as the result
          result = event.data.content;
        }

        if (event.event === 'status') {
          if (
            event.data.status === 'stopped' ||
            event.data.status === 'error' ||
            event.data.status === 'timeout'
          ) {
            this.agent.offEvent(onEvent);

            if (event.data.status === 'error') {
              reject(
                new AgentError(
                  'LOOP_ITERATION_ERROR',
                  `Iteration ${this.iteration} failed: ${event.data.reason ?? 'unknown'}`,
                  {
                    iteration: this.iteration,
                    reason: event.data.reason,
                  },
                ),
              );
            } else if (event.data.status === 'timeout') {
              reject(
                new AgentError('LOOP_ITERATION_TIMEOUT', `Iteration ${this.iteration} timed out`, {
                  iteration: this.iteration,
                }),
              );
            } else {
              resolve(result);
            }
          }
        }
      };

      this.agent.onEvent(onEvent);

      this.agent.start(prompt).catch((err) => {
        this.agent.offEvent(onEvent);
        reject(err);
      });
    });
  }

  /**
   * Determine the next prompt based on the loop mode.
   */
  private async getNextPrompt(lastResult: string): Promise<string> {
    switch (this.config.mode) {
      case 'result-feedback':
        return lastResult;

      case 'fixed-prompt':
        return this.config.fixedPrompt ?? '';

      case 'callback':
        return this.waitForCallback();

      default:
        throw new AgentError(
          'LOOP_INVALID_MODE',
          `Unknown loop mode: ${String(this.config.mode)}`,
          {
            mode: this.config.mode,
          },
        );
    }
  }

  /**
   * Wait for an external prompt in callback mode.
   */
  private waitForCallback(): Promise<string> {
    return new Promise<string>((resolve) => {
      this.callbackResolver = resolve;
      this.emit('loop_callback', {
        iteration: this.iteration,
        totalCostUsd: this.totalCostUsd,
      });
    });
  }

  /**
   * Wait for resume after pause.
   */
  private waitForResume(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.resumeResolver = resolve;
    });
  }

  /**
   * Delay between iterations with cancellation support.
   * When stop() is called, it resolves the delay promise immediately.
   */
  private delay(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.delayResolver = resolve;
      this.delayTimer = setTimeout(() => {
        this.delayTimer = null;
        this.delayResolver = null;
        resolve();
      }, this.iterationDelayMs);
    });
  }

  /**
   * Check all configured limits. Returns a reason string if a limit is hit, null otherwise.
   */
  private checkLimits(): string | null {
    const maxIterations = this.config.maxIterations ?? MAX_LOOP_ITERATIONS;
    if (this.iteration >= maxIterations) {
      return 'max_iterations_reached';
    }

    if (this.config.costLimitUsd != null && this.totalCostUsd >= this.config.costLimitUsd) {
      return 'cost_limit_reached';
    }

    if (this.config.maxDurationMs != null && this.startedAt) {
      const elapsed = Date.now() - this.startedAt.getTime();
      if (elapsed >= this.config.maxDurationMs) {
        return 'max_duration_reached';
      }
    }

    return null;
  }

  /**
   * Complete the loop with a reason and emit the loop_complete event.
   */
  private completeLoop(reason: string): void {
    this.status = 'completed';

    this.emitAgentEvent({
      event: 'loop_complete',
      data: {
        totalIterations: this.iteration,
        totalCostUsd: this.totalCostUsd,
        reason,
      },
    });

    this.log.info(
      { totalIterations: this.iteration, totalCostUsd: this.totalCostUsd, reason },
      'Loop completed',
    );
  }

  /**
   * Emit an event through both the agent instance and the loop controller.
   */
  private emitAgentEvent(event: AgentEvent): void {
    this.emit('loop-event', event);
  }
}
