import type {
  AutoHandoffPolicy,
  CostThresholdHandoffEvent,
  CostThresholdWarningEvent,
  ManagedRuntime,
} from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import { CostThresholdTrigger } from './cost-threshold-trigger.js';

function makePolicy(
  overrides: Partial<AutoHandoffPolicy['costThreshold']> = {},
): AutoHandoffPolicy {
  return {
    enabled: true,
    mode: 'execute',
    maxAutomaticHandoffsPerRun: 2,
    cooldownMs: 0,
    costThreshold: {
      enabled: true,
      thresholdUsd: 5.0,
      targetRuntime: 'codex',
      minRemainingWorkSignal: 'best-effort',
      ...overrides,
    },
  };
}

describe('CostThresholdTrigger', () => {
  it('emits warning at 80% and handoff when threshold is exceeded', () => {
    const onWarning = vi.fn<(event: CostThresholdWarningEvent) => void>();
    const onHandoff =
      vi.fn<(targetRuntime: ManagedRuntime, event: CostThresholdHandoffEvent) => void>();

    const trigger = new CostThresholdTrigger({
      sourceRuntime: 'claude-code',
      policy: makePolicy({ thresholdUsd: 5.0, targetRuntime: 'codex' }),
      logger: createMockLogger(),
      onWarning,
      onHandoff,
    });

    // Below warning threshold — nothing fires
    expect(trigger.update(3.0)).toBe(null);
    expect(onWarning).not.toHaveBeenCalled();
    expect(onHandoff).not.toHaveBeenCalled();

    // Cross 80% (4.0 / 5.0 = 0.8) — warning fires
    const warningResult = trigger.update(4.0);
    expect(warningResult).toBe('warning');
    expect(onWarning).toHaveBeenCalledOnce();

    const warningEvent = onWarning.mock.calls[0]?.[0] as CostThresholdWarningEvent;
    expect(warningEvent.event).toBe('cost_threshold_warning');
    expect(warningEvent.data.currentCostUsd).toBe(4.0);
    expect(warningEvent.data.thresholdUsd).toBe(5.0);
    expect(warningEvent.data.fraction).toBeCloseTo(0.8);

    // Warning does not fire again
    expect(trigger.update(4.5)).toBe(null);
    expect(onWarning).toHaveBeenCalledOnce();

    // Exceed threshold — handoff fires
    const handoffResult = trigger.update(5.1);
    expect(handoffResult).toBe('handoff');
    expect(onHandoff).toHaveBeenCalledOnce();

    const [calledRuntime, handoffEvent] = onHandoff.mock.calls[0] as [
      ManagedRuntime,
      CostThresholdHandoffEvent,
    ];
    expect(calledRuntime).toBe('codex');
    expect(handoffEvent.event).toBe('cost_threshold_handoff');
    expect(handoffEvent.data.sourceRuntime).toBe('claude-code');
    expect(handoffEvent.data.targetRuntime).toBe('codex');
    expect(handoffEvent.data.currentCostUsd).toBe(5.1);
    expect(handoffEvent.data.thresholdUsd).toBe(5.0);
    expect(typeof handoffEvent.data.exceededAt).toBe('string');

    // Handoff does not fire again
    expect(trigger.update(6.0)).toBe(null);
    expect(onHandoff).toHaveBeenCalledOnce();
  });

  it('does not emit anything when policy is disabled', () => {
    const onWarning = vi.fn();
    const onHandoff = vi.fn();

    const policy = makePolicy();
    const disabledPolicy: AutoHandoffPolicy = {
      ...policy,
      costThreshold: {
        enabled: false,
        thresholdUsd: 5.0,
        targetRuntime: 'codex',
        minRemainingWorkSignal: 'best-effort',
      },
    };

    const trigger = new CostThresholdTrigger({
      sourceRuntime: 'claude-code',
      policy: disabledPolicy,
      logger: createMockLogger(),
      onWarning,
      onHandoff,
    });

    trigger.update(10.0);
    expect(onWarning).not.toHaveBeenCalled();
    expect(onHandoff).not.toHaveBeenCalled();
  });

  it('skips warning and fires handoff directly when update jumps past threshold', () => {
    const onWarning = vi.fn();
    const onHandoff =
      vi.fn<(targetRuntime: ManagedRuntime, event: CostThresholdHandoffEvent) => void>();

    const trigger = new CostThresholdTrigger({
      sourceRuntime: 'claude-code',
      policy: makePolicy({ thresholdUsd: 5.0, targetRuntime: 'codex' }),
      logger: createMockLogger(),
      onWarning,
      onHandoff,
    });

    // Jump straight past threshold — only handoff fires (warning is suppressed)
    const result = trigger.update(6.0);
    expect(result).toBe('handoff');
    expect(onWarning).not.toHaveBeenCalled();
    expect(onHandoff).toHaveBeenCalledOnce();
    expect(trigger.isWarningFired()).toBe(true);
  });
});
