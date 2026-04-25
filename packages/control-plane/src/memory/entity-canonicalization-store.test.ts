import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';

import { EntityCanonicalizationStore } from './entity-canonicalization-store.js';

type QueryResultRow = Record<string, unknown>;

function createMockPool(
  handler: (sql: string, params: unknown[]) => { rows: QueryResultRow[]; rowCount?: number },
) {
  return {
    query: vi
      .fn()
      .mockImplementation((sql: string, params: unknown[] = []) =>
        Promise.resolve(handler(sql, params)),
      ),
  };
}

describe('EntityCanonicalizationStore', () => {
  it('creates a canonical entity, adds its canonical alias, and dedupes repeated normalized aliases', async () => {
    const createdAt = new Date('2026-04-25T00:00:00.000Z');
    const pool = createMockPool((sql, params) => {
      if (sql.includes('INSERT INTO memory_entities')) {
        return {
          rows: [
            {
              id: params[0],
              entity_type: params[1],
              canonical_name: params[2],
              normalized_canonical_name: params[3],
              metadata_json: params[4],
              created_at: createdAt,
              updated_at: createdAt,
            },
          ],
          rowCount: 1,
        };
      }

      if (sql.includes('INSERT INTO memory_entity_aliases')) {
        return {
          rows: [
            {
              id: params[0],
              canonical_id: params[1],
              alias: params[2],
              normalized_alias: params[3],
              source_json: params[4],
              created_at: createdAt,
            },
          ],
          rowCount: 1,
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const store = new EntityCanonicalizationStore({
      pool: pool as never,
      logger: createMockLogger(),
    });

    const result = await store.createEntity({
      entityType: ' Person ',
      canonicalName: ' John Smith ',
      metadataJson: { seed: 'unit-test' },
      aliases: [
        { alias: 'J. Smith', sourceJson: { source: 'manual' } },
        { alias: ' john   smith ' },
      ],
    });

    expect(result.entity).toMatchObject({
      entityType: 'person',
      canonicalName: 'John Smith',
      normalizedCanonicalName: 'john smith',
      metadataJson: { seed: 'unit-test' },
      createdAt: '2026-04-25T00:00:00.000Z',
      updatedAt: '2026-04-25T00:00:00.000Z',
    });
    expect(result.aliases.map((alias) => alias.alias)).toEqual(['John Smith', 'J. Smith']);

    const calls = vi.mocked(pool.query).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0]?.[1]).toEqual([
      expect.any(String),
      'person',
      'John Smith',
      'john smith',
      { seed: 'unit-test' },
    ]);
    expect(calls[1]?.[1]).toEqual([
      expect.any(String),
      result.entity.id,
      'John Smith',
      'john smith',
      {},
    ]);
    expect(calls[2]?.[1]).toEqual([
      expect.any(String),
      result.entity.id,
      'J. Smith',
      'j. smith',
      { source: 'manual' },
    ]);
  });

  it('lists aliases joined with canonical entity details and normalizes the entity-type filter', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'alias-1',
            canonical_id: 'person-1',
            entity_type: 'person',
            canonical_name: 'John Smith',
            normalized_canonical_name: 'john smith',
            alias: 'J. Smith',
            normalized_alias: 'j. smith',
            source_json: { source: 'manual' },
            created_at: new Date('2026-04-25T00:00:00.000Z'),
          },
        ],
        rowCount: 1,
      }),
    };

    const store = new EntityCanonicalizationStore({
      pool: pool as never,
      logger: createMockLogger(),
    });

    const aliases = await store.listAliases({ entityType: ' Person ' });

    expect(aliases).toEqual([
      {
        id: 'alias-1',
        canonicalId: 'person-1',
        entityType: 'person',
        canonicalName: 'John Smith',
        normalizedCanonicalName: 'john smith',
        alias: 'J. Smith',
        normalizedAlias: 'j. smith',
        sourceJson: { source: 'manual' },
        createdAt: '2026-04-25T00:00:00.000Z',
      },
    ]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM memory_entity_aliases'), [
      'person',
      null,
    ]);
  });

  it('resolves an exact alias match to a canonical entity', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'alias-1',
            canonical_id: 'person-1',
            entity_type: 'person',
            canonical_name: 'John Smith',
            normalized_canonical_name: 'john smith',
            alias: 'John Smith',
            normalized_alias: 'john smith',
            source_json: {},
            created_at: new Date('2026-04-25T00:00:00.000Z'),
          },
          {
            id: 'alias-2',
            canonical_id: 'person-1',
            entity_type: 'person',
            canonical_name: 'John Smith',
            normalized_canonical_name: 'john smith',
            alias: 'J. Smith',
            normalized_alias: 'j. smith',
            source_json: {},
            created_at: new Date('2026-04-25T00:00:00.000Z'),
          },
          {
            id: 'alias-3',
            canonical_id: 'person-2',
            entity_type: 'person',
            canonical_name: 'Jane Doe',
            normalized_canonical_name: 'jane doe',
            alias: 'Jane Doe',
            normalized_alias: 'jane doe',
            source_json: {},
            created_at: new Date('2026-04-25T00:00:00.000Z'),
          },
        ],
        rowCount: 3,
      }),
    };

    const store = new EntityCanonicalizationStore({
      pool: pool as never,
      logger: createMockLogger(),
    });

    const result = await store.resolveEntityName({
      entityType: 'person',
      entityName: '  JOHN   smith ',
    });

    expect(result).toMatchObject({
      canonicalId: 'person-1',
      normalizedEntityName: 'john smith',
      resolution: 'resolved',
      resolutionReason: 'person_exact',
      canonicalEntity: {
        id: 'person-1',
        entityType: 'person',
        canonicalName: 'John Smith',
        normalizedCanonicalName: 'john smith',
      },
    });
    expect(result.matchedCanonicalIds).toEqual(['person-1']);
    expect(result.matchedEntities).toEqual([
      {
        id: 'person-1',
        entityType: 'person',
        canonicalName: 'John Smith',
        normalizedCanonicalName: 'john smith',
      },
    ]);
  });

  it('returns an ambiguous result for person last-name matches across multiple canonical ids and logs the outcome', async () => {
    const logger = createMockLogger();
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'alias-1',
            canonical_id: 'person-1',
            entity_type: 'person',
            canonical_name: 'John Smith',
            normalized_canonical_name: 'john smith',
            alias: 'John Smith',
            normalized_alias: 'john smith',
            source_json: {},
            created_at: new Date('2026-04-25T00:00:00.000Z'),
          },
          {
            id: 'alias-2',
            canonical_id: 'person-2',
            entity_type: 'person',
            canonical_name: 'Alice Smith',
            normalized_canonical_name: 'alice smith',
            alias: 'Alice Smith',
            normalized_alias: 'alice smith',
            source_json: {},
            created_at: new Date('2026-04-25T00:00:00.000Z'),
          },
        ],
        rowCount: 2,
      }),
    };

    const store = new EntityCanonicalizationStore({
      pool: pool as never,
      logger,
    });

    const result = await store.resolveEntityName({
      entityType: 'person',
      entityName: 'Smith',
    });

    expect(result).toMatchObject({
      canonicalId: null,
      normalizedEntityName: 'smith',
      resolution: 'ambiguous',
      resolutionReason: 'ambiguous_person_last_name',
      canonicalEntity: null,
    });
    expect(result.matchedCanonicalIds).toEqual(['person-1', 'person-2']);
    expect(result.matchedEntities).toEqual([
      {
        id: 'person-1',
        entityType: 'person',
        canonicalName: 'John Smith',
        normalizedCanonicalName: 'john smith',
      },
      {
        id: 'person-2',
        entityType: 'person',
        canonicalName: 'Alice Smith',
        normalizedCanonicalName: 'alice smith',
      },
    ]);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'person',
        entityName: 'Smith',
        resolution: 'ambiguous',
        resolutionReason: 'ambiguous_person_last_name',
        matchedCanonicalIds: ['person-1', 'person-2'],
      }),
      'entity canonicalization did not resolve uniquely',
    );
  });
});
