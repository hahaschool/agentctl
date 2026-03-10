import type {
  HandoffAnalyticsSummary,
  HandoffReason,
  HandoffSnapshot,
  HandoffStrategy,
  ManagedRuntime,
} from '@agentctl/shared';
import { ControlPlaneError, summarizeHandoffAnalytics } from '@agentctl/shared';
import { desc, eq, inArray, or } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { nativeImportAttempts, sessionHandoffs } from '../db/index.js';

export type SessionHandoffStatus = 'pending' | 'succeeded' | 'failed';
export type NativeImportAttemptStatus = 'pending' | 'succeeded' | 'failed';

export type SessionHandoffRecord = {
  id: string;
  sourceSessionId: string;
  targetSessionId: string | null;
  sourceRuntime: ManagedRuntime;
  targetRuntime: ManagedRuntime;
  reason: HandoffReason;
  strategy: HandoffStrategy;
  status: SessionHandoffStatus;
  snapshot: HandoffSnapshot;
  errorMessage: string | null;
  createdAt: Date | null;
  completedAt: Date | null;
};

export type CreateSessionHandoffInput = Omit<
  SessionHandoffRecord,
  'id' | 'createdAt' | 'completedAt'
> & {
  createdAt?: Date | null;
  completedAt?: Date | null;
};

export type NativeImportAttemptRecord = {
  id: string;
  handoffId: string | null;
  sourceSessionId: string | null;
  targetSessionId: string | null;
  sourceRuntime: ManagedRuntime;
  targetRuntime: ManagedRuntime;
  status: NativeImportAttemptStatus;
  metadata: Record<string, unknown>;
  errorMessage: string | null;
  attemptedAt: Date | null;
};

export type CreateNativeImportAttemptInput = Omit<
  NativeImportAttemptRecord,
  'id' | 'attemptedAt'
> & {
  attemptedAt?: Date | null;
};

export class HandoffStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async create(input: CreateSessionHandoffInput): Promise<SessionHandoffRecord> {
    const rows = await this.db
      .insert(sessionHandoffs)
      .values({
        sourceSessionId: input.sourceSessionId,
        targetSessionId: input.targetSessionId,
        sourceRuntime: input.sourceRuntime,
        targetRuntime: input.targetRuntime,
        reason: input.reason,
        strategy: input.strategy,
        status: input.status,
        snapshot: input.snapshot,
        errorMessage: input.errorMessage,
        createdAt: input.createdAt ?? new Date(),
        completedAt: input.completedAt ?? null,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new ControlPlaneError(
        'SESSION_HANDOFF_CREATE_FAILED',
        'Failed to create session handoff record',
        {
          sourceSessionId: input.sourceSessionId,
          targetRuntime: input.targetRuntime,
        },
      );
    }

    this.logger.info({ handoffId: row.id, strategy: row.strategy }, 'Session handoff created');
    return mapSessionHandoffRow(row);
  }

  async listForSession(sessionId: string, limit = 20): Promise<SessionHandoffRecord[]> {
    const rows = await this.db
      .select()
      .from(sessionHandoffs)
      .where(
        or(
          eq(sessionHandoffs.sourceSessionId, sessionId),
          eq(sessionHandoffs.targetSessionId, sessionId),
        ),
      )
      .orderBy(desc(sessionHandoffs.createdAt))
      .limit(limit);

    return rows.map(mapSessionHandoffRow);
  }

  async summarizeRecent(limit = 100): Promise<HandoffAnalyticsSummary> {
    const handoffRows = await this.db
      .select()
      .from(sessionHandoffs)
      .orderBy(desc(sessionHandoffs.createdAt))
      .limit(limit);

    if (handoffRows.length === 0) {
      return summarizeHandoffAnalytics([]);
    }

    const handoffIds = handoffRows.map((row) => row.id);
    const nativeImportRows = await this.db
      .select()
      .from(nativeImportAttempts)
      .where(inArray(nativeImportAttempts.handoffId, handoffIds))
      .orderBy(desc(nativeImportAttempts.attemptedAt))
      .limit(handoffIds.length);

    const latestAttemptByHandoffId = new Map<string, NativeImportAttemptRecord>();
    for (const row of nativeImportRows) {
      if (!row.handoffId || latestAttemptByHandoffId.has(row.handoffId)) {
        continue;
      }
      latestAttemptByHandoffId.set(row.handoffId, mapNativeImportAttemptRow(row));
    }

    return summarizeHandoffAnalytics(
      handoffRows.map((row) => {
        const nativeImportAttempt = latestAttemptByHandoffId.get(row.id);
        return {
          status: row.status as SessionHandoffStatus,
          nativeImportAttempt: nativeImportAttempt
            ? { ok: nativeImportAttempt.status === 'succeeded' }
            : undefined,
        };
      }),
    );
  }

  async recordNativeImportAttempt(
    input: CreateNativeImportAttemptInput,
  ): Promise<NativeImportAttemptRecord> {
    const rows = await this.db
      .insert(nativeImportAttempts)
      .values({
        handoffId: input.handoffId,
        sourceSessionId: input.sourceSessionId,
        targetSessionId: input.targetSessionId,
        sourceRuntime: input.sourceRuntime,
        targetRuntime: input.targetRuntime,
        status: input.status,
        metadata: input.metadata,
        errorMessage: input.errorMessage,
        attemptedAt: input.attemptedAt ?? new Date(),
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new ControlPlaneError(
        'NATIVE_IMPORT_ATTEMPT_CREATE_FAILED',
        'Failed to record native import attempt',
        { handoffId: input.handoffId },
      );
    }

    this.logger.info(
      { nativeImportAttemptId: row.id, status: row.status },
      'Native import attempt recorded',
    );
    return mapNativeImportAttemptRow(row);
  }
}

function mapSessionHandoffRow(row: typeof sessionHandoffs.$inferSelect): SessionHandoffRecord {
  return {
    id: row.id,
    sourceSessionId: row.sourceSessionId,
    targetSessionId: row.targetSessionId ?? null,
    sourceRuntime: row.sourceRuntime as ManagedRuntime,
    targetRuntime: row.targetRuntime as ManagedRuntime,
    reason: row.reason as HandoffReason,
    strategy: row.strategy as HandoffStrategy,
    status: row.status as SessionHandoffStatus,
    snapshot: row.snapshot as HandoffSnapshot,
    errorMessage: row.errorMessage ?? null,
    createdAt: row.createdAt ?? null,
    completedAt: row.completedAt ?? null,
  };
}

function mapNativeImportAttemptRow(
  row: typeof nativeImportAttempts.$inferSelect,
): NativeImportAttemptRecord {
  return {
    id: row.id,
    handoffId: row.handoffId ?? null,
    sourceSessionId: row.sourceSessionId ?? null,
    targetSessionId: row.targetSessionId ?? null,
    sourceRuntime: row.sourceRuntime as ManagedRuntime,
    targetRuntime: row.targetRuntime as ManagedRuntime,
    status: row.status as NativeImportAttemptStatus,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    errorMessage: row.errorMessage ?? null,
    attemptedAt: row.attemptedAt ?? null,
  };
}
