import type { ApprovalDecision, ApprovalGate } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { approvalDecisions, approvalGates } from '../db/index.js';

// ── Input types ─────────────────────────────────────────────

type CreateGateInput = {
  readonly taskDefinitionId: string;
  readonly taskRunId?: string | null;
  readonly threadId?: string | null;
  readonly requiredApprovers?: readonly string[];
  readonly requiredCount?: number;
  readonly timeoutMs?: number;
  readonly timeoutPolicy?: string;
  readonly contextArtifactIds?: readonly string[];
};

type AddDecisionInput = {
  readonly gateId: string;
  readonly decidedBy: string;
  readonly action: string;
  readonly comment?: string | null;
  readonly viaTimeout?: boolean;
};

// ── Store ───────────────────────────────────────────────────

export class ApprovalStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async createGate(input: CreateGateInput): Promise<ApprovalGate> {
    const rows = await this.db
      .insert(approvalGates)
      .values({
        taskDefinitionId: input.taskDefinitionId,
        taskRunId: input.taskRunId ?? null,
        threadId: input.threadId ?? null,
        requiredApprovers: [...(input.requiredApprovers ?? [])],
        requiredCount: input.requiredCount ?? 1,
        timeoutMs: input.timeoutMs ?? 3_600_000,
        timeoutPolicy: input.timeoutPolicy ?? 'pause',
        contextArtifactIds: [...(input.contextArtifactIds ?? [])],
        status: 'pending',
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('GATE_CREATE_FAILED', 'Failed to insert approval gate', {
        input,
      });
    }

    this.logger.info(
      { gateId: rows[0].id, taskDefinitionId: input.taskDefinitionId },
      'Approval gate created',
    );
    return this.toGate(rows[0]);
  }

  async getGate(id: string): Promise<ApprovalGate | undefined> {
    const rows = await this.db.select().from(approvalGates).where(eq(approvalGates.id, id));
    return rows.length > 0 ? this.toGate(rows[0]) : undefined;
  }

  async listGatesByThread(threadId: string): Promise<ApprovalGate[]> {
    const rows = await this.db
      .select()
      .from(approvalGates)
      .where(eq(approvalGates.threadId, threadId));
    return rows.map((row) => this.toGate(row));
  }

  async addDecision(input: AddDecisionInput): Promise<ApprovalDecision> {
    // Verify gate exists and is still pending
    const gate = await this.getGate(input.gateId);
    if (!gate) {
      throw new ControlPlaneError('GATE_NOT_FOUND', `Approval gate '${input.gateId}' not found`, {
        gateId: input.gateId,
      });
    }

    if (gate.status !== 'pending') {
      throw new ControlPlaneError(
        'GATE_ALREADY_RESOLVED',
        `Approval gate '${input.gateId}' is already ${gate.status}`,
        { gateId: input.gateId, status: gate.status },
      );
    }

    const rows = await this.db
      .insert(approvalDecisions)
      .values({
        gateId: input.gateId,
        decidedBy: input.decidedBy,
        action: input.action,
        comment: input.comment ?? null,
        viaTimeout: input.viaTimeout ?? false,
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('DECISION_CREATE_FAILED', 'Failed to insert approval decision', {
        input,
      });
    }

    const decision = this.toDecision(rows[0]);
    this.logger.info(
      { decisionId: decision.id, gateId: input.gateId, action: input.action },
      'Approval decision added',
    );

    // Auto-resolve the gate based on the new decision count
    await this.tryResolveGate(input.gateId);

    return decision;
  }

  async getDecisions(gateId: string): Promise<ApprovalDecision[]> {
    const rows = await this.db
      .select()
      .from(approvalDecisions)
      .where(eq(approvalDecisions.gateId, gateId));
    return rows.map((row) => this.toDecision(row));
  }

  /**
   * Check if a gate should be auto-resolved based on collected decisions.
   *
   * Resolution logic:
   *  - If any decision is 'rejected' → gate becomes 'rejected'
   *  - If approval count >= requiredCount → gate becomes 'approved'
   *  - Otherwise → gate stays 'pending'
   */
  async tryResolveGate(gateId: string): Promise<ApprovalGate | undefined> {
    const gate = await this.getGate(gateId);
    if (!gate || gate.status !== 'pending') {
      return gate;
    }

    const decisions = await this.getDecisions(gateId);

    // Check for any rejection
    const hasRejection = decisions.some((d) => d.action === 'rejected');
    if (hasRejection) {
      return this.updateGateStatus(gateId, 'rejected');
    }

    // Count approvals
    const approvalCount = decisions.filter((d) => d.action === 'approved').length;
    if (approvalCount >= gate.requiredCount) {
      return this.updateGateStatus(gateId, 'approved');
    }

    return gate;
  }

  /**
   * Mark a gate as timed-out (called by a timeout checker).
   */
  async timeoutGate(gateId: string): Promise<ApprovalGate | undefined> {
    const gate = await this.getGate(gateId);
    if (!gate || gate.status !== 'pending') {
      return gate;
    }

    return this.updateGateStatus(gateId, 'timed-out');
  }

  private async updateGateStatus(
    gateId: string,
    status: string,
  ): Promise<ApprovalGate | undefined> {
    const rows = await this.db
      .update(approvalGates)
      .set({ status })
      .where(eq(approvalGates.id, gateId))
      .returning();

    if (rows.length === 0) {
      return undefined;
    }

    this.logger.info({ gateId, status }, 'Approval gate status updated');
    return this.toGate(rows[0]);
  }

  // ── Mappers ─────────────────────────────────────────────

  private toGate(row: typeof approvalGates.$inferSelect): ApprovalGate {
    return {
      id: row.id,
      taskDefinitionId: row.taskDefinitionId,
      taskRunId: row.taskRunId ?? null,
      threadId: row.threadId ?? null,
      requiredApprovers: row.requiredApprovers ?? [],
      requiredCount: row.requiredCount,
      timeoutMs: row.timeoutMs ?? 3_600_000,
      timeoutPolicy: (row.timeoutPolicy ?? 'pause') as ApprovalGate['timeoutPolicy'],
      contextArtifactIds: row.contextArtifactIds ?? [],
      status: (row.status ?? 'pending') as ApprovalGate['status'],
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }

  private toDecision(row: typeof approvalDecisions.$inferSelect): ApprovalDecision {
    return {
      id: row.id,
      gateId: row.gateId,
      decidedBy: row.decidedBy,
      action: row.action as ApprovalDecision['action'],
      comment: row.comment ?? null,
      viaTimeout: row.viaTimeout ?? false,
      decidedAt: (row.decidedAt ?? new Date()).toISOString(),
    };
  }
}
