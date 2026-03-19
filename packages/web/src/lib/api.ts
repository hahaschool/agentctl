// ---------------------------------------------------------------------------
// API client — thin wrapper around fetch for the control plane API.
// In dev mode, Vite proxies /api/* to localhost:8080.
// Types are imported from @agentctl/shared to ensure consistency with DB schema.
// ---------------------------------------------------------------------------

import type {
  AgentConfig,
  AgentRuntime,
  AgentStatus,
  AgentType,
  ApprovalDecision,
  ApprovalDecisionAction,
  ApprovalGate,
  ApprovalGateStatus,
  ApprovalTimeoutPolicy,
  DiscoveredSession as BaseDiscoveredSession,
  ConfigPreviewResponse,
  ConsolidationItem,
  ConsolidationStatus,
  ContentMessage,
  ContextRef,
  CreateManagedSessionRequest,
  CrossSpaceSubscription,
  DiscoveredMcpServer,
  DiscoveredSkill,
  EntityType,
  EventSenderType,
  EventVisibility,
  ExecutionSummary,
  FactSource,
  FleetOverview,
  ForkManagedSessionRequest,
  HandoffManagedSessionRequest,
  HandoffReason,
  HandoffSnapshot,
  HandoffStrategy,
  ImportJob,
  MachineCapabilities,
  MachineStatus,
  ManagedRuntime,
  ManagedRuntimeConfig,
  ManagedSession,
  ManagedSessionStatus,
  ManualTakeoverResponse,
  ManualTakeoverState,
  McpServerConfig,
  McpServerTemplate,
  MemoryEdge,
  MemoryFact,
  MemoryObservation,
  MemoryScope,
  MemoryScopeRecord,
  MemoryScopeType,
  MemoryStats,
  NativeImportAttempt,
  NativeImportPreflightResponse,
  NotificationChannel,
  NotificationPreference,
  NotificationPriority,
  ResumeManagedSessionRequest,
  RuntimeConfigSyncRequest,
  RuntimeConfigSyncResponse,
  RuntimeHandoffSummaryResponse,
  ApiAccount as SharedApiAccount,
  Space,
  SpaceEvent,
  SpaceEventType,
  SpaceMember,
  SpaceMemberRole,
  SpaceMemberType,
  SpaceType,
  SpaceVisibility,
  StartManualTakeoverRequest,
  TaskDefinition,
  TaskEdge,
  TaskGraph,
  TaskRun,
  TaskRunStatus,
  Thread,
  ThreadType,
  WorkerNode,
} from '@agentctl/shared';

export type {
  AgentConfig,
  ApprovalDecision,
  ApprovalDecisionAction,
  ApprovalGate,
  ApprovalGateStatus,
  ApprovalTimeoutPolicy,
  ContextRef,
  CrossSpaceSubscription,
  NotificationChannel,
  NotificationPreference,
  NotificationPriority,
  DiscoveredMcpServer,
  DiscoveredSkill,
  EventSenderType,
  EventVisibility,
  FleetOverview,
  ImportJob,
  McpServerConfig,
  McpServerTemplate,
  MemoryScopeRecord,
  MemoryScopeType,
  Space,
  SpaceEvent,
  SpaceEventType,
  SpaceMember,
  SpaceMemberRole,
  SpaceMemberType,
  SpaceType,
  SpaceVisibility,
  TaskDefinition,
  TaskEdge,
  TaskGraph,
  TaskRun,
  TaskRunStatus,
  Thread,
  ThreadType,
  WorkerNode,
};

export type HealthResponse = {
  status: 'ok' | 'degraded';
  timestamp: string;
  dependencies?: Record<string, { status: 'ok' | 'error'; latencyMs: number; error?: string }>;
};

export type Machine = {
  id: string;
  hostname: string;
  tailscaleIp: string;
  os: string;
  arch: string;
  status: MachineStatus;
  lastHeartbeat: string | null;
  capabilities?: MachineCapabilities;
  createdAt: string;
};

export type Agent = {
  id: string;
  machineId: string;
  name: string;
  type: AgentType;
  runtime?: AgentRuntime;
  status: AgentStatus;
  schedule: string | null;
  projectPath: string | null;
  worktreeBranch: string | null;
  currentSessionId: string | null;
  config: AgentConfig;
  lastRunAt: string | null;
  lastCostUsd: number | null;
  totalCostUsd: number;
  accountId: string | null;
  createdAt: string;
};

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

// Local stub until backend shared types land.
export type PermissionRequestStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';

export type PermissionDecision = 'approved' | 'denied';

