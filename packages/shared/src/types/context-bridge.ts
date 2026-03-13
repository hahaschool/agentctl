// ── Context Bridge types for §10.4 Cross-Space Context Mobility ──

// ── Context Ref Modes ────────────────────────────────────────
export const CONTEXT_REF_MODES = ['reference', 'copy', 'query', 'subscription'] as const;
export type ContextRefMode = (typeof CONTEXT_REF_MODES)[number];

export function isContextRefMode(v: string): v is ContextRefMode {
  return (CONTEXT_REF_MODES as readonly string[]).includes(v);
}

// ── Injection Methods ────────────────────────────────────────
export const INJECTION_METHODS = ['system-prompt', 'context-window', 'tool-accessible'] as const;
export type InjectionMethod = (typeof INJECTION_METHODS)[number];

export function isInjectionMethod(v: string): v is InjectionMethod {
  return (INJECTION_METHODS as readonly string[]).includes(v);
}

// ── Context Reference ────────────────────────────────────────
export type ContextRef = {
  readonly id: string;
  readonly sourceSpaceId: string;
  readonly sourceThreadId: string | null;
  readonly sourceEventId: string | null;
  readonly targetSpaceId: string;
  readonly targetThreadId: string;
  readonly mode: ContextRefMode;
  readonly snapshotPayload: Record<string, unknown> | null;
  readonly metadata: Record<string, unknown>;
  readonly createdBy: string;
  readonly createdAt: string;
};

// ── Cross-Space Query ────────────────────────────────────────
export type CrossSpaceQuery = {
  readonly spaceId: string;
  readonly query: string;
  readonly filters: Record<string, unknown>;
  readonly limit: number;
};

// ── MCP Tool: cross_space_query request/response ─────────────

export type CrossSpaceQueryTimeRange = {
  readonly start?: string;
  readonly end?: string;
};

export type CrossSpaceQueryRequest = {
  readonly spaceIds: readonly string[];
  readonly eventTypes?: readonly string[];
  readonly timeRange?: CrossSpaceQueryTimeRange;
  readonly textQuery?: string;
  readonly limit?: number;
};

export type CrossSpaceQueryResultEvent = {
  readonly id: string;
  readonly spaceId: string;
  readonly spaceName: string;
  readonly threadId: string;
  readonly sequenceNum: number;
  readonly type: string;
  readonly senderType: string;
  readonly senderId: string;
  readonly payload: Record<string, unknown>;
  readonly visibility: string;
  readonly createdAt: string;
};

export type CrossSpaceQueryResponse = {
  readonly events: readonly CrossSpaceQueryResultEvent[];
  readonly totalMatched: number;
  readonly truncated: boolean;
};

// ── Cross-Space Subscription ─────────────────────────────────
export type CrossSpaceSubscription = {
  readonly id: string;
  readonly sourceSpaceId: string;
  readonly targetSpaceId: string;
  readonly filterCriteria: Record<string, unknown>;
  readonly active: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
};

// ── Context Budget Management (§10.4) ───────────────────────

export const OVERFLOW_STRATEGIES = ['truncate', 'prioritize', 'reject'] as const;
export type OverflowStrategy = (typeof OVERFLOW_STRATEGIES)[number];

export function isOverflowStrategy(v: string): v is OverflowStrategy {
  return (OVERFLOW_STRATEGIES as readonly string[]).includes(v);
}

/** Token usage snapshot for a single space or the total across spaces. */
export type ContextBudget = {
  readonly maxTokens: number;
  readonly usedTokens: number;
  readonly remaining: number;
};

/** Policy governing how token budgets are enforced across spaces. */
export type ContextBudgetPolicy = {
  readonly perSpaceLimit: number;
  readonly totalLimit: number;
  readonly overflowStrategy: OverflowStrategy;
};

/** Per-space budget breakdown returned by the budget manager. */
export type ContextBudgetSummary = {
  readonly perSpace: Readonly<Record<string, ContextBudget>>;
  readonly total: ContextBudget;
};

export const DEFAULT_CONTEXT_BUDGET_POLICY: ContextBudgetPolicy = {
  perSpaceLimit: 4000,
  totalLimit: 16000,
  overflowStrategy: 'truncate',
};
