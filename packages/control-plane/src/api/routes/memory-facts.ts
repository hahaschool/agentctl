import type {
  EntityType,
  FactSource,
  FeedbackSignal,
  MemoryDrawerSearchResult,
  MemoryFact,
  MemoryScope,
} from '@agentctl/shared';
import { querySanitizerLogFields, sanitizeQuery } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { z } from 'zod';

import {
  type DrawerEmbeddingClient,
  searchMemoryDrawers,
} from '../../memory/memory-drawer-search.js';
import type { MemorySearch } from '../../memory/memory-search.js';
import type { MemoryStore, UpdateFactInput } from '../../memory/memory-store.js';

const VALID_FEEDBACK_SIGNALS: FeedbackSignal[] = ['used', 'irrelevant', 'outdated'];

// Memory facts are long-lived, user-readable strings surfaced in memory
// search, graph visualization, and mobile summaries. Caps prevent a single
// fact from bloating the table or UI (8 KB is well above natural summaries)
// and keep filter queries bounded.
const MAX_FACT_CONTENT_LENGTH = 8_192;
const MAX_FACT_FILTER_LENGTH = 128;
const MAX_FACT_QUERY_LENGTH = 1_024;
const MAX_FACT_LIMIT = 500;
const MAX_FACT_SOURCE_SPANS = 32;

// §4.16 MemPalace — drawer-aware fusion is additive and env-flagged. The
// cap mirrors the drawer route's MAX_LIMIT so a facts-side query can't pull a
// denser drawer slice than the dedicated route would.
const DEFAULT_DRAWER_RESULT_LIMIT = 25;
const MAX_DRAWER_RESULT_LIMIT = 100;

type MemoryFactRoutesOptions = {
  memorySearch?: Pick<MemorySearch, 'search'>;
  memoryStore: Pick<
    MemoryStore,
    | 'addFact'
    | 'getFact'
    | 'invalidateFact'
    | 'listEdges'
    | 'listFacts'
    | 'recordFeedback'
    | 'updateFact'
  >;
  pool?: Pool;
  /**
   * Embedding client used to run the drawer-aware fusion pass when the
   * `MEMORY_DRAWER_FUSION` feature flag is enabled. When absent, the flag is
   * a no-op and behaviour matches the pre-flag envelope.
   */
  embeddingClient?: DrawerEmbeddingClient;
  /** Resolved once at registration; do NOT read `process.env` per request. */
  drawerFusionEnabled?: boolean;
  /** Logger used for drawer-fusion warnings. Falls back to a stub. */
  logger?: Logger;
};

const DEFAULT_LIMIT = 50;

const factSourceSpanBodySchema = z
  .object({
    drawerId: z.string().min(1).max(MAX_FACT_FILTER_LENGTH),
    startOffset: z.number().int().min(0),
    endOffset: z.number().int().min(0),
    sourceJson: z.record(z.unknown()).optional(),
  })
  .superRefine((span, ctx) => {
    if (span.endOffset < span.startOffset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endOffset'],
        message: 'endOffset must be greater than or equal to startOffset',
      });
    }
  });

const createFactBodySchema = z.object({
  content: z.string().min(1).max(MAX_FACT_CONTENT_LENGTH),
  scope: z.string().min(1).max(MAX_FACT_FILTER_LENGTH),
  entityType: z.string().min(1).max(MAX_FACT_FILTER_LENGTH),
  confidence: z.number().min(0).max(1).optional(),
  source: z.record(z.unknown()).optional(),
  sourceSpans: z.array(factSourceSpanBodySchema).max(MAX_FACT_SOURCE_SPANS).optional(),
});

const updateFactBodySchema = z.object({
  scope: z.string().min(1).max(MAX_FACT_FILTER_LENGTH).optional(),
  content: z.string().min(1).max(MAX_FACT_CONTENT_LENGTH).optional(),
  entityType: z.string().min(1).max(MAX_FACT_FILTER_LENGTH).optional(),
  confidence: z.number().min(0).max(1).optional(),
  strength: z.number().min(0).max(1).optional(),
});

