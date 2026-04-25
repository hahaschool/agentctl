import type {
  EntityCanonicalizationReason,
  EntityCanonicalizationResolution,
} from './entity-canonicalization.js';
import { canonicalizeEntityName, normalizeEntityName } from './entity-canonicalization.js';
import type { MemoryCanonicalAliasRecord } from './entity-canonicalization-store.js';
import { sanitizeMemoryDrawerContent } from './memory-drawer-sanitizer.js';

const DEFAULT_PREVIEW_CHAR_LIMIT = 160;

export type EntityCanonicalizationProposalAction =
  | 'none'
  | 'review_alias'
  | 'review_match'
  | 'review_entity';

export type EntityCanonicalizationProposalCandidateSource = {
  sessionId?: string | null;
  agentId?: string | null;
  machineId?: string | null;
  turnIndex?: number | null;
  importSourceId?: string | null;
  importJobId?: string | null;
};

export type EntityCanonicalizationProposalCandidate = {
  factId: string;
  scope?: string | null;
  entityType: string;
  entityName: string;
  content?: string | null;
  source?: EntityCanonicalizationProposalCandidateSource;
};

export type EntityCanonicalizationProposalReviewSource = {
  scope: string | null;
  sessionId: string | null;
  agentId: string | null;
  machineId: string | null;
  turnIndex: number | null;
  importSourceId: string | null;
  importJobId: string | null;
};

export type EntityCanonicalizationProposalRow = {
  factId: string;
  scope: string | null;
  entityType: string;
  entityName: string;
  normalizedEntityName: string;
  status: EntityCanonicalizationResolution;
  resolutionReason: EntityCanonicalizationReason;
  proposalAction: EntityCanonicalizationProposalAction;
  canonicalId: string | null;
  canonicalName: string | null;
  proposedAlias: string | null;
  aliasAlreadyExists: boolean;
  matchedCanonicalIds: string[];
  matchedCanonicalNames: string[];
  contentPreview: string | null;
  reviewSource: EntityCanonicalizationProposalReviewSource;
};

export type EntityCanonicalizationProposalSummary = {
  candidates: number;
  resolved: number;
  ambiguous: number;
  unresolved: number;
  proposedAliases: number;
  exactMatches: number;
  skippedSourceMutations: number;
};

export type EntityCanonicalizationProposalReport = {
  dryRun: true;
  generatedAt: string;
  summary: EntityCanonicalizationProposalSummary;
  proposals: EntityCanonicalizationProposalRow[];
};

export function buildEntityCanonicalizationProposalReport(options: {
  candidates: readonly EntityCanonicalizationProposalCandidate[];
  aliases: readonly MemoryCanonicalAliasRecord[];
  previewCharLimit?: number;
}): EntityCanonicalizationProposalReport {
  const previewCharLimit = normalizePreviewCharLimit(options.previewCharLimit);
  const aliasesByType = groupAliasesByEntityType(options.aliases);
  const proposals = options.candidates.map((candidate) =>
    buildProposalRow(candidate, aliasesByType, previewCharLimit),
  );

  return {
    dryRun: true,
    generatedAt: new Date().toISOString(),
    summary: {
      candidates: proposals.length,
      resolved: proposals.filter((proposal) => proposal.status === 'resolved').length,
      ambiguous: proposals.filter((proposal) => proposal.status === 'ambiguous').length,
      unresolved: proposals.filter((proposal) => proposal.status === 'unresolved').length,
      proposedAliases: proposals.filter((proposal) => proposal.proposalAction === 'review_alias')
        .length,
      exactMatches: proposals.filter(
        (proposal) =>
          proposal.resolutionReason === 'exact' || proposal.resolutionReason === 'person_exact',
      ).length,
      skippedSourceMutations: proposals.length,
    },
    proposals,
  };
}

function buildProposalRow(
  candidate: EntityCanonicalizationProposalCandidate,
  aliasesByType: ReadonlyMap<string, readonly MemoryCanonicalAliasRecord[]>,
  previewCharLimit: number,
): EntityCanonicalizationProposalRow {
  const entityType = normalizeEntityType(candidate.entityType);
  const entityName = requireTrimmedString(candidate.entityName, 'entityName');
  const aliases = aliasesByType.get(entityType) ?? [];
  const resolution = canonicalizeEntityName({
    entityType,
    entityName,
    aliases: aliases.map((alias) => ({
      canonicalId: alias.canonicalId,
      alias: alias.alias,
    })),
  });

  const canonicalId = resolution.canonicalId;
  const canonicalName = canonicalId ? resolveCanonicalName(canonicalId, aliases) : null;
  const aliasAlreadyExists =
    canonicalId === null
      ? false
      : aliases.some(
          (alias) =>
            alias.canonicalId === canonicalId &&
            alias.normalizedAlias === resolution.normalizedEntityName,
        );
  const proposalAction = resolveProposalAction(resolution.resolution, aliasAlreadyExists);

  return {
    factId: requireTrimmedString(candidate.factId, 'factId'),
    scope: normalizeOptionalString(candidate.scope),
    entityType,
    entityName,
    normalizedEntityName: resolution.normalizedEntityName,
    status: resolution.resolution,
    resolutionReason: resolution.resolutionReason,
    proposalAction,
    canonicalId,
    canonicalName,
    proposedAlias: proposalAction === 'review_alias' && canonicalId !== null ? entityName : null,
    aliasAlreadyExists,
    matchedCanonicalIds: [...resolution.matchedCanonicalIds],
    matchedCanonicalNames: resolveMatchedCanonicalNames(resolution.matchedCanonicalIds, aliases),
    contentPreview: buildContentPreview(candidate.content, previewCharLimit),
    reviewSource: {
      scope: normalizeOptionalString(candidate.scope),
      sessionId: normalizeOptionalString(candidate.source?.sessionId),
      agentId: normalizeOptionalString(candidate.source?.agentId),
      machineId: normalizeOptionalString(candidate.source?.machineId),
      turnIndex: normalizeOptionalInteger(candidate.source?.turnIndex),
      importSourceId: normalizeOptionalString(candidate.source?.importSourceId),
      importJobId: normalizeOptionalString(candidate.source?.importJobId),
    },
  };
}

