import { ControlPlaneError } from '@agentctl/shared';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiteLLMClient, ModelDeploymentInfo } from './litellm-client.js';
import { RouterConfig } from './router-config.js';

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
} as unknown as Logger;

const SAMPLE_DEPLOYMENTS: ModelDeploymentInfo[] = [
  {
    modelName: 'claude-3-opus',
    litellmParams: { model: 'claude-3-opus-20240229' },
    modelInfo: { maxTokens: 4096 },
  },
  {
    modelName: 'claude-3-sonnet',
    litellmParams: { model: 'claude-3-sonnet-20240229' },
    modelInfo: { maxTokens: 4096 },
  },
];

const SAMPLE_MODEL_IDS = ['claude-3-opus', 'claude-3-sonnet', 'gpt-4'];

function createMockLiteLLMClient(
  overrides: Partial<LiteLLMClient> = {},
): LiteLLMClient {
  return {
    health: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue(SAMPLE_MODEL_IDS),
    getModelInfo: vi.fn().mockResolvedValue(SAMPLE_DEPLOYMENTS),
    testModel: vi.fn(),
    getSpend: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as LiteLLMClient;
}

describe('RouterConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Constructor defaults
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    it('defaults routingStrategy to "usage-based-routing"', () => {
      const client = createMockLiteLLMClient();
      const config = new RouterConfig({ litellmClient: client, logger });

      expect(config.getRoutingStrategy()).toBe('usage-based-routing');
    });

    it('defaults fallbackModels to an empty array', () => {
      const client = createMockLiteLLMClient();
      const config = new RouterConfig({ litellmClient: client, logger });

      expect(config.getFallbackModels()).toEqual([]);
    });

    it('accepts custom routingStrategy', () => {
      const client = createMockLiteLLMClient();
      const config = new RouterConfig({
        litellmClient: client,
        routingStrategy: 'latency-based-routing',
        logger,
      });

      expect(config.getRoutingStrategy()).toBe('latency-based-routing');
    });

    it('accepts custom fallbackModels', () => {
      const client = createMockLiteLLMClient();
      const config = new RouterConfig({
        litellmClient: client,
        fallbackModels: ['claude-3-opus', 'gpt-4'],
        logger,
      });

      const fallbacks = config.getFallbackModels();
      expect(fallbacks).toHaveLength(2);
      expect(fallbacks[0]).toEqual({ modelName: 'claude-3-opus', priority: 0 });
      expect(fallbacks[1]).toEqual({ modelName: 'gpt-4', priority: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  // getRoutingStrategy()
  // ---------------------------------------------------------------------------

  describe('getRoutingStrategy()', () => {
    it('returns "usage-based-routing" by default', () => {
      const config = new RouterConfig({
        litellmClient: createMockLiteLLMClient(),
        logger,
      });

      expect(config.getRoutingStrategy()).toBe('usage-based-routing');
    });

    it('returns "least-busy" when configured', () => {
      const config = new RouterConfig({
        litellmClient: createMockLiteLLMClient(),
        routingStrategy: 'least-busy',
        logger,
      });

      expect(config.getRoutingStrategy()).toBe('least-busy');
    });

    it('returns "simple-shuffle" when configured', () => {
      const config = new RouterConfig({
        litellmClient: createMockLiteLLMClient(),
        routingStrategy: 'simple-shuffle',
        logger,
      });

      expect(config.getRoutingStrategy()).toBe('simple-shuffle');
    });
  });

  // ---------------------------------------------------------------------------
  // getFallbackModels()
  // ---------------------------------------------------------------------------

  describe('getFallbackModels()', () => {
    it('returns empty array when no fallbacks are configured', () => {
      const config = new RouterConfig({
        litellmClient: createMockLiteLLMClient(),
        logger,
      });

      expect(config.getFallbackModels()).toEqual([]);
    });

    it('maps model names to FallbackEntry objects with incrementing priority', () => {
      const config = new RouterConfig({
        litellmClient: createMockLiteLLMClient(),
        fallbackModels: ['model-a', 'model-b', 'model-c'],
        logger,
      });

      const result = config.getFallbackModels();

      expect(result).toEqual([
        { modelName: 'model-a', priority: 0 },
        { modelName: 'model-b', priority: 1 },
        { modelName: 'model-c', priority: 2 },
      ]);
    });

    it('handles a single fallback model', () => {
      const config = new RouterConfig({
        litellmClient: createMockLiteLLMClient(),
        fallbackModels: ['only-model'],
        logger,
      });

      const result = config.getFallbackModels();

      expect(result).toEqual([{ modelName: 'only-model', priority: 0 }]);
    });
  });

  // ---------------------------------------------------------------------------
  // getActiveModels()
  // ---------------------------------------------------------------------------

  describe('getActiveModels()', () => {
    it('returns deployment info from litellmClient.getModelInfo()', async () => {
      const client = createMockLiteLLMClient();
      const config = new RouterConfig({ litellmClient: client, logger });

      const result = await config.getActiveModels();

      expect(result).toEqual(SAMPLE_DEPLOYMENTS);
      expect(client.getModelInfo).toHaveBeenCalledOnce();
    });

    it('logs debug and info messages on success', async () => {
      const client = createMockLiteLLMClient();
      const config = new RouterConfig({ litellmClient: client, logger });

      await config.getActiveModels();

      expect(logger.debug).toHaveBeenCalledWith('Fetching active model deployments');
      expect(logger.info).toHaveBeenCalledWith(
        { deploymentCount: SAMPLE_DEPLOYMENTS.length },
        'Active model deployments retrieved',
      );
    });

    it('returns empty array when no deployments exist', async () => {
      const client = createMockLiteLLMClient({
        getModelInfo: vi.fn().mockResolvedValue([]),
      });
      const config = new RouterConfig({ litellmClient: client, logger });

      const result = await config.getActiveModels();

      expect(result).toEqual([]);
    });

    it('throws and logs error when litellmClient throws ControlPlaneError', async () => {
      const error = new ControlPlaneError(
        'LITELLM_CONNECTION_ERROR',
        'Failed to connect to LiteLLM proxy: ECONNREFUSED',
        { url: 'http://localhost:4000/model/info', method: 'GET' },
      );
      const client = createMockLiteLLMClient({
        getModelInfo: vi.fn().mockRejectedValue(error),
      });
      const config = new RouterConfig({ litellmClient: client, logger });

      await expect(config.getActiveModels()).rejects.toThrow(ControlPlaneError);
      await expect(config.getActiveModels()).rejects.toThrow('Failed to connect');

      expect(logger.error).toHaveBeenCalledWith(
        { code: 'LITELLM_CONNECTION_ERROR', err: error },
        'Failed to fetch active model deployments',
      );
    });

    it('rethrows non-ControlPlaneError without logging to error', async () => {
      const unexpectedError = new Error('unexpected failure');
      const client = createMockLiteLLMClient({
        getModelInfo: vi.fn().mockRejectedValue(unexpectedError),
      });
      const config = new RouterConfig({ litellmClient: client, logger });

      await expect(config.getActiveModels()).rejects.toThrow('unexpected failure');

      // logger.error should NOT have been called because it's not a ControlPlaneError
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // isModelAvailable()
  // ---------------------------------------------------------------------------

  describe('isModelAvailable()', () => {
    it('returns true when model is in the list', async () => {
      const client = createMockLiteLLMClient();
      const config = new RouterConfig({ litellmClient: client, logger });

      const result = await config.isModelAvailable('claude-3-opus');

      expect(result).toBe(true);
      expect(client.listModels).toHaveBeenCalledOnce();
    });

    it('returns false when model is not in the list', async () => {
      const client = createMockLiteLLMClient();
      const config = new RouterConfig({ litellmClient: client, logger });

      const result = await config.isModelAvailable('nonexistent-model');

      expect(result).toBe(false);
    });

    it('logs debug and info messages on success', async () => {
      const client = createMockLiteLLMClient();
      const config = new RouterConfig({ litellmClient: client, logger });

      await config.isModelAvailable('gpt-4');

      expect(logger.debug).toHaveBeenCalledWith({ modelId: 'gpt-4' }, 'Checking model availability');
      expect(logger.info).toHaveBeenCalledWith(
        { modelId: 'gpt-4', available: true },
        'Model availability checked',
      );
    });

    it('returns false and logs warning when litellmClient throws ControlPlaneError', async () => {
      const error = new ControlPlaneError(
        'LITELLM_CONNECTION_ERROR',
        'Failed to connect to LiteLLM proxy: ECONNREFUSED',
        {},
      );
      const client = createMockLiteLLMClient({
        listModels: vi.fn().mockRejectedValue(error),
      });
      const config = new RouterConfig({ litellmClient: client, logger });

      const result = await config.isModelAvailable('claude-3-opus');

      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        { modelId: 'claude-3-opus', code: 'LITELLM_CONNECTION_ERROR', err: error },
        'Failed to check model availability — treating as unavailable',
      );
    });

    it('rethrows non-ControlPlaneError', async () => {
      const unexpectedError = new TypeError('cannot read properties');
      const client = createMockLiteLLMClient({
        listModels: vi.fn().mockRejectedValue(unexpectedError),
      });
      const config = new RouterConfig({ litellmClient: client, logger });

      await expect(config.isModelAvailable('claude-3-opus')).rejects.toThrow(TypeError);
      await expect(config.isModelAvailable('claude-3-opus')).rejects.toThrow(
        'cannot read properties',
      );
    });

    it('returns false when model list is empty', async () => {
      const client = createMockLiteLLMClient({
        listModels: vi.fn().mockResolvedValue([]),
      });
      const config = new RouterConfig({ litellmClient: client, logger });

      const result = await config.isModelAvailable('any-model');

      expect(result).toBe(false);
    });
  });
});
