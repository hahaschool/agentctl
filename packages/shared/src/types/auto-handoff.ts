import type { ManagedRuntime } from './runtime-management.js';

export const AUTO_HANDOFF_TRIGGERS = [
  'task-affinity',
  'rate-limit',
  'cost-threshold',
] as const;

export type AutoHandoffTrigger = (typeof AUTO_HANDOFF_TRIGGERS)[number];

export const AUTO_HANDOFF_STAGES = ['dispatch', 'live'] as const;

export type AutoHandoffStage = (typeof AUTO_HANDOFF_STAGES)[number];

export const AUTO_HANDOFF_MODES = ['dry-run', 'execute'] as const;

export type AutoHandoffMode = (typeof AUTO_HANDOFF_MODES)[number];

export const AUTO_HANDOFF_DECISION_STATUSES = [
  'suggested',
  'scheduled',
  'executed',
  'skipped',
  'failed',
] as const;

export type AutoHandoffDecisionStatus = (typeof AUTO_HANDOFF_DECISION_STATUSES)[number];

export const AUTO_HANDOFF_TASK_MATCHERS = [
  'python-heavy',
  'frontend-heavy',
  'claude-context-heavy',
  'long-running',
] as const;

export type AutoHandoffTaskMatcher = (typeof AUTO_HANDOFF_TASK_MATCHERS)[number];

export type AutoHandoffTaskAffinityRule = {
  id: string;
  match: AutoHandoffTaskMatcher;
  targetRuntime: ManagedRuntime;
  reason: string;
  priority: number;
};

export type AutoHandoffPolicy = {
  enabled: boolean;
  mode: AutoHandoffMode;
  maxAutomaticHandoffsPerRun: number;
  cooldownMs: number;
  taskAffinity?: {
    enabled: boolean;
    rules: AutoHandoffTaskAffinityRule[];
  };
  rateLimitFailover?: {
    enabled: boolean;
    targetRuntimeOrder: ManagedRuntime[];
    retryBudget: number;
  };
  costThreshold?: {
    enabled: boolean;
    thresholdUsd: number;
    targetRuntime: ManagedRuntime;
    minRemainingWorkSignal: 'required' | 'best-effort';
  };
};

export type HandoffTriggerSignal = {
  runId: string;
  managedSessionId: string | null;
  sourceRuntime: ManagedRuntime;
  trigger: AutoHandoffTrigger;
  stage: AutoHandoffStage;
  observedAt: string;
  payload: Record<string, unknown>;
};

export type RunHandoffDecision = {
  id: string;
  sourceRunId: string;
  sourceManagedSessionId: string | null;
  targetRunId: string | null;
  handoffId: string | null;
  trigger: AutoHandoffTrigger;
  stage: AutoHandoffStage;
  mode: AutoHandoffMode;
  status: AutoHandoffDecisionStatus;
  dedupeKey: string;
  reason: string | null;
  skippedReason: string | null;
  policySnapshot: Record<string, unknown>;
  signalPayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export function isAutoHandoffTrigger(value: string): value is AutoHandoffTrigger {
  return (AUTO_HANDOFF_TRIGGERS as readonly string[]).includes(value);
}

export function isAutoHandoffStage(value: string): value is AutoHandoffStage {
  return (AUTO_HANDOFF_STAGES as readonly string[]).includes(value);
}

export function isAutoHandoffMode(value: string): value is AutoHandoffMode {
  return (AUTO_HANDOFF_MODES as readonly string[]).includes(value);
}

export function isAutoHandoffDecisionStatus(value: string): value is AutoHandoffDecisionStatus {
  return (AUTO_HANDOFF_DECISION_STATUSES as readonly string[]).includes(value);
}

export function isAutoHandoffTaskMatcher(value: string): value is AutoHandoffTaskMatcher {
  return (AUTO_HANDOFF_TASK_MATCHERS as readonly string[]).includes(value);
}