// Strict `drawerLimit` validator — rejects `25abc`, `1.5`, `0`, `101`, etc.
// with a 400 before the handler runs. We stay on the Zod path (mirroring
// `listFactsQuerySchema` precedent) instead of adding a separate Fastify JSON
// schema so a single rejection envelope owns every query-param error.
const drawerLimitSchema = z
  .string()
  .regex(/^[0-9]+$/, 'drawerLimit must be an integer')
  .transform((value) => Number.parseInt(value, 10))
  .pipe(z.number().int().min(1).max(MAX_DRAWER_RESULT_LIMIT))
  .optional();

const listFactsQuerySchema = z.object({
  q: z.string().max(MAX_FACT_QUERY_LENGTH).optional(),
  scope: z.string().max(MAX_FACT_FILTER_LENGTH).optional(),
  entityType: z.string().max(MAX_FACT_FILTER_LENGTH).optional(),
  sessionId: z.string().max(MAX_FACT_FILTER_LENGTH).optional(),
  agentId: z.string().max(MAX_FACT_FILTER_LENGTH).optional(),
  machineId: z.string().max(MAX_FACT_FILTER_LENGTH).optional(),
  minConfidence: z.string().max(32).optional(),
  limit: z.string().max(16).optional(),
  offset: z.string().max(16).optional(),
  drawerLimit: drawerLimitSchema,
});

function mapFactBodyIssue(issue: z.ZodIssue | undefined): { error: string; message: string } {
  const field = issue?.path[0];
  switch (field) {
    case 'content':
      return {
        error: 'INVALID_CONTENT',
        message: `"content" must be a non-empty string of at most ${MAX_FACT_CONTENT_LENGTH} characters`,
      };
    case 'scope':
      return {
        error: 'INVALID_SCOPE',
        message: `"scope" must be a non-empty string of at most ${MAX_FACT_FILTER_LENGTH} characters`,
      };
    case 'entityType':
      return {
        error: 'INVALID_ENTITY_TYPE',
        message: `"entityType" must be a non-empty string of at most ${MAX_FACT_FILTER_LENGTH} characters`,
      };
    case 'confidence':
      return { error: 'INVALID_CONFIDENCE', message: '"confidence" must be a number in [0, 1]' };
    case 'sourceSpans':
      return {
        error: 'INVALID_SOURCE_SPANS',
        message:
          '"sourceSpans" must contain bounded drawer offsets with endOffset greater than or equal to startOffset',
      };
    case 'strength':
      return { error: 'INVALID_STRENGTH', message: '"strength" must be a number in [0, 1]' };
    default:
      return { error: 'INVALID_FACT_BODY', message: 'Invalid memory fact body' };
  }
}

const DEFAULT_SOURCE: FactSource = {
  session_id: null,
  agent_id: null,
  machine_id: null,
  turn_index: null,
  extraction_method: 'manual',
};

