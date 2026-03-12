// ── Agent Identity: Profile + Instance ──────────────────────

export const AGENT_RUNTIME_TYPES = ['claude-code', 'codex', 'openclaw', 'nanoclaw'] as const;
export type AgentRuntimeType = (typeof AGENT_RUNTIME_TYPES)[number];

export const AGENT_INSTANCE_STATUSES = ['idle', 'running', 'paused', 'crashed'] as const;
export type AgentInstanceStatus = (typeof AGENT_INSTANCE_STATUSES)[number];

export function isAgentRuntimeType(v: string): v is AgentRuntimeType {
  return (AGENT_RUNTIME_TYPES as readonly string[]).includes(v);
}

export function isAgentInstanceStatus(v: string): v is AgentInstanceStatus {
  return (AGENT_INSTANCE_STATUSES as readonly string[]).includes(v);
}

export type AgentProfile = {
  readonly id: string;
  readonly name: string;
  readonly runtimeType: AgentRuntimeType;
  readonly modelId: string;
  readonly providerId: string;
  readonly capabilities: readonly string[];
  readonly toolScopes: readonly string[];
  readonly maxTokensPerTask: number | null;
  readonly maxCostPerHour: number | null;
  readonly createdAt: string;
};

export type AgentInstance = {
  readonly id: string;
  readonly profileId: string;
  readonly machineId: string | null;
  readonly worktreeId: string | null;
  readonly runtimeSessionId: string | null;
  readonly status: AgentInstanceStatus;
  readonly heartbeatAt: string;
  readonly startedAt: string;
};
