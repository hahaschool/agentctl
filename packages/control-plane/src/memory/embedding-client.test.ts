import { ControlPlaneError } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';

import { EmbeddingClient } from './embedding-client.js';

describe('EmbeddingClient', () => {
  const logger = createMockLogger();
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function makeClient(baseUrl = 'http://localhost:4000/'): EmbeddingClient {
    return new EmbeddingClient({
      baseUrl,
      model: 'text-embedding-3-small',
      logger,
    });
  }

  it('returns an embedding vector for a single text input', async () => {
    const fakeEmbedding = Array.from({ length: 8 }, (_, index) => index * 0.1);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: fakeEmbedding, index: 0 }],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 10, total_tokens: 10 },
      }),
    });

    const client = makeClient();
    const result = await client.embed('test content');

    expect(result).toEqual(fakeEmbedding);
    expect(globalThis.fetch).toHaveBeenCalledOnce();

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:4000/v1/embeddings');
    expect(init.method).toBe('POST');

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe('text-embedding-3-small');
    expect(body.input).toBe('test content');
  });

  it('returns ordered embeddings for batch input', async () => {
    const first = Array.from({ length: 4 }, () => 0.1);
    const second = Array.from({ length: 4 }, () => 0.2);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: second, index: 1 },
          { embedding: first, index: 0 },
        ],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 20, total_tokens: 20 },
      }),
    });

    const client = makeClient();
    const result = await client.embedBatch(['text one', 'text two']);

    expect(result).toEqual([first, second]);

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.input).toEqual(['text one', 'text two']);
  });

  it('throws ControlPlaneError on non-ok API responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    });

    const client = makeClient();

    await expect(client.embed('test')).rejects.toThrow(ControlPlaneError);
    await expect(client.embed('test')).rejects.toMatchObject({
      code: 'EMBEDDING_API_ERROR',
    });
  });

  it('throws ControlPlaneError on network failures', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const client = makeClient();

    await expect(client.embed('test')).rejects.toThrow(ControlPlaneError);
    await expect(client.embed('test')).rejects.toMatchObject({
      code: 'EMBEDDING_CONNECTION_ERROR',
    });
  });

  it('retries retryable API statuses with exponential backoff', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fakeEmbedding = Array.from({ length: 4 }, () => 0.3);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ embedding: fakeEmbedding, index: 0 }],
          model: 'text-embedding-3-small',
          usage: { prompt_tokens: 10, total_tokens: 10 },
        }),
      });

    const client = new EmbeddingClient({
      baseUrl: 'http://localhost:4000/',
      model: 'text-embedding-3-small',
      logger,
      sleep,
      retryBaseDelayMs: 250,
    });

    await expect(client.embed('retry me')).resolves.toEqual(fakeEmbedding);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('retries network failures before surfacing a connection error', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('Still down'))
      .mockRejectedValueOnce(new Error('No route'));

    const client = new EmbeddingClient({
      baseUrl: 'http://localhost:4000/',
      model: 'text-embedding-3-small',
      logger,
      sleep,
      maxAttempts: 3,
      retryBaseDelayMs: 200,
    });

    await expect(client.embedBatch(['one', 'two'])).rejects.toMatchObject({
      code: 'EMBEDDING_CONNECTION_ERROR',
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 200);
    expect(sleep).toHaveBeenNthCalledWith(2, 400);
  });
});
