import { describe, expect, it } from 'vitest';

import { CostTracker } from './cost-tracker.js';

describe('CostTracker', () => {
  it('accumulates cost from prompt token usage', () => {
    const tracker = new CostTracker({ priceUsdPerMtoken: 0.02 });

    tracker.add({ promptTokens: 1_000_000 });
    expect(tracker.totalCostUsd).toBeCloseTo(0.02);

    tracker.add({ promptTokens: 500_000 });
    expect(tracker.totalCostUsd).toBeCloseTo(0.03);
    expect(tracker.totalTokens).toBe(1_500_000);
    expect(tracker.usageEstimated).toBe(false);
  });

  it('marks usage as estimated when falling back to character estimates', () => {
    const tracker = new CostTracker({ priceUsdPerMtoken: 0.02 });

    tracker.addEstimated(10_000);

    expect(tracker.usageEstimated).toBe(true);
    expect(tracker.totalTokens).toBe(2_500);
    expect(tracker.totalCostUsd).toBeCloseTo(0.00005);
  });
});
