import type { AutoHandoffPolicy, HandoffTriggerSignal } from '@agentctl/shared';
import { describe, expect, it } from 'vitest';

import { evaluateTrigger } from './handoff-trigger-evaluator.js';

function makePolicy(overrides: Partial<AutoHandoffPolicy> = {}): AutoHandoffPolicy {
  return {
    enabled: true,
    mode: 'dry-run',
    maxAutomaticHandoffsPerRun: 1,
    cooldownMs: 60_000,
    taskAffinity: {
      enabled: true,
      rules: [
        {
          id: 'python-to-codex',
          match: 'python-heavy',
          targetRuntime: 'codex',
          reason: 'Prefer Codex for Python-heavy work.',
          priority: 100,
        },
        {
          id: 'frontend-to-claude',
          match: 'frontend-heavy',
          targetRuntime: 'claude-code',
          reason: 'Prefer Claude Code for frontend-heavy work.',
          priority: 50,
        },
      ],
    },
    ...overrides,
  };
}

function makeSignal(
  overrides: Partial<HandoffTriggerSignal> = {},
): HandoffTriggerSignal {
  return {
    runId: 'run-1',
    managedSessionId: 'ms-1',
    sourceRuntime: 'claude-code',
    trigger: 'task-affinity',
    stage: 'dispatch',
    observedAt: '2026-03-11T10:00:00.000Z',
    payload: {
      prompt: 'Refactor the Python API client and add pytest coverage.',
    },
    ...overrides,
  };
}

describe('evaluateTrigger', () => {
  it('ranks task-affinity matches deterministically by priority and returns a suggested decision', () => {
    const decision = evaluateTrigger(makeSignal(), {
      policy: makePolicy(),
      automaticHandoffsSoFar: 0,
      lastTriggeredAt: null,
    });

    expect(decision.targetRuntime).toBe('codex');
    expect(decision.status).toBe('suggested');
    expect(decision.reason).toContain('Python-heavy');
    expect(decision.dedupeKey).toBe('run-1:dispatch:task-affinity:codex');
  });

  it('skips same-runtime recommendations instead of returning a no-op handoff', () => {
    const decision = evaluateTrigger(
      makeSignal({
        sourceRuntime: 'codex',
        payload: { prompt: 'Refactor the Python API client and add pytest coverage.' },
      }),
      {
        policy: makePolicy(),
        automaticHandoffsSoFar: 0,
        lastTriggeredAt: null,
      },
    );

    expect(decision.targetRuntime).toBeNull();
    expect(decision.status).toBe('skipped');
    expect(decision.skippedReason).toContain('already matches');
  });

  it('skips when the cooldown window is still active', () => {
    const decision = evaluateTrigger(makeSignal(), {
      policy: makePolicy(),
      automaticHandoffsSoFar: 0,
      lastTriggeredAt: '2026-03-11T09:59:30.000Z',
    });

    expect(decision.status).toBe('skipped');
    expect(decision.skippedReason).toContain('cooldown');
  });

  it('skips when the run has already reached the automatic handoff budget', () => {
    const decision = evaluateTrigger(makeSignal(), {
      policy: makePolicy(),
      automaticHandoffsSoFar: 1,
      lastTriggeredAt: null,
    });

    expect(decision.status).toBe('skipped');
    expect(decision.skippedReason).toContain('maxAutomaticHandoffsPerRun');
  });
});
