import { describe, expect, it, vi } from 'vitest';

import {
  extractDeterministicBenchmarkEntities,
  runEntityExtractionBenchmark,
} from './entity-extraction-benchmark.js';

function makePool(factRows: Record<string, unknown>[], drawerRows: Record<string, unknown>[]) {
  const responses = [
    { rows: factRows, rowCount: factRows.length },
    { rows: drawerRows, rowCount: drawerRows.length },
  ];
  let callIndex = 0;

  return {
    query: vi
      .fn()
      .mockImplementation(() => Promise.resolve(responses[callIndex++] ?? responses.at(-1))),
  };
}

describe('entity extraction benchmark', () => {
  it('extracts deterministic person and structured non-person candidates', () => {
    const candidates = extractDeterministicBenchmarkEntities({
      sourceKind: 'drawer',
      sourceId: 'drawer-1',
      scope: 'project:agentctl',
      createdAt: '2026-01-01T00:00:00.000Z',
      topic: 'Migration Handoff',
      text: 'John Smith updated PR #123 in src/memory/entity.ts on dev-1 with agent-alpha.',
    });

    expect(candidates).toEqual([
      { entityName: 'John Smith', entityType: 'person' },
      { entityName: 'PR #123', entityType: 'reference' },
      { entityName: 'agent-alpha', entityType: 'reference' },
      { entityName: 'dev-1', entityType: 'reference' },
      { entityName: 'src/memory/entity.ts', entityType: 'reference' },
    ]);
  });

  it('samples facts and drawers deterministically, produces stable dry-run proposals, and stays read-only', async () => {
    const pool = makePool(
      [
        {
          id: 'fact-2',
          scope: 'project:agentctl',
          entity_type: 'person',
          content: 'Pair with Smith before release.',
          created_at: '2026-01-02T00:00:00.000Z',
        },
        {
          id: 'fact-1',
          scope: 'project:agentctl',
          entity_type: 'person',
          content: 'John Smith approved the rollout.',
          created_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'fact-3',
          scope: 'project:agentctl',
          entity_type: 'concept',
          content: 'Project Atlas needs review.',
          created_at: '2026-01-03T00:00:00.000Z',
        },
      ],
      [
        {
          id: 'drawer-2',
          scope: 'project:agentctl',
          topic: 'Later note',
          content: 'Ignore this later drawer.',
          created_at: '2026-01-05T00:00:00.000Z',
        },
        {
          id: 'drawer-1',
          scope: 'project:agentctl',
          topic: 'Project Atlas',
          content: 'Project Atlas is still pending.',
          created_at: '2026-01-04T00:00:00.000Z',
        },
      ],
    );
    const extractEntities = vi.fn((source) => {
      switch (source.sourceId) {
        case 'fact-1':
          return [{ entityName: '  JOHN   Smith ', entityType: 'person' }];
        case 'fact-2':
          return [{ entityName: 'Smith', entityType: 'person' }];
        case 'drawer-1':
          return [{ entityName: 'Project Atlas', entityType: 'concept' }];
        default:
          return [];
      }
    });

    const result = await runEntityExtractionBenchmark({
      pool,
      aliases: [
        { canonicalId: 'person-1', alias: 'John Smith' },
        { canonicalId: 'person-2', alias: 'Alice Smith' },
      ],
      factSampleSize: 2,
      drawerSampleSize: 1,
      extractEntities,
    });

    expect(extractEntities.mock.calls.map(([source]) => source.sourceId)).toEqual([
      'fact-1',
      'fact-2',
      'drawer-1',
    ]);

    expect(result.proposals).toEqual([
      {
        sourceKind: 'drawer',
        sourceId: 'drawer-1',
        scope: 'project:agentctl',
        entityType: 'concept',
        entityName: 'Project Atlas',
        normalizedEntityName: 'project atlas',
        canonicalId: null,
        resolution: 'unresolved',
        resolutionReason: 'unresolved',
        matchedCanonicalIds: [],
      },
      {
        sourceKind: 'fact',
        sourceId: 'fact-1',
        scope: 'project:agentctl',
        entityType: 'person',
        entityName: '  JOHN   Smith ',
        normalizedEntityName: 'john smith',
        canonicalId: 'person-1',
        resolution: 'resolved',
        resolutionReason: 'person_exact',
        matchedCanonicalIds: ['person-1'],
      },
      {
        sourceKind: 'fact',
        sourceId: 'fact-2',
        scope: 'project:agentctl',
        entityType: 'person',
        entityName: 'Smith',
        normalizedEntityName: 'smith',
        canonicalId: null,
        resolution: 'ambiguous',
        resolutionReason: 'ambiguous_person_last_name',
        matchedCanonicalIds: ['person-1', 'person-2'],
      },
    ]);

    expect(result.summary).toEqual({
      sampledFacts: 2,
      sampledDrawers: 1,
      proposalCount: 3,
      resolved: 1,
      ambiguous: 1,
      unresolved: 1,
    });

    expect(pool.query).toHaveBeenCalledTimes(2);
    for (const [sql] of pool.query.mock.calls) {
      expect(String(sql).trim().toUpperCase().startsWith('SELECT')).toBe(true);
    }
  });
});
