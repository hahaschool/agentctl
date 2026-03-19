import type { PermissionRequest } from '@agentctl/shared';

import type { ApiClient } from '../services/api-client.js';
import { MobileClientError } from '../services/api-client.js';
import {
  PermissionRequestApi,
  type PermissionRequestDecision,
} from '../services/permission-request-api.js';

export type PendingApprovalsState = {
  requests: PermissionRequest[];
  pendingCount: number;
  isLoading: boolean;
  resolvingRequestId: string | null;
  error: MobileClientError | null;
  lastUpdated: Date | null;
};

export type PendingApprovalsPresenterConfig = {
  apiClient: ApiClient;
  pollIntervalMs?: number;
  onChange?: (state: PendingApprovalsState) => void;
};

const DEFAULT_POLL_INTERVAL_MS = 15_000;

export class PendingApprovalsPresenter {
  private readonly permissionRequestApi: PermissionRequestApi;
  private readonly pollIntervalMs: number;
  private readonly onChange?: (state: PendingApprovalsState) => void;

  private state: PendingApprovalsState = {
    requests: [],
    pendingCount: 0,
    isLoading: false,
    resolvingRequestId: null,
    error: null,
    lastUpdated: null,
  };

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: PendingApprovalsPresenterConfig) {
    this.permissionRequestApi = new PermissionRequestApi(config.apiClient);
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onChange = config.onChange;
  }

  start(): void {
    this.stop();
    void this.refresh();
    this.pollTimer = setInterval(() => {
      void this.refresh();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async refresh(): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      const requests = await this.permissionRequestApi.listRequests({ status: 'pending' });
      this.setState({
        requests,
        pendingCount: requests.length,
        isLoading: false,
        error: null,
        lastUpdated: new Date(),
      });
    } catch (err: unknown) {
      this.setState({
        isLoading: false,
        error:
          err instanceof MobileClientError
            ? err
            : new MobileClientError(
                'PENDING_APPROVALS_LOAD_FAILED',
                err instanceof Error ? err.message : String(err),
              ),
      });
    }
  }

  async resolveRequest(id: string, decision: PermissionRequestDecision): Promise<void> {
    this.setState({ resolvingRequestId: id, error: null });

    try {
      await this.permissionRequestApi.resolveRequest(id, decision);
      await this.refresh();
    } catch (err: unknown) {
      this.setState({
        error:
          err instanceof MobileClientError
            ? err
            : new MobileClientError(
                'PENDING_APPROVAL_RESOLVE_FAILED',
                err instanceof Error ? err.message : String(err),
              ),
      });
      throw err;
    } finally {
      this.setState({ resolvingRequestId: null });
    }
  }

  getState(): PendingApprovalsState {
    return {
      ...this.state,
      requests: [...this.state.requests],
    };
  }

  private setState(patch: Partial<PendingApprovalsState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange?.(this.getState());
  }
}
