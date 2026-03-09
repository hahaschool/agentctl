// ---------------------------------------------------------------------------
// RuntimeSessionPresenter — business logic for managed Claude Code / Codex
// runtime sessions. Handles listing sessions, selecting a session, loading
// handoff history, creating sessions, and triggering handoffs.
// ---------------------------------------------------------------------------

import type { Machine } from '@agentctl/shared';

import type { ApiClient } from '../services/api-client.js';
import { MobileClientError } from '../services/api-client.js';
import type {
  RuntimeSessionHandoff,
  RuntimeSessionHandoffResponse,
  RuntimeSessionInfo,
  RuntimeSessionListResponse,
} from '../services/runtime-session-api.js';
import { RuntimeSessionApi } from '../services/runtime-session-api.js';

export type RuntimeSessionScreenState = {
  sessions: RuntimeSessionInfo[];
  machines: Machine[];
  selectedSession: RuntimeSessionInfo | null;
  handoffs: RuntimeSessionHandoff[];
  isLoading: boolean;
  isHandoffsLoading: boolean;
  error: MobileClientError | null;
  lastUpdated: Date | null;
};

export type RuntimeSessionPresenterConfig = {
  apiClient: ApiClient;
  pollIntervalMs?: number;
  onChange?: (state: RuntimeSessionScreenState) => void;
};

const DEFAULT_POLL_INTERVAL_MS = 30_000;

export class RuntimeSessionPresenter {
  private readonly runtimeSessionApi: RuntimeSessionApi;
  private readonly apiClient: ApiClient;
  private readonly pollIntervalMs: number;
  private readonly onChange?: (state: RuntimeSessionScreenState) => void;

  private state: RuntimeSessionScreenState = {
    sessions: [],
    machines: [],
    selectedSession: null,
    handoffs: [],
    isLoading: false,
    isHandoffsLoading: false,
    error: null,
    lastUpdated: null,
  };

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RuntimeSessionPresenterConfig) {
    this.apiClient = config.apiClient;
    this.runtimeSessionApi = new RuntimeSessionApi(config.apiClient);
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onChange = config.onChange;
  }

  start(): void {
    this.stop();
    void this.loadSessions();
    this.pollTimer = setInterval(() => {
      void this.loadSessions();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async loadSessions(): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      const [result, machines]: [RuntimeSessionListResponse, Machine[]] = await Promise.all([
        this.runtimeSessionApi.listSessions({ limit: 100 }),
        this.apiClient.listMachines(),
      ]);
      const selectedSessionId = this.state.selectedSession?.id;
      const selectedSession = result.sessions.find((session) => session.id === selectedSessionId) ?? null;
      this.setState({
        sessions: result.sessions,
        machines,
        selectedSession,
        isLoading: false,
        lastUpdated: new Date(),
      });

      if (selectedSessionId) {
        await this.loadHandoffs(selectedSessionId);
      }
    } catch (err: unknown) {
      this.setState({
        isLoading: false,
        error:
          err instanceof MobileClientError
            ? err
            : new MobileClientError(
                'RUNTIME_SESSIONS_LOAD_FAILED',
                err instanceof Error ? err.message : String(err),
              ),
      });
    }
  }

  async selectSession(session: RuntimeSessionInfo): Promise<void> {
    this.setState({ selectedSession: session, handoffs: [] });
    await this.loadHandoffs(session.id);
  }

  clearSelectedSession(): void {
    this.setState({ selectedSession: null, handoffs: [] });
  }

  async loadHandoffs(sessionId: string): Promise<void> {
    if (!sessionId) return;
    this.setState({ isHandoffsLoading: true, error: null });

    try {
      const result = await this.runtimeSessionApi.listHandoffs(sessionId, 20);
      this.setState({ handoffs: result.handoffs, isHandoffsLoading: false });
    } catch (err: unknown) {
      this.setState({
        isHandoffsLoading: false,
        error:
          err instanceof MobileClientError
            ? err
            : new MobileClientError(
                'RUNTIME_HANDOFFS_LOAD_FAILED',
                err instanceof Error ? err.message : String(err),
              ),
      });
    }
  }

  async createSession(params: {
    runtime: RuntimeSessionInfo['runtime'];
    machineId: string;
    projectPath: string;
    prompt: string;
    model?: string;
  }): Promise<RuntimeSessionInfo> {
    const response = await this.runtimeSessionApi.createSession(params);
    await this.loadSessions();
    return response.session;
  }

  async resumeSession(params: {
    sessionId: string;
    prompt: string;
    model?: string;
  }): Promise<RuntimeSessionInfo> {
    const response = await this.runtimeSessionApi.resumeSession(params.sessionId, {
      prompt: params.prompt,
      ...(params.model?.trim() ? { model: params.model.trim() } : {}),
    });
    await this.loadSessions();
    await this.selectSession(response.session);
    return response.session;
  }

  async forkSession(params: {
    sessionId: string;
    prompt?: string;
    model?: string;
    targetMachineId?: string;
  }): Promise<RuntimeSessionInfo> {
    const response = await this.runtimeSessionApi.forkSession(params.sessionId, {
      ...(params.prompt?.trim() ? { prompt: params.prompt.trim() } : {}),
      ...(params.model?.trim() ? { model: params.model.trim() } : {}),
      ...(params.targetMachineId?.trim()
        ? { targetMachineId: params.targetMachineId.trim() }
        : {}),
    });
    await this.loadSessions();
    await this.selectSession(response.session);
    return response.session;
  }

  async handoffSession(params: {
    sessionId: string;
    targetRuntime: RuntimeSessionInfo['runtime'];
    prompt?: string;
  }): Promise<RuntimeSessionHandoffResponse> {
    const response = await this.runtimeSessionApi.handoffSession(params.sessionId, {
      targetRuntime: params.targetRuntime,
      reason: 'manual',
      ...(params.prompt?.trim() ? { prompt: params.prompt.trim() } : {}),
    });
    await this.loadSessions();
    await this.selectSession(response.session);
    return response;
  }

  getState(): RuntimeSessionScreenState {
    return {
      ...this.state,
      sessions: [...this.state.sessions],
      machines: [...this.state.machines],
      selectedSession: this.state.selectedSession ? { ...this.state.selectedSession } : null,
      handoffs: [...this.state.handoffs],
    };
  }

  get isPolling(): boolean {
    return this.pollTimer !== null;
  }

  private setState(partial: Partial<RuntimeSessionScreenState>): void {
    this.state = { ...this.state, ...partial };
    this.onChange?.(this.getState());
  }
}
