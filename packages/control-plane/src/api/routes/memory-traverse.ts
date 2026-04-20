// ---------------------------------------------------------------------------
// POST /api/memory/traverse — bounded recursive memory graph traversal
//
// §4.15 Temporal Timeline / PR H (control-plane side).
//
// First control-plane slice. Accepts a `MemoryTraverseRequest` from the worker
// proxy (`packages/agent-worker/src/api/routes/memory-traverse.ts`) and walks
// outward from a starting fact using `memory_edges`. The result matches the
// `MemoryTraverseResponse` contract: a list of nodes (with hop distance) and
// the edges that connected them, together with a `partial` flag that trips
// when either the hop cap or the node cap truncated the walk.
//
// Design notes for this slice:
//   - The planned entity canonicalization layer is not yet in schema.ts, so
//     `start_entity_canonical_id` is interpreted as a `memory_facts.id`. The
//     worker-side types already allow `source_fact_id` / `target_fact_id` to
//     stand in as subject/object ids, so this is forward-compatible with the
//     later canonicalization work without changing the wire contract.
//   - Edge-level temporal columns (`valid_from` / `valid_until` on edges) are
//     also future work. Validity windows are therefore applied against the
//     edge's endpoint facts (`memory_facts.valid_from` / `valid_until`) and
//     `min_confidence` against the endpoint facts' `confidence`.
//   - The traversal is iterative (BFS over `memory_edges`) rather than a SQL
//     recursive CTE. That keeps the query bounded per hop (one query per hop
//     capped at `max_nodes`), stays within the existing mock DB test harness
//     used elsewhere in this package, and avoids needing pgvector-specific
//     CTE syntax during the first slice.
//   - 404 on missing start fact — the worker already translates 404/204 into
//     an empty graph for MCP consumers.
// ---------------------------------------------------------------------------

import { MEMORY_RELATION_TYPES, type RelationType } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

export type MemoryTraverseRoutesOptions = {
  pool: Pool;
  logger: Logger;
};

const DEFAULT_MAX_HOPS = 3;
const MAX_ALLOWED_HOPS = 10;
const DEFAULT_MAX_NODES = 100;
const MAX_ALLOWED_NODES = 100;
const MAX_RELATION_TYPE_FILTERS = 20;
const MAX_CANONICAL_ID_LENGTH = 128;
const SAFE_CANONICAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RELATION_TYPE_SET = new Set<string>(MEMORY_RELATION_TYPES);

type NormalizedTraverseRequest = {
  startEntityCanonicalId: string;
  maxHops: number;
  maxNodes: number;
  relationTypes: RelationType[] | undefined;
  minConfidence: number | undefined;
  asOf: string | undefined;
};

type TraverseNode = {
  canonical_id: string;
  entity_name: string | null;
  hop_distance: number;
  earliest_seen: string | null;
};

type TraverseEdge = {
  subject_id: string;
  object_id: string;
  relation: string;
  confidence: number | null;
  valid_from: string | null;
  valid_until: string | null;
};

type TraverseResponseBody = {
  ok: true;
  start_entity_canonical_id: string;
  max_hops: number;
  node_cap: number;
  nodes: TraverseNode[];
  edges: TraverseEdge[];
  partial: boolean;
};

