import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { AgentConfig, AgentEvent, AgentStatus } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';
import type { Logger } from 'pino';

import { AuditLogger } from '../hooks/audit-logger.js';
import { createPostToolUseHook } from '../hooks/post-tool-use.js';
import { createPreToolUseHook } from '../hooks/pre-tool-use.js';
import { createStopHook } from '../hooks/stop-hook.js';
import { OutputBuffer } from './output-buffer.js';
import { runWithSdk, type SdkRunnerHooks } from './sdk-runner.js';

const DEFAULT_AUDIT_LOG_DIR = '.agentctl/audit';

/** Default max execution time: 30 minutes */
const DEFAULT_MAX_EXECUTION_MS = 30 * 60 * 1_000;

export type AgentInstanceOptions = {
  agentId: string;
  machineId: string;
  config: AgentConfig;
  projectPath: string;
  logger: Logger;
  auditLogDir?: string;
  /** Maximum execution time in milliseconds before the agent is forcefully timed out. */
  maxExecutionMs?: number;
};

type AgentInstanceState = {
  status: AgentStatus;
  sessionId: string | null;
  startedAt: Date | null;
  stoppedAt: Date | null;
  costUsd: number;
  prompt: string | null;
};

/**
 * Valid status transitions for an agent instance.
 * Each key is the current status, and the value is an array of statuses
 * the agent can transition to from that state.
 */
const VALID_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  registered: ['starting'],
  starting: ['running', 'error', 'stopped'],
  running: ['stopping', 'error', 'timeout'],
  stopping: ['stopped', 'error'],
  stopped: ['starting', 'restarting'],
  error: ['starting', 'restarting'],
  timeout: ['starting', 'restarting'],
  restarting: ['starting', 'error'],
};

const STUB_RUN_DURATION_MS = 5_000;
const STUB_TURNS = 4;
const STUB_TURN_INTERVAL_MS = 1_000;
const STUB_COST_PER_TURN = 0.003;

export class AgentInstance extends EventEmitter {
  readonly agentId: string;
  readonly machineId: string;
  readonly config: AgentConfig;
  readonly projectPath: string;
  readonly outputBuffer: OutputBuffer;

  private readonly log: Logger;
  private readonly auditLogger: AuditLogger;
  private readonly hooks: SdkRunnerHooks;
  private readonly maxExecutionMs: number;
  private state: AgentInstanceState;
  private simulationTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setInterval> | null = null;
  private executionTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  constructor(options: AgentInstanceOptions) {
    super();

    this.agentId = options.agentId;
    this.machineId = options.machineId;
    this.config = options.config;
    this.projectPath = options.projectPath;
    this.log = options.logger.child({ agentId: this.agentId, machineId: this.machineId });
    this.outputBuffer = new OutputBuffer();

    // Initialize audit logger and hook functions
    this.auditLogger = new AuditLogger({
      logDir: options.auditLogDir ?? DEFAULT_AUDIT_LOG_DIR,
      logger: this.log,
    });

    this.maxExecutionMs = options.maxExecutionMs ?? DEFAULT_MAX_EXECUTION_MS;

    this.hooks = {
      preToolUse: createPreToolUseHook({
        auditLogger: this.auditLogger,
        logger: this.log,
      }),
      postToolUse: createPostToolUseHook({
        auditLogger: this.auditLogger,
        logger: this.log,
      }),
      stop: createStopHook({
        auditLogger: this.auditLogger,
        logger: this.log,
      }),
    };

    this.state = {
      status: 'registered',
      sessionId: null,
      startedAt: null,
      stoppedAt: null,
      costUsd: 0,
      prompt: null,
    };
  }

