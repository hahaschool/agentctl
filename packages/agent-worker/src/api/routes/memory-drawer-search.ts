// ---------------------------------------------------------------------------
// Worker-side memory_drawer_search MCP tool route
//
// First contract slice: lock the MemPalace-inspired drawer search request
// schema and the empty-DB behaviour. Actual drawer index integration
// (vector + keyword fusion over `memory_drawers`) is deferred to the
// control-plane follow-up in Phase 4, Step 6 of
// docs/plans/2026-04-15-mempalace-inspired-memory-evolution-plan.md.
// ---------------------------------------------------------------------------

import {
  type MemoryDrawerSearchRequest,
  type MemoryDrawerSearchResponse,
  type MemoryDrawerSearchResult,
  type MemoryDrawerSearchResultMatchType,
  type MemoryDrawerSourceType,
  querySanitizerLogFields,
  sanitizeQuery,
} from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import { extractMcpArguments } from './mcp-arguments.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const CONTENT_PREVIEW_MAX_LENGTH = 240;
const MEMORY_DRAWER_SEARCH_TIMEOUT_MS = 5_000;
const DRAWER_SOURCE_TYPES = new Set<string>([
  'session-jsonl',
  'runtime-checkpoint',
  'claude-mem-observation',
  'claude-mem-session-summary',
  'manual',
  'document',
  'diary',
]);
const DRAWER_MATCH_TYPES = new Set<string>(['vector', 'keyword', 'grep']);

type MemoryDrawerSearchRouteOptions = FastifyPluginOptions & {
  controlPlaneUrl: string;
  logger: Logger;
};

type DrawerSearchResponseBody = Record<string, unknown>;

export async function memoryDrawerSearchRoutes(
  app: FastifyInstance,
  opts: MemoryDrawerSearchRouteOptions,
): Promise<void> {
  const { controlPlaneUrl, logger } = opts;

  app.post(
    '/memory-drawer-search',
    async (request: FastifyRequest<{ Body: MemoryDrawerSearchRequest }>, reply: FastifyReply) => {
      const extracted = extractMcpArguments<MemoryDrawerSearchRequest>(request.body);
      if (!extracted.ok) {
        return reply.code(400).send(extracted.error);
      }

      const body = extracted.body;
      const query = body?.query;
      if (typeof query !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'query must be a non-empty string',
        });
      }

      const sanitizedQuery = sanitizeQuery(query);
      logger.debug(querySanitizerLogFields(sanitizedQuery), 'Sanitized memory drawer search query');
      if (sanitizedQuery.stage === 'empty') {
        return reply.code(400).send({
          error: 'query_empty',
          message: 'query must be a non-empty string after sanitization',
        });
      }

      const rawLimit = body?.limit;
      if (
        rawLimit !== undefined &&
        (typeof rawLimit !== 'number' ||
          !Number.isInteger(rawLimit) ||
          rawLimit < 1 ||
          rawLimit > MAX_LIMIT)
      ) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: `limit must be an integer between 1 and ${MAX_LIMIT}`,
        });
      }
      const limit = rawLimit ?? DEFAULT_LIMIT;

      const rawScope = body?.scope;
      if (rawScope !== undefined && typeof rawScope !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'scope must be a string when provided',
        });
      }
      const scope = typeof rawScope === 'string' ? rawScope.trim() : undefined;
      if (rawScope !== undefined && (!scope || scope.length === 0)) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'scope must be a non-empty string when provided',
        });
      }

      const params = new URLSearchParams({
        q: sanitizedQuery.query,
        limit: String(limit),
      });
      if (scope) {
        params.set('scope', scope);
      }

      const url = `${controlPlaneUrl}/api/memory/drawers/search?${params.toString()}`;
      const logContext = { ...querySanitizerLogFields(sanitizedQuery), limit, scope };
      const startedAt = Date.now();

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(MEMORY_DRAWER_SEARCH_TIMEOUT_MS),
        });
      } catch (error: unknown) {
        logger.error(
          { err: error, ...logContext },
          'Failed to reach control-plane for memory drawer search',
        );
        return reply.code(503).send({
          error: 'MEMORY_DRAWER_SEARCH_UNREACHABLE',
          message: 'Control-plane unreachable while searching memory drawers',
        });
      }

      // When the drawer search endpoint is not implemented yet (or the drawer
      // index is empty), lock the contract: return an empty result list. This
      // matches the cold-start contract used by memory_search and
      // memory_traverse and lets MCP callers adopt the tool ahead of the
      // control-plane work landing.
      if (response.status === 404 || response.status === 501 || response.status === 204) {
        logger.debug(
          { ...logContext, status: response.status, durationMs: Date.now() - startedAt },
          'memory_drawer_search returned empty result contract',
        );
        return emptySearchResponse();
      }

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({}));
        logger.warn(
          {
            ...logContext,
            status: response.status,
            body: responseBody,
            durationMs: Date.now() - startedAt,
          },
          'Control-plane returned error for memory drawer search',
        );
        return reply.code(response.status).send(responseBody);
      }

      const result = (await response.json().catch(() => ({}))) as DrawerSearchResponseBody;
      const normalized = normalizeDrawerSearchResponse(result, limit);

      logger.debug(
        {
          ...logContext,
          resultCount: normalized.results.length,
          durationMs: Date.now() - startedAt,
        },
        'memory_drawer_search complete',
      );
      return normalized;
    },
  );
}

function emptySearchResponse(): MemoryDrawerSearchResponse {
  return { ok: true, results: [] };
}

function normalizeDrawerSearchResponse(
  result: DrawerSearchResponseBody,
  limit: number,
): MemoryDrawerSearchResponse {
  const rawResults = Array.isArray(result.results)
    ? result.results
    : Array.isArray(result.drawers)
      ? result.drawers
      : [];

  const results = rawResults
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null && !Array.isArray(entry),
    )
    .map(normalizeDrawerResult)
    .filter((match): match is MemoryDrawerSearchResult => match !== null)
    .slice(0, limit);

  return { ok: true, results };
}

function normalizeDrawerResult(record: Record<string, unknown>): MemoryDrawerSearchResult | null {
  const id = stringValue(record.id);
  const scope = stringValue(record.scope);
  if (!id || !scope) {
    return null;
  }

  const sourceTypeRaw = stringValue(record.source_type);
  const sourceType: MemoryDrawerSourceType =
    sourceTypeRaw && DRAWER_SOURCE_TYPES.has(sourceTypeRaw)
      ? (sourceTypeRaw as MemoryDrawerSourceType)
      : 'manual';

  const matchTypeRaw = stringValue(record.match_type);
  const matchType: MemoryDrawerSearchResultMatchType | null =
    matchTypeRaw && DRAWER_MATCH_TYPES.has(matchTypeRaw)
      ? (matchTypeRaw as MemoryDrawerSearchResultMatchType)
      : null;

  const rawContent = stringValue(record.content_preview) ?? stringValue(record.content) ?? '';

  return {
    id,
    scope,
    topic: stringValue(record.topic) ?? 'general',
    source_type: sourceType,
    source_id: stringValue(record.source_id) ?? '',
    chunk_index: integerValue(record.chunk_index) ?? 0,
    content_preview: rawContent.slice(0, CONTENT_PREVIEW_MAX_LENGTH),
    score: numberValue(record.score),
    match_type: matchType,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integerValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
