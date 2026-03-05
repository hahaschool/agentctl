import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function lastFetchCall() {
  const calls = vi.mocked(fetch).mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error('fetch was not called');
  return call;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe('api.health', () => {
  it('calls GET /health?detail=true', async () => {
    const payload = { status: 'ok', timestamp: '2026-01-01T00:00:00Z' };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    const result = await api.health();

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = lastFetchCall();
    expect(url).toBe('/health?detail=true');
    expect(init?.method).toBeUndefined(); // default GET
    expect(result).toEqual(payload);
  });

  it('throws ApiError on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({ error: 'SERVICE_DOWN', message: 'Service is down' }, false, 503),
    );

    await expect(api.health()).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      code: 'SERVICE_DOWN',
      message: 'Service is down',
    });
  });
});

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

describe('api.listMachines', () => {
  it('calls GET /api/agents', async () => {
    const payload: unknown[] = [];
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    const result = await api.listMachines();

    const [url] = lastFetchCall();
    expect(url).toBe('/api/agents');
    expect(result).toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

describe('api.listAgents', () => {
  it('calls GET /api/agents/agents/list and unwraps paginated response', async () => {
    const agents = [{ id: 'a1', name: 'worker' }];
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ agents, total: 1, hasMore: false }));

    const result = await api.listAgents();

    const [url] = lastFetchCall();
    expect(url).toBe('/api/agents/agents/list');
    expect(result).toEqual(agents);
  });
});

describe('api.getAgent', () => {
  it('calls GET /api/agents/agents/:id', async () => {
    const agent = { id: 'abc', name: 'test-agent' };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(agent));

    const result = await api.getAgent('abc');

    const [url] = lastFetchCall();
    expect(url).toBe('/api/agents/agents/abc');
    expect(result).toEqual(agent);
  });
});

describe('api.createAgent', () => {
  it('calls POST /api/agents/agents with JSON body', async () => {
    const responsePayload = { ok: true, agentId: 'new-id' };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(responsePayload));

    const body = { name: 'new-agent', machineId: 'm1', type: 'autonomous' };
    const result = await api.createAgent(body);

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/agents/agents');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(body);
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(result).toEqual(responsePayload);
  });
});

describe('api.startAgent', () => {
  it('calls POST /api/agents/:id/start with prompt', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: true }));

    await api.startAgent('agent-1', 'do the thing');

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/agents/agent-1/start');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ prompt: 'do the thing' });
  });
});

describe('api.stopAgent', () => {
  it('calls POST /api/agents/:id/stop', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: true }));

    await api.stopAgent('agent-1');

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/agents/agent-1/stop');
    expect(init?.method).toBe('POST');
  });

  it('does not set Content-Type when no body is provided', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: true }));

    await api.stopAgent('agent-1');

    const [, init] = lastFetchCall();
    expect((init?.headers as Record<string, string>)?.['Content-Type']).toBeUndefined();
  });
});

describe('api.updateAgent', () => {
  it('calls PATCH /api/agents/agents/:id with body', async () => {
    const updated = { id: 'a1', accountId: 'acc-1' };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(updated));

    const result = await api.updateAgent('a1', { accountId: 'acc-1' });

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/agents/agents/a1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ accountId: 'acc-1' });
    expect(result).toEqual(updated);
  });

  it('accepts null accountId to clear the account', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ id: 'a1', accountId: null }));

    await api.updateAgent('a1', { accountId: null });

    const [, init] = lastFetchCall();
    expect(JSON.parse(init?.body as string)).toEqual({ accountId: null });
  });
});

describe('api.getAgentRuns', () => {
  it('calls GET /api/agents/agents/:id/runs', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse([]));

    await api.getAgentRuns('a1');

    const [url] = lastFetchCall();
    expect(url).toBe('/api/agents/agents/a1/runs');
  });
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