  async start(prompt: string): Promise<void> {
    this.transitionTo('starting');
    this.log.info({ prompt: prompt.slice(0, 100) }, 'Agent starting');

    this.state.sessionId = randomUUID();
    this.state.startedAt = new Date();
    this.state.stoppedAt = null;
    this.state.costUsd = 0;
    this.state.prompt = prompt;
    this.abortController = new AbortController();

    try {
      this.transitionTo('running');
      this.log.info({ sessionId: this.state.sessionId }, 'Agent running');

      // Start execution timeout timer
      this.executionTimer = setTimeout(() => {
        if (this.state.status === 'running') {
          this.log.warn(
            { agentId: this.agentId, maxExecutionMs: this.maxExecutionMs },
            'Agent execution timed out',
          );
          if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
          }
          this.clearTimers();
          this.state.status = 'timeout';
          this.state.stoppedAt = new Date();
          const timeoutEvent: AgentEvent = {
            event: 'status',
            data: { status: 'timeout', reason: 'execution_timeout' },
          };
          this.emitEvent(timeoutEvent);
        }
      }, this.maxExecutionMs);

      // Try the real Claude Agent SDK first
      const result = await runWithSdk({
        prompt,
        agentId: this.agentId,
        sessionId: this.state.sessionId,
        config: this.config,
        projectPath: this.projectPath,
        logger: this.log,
        onEvent: (event) => this.emitEvent(event),
        abortSignal: this.abortController.signal,
        hooks: this.hooks,
      });

      if (result) {
        // SDK run completed successfully
        this.state.costUsd = result.costUsd;
        this.state.sessionId = result.sessionId;
        this.log.info(
          {
            sessionId: result.sessionId,
            costUsd: result.costUsd,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
          },
          'SDK run completed',
        );
        this.finishStop('completed');
      } else {
        // SDK not available — fall back to stub simulation
        this.log.info('SDK not available, falling back to stub simulation');
        this.simulateRun();
      }
    } catch (err) {
      this.handleError(err);
    }
  }

  async stop(graceful: boolean): Promise<void> {
    if (this.state.status === 'stopped' || this.state.status === 'stopping') {
      this.log.warn('Agent already stopped or stopping');
      return;
    }

    this.log.info({ graceful }, 'Stopping agent');

    // Signal the SDK runner (if active) to stop iteration.
    // The SDK runner will fire its own stop hook when it detects the abort.
    const wasAborted = this.abortController !== null;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.clearTimers();

    if (graceful) {
      this.transitionTo('stopping');
      this.finishStop('user');
    } else {
      // Force stop — kill immediately
      this.finishStop('user');
    }

    // If the abort controller was not set (stub simulation), fire stop hook
    // here. For SDK runs, the runner handles it via the abort signal.
    if (!wasAborted) {
      await this.fireStopHook('user', 0);
    }
  }

  getStatus(): AgentStatus {
    return this.state.status;
  }

  getSessionId(): string | null {
    return this.state.sessionId;
  }

  getStartedAt(): Date | null {
    return this.state.startedAt;
  }

  getStoppedAt(): Date | null {
    return this.state.stoppedAt;
  }

  getCostUsd(): number {
    return this.state.costUsd;
  }

  /**
   * Register a callback for agent events. This is a convenience wrapper
   * around the underlying EventEmitter so callers don't need to know
   * the event name.
   */
  onEvent(callback: (event: AgentEvent) => void): void {
    this.on('agent-event', callback);
  }

  /**
   * Remove a previously registered event callback.
   */
  offEvent(callback: (event: AgentEvent) => void): void {
    this.off('agent-event', callback);
  }

  toJSON(): Record<string, unknown> {
    return {
      agentId: this.agentId,
      machineId: this.machineId,
      status: this.state.status,
      sessionId: this.state.sessionId,
      startedAt: this.state.startedAt?.toISOString() ?? null,
      stoppedAt: this.state.stoppedAt?.toISOString() ?? null,
      costUsd: this.state.costUsd,
      projectPath: this.projectPath,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private transitionTo(next: AgentStatus): void {
    const current = this.state.status;
    const allowed = VALID_TRANSITIONS[current];

    if (!allowed.includes(next)) {
      throw new AgentError(
        'INVALID_TRANSITION',
        `Cannot transition from '${current}' to '${next}'`,
        { agentId: this.agentId, from: current, to: next },
      );
    }

    this.state.status = next;

    const statusEvent: AgentEvent = {
      event: 'status',
      data: { status: next },
    };

    this.emitEvent(statusEvent);
  }

  private emitEvent(event: AgentEvent): void {
    this.outputBuffer.push(event);
    this.emit('agent-event', event);
  }

  private handleError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);

    this.log.error({ err }, 'Agent encountered an error');
    this.clearTimers();

    // Only transition to error if we're in a state that allows it
    const allowed = VALID_TRANSITIONS[this.state.status];
    if (allowed.includes('error')) {
      this.state.status = 'error';
      this.state.stoppedAt = new Date();

      const statusEvent: AgentEvent = {
        event: 'status',
        data: { status: 'error', reason: message },
      };

      this.emitEvent(statusEvent);
    }
  }

  private finishStop(reason: string): void {
    this.state.status = 'stopped';
    this.state.stoppedAt = new Date();

    const statusEvent: AgentEvent = {
      event: 'status',
      data: { status: 'stopped', reason },
    };

    this.emitEvent(statusEvent);
    this.log.info(
      { sessionId: this.state.sessionId, costUsd: this.state.costUsd },
      'Agent stopped',
    );
  }

  /**
   * Fire the stop hook to record a session_end audit entry.
   * Called explicitly for stub simulation runs where the SDK runner
   * does not manage the hook lifecycle.
   */
  private async fireStopHook(reason: string, totalTurns: number): Promise<void> {
    if (!this.hooks.stop || !this.state.sessionId) {
      return;
    }

    try {
      await this.hooks.stop({
        sessionId: this.state.sessionId,
        agentId: this.agentId,
        reason,
        totalCostUsd: this.state.costUsd,
        totalTurns,
      });
    } catch (err) {
      this.log.warn({ err }, 'Stop hook failed');
    }
  }

  private clearTimers(): void {
    if (this.simulationTimer) {
      clearTimeout(this.simulationTimer);
      this.simulationTimer = null;
    }
    if (this.turnTimer) {
      clearInterval(this.turnTimer);
      this.turnTimer = null;
    }
    if (this.executionTimer) {
      clearTimeout(this.executionTimer);
      this.executionTimer = null;
    }
  }

  /**
   * Stub: simulate an agent running for a few turns, emitting output
   * and cost events, then completing. This will be replaced with real
   * Claude Agent SDK integration.
   */
  private simulateRun(): void {
    let turn = 0;

    this.turnTimer = setInterval(() => {
      if (this.state.status !== 'running') {
        this.clearTimers();
        return;
      }

      turn++;

      // Emit a simulated output event
      const outputEvent: AgentEvent = {
        event: 'output',
        data: {
          type: 'text',
          content: `[stub] Turn ${turn}/${STUB_TURNS}: processing "${this.state.prompt?.slice(0, 50) ?? ''}"...`,
        },
      };

      this.emitEvent(outputEvent);

      // Emit a simulated cost event
      this.state.costUsd += STUB_COST_PER_TURN;

      const costEvent: AgentEvent = {
        event: 'cost',
        data: {
          turnCost: STUB_COST_PER_TURN,
          totalCost: this.state.costUsd,
        },
      };

      this.emitEvent(costEvent);

      this.log.debug({ turn, costUsd: this.state.costUsd }, 'Agent turn completed');
    }, STUB_TURN_INTERVAL_MS);

    // After the simulated duration, stop the agent
    this.simulationTimer = setTimeout(() => {
      this.clearTimers();

      if (this.state.status === 'running') {
        // Emit a final output summary
        const finalEvent: AgentEvent = {
          event: 'output',
          data: {
            type: 'text',
            content: `[stub] Agent completed after ${STUB_TURNS} turns. Total cost: $${this.state.costUsd.toFixed(4)}`,
          },
        };

        this.emitEvent(finalEvent);
        this.finishStop('completed');

        // Fire the stop hook for audit trail consistency in stub mode.
        // In SDK mode the runner handles this directly.
        void this.fireStopHook('completed', STUB_TURNS);
      }
    }, STUB_RUN_DURATION_MS);
  }
}