export const memoryFactRoutes: FastifyPluginAsync<MemoryFactRoutesOptions> = async (app, opts) => {
  const { memorySearch, memoryStore, pool, embeddingClient } = opts;
  // Resolve the flag once at registration — never re-read process.env per
  // request. Callers that want to invert the gate pass `drawerFusionEnabled`
  // explicitly; otherwise we fall back to the documented env variable so
  // ops can flip the flag without a code change.
  const drawerFusionEnabled =
    opts.drawerFusionEnabled ?? process.env.MEMORY_DRAWER_FUSION === 'true';
  const fusionLogger: Logger = opts.logger ?? (app.log as Logger);
  // Only run the fusion pass when every dependency is wired. Keeps the
  // behaviour additive: if embeddings or the pg pool aren't available we
  // silently skip, matching the request contract in the task description.
  const drawerFusionActive = Boolean(drawerFusionEnabled && embeddingClient && pool);

  app.get<{
    Querystring: {
      q?: string;
      scope?: MemoryScope;
      entityType?: EntityType;
      sessionId?: string;
      agentId?: string;
      machineId?: string;
      minConfidence?: string;
      limit?: string;
      offset?: string;
      drawerLimit?: string;
    };
  }>(
    '/',
    { schema: { tags: ['memory'], summary: 'Search or list memory facts' } },
    async (request, reply) => {
      const parsedQuery = listFactsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        const firstIssue = parsedQuery.error.issues[0];
        if (firstIssue?.path[0] === 'drawerLimit') {
          reply.code(400).send({
            error: 'INVALID_DRAWER_LIMIT',
            message: `drawerLimit must be an integer between 1 and ${MAX_DRAWER_RESULT_LIMIT}`,
          });
          return;
        }
        reply.code(400).send({
          error: 'INVALID_FACT_QUERY',
          message: 'memory fact query parameters exceed bounded limits',
        });
        return;
      }
      const { q, scope, entityType, sessionId, agentId, machineId, minConfidence } =
        parsedQuery.data;
      const limit = Math.min(parseInteger(parsedQuery.data.limit, DEFAULT_LIMIT), MAX_FACT_LIMIT);
      const offset = parseInteger(parsedQuery.data.offset, 0);
      const minConfidenceValue = parseFloatValue(minConfidence);

      if (q && q.trim().length > 0) {
        // Semantic search when available, SQL ILIKE fallback otherwise
        if (memorySearch) {
          const visibleScopes = scope ? [scope as MemoryScope] : [];
          const rawResults = await memorySearch.search({
            query: q,
            visibleScopes,
            limit: limit + offset,
            entityType: entityType as EntityType | undefined,
          });
          const filteredResults = rawResults.filter((result) =>
            factMatchesFilters(result.fact, {
              sessionId,
              agentId,
              machineId,
              minConfidence: minConfidenceValue,
            }),
          );
          const pagedResults = filteredResults.slice(offset, offset + limit).map((result) => ({
            fact: result.fact,
            score: result.score,
            source_path: result.source_path,
          }));
          const pagedFacts = pagedResults.map((entry) => entry.fact);

          // Drawer-aware fusion pass (additive, feature-flagged).
          //
          // When `MEMORY_DRAWER_FUSION=true` AND an embedding client + pg pool
          // are wired, also surface drawer hits via the shared drawer search
          // helper. We do NOT modify `facts` / `results` in this slice — see
          // the plan in docs/plans/2026-04-15-mempalace-inspired-memory-evolution-plan.md
          // (Phase 4: Drawer-Aware Search Fusion) — a unified ranking is a
          // follow-up. Any drawer-side failure degrades to the non-flagged
          // envelope; it must not break the fact response.
          //
          // The raw user query is routed through the shared three-stage
          // `sanitizeQuery` helper before it ever reaches the drawer search
          // helper — mirroring what the fact-path already does inside
          // `MemorySearch.search`. If sanitization rejects the query (empty
          // after trim, prefix-smell, etc.), we silently skip drawer fusion
          // and return the fact-only envelope; a rejected drawer query must
          // never 400 the whole fact request.
          const drawerResults =
            drawerFusionActive && pool && embeddingClient
              ? await runDrawerFusion({
                  pool,
                  embeddingClient,
                  logger: fusionLogger,
                  query: q,
                  scope,
                  drawerLimit: parsedQuery.data.drawerLimit,
                })
              : undefined;

          return {
            ok: true,
            facts: pagedFacts,
            results: pagedResults,
            total: filteredResults.length,
            ...(drawerResults !== undefined ? { drawerResults } : {}),
          };
        }

        // Fallback: SQL ILIKE text search when no embedding service
        if (pool) {
          const facts = await sqlTextSearch(pool, {
            q,
            scope: scope as MemoryScope | undefined,
            entityType: entityType as EntityType | undefined,
            sessionId,
            agentId,
            machineId,
            minConfidence: minConfidenceValue,
            limit,
            offset,
          });
          return { ok: true, facts, total: facts.length };
        }
      }

      const facts = await memoryStore.listFacts({
        scope: scope as MemoryScope | undefined,
        entityType: entityType as EntityType | undefined,
        sessionId,
        agentId,
        machineId,
        minConfidence: minConfidenceValue,
        limit,
        offset,
      });

      return {
        ok: true,
        facts,
        total: facts.length,
      };
    },
  );

  app.post<{
    Body: {
      content: string;
      scope: MemoryScope;
      entityType: EntityType;
      confidence?: number;
      source?: FactSource;
      sourceSpans?: Array<{
        drawerId: string;
        startOffset: number;
        endOffset: number;
        sourceJson?: Record<string, unknown>;
      }>;
    };
  }>(
    '/',
    { schema: { tags: ['memory'], summary: 'Create a memory fact' } },
    async (request, reply) => {
      const parsed = createFactBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(mapFactBodyIssue(parsed.error.issues[0]));
      }
      const { content, scope, entityType, confidence, source, sourceSpans } = parsed.data;

      const fact = await memoryStore.addFact({
        content,
        scope: scope as MemoryScope,
        entity_type: entityType as EntityType,
        confidence,
        source: (source as FactSource | undefined) ?? DEFAULT_SOURCE,
        sourceSpans,
      });

      return reply.code(201).send({ ok: true, fact });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['memory'], summary: 'Get a memory fact with its relationships' } },
    async (request, reply) => {
      const fact = await memoryStore.getFact(request.params.id);
      if (!fact) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Memory fact not found' });
      }

      const edges = await memoryStore.listEdges({ factId: request.params.id });
      return { ok: true, fact, edges };
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      scope?: MemoryScope;
      content?: string;
      entityType?: EntityType;
      confidence?: number;
      strength?: number;
    };
  }>(
    '/:id',
    { schema: { tags: ['memory'], summary: 'Update editable memory fact fields' } },
    async (request, reply) => {
      const parsed = updateFactBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(mapFactBodyIssue(parsed.error.issues[0]));
      }
      const patch: UpdateFactInput = {};
      if (parsed.data.scope) patch.scope = parsed.data.scope as MemoryScope;
      if (parsed.data.content !== undefined) patch.content = parsed.data.content;
      if (parsed.data.entityType) patch.entity_type = parsed.data.entityType as EntityType;
      if (parsed.data.confidence !== undefined) patch.confidence = parsed.data.confidence;
      if (parsed.data.strength !== undefined) patch.strength = parsed.data.strength;

      const fact = await memoryStore.updateFact(request.params.id, patch);
      if (!fact) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Memory fact not found' });
      }

      return { ok: true, fact };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['memory'], summary: 'Invalidate a memory fact' } },
    async (request) => {
      await memoryStore.invalidateFact(request.params.id);
      return { ok: true, id: request.params.id };
    },
  );

  app.post<{
    Params: { id: string };
    Body: { signal: string };
  }>(
    '/:id/feedback',
    { schema: { tags: ['memory'], summary: 'Record feedback signal for a memory fact' } },
    async (request, reply) => {
      const { signal } = request.body;

      if (!signal || !VALID_FEEDBACK_SIGNALS.includes(signal as FeedbackSignal)) {
        return reply.code(400).send({
          error: 'INVALID_SIGNAL',
          message: `signal must be one of: ${VALID_FEEDBACK_SIGNALS.join(', ')}`,
        });
      }

      const fact = await memoryStore.recordFeedback(request.params.id, signal as FeedbackSignal);
      if (!fact) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Memory fact not found' });
      }

      return { ok: true, fact };
    },
  );
};

