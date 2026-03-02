// ---------------------------------------------------------------------------
// Typed HTTP client for the AgentCTL control plane REST API.
//
// Framework-agnostic — uses the global `fetch` API available in modern
// runtimes (Node 18+, React Native, browsers).
// ---------------------------------------------------------------------------

import type {
  Agent,
  AgentRun,
  Machine,
  SignalAgentRequest,
  StartAgentRequest,
} from '@agentctl/shared';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class MobileClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MobileClientError';
  }
}

// ---------------------------------------------------------------------------
// Response types — shapes returned by the control plane
// ---------------------------------------------------------------------------

export type HealthResponse = {
  status: 'ok' | 'degraded';
  timestamp: string;
  dependencies?: Record<string, { status: 'ok' | 'error'; latencyMs: number; error?: string }>;
};

export type StartAgentResponse = {
  ok: boolean;
  agentId: string;
  jobId?: string;
  prompt?: string;
  model?: string;
};

export type StopAgentResponse = {
  ok: boolean;
  agentId: string;
  reason: string;
  graceful: boolean;
  removedRepeatableJobs?: number;
};

export type SignalAgentResponse = {
  ok: boolean;
  agentId: string;
  jobId?: string;
};

export type SchedulerJob = {
  key: string;
  name: string;
  id: string | null;
  endDate: number | null;
  tz: string | null;
  pattern: string;
  every?: string;
  next: number;
};

export type MemorySearchResult = {
  id: string;
  memory: string;
  score: number;
  metadata?: Record<string, unknown>;
};

export type AuditAction = {
  id: string;
  runId: string;
  actionType: string;
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  toolOutputHash: string | null;
  durationMs: number | null;
  createdAt: string;
};

export type AuditQueryParams = {
  agentId?: string;
  from?: string;
  to?: string;
  tool?: string;
  limit?: number;
  offset?: number;
};

export type AuditQueryResponse = {
  actions: AuditAction[];
  total: number;
  limit: number;
  offset: number;
};

export type AuditSummary = {
  totalActions: number;
  byTool: Record<string, number>;
  byActionType: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

export type ApiClientConfig = {
  /** Base URL of the control plane (e.g. "https://cp.tail12345.ts.net"). */
  baseUrl: string;
  /** Optional bearer token for authentication. */
  authToken?: string;
  /** Optional request timeout in milliseconds (default: 30 000). */
  timeoutMs?: number;
  /** Optional request interceptor — called before every request. */
  onRequest?: (url: string, init: RequestInit) => RequestInit | Promise<RequestInit>;
  /** Optional response interceptor — called after every response. */
  onResponse?: (response: Response) => Response | Promise<Response>;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (pair): pair is [string, string | number] => pair[1] !== undefined,
  );
  if (entries.length === 0) return '';
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return `?${qs.join('&')}`;
}

// ---------------------------------------------------------------------------
// ApiClient
// ---------------------------------------------------------------------------

export class ApiClient {
  private readonly baseUrl: string;
  private authToken: string | undefined;
  private readonly timeoutMs: number;
  private readonly onRequest?: ApiClientConfig['onRequest'];
  private readonly onResponse?: ApiClientConfig['onResponse'];

  constructor(config: ApiClientConfig) {
    this.baseUrl = stripTrailingSlash(config.baseUrl);
    this.authToken = config.authToken;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onRequest = config.onRequest;
    this.onResponse = config.onResponse;
  }

  // -----------------------------------------------------------------------
  // Auth helpers
  // -----------------------------------------------------------------------

  /** Replace the current auth token (or clear it with `undefined`). */
  setAuthToken(token: string | undefined): void {
    this.authToken = token;
  }

  // -----------------------------------------------------------------------
  // Core request method
  // -----------------------------------------------------------------------

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    let init: RequestInit = {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    };

    // Run request interceptor
    if (this.onRequest) {
      init = await this.onRequest(url, init);
    }

    // Execute with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    init.signal = controller.signal;

    let response: Response;

    try {
      response = await fetch(url, init);
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new MobileClientError('REQUEST_TIMEOUT', `Request to ${method} ${path} timed out`, {
          timeoutMs: this.timeoutMs,
        });
      }

