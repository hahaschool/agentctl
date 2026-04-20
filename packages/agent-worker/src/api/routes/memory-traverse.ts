// ---------------------------------------------------------------------------
// Worker-side memory_traverse MCP tool route
//
// First contract slice: validate a bounded graph traversal request and call the
// planned control-plane traverse endpoint when available. The recursive graph
// query itself remains control-plane work.
// ---------------------------------------------------------------------------

import {
  MEMORY_RELATION_TYPES,
  type MemoryTraverseEdge,
  type MemoryTraverseNode,
  type MemoryTraverseRequest,
  type MemoryTraverseResponse,
  type RelationType,
} from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import { extractMcpArguments } from './mcp-arguments.js';

const DEFAULT_MAX_HOPS = 3;
const MAX_ALLOWED_HOPS = 10;
const MEMORY_TRAVERSE_MAX_NODES = 100;
const MEMORY_TRAVERSE_TIMEOUT_MS = 5_000;
const MAX_RELATION_TYPE_FILTERS = 20;
const MAX_CANONICAL_ID_LENGTH = 128;
const SAFE_CANONICAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RELATION_TYPES = new Set<string>(MEMORY_RELATION_TYPES);

type MemoryTraverseRouteOptions = FastifyPluginOptions & {
  controlPlaneUrl: string;
  logger: Logger;
};

type ControlPlaneTraverseRequest = MemoryTraverseRequest & {
  max_nodes: number;
};

type TraverseResponseBody = Record<string, unknown>;

