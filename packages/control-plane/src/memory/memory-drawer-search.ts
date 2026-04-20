// ---------------------------------------------------------------------------
// Memory drawer search — shared helpers
//
// Extracts the keyword (tsvector) + vector (pgvector) + RRF fusion pipeline
// that powers `GET /api/memory/drawers/search` so that other surfaces (for
// example `GET /api/memory/facts` with `MEMORY_DRAWER_FUSION=true`) can reuse
// the same SQL and fusion logic without duplicating it.
//
// The behaviour mirrors `packages/control-plane/src/api/routes/memory-drawers.ts`
// exactly:
//   - keyword path uses `content_tsv_simple @@ to_tsquery('simple', $1)`
//     (see `drizzle/0030_add_memory_drawers.sql`).
//   - vector path uses cosine distance over the pgvector `embedding` column
//     when an embedding client is available. No client → keyword-only.
//   - both candidate lists are fused via Reciprocal Rank Fusion (k=60).
//   - any SQL / embedding failure on a single path degrades to empty for
//     that path so the surrounding surface can still return the other one.
//
// Keeping this helper side-effect-free (no Fastify, no HTTP concerns) means
// any route that already has a `pg.Pool` + optional embedding client can opt
// into drawer search without re-implementing the fusion.
// ---------------------------------------------------------------------------

import type { MemoryDrawerSearchResult } from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Types + constants
// ---------------------------------------------------------------------------

export type DrawerEmbeddingClient = {
  embed(text: string): Promise<number[]>;
};

export type MemoryDrawerSearchInput = {
  /** Already-sanitized query text (callers are expected to pre-sanitize). */
  query: string;
  /** Optional exact-match scope filter (nullish → no scope filter). */
  scope?: string | null;
  /** Final fused result cap. */
  limit: number;
  /** Per-path candidate count before fusion (defaults to `CANDIDATE_LIMIT`). */
  candidateLimit?: number;
};

export type MemoryDrawerSearchDeps = {
  pool: Pool;
  logger: Logger;
  embeddingClient?: DrawerEmbeddingClient;
};

export const RRF_K = 60;
export const CANDIDATE_LIMIT = 50;
const CONTENT_PREVIEW_MAX_LENGTH = 240;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run keyword + vector search over `memory_drawers` and fuse with RRF.
 *
 * Returns `[]` when the pre-sanitized query is empty after tokenization so
 * callers don't have to special-case that edge.
 */
export async function searchMemoryDrawers(
  input: MemoryDrawerSearchInput,
  deps: MemoryDrawerSearchDeps,
): Promise<MemoryDrawerSearchResult[]> {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (query.length === 0) {
    return [];
  }
  const limit = Math.max(1, Math.floor(input.limit));
  const candidateLimit = Math.max(limit, Math.floor(input.candidateLimit ?? CANDIDATE_LIMIT));
  const scope = typeof input.scope === 'string' && input.scope.length > 0 ? input.scope : null;

  const [keyword, vector] = await Promise.all([
    keywordSearch(deps.pool, query, scope, candidateLimit, deps.logger),
    vectorSearch(deps.pool, query, scope, candidateLimit, deps.embeddingClient, deps.logger),
  ]);

  return fuseRankedMatches(keyword, vector, limit);
}

// ---------------------------------------------------------------------------
// Internals (exported for the drawer route so it can keep its existing shape)
// ---------------------------------------------------------------------------

export type RankedDrawerMatch = {
  rank: number;
  result: MemoryDrawerSearchResult;
};

export async function keywordSearch(
  pool: Pool,
  query: string,
  scope: string | null,
  limit: number,
  logger: Logger,
): Promise<RankedDrawerMatch[]> {
  const tokens = tokenizeForTsquery(query);
  if (tokens.length === 0) {
    return [];
  }
  const tsQuery = tokens.join(' & ');

  const params: unknown[] = [tsQuery];
  const conditions = [
    'archived_at IS NULL',
    'content_tsv_simple IS NOT NULL',
    "content_tsv_simple @@ to_tsquery('simple', $1)",
  ];

  if (scope) {
    params.push(scope);
    conditions.push(`scope = $${params.length}`);
  }

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;

  const sql = `
    SELECT id, scope, topic, source_type, source_id, chunk_index, content,
           ts_rank(content_tsv_simple, to_tsquery('simple', $1)) AS score,
           ROW_NUMBER() OVER (
             ORDER BY ts_rank(content_tsv_simple, to_tsquery('simple', $1)) DESC
           ) AS rank
      FROM memory_drawers
     WHERE ${conditions.join(' AND ')}
     ORDER BY score DESC
     LIMIT ${limitPlaceholder}
  `;

  try {
    const { rows } = await pool.query<DrawerSearchRow>(sql, params);
    return rows.map((row) => ({
      rank: toInt(row.rank),
      result: rowToDrawerResult(row, 'keyword', toFloat(row.score)),
    }));
  } catch (error) {
    logger.warn({ err: error }, 'Drawer keyword search failed — returning empty path');
    return [];
  }
}

