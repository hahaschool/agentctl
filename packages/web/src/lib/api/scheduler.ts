// ---------------------------------------------------------------------------
// Scheduler — CRUD over /api/scheduler/jobs. Surfaces repeatable (heartbeat /
// cron) jobs managed by BullMQ in the control plane. When the scheduler is not
// configured the API responds 501 with code `SCHEDULER_NOT_CONFIGURED`; callers
// should render an informational banner rather than a hard error.
// ---------------------------------------------------------------------------

import { ApiError, request } from './core';

// Mirrors RepeatableJobInfo in packages/control-plane/src/scheduler/repeatable-jobs.ts
export type RepeatableJobInfo = {
  readonly key: string;
  readonly name: string;
  readonly pattern: string | null;
  readonly every: string | null;
  readonly next: number | null;
};

export type ListJobsResponse = { jobs: RepeatableJobInfo[] };

export type CreateHeartbeatJobInput = {
  readonly agentId: string;
  readonly machineId: string;
  readonly intervalMs: number;
};

export type CreateCronJobInput = {
  readonly agentId: string;
  readonly machineId: string;
  readonly pattern: string;
  readonly model?: string;
};

export type CreateJobResponse = { ok: true };
export type DeleteJobResponse = { ok: true; key: string; removedCount?: number };

export const SCHEDULER_NOT_CONFIGURED_CODE = 'SCHEDULER_NOT_CONFIGURED';

export function isSchedulerNotConfigured(err: unknown): boolean {
  return (
    err instanceof ApiError && err.status === 501 && err.code === SCHEDULER_NOT_CONFIGURED_CODE
  );
}

export const schedulerApi = {
  listSchedulerJobs: async (): Promise<RepeatableJobInfo[]> => {
    const res = await request<ListJobsResponse>('/api/scheduler/jobs');
    return res.jobs;
  },

  createSchedulerHeartbeatJob: (body: CreateHeartbeatJobInput): Promise<CreateJobResponse> =>
    request<CreateJobResponse>('/api/scheduler/jobs/heartbeat', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createSchedulerCronJob: (body: CreateCronJobInput): Promise<CreateJobResponse> =>
    request<CreateJobResponse>('/api/scheduler/jobs/cron', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteSchedulerJob: (agentId: string): Promise<DeleteJobResponse> =>
    request<DeleteJobResponse>(`/api/scheduler/jobs/${encodeURIComponent(agentId)}`, {
      method: 'DELETE',
    }),
};
