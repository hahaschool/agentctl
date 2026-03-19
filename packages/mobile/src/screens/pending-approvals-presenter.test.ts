import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, MobileClientError } from '../services/api-client.js';
import { PendingApprovalsPresenter } from './pending-approvals-presenter.js';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(),
}));

vi.stubGlobal('fetch', mocks.fetch);

function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'perm-1',
    agentId: 'agent-1',
    sessionId: 'session-1',
    machineId: 'machine-1',
    requestId: 'req-1',
    toolName: 'Bash',
    toolInput: { command: 'ls -la' },
    status: 'pending',
    requestedAt: '2026-03-19T00:00:00.000Z',
    timeoutAt: '2026-03-19T00:05:00.000Z',
    ...overrides,
  };
}

describe('PendingApprovalsPresenter', () => {
  let apiClient: ApiClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:00:00.000Z'));
    vi.clearAllMocks();
    apiClient = new ApiClient({ baseUrl: 'https://cp.example.com', authToken: 'tok_mobile' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns an empty initial state', () => {
    const presenter = new PendingApprovalsPresenter({ apiClient });
    expect(presenter.getState()).toMatchObject({
      requests: [],
      pendingCount: 0,
      isLoading: false,
      resolvingRequestId: null,
      error: null,
      lastUpdated: null,
    });
  });

  it('loads pending approvals and updates pendingCount', async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse([makeRequest(), makeRequest({ id: 'perm-2' })]));

    const presenter = new PendingApprovalsPresenter({ apiClient });
    await presenter.refresh();

    expect(presenter.getState().pendingCount).toBe(2);
    expect(presenter.getState().requests).toHaveLength(2);
    expect(presenter.getState().lastUpdated).toEqual(new Date('2026-03-19T12:00:00.000Z'));
  });

  it('resolves a request and refreshes the list', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          ...makeRequest(),
          status: 'approved',
          decision: 'approved',
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]));

    const presenter = new PendingApprovalsPresenter({ apiClient });
    await presenter.resolveRequest('perm-1', 'approved');

    expect(presenter.getState().requests).toEqual([]);
    expect(presenter.getState().pendingCount).toBe(0);
    expect(presenter.getState().resolvingRequestId).toBeNull();
  });

  it('polls on an interval after start()', async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse([makeRequest()]))
      .mockResolvedValueOnce(jsonResponse([]));

    const presenter = new PendingApprovalsPresenter({ apiClient, pollIntervalMs: 5_000 });
    presenter.start();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(presenter.getState().pendingCount).toBe(0);

    presenter.stop();
  });

  it('stores MobileClientError when refresh fails', async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError('network down'));

    const presenter = new PendingApprovalsPresenter({ apiClient });
    await presenter.refresh();

    expect(presenter.getState().error).toBeInstanceOf(MobileClientError);
    expect(presenter.getState().isLoading).toBe(false);
  });
});
