import {
  canonicalizeEntityName,
  type EntityCanonicalAlias,
  type EntityCanonicalizationReason,
  type EntityCanonicalizationResolution,
  normalizeEntityName,
} from './entity-canonicalization.js';

const DEFAULT_FACT_SAMPLE_SIZE = 500;
const DEFAULT_DRAWER_SAMPLE_SIZE = 500;
const PERSON_PATTERN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/gu;
const PR_PATTERN = /\bPR\s+#\d+\b/giu;
const AGENT_PATTERN = /\bagent-[A-Za-z0-9_-]+\b/gu;
const MACHINE_PATTERN = /\b(?:dev|prod|staging)-\d+\b/giu;
const FILE_PATTERN = /\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+\b/gu;

export type EntityExtractionBenchmarkQueryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount?: number }>;
};

export type EntityExtractionBenchmarkSource = {
  sourceKind: 'fact' | 'drawer';
  sourceId: string;
  scope: string;
  createdAt: string;
  topic: string | null;
  text: string;
  entityType: string | null;
};

export type ExtractedBenchmarkEntity = {
  entityName: string;
  entityType: string;
};

export type EntityExtractionBenchmarkExtractor = (
  source: EntityExtractionBenchmarkSource,
) => readonly ExtractedBenchmarkEntity[];

export type EntityExtractionBenchmarkProposalRow = {
  sourceKind: EntityExtractionBenchmarkSource['sourceKind'];
  sourceId: string;
  scope: string;
  entityType: string;
  entityName: string;
  normalizedEntityName: string;
  canonicalId: string | null;
  resolution: EntityCanonicalizationResolution;
  resolutionReason: EntityCanonicalizationReason;
  matchedCanonicalIds: string[];
};

export type EntityExtractionBenchmarkSummary = {
  sampledFacts: number;
  sampledDrawers: number;
  proposalCount: number;
  resolved: number;
  ambiguous: number;
  unresolved: number;
};

export type EntityExtractionBenchmarkResult = {
  proposals: EntityExtractionBenchmarkProposalRow[];
  summary: EntityExtractionBenchmarkSummary;
};

export type RunEntityExtractionBenchmarkOptions = {
  pool: EntityExtractionBenchmarkQueryable;
  aliases: readonly EntityCanonicalAlias[];
  factSampleSize?: number;
  drawerSampleSize?: number;
  extractEntities?: EntityExtractionBenchmarkExtractor;
};

type FactBenchmarkRow = {
  id: string;
  scope: string;
  content: string;
  entity_type: string;
  created_at: string | Date;
};

type DrawerBenchmarkRow = {
  id: string;
  scope: string;
  topic: string;
  content: string;
  created_at: string | Date;
};

export async function runEntityExtractionBenchmark(
  options: RunEntityExtractionBenchmarkOptions,
): Promise<EntityExtractionBenchmarkResult> {
  const extractEntities = options.extractEntities ?? extractDeterministicBenchmarkEntities;
  const [factRows, drawerRows] = await Promise.all([
    loadFactSources(options.pool),
    loadDrawerSources(options.pool),
  ]);
  const sampledFacts = sampleBenchmarkSources(
    factRows,
    options.factSampleSize,
    DEFAULT_FACT_SAMPLE_SIZE,
  );
  const sampledDrawers = sampleBenchmarkSources(
    drawerRows,
    options.drawerSampleSize,
    DEFAULT_DRAWER_SAMPLE_SIZE,
  );

  const proposals = [...sampledFacts, ...sampledDrawers]
    .flatMap((source) =>
      dedupeEntities(extractEntities(source)).map((entity) => {
        const resolution = canonicalizeEntityName({
          entityType: entity.entityType,
          entityName: entity.entityName,
          aliases: options.aliases,
        });

        return {
          sourceKind: source.sourceKind,
          sourceId: source.sourceId,
          scope: source.scope,
          entityType: entity.entityType,
          entityName: entity.entityName,
          normalizedEntityName: resolution.normalizedEntityName,
          canonicalId: resolution.canonicalId,
          resolution: resolution.resolution,
          resolutionReason: resolution.resolutionReason,
          matchedCanonicalIds: resolution.matchedCanonicalIds,
        } satisfies EntityExtractionBenchmarkProposalRow;
      }),
    )
    .sort(compareProposalRows);

  return {
    proposals,
    summary: {
      sampledFacts: sampledFacts.length,
      sampledDrawers: sampledDrawers.length,
      proposalCount: proposals.length,
      resolved: proposals.filter((proposal) => proposal.resolution === 'resolved').length,
      ambiguous: proposals.filter((proposal) => proposal.resolution === 'ambiguous').length,
      unresolved: proposals.filter((proposal) => proposal.resolution === 'unresolved').length,
    },
  };
}

