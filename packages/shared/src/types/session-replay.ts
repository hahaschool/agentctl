export type ReplayEvent = {
  timestamp: string;
  eventType: 'tool_call' | 'tool_result' | 'status_change' | 'error' | 'cost_update';
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  decision?: 'allow' | 'deny';
  denyReason?: string;
  status?: string;
  costUsd?: number;
  durationMs?: number;
};

export type SessionTimeline = {
  sessionId: string;
  agentId: string;
  startedAt: string;
  endedAt?: string;
  totalEvents: number;
  totalCostUsd: number;
  toolsUsed: string[];
  deniedCalls: number;
  events: ReplayEvent[];
};

export type ReplayFilter = {
  sessionId?: string;
  agentId?: string;
  fromTimestamp?: string;
  toTimestamp?: string;
  toolName?: string;
  eventType?: ReplayEvent['eventType'];
  limit?: number;
  offset?: number;
};