describe('api.listSessions', () => {
  it('calls GET /api/sessions with no params', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse([]));

    await api.listSessions();

    const [url] = lastFetchCall();
    expect(url).toBe('/api/sessions');
  });

  it('appends status query param', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse([]));

    await api.listSessions({ status: 'running' });

    const [url] = lastFetchCall();
    expect(url).toBe('/api/sessions?status=running');
  });

  it('appends machineId query param', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse([]));

    await api.listSessions({ machineId: 'machine-42' });

    const [url] = lastFetchCall();
    expect(url).toBe('/api/sessions?machineId=machine-42');
  });

  it('appends both status and machineId params', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse([]));

    await api.listSessions({ status: 'idle', machineId: 'machine-1' });

    const [url] = lastFetchCall();
    const parsed = new URL(url as string, 'http://localhost');
    expect(parsed.searchParams.get('status')).toBe('idle');
    expect(parsed.searchParams.get('machineId')).toBe('machine-1');
  });

  it('does not append empty params', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse([]));

    await api.listSessions({});

    const [url] = lastFetchCall();
    expect(url).toBe('/api/sessions');
  });
});

describe('api.getSession', () => {
  it('calls GET /api/sessions/:id', async () => {
    const session = { id: 's1', status: 'running' };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(session));

    const result = await api.getSession('s1');

    const [url] = lastFetchCall();
    expect(url).toBe('/api/sessions/s1');
    expect(result).toEqual(session);
  });
});

describe('api.createSession', () => {
  it('calls POST /api/sessions with required body fields', async () => {
    const responsePayload = { ok: true, sessionId: 'new-session', session: {} };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(responsePayload));

    const body = { agentId: 'a1', machineId: 'm1', projectPath: '/home/user/project' };
    const result = await api.createSession(body);

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/sessions');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(body);
    expect(result).toEqual(responsePayload);
  });

  it('includes optional fields in body when provided', async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({ ok: true, sessionId: 'x', session: {} }),
    );

    const body = {
      agentId: 'a1',
      machineId: 'm1',
      projectPath: '/proj',
      prompt: 'hello',
      model: 'claude-opus-4-6',
      accountId: 'acc-1',
    };
    await api.createSession(body);

    const [, init] = lastFetchCall();
    expect(JSON.parse(init?.body as string)).toMatchObject({
      prompt: 'hello',
      model: 'claude-opus-4-6',
      accountId: 'acc-1',
    });
  });
});

describe('api.resumeSession', () => {
  it('calls POST /api/sessions/:id/resume with prompt', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: true }));

    await api.resumeSession('s1', 'continue please');

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/sessions/s1/resume');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ prompt: 'continue please' });
  });
});

describe('api.sendMessage', () => {
  it('calls POST /api/sessions/:id/message with message', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: true }));

    await api.sendMessage('s1', 'hello agent');

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/sessions/s1/message');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ message: 'hello agent' });
  });
});

describe('api.deleteSession', () => {
  it('calls DELETE /api/sessions/:id', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: true }));

    await api.deleteSession('s1');

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/sessions/s1');
    expect(init?.method).toBe('DELETE');
  });
});

describe('api.forkSession', () => {
  it('calls POST /api/sessions/:id/fork with prompt', async () => {
    const responsePayload = { ok: true, sessionId: 'forked', session: {}, forkedFrom: 's1' };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(responsePayload));

    const result = await api.forkSession('s1', 'try different approach');

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/sessions/s1/fork');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ prompt: 'try different approach' });
    expect(result).toEqual(responsePayload);
  });
});

