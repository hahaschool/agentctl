import { describe, expect, it } from 'vitest';

import {
  formatHandoffHistoryFilterLabel,
  matchesHandoffHistoryFilter,
} from './handoff-history-filter.js';

describe('handoff history filters', () => {
  it('formats filter labels', () => {
    expect(formatHandoffHistoryFilterLabel('all')).toBe('All');
    expect(formatHandoffHistoryFilterLabel('native-import')).toBe('Native Import');
    expect(formatHandoffHistoryFilterLabel('fallback')).toBe('Fallback');
    expect(formatHandoffHistoryFilterLabel('failed')).toBe('Failed');
  });

  it('matches native-import handoffs', () => {
    expect(
      matchesHandoffHistoryFilter(
        { status: 'succeeded', strategy: 'native-import', nativeImportAttempt: { ok: true } },
        'native-import',
      ),
    ).toBe(true);
    expect(
      matchesHandoffHistoryFilter(
        { status: 'succeeded', strategy: 'snapshot-handoff', nativeImportAttempt: { ok: false } },
        'native-import',
      ),
    ).toBe(false);
  });

  it('matches fallback handoffs only when snapshot fallback succeeded', () => {
    expect(
      matchesHandoffHistoryFilter(
        { status: 'succeeded', strategy: 'snapshot-handoff', nativeImportAttempt: { ok: false } },
        'fallback',
      ),
    ).toBe(true);
    expect(
      matchesHandoffHistoryFilter(
        { status: 'failed', strategy: 'snapshot-handoff', nativeImportAttempt: { ok: false } },
        'fallback',
      ),
    ).toBe(false);
  });

  it('matches failed handoffs', () => {
    expect(
      matchesHandoffHistoryFilter(
        { status: 'failed', strategy: 'snapshot-handoff', nativeImportAttempt: { ok: false } },
        'failed',
      ),
    ).toBe(true);
    expect(
      matchesHandoffHistoryFilter(
        { status: 'succeeded', strategy: 'native-import', nativeImportAttempt: { ok: true } },
        'failed',
      ),
    ).toBe(false);
  });
});
