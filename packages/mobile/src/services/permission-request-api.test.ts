import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, MobileClientError } from './api-client.js';
import { PermissionRequestApi } from './permission-request-api.js';

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

describe('PermissionRequestApi', () => {
  let apiClient: ApiClient;
  let permissionRequestApi: PermissionRequestApi;

  beforeEach(() => {
    vi.clearAllMocks();
    apiClient = new ApiClient({ baseUrl: 'https://cp.example.com', authToken: 'tok_mobile' });
    permissionRequestApi = new PermissionRequestApi(apiClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists pending permission requests with query params', async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse([]));

    await permissionRequestApi.listRequests({
      status: 'pending',
      agentId: 'agent-1',
      sessionId: 'session-1',
    });

    const [url, init] = mocks.fetch.mock.calls[0] ?? [];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/api/permission-requests');
    expect(parsed.searchParams.get('status')).toBe('pending');
    expect(parsed.searchParams.get('agentId')).toBe('agent-1');
    expect(parsed.searchParams.get('sessionId')).toBe('session-1');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok_mobile');
  });

  it('patches a permission request decision', async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        id: 'perm-1',
        agentId: 'agent-1',
        sessionId: 'session-1',
        machineId: 'machine-1',
        requestId: 'req-1',
        toolName: 'Bash',
        status: 'approved',
        requestedAt: '2026-03-19T00:00:00.000Z',
        timeoutAt: '2026-03-19T00:05:00.000Z',
        decision: 'approved',
      }),
    );

    await permissionRequestApi.resolveRequest('perm-1', 'approved');

    const [url, init] = mocks.fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://cp.example.com/api/permission-requests/perm-1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ decision: 'approved' });
  });

  it('rejects empty ids before making a request', async () => {
    await expect(permissionRequestApi.resolveRequest('', 'denied')).rejects.toBeInstanceOf(
      MobileClientError,
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
