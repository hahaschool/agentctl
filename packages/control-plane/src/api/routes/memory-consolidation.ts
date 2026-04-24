// ---------------------------------------------------------------------------
// GET  /api/memory/consolidation           — List consolidation items
// POST /api/memory/consolidation/:id/action — Resolve a consolidation item
//
// §4.8 Memory Consolidation
//
// Detects structural quality issues in memory_facts:
//   - contradictions: facts linked by a "contradicts" edge
//   - near-duplicates: facts with embedding cosine similarity >= 0.85
//   - stale: facts not accessed in 30+ days
//   - orphans: facts with no edges
// ---------------------------------------------------------------------------

import type {
  ConsolidationItem,
  ConsolidationItemType,
  ConsolidationSeverity,
  ConsolidationStatus,
} from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import { MemoryStore } from '../../memory/memory-store.js';
import { readRateLimitEnv } from '../rate-limit.js';

export type MemoryConsolidationRoutesOptions = {
  pool: Pool;
  logger: Logger;
};

// Rate-limit consolidation action writes: they mutate structural memory
// resolution state; a flood can thrash resolutions and saturate audit logs.
const MEMORY_CONSOLIDATION_RATE_LIMIT = {
  max: 20,
  timeWindow: 60_000,
} as const;

const STALE_DAYS = 30;
const NEAR_DUPLICATE_THRESHOLD = 0.85;
const DEFAULT_LIMIT = 50;

const VALID_TYPES = new Set<ConsolidationItemType>([
  'contradiction',
  'near-duplicate',
  'stale',
  'orphan',
]);

const VALID_STATUSES = new Set<ConsolidationStatus>(['pending', 'accepted', 'skipped']);
const NEAR_DUPLICATE_ID_PREFIX = 'near-duplicate-';

type ConsolidationActionBody = {
  action: string;
  status: ConsolidationStatus;
  factIds?: string[];
  survivorFactId?: string;
  /** Hand-edited merged content to use as the survivor fact's content. */
  customContent?: string;
};

// ---------------------------------------------------------------------------
// Helpers to map raw SQL rows → ConsolidationItem
// ---------------------------------------------------------------------------

function contradictionItems(
  rows: ReadonlyArray<Record<string, unknown>>,
): readonly ConsolidationItem[] {
  return rows.map((row) => ({
    id: `contradiction-${row.edge_id}`,
    type: 'contradiction' as const,
    severity: 'high' as ConsolidationSeverity,
    factIds: [String(row.source_fact_id), String(row.target_fact_id)],
    suggestion: 'Review contradicting facts and resolve the conflict.',
    reason: `Fact "${truncate(String(row.source_content))}" contradicts "${truncate(String(row.target_content))}"`,
    status: 'pending' as const,
    createdAt: toISOString(row.edge_created_at),
  }));
}

function nearDuplicateItems(
  rows: ReadonlyArray<Record<string, unknown>>,
): readonly ConsolidationItem[] {
  return rows.map((row) => ({
    id: `near-duplicate-${row.fact_id_a}-${row.fact_id_b}`,
    type: 'near-duplicate' as const,
    severity: 'medium' as ConsolidationSeverity,
    factIds: [String(row.fact_id_a), String(row.fact_id_b)],
    suggestion: 'Consider merging these near-duplicate facts.',
    reason: `Similarity ${Number(row.similarity).toFixed(2)}: "${truncate(String(row.content_a))}" ≈ "${truncate(String(row.content_b))}"`,
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
  }));
}

function staleItems(rows: ReadonlyArray<Record<string, unknown>>): readonly ConsolidationItem[] {
  return rows.map((row) => ({
    id: `stale-${row.fact_id}`,
    type: 'stale' as const,
    severity: 'low' as ConsolidationSeverity,
    factIds: [String(row.fact_id)],
    suggestion: 'Archive or refresh this stale fact.',
    reason: `Not accessed in ${Math.round(Number(row.days_since_access))} days: "${truncate(String(row.content))}"`,
    status: 'pending' as const,
    createdAt: toISOString(row.accessed_at),
  }));
}

function orphanItems(rows: ReadonlyArray<Record<string, unknown>>): readonly ConsolidationItem[] {
  return rows.map((row) => ({
    id: `orphan-${row.fact_id}`,
    type: 'orphan' as const,
    severity: 'low' as ConsolidationSeverity,
    factIds: [String(row.fact_id)],
    suggestion: 'Connect this orphan fact to related facts or remove it.',
    reason: `Isolated ${row.entity_type} fact: "${truncate(String(row.content))}"`,
    status: 'pending' as const,
    createdAt: toISOString(row.created_at),
  }));
}

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function toISOString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function explicitMergeTarget(
  id: string,
  body: ConsolidationActionBody,
): { survivorFactId: string; duplicateFactIds: string[] } | null {
  if (
    id.startsWith(NEAR_DUPLICATE_ID_PREFIX) &&
    Array.isArray(body.factIds) &&
    body.factIds.length === 2 &&
    id === `${NEAR_DUPLICATE_ID_PREFIX}${body.factIds[0]}-${body.factIds[1]}`
  ) {
    const factIds = [...new Set(body.factIds.filter((factId) => factId.length > 0))];
    if (factIds.length !== 2) {
      return null;
    }
    const survivorFactId =
      body.survivorFactId && factIds.includes(body.survivorFactId)
        ? body.survivorFactId
        : factIds[0];
    if (!survivorFactId) {
      return null;
    }
    return {
      survivorFactId,
      duplicateFactIds: factIds.filter((factId) => factId !== survivorFactId),
    };
  }

  return null;
}

