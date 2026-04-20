// ---------------------------------------------------------------------------
// GET /api/memory/drawers/search — drawer-aware hybrid search
// GET /api/memory/drawers/:drawerId — drawer fetch by id
//
// §4.16 MemPalace-inspired Memory Evolution Plan, PR F (Drawer-Aware Search)
// and Phase 4 Step 6.
//
// The worker-side MCP wrappers (memory_drawer_search / memory_drawer_get)
// forward to these endpoints. This file implements the control-plane half of
// that contract:
//
//   - Sanitize the incoming `q` (shared `sanitizeQuery`). An empty sanitized
//     query short-circuits to `{ ok: true, results: [] }` with 200 to match
//     the worker's cold-start expectations.
//   - Hybrid search over `memory_drawers`:
//       • keyword path   — tsvector column `content_tsv_simple` with the
//         `simple` text search configuration (matches the schema precedent
//         in `packages/control-plane/drizzle/0030_add_memory_drawers.sql`).
//       • vector path    — cosine distance over the pgvector `embedding`
//         column when an EmbeddingClient is available. When no client is
//         configured we keyword-only — there is no separate "missing
//         embedding column" branch because the schema always has one; the
//         gate is whether we have an embedding service to encode the query.
//     Both paths are fused with Reciprocal Rank Fusion (k=60) mirroring
//     the precedent in `memory-search.ts`.
//   - Respect `scope` (exact match on `scope` column) and a bounded `limit`.
//   - `:drawerId` returns every column the worker requires and 404s on a
//     missing or incomplete record (the worker maps 404 → DRAWER_NOT_FOUND).
// ---------------------------------------------------------------------------

import type { MemoryDrawer, MemoryDrawerSearchResult } from '@agentctl/shared';
import { querySanitizerLogFields, sanitizeQuery } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import {
  CANDIDATE_LIMIT,
  type DrawerEmbeddingClient,
  fuseRankedMatches,
  keywordSearch,
  vectorSearch,
} from '../../memory/memory-drawer-search.js';

// ---------------------------------------------------------------------------
// Types + constants
// ---------------------------------------------------------------------------

export type { DrawerEmbeddingClient };

export type MemoryDrawerRoutesOptions = {
  pool: Pool;
  logger: Logger;
  embeddingClient?: DrawerEmbeddingClient;
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 1_024;
const MAX_SCOPE_LENGTH = 256;
const MAX_DRAWER_ID_LENGTH = 128;
const SAFE_DRAWER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const memoryDrawerRoutes: FastifyPluginAsync<MemoryDrawerRoutesOptions> = async (
  app,
  opts,
) => {
  const { pool, logger, embeddingClient } = opts;

  app.get<{ Querystring: { q?: string; scope?: string; limit?: string } }>(
    '/search',
    { schema: { tags: ['memory'], summary: 'Hybrid search over memory drawers' } },
    async (request, reply) => {
      const rawQuery = request.query.q;
      if (typeof rawQuery !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'q must be a non-empty string',
        });
      }
      if (rawQuery.length > MAX_QUERY_LENGTH) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: `q must be no longer than ${MAX_QUERY_LENGTH} characters`,
        });
      }

      const sanitized = sanitizeQuery(rawQuery);
      logger.debug(querySanitizerLogFields(sanitized), 'Sanitized memory drawer search query');
      if (sanitized.stage === 'empty') {
        return { ok: true as const, results: [] as MemoryDrawerSearchResult[] };
      }

      const scope = normalizeScope(request.query.scope);
      if (scope === 'invalid') {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: `scope must be a non-empty string of at most ${MAX_SCOPE_LENGTH} characters`,
        });
      }

      const limitResult = normalizeLimit(request.query.limit);
      if (!limitResult.ok) {
        return reply.code(400).send(limitResult.body);
      }
      const limit = limitResult.value;
      const candidateLimit = Math.max(CANDIDATE_LIMIT, limit);

      const startedAt = Date.now();

      let keywordMatches: Awaited<ReturnType<typeof keywordSearch>>;
      let vectorMatches: Awaited<ReturnType<typeof vectorSearch>>;
      try {
        [keywordMatches, vectorMatches] = await Promise.all([
          keywordSearch(pool, sanitized.query, scope, candidateLimit, logger, {
            degradeOnSqlError: false,
          }),
          vectorSearch(pool, sanitized.query, scope, candidateLimit, embeddingClient, logger, {
            degradeOnSqlError: false,
          }),
        ]);
      } catch (error) {
        logger.warn({ err: error }, 'Memory drawer search failed');
        return reply.code(500).send({
          error: 'MEMORY_DRAWER_SEARCH_FAILED',
          message: 'Memory drawer search failed',
        });
      }

      const fused = fuseRankedMatches(keywordMatches, vectorMatches, limit);

      logger.debug(
        {
          ...querySanitizerLogFields(sanitized),
          scope: scope ?? null,
          limit,
          keywordCount: keywordMatches.length,
          vectorCount: vectorMatches.length,
          resultCount: fused.length,
          durationMs: Date.now() - startedAt,
        },
        'memory_drawer_search complete',
      );

      return { ok: true as const, results: fused };
    },
  );

  app.get<{ Params: { drawerId: string } }>(
    '/:drawerId',
    { schema: { tags: ['memory'], summary: 'Fetch a memory drawer by id' } },
    async (request, reply) => {
      const encoded = request.params.drawerId;
      let decoded: string;
      try {
        decoded = decodeURIComponent(encoded);
      } catch {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'drawerId must be a URL-encoded safe identifier',
        });
      }

      const drawerId = normalizeDrawerId(decoded);
      if (!drawerId) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'drawerId must be a non-empty safe identifier',
        });
      }

      const drawer = await loadDrawerById(pool, drawerId);
      if (!drawer) {
        return reply.code(404).send({
          error: 'DRAWER_NOT_FOUND',
          message: `Drawer "${drawerId}" was not found`,
        });
      }

      if (!hasRequiredDrawerFields(drawer)) {
        logger.warn({ drawerId }, 'Memory drawer record missing required fields — treating as 404');
        return reply.code(404).send({
          error: 'DRAWER_NOT_FOUND',
          message: `Drawer "${drawerId}" was not found`,
        });
      }

      return { ok: true as const, drawer };
    },
  );
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function normalizeScope(value: string | undefined): string | null | 'invalid' {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return 'invalid';
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SCOPE_LENGTH) {
    return 'invalid';
  }
  return trimmed;
}

