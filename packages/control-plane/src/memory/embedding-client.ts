import { ControlPlaneError } from '@agentctl/shared';
import type { Logger } from 'pino';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_RETRY_DELAY_MS = 500;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

type EmbeddingApiResponse = {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

export type EmbeddingClientOptions = {
  baseUrl: string;
  model: string;
  logger: Logger;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

export class EmbeddingClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;

  constructor(options: EmbeddingClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? DEFAULT_BASE_RETRY_DELAY_MS);
    this.sleep = options.sleep ?? defaultSleep;
  }

  async embed(text: string): Promise<number[]> {
    const [embedding] = await this.embedBatch([text]);
    if (!embedding) {
      throw new ControlPlaneError(
        'EMBEDDING_EMPTY_RESPONSE',
        'Embedding API returned no embedding for single-text request',
        { model: this.model },
      );
    }

    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/v1/embeddings`;
    const input = texts.length === 1 ? texts[0] : texts;

    this.logger.debug({ count: texts.length, model: this.model }, 'Generating embeddings');

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            input,
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error: unknown) {
        if (attempt < this.maxAttempts) {
          await this.retry(attempt, 'connection_error', texts.length);
          continue;
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new ControlPlaneError(
          'EMBEDDING_CONNECTION_ERROR',
          `Failed to connect to embedding API: ${message}`,
          { url, model: this.model },
        );
      }

      if (!response.ok) {
        let errorBody = '<unreadable>';
        try {
          errorBody = await response.text();
        } catch {
          // Ignore body read failure and preserve placeholder.
        }

        if (attempt < this.maxAttempts && RETRYABLE_STATUS_CODES.has(response.status)) {
          await this.retry(attempt, `status_${response.status}`, texts.length, response.status);
          continue;
        }

        throw new ControlPlaneError(
          'EMBEDDING_API_ERROR',
          `Embedding API returned ${response.status}: ${errorBody}`,
          { url, model: this.model, status: response.status },
        );
      }

      const result = (await response.json()) as EmbeddingApiResponse;
      const embeddings = [...result.data]
        .sort((left, right) => left.index - right.index)
        .map((entry) => entry.embedding);

      this.logger.debug(
        {
          count: embeddings.length,
          model: result.model,
          totalTokens: result.usage?.total_tokens ?? null,
        },
        'Embeddings generated',
      );

      return embeddings;
    }

    throw new ControlPlaneError(
      'EMBEDDING_API_ERROR',
      'Embedding API retry loop exited unexpectedly',
      { url, model: this.model },
    );
  }

  private async retry(
    attempt: number,
    reason: string,
    count: number,
    status: number | null = null,
  ): Promise<void> {
    const delayMs = this.retryBaseDelayMs * 2 ** (attempt - 1);
    this.logger.warn(
      {
        attempt,
        maxAttempts: this.maxAttempts,
        delayMs,
        reason,
        status,
        count,
        model: this.model,
      },
      'Retrying embedding request after transient failure',
    );
    await this.sleep(delayMs);
  }
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
