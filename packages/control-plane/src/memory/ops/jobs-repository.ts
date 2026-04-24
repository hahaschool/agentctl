import {
  ControlPlaneError,
  type MemoryOpsJob,
  type MemoryOpsJobKind,
  type MemoryOpsJobStatus,
  scopeNormalize,
} from '@agentctl/shared';
import type { Pool, PoolClient } from 'pg';

import type { MemoryOpsQueue } from './queue.js';

const ACTIVE_STATUSES: MemoryOpsJobStatus[] = ['queued', 'running', 'cancelling'];
const TERMINAL_STATUSES: MemoryOpsJobStatus[] = ['completed', 'failed', 'cancelled'];

const DEFAULT_PROGRESS = {
  processed: 0,
  embedded: 0,
  failed: 0,
  total: 0,
  costUsd: 0,
  usageEstimated: false,
};

export type InsertJobInput = {
  kind: MemoryOpsJobKind;
  params?: Record<string, unknown>;
  originMachineId: string;
  executorMachineId: string;
  credentialId?: string | null;
  providerKind?: string | null;
  providerModel?: string | null;
  providerHost?: string | null;
  priceUsdPerMtoken?: number | string | null;
  egressConfirmedAt?: string | Date | null;
  egressConfirmedBy?: string | null;
  egressSnapshot?: Record<string, unknown> | null;
};

export type TransitionJobInput = {
  progress?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  errorCode?: string | null;
};

export type ListJobsFilters = {
  kinds?: MemoryOpsJobKind[];
  statuses?: MemoryOpsJobStatus[];
  localOnlyMachineId?: string;
  limit?: number;
  offset?: number;
};

export type BootReconcileResult = {
  failedLocalJobs: number;
  reEnqueuedJobs: number;
};

export type FleetActiveJobCount = {
  kind: MemoryOpsJobKind;
  scope: string;
  queued: number;
  running: number;
  cancelling: number;
};

type JobRow = {
  id: string;
  kind: MemoryOpsJobKind;
  status: MemoryOpsJobStatus;
  params: unknown;
  progress: unknown;
  result: unknown | null;
  error: string | null;
  error_code: string | null;
  credential_id: string | null;
  provider_kind: string | null;
  provider_model: string | null;
  provider_host: string | null;
  price_usd_per_mtoken: string | number | null;
  origin_machine_id: string;
  executor_machine_id: string;
  cancel_requested_at: Date | string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
  egress_confirmed_at: Date | string | null;
  egress_confirmed_by: string | null;
  egress_snapshot: unknown | null;
};

export class JobsRepository {
  constructor(private readonly pool: Pool) {}

  async insert(input: InsertJobInput): Promise<MemoryOpsJob> {
    const params = normalizeParams(input.params);
    const scope = readScope(params.scope);
    const lockKey = `memory-ops:${input.kind}:${scope}`;
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const lockResult = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS acquired',
        [lockKey],
      );
      if (!lockResult.rows[0]?.acquired) {
        throw new ControlPlaneError('CONCURRENT_JOB_REQUEST', 'A matching job request is pending', {
          kind: input.kind,
          scope,
        });
      }

      const activeResult = await client.query<{ id: string }>(
        `SELECT id
           FROM memory_ops_jobs
          WHERE kind = $1
            AND COALESCE(params->>'scope', '') = $2
            AND status = ANY($3::text[])
          LIMIT 1`,
        [input.kind, scope, ACTIVE_STATUSES],
      );
      if (activeResult.rows.length > 0) {
        throw new ControlPlaneError(
          'JOB_ALREADY_RUNNING',
          'A matching memory operation is active',
          {
            kind: input.kind,
            scope,
            jobId: activeResult.rows[0]?.id,
          },
        );
      }

      const insertResult = await client.query<JobRow>(
        `INSERT INTO memory_ops_jobs (
           kind,
           status,
           params,
           progress,
           credential_id,
           provider_kind,
           provider_model,
           provider_host,
           price_usd_per_mtoken,
           origin_machine_id,
           executor_machine_id,
           egress_confirmed_at,
           egress_confirmed_by,
           egress_snapshot
         )
         VALUES ($1, 'queued', $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
         RETURNING *`,
        [
          input.kind,
          JSON.stringify(params),
          JSON.stringify(DEFAULT_PROGRESS),
          input.credentialId ?? null,
          input.providerKind ?? null,
          input.providerModel ?? null,
          input.providerHost ?? null,
          input.priceUsdPerMtoken == null ? null : String(input.priceUsdPerMtoken),
          input.originMachineId,
          input.executorMachineId,
          input.egressConfirmedAt ?? null,
          input.egressConfirmedBy ?? null,
          input.egressSnapshot ? JSON.stringify(input.egressSnapshot) : null,
        ],
      );
      const job = rowToJob(insertResult.rows[0]);
      await notifyJob(client, job.id);
      await client.query('COMMIT');
      return job;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<MemoryOpsJob | null> {
    const result = await this.pool.query<JobRow>('SELECT * FROM memory_ops_jobs WHERE id = $1', [
      id,
    ]);
    return result.rows[0] ? rowToJob(result.rows[0]) : null;
  }