function groupAliasesByEntityType(
  aliases: readonly MemoryCanonicalAliasRecord[],
): Map<string, readonly MemoryCanonicalAliasRecord[]> {
  const grouped = new Map<string, MemoryCanonicalAliasRecord[]>();

  for (const alias of aliases) {
    const entityType = normalizeEntityType(alias.entityType);
    const existing = grouped.get(entityType) ?? [];
    existing.push(alias);
    grouped.set(entityType, existing);
  }

  return grouped;
}

function resolveCanonicalName(
  canonicalId: string,
  aliases: readonly MemoryCanonicalAliasRecord[],
): string | null {
  const record = aliases.find((alias) => alias.canonicalId === canonicalId);
  return record?.canonicalName ?? null;
}

function resolveMatchedCanonicalNames(
  canonicalIds: readonly string[],
  aliases: readonly MemoryCanonicalAliasRecord[],
): string[] {
  const names = new Set<string>();

  for (const canonicalId of canonicalIds) {
    const canonicalName = resolveCanonicalName(canonicalId, aliases);
    if (canonicalName) {
      names.add(canonicalName);
    }
  }

  return [...names].sort((left, right) => left.localeCompare(right));
}

function resolveProposalAction(
  status: EntityCanonicalizationResolution,
  aliasAlreadyExists: boolean,
): EntityCanonicalizationProposalAction {
  if (status === 'ambiguous') {
    return 'review_match';
  }

  if (status === 'unresolved') {
    return 'review_entity';
  }

  return aliasAlreadyExists ? 'none' : 'review_alias';
}

function buildContentPreview(content: string | null | undefined, limit: number): string | null {
  const trimmed = normalizeOptionalString(content);
  if (trimmed === null) {
    return null;
  }

  const sanitized = sanitizeMemoryDrawerContent(trimmed).content.replace(/\s+/gu, ' ').trim();
  if (!sanitized) {
    return null;
  }

  if (sanitized.length <= limit) {
    return sanitized;
  }

  if (limit <= 3) {
    return sanitized.slice(0, limit);
  }

  return `${sanitized.slice(0, limit - 3).trimEnd()}...`;
}

function normalizeEntityType(value: string): string {
  return requireTrimmedString(value, 'entityType').toLowerCase();
}

function normalizePreviewCharLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_PREVIEW_CHAR_LIMIT;
  }

  if (!Number.isInteger(value) || value < 16) {
    throw new Error('previewCharLimit must be an integer >= 16');
  }

  return value;
}

function requireTrimmedString(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return trimmed;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalInteger(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function normalizeCanonicalAliasRecord(
  record: Pick<
    MemoryCanonicalAliasRecord,
    'canonicalId' | 'entityType' | 'canonicalName' | 'alias'
  > &
    Partial<
      Pick<MemoryCanonicalAliasRecord, 'id' | 'normalizedCanonicalName' | 'normalizedAlias'>
    > &
    Partial<Pick<MemoryCanonicalAliasRecord, 'sourceJson' | 'createdAt'>>,
  index: number,
): MemoryCanonicalAliasRecord {
  const canonicalId = requireTrimmedString(record.canonicalId, 'canonicalId');
  const entityType = normalizeEntityType(record.entityType);
  const canonicalName = requireTrimmedString(record.canonicalName, 'canonicalName');
  const alias = requireTrimmedString(record.alias, 'alias');

  return {
    id: normalizeOptionalString(record.id) ?? `proposal-alias-${index + 1}`,
    canonicalId,
    entityType,
    canonicalName,
    normalizedCanonicalName:
      normalizeOptionalString(record.normalizedCanonicalName) ?? normalizeEntityName(canonicalName),
    alias,
    normalizedAlias: normalizeOptionalString(record.normalizedAlias) ?? normalizeEntityName(alias),
    sourceJson: record.sourceJson ?? {},
    createdAt: normalizeOptionalString(record.createdAt) ?? '1970-01-01T00:00:00.000Z',
  };
}
