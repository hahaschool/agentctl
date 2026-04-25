import type { Pool } from 'pg';

const MAX_CONTENT_PREVIEW_LENGTH = 160;
const CURSOR_PREFIX = 'mtl_v1:';

export const ENTITY_TIMELINE_LIMITATIONS = [
  'This slice resolves `entity` as `memory_facts.id`; canonical entity joins are not wired yet.',
  'Timeline windows are derived from `memory_facts.valid_from` / `valid_until` because `memory_edges` does not yet store temporal fields.',
] as const;

export type EntityTimelineCursor = {
  effectiveFrom: string;
  edgeCreatedAt: string;
  edgeId: string;
};

export type ReadEntityTimelineInput = {
  requestedId: string;
  limit: number;
  asOf?: string;
  cursor?: EntityTimelineCursor;
};

export type EntityTimelineEntity = {
  requestedId: string;
  resolvedFactId: string;
  contentPreview: string;
  validFrom: string;
  validUntil: string | null;
  confidence: number | null;
  activeAtAsOf: boolean | null;
  canonicalizationMode: 'fact-id-fallback';
};

export type EntityTimelineEvent = {
  edgeId: string;
  relation: string;
  direction: 'incoming' | 'outgoing';
  otherFactId: string;
  otherFactPreview: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  edgeCreatedAt: string;
  sourceFactId: string;
  targetFactId: string;
};

export type EntityTimelinePage = {
  entity: EntityTimelineEntity;
  events: EntityTimelineEvent[];
  nextCursor: string | null;
  limitations: readonly string[];
};

type StartFactRow = {
  id: string;
  content: string;
  valid_from: string;
  valid_until: string | null;
  confidence: number | null;
};

type TimelineRow = {
  edge_id: string;
  source_fact_id: string;
  target_fact_id: string;
  relation: string;
  edge_created_at: string;
  other_fact_id: string;
  other_content: string;
  effective_from: string;
  effective_until: string | null;
};

export async function readEntityTimeline(
  pool: Pool,
  input: ReadEntityTimelineInput,
): Promise<EntityTimelinePage | null> {
  const startFact = await loadStartFact(pool, input.requestedId);
  if (!startFact) {
    return null;
  }

  const rows = await fetchTimelineRows(pool, {
    entityId: startFact.id,
    limit: input.limit,
    asOf: input.asOf,
    cursor: input.cursor,
  });

  const hasMore = rows.length > input.limit;
  const visibleRows = hasMore ? rows.slice(0, input.limit) : rows;
  const lastRow = visibleRows.at(-1) ?? null;

  return {
    entity: {
      requestedId: input.requestedId,
      resolvedFactId: startFact.id,
      contentPreview: toPreview(startFact.content),
      validFrom: startFact.valid_from,
      validUntil: startFact.valid_until,
      confidence: startFact.confidence,
      activeAtAsOf: input.asOf
        ? isActiveAt(startFact.valid_from, startFact.valid_until, input.asOf)
        : null,
      canonicalizationMode: 'fact-id-fallback',
    },
    events: visibleRows.map((row) => ({
      edgeId: row.edge_id,
      relation: row.relation,
      direction: row.source_fact_id === startFact.id ? 'outgoing' : 'incoming',
      otherFactId: row.other_fact_id,
      otherFactPreview: toPreview(row.other_content),
      effectiveFrom: row.effective_from,
      effectiveUntil: row.effective_until,
      edgeCreatedAt: row.edge_created_at,
      sourceFactId: row.source_fact_id,
      targetFactId: row.target_fact_id,
    })),
    nextCursor:
      hasMore && lastRow
        ? encodeEntityTimelineCursor({
            effectiveFrom: lastRow.effective_from,
            edgeCreatedAt: lastRow.edge_created_at,
            edgeId: lastRow.edge_id,
          })
        : null,
    limitations: ENTITY_TIMELINE_LIMITATIONS,
  };
}

export function encodeEntityTimelineCursor(cursor: EntityTimelineCursor): string {
  return `${CURSOR_PREFIX}${Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')}`;
}

export function decodeEntityTimelineCursor(value: string): EntityTimelineCursor | null {
  if (!value.startsWith(CURSOR_PREFIX)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(value.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8'),
    ) as Partial<EntityTimelineCursor>;

    if (
      typeof decoded.effectiveFrom !== 'string' ||
      typeof decoded.edgeCreatedAt !== 'string' ||
      typeof decoded.edgeId !== 'string'
    ) {
      return null;
    }
    if (
      !Number.isFinite(Date.parse(decoded.effectiveFrom)) ||
      !Number.isFinite(Date.parse(decoded.edgeCreatedAt)) ||
      decoded.edgeId.trim().length === 0
    ) {
      return null;
    }

    return {
      effectiveFrom: new Date(decoded.effectiveFrom).toISOString(),
      edgeCreatedAt: new Date(decoded.edgeCreatedAt).toISOString(),
      edgeId: decoded.edgeId.trim(),
    };
  } catch {
    return null;
  }
}

