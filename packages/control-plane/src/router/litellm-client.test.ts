import { ControlPlaneError } from '@agentctl/shared';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LiteLLMClient } from './litellm-client.js';

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
} as unknown as Logger;

const BASE_URL = 'http://localhost:4000';

function createClient(): LiteLLMClient {
  return new LiteLLMClient({ baseUrl: BASE_URL, logger });
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
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
}

describe('LiteLLMClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('health()', () => {
    it('returns true on 200', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

      const client = createClient();
      const result = await client.health();

      expect(result).toBe(true);

      const fetchMock = vi.mocked(fetch);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/health`);
    });

    it('returns false on connection error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const client = createClient();
      const result = await client.health();

      expect(result).toBe(false);
    });
  });

  describe('listModels()', () => {
    it('parses model IDs from response', async () => {
      mockFetchOk({
        object: 'list',
        data: [
          { id: 'gpt-4', object: 'model' },
          { id: 'claude-3-opus', object: 'model' },
          { id: 'claude-3-sonnet', object: 'model' },
        ],
      });

      const client = createClient();
      const models = await client.listModels();

      expect(models).toEqual(['gpt-4', 'claude-3-opus', 'claude-3-sonnet']);

      const fetchMock = vi.mocked(fetch);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/v1/models`);
      expect(init?.method).toBe('GET');
    });
  });

  describe('getModelInfo()', () => {
    it('returns deployment info', async () => {
      const deployments = [
        {
          modelName: 'claude-3-opus',
          litellmParams: { model: 'claude-3-opus-20240229' },
          modelInfo: { maxTokens: 4096 },
        },
      ];
      mockFetchOk({ data: deployments });

      const client = createClient();
      const result = await client.getModelInfo();

      expect(result).toEqual(deployments);

      const fetchMock = vi.mocked(fetch);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/model/info`);
    });
  });

  describe('error handling', () => {
    it('throws LITELLM_CONNECTION_ERROR on fetch failure', async () => {
      mockFetchNetworkError();

      const client = createClient();

      await expect(client.listModels()).rejects.toThrow(ControlPlaneError);
      await expect(client.listModels()).rejects.toMatchObject({
        code: 'LITELLM_CONNECTION_ERROR',
      });
    });

    it('throws LITELLM_API_ERROR on non-ok response', async () => {
      mockFetchError(502, 'Bad Gateway');

      const client = createClient();

      await expect(client.getModelInfo()).rejects.toThrow(ControlPlaneError);
      await expect(client.getModelInfo()).rejects.toMatchObject({
        code: 'LITELLM_API_ERROR',
      });
    });
  });
});
