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
  });

  // -------------------------------------------------------------------------
  // Error handling
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

    it('GET /api/router/models returns 500 when listModels() throws non-ControlPlaneError', async () => {
      vi.mocked(mockClient.listModels).mockRejectedValueOnce(new Error('unexpected'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/router/models',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('Failed to list models');
    });
  });
});