async function loadStartFact(pool: Pool, factId: string): Promise<StartFactRow | null> {
  const { rows } = await pool.query<StartFactRow>(
    `SELECT id,
            content,
            valid_from,
            valid_until,
            confidence::real AS confidence
       FROM memory_facts
      WHERE id = $1
      LIMIT 1`,
    [factId],
  );

  return rows[0] ?? null;
}

type FetchTimelineRowsInput = {
  entityId: string;
  limit: number;
  asOf?: string;
  cursor?: EntityTimelineCursor;
};

async function fetchTimelineRows(
  pool: Pool,
  input: FetchTimelineRowsInput,
): Promise<TimelineRow[]> {
  const effectiveFromExpr = 'GREATEST(a.valid_from, b.valid_from)';
  const effectiveUntilExpr = `CASE
    WHEN a.valid_until IS NULL THEN b.valid_until
    WHEN b.valid_until IS NULL THEN a.valid_until
    ELSE LEAST(a.valid_until, b.valid_until)
  END`;

  const values: unknown[] = [input.entityId];
  const entityParam = '$1';
  const conditions = [
    `(${entityParam} = e.source_fact_id OR ${entityParam} = e.target_fact_id)`,
    `(${effectiveUntilExpr} IS NULL OR ${effectiveFromExpr} < ${effectiveUntilExpr})`,
  ];

  if (input.asOf !== undefined) {
    values.push(input.asOf);
    const asOfParam = `$${values.length}`;
    conditions.push(`a.valid_from <= ${asOfParam}`);
    conditions.push(`(a.valid_until IS NULL OR a.valid_until > ${asOfParam})`);
    conditions.push(`b.valid_from <= ${asOfParam}`);
    conditions.push(`(b.valid_until IS NULL OR b.valid_until > ${asOfParam})`);
  }

  if (input.cursor) {
    values.push(input.cursor.effectiveFrom, input.cursor.edgeCreatedAt, input.cursor.edgeId);
    const effectiveFromParam = `$${values.length - 2}`;
    const edgeCreatedAtParam = `$${values.length - 1}`;
    const edgeIdParam = `$${values.length}`;

    conditions.push(
      `(
        ${effectiveFromExpr} < ${effectiveFromParam}
        OR (
          ${effectiveFromExpr} = ${effectiveFromParam}
          AND (
            e.created_at < ${edgeCreatedAtParam}
            OR (e.created_at = ${edgeCreatedAtParam} AND e.id < ${edgeIdParam})
          )
        )
      )`,
    );
  }

  values.push(input.limit + 1);
  const limitParam = `$${values.length}`;

  const { rows } = await pool.query<TimelineRow>(
    `SELECT e.id AS edge_id,
            e.source_fact_id,
            e.target_fact_id,
            e.relation,
            e.created_at AS edge_created_at,
            CASE
              WHEN e.source_fact_id = ${entityParam} THEN b.id
              ELSE a.id
            END AS other_fact_id,
            CASE
              WHEN e.source_fact_id = ${entityParam} THEN b.content
              ELSE a.content
            END AS other_content,
            ${effectiveFromExpr} AS effective_from,
            ${effectiveUntilExpr} AS effective_until
       FROM memory_edges e
       JOIN memory_facts a ON a.id = e.source_fact_id
       JOIN memory_facts b ON b.id = e.target_fact_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY effective_from DESC, e.created_at DESC, e.id DESC
      LIMIT ${limitParam}`,
    values,
  );

  return rows;
}

function isActiveAt(validFrom: string, validUntil: string | null, asOf: string): boolean {
  const asOfMs = Date.parse(asOf);
  const validFromMs = Date.parse(validFrom);
  const validUntilMs = validUntil === null ? Number.POSITIVE_INFINITY : Date.parse(validUntil);

  if (!Number.isFinite(asOfMs) || !Number.isFinite(validFromMs)) {
    return false;
  }
  if (asOfMs < validFromMs) {
    return false;
  }
  return asOfMs < validUntilMs;
}

function toPreview(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= MAX_CONTENT_PREVIEW_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_CONTENT_PREVIEW_LENGTH - 3)}...`;
}
