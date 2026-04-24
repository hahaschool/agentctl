import { describe, expect, it } from 'vitest';

import { scopeNormalize } from './ops.js';

describe('scopeNormalize', () => {
  it('normalizes empty/blank scope to empty string', () => {
    expect(scopeNormalize('')).toBe('');
    expect(scopeNormalize('  ')).toBe('');
    expect(scopeNormalize(undefined)).toBe('');
    expect(scopeNormalize(null)).toBe('');
  });

  it('trims and lowercases scope', () => {
    expect(scopeNormalize(' MyScope ')).toBe('myscope');
  });

  it('handles already normalized scope', () => {
    expect(scopeNormalize('myscope')).toBe('myscope');
  });
});
