// ---------------------------------------------------------------------------
// API client — thin wrapper around fetch for the control plane API.
// In dev mode, Vite proxies /api/* to localhost:8080.
// ---------------------------------------------------------------------------

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
  status: 'online' | 'offline' | 'degraded';
  lastHeartbeat: string | null;
  capabilities?: { gpu: boolean; docker: boolean; maxConcurrentAgents: number };
  createdAt: string;
};

export type Agent = {
  id: string;
  machineId: string;
  name: string;
  type: string;
  status: string;
  schedule: string | null;
  projectPath: string | null;
  worktreeBranch: string | null;
  currentSessionId: string | null;
  config: Record<string, unknown>;
  lastRunAt: string | null;
  lastCostUsd: number | null;
  totalCostUsd: number;
  accountId: string | null;
  createdAt: string;
};

export type Session = {
  id: string;
  agentId: string;
  machineId: string;
  sessionUrl: string | null;
  claudeSessionId: string | null;
  status: string;
  projectPath: string | null;
  pid: number | null;
  startedAt: string;
  lastHeartbeat: string | null;
  endedAt: string | null;
  metadata: Record<string, unknown>;
  accountId: string | null;
  model: string | null;
};

export type DiscoveredSession = {
  sessionId: string;
  projectPath: string;
  summary: string;
  messageCount: number;
  lastActivity: string;
  branch: string | null;
  machineId: string;
  hostname: string;
};

export type SessionContentMessage = {
  type: string;
  content: string;
  timestamp?: string;
  toolName?: string;
};

export type SessionContentResponse = {
  messages: SessionContentMessage[];
  sessionId: string;
  totalMessages: number;
};

export type AgentRun = {
  id: string;
  agentId: string;
  status: string;
  prompt?: string;
  costUsd?: number;
  durationMs?: number;
  startedAt: string;
  endedAt?: string;
  errorMessage?: string;
};

export type ApiAccount = {
  id: string;
  name: string;
  provider: string;
  credentialMasked: string;
  priority: number;
  rateLimit: { itpm?: number; otpm?: number };
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

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

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as Record<string, string>).error ?? 'UNKNOWN',
      (body as Record<string, string>).message ?? res.statusText,
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
  listAgents: () => request<Agent[]>('/api/agents/agents/list'),
  getAgent: (id: string) => request<Agent>(`/api/agents/agents/${id}`),
  createAgent: (body: {
    name: string;
    machineId: string;
    type: string;
    config?: Record<string, unknown>;
  }) =>
    request<{ ok: boolean; agentId: string }>('/api/agents/agents', {
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
  updateAgent: (id: string, body: { accountId?: string | null }) =>
    request<Agent>(`/api/agents/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  getAgentRuns: (id: string) => request<AgentRun[]>(`/api/agents/agents/${id}/runs`),

  // Sessions
  listSessions: (params?: { status?: string; machineId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.machineId) qs.set('machineId', params.machineId);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<Session[]>(`/api/sessions${suffix}`);
  },
  getSession: (id: string) => request<Session>(`/api/sessions/${id}`),
  createSession: (body: {
    agentId: string;
    machineId: string;
    projectPath: string;
    prompt?: string;
    model?: string;
    resumeSessionId?: string;
    accountId?: string;
  }) =>
    request<{ ok: boolean; sessionId: string; session: Session }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resumeSession: (id: string, prompt: string) =>
    request<{ ok: boolean }>(`/api/sessions/${id}/resume`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),
  sendMessage: (id: string, message: string) =>
    request<{ ok: boolean }>(`/api/sessions/${id}/message`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  deleteSession: (id: string) =>
    request<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  forkSession: (id: string, prompt: string) =>
    request<{ ok: boolean; sessionId: string; session: Session; forkedFrom: string }>(
      `/api/sessions/${id}/fork`,
      { method: 'POST', body: JSON.stringify({ prompt }) },
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
    params: { machineId: string; projectPath?: string; limit?: number },
  ) => {
    const qs = new URLSearchParams();
    qs.set('machineId', params.machineId);
    if (params.projectPath) qs.set('projectPath', params.projectPath);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<SessionContentResponse>(
      `/api/sessions/content/${encodeURIComponent(sessionId)}?${qs}`,
    );
  },

  // OAuth
  initiateOAuth: (provider: string, accountName: string) =>
    request<{ authorizationUrl: string; state: string }>('/api/oauth/initiate', {
      method: 'POST',
      body: JSON.stringify({ provider, accountName }),
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
  updateAccount: (id: string, body: Record<string, unknown>) =>
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

  // Project account mappings
  listProjectAccounts: () => request<ProjectAccountMapping[]>('/api/settings/project-accounts'),
  upsertProjectAccount: (body: { projectPath: string; accountId: string }) =>
    request<ProjectAccountMapping>('/api/settings/project-accounts', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteProjectAccount: (id: string) =>
    request<{ ok: boolean }>(`/api/settings/project-accounts/${id}`, { method: 'DELETE' }),

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

  // Router / LiteLLM
  getRouterModels: () => request<RouterModelsResponse>('/api/router/models'),
  getRouterModelsInfo: () => request<RouterModelsInfoResponse>('/api/router/models/info'),
};
