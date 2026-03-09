import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, MobileClientError } from './api-client.js';
import { RuntimeSessionApi } from './runtime-session-api.js';

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

describe('RuntimeSessionApi', () => {
  let apiClient: ApiClient;
  let runtimeSessionApi: RuntimeSessionApi;

  beforeEach(() => {
    vi.clearAllMocks();
    apiClient = new ApiClient({ baseUrl: 'https://cp.example.com', authToken: 'tok_runtime' });
    runtimeSessionApi = new RuntimeSessionApi(apiClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists runtime sessions with query params', async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ sessions: [], count: 0 }));

    await runtimeSessionApi.listSessions({
      runtime: 'codex',
      status: 'active',
      machineId: 'machine-1',
      limit: 25,
    });

    const [url, init] = mocks.fetch.mock.calls[0] ?? [];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/api/runtime-sessions');
    expect(parsed.searchParams.get('runtime')).toBe('codex');
    expect(parsed.searchParams.get('status')).toBe('active');
    expect(parsed.searchParams.get('machineId')).toBe('machine-1');
    expect(parsed.searchParams.get('limit')).toBe('25');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok_runtime');
  });

  it('creates runtime sessions with the managed session payload', async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, session: { id: 'ms-1' } }));

    await runtimeSessionApi.createSession({
      runtime: 'claude-code',
      machineId: 'machine-1',
      projectPath: '/tmp/project',
      prompt: 'Start from the latest handoff',
    });

    const [url, init] = mocks.fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://cp.example.com/api/runtime-sessions');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      runtime: 'claude-code',
      machineId: 'machine-1',
      projectPath: '/tmp/project',
      prompt: 'Start from the latest handoff',
    });
  });

  it('posts handoff requests to the managed runtime endpoint', async () => {
    mocks.fetch.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        handoffId: 'handoff-1',
        strategy: 'snapshot-handoff',
        attemptedStrategies: ['snapshot-handoff'],
        nativeImportAttempt: {
          ok: false,
          sourceRuntime: 'codex',
          targetRuntime: 'claude-code',
          reason: 'not_implemented',
          metadata: { probe: 'codex-to-claude' },
        },
        snapshot: {},
        session: { id: 'ms-2' },
      }),
    );

    const response = await runtimeSessionApi.handoffSession('ms-1', {
      targetRuntime: 'codex',
      reason: 'manual',
      prompt: 'Continue in Codex',
    });

    const [url, init] = mocks.fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://cp.example.com/api/runtime-sessions/ms-1/handoff');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      targetRuntime: 'codex',
      reason: 'manual',
      prompt: 'Continue in Codex',
    });
    expect(response.nativeImportAttempt?.reason).toBe('not_implemented');
  });

  it('lists handoff history with the optional limit parameter', async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({ handoffs: [], count: 0 }));

    await runtimeSessionApi.listHandoffs('ms-1', 10);

    const [url] = mocks.fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://cp.example.com/api/runtime-sessions/ms-1/handoffs?limit=10');
  });

  it('rejects empty managed session ids before making a request', async () => {
    await expect(runtimeSessionApi.resumeSession('', { prompt: 'resume' })).rejects.toBeInstanceOf(
      MobileClientError,
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
