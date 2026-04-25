import { describe, expect, it } from 'vitest';

import { canonicalizeEntityName, normalizeEntityName } from './entity-canonicalization.js';

describe('entity canonicalization', () => {
  it('normalizes case and whitespace before matching', () => {
    expect(normalizeEntityName('  John   SMITH  ')).toBe('john smith');
  });

  it('reuses a unique canonical id for person full-name aliases', () => {
    const result = canonicalizeEntityName({
      entityType: 'person',
      entityName: '  JOHN   smith ',
      aliases: [
        { canonicalId: 'person-1', alias: 'John Smith' },
        { canonicalId: 'person-2', alias: 'Jane Doe' },
      ],
    });

    expect(result).toMatchObject({
      canonicalId: 'person-1',
      normalizedEntityName: 'john smith',
      resolution: 'resolved',
      resolutionReason: 'person_exact',
    });
  });

  it('reuses a unique canonical id for person last-name-only matches', () => {
    const result = canonicalizeEntityName({
      entityType: 'person',
      entityName: 'Smith',
      aliases: [
        { canonicalId: 'person-1', alias: 'John Smith' },
        { canonicalId: 'person-1', alias: 'J. Smith' },
        { canonicalId: 'person-2', alias: 'Jane Doe' },
      ],
    });

    expect(result).toMatchObject({
      canonicalId: 'person-1',
      normalizedEntityName: 'smith',
      resolution: 'resolved',
      resolutionReason: 'person_last_name',
    });
    expect(result.matchedCanonicalIds).toEqual(['person-1']);
  });

  it('returns ambiguous without merging when a person last-name-only match hits multiple ids', () => {
    const result = canonicalizeEntityName({
      entityType: 'person',
      entityName: ' Smith ',
      aliases: [
        { canonicalId: 'person-1', alias: 'John Smith' },
        { canonicalId: 'person-2', alias: 'Alice Smith' },
      ],
    });

    expect(result).toMatchObject({
      canonicalId: null,
      normalizedEntityName: 'smith',
      resolution: 'ambiguous',
      resolutionReason: 'ambiguous_person_last_name',
    });
    expect(result.matchedCanonicalIds).toEqual(['person-1', 'person-2']);
  });

  it('matches non-person entities only by exact normalized aliases', () => {
    const aliases = [{ canonicalId: 'project-1', alias: 'Project Atlas' }];

    const exact = canonicalizeEntityName({
      entityType: 'concept',
      entityName: '  PROJECT   atlas ',
      aliases,
    });

    expect(exact).toMatchObject({
      canonicalId: 'project-1',
      normalizedEntityName: 'project atlas',
      resolution: 'resolved',
      resolutionReason: 'exact',
    });

    const partial = canonicalizeEntityName({
      entityType: 'concept',
      entityName: 'Atlas',
      aliases,
    });

    expect(partial).toMatchObject({
      canonicalId: null,
      normalizedEntityName: 'atlas',
      resolution: 'unresolved',
      resolutionReason: 'unresolved',
    });
  });
});
