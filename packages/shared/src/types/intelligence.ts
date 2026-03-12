// ── Intelligence Layer types for §10.5 Multi-Agent Collaboration Phase 5 ──

// ── Routing ────────────────────────────────────────────────────

export type RoutingCandidate = {
  readonly profileId: string;
  readonly nodeId: string;
  readonly score: number;
  readonly breakdown: RoutingScoreBreakdown;
};

export type RoutingScoreBreakdown = {
  readonly capabilityMatch: number;
  readonly loadScore: number;
  readonly costScore: number;
  readonly successRateScore: number;
  readonly durationScore: number;
  readonly weightedTotal: number;
};

export type RoutingRequest = {
  readonly taskDefinitionId: string;
  readonly requiredCapabilities: readonly string[];
  readonly machineRequirements?: readonly string[];
  readonly estimatedTokens: number | null;
  readonly limit?: number;
};

export type RoutingDecision = {
  readonly id: string;
  readonly taskDefinitionId: string;
  readonly taskRunId: string;
  readonly selectedProfileId: string;
  readonly selectedNodeId: string;
  readonly score: number;
  readonly breakdown: RoutingScoreBreakdown;
  readonly mode: 'auto' | 'suggested';
  readonly createdAt: string;
};

// ── Outcome Tracking ───────────────────────────────────────────

export type RoutingOutcome = {
  readonly id: string;
  readonly routingDecisionId: string | null;
  readonly taskRunId: string;
  readonly profileId: string;
  readonly nodeId: string;
  readonly capabilities: readonly string[];
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly durationMs: number | null;
  readonly costUsd: number | null;
  readonly tokensUsed: number | null;
  readonly errorCode: string | null;
  readonly createdAt: string;
};

// ── Decomposition ──────────────────────────────────────────────

export type DecompositionRequest = {
  readonly description: string;
  readonly spaceId?: string;
  readonly constraints?: DecompositionConstraints;
};

export type DecompositionConstraints = {
  readonly maxSubTasks?: number;
  readonly maxDepthLevels?: number;
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
  readonly from: string;
  readonly to: string;
  readonly type: 'blocks' | 'context';
};

export type DecompositionResult = {
  readonly tasks: readonly DecomposedTask[];
  readonly edges: readonly DecomposedEdge[];
  readonly suggestedApprovalGates: readonly string[];
  readonly reasoning: string;
  readonly estimatedTotalTokens: number;
  readonly estimatedTotalCostUsd: number | null;
};

export type DecompositionResponse = {
  readonly graphId: string;
  readonly definitionIdMap: Record<string, string>;
  readonly result: DecompositionResult;
  readonly validationErrors: readonly string[];
};
