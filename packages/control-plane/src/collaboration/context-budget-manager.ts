import type {
  ContextBudget,
  ContextBudgetPolicy,
  ContextBudgetSummary,
  ContextRef,
} from '@agentctl/shared';
import { ControlPlaneError, DEFAULT_CONTEXT_BUDGET_POLICY } from '@agentctl/shared';
import type { Logger } from 'pino';

// ── Constants ────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4;

// ── Token estimation ─────────────────────────────────────────

/**
 * Estimate token count for a piece of text using a simple character-based
 * heuristic. 4 characters ~ 1 token. Same heuristic as memory context-budget.
 */
export function estimateContextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate token count for a ContextRef by serializing its payload-carrying
 * fields (snapshotPayload + metadata) to JSON.
 */
export function estimateRefTokens(ref: ContextRef): number {
  const payloadText = ref.snapshotPayload ? JSON.stringify(ref.snapshotPayload) : '';
  const metadataText = Object.keys(ref.metadata).length > 0 ? JSON.stringify(ref.metadata) : '';
  return estimateContextTokens(payloadText + metadataText);
}

// ── Internal immutable state ─────────────────────────────────

type SpaceUsage = Readonly<Record<string, number>>;

type BudgetState = {
  readonly spaceUsage: SpaceUsage;
  readonly totalUsed: number;
};

function createEmptyState(): BudgetState {
  return { spaceUsage: {}, totalUsed: 0 };
}

function getSpaceUsed(state: BudgetState, spaceId: string): number {
  return state.spaceUsage[spaceId] ?? 0;
}

// ── Allocation result ────────────────────────────────────────

export type AllocationResult = {
  readonly allowed: number;
  readonly capped: boolean;
  readonly reason: string | null;
};

// ── Budget-constrained refs result ───────────────────────────

export type BudgetConstrainedResult = {
  readonly refs: readonly ContextRef[];
  readonly excluded: readonly ContextRef[];
  readonly summary: ContextBudgetSummary;
};

// ── ContextBudgetManager ─────────────────────────────────────

export class ContextBudgetManager {
  private state: BudgetState;
  private readonly policy: ContextBudgetPolicy;
  private readonly logger: Logger;

  constructor(options: { policy?: ContextBudgetPolicy; logger: Logger }) {
    this.policy = options.policy ?? DEFAULT_CONTEXT_BUDGET_POLICY;
    this.logger = options.logger;
    this.state = createEmptyState();
  }

  /**
   * Check how many tokens can be allocated for a given space without exceeding
   * the per-space or total budget. Returns the allowed token count (which may
   * be less than requested) and whether capping occurred.
   *
   * This is a read-only operation — it does NOT consume budget.
   */
  allocate(spaceId: string, estimatedTokens: number): AllocationResult {
    if (estimatedTokens < 0) {
      throw new ControlPlaneError(
        'INVALID_TOKEN_ESTIMATE',
        'estimatedTokens must be non-negative',
        { spaceId, estimatedTokens },
      );
    }

    const spaceUsed = getSpaceUsed(this.state, spaceId);
    const spaceRemaining = Math.max(0, this.policy.perSpaceLimit - spaceUsed);
    const totalRemaining = Math.max(0, this.policy.totalLimit - this.state.totalUsed);
    const effectiveRemaining = Math.min(spaceRemaining, totalRemaining);

    if (estimatedTokens <= effectiveRemaining) {
      return { allowed: estimatedTokens, capped: false, reason: null };
    }

    // Apply overflow strategy
    if (this.policy.overflowStrategy === 'reject') {
      this.logger.debug(
        { spaceId, estimatedTokens, effectiveRemaining },
        'Budget allocation rejected',
      );
      return {
        allowed: 0,
        capped: true,
        reason:
          spaceRemaining < totalRemaining
            ? `Per-space limit exceeded (${spaceUsed}/${this.policy.perSpaceLimit})`
            : `Total limit exceeded (${this.state.totalUsed}/${this.policy.totalLimit})`,
      };
    }

    // truncate and prioritize both cap to the remaining budget
    const cappedReason =
      spaceRemaining < totalRemaining
        ? `Truncated to per-space remaining (${spaceRemaining} of ${this.policy.perSpaceLimit})`
        : `Truncated to total remaining (${totalRemaining} of ${this.policy.totalLimit})`;

    this.logger.debug(
      { spaceId, estimatedTokens, allowed: effectiveRemaining, reason: cappedReason },
      'Budget allocation capped',
    );

    return {
      allowed: effectiveRemaining,
      capped: true,
      reason: cappedReason,
    };
  }

