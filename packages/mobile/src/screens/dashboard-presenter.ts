// ---------------------------------------------------------------------------
// Dashboard screen presenter — framework-agnostic business logic for the
// fleet overview screen. Fetches health, machines, agents, and managed
// runtime sessions, computes aggregate stats, and supports auto-refresh polling.
// ---------------------------------------------------------------------------

import type { Agent, AgentStatus, HandoffAnalyticsSummary, Machine } from '@agentctl/shared';

import type {
  ApiClient,
  HealthResponse,
  RuntimeHandoffSummaryResponse,
  RuntimeSessionInfo,
} from '../services/api-client.js';
import { MobileClientError } from '../services/api-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DashboardStats = {
  totalAgents: number;
  running: number;
  idle: number;
  error: number;
  totalMachines: number;
  onlineMachines: number;
  totalManagedRuntimes: number;
  activeManagedRuntimes: number;
  switchingManagedRuntimes: number;
  totalRuntimeHandoffs: number;
  runtimeNativeImportSuccesses: number;
  runtimeFallbacks: number;
};

export type DashboardState = {
  health: HealthResponse | null;
  machines: Machine[];
  agents: Agent[];
  runtimeSessions: RuntimeSessionInfo[];
  runtimeHandoffSummary: RuntimeHandoffSummaryResponse | null;
  stats: DashboardStats;
  isLoading: boolean;
  error: MobileClientError | null;
  lastUpdated: Date | null;
};

export type DashboardPresenterConfig = {
  /** The API client instance to use for requests. */
  apiClient: ApiClient;
  /** Polling interval in milliseconds (default: 15 000). */
  pollIntervalMs?: number;
  /** Callback invoked whenever state changes. */
  onChange?: (state: DashboardState) => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 15_000;

const RUNNING_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  'running',
  'starting',
  'restarting',
]);

const ERROR_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>(['error', 'timeout']);

const EMPTY_STATS: DashboardStats = {
  totalAgents: 0,
  running: 0,
  idle: 0,
  error: 0,
  totalMachines: 0,
  onlineMachines: 0,
  totalManagedRuntimes: 0,
  activeManagedRuntimes: 0,
  switchingManagedRuntimes: 0,
  totalRuntimeHandoffs: 0,
  runtimeNativeImportSuccesses: 0,
  runtimeFallbacks: 0,
};

const EMPTY_HANDOFF_SUMMARY: HandoffAnalyticsSummary = {
  total: 0,
  succeeded: 0,
  failed: 0,
  pending: 0,
  nativeImportSuccesses: 0,
  nativeImportFallbacks: 0,
};

// ---------------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------------

export class DashboardPresenter {
  private readonly apiClient: ApiClient;
  private readonly pollIntervalMs: number;
  private onChange: ((state: DashboardState) => void) | undefined;

  private state: DashboardState = {
    health: null,
    machines: [],
    agents: [],
    runtimeSessions: [],
    runtimeHandoffSummary: null,
    stats: { ...EMPTY_STATS },
    isLoading: false,
    error: null,
    lastUpdated: null,
  };

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: DashboardPresenterConfig) {
    this.apiClient = config.apiClient;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onChange = config.onChange;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Start auto-refresh polling. Also triggers an immediate refresh. */
  start(): void {
    this.stop();
    void this.refresh();
    this.pollTimer = setInterval(() => {
      void this.refresh();
    }, this.pollIntervalMs);
  }

  /** Stop auto-refresh polling. */
  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Manually trigger a refresh of all dashboard data. */
  async refresh(): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      const [health, machines, agents, runtimeSessions, runtimeHandoffSummary] = await Promise.all([
        this.apiClient.health(true),
        this.apiClient.listMachines(),
        this.apiClient.listAgents(),
        this.apiClient.listRuntimeSessions({ limit: 100 }),
        this.apiClient.getRuntimeHandoffSummary(100),
      ]);

      const stats = DashboardPresenter.computeStats(
        agents,
        machines,
        runtimeSessions.sessions,
        runtimeHandoffSummary.summary,
      );

      this.setState({
        health,
        machines,
        agents,
        runtimeSessions: runtimeSessions.sessions,
        runtimeHandoffSummary,
        stats,
        isLoading: false,
        error: null,
        lastUpdated: new Date(),
      });
    } catch (err: unknown) {
      const error =
        err instanceof MobileClientError
          ? err
          : new MobileClientError(
              'DASHBOARD_REFRESH_FAILED',
              err instanceof Error ? err.message : String(err),
            );

      this.setState({ isLoading: false, error });
    }
  }

  /** Returns a shallow copy of the current state (immutable access). */
  getState(): DashboardState {
    return {
      ...this.state,
      agents: [...this.state.agents],
      machines: [...this.state.machines],
      runtimeSessions: [...this.state.runtimeSessions],
      runtimeHandoffSummary: this.state.runtimeHandoffSummary
        ? {
            ...this.state.runtimeHandoffSummary,
            summary: { ...this.state.runtimeHandoffSummary.summary },
          }
        : null,
      stats: { ...this.state.stats },
    };
  }

  /** Whether the presenter is currently auto-refreshing. */
  get isPolling(): boolean {
    return this.pollTimer !== null;
  }

  // -----------------------------------------------------------------------
  // Static helpers
  // -----------------------------------------------------------------------

  /** Compute aggregate stats from agents and machines lists. */
  static computeStats(
    agents: Agent[],
    machines: Machine[],
    runtimeSessions: RuntimeSessionInfo[] = [],
    runtimeHandoffSummary: HandoffAnalyticsSummary = EMPTY_HANDOFF_SUMMARY,
  ): DashboardStats {
    let running = 0;
    let error = 0;

    for (const agent of agents) {
      if (RUNNING_STATUSES.has(agent.status)) {
        running++;
      } else if (ERROR_STATUSES.has(agent.status)) {
        error++;
      }
    }

    const idle = agents.length - running - error;
    const onlineMachines = machines.filter((m) => m.status === 'online').length;
    const activeManagedRuntimes = runtimeSessions.filter((session) => session.status === 'active').length;
    const switchingManagedRuntimes = runtimeSessions.filter(
      (session) => session.status === 'handing_off',
    ).length;

    return {
      totalAgents: agents.length,
      running,
      idle,
      error,
      totalMachines: machines.length,
      onlineMachines,
      totalManagedRuntimes: runtimeSessions.length,
      activeManagedRuntimes,
      switchingManagedRuntimes,
      totalRuntimeHandoffs: runtimeHandoffSummary.total,
      runtimeNativeImportSuccesses: runtimeHandoffSummary.nativeImportSuccesses,
      runtimeFallbacks: runtimeHandoffSummary.nativeImportFallbacks,
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private setState(partial: Partial<DashboardState>): void {
    this.state = { ...this.state, ...partial };

    if (partial.stats) {
      this.state.stats = { ...partial.stats };
    }

    this.onChange?.(this.getState());
  }
}
