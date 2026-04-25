import type { EgressSnapshot, MemoryOpsJob } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryOpsApi } from './memory-ops';

function makeFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function lastFetchCall() {
  const calls = vi.mocked(fetch).mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error('fetch was not called');
  return call;
}

const JOB: MemoryOpsJob = {
  id: 'job-1',
  kind: 'embedding-backfill',
  status: 'queued',
  params: {},
  progress: {
    processed: 0,
    embedded: 0,
    failed: 0,
    total: 100,
    costUsd: 0,
    usageEstimated: true,
  },
  result: null,
  error: null,
  errorCode: null,
  credentialId: null,
  providerKind: 'openai',
  providerModel: 'text-embedding-3-small',
  providerHost: 'https://api.openai.com',
  priceUsdPerMtoken: '0.02',
  originMachineId: 'local',
  executorMachineId: 'local',
  cancelRequestedAt: null,
  startedAt: null,
  finishedAt: null,
  createdAt: '2026-04-25T00:00:00.000Z',
  egressConfirmedAt: null,
  egressConfirmedBy: null,
  egressSnapshot: null,
};

const SNAPSHOT: EgressSnapshot = {
  kind: 'embedding-backfill',
  providerKind: 'openai',
  providerModel: 'text-embedding-3-small',
  providerHost: 'https://api.openai.com',
  priceUsdPerMtoken: 0.02,
  rowCount: 100,
  tokenEstimate: 1200,
  costEstimate: 0.000024,
  contentClass: 'memory-facts',
  computedAt: '2026-04-25T00:00:00.000Z',
};

describe('memoryOpsApi', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches memory ops capabilities', async () => {
    const payload = {
      enabled: true,
      enabledKinds: ['embedding-backfill'],
      machineId: 'local',
      queueAvailable: true,
      activeProvider: {
        id: 'provider-1',
        provider: 'openai',
        model: 'text-embedding-3-small',
        credentialLast4: '1234',
        lastTestOk: true,
      },
      activeProviderLastTestOk: true,
      activeJobs: [],
    };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    const result = await memoryOpsApi.capabilities();

    expect(result.enabled).toBe(true);
    expect(result.activeProvider?.model).toBe('text-embedding-3-small');
    expect(lastFetchCall()[0]).toBe('/api/memory/ops/capabilities');
  });

  it('requests an egress preview with POST /api/memory/ops/jobs/preview', async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({ ok: true, snapshot: SNAPSHOT, egressToken: 'signed-token' }),
    );

    const result = await memoryOpsApi.preview({ kind: 'embedding-backfill', params: {} });

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/memory/ops/jobs/preview');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ kind: 'embedding-backfill', params: {} }));
    expect(result.egressToken).toBe('signed-token');
  });

  it('creates a job with the signed egress token expected by the backend', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: true, job: JOB }, true, 202));

    await memoryOpsApi.createJob({
      kind: 'embedding-backfill',
      params: {},
      egressToken: 'signed-token',
      egressConfirmedBy: 'web',
    });

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/memory/ops/jobs');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(
      JSON.stringify({
        kind: 'embedding-backfill',
        params: {},
        egressToken: 'signed-token',
        egressConfirmedBy: 'web',
      }),
    );
  });

  it('lists and cancels jobs', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeFetchResponse({ jobs: [JOB], limit: 1, offset: 0 }))
      .mockResolvedValueOnce(
        makeFetchResponse({ ok: true, job: { ...JOB, status: 'cancelling' } }),
      );

    await expect(
      memoryOpsApi.listJobs({ kind: 'embedding-backfill', status: 'queued', limit: 1 }),
    ).resolves.toMatchObject({ jobs: [JOB], limit: 1, offset: 0 });
    expect(lastFetchCall()[0]).toBe(
      '/api/memory/ops/jobs?kind=embedding-backfill&status=queued&limit=1',
    );

    await expect(memoryOpsApi.cancelJob('job-1')).resolves.toMatchObject({
      job: { status: 'cancelling' },
    });
    expect(lastFetchCall()[0]).toBe('/api/memory/ops/jobs/job-1/cancel');
  });
});