async function resolveNearDuplicateMergeTarget(
  pool: Pool,
  id: string,
  body: ConsolidationActionBody,
): Promise<{ survivorFactId: string; duplicateFactIds: string[] } | null> {
  const explicit = explicitMergeTarget(id, body);
  if (explicit) {
    return explicit;
  }

  if (!id.startsWith(NEAR_DUPLICATE_ID_PREFIX)) {
    return null;
  }

  const q = nearDuplicatesQuery(200);
  const { rows } = await pool.query(q.text, q.values);
  const item = nearDuplicateItems(rows as Record<string, unknown>[]).find(
    (candidate) => candidate.id === id,
  );
  if (!item || item.factIds.length < 2) {
    return null;
  }

  const [survivorFactId, ...duplicateFactIds] = item.factIds;
  if (!survivorFactId || duplicateFactIds.length === 0) {
    return null;
  }

  return { survivorFactId, duplicateFactIds };
}

// ---------------------------------------------------------------------------
// SQL queries
// ---------------------------------------------------------------------------

function contradictionsQuery(limit: number): { text: string; values: unknown[] } {
  return {
    text: `
      SELECT
        e.id            AS edge_id,
        e.source_fact_id,
        e.target_fact_id,
        a.content       AS source_content,
        b.content       AS target_content,
        e.created_at    AS edge_created_at
      FROM memory_edges e
      JOIN memory_facts a ON a.id = e.source_fact_id
      JOIN memory_facts b ON b.id = e.target_fact_id
      WHERE e.relation = 'contradicts'
        AND a.valid_until IS NULL
        AND b.valid_until IS NULL
      ORDER BY e.created_at DESC
      LIMIT $1`,
    values: [limit],
  };
}

function nearDuplicatesQuery(limit: number): { text: string; values: unknown[] } {
  return {
    text: `
      SELECT
        a.id      AS fact_id_a,
        b.id      AS fact_id_b,
        1 - (a.embedding <=> b.embedding) AS similarity,
        a.content AS content_a,
        b.content AS content_b
      FROM memory_facts a
      JOIN memory_facts b ON b.id > a.id
      WHERE a.valid_until IS NULL
        AND b.valid_until IS NULL
        AND a.embedding IS NOT NULL
        AND b.embedding IS NOT NULL
        AND (a.embedding <=> b.embedding) <= $1
      ORDER BY (a.embedding <=> b.embedding) ASC
      LIMIT $2`,
    values: [1 - NEAR_DUPLICATE_THRESHOLD, limit],
  };
}

function staleFactsQuery(limit: number): { text: string; values: unknown[] } {
  return {
    text: `
      SELECT
        id AS fact_id,
        content,
        accessed_at,
        EXTRACT(EPOCH FROM (now() - accessed_at)) / 86400 AS days_since_access
      FROM memory_facts
      WHERE valid_until IS NULL
        AND accessed_at < now() - interval '${STALE_DAYS} days'
        AND strength > 0.05
      ORDER BY accessed_at ASC
      LIMIT $1`,
    values: [limit],
  };
}

