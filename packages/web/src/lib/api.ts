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
  capabilities: { gpu: boolean; docker: boolean; maxConcurrentAgents: number };
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
  health: () => request<HealthResponse>('/health'),

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

  // Dashboard / Metrics
  metrics: () => request<Record<string, unknown>>('/metrics'),
};
