// ---------------------------------------------------------------------------
// Sessions — regular + runtime-managed sessions, fork/resume/message/takeover,
// permission requests, approval gates, run summary, session content preview.
// ---------------------------------------------------------------------------

import type {
  ApprovalDecision,
  ApprovalDecisionAction,
  ApprovalGate,
  ApprovalTimeoutPolicy,
  DiscoveredSession as BaseDiscoveredSession,
  ContentMessage,
  CreateManagedSessionRequest,
  DispatchConfigSnapshot,
  ExecutionSummary,
  ForkManagedSessionRequest,
  HandoffManagedSessionRequest,
  HandoffReason,
  HandoffSnapshot,
  HandoffStrategy,
  ManagedRuntime,
  ManagedSession,
  ManagedSessionStatus,
  ManualTakeoverResponse,
  ManualTakeoverState,
  NativeImportAttempt,
  NativeImportPreflightResponse,
  PermissionRequest,
  ResumeManagedSessionRequest,
  RuntimeHandoffSummaryResponse,
  StartManualTakeoverRequest,
} from '@agentctl/shared';

import { request } from './core';

export type SessionMetadata = {
  errorMessage?: string;
  errorHint?: string;
  errorCode?: string;
  exitReason?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  messageCount?: number;
  model?: string;
  forkedFrom?: string;
  lastError?: string;
  [key: string]: unknown;
};

export type Session = {
  id: string;
  agentId: string;
  agentName: string | null;
  machineId: string;
  sessionUrl: string | null;
  claudeSessionId: string | null;
  status: string;
  projectPath: string | null;
  pid: number | null;
  startedAt: string;
  lastHeartbeat: string | null;
  endedAt: string | null;
  metadata: SessionMetadata;
  accountId: string | null;
  model: string | null;
};

export type PermissionDecision = 'approved' | 'denied';

// Web extends base DiscoveredSession with machine context added by CP aggregation
export type DiscoveredSession = BaseDiscoveredSession & {
  machineId: string;
  hostname: string;
};

/**
 * Alias for ContentMessage from @agentctl/shared.
 * Kept as `SessionContentMessage` for backward compatibility with existing web imports.
 */
export type SessionContentMessage = ContentMessage;

export type SessionContentResponse = {
  messages: SessionContentMessage[];
  sessionId: string;
  totalMessages: number;
};

