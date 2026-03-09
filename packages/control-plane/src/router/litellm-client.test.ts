import { ControlPlaneError } from '@agentctl/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';
import { LiteLLMClient } from './litellm-client.js';

const logger = createMockLogger();

const BASE_URL = 'http://localhost:4000';

function createClient(baseUrl = BASE_URL): LiteLLMClient {
  return new LiteLLMClient({ baseUrl, logger });
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

function mockFetchOkEmpty(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    }),
  );
}

function mockFetchOkInvalidJson(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('not valid json {{{'),
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

function mockFetchErrorUnreadable(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      text: () => Promise.reject(new Error('body stream already consumed')),
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

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('strips trailing slashes from the base URL', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

      const client = createClient('http://localhost:4000///');
      await client.health();

      const fetchMock = vi.mocked(fetch);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:4000/health');
    });

    it('works correctly when base URL has no trailing slash', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

      const client = createClient('http://localhost:4000');
      await client.health();

      const fetchMock = vi.mocked(fetch);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:4000/health');
    });
  });

  // -------------------------------------------------------------------------
  // health()
  // -------------------------------------------------------------------------

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

    it('returns false when response is not ok', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

      const client = createClient();
      const result = await client.health();

      expect(result).toBe(false);
    });

    it('returns false on connection error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const client = createClient();
      const result = await client.health();

      expect(result).toBe(false);
    });

    it('returns false on timeout error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('signal timed out')));

      const client = createClient();
      const result = await client.health();

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // listModels()
  // -------------------------------------------------------------------------

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

    it('returns an empty array when no models are available', async () => {
      mockFetchOk({ object: 'list', data: [] });

      const client = createClient();
      const models = await client.listModels();

      expect(models).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getModelInfo()
  // -------------------------------------------------------------------------

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

    it('returns multiple deployments', async () => {
      const deployments = [
        {
          modelName: 'claude-3-opus',
          litellmParams: { model: 'anthropic/claude-3-opus' },
          modelInfo: { maxTokens: 4096 },
        },
        {
          modelName: 'gpt-4o',
          litellmParams: { model: 'openai/gpt-4o' },
          modelInfo: { maxTokens: 128000 },
        },
      ];
      mockFetchOk({ data: deployments });

      const client = createClient();
      const result = await client.getModelInfo();

      expect(result).toHaveLength(2);
      expect(result[0].modelName).toBe('claude-3-opus');
      expect(result[1].modelName).toBe('gpt-4o');
    });
  });

  // -------------------------------------------------------------------------
  // testModel()
  // -------------------------------------------------------------------------

  describe('testModel()', () => {
    it('sends the correct request body and returns the response', async () => {
      const completionResponse = {
        id: 'chatcmpl-test-123',
        object: 'chat.completion',
        model: 'claude-3-sonnet',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'pong' },
            finishReason: 'stop',
          },
        ],
        usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
      };
      mockFetchOk(completionResponse);

      const client = createClient();
      const result = await client.testModel('claude-3-sonnet');

      expect(result).toEqual(completionResponse);

      const fetchMock = vi.mocked(fetch);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/v1/chat/completions`);
      expect(init?.method).toBe('POST');

      const parsedBody = JSON.parse(init?.body as string);
      expect(parsedBody.model).toBe('claude-3-sonnet');
      expect(parsedBody.messages).toEqual([{ role: 'user', content: 'ping' }]);
      expect(parsedBody.max_tokens).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // getSpend()
  // -------------------------------------------------------------------------

  describe('getSpend()', () => {
    it('returns spend log entries', async () => {
      const spendEntries = [
        {
          requestId: 'req-001',
          model: 'claude-3-opus',
          spend: 0.045,
          startTime: '2026-01-15T10:00:00Z',
          endTime: '2026-01-15T10:00:02Z',
        },
        {
          requestId: 'req-002',
          model: 'gpt-4o',
          spend: 0.012,
          startTime: '2026-01-15T10:05:00Z',
          endTime: '2026-01-15T10:05:01Z',
        },
      ];
      mockFetchOk(spendEntries);

      const client = createClient();
      const result = await client.getSpend();

      expect(result).toEqual(spendEntries);
      expect(result).toHaveLength(2);
      expect(result[0].requestId).toBe('req-001');
      expect(result[1].spend).toBe(0.012);

      const fetchMock = vi.mocked(fetch);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/spend/logs`);
    });

    it('returns an empty array when no spend data exists', async () => {
      mockFetchOk([]);

      const client = createClient();
      const result = await client.getSpend();

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // request() — error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws LITELLM_CONNECTION_ERROR on fetch failure', async () => {
      mockFetchNetworkError();

      const client = createClient();

      await expect(client.listModels()).rejects.toThrow(ControlPlaneError);
      await expect(client.listModels()).rejects.toMatchObject({
        code: 'LITELLM_CONNECTION_ERROR',
      });
    });

    it('includes the error message in LITELLM_CONNECTION_ERROR', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

      const client = createClient();

      try {
        await client.listModels();
        expect.fail('Expected error to be thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ControlPlaneError);
        const cpErr = err as ControlPlaneError;
        expect(cpErr.code).toBe('LITELLM_CONNECTION_ERROR');
        expect(cpErr.message).toContain('network down');
        expect(cpErr.context).toMatchObject({
          url: `${BASE_URL}/v1/models`,
          method: 'GET',
        });
      }
    });

    it('handles non-Error rejection in LITELLM_CONNECTION_ERROR', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue('string error'));

      const client = createClient();

      try {
        await client.listModels();
        expect.fail('Expected error to be thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ControlPlaneError);
        const cpErr = err as ControlPlaneError;
        expect(cpErr.code).toBe('LITELLM_CONNECTION_ERROR');
        expect(cpErr.message).toContain('string error');
      }
    });

    it('throws LITELLM_API_ERROR on non-ok response', async () => {
      mockFetchError(502, 'Bad Gateway');

      const client = createClient();

      await expect(client.getModelInfo()).rejects.toThrow(ControlPlaneError);
      await expect(client.getModelInfo()).rejects.toMatchObject({
        code: 'LITELLM_API_ERROR',
      });
    });

    it('includes status and response body in LITELLM_API_ERROR', async () => {
      mockFetchError(429, 'Rate limit exceeded');

      const client = createClient();

      try {
        await client.listModels();
        expect.fail('Expected error to be thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ControlPlaneError);
        const cpErr = err as ControlPlaneError;
        expect(cpErr.code).toBe('LITELLM_API_ERROR');
        expect(cpErr.message).toContain('429');
        expect(cpErr.message).toContain('Rate limit exceeded');
        expect(cpErr.context).toMatchObject({
          status: 429,
          method: 'GET',
        });
      }
    });

    it('handles unreadable response body in LITELLM_API_ERROR', async () => {
      mockFetchErrorUnreadable(500);

      const client = createClient();

      try {
        await client.listModels();
        expect.fail('Expected error to be thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ControlPlaneError);
        const cpErr = err as ControlPlaneError;
        expect(cpErr.code).toBe('LITELLM_API_ERROR');
        expect(cpErr.message).toContain('<unreadable>');
      }
    });

    it('throws LITELLM_PARSE_ERROR on invalid JSON response', async () => {
      mockFetchOkInvalidJson();

      const client = createClient();

      try {
        await client.listModels();
        expect.fail('Expected error to be thrown');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ControlPlaneError);
        const cpErr = err as ControlPlaneError;
        expect(cpErr.code).toBe('LITELLM_PARSE_ERROR');
        expect(cpErr.message).toContain('Failed to parse');
        expect(cpErr.context).toMatchObject({
          url: `${BASE_URL}/v1/models`,
          method: 'GET',
        });
        expect((cpErr.context as Record<string, unknown>).responseText).toContain('not valid json');
      }
    });

    it('returns empty object on empty response body', async () => {
      mockFetchOkEmpty();

      const client = createClient();
      const result = await client.getSpend();

      expect(result).toEqual({});
    });
  });
});