describe('api.discoverSessions', () => {
  it('calls GET /api/sessions/discover', async () => {
    const payload = { sessions: [], count: 0, machinesQueried: 1, machinesFailed: 0 };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    const result = await api.discoverSessions();

    const [url] = lastFetchCall();
    expect(url).toBe('/api/sessions/discover');
    expect(result).toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// Session content
// ---------------------------------------------------------------------------

describe('api.getSessionContent', () => {
  it('calls GET /api/sessions/content/:sessionId with required machineId', async () => {
    const payload = { messages: [], sessionId: 'sess-1', totalMessages: 0 };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    await api.getSessionContent('sess-1', { machineId: 'machine-1' });

    const [url] = lastFetchCall();
    const parsed = new URL(url as string, 'http://localhost');
    expect(parsed.pathname).toBe('/api/sessions/content/sess-1');
    expect(parsed.searchParams.get('machineId')).toBe('machine-1');
    expect(parsed.searchParams.get('projectPath')).toBeNull();
    expect(parsed.searchParams.get('limit')).toBeNull();
  });

  it('appends optional projectPath and limit params', async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({ messages: [], sessionId: 's', totalMessages: 0 }),
    );

    await api.getSessionContent('my session id', {
      machineId: 'machine-2',
      projectPath: '/home/user/proj',
      limit: 50,
    });

    const [url] = lastFetchCall();
    const parsed = new URL(url as string, 'http://localhost');
    // session id is URL-encoded
    expect(parsed.pathname).toBe('/api/sessions/content/my%20session%20id');
    expect(parsed.searchParams.get('machineId')).toBe('machine-2');
    expect(parsed.searchParams.get('projectPath')).toBe('/home/user/proj');
    expect(parsed.searchParams.get('limit')).toBe('50');
  });

  it('URL-encodes special characters in sessionId', async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({ messages: [], sessionId: 'id/with/slashes', totalMessages: 0 }),
    );

    await api.getSessionContent('id/with/slashes', { machineId: 'm1' });

    const [url] = lastFetchCall();
    expect(url as string).toContain('id%2Fwith%2Fslashes');
  });
});

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

describe('api.listAccounts', () => {
  it('calls GET /api/settings/accounts', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse([]));

    await api.listAccounts();

    const [url] = lastFetchCall();
    expect(url).toBe('/api/settings/accounts');
  });
});

describe('api.createAccount', () => {
  it('calls POST /api/settings/accounts with body', async () => {
    const account = { id: 'acc-1', name: 'prod' };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(account));

    const body = { name: 'prod', provider: 'anthropic', credential: 'sk-test' };
    const result = await api.createAccount(body);

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/settings/accounts');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(body);
    expect(result).toEqual(account);
  });

  it('includes optional priority field when provided', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ id: 'acc-2' }));

    await api.createAccount({
      name: 'backup',
      provider: 'bedrock',
      credential: 'key',
      priority: 5,
    });

    const [, init] = lastFetchCall();
    expect(JSON.parse(init?.body as string)).toMatchObject({ priority: 5 });
  });
});

describe('api.updateAccount', () => {
  it('calls PUT /api/settings/accounts/:id with body', async () => {
    const updated = { id: 'acc-1', name: 'updated' };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(updated));

    await api.updateAccount('acc-1', { name: 'updated', priority: 2 });

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/settings/accounts/acc-1');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ name: 'updated', priority: 2 });
  });
});

describe('api.deleteAccount', () => {
  it('calls DELETE /api/settings/accounts/:id', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: true }));

    await api.deleteAccount('acc-1');

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/settings/accounts/acc-1');
    expect(init?.method).toBe('DELETE');
  });
});

describe('api.testAccount', () => {
  it('calls POST /api/settings/accounts/:id/test', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: true, latencyMs: 120 }));

    const result = await api.testAccount('acc-1');

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/settings/accounts/acc-1/test');
    expect(init?.method).toBe('POST');
    expect(result).toEqual({ ok: true, latencyMs: 120 });
  });

  it('does not set Content-Type when testAccount sends no body', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: true }));

    await api.testAccount('acc-1');

    const [, init] = lastFetchCall();
    expect((init?.headers as Record<string, string>)?.['Content-Type']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Settings / Defaults
// ---------------------------------------------------------------------------

describe('api.getDefaults', () => {
  it('calls GET /api/settings/defaults', async () => {
    const defaults = { defaultAccountId: null, failoverPolicy: 'priority' };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(defaults));

    const result = await api.getDefaults();

    const [url] = lastFetchCall();
    expect(url).toBe('/api/settings/defaults');
    expect(result).toEqual(defaults);
  });
});

