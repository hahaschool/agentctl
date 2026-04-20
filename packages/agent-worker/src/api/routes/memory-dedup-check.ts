// ---------------------------------------------------------------------------
// Worker-side memory_dedup_check MCP tool route
//
// Validates the MemPalace-inspired request shape, delegates candidate lookup
// to the control-plane facts search, and scores the top candidate against the
// skip/merge thresholds to recommend skip / merge / store_new.
// ---------------------------------------------------------------------------

import {
  MEMORY_ENTITY_TYPES,
  type MemoryDedupCheckRequest,
  type MemoryDedupCheckResponse,
  type MemoryDedupNearestMatch,
  type MemoryDedupRecommendation,
  querySanitizerLogFields,
  sanitizeName,
  sanitizeQuery,
} from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import { extractMcpArguments } from './mcp-arguments.js';

const DEDUP_CANDIDATE_LIMIT = 5;

// Thresholds per docs/plans/2026-04-15-mempalace-inspired-memory-evolution-plan.md (Phase 4, Step 7).
const DEDUP_SKIP_THRESHOLD = 0.92;
const DEDUP_MERGE_THRESHOLD = 0.82;

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
          match_id: null,
        };
        return noMatchResponse;
      }

      const sortedMatches = candidates
        .map(candidateToNearestMatch)
        .slice()
        .sort(compareByScoreDesc);
      const scoredResponse = scoreDedupMatches(sortedMatches);
      logger.debug(
        {
          topScore: scoredResponse.topScore,
          recommendation: scoredResponse.response.recommendation,
          matchCount: sortedMatches.length,
          ...querySanitizerLogFields(sanitizedPreview),
        },
        'memory_dedup_check scored candidates',
      );
      return scoredResponse.response;
    },
  );
}

type DedupScoringResult = {
  response: MemoryDedupCheckResponse;
  topScore: number | null;
};

function scoreDedupMatches(sortedMatches: MemoryDedupNearestMatch[]): DedupScoringResult {
  const [topCandidate] = sortedMatches;
  const topScore = topCandidate?.score ?? null;
  const topId = topCandidate?.id ?? null;

  if (topScore === null || !Number.isFinite(topScore)) {
    return {
      response: {
        ok: true,
        is_duplicate: false,
        nearest_matches: sortedMatches,
        recommendation: 'store_new',
        rationale:
          'Top candidate has no similarity score; defaulting to store_new until scoring is available.',
        match_id: null,
      },
      topScore: null,
    };
  }

  const scoreText = topScore.toFixed(3);

  if (topScore >= DEDUP_SKIP_THRESHOLD) {
    return {
      response: buildScoredResponse({
        sortedMatches,
        isDuplicate: true,
        recommendation: 'skip',
        matchId: topId,
        rationale: `Top candidate is an exact or near-duplicate (score ${scoreText} >= skip threshold ${DEDUP_SKIP_THRESHOLD}); skip storing to avoid duplication.`,
      }),
      topScore,
    };
  }

  if (topScore >= DEDUP_MERGE_THRESHOLD) {
    return {
      response: buildScoredResponse({
        sortedMatches,
        isDuplicate: false,
        recommendation: 'merge',
        matchId: topId,
        rationale: `Top candidate is similar but not identical (score ${scoreText} in [${DEDUP_MERGE_THRESHOLD}, ${DEDUP_SKIP_THRESHOLD})); suggest merging with existing fact.`,
      }),
      topScore,
    };
  }

  return {
    response: buildScoredResponse({
      sortedMatches,
      isDuplicate: false,
      recommendation: 'store_new',
      matchId: null,
      rationale: `Top candidate similarity is low (score ${scoreText} < merge threshold ${DEDUP_MERGE_THRESHOLD}); store as a new fact.`,
    }),
    topScore,
  };
}

type BuildScoredResponseInput = {
  sortedMatches: MemoryDedupNearestMatch[];
  isDuplicate: boolean;
  recommendation: MemoryDedupRecommendation;
  matchId: string | null;
  rationale: string;
};

function buildScoredResponse(input: BuildScoredResponseInput): MemoryDedupCheckResponse {
  return {
    ok: true,
    is_duplicate: input.isDuplicate,
    nearest_matches: sanitizeMatchIds(input.sortedMatches),
    recommendation: input.recommendation,
    rationale: input.rationale,
    match_id: input.matchId,
  };
}

// Ensure nearest_matches are plain objects (no hidden prototypes) and keep
// the immutable copy pattern so callers cannot mutate our cached candidate set.
function sanitizeMatchIds(matches: MemoryDedupNearestMatch[]): MemoryDedupNearestMatch[] {
  return matches.map((match) => ({ ...match }));
}

function compareByScoreDesc(a: MemoryDedupNearestMatch, b: MemoryDedupNearestMatch): number {
  const aScore = typeof a.score === 'number' && Number.isFinite(a.score) ? a.score : -Infinity;
  const bScore = typeof b.score === 'number' && Number.isFinite(b.score) ? b.score : -Infinity;
  if (aScore === bScore) {
    return 0;
  }
  return bScore - aScore;
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
