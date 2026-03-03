// ---------------------------------------------------------------------------
// Session API — typed helpers for interacting with the control plane session
// endpoints. Designed to work alongside the existing ApiClient by accepting
// it as a dependency rather than modifying the original class.
// ---------------------------------------------------------------------------

import type { ApiClient } from './api-client.js';
import { MobileClientError } from './api-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStatus = 'active' | 'paused' | 'ended';

export type SessionInfo = {
  id: string;
  projectPath: string;
  status: SessionStatus;
  messageCount: number;
  lastActivity: string;
  model?: string;
  costUsd?: number;
};

export type SessionMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
};

export type SessionDetail = SessionInfo & {
  messages: SessionMessage[];
};

export type CreateSessionRequest = {
  projectPath?: string;
  model?: string;
  prompt?: string;
};

export type CreateSessionResponse = {
  ok: boolean;
  sessionId: string;
};

export type ResumeSessionResponse = {
  ok: boolean;
  sessionId: string;
};

export type SendMessageRequest = {
  message: string;
};

export type SendMessageResponse = {
  ok: boolean;
  sessionId: string;
  messageId?: string;
};

// ---------------------------------------------------------------------------
// Session API client
// ---------------------------------------------------------------------------

/**
 * Provides session-related API calls using an existing ApiClient instance.
 * This avoids modifying the core ApiClient class while keeping all session
 * HTTP logic in one place.
 *
 * Usage:
 * ```ts
 * const sessionApi = new SessionApi(apiClient);
 * const sessions = await sessionApi.listSessions();
 * ```
 */
export class SessionApi {
  private readonly apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  // -----------------------------------------------------------------------
  // Session CRUD
  // -----------------------------------------------------------------------

  /** GET /api/sessions — list all discovered Claude Code sessions. */
  async listSessions(): Promise<SessionInfo[]> {
    return this.request<SessionInfo[]>('GET', '/api/sessions');
  }

  /** GET /api/sessions/:id — get full session detail including messages. */
  async getSession(sessionId: string): Promise<SessionDetail> {
    if (!sessionId) {
      throw new MobileClientError('INVALID_SESSION_ID', 'sessionId must be a non-empty string');
    }

    return this.request<SessionDetail>('GET', `/api/sessions/${encodeURIComponent(sessionId)}`);
  }

  /** POST /api/sessions — start a new Claude Code session. */
  async createSession(params?: CreateSessionRequest): Promise<CreateSessionResponse> {
    return this.request<CreateSessionResponse>('POST', '/api/sessions', params ?? {});
  }

  /** POST /api/sessions/:id/resume — resume a paused session. */
  async resumeSession(sessionId: string): Promise<ResumeSessionResponse> {
    if (!sessionId) {
      throw new MobileClientError('INVALID_SESSION_ID', 'sessionId must be a non-empty string');
    }

    return this.request<ResumeSessionResponse>(
      'POST',
      `/api/sessions/${encodeURIComponent(sessionId)}/resume`,
    );
  }

  /** POST /api/sessions/:id/message — send a message to an active session. */
  async sendMessage(sessionId: string, message: string): Promise<SendMessageResponse> {
    if (!sessionId) {
      throw new MobileClientError('INVALID_SESSION_ID', 'sessionId must be a non-empty string');
    }

    if (!message.trim()) {
      throw new MobileClientError('INVALID_MESSAGE', 'message must be a non-empty string');
    }

    return this.request<SendMessageResponse>(
      'POST',
      `/api/sessions/${encodeURIComponent(sessionId)}/message`,
      { message } satisfies SendMessageRequest,
    );
  }

  // -----------------------------------------------------------------------
  // Internal — delegates to ApiClient's private `request` via fetch
  // -----------------------------------------------------------------------

  /**
   * We cannot call `apiClient.request()` directly because it is private.
   * Instead we replicate a minimal typed fetch that reuses the ApiClient's
   * baseUrl and authToken (exposed via the constructor config pattern).
   *
   * The ApiClient exposes `setAuthToken` but not a getter, so we rely on
   * the fact that SessionApi is constructed with the same ApiClient instance
   * that AppContext manages — meaning auth is already configured.
   *
   * This approach intentionally mirrors ApiClient.request() error handling.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // We access the apiClient through a cast to reach its private baseUrl
    // and authToken. This is acceptable because SessionApi is tightly
    // coupled to ApiClient by design.
    const client = this.apiClient as unknown as {
      baseUrl: string;
      authToken: string | undefined;
      timeoutMs: number;
    };

    const url = `${client.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (client.authToken) {
      headers.Authorization = `Bearer ${client.authToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), client.timeoutMs ?? 30_000);

    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new MobileClientError('REQUEST_TIMEOUT', `Request to ${method} ${path} timed out`, {
          timeoutMs: client.timeoutMs,
        });
      }

      const message = err instanceof Error ? err.message : String(err);
      throw new MobileClientError('NETWORK_ERROR', `Network error: ${message}`, {
        method,
        path,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let errorBody: Record<string, unknown> | null = null;

      try {
        errorBody = (await response.json()) as Record<string, unknown>;
      } catch {
        // Response body isn't JSON — ignore.
      }

      const errorCode =
        typeof errorBody?.code === 'string' ? errorBody.code : `HTTP_${response.status}`;
      const errorMessage =
        typeof errorBody?.error === 'string'
          ? errorBody.error
          : typeof errorBody?.message === 'string'
            ? (errorBody.message as string)
            : `HTTP ${response.status} ${response.statusText}`;

      throw new MobileClientError(errorCode, errorMessage, {
        status: response.status,
        statusText: response.statusText,
        body: errorBody,
        method,
        path,
      });
    }

    const data = (await response.json()) as T;
    return data;
  }
}
