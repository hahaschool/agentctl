import type { RunHandoffDecision } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { desc, eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { runHandoffDecisions } from '../db/index.js';

export type CreateRunHandoffDecisionInput = Omit<
  RunHandoffDecision,
  'id' | 'createdAt' | 'updatedAt'
> & {
  createdAt?: Date | null;
  updatedAt?: Date | null;
};

export class RunHandoffDecisionStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async create(input: CreateRunHandoffDecisionInput): Promise<RunHandoffDecision> {
    const rows = await this.db
      .insert(runHandoffDecisions)
      .values({
        sourceRunId: input.sourceRunId,
        sourceManagedSessionId: input.sourceManagedSessionId,
        targetRunId: input.targetRunId,
        handoffId: input.handoffId,
        trigger: input.trigger,
        stage: input.stage,
        mode: input.mode,
        status: input.status,
        dedupeKey: input.dedupeKey,
        policySnapshot: input.policySnapshot,
        signalPayload: input.signalPayload,
        reason: input.reason,
        skippedReason: input.skippedReason,
        createdAt: input.createdAt ?? new Date(),
        updatedAt: input.updatedAt ?? new Date(),
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new ControlPlaneError(
        'RUN_HANDOFF_DECISION_CREATE_FAILED',
        'Failed to create run handoff decision',
        { sourceRunId: input.sourceRunId, trigger: input.trigger },
      );
    }

    this.logger.info(
      { runHandoffDecisionId: row.id, sourceRunId: row.sourceRunId, trigger: row.trigger },
      'Run handoff decision created',
    );

    return mapRunHandoffDecisionRow(row);
  }

  async listForRun(runId: string, limit = 50): Promise<RunHandoffDecision[]> {
    const rows = await this.db
      .select()
      .from(runHandoffDecisions)
      .where(eq(runHandoffDecisions.sourceRunId, runId))
      .orderBy(desc(runHandoffDecisions.createdAt))
      .limit(limit);

    return rows.map(mapRunHandoffDecisionRow);
  }
}

function mapRunHandoffDecisionRow(
  row: typeof runHandoffDecisions.$inferSelect,
): RunHandoffDecision {
  return {
    id: row.id,
    sourceRunId: row.sourceRunId,
    sourceManagedSessionId: row.sourceManagedSessionId ?? null,
    targetRunId: row.targetRunId ?? null,
    handoffId: row.handoffId ?? null,
    trigger: row.trigger as RunHandoffDecision['trigger'],
    stage: row.stage as RunHandoffDecision['stage'],
    mode: row.mode as RunHandoffDecision['mode'],
    status: row.status as RunHandoffDecision['status'],
    dedupeKey: row.dedupeKey,
    policySnapshot: (row.policySnapshot as Record<string, unknown> | null) ?? {},
    signalPayload: (row.signalPayload as Record<string, unknown> | null) ?? {},
    reason: row.reason ?? null,
    skippedReason: row.skippedReason ?? null,
    createdAt: row.createdAt?.toISOString() ?? new Date(0).toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? new Date(0).toISOString(),
  };
}
