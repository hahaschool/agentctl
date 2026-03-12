import type {
  AggregateStats,
  ApprovalTiming,
  ApprovalTimingStats,
  RoutingDecision,
  RoutingOutcome,
  RoutingScoreBreakdown,
} from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { approvalTimings, routingDecisions, routingOutcomes } from '../db/index.js';

// ── Input types ─────────────────────────────────────────────

type RecordDecisionInput = {
  readonly taskDefId: string;
  readonly taskRunId: string;
  readonly profileId: string;
  readonly nodeId: string;
  readonly score: number;
  readonly breakdown: RoutingScoreBreakdown;
  readonly mode: 'auto' | 'suggested';
};

type RecordOutcomeInput = {
  readonly routingDecisionId?: string | null;
  readonly taskRunId: string;
  readonly profileId: string;
  readonly nodeId: string;
  readonly capabilities: readonly string[];
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly durationMs?: number | null;
  readonly costUsd?: number | null;
  readonly tokensUsed?: number | null;
  readonly errorCode?: string | null;
};

type RecordApprovalTimingInput = {
  readonly gateId: string;
  readonly decidedBy: string;
  readonly capabilities: readonly string[];
  readonly decisionTimeMs: number;
  readonly timedOut: boolean;
};

const DEFAULT_STATS_WINDOW = 50;
const DEFAULT_TIMING_WINDOW = 20;
const MIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Store ───────────────────────────────────────────────────

