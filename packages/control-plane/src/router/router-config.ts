import type { Logger } from 'pino';

import { ControlPlaneError } from '@agentctl/shared';

import type { LiteLLMClient, ModelDeploymentInfo } from './litellm-client.js';

export type RoutingStrategy =
  | 'usage-based-routing'
  | 'latency-based-routing'
  | 'least-busy'
  | 'simple-shuffle';

export type FallbackEntry = {
  modelName: string;
  priority: number;
};

export type RouterConfigOptions = {
  litellmClient: LiteLLMClient;
  routingStrategy?: RoutingStrategy;
  fallbackModels?: string[];
  logger: Logger;
};

export class RouterConfig {
  private readonly litellmClient: LiteLLMClient;
  private readonly routingStrategy: RoutingStrategy;
  private readonly fallbackModels: string[];
  private readonly logger: Logger;

  constructor(options: RouterConfigOptions) {
    this.litellmClient = options.litellmClient;
    this.routingStrategy = options.routingStrategy ?? 'usage-based-routing';
    this.fallbackModels = options.fallbackModels ?? [];
    this.logger = options.logger;
  }

  async getActiveModels(): Promise<ModelDeploymentInfo[]> {
    this.logger.debug('Fetching active model deployments');

    try {
      const deployments = await this.litellmClient.getModelInfo();

      this.logger.info(
        { deploymentCount: deployments.length },
        'Active model deployments retrieved',
      );

      return deployments;
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        this.logger.error(
          { code: error.code, err: error },
          'Failed to fetch active model deployments',
        );
      }
      throw error;
    }
  }

  getRoutingStrategy(): RoutingStrategy {
    return this.routingStrategy;
  }

  getFallbackModels(): FallbackEntry[] {
    return this.fallbackModels.map((modelName, index) => ({
      modelName,
      priority: index,
    }));
  }

  async isModelAvailable(modelId: string): Promise<boolean> {
    this.logger.debug({ modelId }, 'Checking model availability');

    try {
      const models = await this.litellmClient.listModels();
      const available = models.includes(modelId);

      this.logger.info(
        { modelId, available },
        'Model availability checked',
      );

      return available;
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        this.logger.warn(
          { modelId, code: error.code, err: error },
          'Failed to check model availability — treating as unavailable',
        );
        return false;
      }
      throw error;
    }
  }
}
