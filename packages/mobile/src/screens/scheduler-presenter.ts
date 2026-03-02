// ---------------------------------------------------------------------------
// Scheduler screen presenter — framework-agnostic business logic for
// viewing and managing repeatable scheduler jobs (heartbeat and cron).
// ---------------------------------------------------------------------------

import type { ApiClient, SchedulerJob } from '../services/api-client.js';
import { MobileClientError } from '../services/api-client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateHeartbeatJobRequest = {
  agentId: string;
  machineId: string;
  intervalMs: number;
};

export type CreateCronJobRequest = {
  agentId: string;
  machineId: string;
  pattern: string;
  model?: string;
};

export type CreateHeartbeatJobResponse = {
  ok: boolean;
  agentId: string;
  machineId: string;
  intervalMs: number;
};

export type CreateCronJobResponse = {
  ok: boolean;
  agentId: string;
  machineId: string;
  pattern: string;
  model: string | null;
};

export type RemoveJobResponse = {
  ok: boolean;
  key: string;
  removedCount: number;
};

export type SchedulerState = {
  jobs: SchedulerJob[];
  isLoading: boolean;
  error: MobileClientError | null;
  lastUpdated: Date | null;
};

export type SchedulerPresenterConfig = {
  /** The API client instance for HTTP calls. */
  apiClient: ApiClient;
  /** Callback invoked whenever state changes. */
  onChange?: (state: SchedulerState) => void;
};

// ---------------------------------------------------------------------------
// Extended ApiClient interface for scheduler operations not yet on ApiClient
// ---------------------------------------------------------------------------

type SchedulerApiClient = ApiClient & {
  createHeartbeatJob?: (body: CreateHeartbeatJobRequest) => Promise<CreateHeartbeatJobResponse>;
  createCronJob?: (body: CreateCronJobRequest) => Promise<CreateCronJobResponse>;
  removeSchedulerJob?: (key: string) => Promise<RemoveJobResponse>;
};

// ---------------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------------

export class SchedulerPresenter {
  private readonly apiClient: SchedulerApiClient;
  private onChange: ((state: SchedulerState) => void) | undefined;

  private state: SchedulerState = {
    jobs: [],
    isLoading: false,
    error: null,
    lastUpdated: null,
  };

  constructor(config: SchedulerPresenterConfig) {
    this.apiClient = config.apiClient as SchedulerApiClient;
    this.onChange = config.onChange;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Fetch the list of all repeatable scheduler jobs. */
  async loadJobs(): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      const response = await this.apiClient.getSchedulerJobs();
      this.setState({
        jobs: response.jobs,
        isLoading: false,
        lastUpdated: new Date(),
      });
    } catch (err: unknown) {
      const error =
        err instanceof MobileClientError
          ? err
          : new MobileClientError(
              'SCHEDULER_LOAD_FAILED',
              err instanceof Error ? err.message : String(err),
            );
      this.setState({ isLoading: false, error });
    }
  }

  /** Create a heartbeat (interval-based) repeatable job. */
  async createHeartbeatJob(
    request: CreateHeartbeatJobRequest,
  ): Promise<CreateHeartbeatJobResponse> {
    this.validateHeartbeatRequest(request);

    if (!this.apiClient.createHeartbeatJob) {
      throw new MobileClientError(
        'NOT_IMPLEMENTED',
        'createHeartbeatJob is not available on the API client',
      );
    }

    const response = await this.apiClient.createHeartbeatJob(request);
    await this.loadJobs();
    return response;
  }

  /** Create a cron-based repeatable job. */
  async createCronJob(request: CreateCronJobRequest): Promise<CreateCronJobResponse> {
    this.validateCronRequest(request);

    if (!this.apiClient.createCronJob) {
      throw new MobileClientError(
        'NOT_IMPLEMENTED',
        'createCronJob is not available on the API client',
      );
    }

    const response = await this.apiClient.createCronJob(request);
    await this.loadJobs();
    return response;
  }

  /** Remove a repeatable job by key. */
  async removeJob(key: string): Promise<RemoveJobResponse> {
    if (!key) {
      throw new MobileClientError('INVALID_JOB_KEY', 'Job key must be a non-empty string');
    }

    if (!this.apiClient.removeSchedulerJob) {
      throw new MobileClientError(
        'NOT_IMPLEMENTED',
        'removeSchedulerJob is not available on the API client',
      );
    }

    const response = await this.apiClient.removeSchedulerJob(key);
    await this.loadJobs();
    return response;
  }

  /** Returns a shallow copy of the current state (immutable access). */
  getState(): SchedulerState {
    return {
      ...this.state,
      jobs: [...this.state.jobs],
    };
  }

  // -----------------------------------------------------------------------
  // Internal — validation
  // -----------------------------------------------------------------------

  private validateHeartbeatRequest(request: CreateHeartbeatJobRequest): void {
    if (!request.agentId) {
      throw new MobileClientError('INVALID_AGENT_ID', 'agentId must be a non-empty string');
    }
    if (!request.machineId) {
      throw new MobileClientError('INVALID_MACHINE_ID', 'machineId must be a non-empty string');
    }
    if (
      typeof request.intervalMs !== 'number' ||
      !Number.isFinite(request.intervalMs) ||
      request.intervalMs <= 0
    ) {
      throw new MobileClientError(
        'INVALID_INTERVAL',
        'intervalMs must be a positive finite number',
      );
    }
  }

  private validateCronRequest(request: CreateCronJobRequest): void {
    if (!request.agentId) {
      throw new MobileClientError('INVALID_AGENT_ID', 'agentId must be a non-empty string');
    }
    if (!request.machineId) {
      throw new MobileClientError('INVALID_MACHINE_ID', 'machineId must be a non-empty string');
    }
    if (!request.pattern) {
      throw new MobileClientError('INVALID_CRON_PATTERN', 'pattern must be a non-empty string');
    }
  }

  // -----------------------------------------------------------------------
  // Internal — state management
  // -----------------------------------------------------------------------

  private setState(partial: Partial<SchedulerState>): void {
    this.state = { ...this.state, ...partial };
    this.onChange?.(this.getState());
  }
}
