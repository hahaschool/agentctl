import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type {
  EntityCanonicalizationReason,
  EntityCanonicalizationResolution,
} from './entity-canonicalization.js';
import { canonicalizeEntityName, normalizeEntityName } from './entity-canonicalization.js';

export type EntityCanonicalizationStoreOptions = {
  pool: Pool;
  logger?: Logger;
};

export type MemoryCanonicalEntity = {
  id: string;
  entityType: string;
  canonicalName: string;
  normalizedCanonicalName: string;
  metadataJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type MemoryCanonicalAlias = {
  id: string;
  canonicalId: string;
  alias: string;
  normalizedAlias: string;
  sourceJson: Record<string, unknown>;
  createdAt: string;
};

export type MemoryCanonicalAliasRecord = MemoryCanonicalAlias & {
  entityType: string;
  canonicalName: string;
  normalizedCanonicalName: string;
};

export type ResolvedCanonicalEntity = Pick<
  MemoryCanonicalEntity,
  'id' | 'entityType' | 'canonicalName' | 'normalizedCanonicalName'
>;

export type CreateCanonicalEntityInput = {
  entityType: string;
  canonicalName: string;
  metadataJson?: Record<string, unknown>;
  aliases?: readonly {
    alias: string;
    sourceJson?: Record<string, unknown>;
  }[];
};

export type UpsertCanonicalAliasInput = {
  canonicalId: string;
  alias: string;
  sourceJson?: Record<string, unknown>;
};

export type ListCanonicalAliasesInput = {
  entityType?: string;
  canonicalId?: string;
};

export type ResolveCanonicalEntityInput = {
  entityType: string;
  entityName: string;
};

export type ResolveCanonicalEntityResult = {
  entityType: string;
  entityName: string;
  normalizedEntityName: string;
  canonicalId: string | null;
  resolution: EntityCanonicalizationResolution;
  resolutionReason: EntityCanonicalizationReason;
  matchedCanonicalIds: string[];
  canonicalEntity: ResolvedCanonicalEntity | null;
  matchedEntities: ResolvedCanonicalEntity[];
};

type MemoryEntityRow = {
  id: string;
  entity_type: string;
  canonical_name: string;
  normalized_canonical_name: string;
  metadata_json: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type MemoryAliasRow = {
  id: string;
  canonical_id: string;
  alias: string;
  normalized_alias: string;
  source_json: Record<string, unknown> | null;
  created_at: Date | string;
};

type MemoryAliasRecordRow = MemoryAliasRow & {
  entity_type: string;
  canonical_name: string;
  normalized_canonical_name: string;
};

function generateId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function toIso(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function requireTrimmedText(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return trimmed;
}

function normalizeEntityTypeForStorage(value: string): string {
  return requireTrimmedText(value, 'entityType').toLowerCase();
}

function rowToEntity(row: MemoryEntityRow): MemoryCanonicalEntity {
  return {
    id: row.id,
    entityType: row.entity_type,
    canonicalName: row.canonical_name,
    normalizedCanonicalName: row.normalized_canonical_name,
    metadataJson: row.metadata_json ?? {},
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function rowToAlias(row: MemoryAliasRow): MemoryCanonicalAlias {
  return {
    id: row.id,
    canonicalId: row.canonical_id,
    alias: row.alias,
    normalizedAlias: row.normalized_alias,
    sourceJson: row.source_json ?? {},
    createdAt: toIso(row.created_at),
  };
}

function rowToAliasRecord(row: MemoryAliasRecordRow): MemoryCanonicalAliasRecord {
  return {
    ...rowToAlias(row),
    entityType: row.entity_type,
    canonicalName: row.canonical_name,
    normalizedCanonicalName: row.normalized_canonical_name,
  };
}

function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) {
    throw new Error(`Missing ${label} row`);
  }
  return row;
}

function dedupeAliases(
  canonicalName: string,
  aliases: CreateCanonicalEntityInput['aliases'],
): Array<{ alias: string; sourceJson: Record<string, unknown> }> {
  const seen = new Set<string>();
  const deduped: Array<{ alias: string; sourceJson: Record<string, unknown> }> = [];
  const candidates = [{ alias: canonicalName, sourceJson: {} }, ...(aliases ?? [])];

  for (const candidate of candidates) {
    const alias = requireTrimmedText(candidate.alias, 'alias');
    const normalizedAlias = normalizeEntityName(alias);
    if (seen.has(normalizedAlias)) {
      continue;
    }
    seen.add(normalizedAlias);
    deduped.push({
      alias,
      sourceJson: candidate.sourceJson ?? {},
    });
  }

  return deduped;
}

function uniqueMatchedEntities(
  matchedCanonicalIds: readonly string[],
  aliases: readonly MemoryCanonicalAliasRecord[],
): ResolvedCanonicalEntity[] {
  const entitiesById = new Map<string, ResolvedCanonicalEntity>();

  for (const alias of aliases) {
    if (!entitiesById.has(alias.canonicalId)) {
      entitiesById.set(alias.canonicalId, {
        id: alias.canonicalId,
        entityType: alias.entityType,
        canonicalName: alias.canonicalName,
        normalizedCanonicalName: alias.normalizedCanonicalName,
      });
    }
  }

  return matchedCanonicalIds
    .map((canonicalId) => entitiesById.get(canonicalId))
    .filter((entity): entity is ResolvedCanonicalEntity => entity !== undefined);
}

export class EntityCanonicalizationStore {
  private readonly pool: Pool;
  private readonly logger: Logger | undefined;

  constructor(options: EntityCanonicalizationStoreOptions) {
    this.pool = options.pool;
    this.logger = options.logger;
  }

  async createEntity(
    input: CreateCanonicalEntityInput,
  ): Promise<{ entity: MemoryCanonicalEntity; aliases: MemoryCanonicalAlias[] }> {
    const entityType = normalizeEntityTypeForStorage(input.entityType);
    const canonicalName = requireTrimmedText(input.canonicalName, 'canonicalName');
    const normalizedCanonicalName = normalizeEntityName(canonicalName);
    const entityId = generateId('me');
    const entityResult = await this.pool.query<MemoryEntityRow>(
      `INSERT INTO memory_entities (
         id, entity_type, canonical_name, normalized_canonical_name, metadata_json
       ) VALUES (
         $1, $2, $3, $4, $5
       )
       RETURNING id, entity_type, canonical_name, normalized_canonical_name,
         metadata_json, created_at, updated_at`,
      [entityId, entityType, canonicalName, normalizedCanonicalName, input.metadataJson ?? {}],
    );

    const entity = rowToEntity(requireRow(entityResult.rows[0], 'memory entity'));
    const aliases: MemoryCanonicalAlias[] = [];

    for (const aliasInput of dedupeAliases(canonicalName, input.aliases)) {
      aliases.push(
        await this.upsertAlias({
          canonicalId: entity.id,
          alias: aliasInput.alias,
          sourceJson: aliasInput.sourceJson,
        }),
      );
    }

    return { entity, aliases };
  }

  async upsertAlias(input: UpsertCanonicalAliasInput): Promise<MemoryCanonicalAlias> {
    const canonicalId = requireTrimmedText(input.canonicalId, 'canonicalId');
    const alias = requireTrimmedText(input.alias, 'alias');
    const normalizedAlias = normalizeEntityName(alias);
    const aliasId = generateId('mea');
    const result = await this.pool.query<MemoryAliasRow>(
      `INSERT INTO memory_entity_aliases (
         id, canonical_id, alias, normalized_alias, source_json
       ) VALUES (
         $1, $2, $3, $4, $5
       )
       ON CONFLICT (canonical_id, normalized_alias)
       DO UPDATE SET
         alias = EXCLUDED.alias,
         source_json = EXCLUDED.source_json
       RETURNING id, canonical_id, alias, normalized_alias, source_json, created_at`,
      [aliasId, canonicalId, alias, normalizedAlias, input.sourceJson ?? {}],
    );

    return rowToAlias(requireRow(result.rows[0], 'memory entity alias'));
  }

  async listAliases(input: ListCanonicalAliasesInput = {}): Promise<MemoryCanonicalAliasRecord[]> {
    const entityType = input.entityType ? normalizeEntityTypeForStorage(input.entityType) : null;
    const canonicalId = input.canonicalId
      ? requireTrimmedText(input.canonicalId, 'canonicalId')
      : null;
    const result = await this.pool.query<MemoryAliasRecordRow>(
      `SELECT a.id, a.canonical_id, e.entity_type, e.canonical_name,
         e.normalized_canonical_name, a.alias, a.normalized_alias,
         a.source_json, a.created_at
       FROM memory_entity_aliases a
       JOIN memory_entities e ON e.id = a.canonical_id
       WHERE ($1::text IS NULL OR e.entity_type = $1)
         AND ($2::text IS NULL OR a.canonical_id = $2)
       ORDER BY e.entity_type ASC, a.normalized_alias ASC, a.canonical_id ASC, a.alias ASC`,
      [entityType, canonicalId],
    );

    return result.rows.map(rowToAliasRecord);
  }

  async resolveEntityName(
    input: ResolveCanonicalEntityInput,
  ): Promise<ResolveCanonicalEntityResult> {
    const entityType = normalizeEntityTypeForStorage(input.entityType);
    const aliases = await this.listAliases({ entityType });
    const resolution = canonicalizeEntityName({
      entityType,
      entityName: input.entityName,
      aliases: aliases.map((alias) => ({
        canonicalId: alias.canonicalId,
        alias: alias.alias,
      })),
    });
    const matchedEntities = uniqueMatchedEntities(resolution.matchedCanonicalIds, aliases);
    const canonicalEntity =
      resolution.canonicalId === null
        ? null
        : (matchedEntities.find((entity) => entity.id === resolution.canonicalId) ?? null);

    if (resolution.resolution !== 'resolved') {
      this.logger?.debug(
        {
          entityType,
          entityName: input.entityName,
          resolution: resolution.resolution,
          resolutionReason: resolution.resolutionReason,
          matchedCanonicalIds: resolution.matchedCanonicalIds,
        },
        'entity canonicalization did not resolve uniquely',
      );
    }

    return {
      ...resolution,
      canonicalEntity,
      matchedEntities,
    };
  }
}
