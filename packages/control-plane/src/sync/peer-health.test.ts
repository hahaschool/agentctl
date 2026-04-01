import { describe, expect, it } from 'vitest';

import { computeNextInterval } from './peer-health.js';

describe('computeNextInterval', () => {
  it('keeps default on reachable', () => {
    expect(computeNextInterval(30000, 'reachable')).toBe(30000);
  });

  it('doubles on unreachable (capped at 300000)', () => {
    expect(computeNextInterval(30000, 'unreachable')).toBe(60000);
    expect(computeNextInterval(150000, 'unreachable')).toBe(300000);
    expect(computeNextInterval(300000, 'unreachable')).toBe(300000);
  });

  it('resets on reachable after backoff', () => {
    expect(computeNextInterval(120000, 'reachable')).toBe(30000);
  });
});
