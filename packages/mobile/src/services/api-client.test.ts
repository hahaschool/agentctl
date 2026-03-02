import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, MobileClientError } from './api-client.js';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(),
}));

vi.stubGlobal('fetch', mocks.fetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(body: unknown, status: number, statusText = 'Error'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new ApiClient({ baseUrl: 'https://cp.example.com' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Construction & configuration
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('strips trailing slash from baseUrl', async () => {
      const c = new ApiClient({ baseUrl: 'https://cp.example.com/' });
      mocks.fetch.mockResolvedValueOnce(jsonResponse({ status: 'ok', timestamp: '' }));

      await c.health();

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/health');
    });

    it('uses default timeout when none specified', () => {
      // Just verify construction doesn't throw
      const c = new ApiClient({ baseUrl: 'https://cp.example.com' });
      expect(c).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Auth token injection
  // -------------------------------------------------------------------------

  describe('auth token', () => {
    it('sends Authorization header when token is set in constructor', async () => {
      const c = new ApiClient({
        baseUrl: 'https://cp.example.com',
        authToken: 'tok_abc123',
      });
      mocks.fetch.mockResolvedValueOnce(jsonResponse({ status: 'ok', timestamp: '' }));

      await c.health();

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok_abc123');
    });

    it('sends Authorization header when token is set via setAuthToken', async () => {
      client.setAuthToken('tok_xyz');
      mocks.fetch.mockResolvedValueOnce(jsonResponse({ status: 'ok', timestamp: '' }));

      await client.health();

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok_xyz');
    });

    it('omits Authorization header when no token is set', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse({ status: 'ok', timestamp: '' }));

      await client.health();

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it('clears the token when setAuthToken is called with undefined', async () => {
      client.setAuthToken('tok_initial');
      client.setAuthToken(undefined);
      mocks.fetch.mockResolvedValueOnce(jsonResponse({ status: 'ok', timestamp: '' }));

      await client.health();

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Request/response interceptors
  // -------------------------------------------------------------------------

  describe('interceptors', () => {
    it('calls onRequest interceptor before sending', async () => {
      const onRequest = vi.fn((_url: string, init: RequestInit) => ({
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          'X-Custom': 'intercepted',
        },
      }));

      const c = new ApiClient({
        baseUrl: 'https://cp.example.com',
        onRequest,
      });

      mocks.fetch.mockResolvedValueOnce(jsonResponse({ status: 'ok', timestamp: '' }));
      await c.health();

      expect(onRequest).toHaveBeenCalledOnce();
      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('intercepted');
    });

    it('calls onResponse interceptor after receiving', async () => {
      const originalResponse = jsonResponse({ status: 'ok', timestamp: '2024-01-01' });
      const modifiedBody = { status: 'ok', timestamp: '2024-01-01', extra: true };

      const onResponse = vi.fn(async (_resp: Response) => {
        return jsonResponse(modifiedBody);
      });

      const c = new ApiClient({
        baseUrl: 'https://cp.example.com',
        onResponse,
      });

      mocks.fetch.mockResolvedValueOnce(originalResponse);
      const result = await c.health();

      expect(onResponse).toHaveBeenCalledOnce();
      expect(result).toEqual(modifiedBody);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws MobileClientError on network failure', async () => {
      mocks.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      try {
        await client.health();
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MobileClientError);
        const e = err as MobileClientError;
        expect(e.code).toBe('NETWORK_ERROR');
        expect(e.message).toContain('Failed to fetch');
        expect(e.context?.method).toBe('GET');
      }
    });

    it('throws MobileClientError with HTTP status on non-2xx response', async () => {
      mocks.fetch.mockResolvedValueOnce(
        errorResponse({ error: 'Not found', code: 'AGENT_NOT_FOUND' }, 404, 'Not Found'),
      );

      try {
        await client.getAgent('nonexistent');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MobileClientError);
        const e = err as MobileClientError;
        expect(e.code).toBe('AGENT_NOT_FOUND');
        expect(e.message).toBe('Not found');
        expect(e.context?.status).toBe(404);
      }
    });

    it('falls back to HTTP_STATUS code when response has no code field', async () => {
      mocks.fetch.mockResolvedValueOnce(
        errorResponse({ message: 'Something went wrong' }, 500, 'Internal Server Error'),
      );

      try {
        await client.health();
        expect.unreachable('Should have thrown');
      } catch (err) {
        const e = err as MobileClientError;
        expect(e.code).toBe('HTTP_500');
        expect(e.message).toBe('Something went wrong');
      }
    });

    it('falls back to status text when response body is not JSON', async () => {
      mocks.fetch.mockResolvedValueOnce(
        new Response('Bad Gateway', {
          status: 502,
          statusText: 'Bad Gateway',
        }),
      );

      try {
        await client.health();
        expect.unreachable('Should have thrown');
      } catch (err) {
        const e = err as MobileClientError;
        expect(e.code).toBe('HTTP_502');
        expect(e.message).toBe('HTTP 502 Bad Gateway');
      }
    });

    it('throws REQUEST_TIMEOUT on abort', async () => {
      mocks.fetch.mockImplementationOnce(() => {
        const err = new DOMException('The operation was aborted', 'AbortError');
        return Promise.reject(err);
      });

      try {
        await client.health();
        expect.unreachable('Should have thrown');
      } catch (err) {
        const e = err as MobileClientError;
        expect(e.code).toBe('REQUEST_TIMEOUT');
        expect(e.context?.timeoutMs).toBe(30_000);
      }
    });

    it('includes error body in context for HTTP errors', async () => {
      const errorBody = { error: 'Bad request', code: 'INVALID_PARAM', details: { field: 'name' } };
      mocks.fetch.mockResolvedValueOnce(errorResponse(errorBody, 400, 'Bad Request'));

      try {
        await client.startAgent('agent-1', { prompt: '' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        const e = err as MobileClientError;
        expect(e.context?.body).toEqual(errorBody);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Health endpoint
  // -------------------------------------------------------------------------

  describe('health()', () => {
    it('sends GET to /api/health', async () => {
      const body = { status: 'ok', timestamp: '2024-01-01T00:00:00Z' };
      mocks.fetch.mockResolvedValueOnce(jsonResponse(body));

      const result = await client.health();

      expect(mocks.fetch).toHaveBeenCalledOnce();
      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/health');
      expect(result).toEqual(body);
    });

    it('sends detail=true query param when detail flag is set', async () => {
      mocks.fetch.mockResolvedValueOnce(
        jsonResponse({ status: 'ok', timestamp: '', dependencies: {} }),
      );

      await client.health(true);

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/health?detail=true');
    });
  });

  // -------------------------------------------------------------------------
  // Machines
  // -------------------------------------------------------------------------

  describe('listMachines()', () => {
    it('sends GET to /api/machines/', async () => {
      const machines = [
        { id: 'm1', hostname: 'ec2-1', tailscaleIp: '100.1.1.1', status: 'online' },
      ];
      mocks.fetch.mockResolvedValueOnce(jsonResponse(machines));

      const result = await client.listMachines();

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/machines/');
      expect(result).toEqual(machines);
    });
  });

  // -------------------------------------------------------------------------
  // Agents
  // -------------------------------------------------------------------------

  describe('listAgents()', () => {
    it('sends GET to /api/machines/agents/list', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse([]));

      await client.listAgents();

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/machines/agents/list');
    });

    it('includes machineId query param when provided', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse([]));

      await client.listAgents('m-123');

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/machines/agents/list?machineId=m-123');
    });
  });

  describe('getAgent()', () => {
    it('sends GET to /api/machines/agents/:agentId', async () => {
      const agent = { id: 'a1', name: 'test-agent', status: 'running' };
      mocks.fetch.mockResolvedValueOnce(jsonResponse(agent));

      const result = await client.getAgent('a1');

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/machines/agents/a1');
      expect(result).toEqual(agent);
    });

    it('URL-encodes the agent ID', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse({ id: 'a/b' }));

      await client.getAgent('a/b');

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('a%2Fb');
    });
  });

  describe('startAgent()', () => {
    it('sends POST to /api/machines/:id/start with body', async () => {
      const responseBody = { ok: true, agentId: 'a1', jobId: 'j1' };
      mocks.fetch.mockResolvedValueOnce(jsonResponse(responseBody));

      const result = await client.startAgent('a1', { prompt: 'Fix the bug' });

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/machines/a1/start');
      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ prompt: 'Fix the bug' });
      expect(result).toEqual(responseBody);
    });

    it('sends optional fields in the start request', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, agentId: 'a1' }));

      await client.startAgent('a1', {
        prompt: 'Build feature',
        model: 'claude-opus-4-20250514',
        allowedTools: ['Read', 'Write'],
        resumeSession: 'sess-123',
      });

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('claude-opus-4-20250514');
      expect(body.allowedTools).toEqual(['Read', 'Write']);
      expect(body.resumeSession).toBe('sess-123');
    });
  });

  describe('stopAgent()', () => {
    it('sends POST to /api/machines/:id/stop with reason and graceful', async () => {
      mocks.fetch.mockResolvedValueOnce(
        jsonResponse({ ok: true, agentId: 'a1', reason: 'user', graceful: true }),
      );

      const result = await client.stopAgent('a1');

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/machines/a1/stop');
      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(init.body as string)).toEqual({ reason: 'user', graceful: true });
      expect(result.ok).toBe(true);
    });

    it('passes custom reason and graceful flag', async () => {
      mocks.fetch.mockResolvedValueOnce(
        jsonResponse({ ok: true, agentId: 'a1', reason: 'timeout', graceful: false }),
      );

      await client.stopAgent('a1', 'timeout', false);

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.reason).toBe('timeout');
      expect(body.graceful).toBe(false);
    });
  });

  describe('signalAgent()', () => {
    it('sends POST to /api/machines/:id/signal', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, agentId: 'a1', jobId: 'j2' }));

      const result = await client.signalAgent('a1', { prompt: 'Check status' });

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/machines/a1/signal');
      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(init.body as string)).toEqual({ prompt: 'Check status' });
      expect(result.ok).toBe(true);
    });

    it('includes metadata in signal body when provided', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, agentId: 'a1' }));

      await client.signalAgent('a1', {
        prompt: 'Deploy',
        metadata: { env: 'prod', version: '1.2.3' },
      });

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.metadata).toEqual({ env: 'prod', version: '1.2.3' });
    });
  });

  describe('getAgentRuns()', () => {
    it('sends GET to /api/machines/agents/:agentId/runs', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse([]));

      await client.getAgentRuns('a1');

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/machines/agents/a1/runs');
    });

    it('includes limit query param when provided', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse([]));

      await client.getAgentRuns('a1', 5);

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/machines/agents/a1/runs?limit=5');
    });
  });

  // -------------------------------------------------------------------------
  // Scheduler
  // -------------------------------------------------------------------------

  describe('getSchedulerJobs()', () => {
    it('sends GET to /api/scheduler/jobs', async () => {
      const body = {
        jobs: [{ key: 'heartbeat:a1', name: 'agent:start', pattern: '*/5 * * * *' }],
      };
      mocks.fetch.mockResolvedValueOnce(jsonResponse(body));

      const result = await client.getSchedulerJobs();

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/scheduler/jobs');
      expect(result.jobs).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------------

  describe('searchMemory()', () => {
    it('sends POST to /api/memory/search with query', async () => {
      const body = { results: [{ id: 'm1', memory: 'Some memory', score: 0.95 }] };
      mocks.fetch.mockResolvedValueOnce(jsonResponse(body));

      const result = await client.searchMemory('deployment issues');

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/memory/search');
      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(init.body as string)).toEqual({ query: 'deployment issues' });
      expect(result.results).toHaveLength(1);
    });

    it('includes optional agentId and limit in request body', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse({ results: [] }));

      await client.searchMemory('errors', { agentId: 'a1', limit: 10 });

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.query).toBe('errors');
      expect(body.agentId).toBe('a1');
      expect(body.limit).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  describe('getAuditActions()', () => {
    it('sends GET to /api/audit with no params', async () => {
      mocks.fetch.mockResolvedValueOnce(
        jsonResponse({ actions: [], total: 0, limit: 100, offset: 0 }),
      );

      await client.getAuditActions();

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/audit');
    });

    it('encodes all query parameters correctly', async () => {
      mocks.fetch.mockResolvedValueOnce(
        jsonResponse({ actions: [], total: 0, limit: 50, offset: 10 }),
      );

      await client.getAuditActions({
        agentId: 'a1',
        from: '2024-01-01',
        to: '2024-02-01',
        tool: 'Write',
        limit: 50,
        offset: 10,
      });

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('agentId=a1');
      expect(calledUrl).toContain('from=2024-01-01');
      expect(calledUrl).toContain('to=2024-02-01');
      expect(calledUrl).toContain('tool=Write');
      expect(calledUrl).toContain('limit=50');
      expect(calledUrl).toContain('offset=10');
    });

    it('omits undefined params from query string', async () => {
      mocks.fetch.mockResolvedValueOnce(
        jsonResponse({ actions: [], total: 0, limit: 100, offset: 0 }),
      );

      await client.getAuditActions({ agentId: 'a1' });

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/audit?agentId=a1');
    });
  });

  describe('getAuditSummary()', () => {
    it('sends GET to /api/audit/summary', async () => {
      const summary = { totalActions: 100, byTool: {}, byActionType: {} };
      mocks.fetch.mockResolvedValueOnce(jsonResponse(summary));

      const result = await client.getAuditSummary();

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toBe('https://cp.example.com/api/audit/summary');
      expect(result.totalActions).toBe(100);
    });

    it('includes filter params in query string', async () => {
      mocks.fetch.mockResolvedValueOnce(
        jsonResponse({ totalActions: 0, byTool: {}, byActionType: {} }),
      );

      await client.getAuditSummary({ agentId: 'a2', from: '2024-01-01' });

      const calledUrl = mocks.fetch.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain('agentId=a2');
      expect(calledUrl).toContain('from=2024-01-01');
    });
  });

  // -------------------------------------------------------------------------
  // Request method & headers
  // -------------------------------------------------------------------------

  describe('request headers', () => {
    it('sets Content-Type to application/json', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse({ status: 'ok', timestamp: '' }));

      await client.health();

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('sets Accept to application/json', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse({ status: 'ok', timestamp: '' }));

      await client.health();

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.Accept).toBe('application/json');
    });

    it('uses GET method for read operations', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse([]));

      await client.listMachines();

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      expect(init.method).toBe('GET');
    });

    it('uses POST method for write operations', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, agentId: 'a1' }));

      await client.startAgent('a1', { prompt: 'test' });

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      expect(init.method).toBe('POST');
    });

    it('does not include body for GET requests', async () => {
      mocks.fetch.mockResolvedValueOnce(jsonResponse([]));

      await client.listMachines();

      const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
      expect(init.body).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // MobileClientError
  // -------------------------------------------------------------------------

  describe('MobileClientError', () => {
    it('has the correct name property', () => {
      const err = new MobileClientError('TEST_CODE', 'test message');
      expect(err.name).toBe('MobileClientError');
    });

    it('stores code, message, and context', () => {
      const ctx = { foo: 'bar' };
      const err = new MobileClientError('MY_CODE', 'something broke', ctx);
      expect(err.code).toBe('MY_CODE');
      expect(err.message).toBe('something broke');
      expect(err.context).toEqual(ctx);
    });

    it('is an instance of Error', () => {
      const err = new MobileClientError('E', 'msg');
      expect(err).toBeInstanceOf(Error);
    });

    it('allows undefined context', () => {
      const err = new MobileClientError('E', 'msg');
      expect(err.context).toBeUndefined();
    });
  });
});