export type PermissionRequest = {
  id: string;
  agentId: string;
  agentName?: string;
  sessionId: string;
  machineId: string;
  requestId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  description?: string;
  status: PermissionRequestStatus;
  requestedAt: string;
  timeoutAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  decision?: PermissionDecision;
};

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

export type TaskGraphDetail = TaskGraph & {
  definitions: TaskDefinition[];
  edges: TaskEdge[];
};

export type TaskGraphValidation = {
  valid: boolean;
  errors: string[];
  topologicalOrder?: string[];
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

export type RuntimeConfigDefaultsResponse = {
  version: number;
  hash: string;
  config: ManagedRuntimeConfig;
};

export type RuntimeConfigDriftItem = {
  id: string;
  machineId: string;
  runtime: ManagedRuntime;
  isInstalled: boolean;
  isAuthenticated: boolean;
  syncStatus: string;
  configVersion: number | null;
  configHash: string | null;
  metadata: Record<string, unknown>;
  lastConfigAppliedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  drifted: boolean;
};

export type RuntimeConfigDriftResponse = {
  activeVersion: number;
  activeHash: string;
  items: RuntimeConfigDriftItem[];
};

export type AgentHealthResponse = {
  consecutiveFailures: number;
  failureRate24h: number;
  lastSuccessAt: string | null;
  status: 'healthy' | 'warning' | 'critical';
};

export type AgentRun = {
  id: string;
  agentId: string;
  trigger?: 'schedule' | 'manual' | 'signal' | 'adhoc' | 'heartbeat';
  status: string;
  phase?:
    | 'queued'
    | 'dispatching'
    | 'worker_contacted'
    | 'cli_spawning'
    | 'running'
    | 'completed'
    | 'failed'
    | 'empty'
    | null;
  prompt?: string;
  costUsd?: number;
  durationMs?: number;
  startedAt: string;
  finishedAt?: string | null;
  errorMessage?: string;
  resultSummary?: ExecutionSummary | string | null;
  sessionId?: string | null;
  retryOf?: string | null;
  retryIndex?: number | null;
};

export type ApiAccount = SharedApiAccount;

export type ProjectAccountMapping = {
  id: string;
  projectPath: string;
  accountId: string;
  createdAt: string;
};

export type AccountDefaults = {
  defaultAccountId: string | null;
  failoverPolicy: 'none' | 'priority' | 'round_robin';
};

export type AuditAction = {
  id: string;
  runId: string;
  timestamp: string;
  actionType: string;
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  toolOutputHash: string | null;
  durationMs: number | null;
  approvedBy: string | null;
  agentId: string | null;
};

export type AuditQueryResult = {
  actions: AuditAction[];
  total: number;
  hasMore: boolean;
};

export type AuditSummary = {
  totalActions: number;
  toolBreakdown: Record<string, number>;
  actionTypeBreakdown: Record<string, number>;
  avgDurationMs: number | null;
};

export type GitFileStatus = {
  clean: boolean;
  staged: number;
  modified: number;
  untracked: number;
  ahead: number;
  behind: number;
};

export type GitLastCommit = {
  hash: string;
  message: string;
  author: string;
  date: string;
};

export type GitWorktreeEntry = {
  path: string;
  branch: string | null;
  isMain: boolean;
};

export type GitStatusResponse = {
  branch: string;
  worktree: string;
  isWorktree: boolean;
  bareRepo: string | null;
  status: GitFileStatus;
  lastCommit: GitLastCommit | null;
  worktrees: GitWorktreeEntry[];
};

export type RouterModelsResponse = {
  models: string[];
};

export type ModelDeploymentInfo = {
  modelName: string;
  litellmParams: Record<string, unknown>;
  modelInfo: Record<string, unknown>;
};

export type RouterModelsInfoResponse = {
  deployments: ModelDeploymentInfo[];
};

export type FileEntry = {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
};

export type FileListResponse = {
  entries: FileEntry[];
  path: string;
};

export type FileContentResponse = {
  content: string;
  path: string;
  size: number;
};

export type TerminalInfo = {
  id: string;
  pid: number;
  command: string;
  cols: number;
  rows: number;
  createdAt: string;
};

export type MemoryReportType = 'project-progress' | 'knowledge-health' | 'activity-digest';
export type MemoryReportTimeRange = 'last-7d' | 'last-30d' | 'last-90d' | 'all-time';

export type GeneratedMemoryReport = {
  id: string;
  reportType: MemoryReportType;
  scope: string | null;
  timeRange: MemoryReportTimeRange;
  markdown: string;
  generatedAt: string;
};

export type SpaceWithMembers = Space & { members: SpaceMember[] };

export type McpDiscoverResponse = {
  discovered: DiscoveredMcpServer[];
  sources: Array<{ path: string; count: number }>;
};

export type SkillDiscoverResponse = {
  ok: boolean;
  discovered: DiscoveredSkill[];
  cached: boolean;
};

export type McpTemplatesResponse = {
  ok: boolean;
  templates: McpServerTemplate[];
  count: number;
};

export type DeploymentTierStatus = {
  name: string;
  label: string;
  status: 'running' | 'degraded' | 'stopped';
  services: Array<{
    name: string;
    port: number;
    healthy: boolean;
    memoryMb?: number;
    uptimeSeconds?: number;
    restarts?: number;
    pid?: number;
  }>;
  config: {
    cpPort: number;
    workerPort: number;
    webPort: number;
    database: string;
    redisDb: number;
  };
};

export type DeploymentPreflightCheck = {
  name: string;
  status: 'pass' | 'fail' | 'running' | 'skipped';
  message?: string;
  durationMs?: number;
};

export type DeploymentPromotionRecord = {
  id: string;
  sourceTier: string;
  targetTier: string;
  status: string;
  checks: DeploymentPreflightCheck[];
  error?: string;
  gitSha?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  triggeredBy: string;
};

export type ApprovalGateWithDecisions = ApprovalGate & { decisions: ApprovalDecision[] };

export type RunSummaryResponse = {
  runId: string;
  source: 'stored' | 'fallback';
  summary: ExecutionSummary;
};

export type BudgetedContextRefsResponse = {
  refs: ContextRef[];
  excluded: ContextRef[];
  budget: Record<string, unknown>;
};

export type ResolvedContextRefResponse = {
  ref: ContextRef;
  resolved: unknown;
  resolvedAt: string;
  hint?: string;
};

export class ApiError extends Error {
  public hint?: string;
  constructor(
    public status: number,
    public code: string,
    message: string,
    hint?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.hint = hint;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set Content-Type: application/json when there is a body to send.
  // Sending this header without a body causes Fastify to reject the request
  // with "Body cannot be empty when content-type is set to 'application/json'".
  const headers: HeadersInit = init?.body
    ? { 'Content-Type': 'application/json', ...init?.headers }
    : { ...init?.headers };

  const res = await fetch(path, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as Record<string, string>).error ?? 'UNKNOWN',
      (body as Record<string, string>).message ?? res.statusText,
      (body as Record<string, string>).hint,
    );
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Health
  health: () => request<HealthResponse>('/health?detail=true'),

  // Machines
  listMachines: () => request<Machine[]>('/api/agents'),

  // Agents
  listAgents: async (): Promise<Agent[]> => {
    const res = await request<{ agents: Agent[]; total: number; hasMore: boolean }>(
      '/api/agents/list',
    );
    return res.agents;
  },
  getAgent: (id: string) => request<Agent>(`/api/agents/${id}`),
  createAgent: (body: {
    name: string;
    machineId: string;
    type: string;
    runtime?: AgentRuntime;
    schedule?: string;
    projectPath?: string;
    config?: AgentConfig;
  }) =>
    request<{ ok: boolean; agentId: string }>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  startAgent: (id: string, prompt: string) =>
    request<{ ok: boolean }>(`/api/agents/${id}/start`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),
  stopAgent: (id: string) =>
    request<{ ok: boolean }>(`/api/agents/${id}/stop`, {
      method: 'POST',
    }),
  steerAgent: (id: string, message: string) =>
    request<{ ok: boolean; accepted: boolean; reason?: string }>(`/api/agents/${id}/steer`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  updateAgent: (
    id: string,
    body: {
      accountId?: string | null;
      name?: string;
      machineId?: string;
      type?: string;
      schedule?: string | null;
      config?: AgentConfig;
      runtime?: string;
    },
  ) =>
    request<Agent>(`/api/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  getAgentRuns: (id: string) => request<AgentRun[]>(`/api/agents/${id}/runs`),
  getAgentHealth: (id: string) => request<AgentHealthResponse>(`/api/agents/${id}/health`),

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
  resolvePermissionRequest: (id: string, decision: PermissionDecision) =>
    request<PermissionRequest>(`/api/permission-requests/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ decision }),
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

  // OAuth
  initiateOAuth: (provider: string, accountName: string) =>
    request<{ authorizationUrl: string; state: string }>('/api/oauth/initiate', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        accountName,
        redirectUri: `${window.location.origin}/api/oauth/callback`,
      }),
    }),

  // Accounts
  listAccounts: () => request<ApiAccount[]>('/api/settings/accounts'),
  createAccount: (body: {
    name: string;
    provider: string;
    credential: string;
    priority?: number;
  }) =>
    request<ApiAccount>('/api/settings/accounts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateAccount: (id: string, body: Partial<Pick<ApiAccount, 'name' | 'priority' | 'isActive'>>) =>
    request<ApiAccount>(`/api/settings/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteAccount: (id: string) =>
    request<{ ok: boolean }>(`/api/settings/accounts/${id}`, { method: 'DELETE' }),
  testAccount: (id: string) =>
    request<{ ok: boolean; latencyMs?: number }>(`/api/settings/accounts/${id}/test`, {
      method: 'POST',
    }),

  // Settings
  getDefaults: () => request<AccountDefaults>('/api/settings/defaults'),
  updateDefaults: (body: Partial<AccountDefaults>) =>
    request<AccountDefaults>('/api/settings/defaults', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getRuntimeConfigDefaults: () =>
    request<RuntimeConfigDefaultsResponse>('/api/runtime-config/defaults'),
  updateRuntimeConfigDefaults: (config: ManagedRuntimeConfig) =>
    request<RuntimeConfigDefaultsResponse>('/api/runtime-config/defaults', {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),
  getRuntimeConfigDrift: (machineId?: string) => {
    const qs = new URLSearchParams();
    if (machineId) qs.set('machineId', machineId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<RuntimeConfigDriftResponse>(`/api/runtime-config/drift${suffix}`);
  },
  syncRuntimeConfig: (body: RuntimeConfigSyncRequest) =>
    request<RuntimeConfigSyncResponse>('/api/runtime-config/sync', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  refreshRuntimeConfig: (machineId?: string) =>
    request<{ refreshed: number; items: unknown[] }>('/api/runtime-config/refresh', {
      method: 'POST',
      body: JSON.stringify(machineId ? { machineId } : {}),
    }),

  // Project account mappings
  listProjectAccounts: () => request<ProjectAccountMapping[]>('/api/settings/project-accounts'),
  upsertProjectAccount: (body: { projectPath: string; accountId: string }) =>
    request<ProjectAccountMapping>('/api/settings/project-accounts', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteProjectAccount: (id: string) =>
    request<{ ok: boolean }>(`/api/settings/project-accounts/${id}`, { method: 'DELETE' }),

  // Notification preferences
  getNotificationPreferences: (userId: string) =>
    request<{ preferences: NotificationPreference[] }>(
      `/api/notifications/preferences/${encodeURIComponent(userId)}`,
    ),
  setNotificationPreference: (body: {
    userId: string;
    priority: NotificationPriority;
    channels: NotificationChannel[];
    quietHoursStart?: string;
    quietHoursEnd?: string;
    timezone?: string;
  }) =>
    request<{ ok: boolean; preference: NotificationPreference }>('/api/notifications/preferences', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteNotificationPreference: (id: string) =>
    request<{ ok: boolean; deletedId: string }>(
      `/api/notifications/preferences/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),

  // Dashboard / Metrics (Prometheus text format → parsed object)
  metrics: async (): Promise<Record<string, string | number>> => {
    const res = await fetch('/metrics');
    if (!res.ok) throw new ApiError(res.status, 'METRICS_ERROR', res.statusText);
    const text = await res.text();
    const result: Record<string, string | number> = {};
    for (const line of text.split('\n')) {
      if (line.startsWith('#') || line.trim() === '') continue;
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx > 0) {
        const key = line.slice(0, spaceIdx);
        const val = line.slice(spaceIdx + 1).trim();
        const num = Number(val);
        result[key] = Number.isNaN(num) ? val : num;
      }
    }
    return result;
  },

  // Audit Trail
  queryAudit: (params?: {
    agentId?: string;
    tool?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.agentId) qs.set('agentId', params.agentId);
    if (params?.tool) qs.set('tool', params.tool);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<AuditQueryResult>(`/api/audit${suffix}`);
  },
  getAuditSummary: (params?: { agentId?: string; from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.agentId) qs.set('agentId', params.agentId);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<AuditSummary>(`/api/audit/summary${suffix}`);
  },

  // Router / LiteLLM
  getRouterModels: () => request<RouterModelsResponse>('/api/router/models'),
  getRouterModelsInfo: () => request<RouterModelsInfoResponse>('/api/router/models/info'),

  // File browsing
  listFiles: (machineId: string, path: string) => {
    const qs = new URLSearchParams({ path });
    return request<FileListResponse>(`/api/machines/${encodeURIComponent(machineId)}/files?${qs}`);
  },
  readFile: (machineId: string, path: string) => {
    const qs = new URLSearchParams({ path });
    return request<FileContentResponse>(
      `/api/machines/${encodeURIComponent(machineId)}/files/content?${qs}`,
    );
  },
  writeFile: (machineId: string, path: string, content: string) =>
    request<{ success: boolean; path: string }>(
      `/api/machines/${encodeURIComponent(machineId)}/files/content`,
      {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
      },
    ),

  // Git status
  getGitStatus: (machineId: string, path: string) => {
    const qs = new URLSearchParams({ path });
    return request<GitStatusResponse>(
      `/api/machines/${encodeURIComponent(machineId)}/git/status?${qs}`,
    );
  },

  // Terminal
  listTerminals: (machineId: string) =>
    request<TerminalInfo[]>(`/api/machines/${encodeURIComponent(machineId)}/terminal`),

  spawnTerminal: (
    machineId: string,
    opts?: {
      id?: string;
      command?: string;
      args?: string[];
      cols?: number;
      rows?: number;
      cwd?: string;
    },
  ) =>
    request<TerminalInfo>(`/api/machines/${encodeURIComponent(machineId)}/terminal`, {
      method: 'POST',
      body: JSON.stringify({ id: opts?.id ?? crypto.randomUUID(), ...opts }),
    }),

  killTerminal: (machineId: string, termId: string) =>
    request<void>(
      `/api/machines/${encodeURIComponent(machineId)}/terminal/${encodeURIComponent(termId)}`,
      { method: 'DELETE' },
    ),

  resizeTerminal: (machineId: string, termId: string, cols: number, rows: number) =>
    request<void>(
      `/api/machines/${encodeURIComponent(machineId)}/terminal/${encodeURIComponent(termId)}/resize`,
      { method: 'POST', body: JSON.stringify({ cols, rows }) },
    ),

  // Unified memory foundation
  searchMemoryFacts: (params: {
    q?: string;
    scope?: MemoryScope;
    entityType?: EntityType;
    sessionId?: string;
    agentId?: string;
    machineId?: string;
    minConfidence?: number;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.scope) qs.set('scope', params.scope);
    if (params.entityType) qs.set('entityType', params.entityType);
    if (params.sessionId) qs.set('sessionId', params.sessionId);
    if (params.agentId) qs.set('agentId', params.agentId);
    if (params.machineId) qs.set('machineId', params.machineId);
    if (params.minConfidence !== undefined) qs.set('minConfidence', String(params.minConfidence));
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    const suffix = qs.toString();

    return request<{ ok: boolean; facts: MemoryFact[]; total: number }>(
      suffix ? `/api/memory/facts?${suffix}` : '/api/memory/facts',
    );
  },

  getMemoryFact: (id: string) =>
    request<{ ok: boolean; fact: MemoryFact; edges: MemoryEdge[] }>(
      `/api/memory/facts/${encodeURIComponent(id)}`,
    ),

  createMemoryFact: (body: {
    content: string;
    scope: MemoryScope;
    entityType: EntityType;
    confidence?: number;
    source?: FactSource;
  }) =>
    request<{ ok: boolean; fact: MemoryFact }>('/api/memory/facts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateMemoryFact: (
    id: string,
    patch: {
      scope?: MemoryScope;
      content?: string;
      entityType?: EntityType;
      confidence?: number;
      strength?: number;
    },
  ) =>
    request<{ ok: boolean; fact: MemoryFact }>(`/api/memory/facts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteMemoryFact: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/memory/facts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getMemoryGraph: (params?: { scope?: MemoryScope; entityType?: EntityType; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.scope) qs.set('scope', params.scope);
    if (params?.entityType) qs.set('entityType', params.entityType);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString();

    return request<{ ok: boolean; nodes: MemoryFact[]; edges: MemoryEdge[] }>(
      suffix ? `/api/memory/graph?${suffix}` : '/api/memory/graph',
    );
  },

  getMemoryStats: () => request<{ ok: boolean; stats: MemoryStats }>('/api/memory/stats'),

  // Memory scope management
  listMemoryScopes: () =>
    request<{ ok: boolean; scopes: MemoryScopeRecord[] }>('/api/memory/scopes'),

  createMemoryScope: (body: { name: string; type: MemoryScopeType }) =>
    request<{ ok: boolean; scope: MemoryScopeRecord }>('/api/memory/scopes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  renameMemoryScope: (id: string, name: string) =>
    request<{ ok: boolean; scope: MemoryScopeRecord }>(
      `/api/memory/scopes/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
    ),

  deleteMemoryScope: (id: string, cascade?: boolean) =>
    request<{ ok: boolean; id: string; deleted: number }>(
      `/api/memory/scopes/${encodeURIComponent(id)}${cascade ? '?cascade=true' : ''}`,
      { method: 'DELETE' },
    ),

  promoteScopeFacts: (id: string) =>
    request<{ ok: boolean; promoted: number; fromScope: string; toScope: string }>(
      `/api/memory/scopes/${encodeURIComponent(id)}/promote`,
      { method: 'POST' },
    ),

  mergeScopes: (sourceId: string, targetId: string) =>
    request<{ ok: boolean; merged: number; fromScope: string; toScope: string }>(
      `/api/memory/scopes/${encodeURIComponent(sourceId)}/merge`,
      { method: 'POST', body: JSON.stringify({ targetId }) },
    ),

  // Claude-mem compatibility
  searchMemory: (params: { q: string; project?: string; type?: string; limit?: number }) => {
    const qs = new URLSearchParams({ q: params.q });
    if (params.project) qs.set('project', params.project);
    if (params.type) qs.set('type', params.type);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{ observations: MemoryObservation[] }>(
      `/api/claude-mem/search?${qs.toString()}`,
    );
  },

  getMemoryObservation: (id: number) =>
    request<{ observation: MemoryObservation }>(`/api/claude-mem/observations/${id}`),

  getMemoryTimeline: (sessionId: string, limit?: number) => {
    const qs = new URLSearchParams({ sessionId });
    if (limit) qs.set('limit', String(limit));
    return request<{ observations: MemoryObservation[] }>(
      `/api/claude-mem/timeline?${qs.toString()}`,
    );
  },

  generateMemoryReport: (body: {
    reportType: MemoryReportType;
    scope?: string;
    timeRange?: MemoryReportTimeRange;
  }) =>
    request<{ ok: boolean; report: GeneratedMemoryReport }>('/api/memory/reports/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listMemoryReports: (params?: {
    reportType?: MemoryReportType;
    scope?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.reportType) qs.set('reportType', params.reportType);
    if (params?.scope) qs.set('scope', params.scope);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ ok: boolean; reports: GeneratedMemoryReport[]; total: number }>(
      `/api/memory/reports${suffix}`,
    );
  },

  getConsolidationItems: (params?: { type?: string; status?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.status) qs.set('status', params.status);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ ok: boolean; items: ConsolidationItem[]; total: number }>(
      `/api/memory/consolidation${suffix}`,
    );
  },

  resolveConsolidationItem: (
    id: string,
    body: {
      action: string;
      status: ConsolidationStatus;
    },
  ) =>
    request<{ ok: boolean }>(`/api/memory/consolidation/${id}/action`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // MCP discovery & templates
  discoverMcpServers: (machineId: string, runtime: string, projectPath?: string) => {
    const qs = new URLSearchParams({ machineId, runtime });
    if (projectPath) qs.set('projectPath', projectPath);
    return request<McpDiscoverResponse>(`/api/mcp/discover?${qs.toString()}`);
  },

  getMcpTemplates: () => request<McpTemplatesResponse>('/api/mcp/templates'),

  // Skill discovery
  discoverSkills: (machineId: string, runtime: string, projectPath?: string) => {
    const qs = new URLSearchParams({ machineId, runtime });
    if (projectPath) qs.set('projectPath', projectPath);
    return request<SkillDiscoverResponse>(`/api/skills/discover?${qs.toString()}`);
  },

  // Agent config preview (dry-run rendering of managed runtime config)
  getAgentConfigPreview: (agentId: string) =>
    request<ConfigPreviewResponse>(`/api/agents/${encodeURIComponent(agentId)}/config-preview`),

  // Machine capability sync (triggers fresh MCP + skill discovery on the worker)
  syncCapabilities: (machineId: string, runtime?: string, projectPath?: string) =>
    request<{
      machineId: string;
      runtime: string;
      mcpDiscovered: number;
      skillsDiscovered: number;
      warnings: string[];
    }>(`/api/machines/${encodeURIComponent(machineId)}/sync-capabilities`, {
      method: 'POST',
      body: JSON.stringify({
        ...(runtime ? { runtime } : {}),
        ...(projectPath ? { projectPath } : {}),
      }),
    }),

  // Memory import
  startMemoryImport: (body: { source: ImportJob['source']; dbPath: string }) =>
    request<{ ok: boolean; job: ImportJob }>('/api/memory/import', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getImportStatus: () => request<{ ok: boolean; job: ImportJob }>('/api/memory/import/status'),

  cancelImport: (id: string) =>
    request<{ ok: boolean; job: ImportJob }>(`/api/memory/import/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // ---------------------------------------------------------------------------
  // Collaboration Spaces
  // ---------------------------------------------------------------------------

  getSpaces: () => request<Space[]>('/api/spaces'),

  createSpace: (data: {
    name: string;
    description?: string;
    type?: SpaceType;
    visibility?: SpaceVisibility;
  }) =>
    request<Space>('/api/spaces', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSpace: (id: string) => request<SpaceWithMembers>(`/api/spaces/${encodeURIComponent(id)}`),

  deleteSpace: (id: string) =>
    request<void>(`/api/spaces/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Space members
  addSpaceMember: (
    spaceId: string,
    data: { memberType: SpaceMemberType; memberId: string; role?: SpaceMemberRole },
  ) =>
    request<SpaceMember>(`/api/spaces/${encodeURIComponent(spaceId)}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  removeSpaceMember: (spaceId: string, memberId: string) =>
    request<void>(
      `/api/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(memberId)}`,
      { method: 'DELETE' },
    ),

  // Threads
  getThreads: (spaceId: string) =>
    request<Thread[]>(`/api/spaces/${encodeURIComponent(spaceId)}/threads`),

  createThread: (spaceId: string, data: { title?: string; type?: ThreadType }) =>
    request<Thread>(`/api/spaces/${encodeURIComponent(spaceId)}/threads`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Events
  getEvents: (spaceId: string, threadId: string, params?: { after?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.after !== undefined) qs.set('after', String(params.after));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<SpaceEvent[]>(
      `/api/spaces/${encodeURIComponent(spaceId)}/threads/${encodeURIComponent(threadId)}/events${suffix}`,
    );
  },

  postEvent: (
    spaceId: string,
    threadId: string,
    data: {
      type: SpaceEventType;
      senderType: EventSenderType;
      senderId: string;
      payload: Record<string, unknown>;
      visibility?: EventVisibility;
      idempotencyKey?: string;
    },
  ) =>
    request<SpaceEvent>(
      `/api/spaces/${encodeURIComponent(spaceId)}/threads/${encodeURIComponent(threadId)}/events`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  // Context bridge (cross-space refs + subscriptions)
  getSpaceContextRefs: (spaceId: string) =>
    request<ContextRef[]>(`/api/spaces/${encodeURIComponent(spaceId)}/context-refs`),

  createContextRef: (
    spaceId: string,
    body: {
      sourceSpaceId: string;
      sourceThreadId?: string;
      sourceEventId?: string;
      targetThreadId: string;
      mode: string;
      snapshotPayload?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      createdBy: string;
    },
  ) =>
    request<ContextRef>(`/api/spaces/${encodeURIComponent(spaceId)}/context-refs`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getBudgetedContextRefs: (
    spaceId: string,
    params?: { perSpaceLimit?: number; totalLimit?: number; overflowStrategy?: string },
  ) => {
    const qs = new URLSearchParams();
    if (params?.perSpaceLimit !== undefined) qs.set('perSpaceLimit', String(params.perSpaceLimit));
    if (params?.totalLimit !== undefined) qs.set('totalLimit', String(params.totalLimit));
    if (params?.overflowStrategy) qs.set('overflowStrategy', params.overflowStrategy);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<BudgetedContextRefsResponse>(
      `/api/spaces/${encodeURIComponent(spaceId)}/context-refs/budgeted${suffix}`,
    );
  },

  resolveContextRef: (spaceId: string, refId: string) =>
    request<ResolvedContextRefResponse>(
      `/api/spaces/${encodeURIComponent(spaceId)}/context-refs/${encodeURIComponent(refId)}/resolve`,
    ),

  deleteContextRef: (spaceId: string, refId: string) =>
    request<{ ok: boolean }>(
      `/api/spaces/${encodeURIComponent(spaceId)}/context-refs/${encodeURIComponent(refId)}`,
      { method: 'DELETE' },
    ),

  getSpaceSubscriptions: (spaceId: string) =>
    request<CrossSpaceSubscription[]>(`/api/spaces/${encodeURIComponent(spaceId)}/subscriptions`),

  createSpaceSubscription: (
    spaceId: string,
    body: {
      sourceSpaceId: string;
      filterCriteria?: Record<string, unknown>;
      createdBy: string;
    },
  ) =>
    request<CrossSpaceSubscription>(`/api/spaces/${encodeURIComponent(spaceId)}/subscriptions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateSpaceSubscription: (spaceId: string, subId: string, active: boolean) =>
    request<CrossSpaceSubscription>(
      `/api/spaces/${encodeURIComponent(spaceId)}/subscriptions/${encodeURIComponent(subId)}`,
      { method: 'PATCH', body: JSON.stringify({ active }) },
    ),

  deleteSpaceSubscription: (spaceId: string, subId: string) =>
    request<{ ok: boolean }>(
      `/api/spaces/${encodeURIComponent(spaceId)}/subscriptions/${encodeURIComponent(subId)}`,
      { method: 'DELETE' },
    ),

  // Task graphs
  listTaskGraphs: () => request<TaskGraph[]>('/api/task-graphs'),

  getTaskGraph: (id: string) =>
    request<TaskGraphDetail>(`/api/task-graphs/${encodeURIComponent(id)}`),

  validateTaskGraph: (id: string) =>
    request<TaskGraphValidation>(`/api/task-graphs/${encodeURIComponent(id)}/validate`, {
      method: 'POST',
    }),

  // Task runs
  listTaskRuns: () => request<TaskRun[]>('/api/task-runs'),

  createTaskRun: (body: { definitionId: string; spaceId?: string; threadId?: string }) =>
    request<TaskRun>('/api/task-runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Fleet worker nodes
  listWorkerNodes: () => request<WorkerNode[]>('/api/fleet/nodes'),

  getFleetOverview: () => request<FleetOverview>('/api/fleet/nodes/overview'),

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  getDeploymentTiers: () => request<{ tiers: DeploymentTierStatus[] }>('/api/deployment/tiers'),

  runPreflight: (source: string) =>
    request<{ ready: boolean; checks: DeploymentPreflightCheck[] }>(
      '/api/deployment/promote/preflight',
      {
        method: 'POST',
        body: JSON.stringify({ source }),
      },
    ),

  triggerPromotion: (source: string) =>
    request<{ id: string; status: string }>('/api/deployment/promote', {
      method: 'POST',
      body: JSON.stringify({ source }),
    }),

  getPromotionHistory: (limit = 20, offset = 0) =>
    request<{ records: DeploymentPromotionRecord[]; total: number }>(
      `/api/deployment/history?limit=${limit}&offset=${offset}`,
    ),
};

// ---------------------------------------------------------------------------
// Attachment upload helpers
// ---------------------------------------------------------------------------

export type Attachment = {
  name: string;
  type: 'image' | 'file';
  /** Base64 data URL for preview (images only). */
  previewUrl?: string;
  /** Size in bytes. */
  size: number;
  /** The text content (for text files) or base64 content (for binary). */
  content: string;
  /** Whether this is base64 encoded. */
  isBase64: boolean;
};

/** Read a File object into an Attachment. */
export function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const isImage = file.type.startsWith('image/');
    const isText =
      file.type.startsWith('text/') ||
      /\.(ts|js|json|md|py|sh|yaml|yml|toml|cfg|ini|xml|html|css|sql|csv)$/i.test(file.name);

    if (isText) {
      reader.onload = () => {
        resolve({
          name: file.name,
          type: 'file',
          size: file.size,
          content: reader.result as string,
          isBase64: false,
        });
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    } else {
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1] ?? '';
        resolve({
          name: file.name,
          type: isImage ? 'image' : 'file',
          previewUrl: isImage ? (reader.result as string) : undefined,
          size: file.size,
          content: base64,
          isBase64: true,
        });
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    }
  });
}

/** Convert a clipboard image blob into an Attachment. */
export function clipboardImageToAttachment(blob: Blob): Promise<Attachment> {
  const ext = blob.type.split('/')[1] ?? 'png';
  const name = `clipboard-${Date.now()}.${ext}`;
  const file = new File([blob], name, { type: blob.type });
  return fileToAttachment(file);
}

/**
 * Upload attachments to the worker machine and return the file paths.
 * Files are saved under `<projectPath>/.agentctl-uploads/`.
 */
export async function uploadAttachments(
  machineId: string,
  projectPath: string,
  attachments: Attachment[],
): Promise<string[]> {
  const uploadDir = `${projectPath}/.agentctl-uploads`;
  const paths: string[] = [];

  for (const attachment of attachments) {
    const filePath = `${uploadDir}/${attachment.name}`;
    const content = attachment.isBase64 ? `__BASE64__${attachment.content}` : attachment.content;

    await api.writeFile(machineId, filePath, content);
    paths.push(filePath);
  }

  return paths;
}
