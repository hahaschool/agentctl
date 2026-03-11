import { describe, expect, it } from 'vitest';

import type {
  AutoHandoffPolicy,
  HandoffTriggerSignal,
  RunHandoffDecision,
} from './auto-handoff.js';
import {
  AUTO_HANDOFF_DECISION_STATUSES,
  AUTO_HANDOFF_MODES,
  AUTO_HANDOFF_STAGES,
  AUTO_HANDOFF_TASK_MATCHERS,
  AUTO_HANDOFF_TRIGGERS,
  isAutoHandoffDecisionStatus,
  isAutoHandoffMode,
  isAutoHandoffStage,
  isAutoHandoffTaskMatcher,
  isAutoHandoffTrigger,
} from './auto-handoff.js';

describe('auto-handoff types', () => {
  it('defines the supported trigger lifecycle constants and guards', () => {
    expect(AUTO_HANDOFF_TRIGGERS).toEqual(['task-affinity', 'rate-limit', 'cost-threshold']);
    expect(AUTO_HANDOFF_STAGES).toEqual(['dispatch', 'live']);
    expect(AUTO_HANDOFF_MODES).toEqual(['dry-run', 'execute']);
    expect(AUTO_HANDOFF_DECISION_STATUSES).toEqual([
      'suggested',
      'scheduled',
      'executed',
      'skipped',
      'failed',
    ]);
    expect(AUTO_HANDOFF_TASK_MATCHERS).toEqual([
      'python-heavy',
      'frontend-heavy',
      'claude-context-heavy',
      'long-running',
    ]);

    expect(isAutoHandoffTrigger('task-affinity')).toBe(true);
    expect(isAutoHandoffTrigger('manual')).toBe(false);
    expect(isAutoHandoffStage('dispatch')).toBe(true);
    expect(isAutoHandoffStage('after')).toBe(false);
    expect(isAutoHandoffMode('execute')).toBe(true);
    expect(isAutoHandoffMode('disabled')).toBe(false);
    expect(isAutoHandoffDecisionStatus('failed')).toBe(true);
    expect(isAutoHandoffDecisionStatus('pending')).toBe(false);
    expect(isAutoHandoffTaskMatcher('python-heavy')).toBe(true);
    expect(isAutoHandoffTaskMatcher('backend-heavy')).toBe(false);
  });

  it('defines a policy shape that supports affinity, cooldown, and execution mode', () => {
    const policy: AutoHandoffPolicy = {
      enabled: true,
      mode: 'dry-run',
      maxAutomaticHandoffsPerRun: 2,
      cooldownMs: 60_000,
      taskAffinity: {
        enabled: true,
        rules: [
          {
            id: 'python-to-codex',
            match: 'python-heavy',
            targetRuntime: 'codex',
            reason: 'Prefer Codex for Python-heavy implementation work.',
            priority: 100,
          },
        ],
      },
      rateLimitFailover: {
        enabled: true,
        targetRuntimeOrder: ['claude-code', 'codex'],
        retryBudget: 1,
      },
      costThreshold: {
        enabled: true,
        thresholdUsd: 3,
        targetRuntime: 'codex',
        minRemainingWorkSignal: 'best-effort',
      },
    };

    expect(policy.taskAffinity?.rules[0]?.targetRuntime).toBe('codex');
    expect(policy.rateLimitFailover?.targetRuntimeOrder).toContain('claude-code');
    expect(policy.costThreshold?.minRemainingWorkSignal).toBe('best-effort');
  });

  it('defines a normalized trigger signal and run-level decision journal record', () => {
    const signal: HandoffTriggerSignal = {
      runId: 'run-1',
      managedSessionId: 'ms-1',
      sourceRuntime: 'claude-code',
      trigger: 'task-affinity',
      stage: 'dispatch',
      observedAt: '2026-03-11T10:00:00.000Z',
      payload: {
        prompt: 'Refactor the Python API client and its tests.',
        preferredRuntime: 'codex',
      },
    };

    const decision: RunHandoffDecision = {
      id: 'decision-1',
      sourceRunId: 'run-1',
      sourceManagedSessionId: 'ms-1',
      targetRunId: null,
      handoffId: null,
      trigger: 'task-affinity',
      stage: 'dispatch',
      mode: 'dry-run',
      status: 'suggested',
      dedupeKey: 'run-1:task-affinity:codex',
      reason: 'Prompt contains Python-heavy implementation work.',
      skippedReason: null,
      policySnapshot: {
        enabled: true,
        mode: 'dry-run',
        maxAutomaticHandoffsPerRun: 1,
        cooldownMs: 60_000,
      },
      signalPayload: signal.payload,
      createdAt: '2026-03-11T10:00:01.000Z',
      updatedAt: '2026-03-11T10:00:01.000Z',
    };

    expect(decision.signalPayload).toEqual(signal.payload);
    expect(decision.status).toBe('suggested');
    expect(decision.stage).toBe('dispatch');
    expect(decision.trigger).toBe('task-affinity');
  });
});
