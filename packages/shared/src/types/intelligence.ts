// ── Intelligence Layer types for §10.5 Multi-Agent Collaboration Phase 5 ──

// ── Routing (Phase 5a) ──────────────────────────────────────

export type RoutingScoreBreakdown = {
  readonly capabilityMatch: number; // 1.0 = all required caps present
  readonly loadScore: number; // 1.0 = idle, 0.0 = at capacity
  readonly costScore: number; // normalized 0-1, lower cost = higher
  readonly successRateScore: number; // from historical outcomes
  readonly durationScore: number; // from historical outcomes
  readonly weightedTotal: number;
};

export type RoutingCandidate = {
  readonly profileId: string;
  readonly nodeId: string;
  readonly score: number;
  readonly breakdown: RoutingScoreBreakdown;
};

export type RoutingRequest = {
  readonly taskDefinitionId: string;
  readonly requiredCapabilities: readonly string[];
  readonly machineRequirements?: readonly string[];
  readonly estimatedTokens: number | null;
  readonly limit?: number; // max candidates to return (default 5)
};

export const ROUTING_MODES = ['auto', 'suggested'] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];

export type RoutingDecision = {
  readonly id: string;
  readonly taskDefinitionId: string;
  readonly taskRunId: string;
  readonly selectedProfileId: string;
  readonly selectedNodeId: string;
  readonly score: number;
  readonly breakdown: RoutingScoreBreakdown;
  readonly mode: RoutingMode;
  readonly createdAt: string;
};

// ── Outcome Tracking (Phase 5c) ─────────────────────────────

export const ROUTING_OUTCOME_STATUSES = ['completed', 'failed', 'cancelled'] as const;
export type RoutingOutcomeStatus = (typeof ROUTING_OUTCOME_STATUSES)[number];

export function isRoutingOutcomeStatus(v: string): v is RoutingOutcomeStatus {
  return (ROUTING_OUTCOME_STATUSES as readonly string[]).includes(v);
}

export type RoutingOutcome = {
  readonly id: string;
  readonly routingDecisionId: string | null;
  readonly taskRunId: string;
  readonly profileId: string;
  readonly nodeId: string;
  readonly capabilities: readonly string[];
  readonly status: RoutingOutcomeStatus;
  readonly durationMs: number | null;
  readonly costUsd: number | null;
  readonly tokensUsed: number | null;
  readonly errorCode: string | null;
  readonly createdAt: string;
};

export type ApprovalTiming = {
  readonly id: string;
  readonly gateId: string;
  readonly decidedBy: string;
  readonly capabilities: readonly string[];
  readonly decisionTimeMs: number;
  readonly timedOut: boolean;
  readonly createdAt: string;
};

export type AggregateStats = {
  readonly successRate: number;
  readonly avgDurationMs: number | null;
  readonly avgCostUsd: number | null;
  readonly count: number;
};

export type ApprovalTimingStats = {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly count: number;
};

// ── Decomposition (Phase 5b) ────────────────────────────────

export type DecompositionRequest = {
  readonly description: string;
  readonly spaceId?: string;
  readonly constraints?: DecompositionConstraints;
};

export type DecompositionConstraints = {
  readonly maxSubTasks?: number; // default 10
  readonly maxDepthLevels?: number; // default 4
  readonly requiredCapabilities?: readonly string[];
  readonly excludeCapabilities?: readonly string[];
  readonly budgetTokens?: number;
  readonly budgetCostUsd?: number;
};

export type DecomposedTask = {
  readonly tempId: string;
  readonly type: 'task' | 'gate';
  readonly name: string;
  readonly description: string;
  readonly requiredCapabilities: readonly string[];
  readonly estimatedTokens: number;
  readonly timeoutMs: number;
};

export type DecomposedEdge = {
  readonly from: string; // tempId
  readonly to: string; // tempId
  readonly type: 'blocks' | 'context';
};

export type DecompositionResult = {
  readonly tasks: readonly DecomposedTask[];
  readonly edges: readonly DecomposedEdge[];
  readonly suggestedApprovalGates: readonly string[]; // tempIds of gate nodes
  readonly reasoning: string;
  readonly estimatedTotalTokens: number;
  readonly estimatedTotalCostUsd: number | null;
};

export type DecompositionResponse = {
  readonly graphId: string;
  readonly definitionIdMap: Record<string, string>; // tempId -> real UUID
  readonly result: DecompositionResult;
  readonly validationErrors: readonly string[];
};

// ── Notification Routing (Phase 5d) ─────────────────────────

export const NOTIFICATION_PRIORITIES = ['critical', 'high', 'normal', 'low'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const NOTIFICATION_CHANNELS = [
  'push',
  'webhook-slack',
  'webhook-discord',
  'webhook-generic',
  'in-app',
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationPreference = {
  readonly id: string;
  readonly userId: string;
  readonly priority: NotificationPriority;
  readonly channels: readonly NotificationChannel[];
  readonly quietHoursStart?: string; // HH:MM in user's timezone
  readonly quietHoursEnd?: string;
  readonly timezone?: string; // IANA timezone
  readonly createdAt: string;
};

export type NotificationRoutingRule = {
  readonly eventType: string; // WebhookEventType or '*'
  readonly priority: NotificationPriority;
  readonly escalateAfterMs?: number; // auto-escalate if unacknowledged
  readonly escalateTo?: NotificationPriority;
};
