import { describe, expect, it } from 'vitest';

import { classifySchemaDrift, LOCAL_SCHEMA_VERSION } from './mesh-version';

// ---------------------------------------------------------------------------
// classifySchemaDrift — 33.10 peer-ahead per-row badge source of truth
// ---------------------------------------------------------------------------

describe('classifySchemaDrift', () => {
  it('returns "match" when peer schema equals local schema', () => {
    expect(classifySchemaDrift(26, 26)).toBe('match');
  });

  it('returns "ahead" when peer schema > local schema', () => {
    expect(classifySchemaDrift(27, 26)).toBe('ahead');
    expect(classifySchemaDrift(100, 26)).toBe('ahead');
  });

  it('returns "behind" when peer schema < local schema', () => {
    expect(classifySchemaDrift(25, 26)).toBe('behind');
    expect(classifySchemaDrift(0, 26)).toBe('behind');
  });

  it('returns "unknown" when peer schema is null or undefined', () => {
    expect(classifySchemaDrift(null, 26)).toBe('unknown');
    expect(classifySchemaDrift(undefined, 26)).toBe('unknown');
  });

  it('returns "unknown" when peer schema is not finite', () => {
    expect(classifySchemaDrift(Number.NaN, 26)).toBe('unknown');
    expect(classifySchemaDrift(Number.POSITIVE_INFINITY, 26)).toBe('unknown');
  });

  it('exports a finite numeric LOCAL_SCHEMA_VERSION', () => {
    expect(Number.isFinite(LOCAL_SCHEMA_VERSION)).toBe(true);
    expect(LOCAL_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
