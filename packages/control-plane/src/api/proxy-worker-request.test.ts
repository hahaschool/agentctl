import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { proxyWorkerRequest } from './proxy-worker-request.js';

describe('proxyWorkerRequest', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ---------------------------------------------------------------------------
  // Successful responses
  // ---------------------------------------------------------------------------

  it('returns ok:true with status and JSON data on a successful response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: 'done' }),
    });

    const result = await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/agents/a1/loop',
      method: 'POST',
      body: { prompt: 'go' },
    });

    expect(result).toEqual({ ok: true, status: 200, data: { result: 'done' } });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://worker:9000/api/agents/a1/loop',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'go' }),
      }),
    );
  });

  it('returns ok:false for non-2xx status codes with error details', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({ error: 'CONFLICT', message: 'already running' }),
    });

    const result = await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/agents/a1/loop',
      method: 'POST',
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'CONFLICT',
      message: 'already running',
    });
  });

  // ---------------------------------------------------------------------------
  // Connection / network errors
  // ---------------------------------------------------------------------------

  it('returns WORKER_UNREACHABLE when fetch throws a connection error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/agents/a1/emergency-stop',
      method: 'POST',
    });

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: 'WORKER_UNREACHABLE',
      message: 'Failed to connect to worker at http://worker:9000: connect ECONNREFUSED',
    });
  });

  it('returns WORKER_UNREACHABLE when fetch throws a non-Error value', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue('string-error');

    const result = await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/agents/a1/emergency-stop',
      method: 'POST',
    });

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: 'WORKER_UNREACHABLE',
      message: 'Failed to connect to worker at http://worker:9000: string-error',
    });
  });

  it('returns WORKER_UNREACHABLE on timeout (AbortError)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new DOMException('signal timed out', 'AbortError'));

    const result = await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/agents/a1/loop',
      method: 'GET',
      timeoutMs: 5_000,
    });

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: 'WORKER_UNREACHABLE',
      message: expect.stringContaining('Failed to connect to worker'),
    });
  });

  // ---------------------------------------------------------------------------
  // HTTP methods and body handling
  // ---------------------------------------------------------------------------

  it('does not include a body for GET requests even if body is provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'running' }),
    });

    await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/agents/a1/loop',
      method: 'GET',
      body: { ignored: true },
    });

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const requestInit = callArgs[1] as RequestInit;
    expect(requestInit.body).toBeUndefined();
  });

  it('does not include a body for DELETE requests even if body is provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ stopped: true }),
    });

    await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/agents/a1/loop',
      method: 'DELETE',
      body: { ignored: true },
    });

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const requestInit = callArgs[1] as RequestInit;
    expect(requestInit.body).toBeUndefined();
  });

  it('includes a JSON body for POST requests', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ created: true }),
    });

    await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/agents/a1/loop',
      method: 'POST',
      body: { prompt: 'do work', config: { maxIterations: 5 } },
    });

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const requestInit = callArgs[1] as RequestInit;
    expect(requestInit.body).toBe(
      JSON.stringify({ prompt: 'do work', config: { maxIterations: 5 } }),
    );
  });

  it('includes a JSON body for PUT requests', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ paused: true }),
    });

    await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/agents/a1/loop',
      method: 'PUT',
      body: { action: 'pause' },
    });

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const requestInit = callArgs[1] as RequestInit;
    expect(requestInit.body).toBe(JSON.stringify({ action: 'pause' }));
  });

  it('does not include body when body is undefined for POST', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/agents/emergency-stop-all',
      method: 'POST',
    });

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const requestInit = callArgs[1] as RequestInit;
    expect(requestInit.body).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // URL construction
  // ---------------------------------------------------------------------------

  it('concatenates workerBaseUrl and path correctly', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await proxyWorkerRequest({
      workerBaseUrl: 'http://100.64.0.1:9000',
      path: '/api/agents/test-agent/emergency-stop',
      method: 'POST',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://100.64.0.1:9000/api/agents/test-agent/emergency-stop',
      expect.any(Object),
    );
  });

  // ---------------------------------------------------------------------------
  // Timeout configuration
  // ---------------------------------------------------------------------------

  it('uses default timeout when timeoutMs is not provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/test',
      method: 'GET',
    });

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const requestInit = callArgs[1] as RequestInit;
    expect(requestInit.signal).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Non-JSON response handling
  // ---------------------------------------------------------------------------

  it('returns INVALID_RESPONSE when successful response is not valid JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const result = await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/agents/a1/loop',
      method: 'GET',
    });

    expect(result).toEqual({
      ok: false,
      status: 502,
      error: 'INVALID_RESPONSE',
      message: 'Worker returned non-JSON response with HTTP 200',
    });
  });

  it('returns WORKER_ERROR when error response is not valid JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const result = await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/agents/a1/loop',
      method: 'POST',
    });

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'WORKER_ERROR',
      message: 'Internal Server Error',
    });
  });

  it('falls back to generic message when error body lacks error and message fields', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: async () => ({ details: 'some irrelevant field' }),
    });

    const result = await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/agents/a1/loop',
      method: 'POST',
    });

    expect(result).toEqual({
      ok: false,
      status: 422,
      error: 'WORKER_ERROR',
      message: 'Unprocessable Entity',
    });
  });

  it('handles null JSON error body gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => null,
    });

    const result = await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/test',
      method: 'GET',
    });

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'WORKER_ERROR',
      message: 'Internal Server Error',
    });
  });

  // ---------------------------------------------------------------------------
  // Timeout configuration
  // ---------------------------------------------------------------------------

  it('uses custom timeout when timeoutMs is provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    await proxyWorkerRequest({
      workerBaseUrl: 'http://worker:9000',
      path: '/api/test',
      method: 'GET',
      timeoutMs: 5_000,
    });

    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const requestInit = callArgs[1] as RequestInit;
    expect(requestInit.signal).toBeDefined();
  });
});
