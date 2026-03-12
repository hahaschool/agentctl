import type { WorkerLease } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { eq, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { workerLeases } from '../db/index.js';

const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export class WorkerLeaseStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /**
   * Claim a lease for a task run. Fails if a lease already exists.
   * Uses INSERT with no conflict handling -- duplicate key will throw.
   */
  async claimLease(
    taskRunId: string,
    workerId: string,
    agentInstanceId: string,
    durationMs: number = DEFAULT_LEASE_DURATION_MS,
  ): Promise<WorkerLease> {
    const expiresAt = new Date(Date.now() + durationMs);

    try {
      const rows = await this.db
        .insert(workerLeases)
        .values({
          taskRunId,
          workerId,
          agentInstanceId,
          expiresAt,
        })
        .returning();

      if (rows.length === 0) {
        throw new ControlPlaneError('LEASE_CLAIM_FAILED', 'Failed to insert worker lease', {
          taskRunId,
          workerId,
        });
      }

      this.logger.info(
        { taskRunId, workerId, agentInstanceId, expiresAt: expiresAt.toISOString() },
        'Worker lease claimed',
      );
      return this.toLease(rows[0]);
    } catch (err: unknown) {
      // Handle unique constraint violation (lease already exists)
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        throw new ControlPlaneError(
          'LEASE_ALREADY_EXISTS',
          `A lease already exists for task run '${taskRunId}'`,
          { taskRunId },
        );
      }
      throw err;
    }
  }

  async renewLease(
    taskRunId: string,
    durationMs: number = DEFAULT_LEASE_DURATION_MS,
  ): Promise<WorkerLease> {
    const newExpiresAt = new Date(Date.now() + durationMs);

    const rows = await this.db
      .update(workerLeases)
      .set({
        expiresAt: newExpiresAt,
        renewedAt: sql`now()`,
      })
      .where(eq(workerLeases.taskRunId, taskRunId))
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('LEASE_NOT_FOUND', `No lease found for task run '${taskRunId}'`, {
        taskRunId,
      });
    }

    this.logger.debug(
      { taskRunId, newExpiresAt: newExpiresAt.toISOString() },
      'Worker lease renewed',
    );
    return this.toLease(rows[0]);
  }

  async releaseLease(taskRunId: string): Promise<void> {
    const result = await this.db
      .delete(workerLeases)
      .where(eq(workerLeases.taskRunId, taskRunId))
      .returning({ taskRunId: workerLeases.taskRunId });

    if (result.length === 0) {
      throw new ControlPlaneError('LEASE_NOT_FOUND', `No lease found for task run '${taskRunId}'`, {
        taskRunId,
      });
    }

    this.logger.info({ taskRunId }, 'Worker lease released');
  }

  async getLease(taskRunId: string): Promise<WorkerLease | undefined> {
    const rows = await this.db
      .select()
      .from(workerLeases)
      .where(eq(workerLeases.taskRunId, taskRunId));
    return rows.length === 0 ? undefined : this.toLease(rows[0]);
  }

  async getExpiredLeases(): Promise<WorkerLease[]> {
    const rows = await this.db
      .select()
      .from(workerLeases)
      .where(lt(workerLeases.expiresAt, sql`now()`));
    return rows.map((r) => this.toLease(r));
  }

  private toLease(row: typeof workerLeases.$inferSelect): WorkerLease {
    return {
      taskRunId: row.taskRunId,
      workerId: row.workerId,
      agentInstanceId: row.agentInstanceId,
      expiresAt: row.expiresAt.toISOString(),
      renewedAt: (row.renewedAt ?? new Date()).toISOString(),
    };
  }
}