      const message = err instanceof Error ? err.message : String(err);
      throw new MobileClientError('NETWORK_ERROR', `Network error: ${message}`, {
        method,
        path,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Run response interceptor
    if (this.onResponse) {
      response = await this.onResponse(response);
    }

    // Handle non-2xx responses
    if (!response.ok) {
      let errorBody: Record<string, unknown> | null = null;

      try {
        errorBody = (await response.json()) as Record<string, unknown>;
      } catch {
        // Response body isn't JSON — ignore.
      }

      const errorCode =
        typeof errorBody?.code === 'string' ? errorBody.code : `HTTP_${response.status}`;
      const errorMessage =
        typeof errorBody?.error === 'string'
          ? errorBody.error
          : typeof errorBody?.message === 'string'
            ? (errorBody.message as string)
            : `HTTP ${response.status} ${response.statusText}`;

      throw new MobileClientError(errorCode, errorMessage, {
        status: response.status,
        statusText: response.statusText,
        body: errorBody,
        method,
        path,
      });
    }

    // Parse success response
    const data = (await response.json()) as T;
    return data;
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  /** GET /api/health — control plane health check. */
  async health(detail = false): Promise<HealthResponse> {
    const qs = detail ? '?detail=true' : '';
    return this.request<HealthResponse>('GET', `/api/health${qs}`);
  }

  // -----------------------------------------------------------------------
  // Machines
  // -----------------------------------------------------------------------

  /** GET /api/machines — list registered machines. */
  async listMachines(): Promise<Machine[]> {
    return this.request<Machine[]>('GET', '/api/machines/');
  }

  // -----------------------------------------------------------------------
  // Agents
  // -----------------------------------------------------------------------

  /** GET /api/machines/agents/list — list all agents, optionally filtered by machineId. */
  async listAgents(machineId?: string): Promise<Agent[]> {
    const qs = machineId ? `?machineId=${encodeURIComponent(machineId)}` : '';
    return this.request<Agent[]>('GET', `/api/machines/agents/list${qs}`);
  }

  /** GET /api/machines/agents/:agentId — get a single agent by ID. */
  async getAgent(agentId: string): Promise<Agent> {
    return this.request<Agent>('GET', `/api/machines/agents/${encodeURIComponent(agentId)}`);
  }

  /** POST /api/machines/:id/start — start an agent. */
  async startAgent(agentId: string, params: StartAgentRequest): Promise<StartAgentResponse> {
    return this.request<StartAgentResponse>(
      'POST',
      `/api/machines/${encodeURIComponent(agentId)}/start`,
      params,
    );
  }

  /** POST /api/machines/:id/stop — stop an agent. */
  async stopAgent(
    agentId: string,
    reason: 'user' | 'timeout' | 'error' | 'schedule' = 'user',
    graceful = true,
  ): Promise<StopAgentResponse> {
    return this.request<StopAgentResponse>(
      'POST',
      `/api/machines/${encodeURIComponent(agentId)}/stop`,
      { reason, graceful },
    );
  }

  /** POST /api/machines/:id/signal — send a signal to a running agent. */
  async signalAgent(agentId: string, body: SignalAgentRequest): Promise<SignalAgentResponse> {
    return this.request<SignalAgentResponse>(
      'POST',
      `/api/machines/${encodeURIComponent(agentId)}/signal`,
      body,
    );
  }

  /** GET /api/machines/agents/:agentId/runs — list recent runs for an agent. */
  async getAgentRuns(agentId: string, limit?: number): Promise<AgentRun[]> {
    const qs = limit !== undefined ? `?limit=${limit}` : '';
    return this.request<AgentRun[]>(
      'GET',
      `/api/machines/agents/${encodeURIComponent(agentId)}/runs${qs}`,
    );
  }

  // -----------------------------------------------------------------------
  // Scheduler
  // -----------------------------------------------------------------------

  /** GET /api/scheduler/jobs — list all repeatable scheduler jobs. */
  async getSchedulerJobs(): Promise<{ jobs: SchedulerJob[] }> {
    return this.request<{ jobs: SchedulerJob[] }>('GET', '/api/scheduler/jobs');
  }

  // -----------------------------------------------------------------------
  // Memory
  // -----------------------------------------------------------------------

  /** POST /api/memory/search — semantic search over memories. */
  async searchMemory(
    query: string,
    opts?: { agentId?: string; limit?: number },
  ): Promise<{ results: MemorySearchResult[] }> {
    return this.request<{ results: MemorySearchResult[] }>('POST', '/api/memory/search', {
      query,
      ...opts,
    });
  }

  // -----------------------------------------------------------------------
  // Audit
  // -----------------------------------------------------------------------

  /** GET /api/audit — query audit actions with filters and pagination. */
  async getAuditActions(params?: AuditQueryParams): Promise<AuditQueryResponse> {
    const qs = params
      ? buildQueryString({
          agentId: params.agentId,
          from: params.from,
          to: params.to,
          tool: params.tool,
          limit: params.limit,
          offset: params.offset,
        })
      : '';
    return this.request<AuditQueryResponse>('GET', `/api/audit${qs}`);
  }

  /** GET /api/audit/summary — aggregated audit statistics. */
  async getAuditSummary(params?: {
    agentId?: string;
    from?: string;
    to?: string;
  }): Promise<AuditSummary> {
    const qs = params
      ? buildQueryString({
          agentId: params.agentId,
          from: params.from,
          to: params.to,
        })
      : '';
    return this.request<AuditSummary>('GET', `/api/audit/summary${qs}`);
  }
}
