import { describe, expect, it } from 'vitest';

import {
  classifyDrift,
  classifySchemaDrift,
  compareSemver,
  LOCAL_SCHEMA_VERSION,
} from './mesh-version';

// ---------------------------------------------------------------------------
// compareSemver — version string comparison used by canUpdatePeer
// ---------------------------------------------------------------------------

describe('compareSemver', () => {
  it('returns 0 for identical versions', () => {
    expect(compareSemver('0.5.6', '0.5.6')).toBe(0);
  });

  it('returns 0 regardless of "v" prefix', () => {
    expect(compareSemver('v0.5.6', '0.5.6')).toBe(0);
    expect(compareSemver('0.5.6', 'v0.5.6')).toBe(0);
    expect(compareSemver('v0.5.6', 'v0.5.6')).toBe(0);
  });

  it('returns -1 when a < b', () => {
    expect(compareSemver('0.5.0', '0.5.6')).toBe(-1);
    expect(compareSemver('0.4.9', '0.5.0')).toBe(-1);
    expect(compareSemver('0.5.6', '1.0.0')).toBe(-1);
  });

  it('returns 1 when a > b', () => {
    expect(compareSemver('0.5.6', '0.5.0')).toBe(1);
    expect(compareSemver('1.0.0', '0.5.6')).toBe(1);
    expect(compareSemver('0.6.0', '0.5.6')).toBe(1);
  });

  it('returns null for null/undefined inputs', () => {
    expect(compareSemver(null, '0.5.6')).toBeNull();
    expect(compareSemver('0.5.6', null)).toBeNull();
    expect(compareSemver(null, null)).toBeNull();
    expect(compareSemver(undefined, '0.5.6')).toBeNull();
  });

  it('returns null for unparseable versions', () => {
    expect(compareSemver('abc', '0.5.6')).toBeNull();
    expect(compareSemver('0.5.6', 'not-a-version')).toBeNull();
  });

  it('strips pre-release/build metadata', () => {
    expect(compareSemver('0.5.6-beta.1', '0.5.6')).toBe(0);
    expect(compareSemver('0.5.6+build123', '0.5.6')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// classifyDrift — peer version drift classification
// ---------------------------------------------------------------------------

describe('classifyDrift', () => {
  it('returns "match" when versions are equal', () => {
    expect(classifyDrift('0.5.6', '0.5.6')).toBe('match');
    expect(classifyDrift('v0.5.6', '0.5.6')).toBe('match');
  });

  it('returns "behind" when peer < local', () => {
    expect(classifyDrift('0.5.0', '0.5.6')).toBe('behind');
  });

  it('returns "ahead" when peer > local', () => {
    expect(classifyDrift('0.6.0', '0.5.6')).toBe('ahead');
  });

  it('returns "unknown" when peer version is null', () => {
    expect(classifyDrift(null, '0.5.6')).toBe('unknown');
    expect(classifyDrift(undefined, '0.5.6')).toBe('unknown');
  });
});

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
