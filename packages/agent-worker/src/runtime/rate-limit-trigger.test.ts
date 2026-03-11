import type { AutoHandoffPolicy, ManagedRuntime, RateLimitHandoffEvent } from '@agentctl/shared';
import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import { RateLimitTrigger } from './rate-limit-trigger.js';

function makePolicy(
  overrides: Partial<AutoHandoffPolicy['rateLimitFailover']> = {},
): AutoHandoffPolicy {
  return {
    enabled: true,
    mode: 'execute',
    maxAutomaticHandoffsPerRun: 2,
    cooldownMs: 0,
    rateLimitFailover: {
      enabled: true,
      targetRuntimeOrder: ['claude-code', 'codex'],
      retryBudget: 1,
      ...overrides,
    },
  };
}

describe('RateLimitTrigger', () => {
  it('triggers handoff to next runtime after retry budget is exhausted', () => {
    const onHandoff =
      vi.fn<(targetRuntime: ManagedRuntime, event: RateLimitHandoffEvent) => void>();
    const trigger = new RateLimitTrigger({
      sourceRuntime: 'claude-code',
      policy: makePolicy({ retryBudget: 1, targetRuntimeOrder: ['claude-code', 'codex'] }),
      logger: createMockLogger(),
      onHandoff,
    });

    // First hit — within retry budget, no handoff yet
    const first = trigger.observe({ statusCode: 429 });
    expect(first).toBe(false);
    expect(onHandoff).not.toHaveBeenCalled();

    // Second hit — budget exhausted, handoff to codex (skips claude-code as same runtime)
    const second = trigger.observe({ statusCode: 429 });
    expect(second).toBe(true);
    expect(onHandoff).toHaveBeenCalledOnce();

    const [calledRuntime, calledEvent] = onHandoff.mock.calls[0] as [
      ManagedRuntime,
      RateLimitHandoffEvent,
    ];
    expect(calledRuntime).toBe('codex');
    expect(calledEvent.event).toBe('rate_limit_handoff');
    expect(calledEvent.data.sourceRuntime).toBe('claude-code');
    expect(calledEvent.data.targetRuntime).toBe('codex');
    expect(calledEvent.data.hitCount).toBe(2);
    expect(typeof calledEvent.data.detectedAt).toBe('string');
  });

  it('does not trigger when policy is disabled', () => {
    const onHandoff = vi.fn();
    const policy = makePolicy();
    const disabledPolicy: AutoHandoffPolicy = {
      ...policy,
      rateLimitFailover: { enabled: false, targetRuntimeOrder: ['codex'], retryBudget: 0 },
    };

    const trigger = new RateLimitTrigger({
      sourceRuntime: 'claude-code',
      policy: disabledPolicy,
      logger: createMockLogger(),
      onHandoff,
    });

    trigger.observe({ statusCode: 429 });
    trigger.observe({ statusCode: 429 });

    expect(onHandoff).not.toHaveBeenCalled();
  });

  it('does not trigger for non-rate-limit errors', () => {
    const onHandoff = vi.fn();
    const trigger = new RateLimitTrigger({
      sourceRuntime: 'claude-code',
      policy: makePolicy({ retryBudget: 0 }),
      logger: createMockLogger(),
      onHandoff,
    });

    const result = trigger.observe({ statusCode: 500, message: 'Internal Server Error' });
    expect(result).toBe(false);
    expect(onHandoff).not.toHaveBeenCalled();
  });

  describe('isRateLimitError', () => {
    it('identifies HTTP 429 status code as rate limit', () => {
      expect(RateLimitTrigger.isRateLimitError({ statusCode: 429 })).toBe(true);
    });

    it('identifies "rate limit" in error message', () => {
      expect(
        RateLimitTrigger.isRateLimitError({ message: 'You have exceeded the rate limit' }),
      ).toBe(true);
    });

    it('identifies "too many requests" in error message', () => {
      expect(RateLimitTrigger.isRateLimitError({ message: 'Too Many Requests' })).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(
        RateLimitTrigger.isRateLimitError({ statusCode: 500, message: 'Internal error' }),
      ).toBe(false);
    });
  });
});
