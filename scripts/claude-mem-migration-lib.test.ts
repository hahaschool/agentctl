import { describe, expect, it } from 'vitest';

import type { ClaudeMemObservation } from './claude-mem-migration-lib.js';
import {
  assembleObservationContent,
  buildImportedSource,
  computeObservationConfidence,
  mapObservationType,
  parseStringArray,
} from './claude-mem-migration-lib.js';

function makeObservation(
  overrides: Partial<ClaudeMemObservation> = {},
): ClaudeMemObservation {
  return {
    id: 42,
    type: 'decision',
    title: 'Prefer Biome for formatting',
    subtitle: 'Keep formatting and linting unified',
    facts: '["Biome replaces ESLint for formatting"]',
    narrative: 'This came out of repeated lint drift across packages.',
    files_modified: '["packages/web/src/app.tsx"]',
    project: 'agentctl',
    created_at: '2026-03-11T12:00:00.000Z',
    created_at_epoch: 1741694400,
    memory_session_id: 'memory-session-1',
    ...overrides,
  };
}

describe('mapObservationType()', () => {
  it('maps known claude-mem observation types to shared entity types', () => {
    expect(mapObservationType('decision')).toBe('decision');
    expect(mapObservationType('bugfix')).toBe('error');
    expect(mapObservationType('feature')).toBe('code_artifact');
    expect(mapObservationType('refactor')).toBe('pattern');
    expect(mapObservationType('discovery')).toBe('concept');
    expect(mapObservationType('change')).toBe('code_artifact');
  });

  it('falls back to concept for unknown or empty types', () => {
    expect(mapObservationType('unknown')).toBe('concept');
    expect(mapObservationType('')).toBe('concept');
  });
});

describe('parseStringArray()', () => {
  it('parses JSON arrays and drops blank entries', () => {
    expect(parseStringArray('["one", " ", "two"]')).toEqual(['one', 'two']);
  });

  it('returns an empty array for invalid JSON or non-array values', () => {
    expect(parseStringArray('{')).toEqual([]);
    expect(parseStringArray('"not-an-array"')).toEqual([]);
    expect(parseStringArray(null)).toEqual([]);
  });
});

describe('assembleObservationContent()', () => {
  it('assembles title, subtitle, and narrative into one searchable parent fact', () => {
    const content = assembleObservationContent(makeObservation());

    expect(content).toContain('Prefer Biome for formatting');
    expect(content).toContain('Keep formatting and linting unified');
    expect(content).toContain('Context: This came out of repeated lint drift across packages.');
  });

  it('omits empty sections and returns an empty string for sparse observations', () => {
    const content = assembleObservationContent(
      makeObservation({
        title: '',
        subtitle: '',
        narrative: '',
      }),
    );

    expect(content).toBe('');
  });
});

describe('computeObservationConfidence()', () => {
  it('assigns 0.95 when both narrative and facts are present', () => {
    expect(computeObservationConfidence(makeObservation())).toBe(0.95);
  });

  it('assigns 0.90 when only facts are present', () => {
    expect(
      computeObservationConfidence(
        makeObservation({
          narrative: '',
        }),
      ),
    ).toBe(0.9);
  });

  it('assigns 0.80 for title-only observations and 0.60 for sparse rows', () => {
    expect(
      computeObservationConfidence(
        makeObservation({
          subtitle: '',
          narrative: '',
          facts: '',
        }),
      ),
    ).toBe(0.8);

    expect(
      computeObservationConfidence(
        makeObservation({
          title: '',
          subtitle: '',
          narrative: '',
          facts: '',
        }),
      ),
    ).toBe(0.6);
  });
});

describe('buildImportedSource()', () => {
  it('preserves claude-mem provenance needed for idempotent re-imports', () => {
    const source = buildImportedSource({
      sourceTable: 'observations',
      sourceId: 42,
      sourceKey: 'observations:42:parent',
      sessionId: 'claude-session-123',
      memorySessionId: 'memory-session-1',
      machineId: 'machine-a',
      importedAt: '2026-03-11T12:00:00.000Z',
      filesModified: ['packages/web/src/app.tsx'],
      originalCreatedAt: '2026-03-10T00:00:00.000Z',
    });

    expect(source).toMatchObject({
      extraction_method: 'import',
      source: 'claude-mem',
      source_table: 'observations',
      source_id: '42',
      source_key: 'observations:42:parent',
      session_id: 'claude-session-123',
      memory_session_id: 'memory-session-1',
      machine_id: 'machine-a',
      files_modified: ['packages/web/src/app.tsx'],
      original_created_at: '2026-03-10T00:00:00.000Z',
      imported_at: '2026-03-11T12:00:00.000Z',
    });
  });
});