type ValidationOk<T> = { ok: true; value: T };
type ValidationErr = {
  ok: false;
  status: number;
  body: { error: string; message: string };
};
type ValidationResult<T> = ValidationOk<T> | ValidationErr;

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const memoryTraverseRoutes: FastifyPluginAsync<MemoryTraverseRoutesOptions> = async (
  app,
  opts,
) => {
  const { pool, logger } = opts;

  app.post(
    '/',
    {
      schema: {
        tags: ['memory'],
        summary: 'Traverse the memory knowledge graph from a starting entity',
      },
    },
    async (request, reply) => {
      const validation = validateRequest(request.body);
      if (!validation.ok) {
        return reply.code(validation.status).send(validation.body);
      }

      const params = validation.value;
      const startedAt = Date.now();

      const startFact = await loadStartFact(pool, params.startEntityCanonicalId);
      if (!startFact) {
        logger.debug(
          { startEntityCanonicalId: params.startEntityCanonicalId },
          'memory_traverse: start entity not found — returning 404',
        );
        return reply.code(404).send({
          error: 'MEMORY_TRAVERSE_START_NOT_FOUND',
          message: 'Start entity not found',
        });
      }

      const traversal = await traverseGraph(pool, params, startFact);

      logger.debug(
        {
          startEntityCanonicalId: params.startEntityCanonicalId,
          maxHops: params.maxHops,
          nodeCap: params.maxNodes,
          nodeCount: traversal.nodes.length,
          edgeCount: traversal.edges.length,
          partial: traversal.partial,
          durationMs: Date.now() - startedAt,
        },
        'memory_traverse complete',
      );

      const body: TraverseResponseBody = {
        ok: true,
        start_entity_canonical_id: params.startEntityCanonicalId,
        max_hops: params.maxHops,
        node_cap: params.maxNodes,
        nodes: traversal.nodes,
        edges: traversal.edges,
        partial: traversal.partial,
      };
      return body;
    },
  );
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateRequest(body: unknown): ValidationResult<NormalizedTraverseRequest> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalidParams('Request body must be a JSON object');
  }
  const record = body as Record<string, unknown>;

  const normalizedStart = normalizeCanonicalId(record.start_entity_canonical_id);
  if (!normalizedStart) {
    return invalidParams('start_entity_canonical_id must be a non-empty safe canonical id');
  }

  const maxHopsRaw = record.max_hops ?? DEFAULT_MAX_HOPS;
  if (
    typeof maxHopsRaw !== 'number' ||
    !Number.isInteger(maxHopsRaw) ||
    maxHopsRaw < 1 ||
    maxHopsRaw > MAX_ALLOWED_HOPS
  ) {
    return invalidParams(`max_hops must be an integer between 1 and ${MAX_ALLOWED_HOPS}`);
  }

  const maxNodesRaw = record.max_nodes;
  let maxNodes: number;
  if (maxNodesRaw === undefined) {
    maxNodes = DEFAULT_MAX_NODES;
  } else if (typeof maxNodesRaw !== 'number' || !Number.isInteger(maxNodesRaw) || maxNodesRaw < 1) {
    return invalidParams(`max_nodes must be an integer between 1 and ${MAX_ALLOWED_NODES}`);
  } else {
    maxNodes = Math.min(maxNodesRaw, MAX_ALLOWED_NODES);
  }

  const relationTypesResult = validateRelationTypes(record.relation_types);
  if (!relationTypesResult.ok) {
    return relationTypesResult;
  }

  const minConfidenceResult = validateMinConfidence(record.min_confidence);
  if (!minConfidenceResult.ok) {
    return minConfidenceResult;
  }

  const asOfResult = validateAsOf(record.as_of);
  if (!asOfResult.ok) {
    return asOfResult;
  }

  return {
    ok: true,
    value: {
      startEntityCanonicalId: normalizedStart,
      maxHops: maxHopsRaw,
      maxNodes,
      relationTypes: relationTypesResult.value,
      minConfidence: minConfidenceResult.value,
      asOf: asOfResult.value,
    },
  };
}

function invalidParams(message: string): ValidationErr {
  return {
    ok: false,
    status: 400,
    body: { error: 'INVALID_PARAMS', message },
  };
}

function normalizeCanonicalId(value: unknown): string | null {
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
    return invalidParams(
      `relation_types must be an array of up to ${MAX_RELATION_TYPE_FILTERS} valid relation types`,
    );
  }

  const relationTypes: RelationType[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !RELATION_TYPE_SET.has(entry)) {
      return invalidParams(`relation_types must contain only: ${MEMORY_RELATION_TYPES.join(', ')}`);
    }
    if (!relationTypes.includes(entry as RelationType)) {
      relationTypes.push(entry as RelationType);
    }
  }
  return { ok: true, value: relationTypes };
}

function validateMinConfidence(value: unknown): ValidationResult<number | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return invalidParams('min_confidence must be a number between 0 and 1');
  }
  return { ok: true, value };
}

function validateAsOf(value: unknown): ValidationResult<string | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') {
    return invalidParams('as_of must be a valid timestamp string');
  }
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) {
    return invalidParams('as_of must be a valid timestamp string');
  }
  return { ok: true, value: new Date(ts).toISOString() };
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code !== undefined && (code <= 0x1f || code === 0x7f)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

type StartFactRow = {
  id: string;
  content: string;
  valid_from: string;
  valid_until: string | null;
  confidence: number;
};

