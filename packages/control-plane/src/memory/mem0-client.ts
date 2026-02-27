import type { Logger } from 'pino';

import { ControlPlaneError } from '@agentctl/shared';

export type Mem0ClientOptions = {
  baseUrl: string;
  logger: Logger;
};

export type AddMemoryRequest = {
  messages: Array<{ role: string; content: string }>;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

export type SearchMemoryRequest = {
  query: string;
  userId?: string;
  agentId?: string;
  limit?: number;
};

export type MemoryEntry = {
  id: string;
  memory: string;
  userId: string | null;
  agentId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type MemoryListResponse = {
  results: MemoryEntry[];
};

const DEFAULT_TIMEOUT_MS = 10_000;

export class Mem0Client {
  private readonly baseUrl: string;
  private readonly logger: Logger;

  constructor(options: Mem0ClientOptions) {
    // Strip trailing slash for consistent URL construction
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.logger = options.logger;
  }

  async add(request: AddMemoryRequest): Promise<MemoryListResponse> {
    this.logger.debug({ userId: request.userId, agentId: request.agentId }, 'Adding memory');

    const body: Record<string, unknown> = {
      messages: request.messages,
    };
    if (request.userId !== undefined) body.user_id = request.userId;
    if (request.agentId !== undefined) body.agent_id = request.agentId;
    if (request.sessionId !== undefined) body.run_id = request.sessionId;
    if (request.metadata !== undefined) body.metadata = request.metadata;

    const response = await this.request<MemoryListResponse>('POST', '/v1/memories/', body);

    this.logger.info(
      { count: response.results.length, userId: request.userId, agentId: request.agentId },
      'Memories added',
    );

    return response;
  }

  async search(request: SearchMemoryRequest): Promise<MemoryListResponse> {
    this.logger.debug({ query: request.query, agentId: request.agentId }, 'Searching memories');

    const body: Record<string, unknown> = {
      query: request.query,
    };
    if (request.userId !== undefined) body.user_id = request.userId;
    if (request.agentId !== undefined) body.agent_id = request.agentId;
    if (request.limit !== undefined) body.limit = request.limit;

    return this.request<MemoryListResponse>('POST', '/v1/memories/search/', body);
  }

  async getAll(userId?: string, agentId?: string): Promise<MemoryListResponse> {
    const params = new URLSearchParams();
    if (userId !== undefined) params.set('user_id', userId);
    if (agentId !== undefined) params.set('agent_id', agentId);

    const query = params.toString();
    const path = query ? `/v1/memories/?${query}` : '/v1/memories/';

    return this.request<MemoryListResponse>('GET', path);
  }

  async get(memoryId: string): Promise<MemoryEntry> {
    return this.request<MemoryEntry>('GET', `/v1/memories/${encodeURIComponent(memoryId)}/`);
  }

  async delete(memoryId: string): Promise<void> {
    this.logger.info({ memoryId }, 'Deleting memory');
    await this.request<Record<string, unknown>>(
      'DELETE',
      `/v1/memories/${encodeURIComponent(memoryId)}/`,
    );
  }

  async deleteAll(userId?: string, agentId?: string): Promise<void> {
    this.logger.warn({ userId, agentId }, 'Deleting all memories');

    const body: Record<string, unknown> = {};
    if (userId !== undefined) body.user_id = userId;
    if (agentId !== undefined) body.agent_id = agentId;

    await this.request<Record<string, unknown>>('DELETE', '/v1/memories/', body);
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      return response.ok;
    } catch (error: unknown) {
      this.logger.warn({ err: error }, 'Mem0 health check failed');
      return false;
    }
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
      throw new ControlPlaneError('MEM0_CONNECTION_ERROR', `Failed to connect to Mem0: ${message}`, {
        url,
        method,
      });
    }

    if (!response.ok) {
      let errorBody: string;
      try {
        errorBody = await response.text();
      } catch {
        errorBody = '<unreadable>';
      }

      throw new ControlPlaneError(
        'MEM0_API_ERROR',
        `Mem0 API returned ${response.status}: ${errorBody}`,
        {
          url,
          method,
          status: response.status,
        },
      );
    }

    // DELETE operations may return empty body
    const text = await response.text();
    if (!text) {
      return {} as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ControlPlaneError(
        'MEM0_PARSE_ERROR',
        'Failed to parse Mem0 API response as JSON',
        { url, method, responseText: text.slice(0, 200) },
      );
    }
  }
}
