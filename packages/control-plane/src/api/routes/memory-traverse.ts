import {
  MEMORY_RELATION_TYPES,
  type MemoryEdge,
  type MemoryFact,
  type MemoryTraverseEdge,
  type MemoryTraverseNode,
  type MemoryTraverseRequest,
  type MemoryTraverseResponse,
  type RelationType,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';

import type { MemoryStore } from '../../memory/memory-store.js';

const DEFAULT_MAX_HOPS = 3;
const MAX_ALLOWED_HOPS = 10;
const DEFAULT_MAX_NODES = 100;
const MAX_ALLOWED_NODES = 100;
const MAX_RELATION_TYPE_FILTERS = 20;
const MAX_CANONICAL_ID_LENGTH = 128;
const SAFE_CANONICAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RELATION_TYPES = new Set<string>(MEMORY_RELATION_TYPES);

type ControlPlaneMemoryTraverseRequest = MemoryTraverseRequest & {
  max_nodes?: number;
};

type ParsedTraverseRequest = {
  startEntityCanonicalId: string;
  maxHops: number;
  maxNodes: number;
  relationTypes?: Set<RelationType>;
  minConfidence?: number;
  asOf?: Date;
};

type MemoryTraverseRoutesOptions = {
  memoryStore: Pick<MemoryStore, 'getFact' | 'listEdges'>;
  logger?: Logger;
};

type ValidationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        error: 'INVALID_PARAMS';
        message: string;
      };
    };

export const memoryTraverseRoutes: FastifyPluginAsync<MemoryTraverseRoutesOptions> = async (
  app,
  opts,
) => {
  const { memoryStore, logger } = opts;

  app.post<{ Body: ControlPlaneMemoryTraverseRequest | null }>(
    '/',
    { schema: { tags: ['memory'], summary: 'Traverse memory facts through bounded graph edges' } },
    async (request, reply) => {
      const parsed = parseTraverseRequest(request.body);
      if (!parsed.ok) {
        return reply.code(400).send(parsed.error);
      }

      const startedAt = Date.now();
      const traverseRequest = parsed.value;
      const startFact = await memoryStore.getFact(traverseRequest.startEntityCanonicalId);
      if (!isFactVisibleAt(startFact, traverseRequest.asOf)) {
        return emptyGraphResponse(traverseRequest);
      }

      const graph = await traverseCurrentFactGraph(memoryStore, traverseRequest, startFact);
      logger?.debug(
        {
          startEntityCanonicalId: traverseRequest.startEntityCanonicalId,
          maxHops: traverseRequest.maxHops,
          nodeCount: graph.nodes.length,
          edgeCount: graph.edges.length,
          partial: graph.partial,
          durationMs: Date.now() - startedAt,
        },
        'memory traverse complete',
      );

      return graph;
    },
  );
};