async function loadStartFact(pool: Pool, canonicalId: string): Promise<StartFactRow | null> {
  const { rows } = await pool.query<StartFactRow>(
    `SELECT id,
            content,
            valid_from,
            valid_until,
            confidence::real AS confidence
       FROM memory_facts
      WHERE id = $1
      LIMIT 1`,
    [canonicalId],
  );
  if (rows.length === 0) {
    return null;
  }
  return rows[0] ?? null;
}

type EdgeRow = {
  source_fact_id: string;
  target_fact_id: string;
  relation: string;
  source_content: string;
  source_valid_from: string;
  source_valid_until: string | null;
  source_confidence: number;
  target_content: string;
  target_valid_from: string;
  target_valid_until: string | null;
  target_confidence: number;
};

type TraversalResult = {
  nodes: TraverseNode[];
  edges: TraverseEdge[];
  partial: boolean;
};

async function traverseGraph(
  pool: Pool,
  params: NormalizedTraverseRequest,
  startFact: StartFactRow,
): Promise<TraversalResult> {
  const nodeMap = new Map<string, TraverseNode>();
  const edgeKeys = new Set<string>();
  const edges: TraverseEdge[] = [];

  const startNode = toNode(startFact.id, startFact.content, 0, startFact.valid_from);
  // The start fact itself must honor the same filters — if it fails them we
  // still return just the start node so the caller sees a deterministic
  // single-node graph, which matches MemPalace's traversal semantics.
  if (factPassesFilters(startFact, params)) {
    nodeMap.set(startNode.canonical_id, startNode);
  } else {
    nodeMap.set(startNode.canonical_id, startNode);
  }

  let partial = false;
  let frontier: string[] = [startFact.id];

  for (let hop = 1; hop <= params.maxHops; hop += 1) {
    if (frontier.length === 0) {
      break;
    }
    if (nodeMap.size >= params.maxNodes) {
      partial = true;
      break;
    }

    const edgeRows = await fetchEdgesFromFrontier(pool, frontier, params);
    if (edgeRows.length === 0) {
      break;
    }

    const nextFrontier: string[] = [];
    let frontierCapped = false;
    for (const row of edgeRows) {
      const edgeKey = `${row.source_fact_id}|${row.target_fact_id}|${row.relation}`;
      if (edgeKeys.has(edgeKey)) {
        continue;
      }

      // Only surface edges whose endpoints pass the filters — the SQL query
      // already applies them but we re-check for defense in depth.
      const sourcePasses = endpointPassesFilters(
        {
          id: row.source_fact_id,
          validFrom: row.source_valid_from,
          validUntil: row.source_valid_until,
          confidence: row.source_confidence,
        },
        params,
      );
      const targetPasses = endpointPassesFilters(
        {
          id: row.target_fact_id,
          validFrom: row.target_valid_from,
          validUntil: row.target_valid_until,
          confidence: row.target_confidence,
        },
        params,
      );
      if (!sourcePasses || !targetPasses) {
        continue;
      }

      const neighborId =
        row.source_fact_id === startFact.id || nodeMap.has(row.source_fact_id)
          ? row.target_fact_id
          : row.source_fact_id;
      const neighborContent =
        neighborId === row.source_fact_id ? row.source_content : row.target_content;
      const neighborValidFrom =
        neighborId === row.source_fact_id ? row.source_valid_from : row.target_valid_from;

      if (!nodeMap.has(neighborId)) {
        if (nodeMap.size >= params.maxNodes) {
          frontierCapped = true;
          continue;
        }
        nodeMap.set(neighborId, toNode(neighborId, neighborContent, hop, neighborValidFrom));
        nextFrontier.push(neighborId);
      }

      edgeKeys.add(edgeKey);
      edges.push({
        subject_id: row.source_fact_id,
        object_id: row.target_fact_id,
        relation: row.relation,
        confidence: pickEdgeConfidence(row.source_confidence, row.target_confidence),
        valid_from: row.source_valid_from,
        valid_until: row.source_valid_until ?? row.target_valid_until ?? null,
      });
    }

    if (frontierCapped) {
      partial = true;
    }
    frontier = nextFrontier;

    if (hop === params.maxHops && frontier.length > 0) {
      // We hit the hop cap with more frontier left to explore.
      partial = true;
    }
  }

  const nodes = Array.from(nodeMap.values()).sort(
    (left, right) => left.hop_distance - right.hop_distance,
  );
  // Filter edges to only those whose endpoints are in the final node set (can
  // matter when the node cap truncated the frontier mid-hop).
  const nodeIds = new Set(nodes.map((n) => n.canonical_id));
  const trimmedEdges = edges.filter(
    (edge) => nodeIds.has(edge.subject_id) && nodeIds.has(edge.object_id),
  );

  return {
    nodes,
    edges: trimmedEdges,
    partial,
  };
}

