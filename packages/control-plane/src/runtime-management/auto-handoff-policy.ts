import type { AutoHandoffPolicy } from '@agentctl/shared';

const DEFAULT_TASK_AFFINITY_RULES: NonNullable<AutoHandoffPolicy['taskAffinity']>['rules'] = [
  {
    id: 'python-heavy-to-codex',
    match: 'python-heavy',
    targetRuntime: 'codex',
    reason: 'Python-heavy implementation work is usually a better fit for Codex.',
    priority: 100,
  },
  {
    id: 'frontend-heavy-to-claude',
    match: 'frontend-heavy',
    targetRuntime: 'claude-code',
    reason: 'Frontend-heavy interface work benefits from Claude Code session context.',
    priority: 80,
  },
  {
    id: 'claude-context-heavy-to-claude',
    match: 'claude-context-heavy',
    targetRuntime: 'claude-code',
    reason: 'Claude-heavy session continuity is better preserved on Claude Code.',
    priority: 70,
  },
  {
    id: 'long-running-to-claude',
    match: 'long-running',
    targetRuntime: 'claude-code',
    reason: 'Long-running orchestration defaults to Claude Code in the initial rollout.',
    priority: 60,
  },
];

export const DEFAULT_AUTO_HANDOFF_POLICY: AutoHandoffPolicy = {
  enabled: true,
  mode: 'dry-run',
  maxAutomaticHandoffsPerRun: 1,
  cooldownMs: 10 * 60 * 1_000,
  taskAffinity: {
    enabled: true,
    rules: DEFAULT_TASK_AFFINITY_RULES,
  },
};

export function resolveAutoHandoffPolicy(params: {
  agentConfig?: Record<string, unknown> | null;
  managedSessionMetadata?: Record<string, unknown> | null;
  defaultPolicy?: AutoHandoffPolicy;
}): AutoHandoffPolicy {
  const defaultPolicy = params.defaultPolicy ?? DEFAULT_AUTO_HANDOFF_POLICY;
  const agentOverride = extractAutoHandoffPolicy(params.agentConfig);
  if (agentOverride) {
    return agentOverride;
  }

  const sessionOverride = extractAutoHandoffPolicy(params.managedSessionMetadata);
  if (sessionOverride) {
    return sessionOverride;
  }

  return defaultPolicy;
}

function extractAutoHandoffPolicy(
  source?: Record<string, unknown> | null,
): AutoHandoffPolicy | null {
  if (!source) {
    return null;
  }

  const candidate = source.autoHandoff;
  return isAutoHandoffPolicy(candidate) ? candidate : null;
}

function isAutoHandoffPolicy(value: unknown): value is AutoHandoffPolicy {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.enabled === 'boolean' &&
    (value.mode === 'dry-run' || value.mode === 'execute') &&
    typeof value.maxAutomaticHandoffsPerRun === 'number' &&
    typeof value.cooldownMs === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