async function traverseCurrentFactGraph(
  memoryStore: Pick<MemoryStore, 'getFact' | 'listEdges'>,
  traverseRequest: ParsedTraverseRequest,
  startFact: MemoryFact,
): Promise<MemoryTraverseResponse> {
  const factsById = new Map<string, { fact: MemoryFact; hopDistance: number }>();
  const factCache = new Map<string, MemoryFact | null>([[startFact.id, startFact]]);
  const edgesById = new Map<string, MemoryEdge>();
  factsById.set(startFact.id, { fact: startFact, hopDistance: 0 });

  let partial = false;
  let frontier = [startFact.id];

  for (let hopDistance = 1; hopDistance <= traverseRequest.maxHops; hopDistance += 1) {
    if (frontier.length === 0) {
      break;
    }

    const currentFrontier = [...frontier].sort();
    const currentFrontierIds = new Set(currentFrontier);
    const edges = sortEdges(await memoryStore.listEdges({ factIds: currentFrontier }));
    const nextFrontierIds = new Set<string>();

    for (const edge of edges) {
      if (!edgeMatchesFilters(edge, traverseRequest)) {
        continue;
      }
      if (
        !currentFrontierIds.has(edge.source_fact_id) &&
        !currentFrontierIds.has(edge.target_fact_id)
      ) {
        continue;
      }

      for (const endpointId of [edge.source_fact_id, edge.target_fact_id]) {
        if (factsById.has(endpointId)) {
          continue;
        }

        const fact = await getCachedFact(memoryStore, factCache, endpointId);
        if (!isFactVisibleAt(fact, traverseRequest.asOf)) {
          continue;
        }
        if (factsById.size >= traverseRequest.maxNodes) {
          partial = true;
          continue;
        }

        factsById.set(endpointId, { fact, hopDistance });
        nextFrontierIds.add(endpointId);
      }

      if (factsById.has(edge.source_fact_id) && factsById.has(edge.target_fact_id)) {
        edgesById.set(edge.id, edge);
      }
    }

    frontier = [...nextFrontierIds].sort();
  }

  const nodes = [...factsById.values()]
    .sort((left, right) => {
      if (left.hopDistance !== right.hopDistance) {
        return left.hopDistance - right.hopDistance;
      }
      return left.fact.id.localeCompare(right.fact.id);
    })
    .map(({ fact, hopDistance }) => factToTraverseNode(fact, hopDistance));
  const nodeIds = new Set(nodes.map((node) => node.canonical_id));
  const edges = sortEdges([...edgesById.values()])
    .filter((edge) => nodeIds.has(edge.source_fact_id) && nodeIds.has(edge.target_fact_id))
    .map(edgeToTraverseEdge);

  return {
    ok: true,
    start_entity_canonical_id: traverseRequest.startEntityCanonicalId,
    max_hops: traverseRequest.maxHops,
    node_cap: traverseRequest.maxNodes,
    nodes,
    edges,
    partial,
  };
}

async function getCachedFact(
  memoryStore: Pick<MemoryStore, 'getFact'>,
  factCache: Map<string, MemoryFact | null>,
  factId: string,
): Promise<MemoryFact | null> {
  if (factCache.has(factId)) {
    return factCache.get(factId) ?? null;
  }

  const fact = await memoryStore.getFact(factId);
  factCache.set(factId, fact);
  return fact;
}

function parseTraverseRequest(value: unknown): ValidationResult<ParsedTraverseRequest> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      error: { error: 'INVALID_PARAMS', message: 'request body must be a non-null object' },
    };
  }

  const body = value as Partial<ControlPlaneMemoryTraverseRequest>;
  const startEntityCanonicalId = normalizeStartEntityId(body.start_entity_canonical_id);
  if (!startEntityCanonicalId) {
    return {
      ok: false,
      error: {
        error: 'INVALID_PARAMS',
        message: 'start_entity_canonical_id must be a non-empty safe canonical id',
      },
    };
  }

  const maxHops = body.max_hops ?? DEFAULT_MAX_HOPS;
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > MAX_ALLOWED_HOPS) {
    return {
      ok: false,
      error: {
        error: 'INVALID_PARAMS',
        message: `max_hops must be an integer between 1 and ${MAX_ALLOWED_HOPS}`,
      },
    };
  }

  const maxNodes = body.max_nodes ?? DEFAULT_MAX_NODES;
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_ALLOWED_NODES) {
    return {
      ok: false,
      error: {
        error: 'INVALID_PARAMS',
        message: `max_nodes must be an integer between 1 and ${MAX_ALLOWED_NODES}`,
      },
    };
  }

  const relationTypesValidation = validateRelationTypes(body.relation_types);
  if (!relationTypesValidation.ok) {
    return relationTypesValidation;
  }

  const minConfidenceValidation = validateMinConfidence(body.min_confidence);
  if (!minConfidenceValidation.ok) {
    return minConfidenceValidation;
  }

  const asOfValidation = validateAsOf(body.as_of);
  if (!asOfValidation.ok) {
    return asOfValidation;
  }

  return {
    ok: true,
    value: {
      startEntityCanonicalId,
      maxHops,
      maxNodes,
      relationTypes:
        relationTypesValidation.value === undefined
          ? undefined
          : new Set(relationTypesValidation.value),
      minConfidence: minConfidenceValidation.value,
      asOf: asOfValidation.value,
    },
  };
}

function normalizeStartEntityId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_CANONICAL_ID_LENGTH ||
    trimmed.includes('..') ||
    hasControlCharacter(trimmed) ||
    !SAFE_CANONICAL_ID_PATTERN.test(trimmed)
  ) {
    return null;
  }

  return trimmed;
}