export class RoutingStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  // ── Routing Decisions ─────────────────────────────────────

  async recordDecision(input: RecordDecisionInput): Promise<RoutingDecision> {
    const rows = await this.db
      .insert(routingDecisions)
      .values({
        taskDefId: input.taskDefId,
        taskRunId: input.taskRunId,
        profileId: input.profileId,
        nodeId: input.nodeId,
        score: input.score,
        breakdown: input.breakdown,
        mode: input.mode,
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('DECISION_INSERT_FAILED', 'Failed to insert routing decision', {
        taskRunId: input.taskRunId,
      });
    }

    this.logger.info(
      { decisionId: rows[0].id, taskRunId: input.taskRunId, profileId: input.profileId },
      'Routing decision recorded',
    );

    return this.toDecision(rows[0]);
  }

  async getDecisionByTaskRun(taskRunId: string): Promise<RoutingDecision | undefined> {
    const rows = await this.db
      .select()
      .from(routingDecisions)
      .where(eq(routingDecisions.taskRunId, taskRunId));

    return rows.length === 0 ? undefined : this.toDecision(rows[0]);
  }

  // ── Routing Outcomes ──────────────────────────────────────

  async recordOutcome(input: RecordOutcomeInput): Promise<RoutingOutcome> {
    const rows = await this.db
      .insert(routingOutcomes)
      .values({
        routingDecisionId: input.routingDecisionId ?? null,
        taskRunId: input.taskRunId,
        profileId: input.profileId,
        nodeId: input.nodeId,
        capabilities: [...input.capabilities],
        status: input.status,
        durationMs: input.durationMs ?? null,
        costUsd: input.costUsd ?? null,
        tokensUsed: input.tokensUsed ?? null,
        errorCode: input.errorCode ?? null,
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('OUTCOME_INSERT_FAILED', 'Failed to insert routing outcome', {
        taskRunId: input.taskRunId,
      });
    }

    this.logger.info(
      { outcomeId: rows[0].id, taskRunId: input.taskRunId, status: input.status },
      'Routing outcome recorded',
    );

    return this.toOutcome(rows[0]);
  }

  async getOutcomesByProfile(profileId: string): Promise<RoutingOutcome[]> {
    const rows = await this.db
      .select()
      .from(routingOutcomes)
      .where(eq(routingOutcomes.profileId, profileId));

    return rows.map((r) => this.toOutcome(r));
  }

  async getOutcomesByCapabilities(capabilities: readonly string[]): Promise<RoutingOutcome[]> {
    if (capabilities.length === 0) {
      return [];
    }

    // Match outcomes where capabilities array contains all requested capabilities
    const rows = await this.db
      .select()
      .from(routingOutcomes)
      .where(sql`${routingOutcomes.capabilities} @> ${[...capabilities]}`);

    return rows.map((r) => this.toOutcome(r));
  }

  async getAggregateStats(
    profileId: string,
    capabilities: readonly string[],
    window: number = DEFAULT_STATS_WINDOW,
  ): Promise<AggregateStats> {
    // Build WHERE conditions
    const conditions = [eq(routingOutcomes.profileId, profileId)];

    if (capabilities.length > 0) {
      conditions.push(sql`${routingOutcomes.capabilities} @> ${[...capabilities]}`);
    }

    // Fetch the last N outcomes for this profile + capability combination
    const rows = await this.db
      .select()
      .from(routingOutcomes)
      .where(and(...conditions))
      .orderBy(sql`${routingOutcomes.createdAt} DESC`)
      .limit(window);

    if (rows.length === 0) {
      return { successRate: 0, avgDurationMs: null, avgCostUsd: null, count: 0 };
    }

    const completed = rows.filter((r) => r.status === 'completed');
    const failed = rows.filter((r) => r.status === 'failed');
    const total = completed.length + failed.length;

    const successRate = total > 0 ? completed.length / total : 0;

    const durationsMs = completed.map((r) => r.durationMs).filter((d): d is number => d !== null);
    const avgDurationMs =
      durationsMs.length > 0
        ? durationsMs.reduce((sum, d) => sum + d, 0) / durationsMs.length
        : null;

    const costs = completed.map((r) => r.costUsd).filter((c): c is number => c !== null);
    const avgCostUsd =
      costs.length > 0 ? costs.reduce((sum, c) => sum + c, 0) / costs.length : null;

    return {
      successRate,
      avgDurationMs,
      avgCostUsd,
      count: rows.length,
    };
  }

  // ── Approval Timings ──────────────────────────────────────

  async recordApprovalTiming(input: RecordApprovalTimingInput): Promise<ApprovalTiming> {
    const rows = await this.db
      .insert(approvalTimings)
      .values({
        gateId: input.gateId,
        decidedBy: input.decidedBy,
        capabilities: [...input.capabilities],
        decisionTimeMs: input.decisionTimeMs,
        timedOut: input.timedOut,
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError(
        'TIMING_INSERT_FAILED',
        'Failed to insert approval timing record',
        { gateId: input.gateId },
      );
    }

    this.logger.info(
      { timingId: rows[0].id, gateId: input.gateId, decidedBy: input.decidedBy },
      'Approval timing recorded',
    );

    return this.toApprovalTiming(rows[0]);
  }

  async getApprovalTimingStats(
    decidedBy: string,
    capabilities?: readonly string[],
    window: number = DEFAULT_TIMING_WINDOW,
  ): Promise<ApprovalTimingStats> {
    const conditions = [eq(approvalTimings.decidedBy, decidedBy)];

    if (capabilities && capabilities.length > 0) {
      conditions.push(sql`${approvalTimings.capabilities} @> ${[...capabilities]}`);
    }

    const rows = await this.db
      .select()
      .from(approvalTimings)
      .where(and(...conditions))
      .orderBy(sql`${approvalTimings.createdAt} DESC`)
      .limit(window);

    if (rows.length === 0) {
      return { p50Ms: 0, p95Ms: 0, count: 0 };
    }

    const times = rows.map((r) => r.decisionTimeMs).sort((a, b) => a - b);
    const p50Index = Math.floor(times.length * 0.5);
    const p95Index = Math.min(Math.floor(times.length * 0.95), times.length - 1);

    return {
      p50Ms: times[p50Index],
      p95Ms: times[p95Index],
      count: times.length,
    };
  }

  async suggestTimeout(decidedBy: string, capabilities?: readonly string[]): Promise<number> {
    const stats = await this.getApprovalTimingStats(decidedBy, capabilities);

    if (stats.count === 0) {
      // No history -- return default 1 hour
      return 60 * 60 * 1000;
    }

    // Use P95 as the suggested timeout, clamped to min/max bounds
    return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, stats.p95Ms * 1.2));
  }

  // ── Mappers ───────────────────────────────────────────────

  private toDecision(row: typeof routingDecisions.$inferSelect): RoutingDecision {
    return {
      id: row.id,
      taskDefinitionId: row.taskDefId,
      taskRunId: row.taskRunId,
      selectedProfileId: row.profileId,
      selectedNodeId: row.nodeId,
      score: row.score,
      breakdown: row.breakdown as RoutingScoreBreakdown,
      mode: row.mode as RoutingDecision['mode'],
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }

  private toOutcome(row: typeof routingOutcomes.$inferSelect): RoutingOutcome {
    return {
      id: row.id,
      routingDecisionId: row.routingDecisionId,
      taskRunId: row.taskRunId,
      profileId: row.profileId,
      nodeId: row.nodeId,
      capabilities: (row.capabilities ?? []) as string[],
      status: row.status as RoutingOutcome['status'],
      durationMs: row.durationMs,
      costUsd: row.costUsd,
      tokensUsed: row.tokensUsed,
      errorCode: row.errorCode,
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }

  private toApprovalTiming(row: typeof approvalTimings.$inferSelect): ApprovalTiming {
    return {
      id: row.id,
      gateId: row.gateId,
      decidedBy: row.decidedBy,
      capabilities: (row.capabilities ?? []) as string[],
      decisionTimeMs: row.decisionTimeMs,
      timedOut: row.timedOut,
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }
}
