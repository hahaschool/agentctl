import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';

import { ControlPlaneError } from '@agentctl/shared';

import { Mem0Client } from './mem0-client.js';

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
} as unknown as Logger;

const BASE_URL = 'http://localhost:8080';

function createClient(): Mem0Client {
  return new Mem0Client({ baseUrl: BASE_URL, logger });
}

function mockFetchOk(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  );
}

function mockFetchError(status: number, body: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: () => Promise.resolve(body),
    }),
  );
}

function mockFetchNetworkError(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
  );
}

describe('Mem0Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('add()', () => {
    it('sends POST to /v1/memories/ with correct body', async () => {
      const responseBody = { results: [{ id: 'mem-1', memory: 'test' }] };
      mockFetchOk(responseBody);

      const client = createClient();
      const result = await client.add({
        messages: [{ role: 'user', content: 'Hello' }],
        userId: 'user-1',
        agentId: 'agent-1',
        sessionId: 'session-1',
        metadata: { source: 'test' },
      });

      expect(result).toEqual(responseBody);

      const fetchMock = vi.mocked(fetch);
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/v1/memories/`);
      expect(init?.method).toBe('POST');

      const parsed = JSON.parse(init?.body as string);
      expect(parsed.messages).toEqual([{ role: 'user', content: 'Hello' }]);
      expect(parsed.user_id).toBe('user-1');
      expect(parsed.agent_id).toBe('agent-1');
      expect(parsed.run_id).toBe('session-1');
      expect(parsed.metadata).toEqual({ source: 'test' });
    });
  });

  describe('search()', () => {
    it('sends POST to /v1/memories/search/ with query', async () => {
      const responseBody = { results: [{ id: 'mem-2', memory: 'relevant memory' }] };
      mockFetchOk(responseBody);

      const client = createClient();
      const result = await client.search({
        query: 'test query',
        userId: 'user-1',
        agentId: 'agent-1',
        limit: 5,
      });

      expect(result).toEqual(responseBody);

      const fetchMock = vi.mocked(fetch);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/v1/memories/search/`);
      expect(init?.method).toBe('POST');

      const parsed = JSON.parse(init?.body as string);
      expect(parsed.query).toBe('test query');
      expect(parsed.user_id).toBe('user-1');
      expect(parsed.agent_id).toBe('agent-1');
      expect(parsed.limit).toBe(5);
    });
  });

  describe('getAll()', () => {
    it('sends GET to /v1/memories/', async () => {
      const responseBody = { results: [] };
      mockFetchOk(responseBody);

      const client = createClient();
      const result = await client.getAll('user-1', 'agent-1');

      expect(result).toEqual(responseBody);

      const fetchMock = vi.mocked(fetch);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/v1/memories/?user_id=user-1&agent_id=agent-1`);
      expect(init?.method).toBe('GET');
    });

    it('sends GET without query params when none provided', async () => {
      const responseBody = { results: [] };
      mockFetchOk(responseBody);

      const client = createClient();
      await client.getAll();

      const fetchMock = vi.mocked(fetch);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/v1/memories/`);
    });
  });

  describe('delete()', () => {
    it('sends DELETE with encoded memoryId', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        }),
      );

      const client = createClient();
      await client.delete('mem/special&id');

      const fetchMock = vi.mocked(fetch);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/v1/memories/${encodeURIComponent('mem/special&id')}/`);
      expect(init?.method).toBe('DELETE');
    });
  });

  describe('health()', () => {
    it('returns true on 200', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      );

      const client = createClient();
      const result = await client.health();

      expect(result).toBe(true);

      const fetchMock = vi.mocked(fetch);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/health`);
    });

    it('returns false on error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      );

      const client = createClient();
      const result = await client.health();

      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    it('throws MEM0_CONNECTION_ERROR on network failure', async () => {
      mockFetchNetworkError();

      const client = createClient();

      await expect(client.search({ query: 'test' })).rejects.toThrow(ControlPlaneError);
      await expect(client.search({ query: 'test' })).rejects.toMatchObject({
        code: 'MEM0_CONNECTION_ERROR',
      });
    });

    it('throws MEM0_API_ERROR on non-ok response', async () => {
      mockFetchError(500, 'Internal Server Error');

      const client = createClient();

      await expect(client.add({ messages: [] })).rejects.toThrow(ControlPlaneError);
      await expect(client.add({ messages: [] })).rejects.toMatchObject({
        code: 'MEM0_API_ERROR',
      });
    });
  });
});
