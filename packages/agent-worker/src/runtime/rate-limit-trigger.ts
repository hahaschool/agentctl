import type { AutoHandoffPolicy, ManagedRuntime, RateLimitHandoffEvent } from '@agentctl/shared';
import type { Logger } from 'pino';

export type RateLimitTriggerEmit = (event: RateLimitHandoffEvent) => void;

export type RateLimitTriggerOptions = {
  /** Current source runtime that encountered rate limiting. */
  sourceRuntime: ManagedRuntime;
  /** Policy configuration driving failover behaviour. */
  policy: AutoHandoffPolicy;
  /** Logger with agent context already bound. */
  logger: Logger;
  /** Callback invoked with the SSE event when a handoff should be triggered. */
  onHandoff: (targetRuntime: ManagedRuntime, event: RateLimitHandoffEvent) => void;
};

export type RateLimitErrorContext = {
  /** HTTP status code, if available (should be 429 or similar). */
  statusCode?: number;
  /** Raw error message from the SDK or upstream provider. */
  message?: string;
};

/**
 * Detects rate-limit errors during an agent run and, when the configured
 * retry budget is exhausted, emits a `rate_limit_handoff` SSE event and
 * calls `onHandoff` so the caller can initiate the actual handoff.
 *
 * The trigger tracks how many times a rate limit has been hit and picks
 * the next runtime from `policy.rateLimitFailover.targetRuntimeOrder`.
 * Once all runtimes in the order have been exhausted, it stops triggering.
 */
export class RateLimitTrigger {
  private hitCount: number = 0;
  private runtimeCursor: number = 0;

  constructor(private readonly options: RateLimitTriggerOptions) {}

  /**
   * Returns true when the error looks like a rate limit (HTTP 429 or the
   * string "rate limit" appears in the message, case-insensitive).
   */
  static isRateLimitError(context: RateLimitErrorContext): boolean {
    if (context.statusCode === 429) {
      return true;
    }

    const msg = context.message?.toLowerCase() ?? '';
    return msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('429');
  }

  /**
   * Observe an error. If it is a rate-limit error and the policy allows
   * failover, increments the hit count and — once the retry budget is
   * consumed — fires the handoff.
   *
   * @returns `true` if a handoff was triggered, `false` otherwise.
   */
  observe(context: RateLimitErrorContext): boolean {
    if (!RateLimitTrigger.isRateLimitError(context)) {
      return false;
    }

    const config = this.options.policy.rateLimitFailover;

    if (!config?.enabled) {
      this.options.logger.debug(
        { hitCount: this.hitCount },
        'Rate limit detected but failover policy is disabled',
      );
      return false;
    }

    this.hitCount += 1;

    this.options.logger.warn(
      { hitCount: this.hitCount, retryBudget: config.retryBudget, statusCode: context.statusCode },
      'Rate limit hit detected',
    );

    // Only trigger handoff once the retry budget is consumed.
    if (this.hitCount <= config.retryBudget) {
      return false;
    }

    // Walk through targetRuntimeOrder to find the next available runtime.
    const order = config.targetRuntimeOrder;

    while (this.runtimeCursor < order.length) {
      const candidate = order[this.runtimeCursor];
      this.runtimeCursor += 1;

      if (candidate !== undefined && candidate !== this.options.sourceRuntime) {
        this.fireHandoff(candidate);
        return true;
      }
    }

    this.options.logger.warn(
      { sourceRuntime: this.options.sourceRuntime, order },
      'Rate limit retry budget exhausted but no alternative runtime available',
    );

    return false;
  }

  /** Number of rate limit hits recorded so far. */
  getHitCount(): number {
    return this.hitCount;
  }

  private fireHandoff(targetRuntime: ManagedRuntime): void {
    const detectedAt = new Date().toISOString();

    const event: RateLimitHandoffEvent = {
      event: 'rate_limit_handoff',
      data: {
        sourceRuntime: this.options.sourceRuntime,
        targetRuntime,
        hitCount: this.hitCount,
        detectedAt,
      },
    };

    this.options.logger.info(
      {
        sourceRuntime: this.options.sourceRuntime,
        targetRuntime,
        hitCount: this.hitCount,
      },
      'Rate limit handoff triggered',
    );

    this.options.onHandoff(targetRuntime, event);
  }
}
