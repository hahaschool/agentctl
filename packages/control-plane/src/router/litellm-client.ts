import { ControlPlaneError } from '@agentctl/shared';
import type { Logger } from 'pino';

export type LiteLLMClientOptions = {
  baseUrl: string;
  logger: Logger;
};

export type ModelInfo = {
  id: string;
  object: string;
};

export type ModelListResponse = {
  object: string;
  data: ModelInfo[];
};

export type ModelDeploymentInfo = {
  modelName: string;
  litellmParams: Record<string, unknown>;
  modelInfo: Record<string, unknown>;
};

export type ModelInfoResponse = {
  data: ModelDeploymentInfo[];
};

export type SpendLogEntry = {
  requestId: string;
  model: string;
  spend: number;
  startTime: string;
  endTime: string;
};

export type ChatCompletionResponse = {
  id: string;
  object: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finishReason: string | null;
  }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

const DEFAULT_TIMEOUT_MS = 10_000;

export class LiteLLMClient {
  private readonly baseUrl: string;
  private readonly logger: Logger;

  constructor(options: LiteLLMClientOptions) {
    // Strip trailing slash for consistent URL construction
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.logger = options.logger;
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      return response.ok;
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'LiteLLM health check failed');
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    this.logger.debug('Listing available models');

    const response = await this.request<ModelListResponse>('GET', '/v1/models');
    const modelIds = response.data.map((model) => model.id);

    this.logger.info({ modelCount: modelIds.length }, 'Models listed');
    return modelIds;
  }

  async getModelInfo(): Promise<ModelDeploymentInfo[]> {
    this.logger.debug('Fetching model deployment info');

    const response = await this.request<ModelInfoResponse>('GET', '/model/info');

    this.logger.info({ deploymentCount: response.data.length }, 'Model info retrieved');
    return response.data;
  }

  async testModel(modelId: string): Promise<ChatCompletionResponse> {
    this.logger.info({ modelId }, 'Testing model with a tiny completion');

    const body = {
      model: modelId,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    };

    const response = await this.request<ChatCompletionResponse>(
      'POST',
      '/v1/chat/completions',
      body,
    );

    this.logger.info(
      {
        modelId,
        responseModel: response.model,
        totalTokens: response.usage.totalTokens,
      },
      'Model test completed',
    );

    return response;
  }

  async getSpend(): Promise<SpendLogEntry[]> {
    this.logger.debug('Fetching spend logs');

    const response = await this.request<SpendLogEntry[]>('GET', '/spend/logs');

    this.logger.info({ entryCount: response.length }, 'Spend logs retrieved');
    return response;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    };

    if (body !== undefined && method !== 'GET') {
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ControlPlaneError(
        'LITELLM_CONNECTION_ERROR',
        `Failed to connect to LiteLLM proxy: ${message}`,
        {
          url,
          method,
        },
      );
    }

    if (!response.ok) {
      let errorBody: string;
      try {
        errorBody = await response.text();
      } catch {
        errorBody = '<unreadable>';
      }

      throw new ControlPlaneError(
        'LITELLM_API_ERROR',
        `LiteLLM API returned ${response.status}: ${errorBody}`,
        {
          url,
          method,
          status: response.status,
        },
      );
    }

    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ControlPlaneError(
        'LITELLM_PARSE_ERROR',
        'Failed to parse LiteLLM API response as JSON',
        { url, method, responseText: text.slice(0, 200) },
      );
    }
  }
}