type LimitResult =
  | { ok: true; value: number }
  | { ok: false; body: { error: string; message: string } };

function normalizeLimit(raw: string | undefined): LimitResult {
  if (raw === undefined || raw === '') {
    return { ok: true, value: DEFAULT_LIMIT };
  }
  const trimmed = raw.trim();
  if (!/^\d+$/u.test(trimmed)) {
    return {
      ok: false,
      body: {
        error: 'INVALID_PARAMS',
        message: `limit must be an integer between 1 and ${MAX_LIMIT}`,
      },
    };
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return {
      ok: false,
      body: {
        error: 'INVALID_PARAMS',
        message: `limit must be an integer between 1 and ${MAX_LIMIT}`,
      },
    };
  }
  return { ok: true, value: Math.min(parsed, MAX_LIMIT) };
}

function normalizeDrawerId(value: string): string | null {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_DRAWER_ID_LENGTH ||
    trimmed.includes('..') ||
    hasControlCharacter(trimmed) ||
    !SAFE_DRAWER_ID_PATTERN.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
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

// Drawer by id
// ---------------------------------------------------------------------------

async function loadDrawerById(pool: Pool, drawerId: string): Promise<MemoryDrawer | null> {
  const sql = `
    SELECT id, scope, topic, source_type, source_id, source_uri, chunk_index,
           content, content_sha256, embedding_model, embedding_version,
           token_count, source_json, sync_visibility, retention_expires_at,
           archived_at, redaction_status, created_at, updated_at
     FROM memory_drawers
     WHERE id = $1
       AND archived_at IS NULL
     LIMIT 1
  `;
  const { rows } = await pool.query<DrawerRow>(sql, [drawerId]);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return rowToDrawer(row);
}

// ---------------------------------------------------------------------------
// Row shape helpers
// ---------------------------------------------------------------------------

type DrawerRow = {
  id: string;
  scope: string;
  topic: string | null;
  source_type: string;
  source_id: string;
  source_uri: string | null;
  chunk_index: number | string;
  content: string;
  content_sha256: string;
  embedding_model: string;
  embedding_version: number | string;
  token_count: number | string;
  source_json: Record<string, unknown> | null;
  sync_visibility: string;
  retention_expires_at: Date | string | null;
  archived_at: Date | string | null;
  redaction_status: string;
  created_at: Date | string;
  updated_at: Date | string;
};

function rowToDrawer(row: DrawerRow): MemoryDrawer {
  return {
    id: row.id,
    scope: row.scope as MemoryDrawer['scope'],
    topic: row.topic ?? 'general',
    sourceType: row.source_type as MemoryDrawer['sourceType'],
    sourceId: row.source_id,
    sourceUri: row.source_uri ?? null,
    chunkIndex: toInt(row.chunk_index),
    content: row.content,
    contentSha256: row.content_sha256,
    embeddingModel: row.embedding_model,
    embeddingVersion: toInt(row.embedding_version),
    tokenCount: toInt(row.token_count),
    sourceJson: row.source_json ?? {},
    syncVisibility: row.sync_visibility as MemoryDrawer['syncVisibility'],
    retentionExpiresAt: toIsoOrNull(row.retention_expires_at),
    archivedAt: toIsoOrNull(row.archived_at),
    redactionStatus: row.redaction_status as MemoryDrawer['redactionStatus'],
    createdAt: toIsoOrNull(row.created_at) ?? String(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at) ?? String(row.updated_at),
  };
}

function hasRequiredDrawerFields(drawer: MemoryDrawer): boolean {
  return (
    typeof drawer.id === 'string' &&
    drawer.id.length > 0 &&
    typeof drawer.scope === 'string' &&
    drawer.scope.length > 0 &&
    typeof drawer.content === 'string' &&
    drawer.content.length > 0 &&
    typeof drawer.contentSha256 === 'string' &&
    drawer.contentSha256.length > 0 &&
    typeof drawer.embeddingModel === 'string' &&
    drawer.embeddingModel.length > 0
  );
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

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

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : null;
}
