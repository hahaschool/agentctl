import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { memoryProvidersApi } from './memory-providers';

function makeFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function makeNoContentResponse(): Response {
  return {
    ok: true,
    status: 204,
    statusText: 'No Content',
    json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected end of JSON input')),
  } as unknown as Response;
}

function lastFetchCall() {
  const calls = vi.mocked(fetch).mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error('fetch was not called');
  return call;
}

describe('memoryProvidersApi', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists configured embedding providers', async () => {
    const payload = {
      providers: [
        {
          id: 'provider-1',
          name: 'OpenAI',
          provider: 'openai',
          model: 'text-embedding-3-small',
          apiKeyLast4: '1234',
          isActive: true,
          metadata: {
            lastTestOk: true,
            lastTestError: null,
            lastTestedAt: '2026-04-24T00:00:00Z',
            dim: 1536,
            latencyMs: 85,
            costUsd: 0.000001,
          },
          createdAt: '2026-04-24T00:00:00Z',
          updatedAt: '2026-04-24T00:00:00Z',
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    const result = await memoryProvidersApi.list();

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/memory/providers');
    expect(init?.method).toBeUndefined();
    expect(result).toEqual(payload);
  });

  it('tests a credential through the ephemeral endpoint', async () => {
    const payload = {
      ok: true,
      dim: 1536,
      model: 'text-embedding-3-small',
      costUsd: 0.000001,
      latencyMs: 85,
      signedToken: 'opaque-test-token',
    };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse(payload));

    const result = await memoryProvidersApi.testEphemeral({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'test-api-key',
    });

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/memory/providers/test-ephemeral');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'test-api-key',
    });
    expect(result).toEqual(payload);
  });

  it('creates providers with recent test result binding', async () => {
    const provider = {
      id: 'provider-1',
      name: 'OpenAI',
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKeyLast4: '1234',
      isActive: true,
      metadata: {
        lastTestOk: true,
        lastTestError: null,
        lastTestedAt: '2026-04-24T00:00:00Z',
        dim: 1536,
        latencyMs: 85,
        costUsd: 0.000001,
      },
      createdAt: '2026-04-24T00:00:00Z',
      updatedAt: '2026-04-24T00:00:00Z',
    };
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ provider }, true, 201));

    await memoryProvidersApi.create({
      name: 'OpenAI',
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'test-api-key',
      active: true,
      recentTestResult: {
        signedToken: 'opaque-test-token',
        apiKey: 'test-api-key',
      },
    });

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/memory/providers');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      name: 'OpenAI',
      provider: 'openai',
      recentTestResult: {
        signedToken: 'opaque-test-token',
        apiKey: 'test-api-key',
      },
    });
  });

  it('activates an existing provider through PATCH active:true', async () => {
    vi.mocked(fetch).mockResolvedValue(makeFetchResponse({ provider: { id: 'provider-1' } }));

    await memoryProvidersApi.setActive('provider-1');

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/memory/providers/provider-1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ active: true });
  });

  it('deletes providers by id', async () => {
    const response = makeNoContentResponse();
    vi.mocked(fetch).mockResolvedValue(response);

    await expect(memoryProvidersApi.remove('provider-1')).resolves.toBeUndefined();

    const [url, init] = lastFetchCall();
    expect(url).toBe('/api/memory/providers/provider-1');
    expect(init?.method).toBe('DELETE');
    expect(response.json).not.toHaveBeenCalled();
  });
});
