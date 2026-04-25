// ---------------------------------------------------------------------------
// Worker-side memory_timeline MCP tool route
//
// First contract slice: validate the timeline request locally, proxy the
// bounded read to the control-plane timeline endpoint, and normalize empty
// control-plane responses into a stable empty contract for MCP callers.
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import { extractMcpArguments } from './mcp-arguments.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_ENTITY_ID_LENGTH = 128;
const SAFE_ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MEMORY_TIMELINE_TIMEOUT_MS = 5_000;
const ENTITY_TIMELINE_LIMITATIONS = [
  'This slice resolves `entity` as `memory_facts.id`; canonical entity joins are not wired yet.',
  'Timeline windows are derived from `memory_facts.valid_from` / `valid_until` because `memory_edges` does not yet store temporal fields.',
] as const;
const TIMELINE_CURSOR_PREFIX = 'mtl_v1:';

type MemoryTimelineRouteOptions = FastifyPluginOptions & {
  controlPlaneUrl: string;
  logger: Logger;
};

type MemoryTimelineRequestBody = {
  entity?: string;
  asOf?: string;
  as_of?: string;
  limit?: number;
  cursor?: string;
};

type MemoryTimelineResponseBody = {
  ok: true;
  entity: {
    requested_id: string;
    resolved_fact_id: string;
    content_preview: string;
    valid_from: string;
    valid_until: string | null;
    confidence: number | null;
    active_at_as_of: boolean | null;
    canonicalization_mode: 'fact-id-fallback';
  };
  as_of: string | null;
  limit: number;
  next_cursor: string | null;
  events: unknown[];
  limitations: readonly string[];
};

type ValidationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        error: 'INVALID_PARAMS';
        message: string;
      };
    };

export async function memoryTimelineRoutes(
  app: FastifyInstance,
  opts: MemoryTimelineRouteOptions,
): Promise<void> {
  const { controlPlaneUrl, logger } = opts;

  app.post(
    '/memory-timeline',
    async (request: FastifyRequest<{ Body: MemoryTimelineRequestBody }>, reply: FastifyReply) => {
      const extracted = extractMcpArguments<MemoryTimelineRequestBody>(request.body);
      if (!extracted.ok) {
        return reply.code(400).send(extracted.error);
      }

      const body = extracted.body;
      const entity = normalizeEntity(body?.entity);
      if (!entity) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'entity must be a non-empty safe id',
        });
      }

      const asOfValidation = validateAliasedAsOf(body);
      if (!asOfValidation.ok) {
        return reply.code(400).send(asOfValidation.error);
      }

      const limitValidation = validateLimit(body?.limit);
      if (!limitValidation.ok) {
        return reply.code(400).send(limitValidation.error);
      }

      const cursorValidation = validateCursor(body?.cursor);
      if (!cursorValidation.ok) {
        return reply.code(400).send(cursorValidation.error);
      }

      const params = new URLSearchParams({
        entity,
        limit: String(limitValidation.value),
      });
      if (cursorValidation.value !== undefined) {
        params.set('cursor', cursorValidation.value);
      }
      if (asOfValidation.value !== undefined) {
        params.set('as_of', asOfValidation.value);
      }

      const url = `${controlPlaneUrl}/api/memory/timeline?${params.toString()}`;
      const startedAt = Date.now();

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(MEMORY_TIMELINE_TIMEOUT_MS),
        });
      } catch (error: unknown) {
        logger.error(
          { err: error, entity, limit: limitValidation.value, asOf: asOfValidation.value },
          'Failed to reach control-plane for memory timeline',
        );
        return reply.code(503).send({
          error: 'MEMORY_TIMELINE_UNREACHABLE',
          message: 'Control-plane unreachable while reading memory timeline',
        });
      }

      if (response.status === 404 || response.status === 204 || response.status === 501) {
        logger.debug(
          {
            entity,
            limit: limitValidation.value,
            asOf: asOfValidation.value,
            status: response.status,
            durationMs: Date.now() - startedAt,
          },
          'memory_timeline returned empty response contract',
        );
        return emptyTimelineResponse(entity, asOfValidation.value, limitValidation.value);
      }

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({}));
        logger.warn(
          {
            entity,
            limit: limitValidation.value,
            asOf: asOfValidation.value,
            status: response.status,
            body: responseBody,
            durationMs: Date.now() - startedAt,
          },
          'Control-plane returned error for memory timeline',
        );
        return reply.code(response.status).send(responseBody);
      }

      const responseBody = await response.json().catch(() => null);
      if (!isTimelineResponseBody(responseBody)) {
        logger.debug(
          {
            entity,
            limit: limitValidation.value,
            asOf: asOfValidation.value,
            durationMs: Date.now() - startedAt,
          },
          'memory_timeline successful response was empty; returning stable empty contract',
        );
        return emptyTimelineResponse(entity, asOfValidation.value, limitValidation.value);
      }

      logger.debug(
        {
          entity,
          limit: limitValidation.value,
          asOf: asOfValidation.value,
          eventCount: responseBody.events.length,
          hasNextCursor: responseBody.next_cursor !== null,
          durationMs: Date.now() - startedAt,
        },
        'memory_timeline complete',
      );
      return responseBody;
    },
  );
}