export type SessionsPage = {
  sessions: Session[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type RuntimeSession = ManagedSession & {
  startedAt: string | null;
  lastHeartbeat: string | null;
  endedAt: string | null;
};

export type RuntimeSessionsPage = {
  sessions: RuntimeSession[];
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

export type RuntimeSessionHandoffsPage = {
  handoffs: RuntimeSessionHandoff[];
  count: number;
};

export type RuntimeHandoffSummary = RuntimeHandoffSummaryResponse;
export type RuntimeSessionManualTakeover = ManualTakeoverState;
export type SessionTakeoverState = {
  active: boolean;
  sessionId: string;
  terminalId?: string;
  claudeSessionId?: string;
  machineId?: string;
  startedAt?: string;
  releasedAt?: string;
};

export type ApprovalGateWithDecisions = ApprovalGate & { decisions: ApprovalDecision[] };

export type RunSummaryResponse = {
  runId: string;
  source: 'stored' | 'fallback';
  summary: ExecutionSummary;
};

export const sessionsApi = {
  // Sessions
  listSessions: (params?: {
    status?: string;
    machineId?: string;
    agentId?: string;
    offset?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.machineId) qs.set('machineId', params.machineId);
    if (params?.agentId) qs.set('agentId', params.agentId);
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<SessionsPage>(`/api/sessions${suffix}`);
  },
  getSession: (id: string) => request<Session>(`/api/sessions/${id}`),
  getSessionDispatchConfig: (sessionId: string) =>
    request<{
      runId: string | null;
      runCount: number;
      config: DispatchConfigSnapshot | null;
    }>(`/api/sessions/${sessionId}/dispatch-config`),
  listRuntimeSessions: (params?: {
    machineId?: string;
    runtime?: ManagedRuntime;
    status?: ManagedSessionStatus;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.machineId) qs.set('machineId', params.machineId);
    if (params?.runtime) qs.set('runtime', params.runtime);
    if (params?.status) qs.set('status', params.status);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<RuntimeSessionsPage>(`/api/runtime-sessions${suffix}`);
  },
  createRuntimeSession: (body: CreateManagedSessionRequest) =>
    request<{ ok: boolean; session: RuntimeSession }>('/api/runtime-sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resumeRuntimeSession: (id: string, body: ResumeManagedSessionRequest) =>
    request<{ ok: boolean; session: RuntimeSession }>(`/api/runtime-sessions/${id}/resume`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  forkRuntimeSession: (id: string, body: ForkManagedSessionRequest) =>
    request<{ ok: boolean; session: RuntimeSession }>(`/api/runtime-sessions/${id}/fork`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  handoffRuntimeSession: (id: string, body: HandoffManagedSessionRequest) =>
    request<{
      ok: boolean;
      handoffId: string;
      strategy: HandoffStrategy;
      attemptedStrategies: HandoffStrategy[];
      nativeImportAttempt?: NativeImportAttempt;
      snapshot: HandoffSnapshot;
      session: RuntimeSession;
    }>(`/api/runtime-sessions/${id}/handoff`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listRuntimeSessionHandoffs: (id: string, limit?: number) => {
    const qs = new URLSearchParams();
    if (limit !== undefined) qs.set('limit', String(limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<RuntimeSessionHandoffsPage>(
      `/api/runtime-sessions/${encodeURIComponent(id)}/handoffs${suffix}`,
    );
  },
  listRuntimeHandoffSummary: (limit?: number) => {
    const qs = new URLSearchParams();
    if (limit !== undefined) qs.set('limit', String(limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<RuntimeHandoffSummary>(`/api/runtime-sessions/handoffs/summary${suffix}`);
  },
  preflightRuntimeSessionHandoff: (
    id: string,
    params: {
      targetRuntime: ManagedRuntime;
      targetMachineId?: string;
    },
  ) => {
    const qs = new URLSearchParams({ targetRuntime: params.targetRuntime });
    if (params.targetMachineId) qs.set('targetMachineId', params.targetMachineId);
    return request<NativeImportPreflightResponse>(
      `/api/runtime-sessions/${encodeURIComponent(id)}/handoff/preflight?${qs}`,
    );
  },
  getRuntimeSessionManualTakeover: (id: string) =>
    request<ManualTakeoverResponse>(
      `/api/runtime-sessions/${encodeURIComponent(id)}/manual-takeover`,
    ),
  startRuntimeSessionManualTakeover: (id: string, body: StartManualTakeoverRequest = {}) =>
    request<ManualTakeoverResponse>(
      `/api/runtime-sessions/${encodeURIComponent(id)}/manual-takeover`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),
  stopRuntimeSessionManualTakeover: (id: string) =>
    request<ManualTakeoverResponse>(
      `/api/runtime-sessions/${encodeURIComponent(id)}/manual-takeover`,
      {
        method: 'DELETE',
      },
    ),
  getRuntimeSessionTerminalTakeover: (id: string) =>
    request<SessionTakeoverState>(`/api/session-takeover/${encodeURIComponent(id)}/takeover`),
  startRuntimeSessionTerminalTakeover: (id: string) =>
    request<{
      ok: true;
      terminalId: string;
      takeoverToken: string;
      claudeSessionId: string;
      machineId?: string;
    }>(`/api/session-takeover/${encodeURIComponent(id)}/takeover`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  stopRuntimeSessionTerminalTakeover: (id: string, options?: { resume?: boolean }) => {
    const qs = new URLSearchParams();
    if (options?.resume !== undefined) {
      qs.set('resume', String(options.resume));
    }
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ ok: true; resumed: boolean }>(
      `/api/session-takeover/${encodeURIComponent(id)}/release${suffix}`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    );
  },
  createSession: (body: {
    agentId: string;
    machineId: string;
    projectPath: string;
    prompt?: string;
    model?: string;
    resumeSessionId?: string;
    accountId?: string;
    runtime?: string;
  }) =>
    request<{ ok: boolean; sessionId: string; session: Session }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resumeSession: (id: string, prompt: string, model?: string) =>
    request<{ ok: boolean }>(`/api/sessions/${id}/resume`, {
      method: 'POST',
      body: JSON.stringify({ prompt, ...(model !== undefined ? { model } : {}) }),
    }),
  sendMessage: (id: string, message: string) =>
    request<{ ok: boolean }>(`/api/sessions/${id}/message`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  deleteSession: (id: string, opts?: { purge?: boolean }) =>
    request<{ ok: boolean }>(`/api/sessions/${id}${opts?.purge ? '?purge=true' : ''}`, {
      method: 'DELETE',
    }),
  killSession: (sessionId: string) =>
    request<{ ok: boolean; message: string }>(
      `/api/sessions/${encodeURIComponent(sessionId)}/kill`,
      {
        method: 'POST',
      },
    ),
  sessionTakeover: (sessionId: string) =>
    request<{
      ok: true;
      terminalId: string;
      takeoverToken: string;
      claudeSessionId: string;
      machineId?: string;
    }>(`/api/session-takeover/${encodeURIComponent(sessionId)}/takeover`, {
      method: 'POST',
    }),
  sessionRelease: (sessionId: string, options?: { resume?: boolean }) => {
    const qs = options?.resume ? '?resume=true' : '';
    return request<{ ok: true; released: true }>(
      `/api/session-takeover/${encodeURIComponent(sessionId)}/release${qs}`,
      { method: 'POST' },
    );
  },
  sessionTakeoverStatus: (sessionId: string) =>
    request<{ active: boolean; terminalId?: string; observerCount?: number }>(
      `/api/session-takeover/${encodeURIComponent(sessionId)}/takeover`,
    ),
  forkSession: (
    id: string,
    body: {
      prompt: string;
      model?: string;
      strategy?: 'jsonl-truncation' | 'context-injection' | 'resume';
      forkAtIndex?: number;
      selectedMessages?: Array<{
        type: string;
        content: string;
        toolName?: string;
        timestamp?: string;
      }>;
    },
  ) =>
    request<{ ok: boolean; sessionId: string; session: Session; forkedFrom: string }>(
      `/api/sessions/${id}/fork`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  discoverSessions: () =>
    request<{
      sessions: DiscoveredSession[];
      count: number;
      machinesQueried: number;
      machinesFailed: number;
    }>('/api/sessions/discover'),

  // Session content preview
  getSessionContent: (
    sessionId: string,
    params: { machineId: string; projectPath?: string; limit?: number; offset?: number },
  ) => {
    const qs = new URLSearchParams();
    qs.set('machineId', params.machineId);
    if (params.projectPath) qs.set('projectPath', params.projectPath);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    return request<SessionContentResponse>(
      `/api/sessions/content/${encodeURIComponent(sessionId)}?${qs}`,
    );
  },
  getPermissionRequests: (params?: { status?: string; agentId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.agentId) qs.set('agentId', params.agentId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<PermissionRequest[]>(`/api/permission-requests${suffix}`);
  },
  resolvePermissionRequest: (
    id: string,
    decision: PermissionDecision,
    options?: { allowForSession?: boolean },
  ) =>
    request<PermissionRequest>(`/api/permission-requests/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ decision, allowForSession: options?.allowForSession }),
    }),

  // Approval Gates
  listApprovals: (threadId: string) =>
    request<ApprovalGate[]>(`/api/approvals?threadId=${encodeURIComponent(threadId)}`),

  createApprovalGate: (body: {
    taskDefinitionId: string;
    taskRunId?: string;
    threadId?: string;
    requiredApprovers?: string[];
    requiredCount?: number;
    timeoutMs?: number;
    timeoutPolicy?: ApprovalTimeoutPolicy;
    contextArtifactIds?: string[];
  }) =>
    request<ApprovalGate>('/api/approvals', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getApprovalGate: (id: string) =>
    request<ApprovalGateWithDecisions>(`/api/approvals/${encodeURIComponent(id)}`),

  addApprovalDecision: (
    id: string,
    body: {
      decidedBy: string;
      action: ApprovalDecisionAction;
      comment?: string;
      viaTimeout?: boolean;
    },
  ) =>
    request<ApprovalDecision>(`/api/approvals/${encodeURIComponent(id)}/decisions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getApprovalDecisions: (id: string) =>
    request<ApprovalDecision[]>(`/api/approvals/${encodeURIComponent(id)}/decisions`),

  // Run Summary
  getRunSummary: (runId: string) =>
    request<RunSummaryResponse>(`/api/runs/${encodeURIComponent(runId)}/summary`),
};
