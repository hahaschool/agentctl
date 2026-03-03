import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { LiteLLMClient } from '../../router/litellm-client.js';
import { createServer } from '../server.js';

const logger = {
  child: () => logger,
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  level: 'silent',
} as unknown as Logger;

function createMockLiteLLMClient(overrides: Partial<LiteLLMClient> = {}): LiteLLMClient {
  return {
    health: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue(['claude-sonnet-4-20250514', 'gpt-4o']),
    getModelInfo: vi.fn().mockResolvedValue([
      {
        modelName: 'claude-sonnet-4-20250514',
        litellmParams: { model: 'anthropic/claude-sonnet-4-20250514' },
        modelInfo: { maxTokens: 8192 },
      },
    ]),
    testModel: vi.fn().mockResolvedValue({
      id: 'chatcmpl-test-123',
      object: 'chat.completion',
      model: 'claude-sonnet-4-20250514',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'pong' },
          finishReason: 'stop',
        },
      ],
      usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
    }),
    getSpend: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as LiteLLMClient;
}

describe('Router routes — /api/router', () => {
  let app: FastifyInstance;
  let mockClient: LiteLLMClient;

  beforeAll(async () => {
    mockClient = createMockLiteLLMClient();
    app = await createServer({ logger, litellmClient: mockClient });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // GET /api/router/health
  // -------------------------------------------------------------------------

  describe('GET /api/router/health', () => {
    it('returns 200 with status ok when LiteLLM is healthy', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/router/health',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
      expect(mockClient.health).toHaveBeenCalled();
    });

    it('returns 503 when LiteLLM is unhealthy', async () => {
      vi.mocked(mockClient.health).mockResolvedValueOnce(false);

      const response = await app.inject({
        method: 'GET',
        url: '/api/router/health',
      });

      expect(response.statusCode).toBe(503);

      const body = response.json();
      expect(body.status).toBe('degraded');
      expect(body.timestamp).toBeDefined();
    });

    it('returns a valid ISO timestamp in the response', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/router/health',
      });

      const body = response.json();
      const parsed = new Date(body.timestamp);
      expect(parsed.toISOString()).toBe(body.timestamp);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/router/models
  // -------------------------------------------------------------------------

  describe('GET /api/router/models', () => {
    it('returns the list of available model IDs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/router/models',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.models).toEqual(['claude-sonnet-4-20250514', 'gpt-4o']);
      expect(mockClient.listModels).toHaveBeenCalled();
    });

    it('returns 502 when listModels() throws ControlPlaneError', async () => {
      vi.mocked(mockClient.listModels).mockRejectedValueOnce(
        new ControlPlaneError('LITELLM_CONNECTION_ERROR', 'LiteLLM proxy unreachable'),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/router/models',
      });

      expect(response.statusCode).toBe(502);

      const body = response.json();
      expect(body.error).toBe('LITELLM_CONNECTION_ERROR');
      expect(body.message).toBe('LiteLLM proxy unreachable');
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/router/models/info
  // -------------------------------------------------------------------------

  describe('GET /api/router/models/info', () => {
    it('returns detailed model deployment info', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/router/models/info',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.deployments).toBeDefined();
      expect(Array.isArray(body.deployments)).toBe(true);
      expect(body.deployments.length).toBe(1);
      expect(body.deployments[0].modelName).toBe('claude-sonnet-4-20250514');
      expect(mockClient.getModelInfo).toHaveBeenCalled();
    });

    it('returns 502 when getModelInfo() throws ControlPlaneError', async () => {
      vi.mocked(mockClient.getModelInfo).mockRejectedValueOnce(
        new ControlPlaneError('LITELLM_API_ERROR', 'LiteLLM returned 500'),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/router/models/info',
      });

      expect(response.statusCode).toBe(502);

      const body = response.json();
      expect(body.error).toBe('LITELLM_API_ERROR');
      expect(body.message).toBe('LiteLLM returned 500');
    });

    it('returns 500 when getModelInfo() throws non-ControlPlaneError', async () => {
      vi.mocked(mockClient.getModelInfo).mockRejectedValueOnce(new Error('unexpected'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/router/models/info',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('MODEL_INFO_FAILED');
      expect(body.message).toBe('Failed to fetch model info');
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/router/spend
  // -------------------------------------------------------------------------

  describe('GET /api/router/spend', () => {
    it('returns spend log entries', async () => {
      const spendEntries = [
        {
          requestId: 'req-001',
          model: 'claude-3-opus',
          spend: 0.05,
          startTime: '2026-01-15T10:00:00Z',
          endTime: '2026-01-15T10:00:03Z',
        },
      ];
      vi.mocked(mockClient.getSpend).mockResolvedValueOnce(spendEntries);

      const response = await app.inject({
        method: 'GET',
        url: '/api/router/spend',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.entries).toEqual(spendEntries);
      expect(mockClient.getSpend).toHaveBeenCalled();
    });

    it('returns empty entries array when no spend data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/router/spend',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.entries).toEqual([]);
    });

    it('returns 502 when getSpend() throws ControlPlaneError', async () => {
      vi.mocked(mockClient.getSpend).mockRejectedValueOnce(
        new ControlPlaneError('LITELLM_CONNECTION_ERROR', 'LiteLLM connection timeout'),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/router/spend',
      });

      expect(response.statusCode).toBe(502);

      const body = response.json();
      expect(body.error).toBe('LITELLM_CONNECTION_ERROR');
      expect(body.message).toBe('LiteLLM connection timeout');
    });

    it('returns 500 when getSpend() throws non-ControlPlaneError', async () => {
      vi.mocked(mockClient.getSpend).mockRejectedValueOnce(new Error('db error'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/router/spend',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('SPEND_LOGS_FAILED');
      expect(body.message).toBe('Failed to fetch spend logs');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/router/models/:id/test
  // -------------------------------------------------------------------------

  describe('POST /api/router/models/:id/test', () => {
    it('tests a model and returns completion result', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/router/models/claude-sonnet-4-20250514/test',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.modelId).toBe('claude-sonnet-4-20250514');
      expect(body.responseModel).toBe('claude-sonnet-4-20250514');
      expect(body.usage).toEqual({
        promptTokens: 5,
        completionTokens: 1,
        totalTokens: 6,
      });
      expect(mockClient.testModel).toHaveBeenCalledWith('claude-sonnet-4-20250514');
    });

    it('passes URL-decoded model ID to testModel', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/router/models/anthropic%2Fclaude-3/test',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.modelId).toBe('anthropic/claude-3');
      expect(mockClient.testModel).toHaveBeenCalledWith('anthropic/claude-3');
    });

    it('returns 502 when testModel() throws ControlPlaneError', async () => {
      vi.mocked(mockClient.testModel).mockRejectedValueOnce(
        new ControlPlaneError('LITELLM_API_ERROR', 'Model test failed with 429'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/router/models/claude-3-opus/test',
      });

      expect(response.statusCode).toBe(502);

      const body = response.json();
      expect(body.error).toBe('LITELLM_API_ERROR');
      expect(body.message).toBe('Model test failed with 429');
      expect(body.modelId).toBe('claude-3-opus');
    });

    it('returns 500 when testModel() throws non-ControlPlaneError', async () => {
      vi.mocked(mockClient.testModel).mockRejectedValueOnce(new Error('runtime crash'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/router/models/gpt-4o/test',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('TEST_MODEL_FAILED');
      expect(body.message).toBe('Failed to test model');
      expect(body.modelId).toBe('gpt-4o');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling (general)
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('GET /api/router/health returns 500 when health() throws', async () => {
      vi.mocked(mockClient.health).mockRejectedValueOnce(new Error('connection refused'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/router/health',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.status).toBe('error');
    });

    it('GET /api/router/health returns 500 with ControlPlaneError message', async () => {
      vi.mocked(mockClient.health).mockRejectedValueOnce(
        new ControlPlaneError('LITELLM_CONNECTION_ERROR', 'Proxy crashed'),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/router/health',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.status).toBe('error');
      expect(body.message).toBe('Proxy crashed');
    });

    it('GET /api/router/health returns generic message for non-ControlPlaneError', async () => {
      vi.mocked(mockClient.health).mockRejectedValueOnce(new TypeError('undefined is not a fn'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/router/health',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.message).toBe('Unexpected error checking LiteLLM health');
    });

    it('GET /api/router/models returns 500 when listModels() throws non-ControlPlaneError', async () => {
      vi.mocked(mockClient.listModels).mockRejectedValueOnce(new Error('unexpected'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/router/models',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('LIST_MODELS_FAILED');
      expect(body.message).toBe('Failed to list models');
    });
  });
});