describe('api.updateDefaults', () => {
  it('calls PUT /api/settings/defaults with partial body', async () => {
    const updated = { defaultAccountId: 'acc-1', failoverPolicy: 'round_robin' };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(updated));

    const result = await api.updateDefaults({ failoverPolicy: 'round_robin' });

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/settings/defaults');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ failoverPolicy: 'round_robin' });
    expect(result).toEqual(updated);
  });
});

// ---------------------------------------------------------------------------
// Project account mappings
// ---------------------------------------------------------------------------

describe('api.listProjectAccounts', () => {
  it('calls GET /api/settings/project-accounts', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse([]));

    await api.listProjectAccounts();

    const [url] = lastFetchCall();
    expect(url).toBe('/api/settings/project-accounts');
  });
});

describe('api.upsertProjectAccount', () => {
  it('calls PUT /api/settings/project-accounts with body', async () => {
    const mapping = { id: 'map-1', projectPath: '/proj', accountId: 'acc-1', createdAt: '' };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(mapping));

    const result = await api.upsertProjectAccount({ projectPath: '/proj', accountId: 'acc-1' });

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/settings/project-accounts');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ projectPath: '/proj', accountId: 'acc-1' });
    expect(result).toEqual(mapping);
  });
});

describe('api.deleteProjectAccount', () => {
  it('calls DELETE /api/settings/project-accounts/:id', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: true }));

    await api.deleteProjectAccount('map-1');

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/settings/project-accounts/map-1');
    expect(init?.method).toBe('DELETE');
  });
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

describe('api.metrics', () => {
  it('calls GET /metrics and parses Prometheus text format', async () => {
    const prometheusText = [
      '# HELP agentctl_sessions_total Total sessions',
      '# TYPE agentctl_sessions_total counter',
      'agentctl_sessions_total 42',
      'agentctl_cost_usd 1.23',
      'agentctl_label{env="prod"} 99',
      '',
    ].join('\n');

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(prometheusText),
    } as unknown as Response);

    const result = await api.metrics();

    const [url] = lastFetchCall();
    expect(url).toBe('/metrics');
    expect(result.agentctl_sessions_total).toBe(42);
    expect(result.agentctl_cost_usd).toBe(1.23);
    // Lines with label selectors are kept as-is (key includes label portion)
    expect(result['agentctl_label{env="prod"}']).toBe(99);
    // Comment lines and empty lines must be ignored
    for (const key of Object.keys(result)) {
      expect(key).not.toMatch(/^#/);
      expect(key.trim()).not.toBe('');
    }
  });

  it('throws ApiError when /metrics responds non-ok', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: vi.fn().mockResolvedValue(''),
    } as unknown as Response);

    await expect(api.metrics()).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      code: 'METRICS_ERROR',
    });
  });

  it('parses string values that are not numbers as strings', async () => {
    const prometheusText = 'some_label NaN_value\n';
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(prometheusText),
    } as unknown as Response);

    const result = await api.metrics();
    expect(result.some_label).toBe('NaN_value');
  });
});

// ---------------------------------------------------------------------------
// Generic error handling (request helper)
// ---------------------------------------------------------------------------

describe('request error handling', () => {
  it('falls back to UNKNOWN code when error body has no "error" field', async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeFetchResponse({ message: 'Something broke' }, false, 422),
    );

    await expect(api.getDefaults()).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      code: 'UNKNOWN',
      message: 'Something broke',
    });
  });

  it('falls back to statusText when error body has no "message" field', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: vi.fn().mockResolvedValue({ error: 'NOT_FOUND' }),
    } as unknown as Response);

    await expect(api.getSession('nonexistent')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'NOT_FOUND',
      message: 'Not Found',
    });
  });

  it('handles unparseable error body gracefully', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    } as unknown as Response);

    await expect(api.listMachines()).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      code: 'UNKNOWN',
      message: 'Server Error',
    });
  });

  it('does not set Content-Type header when no body is provided', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse([]));

    await api.listMachines();

    const [, init] = lastFetchCall();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('sets Content-Type: application/json when a body is provided', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ ok: true }));

    await api.startAgent('a1', 'run');

    const [, init] = lastFetchCall();
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});
