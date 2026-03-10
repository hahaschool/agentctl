// ---------------------------------------------------------------------------
// Session API — typed helpers for interacting with the control plane session
// endpoints. Designed to work alongside the existing ApiClient by accepting
// it as a dependency rather than modifying the original class.
// ---------------------------------------------------------------------------

import type { ApiClient } from './api-client.js';
import { MobileClientError } from './api-client.js';
import { requestWithApiClient } from './request-with-api-client.js';

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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return requestWithApiClient<T>(this.apiClient, method, path, body);
  }
}
