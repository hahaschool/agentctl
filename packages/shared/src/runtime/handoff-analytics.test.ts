import { describe, expect, it } from 'vitest';

import { calculateHandoffAnalyticsRates, summarizeHandoffAnalytics } from './handoff-analytics.js';

describe('summarizeHandoffAnalytics', () => {
  it('summarizes handoff outcomes and native import outcomes', () => {
    expect(
      summarizeHandoffAnalytics([
        { status: 'succeeded', nativeImportAttempt: { ok: true } },
        { status: 'succeeded', nativeImportAttempt: { ok: false } },
        { status: 'failed', nativeImportAttempt: { ok: false } },
        { status: 'pending' },
      ]),
    ).toEqual({
      total: 4,
      succeeded: 2,
      failed: 1,
      pending: 1,
      nativeImportSuccesses: 1,
      nativeImportFallbacks: 2,
    });
  });

  it('returns zeroes for an empty handoff list', () => {
    expect(summarizeHandoffAnalytics([])).toEqual({
      total: 0,
      succeeded: 0,
      failed: 0,
      pending: 0,
      nativeImportSuccesses: 0,
      nativeImportFallbacks: 0,
    });
  });

  it('calculates fleet handoff rates from the summary', () => {
    expect(
      calculateHandoffAnalyticsRates({
        total: 6,
        nativeImportSuccesses: 3,
        nativeImportFallbacks: 2,
      }),
    ).toEqual({
      nativeImportSuccessRate: 50,
      fallbackRate: 33,
    });
  });

  it('returns zero rates when no handoffs exist', () => {
    expect(
      calculateHandoffAnalyticsRates({
        total: 0,
        nativeImportSuccesses: 0,
        nativeImportFallbacks: 0,
      }),
    ).toEqual({
      nativeImportSuccessRate: 0,
      fallbackRate: 0,
    });
  });
});
