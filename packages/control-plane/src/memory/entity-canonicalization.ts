export type EntityCanonicalAlias = {
  canonicalId: string;
  alias: string;
};

export type EntityCanonicalizationResolution = 'resolved' | 'ambiguous' | 'unresolved';

export type EntityCanonicalizationReason =
  | 'exact'
  | 'person_exact'
  | 'person_last_name'
  | 'ambiguous_exact'
  | 'ambiguous_person_last_name'
  | 'unresolved';

export type CanonicalizeEntityNameInput = {
  entityType: string;
  entityName: string;
  aliases: readonly EntityCanonicalAlias[];
};

export type EntityCanonicalizationResult = {
  entityType: string;
  entityName: string;
  normalizedEntityName: string;
  canonicalId: string | null;
  resolution: EntityCanonicalizationResolution;
  resolutionReason: EntityCanonicalizationReason;
  matchedCanonicalIds: string[];
};

export function normalizeEntityName(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/gu, ' ');
}

export function canonicalizeEntityName(
  input: CanonicalizeEntityNameInput,
): EntityCanonicalizationResult {
  const normalizedEntityName = normalizeEntityName(input.entityName);
  const exactMatches = findMatchingCanonicalIds(
    input.aliases,
    (normalizedAlias) => normalizedAlias === normalizedEntityName,
  );

  if (exactMatches.length === 1) {
    return {
      entityType: input.entityType,
      entityName: input.entityName,
      normalizedEntityName,
      canonicalId: exactMatches[0] ?? null,
      resolution: 'resolved',
      resolutionReason:
        normalizeEntityType(input.entityType) === 'person' ? 'person_exact' : 'exact',
      matchedCanonicalIds: exactMatches,
    };
  }

  if (exactMatches.length > 1) {
    return {
      entityType: input.entityType,
      entityName: input.entityName,
      normalizedEntityName,
      canonicalId: null,
      resolution: 'ambiguous',
      resolutionReason: 'ambiguous_exact',
      matchedCanonicalIds: exactMatches,
    };
  }

  if (normalizeEntityType(input.entityType) !== 'person') {
    return unresolvedEntity(input, normalizedEntityName);
  }

  const lastName = extractLastName(normalizedEntityName);
  if (!lastName) {
    return unresolvedEntity(input, normalizedEntityName);
  }

  const lastNameMatches = findMatchingCanonicalIds(input.aliases, (normalizedAlias) => {
    const aliasLastName = extractLastName(normalizedAlias);
    return aliasLastName === lastName;
  });

  if (lastNameMatches.length === 1) {
    return {
      entityType: input.entityType,
      entityName: input.entityName,
      normalizedEntityName,
      canonicalId: lastNameMatches[0] ?? null,
      resolution: 'resolved',
      resolutionReason: 'person_last_name',
      matchedCanonicalIds: lastNameMatches,
    };
  }

  if (lastNameMatches.length > 1) {
    return {
      entityType: input.entityType,
      entityName: input.entityName,
      normalizedEntityName,
      canonicalId: null,
      resolution: 'ambiguous',
      resolutionReason: 'ambiguous_person_last_name',
      matchedCanonicalIds: lastNameMatches,
    };
  }

  return unresolvedEntity(input, normalizedEntityName);
}

function unresolvedEntity(
  input: CanonicalizeEntityNameInput,
  normalizedEntityName: string,
): EntityCanonicalizationResult {
  return {
    entityType: input.entityType,
    entityName: input.entityName,
    normalizedEntityName,
    canonicalId: null,
    resolution: 'unresolved',
    resolutionReason: 'unresolved',
    matchedCanonicalIds: [],
  };
}

function normalizeEntityType(value: string): string {
  return value.trim().toLowerCase();
}

function extractLastName(value: string): string | null {
  const parts = value.split(' ').filter((part) => part.length > 0);
  return parts.length > 0 ? (parts.at(-1) ?? null) : null;
}

function findMatchingCanonicalIds(
  aliases: readonly EntityCanonicalAlias[],
  predicate: (normalizedAlias: string) => boolean,
): string[] {
  return [
    ...new Set(
      aliases
        .filter((alias) => predicate(normalizeEntityName(alias.alias)))
        .map((alias) => alias.canonicalId),
    ),
  ].sort((left, right) => left.localeCompare(right));
}