  async list(filters: ListJobsFilters = {}): Promise<MemoryOpsJob[]> {
    const where: string[] = [];
    const values: unknown[] = [];

    if (filters.kinds && filters.kinds.length > 0) {
      values.push(filters.kinds);
      where.push(`kind = ANY($${values.length}::text[])`);
    }
    if (filters.statuses && filters.statuses.length > 0) {
      values.push(filters.statuses);
      where.push(`status = ANY($${values.length}::text[])`);
    }
    if (filters.localOnlyMachineId) {
      values.push(filters.localOnlyMachineId);
      where.push(`executor_machine_id = $${values.length}`);
    }

    const limit = Math.max(1, Math.min(filters.limit ?? 50, 200));
    const offset = Math.max(0, filters.offset ?? 0);
    values.push(limit, offset);

    const result = await this.pool.query<JobRow>(
      `SELECT *
         FROM memory_ops_jobs
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC
        LIMIT $${values.length - 1}
       OFFSET $${values.length}`,
      values,
    );
    return result.rows.map(rowToJob);
  }

  async listFleetActiveJobs(): Promise<FleetActiveJobCount[]> {
    const result = await this.pool.query<{
      kind: MemoryOpsJobKind;
      scope: string | null;
      queued: number | string;
      running: number | string;
      cancelling: number | string;
    }>(
      `SELECT kind,
              COALESCE(params->>'scope', '') AS scope,
              COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
              COUNT(*) FILTER (WHERE status = 'running')::int AS running,
              COUNT(*) FILTER (WHERE status = 'cancelling')::int AS cancelling
         FROM memory_ops_jobs
        WHERE status = ANY($1::text[])
        GROUP BY kind, COALESCE(params->>'scope', '')
        ORDER BY kind, scope`,
      [ACTIVE_STATUSES],
    );
    return result.rows.map((row) => ({
      kind: row.kind,
      scope: row.scope ?? '',
      queued: Number(row.queued),
      running: Number(row.running),
      cancelling: Number(row.cancelling),
    }));
  }

  async countActiveByKindScope(): Promise<FleetActiveJobCount[]> {
    return this.listFleetActiveJobs();
  }

  async markRunning(id: string, executorMachineId?: string): Promise<MemoryOpsJob> {
    const setExecutor = executorMachineId ? ', executor_machine_id = $2' : '';
    const values = executorMachineId ? [id, executorMachineId] : [id];
    const result = await this.updateAndNotify(
      `UPDATE memory_ops_jobs
          SET status = 'running',
              started_at = COALESCE(started_at, NOW())
              ${setExecutor}
        WHERE id = $1
          AND status IN ('queued', 'running')
        RETURNING *`,
      values,
    );
    if (!result) {
      throw new ControlPlaneError('JOB_NOT_FOUND', `Memory operation job '${id}' was not found`, {
        id,
      });
    }
    return result;
  }

  async requestCancel(id: string): Promise<MemoryOpsJob> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<JobRow>(
        'SELECT * FROM memory_ops_jobs WHERE id = $1 FOR UPDATE',
        [id],
      );
      const job = selected.rows[0];
      if (!job) {
        throw new ControlPlaneError('JOB_NOT_FOUND', `Memory operation job '${id}' was not found`, {
          id,
        });
      }
      if (TERMINAL_STATUSES.includes(job.status)) {
        throw new ControlPlaneError('JOB_NOT_CANCELLABLE', 'Job is already terminal', {
          id,
          status: job.status,
        });
      }

      const result =
        job.status === 'queued'
          ? await client.query<JobRow>(
              `UPDATE memory_ops_jobs
                  SET status = 'cancelled',
                      cancel_requested_at = COALESCE(cancel_requested_at, NOW()),
                      finished_at = COALESCE(finished_at, NOW())
                WHERE id = $1
                RETURNING *`,
              [id],
            )
          : await client.query<JobRow>(
              `UPDATE memory_ops_jobs
                  SET status = 'cancelling',
                      cancel_requested_at = COALESCE(cancel_requested_at, NOW())
                WHERE id = $1
                RETURNING *`,
              [id],
            );