export async function vectorSearch(
  pool: Pool,
  query: string,
  scope: string | null,
  limit: number,
  embeddingClient: DrawerEmbeddingClient | undefined,
  logger: Logger,
): Promise<RankedDrawerMatch[]> {
  if (!embeddingClient) {
    return [];
  }

  let embedding: number[];
  try {
    embedding = await embeddingClient.embed(query);
  } catch (error: unknown) {
    logger.warn({ err: error }, 'Drawer vector search skipped — embedding generation failed');
    return [];
  }
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return [];
  }

  const vectorLiteral = `[${embedding.join(',')}]`;
  const params: unknown[] = [vectorLiteral];
  const conditions = ['archived_at IS NULL', 'embedding IS NOT NULL'];

  if (scope) {
    params.push(scope);
    conditions.push(`scope = $${params.length}`);
  }

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;

  const sql = `
    SELECT id, scope, topic, source_type, source_id, chunk_index, content,
           (1 - (embedding <=> $1::vector))::real AS score,
           ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS rank
      FROM memory_drawers
     WHERE ${conditions.join(' AND ')}
     ORDER BY embedding <=> $1::vector
     LIMIT ${limitPlaceholder}
  `;

  try {
    const { rows } = await pool.query<DrawerSearchRow>(sql, params);
    return rows.map((row) => ({
      rank: toInt(row.rank),
      result: rowToDrawerResult(row, 'vector', toFloat(row.score)),
    }));
  } catch (error) {
    logger.warn({ err: error }, 'Drawer vector search failed — returning empty path');
    return [];
  }
}

export function fuseRankedMatches(
  keyword: RankedDrawerMatch[],
  vector: RankedDrawerMatch[],
  limit: number,
): MemoryDrawerSearchResult[] {
  const fused = new Map<
    string,
    { result: MemoryDrawerSearchResult; rrfScore: number; hasVector: boolean; hasKeyword: boolean }
  >();

  for (const entry of keyword) {
    const score = 1 / (RRF_K + entry.rank);
    fused.set(entry.result.id, {
      result: entry.result,
      rrfScore: score,
      hasKeyword: true,
      hasVector: false,
    });
  }

  for (const entry of vector) {
    const score = 1 / (RRF_K + entry.rank);
    const existing = fused.get(entry.result.id);
    if (existing) {
      fused.set(entry.result.id, {
        ...existing,
        rrfScore: existing.rrfScore + score,
        hasVector: true,
      });
    } else {
      fused.set(entry.result.id, {
        result: entry.result,
        rrfScore: score,
        hasVector: true,
        hasKeyword: false,
      });
    }
  }

  const ranked = [...fused.values()].sort((left, right) => right.rrfScore - left.rrfScore);

  return ranked.slice(0, limit).map((entry) => ({
    ...entry.result,
    // Prefer 'vector' when both paths surfaced it; otherwise whichever surfaced.
    match_type: entry.hasVector ? 'vector' : entry.hasKeyword ? 'keyword' : entry.result.match_type,
    score: entry.rrfScore,
  }));
}

// ---------------------------------------------------------------------------
// Row shape helpers
// ---------------------------------------------------------------------------

type DrawerSearchRow = {
  id: string;
  scope: string;
  topic: string | null;
  source_type: string;
  source_id: string;
  chunk_index: number | string;
  content: string;
  score: number | string | null;
  rank: number | string;
};

function rowToDrawerResult(
  row: DrawerSearchRow,
  matchType: 'keyword' | 'vector',
  score: number | null,
): MemoryDrawerSearchResult {
  const content = typeof row.content === 'string' ? row.content : '';
  return {
    id: row.id,
    scope: row.scope,
    topic: row.topic ?? 'general',
    source_type: row.source_type as MemoryDrawerSearchResult['source_type'],
    source_id: row.source_id,
    chunk_index: toInt(row.chunk_index),
    content_preview: content.slice(0, CONTENT_PREVIEW_MAX_LENGTH),
    score,
    match_type: matchType,
  };
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

export function tokenizeForTsquery(query: string): string[] {
  // Mirrors the bm25 tokenizer in memory-search.ts — strip non-alphanumerics,
  // drop short tokens, and & them together. `simple` config means we do NOT
  // stem, which is correct for drawer content (raw snippets of code or
  // transcripts where stemming introduces precision loss).
  return query
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9_-]/g, ''))
    .filter((token) => token.length > 1);
}

function toInt(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function toFloat(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}
