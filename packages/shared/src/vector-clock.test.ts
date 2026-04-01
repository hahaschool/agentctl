import { describe, expect, it } from 'vitest';

import { vcCompare, vcDominates, vcMerge } from './vector-clock.js';

describe('vcDominates', () => {
  it('returns true when a strictly dominates b', () => {
    expect(vcDominates({ n1: 3, n2: 2 }, { n1: 2, n2: 1 })).toBe(true);
  });

  it('returns false when b has a higher component', () => {
    expect(vcDominates({ n1: 3, n2: 1 }, { n1: 2, n2: 2 })).toBe(false);
  });

  it('returns false when clocks are equal', () => {
    expect(vcDominates({ n1: 2 }, { n1: 2 })).toBe(false);
  });

  it('returns true when a has extra keys b does not', () => {
    expect(vcDominates({ n1: 2, n2: 1 }, { n1: 1 })).toBe(true);
  });

  it('handles empty clocks', () => {
    expect(vcDominates({}, {})).toBe(false);
    expect(vcDominates({ n1: 1 }, {})).toBe(true);
    expect(vcDominates({}, { n1: 1 })).toBe(false);
  });
});

describe('vcMerge', () => {
  it('takes element-wise max', () => {
    expect(vcMerge({ n1: 3, n2: 1 }, { n1: 1, n2: 5 })).toEqual({ n1: 3, n2: 5 });
  });

  it('includes keys only in one clock', () => {
    expect(vcMerge({ n1: 2 }, { n2: 3 })).toEqual({ n1: 2, n2: 3 });
  });

  it('merges empty clocks', () => {
    expect(vcMerge({}, { n1: 1 })).toEqual({ n1: 1 });
    expect(vcMerge({}, {})).toEqual({});
  });
});

describe('vcCompare', () => {
  it('detects a_dominates', () => {
    expect(vcCompare({ n1: 3 }, { n1: 1 })).toBe('a_dominates');
  });

  it('detects b_dominates', () => {
    expect(vcCompare({ n1: 1 }, { n1: 3 })).toBe('b_dominates');
  });

  it('detects equal', () => {
    expect(vcCompare({ n1: 2, n2: 3 }, { n1: 2, n2: 3 })).toBe('equal');
    expect(vcCompare({}, {})).toBe('equal');
  });

  it('detects conflict (concurrent edits)', () => {
    expect(vcCompare({ n1: 3, n2: 1 }, { n1: 1, n2: 3 })).toBe('conflict');
  });

  it('detects conflict with disjoint keys', () => {
    expect(vcCompare({ n1: 1 }, { n2: 1 })).toBe('conflict');
  });
});
