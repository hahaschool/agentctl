// ---------------------------------------------------------------------------
// Agents — CRUD, start/stop/steer, runs, health
// ---------------------------------------------------------------------------

import type {
  AgentConfig,
  AgentRuntime,
  AgentStatus,
  AgentType,
  ExecutionSummary,
  MachineCapabilities,
  MachineStatus,
} from '@agentctl/shared';

import { request } from './core';

export type Machine = {
  id: string;
  hostname: string;
  tailscaleIp: string;
  os: string;
  arch: string;
  status: MachineStatus;
  lastHeartbeat: string | null;
  originNodeId?: string | null;
  originNodeHostname?: string | null;
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
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  startedAt: string;
  finishedAt?: string | null;
  errorMessage?: string;
  resultSummary?: ExecutionSummary | string | null;
  sessionId?: string | null;
  retryOf?: string | null;
  retryIndex?: number | null;
};

export const agentsApi = {
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
  emergencyStopAgent: (id: string) =>
    request<{ ok: boolean }>(`/api/agents/${encodeURIComponent(id)}/emergency-stop`, {
      method: 'POST',
    }),
  emergencyStopAll: () =>
    request<{
      ok: boolean;
      results: { machineId: string; stoppedCount: number; error?: string }[];
    }>('/api/agents/emergency-stop-all', {
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
};
