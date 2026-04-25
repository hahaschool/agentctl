// ---------------------------------------------------------------------------
// GET /api/memory/timeline — bounded first-slice entity timeline read API
//
// This control-plane slice intentionally stays read-only and conservative:
//   - `entity` is currently interpreted as a `memory_facts.id`, matching the
//     same canonicalization limitation already called out in memory_traverse.
//   - Timeline windows are derived from fact validity because `memory_edges`
//     does not yet carry temporal columns.
//   - Pagination is opaque and deterministic (`effective_from`, edge
//     `created_at`, `id`) so a future UI can page without learning SQL keys.
// ---------------------------------------------------------------------------

import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import {
  decodeEntityTimelineCursor,
  type EntityTimelineCursor,
  readEntityTimeline,
} from '../../memory/entity-timeline.js';

export type MemoryTimelineRoutesOptions = {
  pool: Pool;
  logger: Logger;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_ENTITY_ID_LENGTH = 128;
const SAFE_ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

type TimelineQuerystring = {
  entity?: string;
  as_of?: string;
  asOf?: string;
  limit?: string;
  cursor?: string;
};

type TimelineEntityBody = {
  requested_id: string;
  resolved_fact_id: string;
  content_preview: string;
  valid_from: string;
  valid_until: string | null;
  confidence: number | null;
  active_at_as_of: boolean | null;
  canonicalization_mode: 'fact-id-fallback';
};

type TimelineEventBody = {
  edge_id: string;
  relation: string;
  direction: 'incoming' | 'outgoing';
  other_fact_id: string;
  other_fact_preview: string;
  effective_from: string;
  effective_until: string | null;
  edge_created_at: string;
  source_fact_id: string;
  target_fact_id: string;
};

type TimelineResponseBody = {
  ok: true;
  entity: TimelineEntityBody;
  as_of: string | null;
  limit: number;
  next_cursor: string | null;
  events: TimelineEventBody[];
  limitations: readonly string[];
};

type NormalizedTimelineRequest = {
  entity: string;
  asOf?: string;
  limit: number;
  cursor?: EntityTimelineCursor;
};

type ValidationOk<T> = { ok: true; value: T };
type ValidationErr = {
  ok: false;
  status: number;
  body: { error: string; message: string };
};
type ValidationResult<T> = ValidationOk<T> | ValidationErr;

export const memoryTimelineRoutes: FastifyPluginAsync<MemoryTimelineRoutesOptions> = async (
  app,
  opts,
) => {
  const { pool, logger } = opts;

  app.get<{ Querystring: TimelineQuerystring }>(
    '/',
    {
      schema: {
        tags: ['memory'],
        summary: 'Read a bounded entity timeline derived from memory facts and edges',
      },
    },
    async (request, reply) => {
      const validation = validateQuery(request.query);
      if (!validation.ok) {
        return reply.code(validation.status).send(validation.body);
      }

      const params = validation.value;
      const startedAt = Date.now();
      const timeline = await readEntityTimeline(pool, {
        requestedId: params.entity,
        limit: params.limit,
        asOf: params.asOf,
        cursor: params.cursor,
      });

      if (!timeline) {
        logger.debug(
          { entity: params.entity },
          'memory_timeline: entity not found — returning 404',
        );
        return reply.code(404).send({
          error: 'MEMORY_TIMELINE_ENTITY_NOT_FOUND',
          message: 'Requested timeline entity not found',
        });
      }

      logger.debug(
        {
          entity: params.entity,
          asOf: params.asOf,
          limit: params.limit,
          eventCount: timeline.events.length,
          hasNextCursor: timeline.nextCursor !== null,
          durationMs: Date.now() - startedAt,
        },
        'memory_timeline complete',
      );

      const body: TimelineResponseBody = {
        ok: true,
        entity: {
          requested_id: timeline.entity.requestedId,
          resolved_fact_id: timeline.entity.resolvedFactId,
          content_preview: timeline.entity.contentPreview,
          valid_from: timeline.entity.validFrom,
          valid_until: timeline.entity.validUntil,
          confidence: timeline.entity.confidence,
          active_at_as_of: timeline.entity.activeAtAsOf,
          canonicalization_mode: timeline.entity.canonicalizationMode,
        },
        as_of: params.asOf ?? null,
        limit: params.limit,
        next_cursor: timeline.nextCursor,
        events: timeline.events.map((event) => ({
          edge_id: event.edgeId,
          relation: event.relation,
          direction: event.direction,
          other_fact_id: event.otherFactId,
          other_fact_preview: event.otherFactPreview,
          effective_from: event.effectiveFrom,
          effective_until: event.effectiveUntil,
          edge_created_at: event.edgeCreatedAt,
          source_fact_id: event.sourceFactId,
          target_fact_id: event.targetFactId,
        })),
        limitations: timeline.limitations,
      };
      return body;
    },
  );
};

function validateQuery(query: TimelineQuerystring): ValidationResult<NormalizedTimelineRequest> {
  const entity = normalizeEntityId(query.entity);
  if (!entity) {
    return invalidParams('entity must be a non-empty safe id');
  }

  const asOfResult = validateAsOf(query.as_of ?? query.asOf);
  if (!asOfResult.ok) {
    return asOfResult;
  }

  const limitResult = validateLimit(query.limit);
  if (!limitResult.ok) {
    return limitResult;
  }

  const cursorResult = validateCursor(query.cursor);
  if (!cursorResult.ok) {
    return cursorResult;
  }

  return {
    ok: true,
    value: {
      entity,
      asOf: asOfResult.value,
      limit: limitResult.value,
      cursor: cursorResult.value,
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

function normalizeEntityId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_ENTITY_ID_LENGTH ||
    trimmed.includes('..') ||
    hasControlCharacter(trimmed) ||
    !SAFE_ENTITY_ID_PATTERN.test(trimmed)
  ) {
    return null;
  }

  return trimmed;
}

function validateAsOf(value: unknown): ValidationResult<string | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') {
    return invalidParams('as_of must be a valid timestamp string');
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return invalidParams('as_of must be a valid timestamp string');
  }

  return { ok: true, value: new Date(timestamp).toISOString() };
}

function validateLimit(value: unknown): ValidationResult<number> {
  if (value === undefined) {
    return { ok: true, value: DEFAULT_LIMIT };
  }
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    return invalidParams(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    return invalidParams(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }

  return { ok: true, value: parsed };
}

function validateCursor(value: unknown): ValidationResult<EntityTimelineCursor | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') {
    return invalidParams('cursor must be a valid opaque pagination token');
  }

  const decoded = decodeEntityTimelineCursor(value);
  if (!decoded) {
    return invalidParams('cursor must be a valid opaque pagination token');
  }

  return { ok: true, value: decoded };
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