function emptyTimelineResponse(
  entity: string,
  asOf: string | undefined,
  limit: number,
): MemoryTimelineResponseBody {
  return {
    ok: true,
    entity: {
      requested_id: entity,
      resolved_fact_id: entity,
      content_preview: '',
      valid_from: '',
      valid_until: null,
      confidence: null,
      active_at_as_of: null,
      canonicalization_mode: 'fact-id-fallback',
    },
    as_of: asOf ?? null,
    limit,
    next_cursor: null,
    events: [],
    limitations: ENTITY_TIMELINE_LIMITATIONS,
  };
}

function normalizeEntity(value: unknown): string | null {
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

function validateAliasedAsOf(
  body: Pick<MemoryTimelineRequestBody, 'as_of' | 'asOf'> | undefined,
): ValidationResult<string | undefined> {
  const asOfResult = validateAsOf(body?.as_of, 'as_of');
  if (!asOfResult.ok) {
    return asOfResult;
  }

  const asOfAliasResult = validateAsOf(body?.asOf, 'asOf');
  if (!asOfAliasResult.ok) {
    return asOfAliasResult;
  }

  if (
    asOfResult.value !== undefined &&
    asOfAliasResult.value !== undefined &&
    asOfResult.value !== asOfAliasResult.value
  ) {
    return invalidParams('as_of and asOf must match when both are provided');
  }

  return {
    ok: true,
    value: asOfResult.value ?? asOfAliasResult.value,
  };
}

function validateAsOf(
  value: unknown,
  parameterName: 'as_of' | 'asOf',
): ValidationResult<string | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') {
    return invalidParams(`${parameterName} must be a valid timestamp string`);
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return invalidParams(`${parameterName} must be a valid timestamp string`);
  }

  return { ok: true, value: new Date(timestamp).toISOString() };
}

function validateLimit(value: unknown): ValidationResult<number> {
  if (value === undefined) {
    return { ok: true, value: DEFAULT_LIMIT };
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    return invalidParams(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }

  return { ok: true, value };
}

function validateCursor(value: unknown): ValidationResult<string | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string' || !decodeTimelineCursor(value)) {
    return invalidParams('cursor must be a valid opaque pagination token');
  }

  return { ok: true, value };
}

function invalidParams(message: string): ValidationResult<never> {
  return {
    ok: false,
    error: {
      error: 'INVALID_PARAMS',
      message,
    },
  };
}

function decodeTimelineCursor(value: string): {
  effectiveFrom: string;
  edgeCreatedAt: string;
  edgeId: string;
} | null {
  if (!value.startsWith(TIMELINE_CURSOR_PREFIX)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(value.slice(TIMELINE_CURSOR_PREFIX.length), 'base64url').toString('utf8'),
    ) as Partial<{
      effectiveFrom: string;
      edgeCreatedAt: string;
      edgeId: string;
    }>;

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

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function isTimelineResponseBody(value: unknown): value is MemoryTimelineResponseBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.ok === true && Array.isArray(record.events) && Array.isArray(record.limitations);
}