  /**
   * Record actual token consumption for a space. Returns the updated budget
   * snapshot for the space.
   *
   * Uses immutable state updates internally.
   */
  consume(spaceId: string, actualTokens: number): ContextBudget {
    if (actualTokens < 0) {
      throw new ControlPlaneError('INVALID_TOKEN_COUNT', 'actualTokens must be non-negative', {
        spaceId,
        actualTokens,
      });
    }

    const currentSpaceUsed = getSpaceUsed(this.state, spaceId);
    const newSpaceUsed = currentSpaceUsed + actualTokens;

    this.state = {
      spaceUsage: {
        ...this.state.spaceUsage,
        [spaceId]: newSpaceUsed,
      },
      totalUsed: this.state.totalUsed + actualTokens,
    };

    this.logger.debug(
      {
        spaceId,
        consumed: actualTokens,
        spaceUsed: newSpaceUsed,
        totalUsed: this.state.totalUsed,
      },
      'Budget consumed',
    );

    return {
      maxTokens: this.policy.perSpaceLimit,
      usedTokens: newSpaceUsed,
      remaining: Math.max(0, this.policy.perSpaceLimit - newSpaceUsed),
    };
  }

  /**
   * Return the current budget summary: per-space and total usage.
   */
  getSummary(): ContextBudgetSummary {
    const perSpace: Record<string, ContextBudget> = {};

    for (const [spaceId, used] of Object.entries(this.state.spaceUsage)) {
      perSpace[spaceId] = {
        maxTokens: this.policy.perSpaceLimit,
        usedTokens: used,
        remaining: Math.max(0, this.policy.perSpaceLimit - used),
      };
    }

    return {
      perSpace,
      total: {
        maxTokens: this.policy.totalLimit,
        usedTokens: this.state.totalUsed,
        remaining: Math.max(0, this.policy.totalLimit - this.state.totalUsed),
      },
    };
  }

  /**
   * Apply budget constraints to a list of context refs. Refs are processed in
   * order; once a space or total budget is exhausted, remaining refs are moved
   * to the `excluded` list.
   *
   * When the overflow strategy is 'prioritize', refs are sorted by estimated
   * token count (smallest first) so more refs fit within the budget.
   */
  applyBudget(refs: readonly ContextRef[]): BudgetConstrainedResult {
    const orderedRefs =
      this.policy.overflowStrategy === 'prioritize'
        ? [...refs].sort((a, b) => estimateRefTokens(a) - estimateRefTokens(b))
        : refs;

    const included: ContextRef[] = [];
    const excluded: ContextRef[] = [];

    for (const ref of orderedRefs) {
      const tokens = estimateRefTokens(ref);
      const spaceId = ref.sourceSpaceId;
      const allocation = this.allocate(spaceId, tokens);

      if (allocation.allowed >= tokens) {
        this.consume(spaceId, tokens);
        included.push(ref);
      } else if (this.policy.overflowStrategy === 'truncate' && allocation.allowed > 0) {
        // For truncate, we still include the ref but record only the allowed tokens.
        // The caller is responsible for actually truncating the content.
        this.consume(spaceId, allocation.allowed);
        included.push(ref);
      } else {
        excluded.push(ref);
      }
    }

    const summary = this.getSummary();

    this.logger.info(
      {
        included: included.length,
        excluded: excluded.length,
        totalUsed: summary.total.usedTokens,
        totalRemaining: summary.total.remaining,
      },
      'Budget constraints applied to context refs',
    );

    return { refs: included, excluded, summary };
  }

  /**
   * Reset the budget state. Useful when starting a new context loading session.
   */
  reset(): void {
    this.state = createEmptyState();
    this.logger.debug('Budget state reset');
  }

  /**
   * Return the policy governing this manager.
   */
  getPolicy(): ContextBudgetPolicy {
    return this.policy;
  }
}