type EndpointFilterInput = {
  id: string;
  validFrom: string;
  validUntil: string | null;
  confidence: number;
};

function endpointPassesFilters(
  endpoint: EndpointFilterInput,
  params: NormalizedTraverseRequest,
): boolean {
  if (params.minConfidence !== undefined && endpoint.confidence < params.minConfidence) {
    return false;
  }
  if (params.asOf !== undefined) {
    const asOfMs = Date.parse(params.asOf);
    const fromMs = Date.parse(endpoint.validFrom);
    const untilMs = endpoint.validUntil
      ? Date.parse(endpoint.validUntil)
      : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(fromMs)) return true;
    if (asOfMs < fromMs) return false;
    if (asOfMs >= untilMs) return false;
  }
  return true;
}

function factPassesFilters(fact: StartFactRow, params: NormalizedTraverseRequest): boolean {
  return endpointPassesFilters(
    {
      id: fact.id,
      validFrom: fact.valid_from,
      validUntil: fact.valid_until,
      confidence: fact.confidence,
    },
    params,
  );
}

function toNode(
  id: string,
  content: string | null | undefined,
  hop: number,
  earliestSeen: string | null,
): TraverseNode {
  return {
    canonical_id: id,
    entity_name: typeof content === 'string' && content.length > 0 ? truncateName(content) : null,
    hop_distance: hop,
    earliest_seen: earliestSeen ?? null,
  };
}

function truncateName(content: string, max = 120): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}…`;
}

function pickEdgeConfidence(source: number, target: number): number | null {
  if (Number.isFinite(source) && Number.isFinite(target)) {
    return Math.min(source, target);
  }
  if (Number.isFinite(source)) return source;
  if (Number.isFinite(target)) return target;
  return null;
}

async function fetchEdgesFromFrontier(
  pool: Pool,
  frontier: readonly string[],
  params: NormalizedTraverseRequest,
): Promise<EdgeRow[]> {
  const values: unknown[] = [];
  values.push(frontier);
  const conditions = [
    `(e.source_fact_id = ANY($${values.length}) OR e.target_fact_id = ANY($${values.length}))`,
  ];

  if (params.relationTypes && params.relationTypes.length > 0) {
    values.push(params.relationTypes);
    conditions.push(`e.relation = ANY($${values.length})`);
  }

  if (params.minConfidence !== undefined) {
    values.push(params.minConfidence);
    conditions.push(`a.confidence >= $${values.length}`);
    conditions.push(`b.confidence >= $${values.length}`);
  }

  if (params.asOf !== undefined) {
    values.push(params.asOf);
    conditions.push(`a.valid_from <= $${values.length}`);
    conditions.push(`(a.valid_until IS NULL OR a.valid_until > $${values.length})`);
    conditions.push(`b.valid_from <= $${values.length}`);
    conditions.push(`(b.valid_until IS NULL OR b.valid_until > $${values.length})`);
  }

  // Cap per-hop row fetch to a safe multiple of max_nodes so a hot node cannot
  // blow up the bounded traversal.
  values.push(params.maxNodes * 4);
  const limitParam = `$${values.length}`;

  const { rows } = await pool.query<EdgeRow>(
    `SELECT e.source_fact_id,
            e.target_fact_id,
            e.relation,
            a.content       AS source_content,
            a.valid_from    AS source_valid_from,
            a.valid_until   AS source_valid_until,
            a.confidence::real AS source_confidence,
            b.content       AS target_content,
            b.valid_from    AS target_valid_from,
            b.valid_until   AS target_valid_until,
            b.confidence::real AS target_confidence
       FROM memory_edges e
       JOIN memory_facts a ON a.id = e.source_fact_id
       JOIN memory_facts b ON b.id = e.target_fact_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.created_at ASC
      LIMIT ${limitParam}`,
    values,
  );

  return rows;
}
