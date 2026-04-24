import type { ControlPlaneError } from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';

import { JobsRepository } from './jobs-repository.js';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-04-25T00:00:00Z');

type QueryHandler = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: unknown[]; rowCount?: number }>;

function makeJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    kind: 'embedding-backfill',
    status: 'queued',
    params: { scope: '' },
    progress: { processed: 0, embedded: 0, failed: 0, total: 0, costUsd: 0, usageEstimated: false },
    result: null,
    error: null,
    error_code: null,
    credential_id: null,
    provider_kind: null,
    provider_model: null,
    provider_host: null,
    price_usd_per_mtoken: null,
    origin_machine_id: 'm1',
    executor_machine_id: 'm1',
    cancel_requested_at: null,
    started_at: null,
    finished_at: null,
    created_at: NOW,
    egress_confirmed_at: null,
    egress_confirmed_by: null,
    egress_snapshot: null,
    ...overrides,
  };
}

function createMockPool(handler: QueryHandler) {
  const client = {
    query: vi.fn((sql: string, params?: unknown[]) => handler(sql, params)),
    release: vi.fn(),
  };
  return {
    client,
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn((sql: string, params?: unknown[]) => handler(sql, params)),
  };
}

describe('JobsRepository', () => {
  it('throws CONCURRENT_JOB_REQUEST when the advisory transaction lock is held', async () => {
    const pool = createMockPool(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('pg_try_advisory_xact_lock')) {
        return { rows: [{ acquired: false }] };
      }
      return { rows: [] };
    });
    const repo = new JobsRepository(pool as never);

    await expect(
      repo.insert({
        kind: 'embedding-backfill',
        originMachineId: 'm1',
        executorMachineId: 'm1',
        params: { scope: ' Team ' },
      }),
    ).rejects.toMatchObject<Partial<ControlPlaneError>>({ code: 'CONCURRENT_JOB_REQUEST' });

    expect(pool.client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('throws JOB_ALREADY_RUNNING when a provider-backed fleet job is already active', async () => {
    const pool = createMockPool(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('pg_try_advisory_xact_lock')) {
        return { rows: [{ acquired: true }] };
      }
      if (sql.includes('FROM memory_ops_jobs') && sql.includes('status = ANY')) {
        return { rows: [{ id: 'existing-job' }] };
      }
      return { rows: [] };
    });
    const repo = new JobsRepository(pool as never);

    await expect(
      repo.insert({
        kind: 'embedding-backfill',
        originMachineId: 'm1',
        executorMachineId: 'm1',
      }),
    ).rejects.toMatchObject<Partial<ControlPlaneError>>({ code: 'JOB_ALREADY_RUNNING' });
  });

  it('cancels queued jobs immediately with terminal status', async () => {
    const pool = createMockPool(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('FOR UPDATE')) {
        return { rows: [makeJobRow({ status: 'queued' })] };
      }
      if (sql.includes("SET status = 'cancelled'")) {
        return {
          rows: [
            makeJobRow({
              status: 'cancelled',
              cancel_requested_at: NOW,
              finished_at: NOW,
            }),
          ],
          rowCount: 1,
        };
      }
      return { rows: [] };
    });
    const repo = new JobsRepository(pool as never);

    const job = await repo.requestCancel(JOB_ID);

    expect(job.status).toBe('cancelled');
    expect(job.cancelRequestedAt).toBe(NOW.toISOString());
    expect(pool.client.query).toHaveBeenCalledWith("SELECT pg_notify('memory_ops_events', $1)", [
      JOB_ID,
    ]);
  });

  it('routes completed transition to cancelled when cancellation was requested', async () => {
    const pool = createMockPool(async (sql, params) => {
      if (sql.includes('SELECT * FROM memory_ops_jobs WHERE id = $1')) {
        return { rows: [makeJobRow({ status: 'cancelling', cancel_requested_at: NOW })] };
      }
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('UPDATE memory_ops_jobs')) {
        expect(params?.[1]).toBe('cancelled');
        return { rows: [makeJobRow({ status: 'cancelled', cancel_requested_at: NOW })] };
      }
      return { rows: [] };
    });
    const repo = new JobsRepository(pool as never);

    const job = await repo.transition(JOB_ID, 'completed');

    expect(job.status).toBe('cancelled');
  });

  it('boot reconciliation fails local in-flight jobs and re-enqueues missing queued jobs', async () => {
    const queue = {
      getJob: vi.fn().mockResolvedValue(null),
      add: vi.fn().mockResolvedValue(undefined),
    };
    const pool = createMockPool(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes("status IN ('running', 'cancelling')")) {
        return { rows: [makeJobRow({ status: 'failed' })], rowCount: 1 };
      }
      if (sql.includes("status = 'queued'")) {
        return { rows: [makeJobRow({ kind: 'consolidation', status: 'queued' })] };
      }
      return { rows: [] };
    });
    const repo = new JobsRepository(pool as never);

    const result = await repo.bootReconcile('m1', queue as never);

    expect(result).toEqual({ failedLocalJobs: 1, reEnqueuedJobs: 1 });
    expect(queue.add).toHaveBeenCalledWith('consolidation', { dbJobId: JOB_ID }, { jobId: JOB_ID });
  });
});
