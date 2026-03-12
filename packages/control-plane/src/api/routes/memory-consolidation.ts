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

import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type {
  ConsolidationItem,
  ConsolidationItemType,
  ConsolidationSeverity,
  ConsolidationStatus,
} from '@agentctl/shared';

export type MemoryConsolidationRoutesOptions = {
  pool: Pool;
  logger: Logger;
};

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

function staleItems(
  rows: ReadonlyArray<Record<string, unknown>>,
): readonly ConsolidationItem[] {
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

function orphanItems(
  rows: ReadonlyArray<Record<string, unknown>>,
): readonly ConsolidationItem[] {
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
    Body: { action: string; status: ConsolidationStatus };
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
          },
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { action, status } = request.body;

      logger.info({ id, action, status }, 'Consolidation item resolved');

      // Future: persist resolution state in a consolidation_resolutions table.
      // For now, log and acknowledge.
      return { ok: true };
    },
  );
};