export async function memoryTraverseRoutes(
  app: FastifyInstance,
  opts: MemoryTraverseRouteOptions,
): Promise<void> {
  const { controlPlaneUrl, logger } = opts;

  app.post(
    '/memory-traverse',
    async (request: FastifyRequest<{ Body: MemoryTraverseRequest }>, reply: FastifyReply) => {
      const extracted = extractMcpArguments<MemoryTraverseRequest>(request.body);
      if (!extracted.ok) {
        return reply.code(400).send(extracted.error);
      }

      const body = extracted.body;
      const startEntityCanonicalId = normalizeStartEntityId(body?.start_entity_canonical_id);
      if (!startEntityCanonicalId) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'start_entity_canonical_id must be a non-empty safe canonical id',
        });
      }

      const maxHops = body?.max_hops ?? DEFAULT_MAX_HOPS;
      if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > MAX_ALLOWED_HOPS) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: `max_hops must be an integer between 1 and ${MAX_ALLOWED_HOPS}`,
        });
      }

      const relationTypesValidation = validateRelationTypes(body?.relation_types);
      if (!relationTypesValidation.ok) {
        return reply.code(400).send(relationTypesValidation.error);
      }

      const minConfidenceValidation = validateMinConfidence(body?.min_confidence);
      if (!minConfidenceValidation.ok) {
        return reply.code(400).send(minConfidenceValidation.error);
      }

      const asOfValidation = validateAsOf(body?.as_of);
      if (!asOfValidation.ok) {
        return reply.code(400).send(asOfValidation.error);
      }

      const traverseRequest: ControlPlaneTraverseRequest = {
        start_entity_canonical_id: startEntityCanonicalId,
        max_hops: maxHops,
        max_nodes: MEMORY_TRAVERSE_MAX_NODES,
      };

      if (relationTypesValidation.value !== undefined) {
        traverseRequest.relation_types = relationTypesValidation.value;
      }
      if (minConfidenceValidation.value !== undefined) {
        traverseRequest.min_confidence = minConfidenceValidation.value;
      }
      if (asOfValidation.value !== undefined) {
        traverseRequest.as_of = asOfValidation.value;
      }

      const startedAt = Date.now();
      let response: Response;
      try {
        response = await fetch(`${controlPlaneUrl}/api/memory/traverse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(traverseRequest),
          signal: AbortSignal.timeout(MEMORY_TRAVERSE_TIMEOUT_MS),
        });
      } catch (error: unknown) {
        logger.error(
          { err: error, startEntityCanonicalId, maxHops },
          'Failed to reach control-plane for memory traverse',
        );
        return reply.code(503).send({
          error: 'MEMORY_TRAVERSE_UNREACHABLE',
          message: 'Control-plane unreachable while traversing memory graph',
        });
      }

      if (response.status === 404 || response.status === 204) {
        logger.debug(
          {
            startEntityCanonicalId,
            maxHops,
            status: response.status,
            durationMs: Date.now() - startedAt,
          },
          'memory_traverse returned empty graph',
        );
        return emptyGraphResponse(startEntityCanonicalId, maxHops);
      }

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({}));
        logger.warn(
          {
            startEntityCanonicalId,
            maxHops,
            status: response.status,
            body: responseBody,
            durationMs: Date.now() - startedAt,
          },
          'Control-plane returned error for memory traverse',
        );
        if (response.status === 501 || response.status === 503) {
          return reply.code(503).send({
            error: 'MEMORY_TRAVERSE_UNAVAILABLE',
            message: 'Control-plane memory traversal is not available',
          });
        }
        return reply.code(response.status).send(responseBody);
      }

      const result = (await response.json().catch(() => ({}))) as TraverseResponseBody;
      const traverseResponse = normalizeTraverseResponse(result, startEntityCanonicalId, maxHops);

      logger.debug(
        {
          startEntityCanonicalId,
          maxHops,
          nodeCount: traverseResponse.nodes.length,
          edgeCount: traverseResponse.edges.length,
          partial: traverseResponse.partial,
          durationMs: Date.now() - startedAt,
        },
        'memory_traverse complete',
      );

      return traverseResponse;
    },
  );
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        error: 'INVALID_PARAMS';
        message: string;
      };
    };

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

function isRelationType(value: string): value is RelationType {
  return RELATION_TYPES.has(value);
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

function validateAsOf(value: unknown): ValidationResult<string | undefined> {
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

  return { ok: true, value: new Date(timestamp).toISOString() };
}

function normalizeTraverseResponse(
  result: TraverseResponseBody,
  startEntityCanonicalId: string,
  maxHops: number,
): MemoryTraverseResponse {
  const normalizedNodes = extractRecords(result.nodes)
    .map(normalizeNode)
    .filter((node): node is MemoryTraverseNode => node !== null);
  const partialFromNodeCap = normalizedNodes.length > MEMORY_TRAVERSE_MAX_NODES;
  const nodes = normalizedNodes.slice(0, MEMORY_TRAVERSE_MAX_NODES);
  const nodeIds = new Set(nodes.map((node) => node.canonical_id));
  const edges = extractRecords(result.edges)
    .map(normalizeEdge)
    .filter((edge): edge is MemoryTraverseEdge => edge !== null)
    .filter((edge) => {
      if (!partialFromNodeCap) {
        return true;
      }
      return nodeIds.has(edge.subject_id) && nodeIds.has(edge.object_id);
    });

  return {
    ok: true,
    start_entity_canonical_id: startEntityCanonicalId,
    max_hops: maxHops,
    node_cap: MEMORY_TRAVERSE_MAX_NODES,
    nodes,
    edges,
    partial: result.partial === true || partialFromNodeCap,
  };
}

function emptyGraphResponse(
  startEntityCanonicalId: string,
  maxHops: number,
): MemoryTraverseResponse {
  return {
    ok: true,
    start_entity_canonical_id: startEntityCanonicalId,
    max_hops: maxHops,
    node_cap: MEMORY_TRAVERSE_MAX_NODES,
    nodes: [],
    edges: [],
    partial: false,
  };
}

function normalizeNode(record: Record<string, unknown>): MemoryTraverseNode | null {
  const canonicalId = stringValue(record.canonical_id);
  if (!canonicalId) {
    return null;
  }

  return {
    canonical_id: canonicalId,
    entity_name: stringValue(record.entity_name),
    hop_distance:
      typeof record.hop_distance === 'number' &&
      Number.isInteger(record.hop_distance) &&
      record.hop_distance >= 0
        ? record.hop_distance
        : 0,
    earliest_seen: stringValue(record.earliest_seen),
  };
}

function normalizeEdge(record: Record<string, unknown>): MemoryTraverseEdge | null {
  const subjectId =
    stringValue(record.subject_id) ??
    stringValue(record.source_entity_canonical_id) ??
    stringValue(record.source_fact_id);
  const objectId =
    stringValue(record.object_id) ??
    stringValue(record.target_entity_canonical_id) ??
    stringValue(record.target_fact_id);
  const relation = stringValue(record.relation);
  if (!subjectId || !objectId || !relation) {
    return null;
  }

  const confidence =
    typeof record.confidence === 'number' && Number.isFinite(record.confidence)
      ? record.confidence
      : typeof record.weight === 'number' && Number.isFinite(record.weight)
        ? record.weight
        : null;

  return {
    subject_id: subjectId,
    object_id: objectId,
    relation,
    confidence,
    valid_from: stringValue(record.valid_from),
    valid_until: stringValue(record.valid_until),
  };
}

function extractRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
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