function orphanFactsQuery(limit: number): { text: string; values: unknown[] } {
  return {
    text: `
      SELECT
        f.id          AS fact_id,
        f.content,
        f.entity_type,
        f.created_at
      FROM memory_facts f
      WHERE f.valid_until IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM memory_edges e
          WHERE e.source_fact_id = f.id OR e.target_fact_id = f.id
        )
      ORDER BY f.created_at ASC
      LIMIT $1`,
    values: [limit],
  };
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const memoryConsolidationRoutes: FastifyPluginAsync<
  MemoryConsolidationRoutesOptions
> = async (app, opts) => {
  const { pool, logger } = opts;
  const memoryStore = new MemoryStore({ pool, logger });

  const memoryConsolidationRateLimitMax = readRateLimitEnv(
    'MEMORY_CONSOLIDATION_RATE_LIMIT_MAX',
    MEMORY_CONSOLIDATION_RATE_LIMIT.max,
  );
  const memoryConsolidationRateLimitWindowMs = readRateLimitEnv(
    'MEMORY_CONSOLIDATION_RATE_LIMIT_WINDOW_MS',
    MEMORY_CONSOLIDATION_RATE_LIMIT.timeWindow,
  );
  const memoryConsolidationRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many memory consolidation requests',
  });
  const memoryConsolidationFastifyRateLimit = {
    max: memoryConsolidationRateLimitMax,
    timeWindow: memoryConsolidationRateLimitWindowMs,
    errorResponseBuilder: memoryConsolidationRateLimitError,
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) =>
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown'),
    errorResponseBuilder: memoryConsolidationRateLimitError,
  });

  // GET / — List consolidation items with optional type/status/limit filters
  app.get<{
    Querystring: { type?: string; status?: string; limit?: string };
  }>(
    '/',
    {
      schema: {
        tags: ['memory'],
        summary: 'List memory consolidation items',
        querystring: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            status: { type: 'string' },
            limit: { type: 'string' },
          },
        },
      },
    },
    async (request) => {
      const typeFilter = request.query.type as ConsolidationItemType | undefined;
      const statusFilter = request.query.status as ConsolidationStatus | undefined;
      const limit = Math.min(
        Math.max(parseInt(request.query.limit ?? '', 10) || DEFAULT_LIMIT, 1),
        200,
      );

      // Validate filter values if provided
      if (typeFilter && !VALID_TYPES.has(typeFilter)) {
        return { ok: true, items: [], total: 0 };
      }
      if (statusFilter && !VALID_STATUSES.has(statusFilter)) {
        return { ok: true, items: [], total: 0 };
      }

      // For the "accepted"/"skipped" status filter, nothing is stored yet so
      // we return empty — all detected items are implicitly "pending".
      if (statusFilter && statusFilter !== 'pending') {
        return { ok: true, items: [], total: 0 };
      }

      const requestedTypes: readonly ConsolidationItemType[] = typeFilter
        ? [typeFilter]
        : (['contradiction', 'near-duplicate', 'stale', 'orphan'] as const);

      const allItems: ConsolidationItem[] = [];

      // Run queries for each requested type in parallel
      const queries = requestedTypes.map(async (itemType) => {
        try {
          switch (itemType) {
            case 'contradiction': {
              const q = contradictionsQuery(limit);
              const { rows } = await pool.query(q.text, q.values);
              return contradictionItems(rows as Record<string, unknown>[]);
            }
            case 'near-duplicate': {
              const q = nearDuplicatesQuery(limit);
              const { rows } = await pool.query(q.text, q.values);
              return nearDuplicateItems(rows as Record<string, unknown>[]);
            }
            case 'stale': {
              const q = staleFactsQuery(limit);
              const { rows } = await pool.query(q.text, q.values);
              return staleItems(rows as Record<string, unknown>[]);
            }
            case 'orphan': {
              const q = orphanFactsQuery(limit);
              const { rows } = await pool.query(q.text, q.values);
              return orphanItems(rows as Record<string, unknown>[]);
            }
          }
        } catch (err) {
          // If a specific query fails (e.g. no embedding column for near-duplicates),
          // log and continue with remaining types rather than failing the whole request.
          logger.warn({ err, itemType }, 'Consolidation query failed for type');
          return [];
        }
      });

      const results = await Promise.all(queries);
      for (const items of results) {
        allItems.push(...items);
      }

      logger.info(
        { total: allItems.length, typeFilter, statusFilter },
        'Consolidation items listed',
      );

      return { ok: true, items: allItems, total: allItems.length };
    },
  );

  // POST /:id/action — Resolve a consolidation item
  app.post<{
    Params: { id: string };
    Body: ConsolidationActionBody;
  }>(
    '/:id/action',
    {
      schema: {
        tags: ['memory'],
        summary: 'Resolve a consolidation item',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          required: ['action', 'status'],
          properties: {
            action: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'accepted', 'skipped'] },
            factIds: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 256 } },
            survivorFactId: { type: 'string', maxLength: 256 },
            customContent: { type: 'string', maxLength: 10_000 },
          },
        },
      },
      config: { rateLimit: memoryConsolidationFastifyRateLimit },
      preHandler: [app.rateLimit(memoryConsolidationFastifyRateLimit)],
    },
    async (request) => {
      const { id } = request.params;
      const { action, status, customContent } = request.body;

      logger.info(
        { id, action, status, hasCustomContent: customContent !== undefined },
        'Consolidation item resolved',
      );

      if (status === 'accepted' && (action === 'accept' || action === 'merge')) {
        const mergeTarget = await resolveNearDuplicateMergeTarget(pool, id, request.body);
        if (mergeTarget) {
          const result = await memoryStore.mergeDuplicateFactsPreservingSources({
            ...mergeTarget,
            customContent,
          });
          logger.info({ id, action, status, ...result }, 'Near-duplicate memory facts merged');
          return { ok: true, merge: result };
        }
      }

      // Future: persist resolution state in a consolidation_resolutions table.
      // Non-merge actions still log and acknowledge until resolution state is persisted.
      return { ok: true };
    },
  );
};
