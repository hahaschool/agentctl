import { describe, expect, it } from 'vitest';

import { isPeerStale } from '../MeshPeersPage';

describe('isPeerStale', () => {
  it('returns false for null lastSeen', () => {
    expect(isPeerStale(null)).toBe(false);
  });

  it('returns false for invalid date string', () => {
    expect(isPeerStale('not-a-date')).toBe(false);
  });

  it('returns false for a peer seen recently', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(isPeerStale(oneHourAgo)).toBe(false);
  });

  it('returns false for a peer seen exactly 6 days ago', () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    expect(isPeerStale(sixDaysAgo)).toBe(false);
  });

  it('returns true for a peer seen 8 days ago', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(isPeerStale(eightDaysAgo)).toBe(true);
  });

  it('returns true for a peer seen 30 days ago', () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(isPeerStale(thirtyDaysAgo)).toBe(true);
  });
});
