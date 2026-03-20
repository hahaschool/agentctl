/**
 * Shared test helpers for integration tests and scheduler tests.
 *
 * Eliminates duplicated makeAgent, makeMachine, createMockDbRegistry,
 * mockFetchSuccess, mockFetchFailure, and mockFetchConnectionError factories
 * that were copy-pasted across dispatch-lifecycle, dispatch-failover,
 * websocket-lifecycle, and task-worker test files.
 */
import type { Job } from 'bullmq';
import { vi } from 'vitest';

import type { DbAgentRegistry } from '../registry/db-registry.js';
import type { AgentTaskJobData, AgentTaskJobName } from '../scheduler/task-queue.js';

// ---------------------------------------------------------------------------
// Agent factory
// ---------------------------------------------------------------------------

export function makeAgent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'agent-abc',
    machineId: 'machine-xyz',
    name: 'Test Agent',
    type: 'manual' as const,
    status: 'registered' as const,
    schedule: null,
    projectPath: '/home/user/project',
    worktreeBranch: null,
    currentSessionId: null,
    config: { model: 'claude-sonnet-4-20250514' },
    lastRunAt: null,
    lastCostUsd: null,
    totalCostUsd: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Machine factory
// ---------------------------------------------------------------------------

export function makeMachine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'machine-xyz',
    hostname: 'ec2-worker.tailnet',
    tailscaleIp: '100.64.0.1',
    os: 'linux' as const,
    arch: 'x64' as const,
    status: 'online' as const,
    lastHeartbeat: new Date(),
    capabilities: { gpu: false, docker: true, maxConcurrentAgents: 5 },
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DbAgentRegistry mock
// ---------------------------------------------------------------------------

export function createMockDbRegistry(overrides: Partial<DbAgentRegistry> = {}): DbAgentRegistry {
  return {
    getAgent: vi.fn().mockResolvedValue(makeAgent()),
    getMachine: vi.fn().mockResolvedValue(makeMachine()),
    createRun: vi.fn().mockResolvedValue('run-001'),
    updateRunPhase: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn().mockResolvedValue(undefined),
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn().mockResolvedValue([]),
    createAgent: vi.fn(),
    updateAgentStatus: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getRecentRuns: vi.fn().mockResolvedValue([]),
    insertActions: vi.fn(),
    ...overrides,
  } as unknown as DbAgentRegistry;
}

// ---------------------------------------------------------------------------
// Fetch mocks (using vi.stubGlobal)
// ---------------------------------------------------------------------------

export function mockFetchSuccess(
  body: Record<string, unknown> = { ok: true, message: 'dispatched' },
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(body),
      text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    }),
  );
}

export function mockFetchFailure(status = 500, body = 'Internal Server Error'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: vi.fn().mockRejectedValue(new Error('not json')),
      text: vi.fn().mockResolvedValue(body),
    }),
  );
}

export function mockFetchConnectionError(errorMessage = 'ECONNREFUSED'): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(errorMessage)));
}

type FetchMockCall = [input: string | URL | Request, init?: RequestInit];

export function getFetchMockCalls(): FetchMockCall[] {
  return vi.mocked(fetch).mock.calls as FetchMockCall[];
}

export function getMcpDiscoveryFetchCall(): FetchMockCall | undefined {
  return getFetchMockCalls().find(([input]) =>
    String(input).includes('/api/mcp/discover?runtime=claude-code'),
  );
}

export function getDispatchFetchCall(): FetchMockCall | undefined {
  return getFetchMockCalls().find(([input]) => String(input).includes('/api/agents/'));
}

// ---------------------------------------------------------------------------
// Job factory
// ---------------------------------------------------------------------------

export function makeJob(
  overrides: Partial<AgentTaskJobData> = {},
  jobName: AgentTaskJobName = 'agent:start',
): Job<AgentTaskJobData, void, AgentTaskJobName> {
  const data: AgentTaskJobData = {
    agentId: 'agent-abc',
    machineId: 'machine-xyz',
    prompt: 'Implement the feature',
    model: 'claude-opus-4-6',
    trigger: 'manual',
    allowedTools: null,
    resumeSession: null,
    createdAt: '2026-03-02T00:00:00Z',
    ...overrides,
  };

  return {
    id: 'job-1',
    name: jobName,
    data,
    attemptsMade: 0,
    updateData: async (newData: AgentTaskJobData) => {
      Object.assign(data, newData);
    },
  } as unknown as Job<AgentTaskJobData, void, AgentTaskJobName>;
}