// ---------------------------------------------------------------------------
// SQL ILIKE fallback for text search when no embedding service is available
// ---------------------------------------------------------------------------

async function sqlTextSearch(
  pool: Pool,
  filters: {
    q: string;
    scope?: MemoryScope;
    entityType?: EntityType;
    sessionId?: string;
    agentId?: string;
    machineId?: string;
    minConfidence?: number;
    limit: number;
    offset: number;
  },
): Promise<MemoryFact[]> {
  const params: unknown[] = [];
  const conditions = ['valid_until IS NULL'];

  params.push(`%${filters.q}%`);
  conditions.push(`content ILIKE $${params.length}`);

  if (filters.scope) {
    params.push(filters.scope);
    conditions.push(`scope = $${params.length}`);
  }
  if (filters.entityType) {
    params.push(filters.entityType);
    conditions.push(`entity_type = $${params.length}`);
  }
  if (filters.sessionId) {
    params.push(filters.sessionId);
    conditions.push(`source_json->>'session_id' = $${params.length}`);
  }
  if (filters.agentId) {
    params.push(filters.agentId);
    conditions.push(`source_json->>'agent_id' = $${params.length}`);
  }
  if (filters.machineId) {
    params.push(filters.machineId);
    conditions.push(`source_json->>'machine_id' = $${params.length}`);
  }
  if (filters.minConfidence !== undefined) {
    params.push(filters.minConfidence);
    conditions.push(`confidence >= $${params.length}`);
  }

  params.push(filters.limit);
  params.push(filters.offset);

  const { rows } = await pool.query(
    `SELECT id, scope, content, content_model, entity_type,
            confidence::real, strength::real, source_json,
            valid_from, valid_until, created_at, accessed_at,
            tags, usage_count
     FROM memory_facts
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params,
  );

  return (rows as Record<string, unknown>[]).map(rowToFact);
}

function rowToFact(row: Record<string, unknown>): MemoryFact {
  return {
    id: row.id as string,
    scope: row.scope as MemoryScope,
    content: row.content as string,
    content_model: (row.content_model as string) ?? 'none',
    entity_type: row.entity_type as EntityType,
    confidence: Number(row.confidence ?? 0.8),
    strength: Number(row.strength ?? 1.0),
    source: (row.source_json as FactSource) ?? DEFAULT_SOURCE,
    valid_from: (row.valid_from as string) ?? '',
    valid_until: (row.valid_until as string) ?? null,
    created_at: (row.created_at as string) ?? '',
    accessed_at: (row.accessed_at as string) ?? null,
    tags: (row.tags as string[]) ?? [],
    usage_count: Number(row.usage_count ?? 0),
  };
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatValue(value: string | undefined): number | undefined {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : undefined;
}

// ---------------------------------------------------------------------------
// Drawer-aware fusion helper
// ---------------------------------------------------------------------------

type RunDrawerFusionInput = {
  pool: Pool;
  embeddingClient: DrawerEmbeddingClient;
  logger: Logger;
  query: string;
  scope?: string;
  drawerLimit: number | undefined;
};

async function runDrawerFusion(
  input: RunDrawerFusionInput,
): Promise<MemoryDrawerSearchResult[] | undefined> {
  const limit = input.drawerLimit ?? DEFAULT_DRAWER_RESULT_LIMIT;
  try {
    // Mirror `MemorySearch.search` — run the raw query through the shared
    // three-stage sanitizer so drawer fusion never sees system prompts,
    // transcript dumps, or oversized input. An `empty` verdict means the
    // query is unusable for drawer search: degrade to fact-only (return
    // undefined) rather than 400ing the whole fact request.
    const sanitized = sanitizeQuery(input.query);
    input.logger.debug(querySanitizerLogFields(sanitized), 'Sanitized drawer fusion query');
    if (sanitized.stage === 'empty') {
      input.logger.debug(
        { reason: 'query_empty' },
        'Drawer fusion skipped — sanitizer rejected query',
      );
      return undefined;
    }

    return await searchMemoryDrawers(
      {
        query: sanitized.query,
        scope: input.scope ?? null,
        limit,
      },
      {
        pool: input.pool,
        embeddingClient: input.embeddingClient,
        logger: input.logger,
      },
    );
  } catch (err) {
    // Additive behaviour: drawer fusion must never break the fact envelope.
    input.logger.warn({ err }, 'Drawer fusion pass failed — falling back to fact-only envelope');
    return undefined;
  }
}

function factMatchesFilters(
  fact: MemoryFact,
  filters: {
    sessionId?: string;
    agentId?: string;
    machineId?: string;
    minConfidence?: number;
  },
): boolean {
  if (filters.sessionId && fact.source.session_id !== filters.sessionId) {
    return false;
  }
  if (filters.agentId && fact.source.agent_id !== filters.agentId) {
    return false;
  }
  if (filters.machineId && fact.source.machine_id !== filters.machineId) {
    return false;
  }
  if (filters.minConfidence !== undefined && fact.confidence < filters.minConfidence) {
    return false;
  }
  return true;
}
