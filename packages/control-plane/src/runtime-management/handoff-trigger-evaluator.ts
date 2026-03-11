import type {
  AutoHandoffPolicy,
  AutoHandoffTaskAffinityRule,
  HandoffTriggerSignal,
  ManagedRuntime,
  RunHandoffDecision,
} from '@agentctl/shared';

export type EvaluatedHandoffDecision = Omit<
  RunHandoffDecision,
  'id' | 'createdAt' | 'updatedAt'
> & {
  targetRuntime: ManagedRuntime | null;
};

export function evaluateTrigger(
  signal: HandoffTriggerSignal,
  context: {
    policy: AutoHandoffPolicy;
    automaticHandoffsSoFar: number;
    lastTriggeredAt: string | null;
  },
): EvaluatedHandoffDecision {
  const baseDecision = createBaseDecision(signal, context.policy);

  if (!context.policy.enabled) {
    return { ...baseDecision, status: 'skipped', skippedReason: 'auto handoff is disabled' };
  }

  if (context.automaticHandoffsSoFar >= context.policy.maxAutomaticHandoffsPerRun) {
    return {
      ...baseDecision,
      status: 'skipped',
      skippedReason: 'maxAutomaticHandoffsPerRun exhausted for this run',
    };
  }

  if (isCooldownActive(signal.observedAt, context.lastTriggeredAt, context.policy.cooldownMs)) {
    return {
      ...baseDecision,
      status: 'skipped',
      skippedReason: 'cooldown is still active for automatic handoff evaluation',
    };
  }

  if (signal.trigger !== 'task-affinity' || signal.stage !== 'dispatch') {
    return {
      ...baseDecision,
      status: 'skipped',
      skippedReason: 'only dispatch-stage task-affinity evaluation is supported in phase 1',
    };
  }

  const prompt = typeof signal.payload.prompt === 'string' ? signal.payload.prompt : '';
  const match = selectBestTaskAffinityRule(prompt, context.policy);

  if (!match) {
    return {
      ...baseDecision,
      status: 'skipped',
      skippedReason: 'no task-affinity rule matched this prompt',
    };
  }

  if (match.targetRuntime === signal.sourceRuntime) {
    return {
      ...baseDecision,
      dedupeKey: buildDedupeKey(signal.runId, signal.stage, signal.trigger, match.targetRuntime),
      targetRuntime: null,
      status: 'skipped',
      reason: match.reason,
      skippedReason: 'target runtime already matches the current runtime',
      signalPayload: {
        ...signal.payload,
        matchedRuleId: match.id,
        matchedRuleReason: match.reason,
      },
    };
  }

  const status = context.policy.mode === 'execute' ? 'scheduled' : 'suggested';
  return {
    ...baseDecision,
    dedupeKey: buildDedupeKey(signal.runId, signal.stage, signal.trigger, match.targetRuntime),
    targetRuntime: match.targetRuntime,
    status,
    reason: match.reason,
    skippedReason: null,
    signalPayload: {
      ...signal.payload,
      matchedRuleId: match.id,
      matchedRuleReason: match.reason,
      targetRuntime: match.targetRuntime,
    },
  };
}

function createBaseDecision(
  signal: HandoffTriggerSignal,
  policy: AutoHandoffPolicy,
): EvaluatedHandoffDecision {
  return {
    sourceRunId: signal.runId,
    sourceManagedSessionId: signal.managedSessionId,
    targetRunId: null,
    handoffId: null,
    trigger: signal.trigger,
    stage: signal.stage,
    mode: policy.mode,
    status: 'skipped',
    dedupeKey: buildDedupeKey(signal.runId, signal.stage, signal.trigger, 'none'),
    targetRuntime: null,
    reason: null,
    skippedReason: null,
    policySnapshot: policy as unknown as Record<string, unknown>,
    signalPayload: signal.payload,
  };
}

function buildDedupeKey(
  runId: string,
  stage: HandoffTriggerSignal['stage'],
  trigger: HandoffTriggerSignal['trigger'],
  targetRuntime: ManagedRuntime | 'none',
): string {
  return `${runId}:${stage}:${trigger}:${targetRuntime}`;
}

function isCooldownActive(
  observedAt: string,
  lastTriggeredAt: string | null,
  cooldownMs: number,
): boolean {
  if (!lastTriggeredAt) {
    return false;
  }

  const observedAtMs = Date.parse(observedAt);
  const lastTriggeredAtMs = Date.parse(lastTriggeredAt);
  if (!Number.isFinite(observedAtMs) || !Number.isFinite(lastTriggeredAtMs)) {
    return false;
  }

  return observedAtMs - lastTriggeredAtMs < cooldownMs;
}

function selectBestTaskAffinityRule(
  prompt: string,
  policy: AutoHandoffPolicy,
): AutoHandoffTaskAffinityRule | null {
  if (!policy.taskAffinity?.enabled) {
    return null;
  }

  const rules = policy.taskAffinity.rules
    .filter((rule) => matchesTaskAffinity(prompt, rule.match))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));

  return rules[0] ?? null;
}

function matchesTaskAffinity(
  prompt: string,
  matcher: AutoHandoffTaskAffinityRule['match'],
): boolean {
  const normalized = prompt.toLowerCase();

  switch (matcher) {
    case 'python-heavy':
      return ['python', 'pytest', 'pydantic', 'fastapi', '.py'].some((token) =>
        normalized.includes(token),
      );
    case 'frontend-heavy':
      return ['frontend', 'react', 'next.js', 'tailwind', 'css', 'ui'].some((token) =>
        normalized.includes(token),
      );
    case 'claude-context-heavy':
      return ['claude', 'resume session', 'existing session context', 'conversation context'].some(
        (token) => normalized.includes(token),
      );
    case 'long-running':
      return ['long-running', 'long running', 'multi-step', 'multi step', 'large refactor'].some(
        (token) => normalized.includes(token),
      );
    default:
      return false;
  }
}
