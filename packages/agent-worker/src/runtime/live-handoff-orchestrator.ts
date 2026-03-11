import type {
  AgentEvent,
  AutoHandoffPolicy,
  CostThresholdHandoffEvent,
  ManagedRuntime,
  RateLimitHandoffEvent,
} from '@agentctl/shared';
import type { Logger } from 'pino';

import { CostThresholdTrigger } from './cost-threshold-trigger.js';
import type { HandoffController, HandoffExecutionResult } from './handoff-controller.js';
import { type RateLimitErrorContext, RateLimitTrigger } from './rate-limit-trigger.js';

export type LiveHandoffOrchestratorOptions = {
  /** The runtime currently executing the agent session. */
  sourceRuntime: ManagedRuntime;
  /** Agent identifier for logging and snapshot export. */
  agentId: string;
  /** Project directory the agent is running in. */
  projectPath: string;
  /** Auto-handoff policy driving trigger behaviour. */
  policy: AutoHandoffPolicy;
  /** The handoff controller used to export snapshots and start new sessions. */
  handoffController: HandoffController;
  /** Logger with agent context already bound. */
  logger: Logger;
  /** Callback to emit SSE events to connected clients. */
  emitEvent: (event: AgentEvent) => void;
  /** Native session ID of the current runtime session (for snapshot export). */
  nativeSessionId?: string;
  /** Source session ID (managed) for snapshot export. */
  sourceSessionId?: string;
};

export type HandoffOutcome =
  | { triggered: false }
  | { triggered: true; trigger: 'rate-limit' | 'cost-threshold'; result: HandoffExecutionResult };

/**
 * Orchestrates live handoff triggers during an active agent session.
 *
 * Wires `RateLimitTrigger` and `CostThresholdTrigger` to the
 * `HandoffController` so that rate-limit errors and cost-threshold
 * breaches automatically initiate a handoff to an alternative runtime.
 *
 * Usage:
 *   1. Create an instance with the current session's context.
 *   2. Call `observeError()` whenever the runtime encounters an error.
 *   3. Call `observeCostUpdate()` on every cost event from the SDK.
 *   4. When the orchestrator triggers a handoff, it exports a snapshot
 *      and starts a new session on the target runtime automatically.
 */
export class LiveHandoffOrchestrator {
  private readonly rateLimitTrigger: RateLimitTrigger;
  private readonly costThresholdTrigger: CostThresholdTrigger;
  private readonly options: LiveHandoffOrchestratorOptions;
  private readonly log: Logger;
  private handoffInProgress: boolean = false;
  private handoffCompleted: boolean = false;

  constructor(options: LiveHandoffOrchestratorOptions) {
    this.options = options;
    this.log = options.logger.child({ component: 'live-handoff-orchestrator' });

    this.rateLimitTrigger = new RateLimitTrigger({
      sourceRuntime: options.sourceRuntime,
      policy: options.policy,
      logger: this.log,
      onHandoff: (targetRuntime, event) => {
        void this.executeHandoff('rate-limit', targetRuntime, event);
      },
    });

    this.costThresholdTrigger = new CostThresholdTrigger({
      sourceRuntime: options.sourceRuntime,
      policy: options.policy,
      logger: this.log,
      onWarning: (event) => {
        this.options.emitEvent(event);
      },
      onHandoff: (targetRuntime, event) => {
        void this.executeHandoff('cost-threshold', targetRuntime, event);
      },
    });
  }

  /**
   * Observe an error from the runtime. If it looks like a rate-limit error
   * and the retry budget is exhausted, a handoff is triggered automatically.
   *
   * @returns `true` if a handoff was triggered, `false` otherwise.
   */
  observeError(context: RateLimitErrorContext): boolean {
    if (this.handoffCompleted || this.handoffInProgress) {
      return false;
    }

    return this.rateLimitTrigger.observe(context);
  }

  /**
   * Observe a cost update from the runtime. If the accumulated cost
   * exceeds the configured threshold, a handoff is triggered automatically.
   *
   * @returns `'handoff'`, `'warning'`, or `null`.
   */
  observeCostUpdate(currentCostUsd: number): 'handoff' | 'warning' | null {
    if (this.handoffCompleted || this.handoffInProgress) {
      return null;
    }

    return this.costThresholdTrigger.update(currentCostUsd);
  }

  /** Whether a handoff has been triggered and completed (or is in progress). */
  isHandoffTriggered(): boolean {
    return this.handoffCompleted || this.handoffInProgress;
  }

  private async executeHandoff(
    trigger: 'rate-limit' | 'cost-threshold',
    targetRuntime: ManagedRuntime,
    sseEvent: RateLimitHandoffEvent | CostThresholdHandoffEvent,
  ): Promise<void> {
    if (this.handoffInProgress || this.handoffCompleted) {
      this.log.debug(
        { trigger, targetRuntime },
        'Handoff already in progress or completed, skipping',
      );
      return;
    }

    this.handoffInProgress = true;

    // Emit the SSE event immediately so clients see the trigger.
    this.options.emitEvent(sseEvent);

    try {
      const snapshot = await this.options.handoffController.exportSnapshot({
        sourceRuntime: this.options.sourceRuntime,
        sourceSessionId: this.options.sourceSessionId ?? '',
        nativeSessionId: this.options.nativeSessionId ?? '',
        projectPath: this.options.projectPath,
        reason: trigger === 'rate-limit' ? 'rate-limit-failover' : 'cost-optimization',
        activeConfigRevision: 0,
      });

      const result = await this.options.handoffController.handoff({
        agentId: this.options.agentId,
        targetRuntime,
        projectPath: this.options.projectPath,
        snapshot,
        prompt: snapshot.nextSuggestedPrompt,
      });

      this.handoffCompleted = true;

      this.log.info(
        {
          trigger,
          sourceRuntime: this.options.sourceRuntime,
          targetRuntime,
          strategy: result.strategy,
          newSessionId: result.session.sessionId,
        },
        'Live handoff completed successfully',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error({ err, trigger, targetRuntime }, 'Live handoff failed');

      this.options.emitEvent({
        event: 'output',
        data: {
          type: 'text',
          content: `[handoff_error] Live ${trigger} handoff to ${targetRuntime} failed: ${message}`,
        },
      });
    } finally {
      this.handoffInProgress = false;
    }
  }
}
