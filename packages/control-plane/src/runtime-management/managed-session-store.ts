import type {
  HandoffStrategy,
  ManagedRuntime,
  ManagedSession,
  ManagedSessionStatus,
} from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { managedSessions } from '../db/index.js';

export type ManagedSessionRecord = ManagedSession & {
  startedAt: Date | null;
  lastHeartbeat: Date | null;
  endedAt: Date | null;
};

export type CreateManagedSessionInput = Omit<
  ManagedSessionRecord,
  'id' | 'startedAt' | 'lastHeartbeat' | 'endedAt' | 'configRevision'
> & {
  configRevision: number;
  startedAt?: Date | null;
  lastHeartbeat?: Date | null;
  endedAt?: Date | null;
};

export type ManagedSessionFilters = {
  machineId?: string;
  runtime?: ManagedRuntime;
  status?: ManagedSessionStatus;
  agentId?: string;
  limit?: number;
};

export type UpdateManagedSessionStatusPatch = {
  nativeSessionId?: string | null;
  lastHeartbeat?: Date | null;
  endedAt?: Date | null;
  metadata?: Record<string, unknown>;
};

export class ManagedSessionStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async create(input: CreateManagedSessionInput): Promise<ManagedSessionRecord> {
    const rows = await this.db
      .insert(managedSessions)
      .values({
        runtime: input.runtime,
        nativeSessionId: input.nativeSessionId,
        machineId: input.machineId,
        agentId: input.agentId,
        projectPath: input.projectPath,
        worktreePath: input.worktreePath,
        status: input.status,
        configVersion: input.configRevision,
        handoffStrategy: input.handoffStrategy,
        handoffSourceSessionId: input.handoffSourceSessionId,
        metadata: input.metadata,
        startedAt: input.startedAt ?? new Date(),
        lastHeartbeat: input.lastHeartbeat ?? null,
        endedAt: input.endedAt ?? null,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new ControlPlaneError('MANAGED_SESSION_CREATE_FAILED', 'Failed to create managed session', {
        machineId: input.machineId,
        runtime: input.runtime,
      });
    }

    this.logger.info({ managedSessionId: row.id, runtime: row.runtime }, 'Managed session created');
    return mapManagedSessionRow(row);
  }

  async list(filters: ManagedSessionFilters = {}): Promise<ManagedSessionRecord[]> {
    const conditions = [];

    if (filters.machineId) {
      conditions.push(eq(managedSessions.machineId, filters.machineId));
    }
    if (filters.runtime) {
      conditions.push(eq(managedSessions.runtime, filters.runtime));
    }
    if (filters.status) {
      conditions.push(eq(managedSessions.status, filters.status));
    }
    if (filters.agentId) {
      conditions.push(eq(managedSessions.agentId, filters.agentId));
    }

    let query = this.db.select().from(managedSessions);
    if (conditions.length > 0) {
      query = query.where(conditions.length === 1 ? conditions[0] : and(...conditions));
    }

    const rows = await query.orderBy(desc(managedSessions.startedAt)).limit(filters.limit ?? 20);
    return rows.map(mapManagedSessionRow);
  }

  async updateStatus(
    sessionId: string,
    status: ManagedSessionStatus,
    patch: UpdateManagedSessionStatusPatch = {},
  ): Promise<ManagedSessionRecord> {
    const rows = await this.db
      .update(managedSessions)
      .set({
        status,
        nativeSessionId: patch.nativeSessionId,
        lastHeartbeat: patch.lastHeartbeat,
        endedAt: patch.endedAt,
        metadata: patch.metadata,
      })
      .where(eq(managedSessions.id, sessionId))
      .returning();

    const row = rows[0];
    if (!row) {
      throw new ControlPlaneError('MANAGED_SESSION_NOT_FOUND', `Managed session '${sessionId}' was not found`, {
        sessionId,
      });
    }

    this.logger.info({ managedSessionId: sessionId, status }, 'Managed session status updated');
    return mapManagedSessionRow(row);
  }
}

function mapManagedSessionRow(row: typeof managedSessions.$inferSelect): ManagedSessionRecord {
  return {
    id: row.id,
    runtime: row.runtime as ManagedRuntime,
    nativeSessionId: row.nativeSessionId ?? null,
    machineId: row.machineId,
    agentId: row.agentId ?? null,
    projectPath: row.projectPath,
    worktreePath: row.worktreePath ?? null,
    status: row.status as ManagedSessionStatus,
    configRevision: row.configVersion,
    handoffStrategy: (row.handoffStrategy as HandoffStrategy | null) ?? null,
    handoffSourceSessionId: row.handoffSourceSessionId ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    startedAt: row.startedAt ?? null,
    lastHeartbeat: row.lastHeartbeat ?? null,
    endedAt: row.endedAt ?? null,
  };
}