export function extractDeterministicBenchmarkEntities(
  source: EntityExtractionBenchmarkSource,
): ExtractedBenchmarkEntity[] {
  const candidates: ExtractedBenchmarkEntity[] = [];
  const referenceText = source.topic ? `${source.topic}\n${source.text}` : source.text;

  pushPatternCandidates(candidates, source.text, PERSON_PATTERN, 'person');
  pushPatternCandidates(candidates, referenceText, PR_PATTERN, 'reference');
  pushPatternCandidates(candidates, referenceText, AGENT_PATTERN, 'reference');
  pushPatternCandidates(candidates, referenceText, MACHINE_PATTERN, 'reference');
  pushPatternCandidates(candidates, referenceText, FILE_PATTERN, 'reference');

  return candidates;
}

async function loadFactSources(
  pool: EntityExtractionBenchmarkQueryable,
): Promise<EntityExtractionBenchmarkSource[]> {
  const { rows } = await pool.query<FactBenchmarkRow>(
    `SELECT id, scope, content, entity_type, created_at
     FROM memory_facts
     WHERE valid_until IS NULL
     ORDER BY created_at ASC, id ASC`,
  );

  return rows.map((row) => ({
    sourceKind: 'fact',
    sourceId: row.id,
    scope: row.scope,
    createdAt: toIsoString(row.created_at),
    topic: null,
    text: row.content,
    entityType: row.entity_type,
  }));
}

async function loadDrawerSources(
  pool: EntityExtractionBenchmarkQueryable,
): Promise<EntityExtractionBenchmarkSource[]> {
  const { rows } = await pool.query<DrawerBenchmarkRow>(
    `SELECT id, scope, topic, content, created_at
     FROM memory_drawers
     WHERE archived_at IS NULL
     ORDER BY created_at ASC, id ASC`,
  );

  return rows.map((row) => ({
    sourceKind: 'drawer',
    sourceId: row.id,
    scope: row.scope,
    createdAt: toIsoString(row.created_at),
    topic: row.topic,
    text: row.content,
    entityType: null,
  }));
}

function pushPatternCandidates(
  candidates: ExtractedBenchmarkEntity[],
  text: string,
  pattern: RegExp,
  entityType: string,
): void {
  for (const match of text.matchAll(pattern)) {
    const entityName = match[0]?.trim();
    if (!entityName) {
      continue;
    }
    pushUniqueEntity(candidates, { entityName, entityType });
  }
}

function pushUniqueEntity(
  candidates: ExtractedBenchmarkEntity[],
  candidate: ExtractedBenchmarkEntity,
): void {
  const key = `${candidate.entityType}:${normalizeEntityName(candidate.entityName)}`;
  const existing = candidates.some(
    (entry) => `${entry.entityType}:${normalizeEntityName(entry.entityName)}` === key,
  );
  if (!existing) {
    candidates.push(candidate);
  }
}

function dedupeEntities(entities: readonly ExtractedBenchmarkEntity[]): ExtractedBenchmarkEntity[] {
  const deduped: ExtractedBenchmarkEntity[] = [];
  for (const entity of entities) {
    pushUniqueEntity(deduped, entity);
  }
  return deduped;
}

function sampleBenchmarkSources(
  rows: readonly EntityExtractionBenchmarkSource[],
  requestedSize: number | undefined,
  defaultSize: number,
): EntityExtractionBenchmarkSource[] {
  const limit = normalizeSampleSize(requestedSize, defaultSize);
  return [...rows]
    .sort(
      (left, right) =>
        compareString(left.createdAt, right.createdAt) ||
        compareString(left.sourceId, right.sourceId),
    )
    .slice(0, limit);
}

function normalizeSampleSize(value: number | undefined, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function compareProposalRows(
  left: EntityExtractionBenchmarkProposalRow,
  right: EntityExtractionBenchmarkProposalRow,
): number {
  return (
    compareString(left.sourceKind, right.sourceKind) ||
    compareString(left.sourceId, right.sourceId) ||
    compareString(left.entityType, right.entityType) ||
    compareString(left.normalizedEntityName, right.normalizedEntityName) ||
    compareString(left.resolution, right.resolution) ||
    compareString(left.canonicalId ?? '', right.canonicalId ?? '')
  );
}

function compareString(left: string, right: string): number {
  return left.localeCompare(right);
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
