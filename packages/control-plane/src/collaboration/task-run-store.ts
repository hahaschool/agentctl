import type { TaskRun } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { taskDefinitions, taskRuns } from '../db/index.js';

type CreateRunInput = {
  definitionId: string;
  spaceId?: string | null;
  threadId?: string | null;
};

type UpdateStatusInput = {
  status: string;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
};

export class TaskRunStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async createRun(input: CreateRunInput): Promise<TaskRun> {
    const rows = await this.db
      .insert(taskRuns)
      .values({
        definitionId: input.definitionId,
        spaceId: input.spaceId ?? null,
        threadId: input.threadId ?? null,
        status: 'pending',
        attempt: 1,
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('RUN_CREATE_FAILED', 'Failed to insert task run', { input });
    }

    this.logger.info({ runId: rows[0].id, definitionId: input.definitionId }, 'Task run created');
    return this.toRun(rows[0]);
  }

  async getRun(id: string): Promise<TaskRun | undefined> {
    const rows = await this.db.select().from(taskRuns).where(eq(taskRuns.id, id));
    return rows.length === 0 ? undefined : this.toRun(rows[0]);
  }

  async listRuns(): Promise<TaskRun[]> {
    const rows = await this.db.select().from(taskRuns);
    return rows.map((r) => this.toRun(r));
  }

  async updateStatus(id: string, input: UpdateStatusInput): Promise<TaskRun> {
    const updates: Record<string, unknown> = { status: input.status };

    if (input.status === 'claimed') {
      updates.claimedAt = sql`now()`;
    } else if (input.status === 'running') {
      updates.startedAt = sql`now()`;
    } else if (
      input.status === 'completed' ||
      input.status === 'failed' ||
      input.status === 'cancelled'
    ) {
      updates.completedAt = sql`now()`;
    }

    if (input.result !== undefined) {
      updates.result = input.result;
    }

    if (input.error !== undefined) {
      updates.error = input.error;
    }

    const rows = await this.db.update(taskRuns).set(updates).where(eq(taskRuns.id, id)).returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('RUN_NOT_FOUND', `Task run '${id}' does not exist`, { id });
    }

    this.logger.info({ runId: id, status: input.status }, 'Task run status updated');
    return this.toRun(rows[0]);
  }

  async updateHeartbeat(id: string): Promise<void> {
    const result = await this.db
      .update(taskRuns)
      .set({ lastHeartbeatAt: sql`now()` })
      .where(eq(taskRuns.id, id))
      .returning({ id: taskRuns.id });

    if (result.length === 0) {
      throw new ControlPlaneError('RUN_NOT_FOUND', `Task run '${id}' does not exist`, { id });
    }
  }

  async getRunsByGraph(graphId: string): Promise<TaskRun[]> {
    const defs = await this.db
      .select({ id: taskDefinitions.id })
      .from(taskDefinitions)
      .where(eq(taskDefinitions.graphId, graphId));

    if (defs.length === 0) {
      return [];
    }

    const defIds = new Set(defs.map((d) => d.id));
    const allRuns = await this.db.select().from(taskRuns);
    return allRuns.filter((r) => defIds.has(r.definitionId)).map((r) => this.toRun(r));
  }

  private toRun(row: typeof taskRuns.$inferSelect): TaskRun {
    return {
      id: row.id,
      definitionId: row.definitionId,
      spaceId: row.spaceId ?? null,
      threadId: row.threadId ?? null,
      status: (row.status ?? 'pending') as TaskRun['status'],
      attempt: row.attempt ?? 1,
      assigneeInstanceId: row.assigneeInstanceId ?? null,
      machineId: row.machineId ?? null,
      claimedAt: row.claimedAt?.toISOString() ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
      result: (row.result as Record<string, unknown>) ?? null,
      error: (row.error as Record<string, unknown>) ?? null,
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }
}
