// ---------------------------------------------------------------------------
// Worker-side memory_dedup_check MCP tool route
//
// First contract slice: validate the planned MemPalace-inspired request shape
// and prove the safe no-candidate path via the existing facts search. Full
// skip/merge scoring waits for drawer-aware search/backfill.
// ---------------------------------------------------------------------------

import {
  MEMORY_ENTITY_TYPES,
  type MemoryDedupCheckRequest,
  type MemoryDedupCheckResponse,
  type MemoryDedupNearestMatch,
  querySanitizerLogFields,
  sanitizeName,
  sanitizeQuery,
} from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import { extractMcpArguments } from './mcp-arguments.js';

const DEDUP_CANDIDATE_LIMIT = 5;

type MemoryDedupCheckRouteOptions = FastifyPluginOptions & {
  controlPlaneUrl: string;
  logger: Logger;
};

type CandidateRecord = Record<string, unknown>;

export async function memoryDedupCheckRoutes(
  app: FastifyInstance,
  opts: MemoryDedupCheckRouteOptions,
): Promise<void> {
  const { controlPlaneUrl, logger } = opts;

  app.post(
    '/memory-dedup-check',
    async (request: FastifyRequest<{ Body: MemoryDedupCheckRequest }>, reply: FastifyReply) => {
      const extracted = extractMcpArguments<MemoryDedupCheckRequest>(request.body);
      if (!extracted.ok) {
        return reply.code(400).send(extracted.error);
      }

      const body = extracted.body;
      const contentPreview = normalizeNonEmptyString(body?.content_preview);
      if (!contentPreview) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'content_preview must be a non-empty string',
        });
      }

      const scope = normalizeNonEmptyString(body?.scope);
      if (!scope) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'scope must be a non-empty string',
        });
      }

      try {
        sanitizeName(scope);
      } catch {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'scope must be a safe memory scope',
        });
      }

      const entityType = body?.entity_type;
      if (
        entityType !== undefined &&
        (typeof entityType !== 'string' ||
          !(MEMORY_ENTITY_TYPES as readonly string[]).includes(entityType))
      ) {
        return reply.code(400).send({
          error: 'INVALID_ENTITY_TYPE',
          message: `entity_type must be one of: ${MEMORY_ENTITY_TYPES.join(', ')}`,
        });
      }

      if (
        body?.embedding_precomputed !== undefined &&
        (!Array.isArray(body.embedding_precomputed) ||
          !body.embedding_precomputed.every((value) => Number.isFinite(value)))
      ) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'embedding_precomputed must be an array of finite numbers when provided',
        });
      }

      const sanitizedPreview = sanitizeQuery(contentPreview);
      logger.debug(querySanitizerLogFields(sanitizedPreview), 'Sanitized memory dedup preview');
      if (sanitizedPreview.stage === 'empty') {
        return reply.code(400).send({
          error: 'query_empty',
          message: 'content_preview must be a non-empty string after sanitization',
        });
      }

      const params = new URLSearchParams({
        q: sanitizedPreview.query,
        scope,
        limit: String(DEDUP_CANDIDATE_LIMIT),
      });
      if (entityType) {
        params.set('entityType', entityType);
      }

      let response: Response;
      try {
        response = await fetch(`${controlPlaneUrl}/api/memory/facts?${params.toString()}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error: unknown) {
        logger.error(
          { err: error, ...querySanitizerLogFields(sanitizedPreview) },
          'Failed to reach control-plane for memory dedup check',
        );
        return reply.code(503).send({
          error: 'MEMORY_DEDUP_CHECK_UNREACHABLE',
          message: 'Control-plane unreachable while checking memory duplicates',
        });
      }

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({}));
        logger.warn(
          {
            status: response.status,
            body: responseBody,
            ...querySanitizerLogFields(sanitizedPreview),
          },
          'Control-plane returned error for memory dedup check',
        );
        return reply.code(response.status).send(responseBody);
      }

      const result = (await response.json()) as Record<string, unknown>;
      const candidates = extractCandidateRecords(result);

      if (candidates.length === 0) {
        const noMatchResponse: MemoryDedupCheckResponse = {
          ok: true,
          is_duplicate: false,
          nearest_matches: [],
          recommendation: 'store_new',
          rationale: 'No existing memory candidates matched this content preview.',
        };
        return noMatchResponse;
      }

      const nearestMatches = candidates.map(candidateToNearestMatch);
      return reply.code(501).send({
        error: 'DEDUP_SCORING_UNAVAILABLE',
        message:
          'memory_dedup_check candidate scoring requires drawer-aware search/backfill and is not enabled in this first contract slice',
        nearest_matches: nearestMatches,
      });
    },
  );
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractCandidateRecords(result: Record<string, unknown>): CandidateRecord[] {
  const rawCandidates = Array.isArray(result.results)
    ? result.results
    : Array.isArray(result.facts)
      ? result.facts
      : [];

  return rawCandidates.filter(
    (candidate): candidate is CandidateRecord =>
      typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate),
  );
}

function candidateToNearestMatch(candidate: CandidateRecord): MemoryDedupNearestMatch {
  const nestedFact =
    typeof candidate.fact === 'object' && candidate.fact !== null && !Array.isArray(candidate.fact)
      ? (candidate.fact as CandidateRecord)
      : candidate;
  const rawId = nestedFact.id;
  const rawContent = nestedFact.content;
  const rawScore = candidate.score;
  const rawSourcePath = candidate.source_path;

  return {
    id: typeof rawId === 'string' ? rawId : 'unknown',
    score: typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : null,
    content_preview: typeof rawContent === 'string' ? rawContent.slice(0, 240) : '',
    source_path: typeof rawSourcePath === 'string' ? rawSourcePath : null,
  };
}