function validateRelationTypes(value: unknown): ValidationResult<RelationType[] | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(value) || value.length > MAX_RELATION_TYPE_FILTERS) {
    return {
      ok: false,
      error: {
        error: 'INVALID_PARAMS',
        message: `relation_types must be an array of up to ${MAX_RELATION_TYPE_FILTERS} valid relation types`,
      },
    };
  }

  const relationTypes: RelationType[] = [];
  for (const relationType of value) {
    if (typeof relationType !== 'string' || !isRelationType(relationType)) {
      return {
        ok: false,
        error: {
          error: 'INVALID_PARAMS',
          message: `relation_types must contain only: ${MEMORY_RELATION_TYPES.join(', ')}`,
        },
      };
    }
    if (!relationTypes.includes(relationType)) {
      relationTypes.push(relationType);
    }
  }

  return { ok: true, value: relationTypes };
}

function validateMinConfidence(value: unknown): ValidationResult<number | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return {
      ok: false,
      error: {
        error: 'INVALID_PARAMS',
        message: 'min_confidence must be a number between 0 and 1',
      },
    };
  }

  return { ok: true, value };
}

function validateAsOf(value: unknown): ValidationResult<Date | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') {
    return {
      ok: false,
      error: {
        error: 'INVALID_PARAMS',
        message: 'as_of must be a valid timestamp string',
      },
    };
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return {
      ok: false,
      error: {
        error: 'INVALID_PARAMS',
        message: 'as_of must be a valid timestamp string',
      },
    };
  }

  return { ok: true, value: new Date(timestamp) };
}

function isRelationType(value: string): value is RelationType {
  return RELATION_TYPES.has(value);
}

function edgeMatchesFilters(edge: MemoryEdge, traverseRequest: ParsedTraverseRequest): boolean {
  if (traverseRequest.relationTypes && !traverseRequest.relationTypes.has(edge.relation)) {
    return false;
  }
  if (
    traverseRequest.minConfidence !== undefined &&
    Number(edge.weight) < traverseRequest.minConfidence
  ) {
    return false;
  }

  return true;
}

function isFactVisibleAt(fact: MemoryFact | null, asOf: Date | undefined): fact is MemoryFact {
  if (!fact) {
    return false;
  }
  if (!asOf) {
    return true;
  }

  const validFrom = Date.parse(fact.valid_from);
  if (Number.isFinite(validFrom) && validFrom > asOf.getTime()) {
    return false;
  }

  if (fact.valid_until) {
    const validUntil = Date.parse(fact.valid_until);
    if (Number.isFinite(validUntil) && validUntil <= asOf.getTime()) {
      return false;
    }
  }

  return true;
}

function emptyGraphResponse(traverseRequest: ParsedTraverseRequest): MemoryTraverseResponse {
  return {
    ok: true,
    start_entity_canonical_id: traverseRequest.startEntityCanonicalId,
    max_hops: traverseRequest.maxHops,
    node_cap: traverseRequest.maxNodes,
    nodes: [],
    edges: [],
    partial: false,
  };
}

function factToTraverseNode(fact: MemoryFact, hopDistance: number): MemoryTraverseNode {
  // Current schema has fact IDs but no canonical entity table yet. Expose the
  // fact ID as the canonical graph node and the fact content as its label.
  return {
    canonical_id: fact.id,
    entity_name: fact.content,
    hop_distance: hopDistance,
    earliest_seen: fact.valid_from || fact.created_at || null,
  };
}

function edgeToTraverseEdge(edge: MemoryEdge): MemoryTraverseEdge {
  return {
    subject_id: edge.source_fact_id,
    object_id: edge.target_fact_id,
    relation: edge.relation,
    confidence: Number(edge.weight),
    valid_from: null,
    valid_until: null,
  };
}

function sortEdges(edges: MemoryEdge[]): MemoryEdge[] {
  return [...edges].sort((left, right) => {
    const leftKey = `${left.source_fact_id}\0${left.target_fact_id}\0${left.relation}\0${left.id}`;
    const rightKey = `${right.source_fact_id}\0${right.target_fact_id}\0${right.relation}\0${right.id}`;
    return leftKey.localeCompare(rightKey);
  });
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}
