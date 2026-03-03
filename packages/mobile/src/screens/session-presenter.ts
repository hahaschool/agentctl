// ---------------------------------------------------------------------------
// Session screen presenter — framework-agnostic business logic for browsing
// and controlling Claude Code sessions. Handles listing sessions, viewing
// detail, creating new sessions, resuming, and sending messages.
// ---------------------------------------------------------------------------

import type { ApiClient } from '../services/api-client.js';
import { MobileClientError } from '../services/api-client.js';
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  ResumeSessionResponse,
  SendMessageResponse,
  SessionDetail,
  SessionInfo,
} from '../services/session-api.js';
import { SessionApi } from '../services/session-api.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionScreenState = {
  sessions: SessionInfo[];
  selectedSession: SessionDetail | null;
  isLoading: boolean;
  isDetailLoading: boolean;
  error: MobileClientError | null;
  lastUpdated: Date | null;
};

export type SessionPresenterConfig = {
  /** The API client instance for HTTP calls. */
  apiClient: ApiClient;
  /** Polling interval in milliseconds (default: 30 000). */
  pollIntervalMs?: number;
  /** Callback invoked whenever state changes. */
  onChange?: (state: SessionScreenState) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------------

export class SessionPresenter {
  private readonly sessionApi: SessionApi;
  private readonly pollIntervalMs: number;
  private onChange: ((state: SessionScreenState) => void) | undefined;

  private state: SessionScreenState = {
    sessions: [],
    selectedSession: null,
    isLoading: false,
    isDetailLoading: false,
    error: null,
    lastUpdated: null,
  };

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SessionPresenterConfig) {
    this.sessionApi = new SessionApi(config.apiClient);
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onChange = config.onChange;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Start auto-refresh polling. Also triggers an immediate refresh. */
  start(): void {
    this.stop();
    void this.loadSessions();
    this.pollTimer = setInterval(() => {
      void this.loadSessions();
    }, this.pollIntervalMs);
  }

  /** Stop auto-refresh polling. */
  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Fetch the list of all sessions. */
  async loadSessions(): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      const sessions = await this.sessionApi.listSessions();
      this.setState({
        sessions,
        isLoading: false,
        lastUpdated: new Date(),
      });
    } catch (err: unknown) {
      const error =
        err instanceof MobileClientError
          ? err
          : new MobileClientError(
              'SESSION_LOAD_FAILED',
              err instanceof Error ? err.message : String(err),
            );
      this.setState({ isLoading: false, error });
    }
  }

  /** Load full session detail including message transcript. */
  async loadSessionDetail(sessionId: string): Promise<void> {
    this.setState({ isDetailLoading: true, error: null });

    try {
      const detail = await this.sessionApi.getSession(sessionId);
      this.setState({
        selectedSession: detail,
        isDetailLoading: false,
      });
    } catch (err: unknown) {
      const error =
        err instanceof MobileClientError
          ? err
          : new MobileClientError(
              'SESSION_DETAIL_FAILED',
              err instanceof Error ? err.message : String(err),
            );
      this.setState({ isDetailLoading: false, error });
    }
  }

  /** Clear the currently selected session detail. */
  clearSelectedSession(): void {
    this.setState({ selectedSession: null });
  }

  /** Create a new Claude Code session. */
  async createSession(params?: CreateSessionRequest): Promise<CreateSessionResponse> {
    const response = await this.sessionApi.createSession(params);
    await this.loadSessions();
    return response;
  }

  /** Resume a paused session. */
  async resumeSession(sessionId: string): Promise<ResumeSessionResponse> {
    if (!sessionId) {
      throw new MobileClientError('INVALID_SESSION_ID', 'sessionId must be a non-empty string');
    }

    const response = await this.sessionApi.resumeSession(sessionId);
    await this.loadSessions();
    return response;
  }

  /** Send a message to an active session. */
  async sendMessage(sessionId: string, message: string): Promise<SendMessageResponse> {
    if (!sessionId) {
      throw new MobileClientError('INVALID_SESSION_ID', 'sessionId must be a non-empty string');
    }

    if (!message.trim()) {
      throw new MobileClientError('INVALID_MESSAGE', 'message must be a non-empty string');
    }

    const response = await this.sessionApi.sendMessage(sessionId, message);

    // Reload detail to reflect the new message
    await this.loadSessionDetail(sessionId);
    return response;
  }

  /** Returns a shallow copy of the current state (immutable access). */
  getState(): SessionScreenState {
    return {
      ...this.state,
      sessions: [...this.state.sessions],
      selectedSession: this.state.selectedSession
        ? {
            ...this.state.selectedSession,
            messages: [...this.state.selectedSession.messages],
          }
        : null,
    };
  }

  /** Whether the presenter is currently auto-refreshing. */
  get isPolling(): boolean {
    return this.pollTimer !== null;
  }

  // -----------------------------------------------------------------------
  // Internal — state management
  // -----------------------------------------------------------------------

  private setState(partial: Partial<SessionScreenState>): void {
    this.state = { ...this.state, ...partial };
    this.onChange?.(this.getState());
  }
}
