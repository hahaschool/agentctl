// ---------------------------------------------------------------------------
// Runtime session API — typed helpers for AgentCTL managed runtime sessions.
// Covers Claude Code / Codex managed sessions and cross-runtime handoffs.
// ---------------------------------------------------------------------------

import type {
  CreateManagedSessionRequest,
  ForkManagedSessionRequest,
  HandoffManagedSessionRequest,
  HandoffReason,
  HandoffSnapshot,
  HandoffStrategy,
  ManagedRuntime,
  ManagedSession,
  ManagedSessionStatus,
  NativeImportPreflightResponse,
  NativeImportAttempt,
  ResumeManagedSessionRequest,
} from '@agentctl/shared';

import type { ApiClient } from './api-client.js';
import { MobileClientError } from './api-client.js';
import { requestWithApiClient } from './request-with-api-client.js';

export type RuntimeSessionInfo = ManagedSession & {
  startedAt: string | null;
  lastHeartbeat: string | null;
  endedAt: string | null;
};

export type RuntimeSessionListResponse = {
  sessions: RuntimeSessionInfo[];
  count: number;
};

export type RuntimeSessionHandoff = {
  id: string;
  sourceSessionId: string;
  targetSessionId: string | null;
  sourceRuntime: ManagedRuntime;
  targetRuntime: ManagedRuntime;
  reason: HandoffReason;
  strategy: HandoffStrategy;
  status: 'pending' | 'succeeded' | 'failed';
  snapshot: HandoffSnapshot;
  nativeImportAttempt?: NativeImportAttempt;
  errorMessage: string | null;
  createdAt: string | null;
  completedAt: string | null;
};

export type RuntimeSessionHandoffsResponse = {
  handoffs: RuntimeSessionHandoff[];
  count: number;
};

export type RuntimeSessionResponse = {
  ok: boolean;
  session: RuntimeSessionInfo;
};

export type RuntimeSessionHandoffResponse = {
  ok: boolean;
  handoffId: string;
  strategy: HandoffStrategy;
  attemptedStrategies: HandoffStrategy[];
  nativeImportAttempt?: NativeImportAttempt;
  snapshot: HandoffSnapshot;
  session: RuntimeSessionInfo;
};

function assertSessionId(sessionId: string): void {
  if (!sessionId) {
    throw new MobileClientError('INVALID_SESSION_ID', 'sessionId must be a non-empty string');
  }
}

export class RuntimeSessionApi {
  constructor(private readonly apiClient: ApiClient) {}

  async listSessions(params?: {
    machineId?: string;
    runtime?: ManagedRuntime;
    status?: ManagedSessionStatus;
    limit?: number;
  }): Promise<RuntimeSessionListResponse> {
    const qs = new URLSearchParams();
    if (params?.machineId) qs.set('machineId', params.machineId);
    if (params?.runtime) qs.set('runtime', params.runtime);
    if (params?.status) qs.set('status', params.status);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return requestWithApiClient<RuntimeSessionListResponse>(
      this.apiClient,
      'GET',
      `/api/runtime-sessions${suffix}`,
    );
  }

  async createSession(body: CreateManagedSessionRequest): Promise<RuntimeSessionResponse> {
    return requestWithApiClient<RuntimeSessionResponse>(
      this.apiClient,
      'POST',
      '/api/runtime-sessions',
      body,
    );
  }

  async resumeSession(
    sessionId: string,
    body: ResumeManagedSessionRequest,
  ): Promise<RuntimeSessionResponse> {
    assertSessionId(sessionId);
    return requestWithApiClient<RuntimeSessionResponse>(
      this.apiClient,
      'POST',
      `/api/runtime-sessions/${encodeURIComponent(sessionId)}/resume`,
      body,
    );
  }

  async forkSession(
    sessionId: string,
    body: ForkManagedSessionRequest,
  ): Promise<RuntimeSessionResponse> {
    assertSessionId(sessionId);
    return requestWithApiClient<RuntimeSessionResponse>(
      this.apiClient,
      'POST',
      `/api/runtime-sessions/${encodeURIComponent(sessionId)}/fork`,
      body,
    );
  }

  async handoffSession(
    sessionId: string,
    body: HandoffManagedSessionRequest,
  ): Promise<RuntimeSessionHandoffResponse> {
    assertSessionId(sessionId);
    return requestWithApiClient<RuntimeSessionHandoffResponse>(
      this.apiClient,
      'POST',
      `/api/runtime-sessions/${encodeURIComponent(sessionId)}/handoff`,
      body,
    );
  }

  async listHandoffs(sessionId: string, limit?: number): Promise<RuntimeSessionHandoffsResponse> {
    assertSessionId(sessionId);
    const qs = new URLSearchParams();
    if (limit !== undefined) qs.set('limit', String(limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return requestWithApiClient<RuntimeSessionHandoffsResponse>(
      this.apiClient,
      'GET',
      `/api/runtime-sessions/${encodeURIComponent(sessionId)}/handoffs${suffix}`,
    );
  }

  async preflightHandoff(
    sessionId: string,
    params: { targetRuntime: ManagedRuntime; targetMachineId?: string },
  ): Promise<NativeImportPreflightResponse> {
    assertSessionId(sessionId);
    const qs = new URLSearchParams({ targetRuntime: params.targetRuntime });
    if (params.targetMachineId) qs.set('targetMachineId', params.targetMachineId);
    return requestWithApiClient<NativeImportPreflightResponse>(
      this.apiClient,
      'GET',
      `/api/runtime-sessions/${encodeURIComponent(sessionId)}/handoff/preflight?${qs}`,
    );
  }
}
