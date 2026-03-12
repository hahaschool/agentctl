// ── Task Graph types for §10.3 Multi-Agent Collaboration Phase 3 ──

// ── Task Node Types ──────────────────────────────────────────
export const TASK_NODE_TYPES = ['task', 'gate', 'fork', 'join'] as const;
export type TaskNodeType = (typeof TASK_NODE_TYPES)[number];

export function isTaskNodeType(v: string): v is TaskNodeType {
  return (TASK_NODE_TYPES as readonly string[]).includes(v);
}

// ── Task Edge Types ──────────────────────────────────────────
export const TASK_EDGE_TYPES = ['blocks', 'context'] as const;
export type TaskEdgeType = (typeof TASK_EDGE_TYPES)[number];

export function isTaskEdgeType(v: string): v is TaskEdgeType {
  return (TASK_EDGE_TYPES as readonly string[]).includes(v);
}

// ── Task Run Statuses ────────────────────────────────────────
export const TASK_RUN_STATUSES = [
  'pending',
  'claimed',
  'running',
  'blocked',
  'completed',
  'failed',
  'cancelled',
] as const;
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number];

export function isTaskRunStatus(v: string): v is TaskRunStatus {
  return (TASK_RUN_STATUSES as readonly string[]).includes(v);
}

// ── Worker Node Statuses ─────────────────────────────────────
export const WORKER_NODE_STATUSES = ['online', 'offline', 'draining'] as const;
export type WorkerNodeStatus = (typeof WORKER_NODE_STATUSES)[number];

export function isWorkerNodeStatus(v: string): v is WorkerNodeStatus {
  return (WORKER_NODE_STATUSES as readonly string[]).includes(v);
}

// ── Domain Types ─────────────────────────────────────────────

export type TaskGraph = {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
};

export type TaskDefinition = {
  readonly id: string;
  readonly graphId: string;
  readonly type: TaskNodeType;
  readonly name: string;
  readonly description: string;
  readonly requiredCapabilities: string[];
  readonly estimatedTokens: number | null;
  readonly timeoutMs: number;
  readonly maxRetryAttempts: number;
  readonly retryBackoffMs: number;
  readonly createdAt: string;
};

export type TaskEdge = {
  readonly fromDefinition: string;
  readonly toDefinition: string;
  readonly type: TaskEdgeType;
};

export type TaskRun = {
  readonly id: string;
  readonly definitionId: string;
  readonly spaceId: string | null;
  readonly threadId: string | null;
  readonly status: TaskRunStatus;
  readonly attempt: number;
  readonly assigneeInstanceId: string | null;
  readonly machineId: string | null;
  readonly claimedAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly lastHeartbeatAt: string | null;
  readonly result: Record<string, unknown> | null;
  readonly error: Record<string, unknown> | null;
  readonly createdAt: string;
};

export type WorkerLease = {
  readonly taskRunId: string;
  readonly workerId: string;
  readonly agentInstanceId: string;
  readonly expiresAt: string;
  readonly renewedAt: string;
};

export type WorkerNode = {
  readonly id: string;
  readonly hostname: string;
  readonly tailscaleIp: string;
  readonly maxConcurrentAgents: number;
  readonly currentLoad: number;
  readonly capabilities: string[];
  readonly status: WorkerNodeStatus;
  readonly lastHeartbeatAt: string;
  readonly createdAt: string;
};

// AgentProfile and AgentInstance are defined in agent-identity.ts

// ── Fleet Overview ───────────────────────────────────────────

export type FleetOverview = {
  readonly totalNodes: number;
  readonly onlineNodes: number;
  readonly offlineNodes: number;
  readonly drainingNodes: number;
  readonly totalAgentInstances: number;
  readonly activeTaskRuns: number;
  readonly pendingTaskRuns: number;
  readonly completedTaskRuns: number;
  readonly failedTaskRuns: number;
};
