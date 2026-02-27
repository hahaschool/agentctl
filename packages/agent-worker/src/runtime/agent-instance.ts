import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { Logger } from 'pino';

import type { AgentConfig, AgentEvent, AgentStatus } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';

import { OutputBuffer } from './output-buffer.js';

export type AgentInstanceOptions = {
  agentId: string;
  machineId: string;
  config: AgentConfig;
  projectPath: string;
  logger: Logger;
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
  private state: AgentInstanceState;
  private simulationTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AgentInstanceOptions) {
    super();

    this.agentId = options.agentId;
    this.machineId = options.machineId;
    this.config = options.config;
    this.projectPath = options.projectPath;
    this.log = options.logger.child({ agentId: this.agentId, machineId: this.machineId });
    this.outputBuffer = new OutputBuffer();

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

    try {
      // Transition to running — in the real implementation this is where
      // the Claude Agent SDK subprocess would be spawned.
      this.transitionTo('running');
      this.log.info({ sessionId: this.state.sessionId }, 'Agent running');

      // --- stub: simulate agent turns ---
      this.simulateRun();
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

    this.clearTimers();

    if (graceful) {
      this.transitionTo('stopping');

      // In a real implementation we would send SIGTERM and wait for
      // the subprocess to finish. Here we just transition immediately.
      this.finishStop('user');
    } else {
      // Force stop — kill immediately
      this.finishStop('user');
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
    this.log.info({ sessionId: this.state.sessionId, costUsd: this.state.costUsd }, 'Agent stopped');
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
      }
    }, STUB_RUN_DURATION_MS);
  }
}
