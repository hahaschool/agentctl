import type {
  AutoHandoffPolicy,
  CostThresholdHandoffEvent,
  CostThresholdWarningEvent,
  ManagedRuntime,
} from '@agentctl/shared';
import type { Logger } from 'pino';

/** Fraction of the threshold at which a warning is emitted. */
const WARNING_FRACTION = 0.8;

export type CostThresholdTriggerOptions = {
  /** Current source runtime accumulating costs. */
  sourceRuntime: ManagedRuntime;
  /** Policy configuration driving cost-based handoff. */
  policy: AutoHandoffPolicy;
  /** Logger with agent context already bound. */
  logger: Logger;
  /** Callback invoked with the SSE warning event when cost reaches 80% of threshold. */
  onWarning: (event: CostThresholdWarningEvent) => void;
  /** Callback invoked with the SSE event when cost exceeds the threshold. */
  onHandoff: (targetRuntime: ManagedRuntime, event: CostThresholdHandoffEvent) => void;
};

/**
 * Monitors accumulated session cost and fires callbacks when:
 *   - 80% of `costThreshold.thresholdUsd` is reached → warning
 *   - 100% of `costThreshold.thresholdUsd` is exceeded → handoff
 *
 * Both callbacks fire at most once per trigger instance. Call `update()`
 * on every cost update received from the SDK.
 */
export class CostThresholdTrigger {
  private warningFired: boolean = false;
  private handoffFired: boolean = false;

  constructor(private readonly options: CostThresholdTriggerOptions) {}

  /**
   * Update the accumulated cost. Emits a warning if the cost has crossed
   * the 80% mark, and triggers a handoff if the threshold is fully exceeded.
   *
   * @returns `'handoff'` when a handoff was triggered, `'warning'` when only
   *   the warning was emitted, or `null` when nothing changed.
   */
  update(currentCostUsd: number): 'handoff' | 'warning' | null {
    const config = this.options.policy.costThreshold;

    if (!config?.enabled) {
      return null;
    }

    const { thresholdUsd, targetRuntime } = config;

    // Threshold fully exceeded — trigger handoff (fires at most once).
    if (!this.handoffFired && currentCostUsd > thresholdUsd) {
      this.handoffFired = true;
      this.warningFired = true; // suppress any subsequent warning

      const exceededAt = new Date().toISOString();

      const event: CostThresholdHandoffEvent = {
        event: 'cost_threshold_handoff',
        data: {
          sourceRuntime: this.options.sourceRuntime,
          targetRuntime,
          currentCostUsd,
          thresholdUsd,
          exceededAt,
        },
      };

      this.options.logger.warn(
        {
          sourceRuntime: this.options.sourceRuntime,
          targetRuntime,
          currentCostUsd,
          thresholdUsd,
        },
        'Cost threshold exceeded — triggering handoff',
      );

      this.options.onHandoff(targetRuntime, event);
      return 'handoff';
    }

    // 80% warning — fires at most once.
    if (!this.warningFired && currentCostUsd >= thresholdUsd * WARNING_FRACTION) {
      this.warningFired = true;

      const fraction = currentCostUsd / thresholdUsd;

      const event: CostThresholdWarningEvent = {
        event: 'cost_threshold_warning',
        data: {
          currentCostUsd,
          thresholdUsd,
          fraction,
        },
      };

      this.options.logger.warn(
        { currentCostUsd, thresholdUsd, fraction: fraction.toFixed(2) },
        'Cost threshold warning: 80% of limit reached',
      );

      this.options.onWarning(event);
      return 'warning';
    }

    return null;
  }

  /** Whether the handoff has already been fired. */
  isHandoffFired(): boolean {
    return this.handoffFired;
  }

  /** Whether the warning has already been fired. */
  isWarningFired(): boolean {
    return this.warningFired;
  }
}
