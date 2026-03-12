import type { ContextRef, CrossSpaceSubscription } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { contextRefs, crossSpaceSubscriptions } from '../db/index.js';

// ── Input types ──────────────────────────────────────────────

type CreateContextRefInput = {
  readonly sourceSpaceId: string;
  readonly sourceThreadId?: string | null;
  readonly sourceEventId?: string | null;
  readonly targetSpaceId: string;
  readonly targetThreadId: string;
  readonly mode: string;
  readonly snapshotPayload?: Record<string, unknown> | null;
  readonly metadata?: Record<string, unknown>;
  readonly createdBy: string;
};

type CreateSubscriptionInput = {
  readonly sourceSpaceId: string;
  readonly targetSpaceId: string;
  readonly filterCriteria?: Record<string, unknown>;
  readonly createdBy: string;
};

// ── Context Bridge Store ─────────────────────────────────────

export class ContextBridgeStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  // ── Context Refs ────────────────────────────────────────────

  async createRef(input: CreateContextRefInput): Promise<ContextRef> {
    const rows = await this.db
      .insert(contextRefs)
      .values({
        sourceSpaceId: input.sourceSpaceId,
        sourceThreadId: input.sourceThreadId ?? null,
        sourceEventId: input.sourceEventId ?? null,
        targetSpaceId: input.targetSpaceId,
        targetThreadId: input.targetThreadId,
        mode: input.mode,
        snapshotPayload: input.snapshotPayload ?? null,
        metadata: input.metadata ?? {},
        createdBy: input.createdBy,
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('CONTEXT_REF_CREATE_FAILED', 'Failed to insert context ref', {
        input,
      });
    }

    this.logger.info(
      {
        refId: rows[0].id,
        sourceSpaceId: input.sourceSpaceId,
        targetSpaceId: input.targetSpaceId,
        mode: input.mode,
      },
      'Context ref created',
    );

    return this.toContextRef(rows[0]);
  }

  async getRef(id: string): Promise<ContextRef | undefined> {
    const rows = await this.db.select().from(contextRefs).where(eq(contextRefs.id, id));
    return rows.length === 0 ? undefined : this.toContextRef(rows[0]);
  }

  async listRefsByTargetSpace(targetSpaceId: string): Promise<ContextRef[]> {
    const rows = await this.db
      .select()
      .from(contextRefs)
      .where(eq(contextRefs.targetSpaceId, targetSpaceId));
    return rows.map((row) => this.toContextRef(row));
  }

  async deleteRef(id: string): Promise<void> {
    const result = await this.db
      .delete(contextRefs)
      .where(eq(contextRefs.id, id))
      .returning({ id: contextRefs.id });

    if (result.length === 0) {
      throw new ControlPlaneError('CONTEXT_REF_NOT_FOUND', `Context ref '${id}' does not exist`, {
        id,
      });
    }

    this.logger.info({ refId: id }, 'Context ref deleted');
  }

  // ── Cross-Space Subscriptions ───────────────────────────────

  async createSubscription(input: CreateSubscriptionInput): Promise<CrossSpaceSubscription> {
    const rows = await this.db
      .insert(crossSpaceSubscriptions)
      .values({
        sourceSpaceId: input.sourceSpaceId,
        targetSpaceId: input.targetSpaceId,
        filterCriteria: input.filterCriteria ?? {},
        createdBy: input.createdBy,
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError(
        'SUBSCRIPTION_CREATE_FAILED',
        'Failed to insert cross-space subscription',
        { input },
      );
    }

    this.logger.info(
      {
        subscriptionId: rows[0].id,
        sourceSpaceId: input.sourceSpaceId,
        targetSpaceId: input.targetSpaceId,
      },
      'Cross-space subscription created',
    );

    return this.toSubscription(rows[0]);
  }

  async getSubscription(id: string): Promise<CrossSpaceSubscription | undefined> {
    const rows = await this.db
      .select()
      .from(crossSpaceSubscriptions)
      .where(eq(crossSpaceSubscriptions.id, id));
    return rows.length === 0 ? undefined : this.toSubscription(rows[0]);
  }

  async listSubscriptionsByTarget(targetSpaceId: string): Promise<CrossSpaceSubscription[]> {
    const rows = await this.db
      .select()
      .from(crossSpaceSubscriptions)
      .where(eq(crossSpaceSubscriptions.targetSpaceId, targetSpaceId));
    return rows.map((row) => this.toSubscription(row));
  }

  async updateSubscriptionActive(id: string, active: boolean): Promise<CrossSpaceSubscription> {
    const rows = await this.db
      .update(crossSpaceSubscriptions)
      .set({ active })
      .where(eq(crossSpaceSubscriptions.id, id))
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError(
        'SUBSCRIPTION_NOT_FOUND',
        `Subscription '${id}' does not exist`,
        { id },
      );
    }

    this.logger.info({ subscriptionId: id, active }, 'Subscription active state updated');
    return this.toSubscription(rows[0]);
  }

  async deleteSubscription(id: string): Promise<void> {
    const result = await this.db
      .delete(crossSpaceSubscriptions)
      .where(eq(crossSpaceSubscriptions.id, id))
      .returning({ id: crossSpaceSubscriptions.id });

    if (result.length === 0) {
      throw new ControlPlaneError(
        'SUBSCRIPTION_NOT_FOUND',
        `Subscription '${id}' does not exist`,
        { id },
      );
    }

    this.logger.info({ subscriptionId: id }, 'Cross-space subscription deleted');
  }

  // ── Mapping helpers ─────────────────────────────────────────

  private toContextRef(row: typeof contextRefs.$inferSelect): ContextRef {
    return {
      id: row.id,
      sourceSpaceId: row.sourceSpaceId,
      sourceThreadId: row.sourceThreadId ?? null,
      sourceEventId: row.sourceEventId ?? null,
      targetSpaceId: row.targetSpaceId,
      targetThreadId: row.targetThreadId,
      mode: row.mode as ContextRef['mode'],
      snapshotPayload: (row.snapshotPayload as Record<string, unknown>) ?? null,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdBy: row.createdBy,
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }

  private toSubscription(
    row: typeof crossSpaceSubscriptions.$inferSelect,
  ): CrossSpaceSubscription {
    return {
      id: row.id,
      sourceSpaceId: row.sourceSpaceId,
      targetSpaceId: row.targetSpaceId,
      filterCriteria: (row.filterCriteria as Record<string, unknown>) ?? {},
      active: row.active ?? true,
      createdBy: row.createdBy,
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }
}
