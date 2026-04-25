// ---------------------------------------------------------------------------
// Memory Operations — web client for operator-triggered maintenance jobs.
// ---------------------------------------------------------------------------

import type {
  EgressSnapshot,
  MemoryOpsJob,
  MemoryOpsJobKind,
  MemoryOpsJobStatus,
} from '@agentctl/shared';

import { request } from './core';

export type MemoryOpsActiveProvider = {
  id: string;
  provider: string;
  model: string | null;
  credentialLast4: string | null;
  lastTestOk: boolean | null;
};

export type MemoryOpsActiveJobCount = {
  kind: MemoryOpsJobKind;
  scope: string;
  queued: number;
  running: number;
  cancelling: number;
};

export type MemoryOpsCapabilities = {
  enabled: boolean;
  enabledKinds: MemoryOpsJobKind[];
  machineId: string;
  queueAvailable: boolean;
  activeProvider: MemoryOpsActiveProvider | null;
  activeProviderLastTestOk: boolean | null;
  activeJobs: MemoryOpsActiveJobCount[];
};

export type MemoryOpsJobsResponse = {
  jobs: MemoryOpsJob[];
  limit: number;
  offset: number;
};

export type MemoryOpsPreviewResponse = {
  ok: true;
  snapshot: EgressSnapshot;
  egressToken: string;
};

export type MemoryOpsCreateJobBody = {
  kind: MemoryOpsJobKind;
  params?: Record<string, unknown>;
  egressToken?: string;
  egressConfirmedBy?: string;
  credentialId?: string;
};

export type MemoryOpsPreviewBody = {
  kind: MemoryOpsJobKind;
  params?: Record<string, unknown>;
  credentialId?: string;
};

export type MemoryOpsJobFilters = {
  kind?: MemoryOpsJobKind | MemoryOpsJobKind[];
  status?: MemoryOpsJobStatus | MemoryOpsJobStatus[];
  localOnly?: boolean;
  limit?: number;
  offset?: number;
};

function appendCsvParam<T extends string>(
  params: URLSearchParams,
  key: string,
  value: T | T[] | undefined,
): void {
  if (!value) return;
  params.set(key, Array.isArray(value) ? value.join(',') : value);
}

export const memoryOpsApi = {
  capabilities: () => request<MemoryOpsCapabilities>('/api/memory/ops/capabilities'),

  listJobs: (filters?: MemoryOpsJobFilters) => {
    const params = new URLSearchParams();
    appendCsvParam(params, 'kind', filters?.kind);
    appendCsvParam(params, 'status', filters?.status);
    if (filters?.localOnly) params.set('localOnly', 'true');
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));

    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return request<MemoryOpsJobsResponse>(`/api/memory/ops/jobs${suffix}`);
  },

  getJob: (id: string) =>
    request<{ job: MemoryOpsJob }>(`/api/memory/ops/jobs/${encodeURIComponent(id)}`),

  preview: (body: MemoryOpsPreviewBody) =>
    request<MemoryOpsPreviewResponse>('/api/memory/ops/jobs/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createJob: (body: MemoryOpsCreateJobBody) =>
    request<{ ok: true; job: MemoryOpsJob }>('/api/memory/ops/jobs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  cancelJob: (id: string) =>
    request<{ ok: true; job: MemoryOpsJob }>(
      `/api/memory/ops/jobs/${encodeURIComponent(id)}/cancel`,
      {
        method: 'POST',
      },
    ),

  streamUrl: (id: string) => `/api/memory/ops/jobs/${encodeURIComponent(id)}/stream`,
};