      const updated = rowToJob(result.rows[0]);
      await notifyJob(client, updated.id);
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async transition(
    id: string,
    targetStatus: MemoryOpsJobStatus,
    input: TransitionJobInput = {},
  ): Promise<MemoryOpsJob> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new ControlPlaneError('JOB_NOT_FOUND', `Memory operation job '${id}' was not found`, {
        id,
      });
    }

    const status =
      targetStatus === 'completed' && existing.cancelRequestedAt ? 'cancelled' : targetStatus;
    const setClauses = ['status = $2'];
    const values: unknown[] = [id, status];

    if (input.progress !== undefined) {
      values.push(JSON.stringify(input.progress));
      setClauses.push(`progress = $${values.length}::jsonb`);
    }
    if (input.result !== undefined) {
      values.push(input.result === null ? null : JSON.stringify(input.result));
      setClauses.push(`result = $${values.length}::jsonb`);
    }
    if (input.error !== undefined) {
      values.push(input.error);
      setClauses.push(`error = $${values.length}`);
    }
    if (input.errorCode !== undefined) {
      values.push(input.errorCode);
      setClauses.push(`error_code = $${values.length}`);
    }
    if (status === 'running') {
      setClauses.push('started_at = COALESCE(started_at, NOW())');
    }
    if (TERMINAL_STATUSES.includes(status)) {
      setClauses.push('finished_at = COALESCE(finished_at, NOW())');
    }

    const result = await this.updateAndNotify(
      `UPDATE memory_ops_jobs
          SET ${setClauses.join(', ')}
        WHERE id = $1
        RETURNING *`,
      values,
    );
    if (!result) {
      throw new ControlPlaneError('JOB_NOT_FOUND', `Memory operation job '${id}' was not found`, {
        id,
      });
    }
    return result;
  }

  async isCancelRequested(id: string): Promise<boolean> {
    const result = await this.pool.query<{ cancel_requested: boolean }>(
      `SELECT cancel_requested_at IS NOT NULL AS cancel_requested
         FROM memory_ops_jobs
        WHERE id = $1`,
      [id],
    );
    return result.rows[0]?.cancel_requested ?? false;
  }

  async failEnqueue(id: string): Promise<MemoryOpsJob> {
    const job = await this.transition(id, 'failed', {
      error: 'Failed to enqueue memory operation',
      errorCode: 'QUEUE_ENQUEUE_FAILED',
    });
    return job;
  }

  async bootReconcile(machineId: string, queue: MemoryOpsQueue): Promise<BootReconcileResult> {
    const client = await this.pool.connect();
    let failedLocalJobs = 0;
    try {
      await client.query('BEGIN');
      const failed = await client.query<JobRow>(
        `UPDATE memory_ops_jobs
            SET status = 'failed',
                error = 'Control plane restarted before this job finished',
                error_code = 'CP_RESTART_DURING_RUN',
                finished_at = COALESCE(finished_at, NOW())
          WHERE executor_machine_id = $1
            AND status IN ('running', 'cancelling')
          RETURNING *`,
        [machineId],
      );
      for (const row of failed.rows) {
        await notifyJob(client, row.id);
      }
      failedLocalJobs = failed.rowCount ?? failed.rows.length;
      await client.query('COMMIT');
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }

    const queued = await this.pool.query<JobRow>(
      `SELECT *
         FROM memory_ops_jobs
        WHERE executor_machine_id = $1
          AND status = 'queued'
        ORDER BY created_at ASC`,
      [machineId],
    );

    let reEnqueuedJobs = 0;
    for (const row of queued.rows) {
      const existing = await queue.getJob(row.id);
      if (!existing) {
        try {
          await queue.add(row.kind, { dbJobId: row.id }, { jobId: row.id });
          reEnqueuedJobs += 1;
        } catch {
          await this.failEnqueue(row.id);
        }
      }
    }

    return { failedLocalJobs, reEnqueuedJobs };
  }

  private async updateAndNotify(sql: string, values: unknown[]): Promise<MemoryOpsJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<JobRow>(sql, values);
      const row = result.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }
      await notifyJob(client, row.id);
      await client.query('COMMIT');
      return rowToJob(row);
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
}

function normalizeParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...(params ?? {}) };
  const scope = readScope(normalized.scope);
  if (scope || Object.hasOwn(normalized, 'scope')) {
    normalized.scope = scope;
  }
  return normalized;
}

function readScope(value: unknown): string {
  return scopeNormalize(typeof value === 'string' ? value : undefined);
}

function rowToJob(row: JobRow): MemoryOpsJob {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    params: parseRecord(row.params),
    progress: { ...DEFAULT_PROGRESS, ...parseRecord(row.progress) },
    result: row.result === null ? null : parseRecord(row.result),
    error: row.error,
    errorCode: row.error_code,
    credentialId: row.credential_id,
    providerKind: row.provider_kind,
    providerModel: row.provider_model,
    providerHost: row.provider_host,
    priceUsdPerMtoken: row.price_usd_per_mtoken === null ? null : String(row.price_usd_per_mtoken),
    originMachineId: row.origin_machine_id,
    executorMachineId: row.executor_machine_id,
    cancelRequestedAt: toIsoOrNull(row.cancel_requested_at),
    startedAt: toIsoOrNull(row.started_at),
    finishedAt: toIsoOrNull(row.finished_at),
    createdAt: toIso(row.created_at),
    egressConfirmedAt: toIsoOrNull(row.egress_confirmed_at),
    egressConfirmedBy: row.egress_confirmed_by,
    egressSnapshot: row.egress_snapshot === null ? null : parseRecord(row.egress_snapshot),
  };
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value ? toIso(value) : null;
}

async function notifyJob(client: Pick<PoolClient, 'query'>, jobId: string): Promise<void> {
  await client.query("SELECT pg_notify('memory_ops_events', $1)", [jobId]);
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Ignore rollback errors so the original failure is preserved.
  }
}
