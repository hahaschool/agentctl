import { ControlPlaneError } from '@agentctl/shared';
import type { Logger } from 'pino';

const DEFAULT_TIMEOUT_MS = 30_000;

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
};

export class EmbeddingClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly logger: Logger;
  private readonly timeoutMs: number;

  constructor(options: EmbeddingClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
}
