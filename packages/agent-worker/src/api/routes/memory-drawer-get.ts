// ---------------------------------------------------------------------------
// Worker-side memory_drawer_get MCP tool route
//
// First contract slice: lock the `{ drawer_id }` request schema, validate the
// drawer_id is a non-empty safe identifier, and return a typed 404 with
// `DRAWER_NOT_FOUND` when the control-plane reports no such drawer. Full
// drawer fetch is deferred to the control-plane follow-up in Phase 4,
// Step 6 of docs/plans/2026-04-15-mempalace-inspired-memory-evolution-plan.md.
// ---------------------------------------------------------------------------

import type { MemoryDrawerGetRequest, MemoryDrawerGetResponse } from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import { extractMcpArguments } from './mcp-arguments.js';

const MAX_DRAWER_ID_LENGTH = 128;
const SAFE_DRAWER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MEMORY_DRAWER_GET_TIMEOUT_MS = 5_000;
const REQUIRED_DRAWER_FIELDS = [
  'id',
  'scope',
  'content',
  'contentSha256',
  'embeddingModel',
] as const;

type MemoryDrawerGetRouteOptions = FastifyPluginOptions & {
  controlPlaneUrl: string;
  logger: Logger;
};

type DrawerGetResponseBody = Record<string, unknown>;

export async function memoryDrawerGetRoutes(
  app: FastifyInstance,
  opts: MemoryDrawerGetRouteOptions,
): Promise<void> {
  const { controlPlaneUrl, logger } = opts;

  app.post(
    '/memory-drawer-get',
    async (request: FastifyRequest<{ Body: MemoryDrawerGetRequest }>, reply: FastifyReply) => {
      const extracted = extractMcpArguments<MemoryDrawerGetRequest>(request.body);
      if (!extracted.ok) {
        return reply.code(400).send(extracted.error);
      }

      const body = extracted.body;
      const drawerId = normalizeDrawerId(body?.drawer_id);
      if (!drawerId) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'drawer_id must be a non-empty safe identifier',
        });
      }

      const url = `${controlPlaneUrl}/api/memory/drawers/${encodeURIComponent(drawerId)}`;

      const startedAt = Date.now();
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(MEMORY_DRAWER_GET_TIMEOUT_MS),
        });
      } catch (error: unknown) {
        logger.error(
          { err: error, drawerId },
          'Failed to reach control-plane for memory drawer get',
        );
        return reply.code(503).send({
          error: 'MEMORY_DRAWER_GET_UNREACHABLE',
          message: 'Control-plane unreachable while fetching memory drawer',
        });
      }

      // Cold-start contract: whether the endpoint is not yet implemented (501)
      // or the drawer doesn't exist (404/204), we return the same typed 404
      // shape so MCP callers can adopt the tool before the control-plane work
      // lands.
      if (response.status === 404 || response.status === 501 || response.status === 204) {
        logger.debug(
          {
            drawerId,
            status: response.status,
            durationMs: Date.now() - startedAt,
          },
          'memory_drawer_get returned not-found contract',
        );
        return reply.code(404).send({
          error: 'DRAWER_NOT_FOUND',
          message: `Drawer "${drawerId}" was not found`,
        });
      }

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({}));
        logger.warn(
          {
            drawerId,
            status: response.status,
            body: responseBody,
            durationMs: Date.now() - startedAt,
          },
          'Control-plane returned error for memory drawer get',
        );
        return reply.code(response.status).send(responseBody);
      }

      const result = (await response.json().catch(() => ({}))) as DrawerGetResponseBody;
      const drawerRecord = isRecord(result.drawer) ? result.drawer : result;
      if (!hasRequiredDrawerFields(drawerRecord)) {
        logger.warn(
          { drawerId, durationMs: Date.now() - startedAt },
          'Control-plane drawer response missing required fields',
        );
        return reply.code(404).send({
          error: 'DRAWER_NOT_FOUND',
          message: `Drawer "${drawerId}" was not found`,
        });
      }

      logger.debug({ drawerId, durationMs: Date.now() - startedAt }, 'memory_drawer_get complete');

      const payload = { ok: true, drawer: drawerRecord } as unknown as MemoryDrawerGetResponse;
      return payload;
    },
  );
}

function normalizeDrawerId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

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

function hasRequiredDrawerFields(record: Record<string, unknown>): boolean {
  return REQUIRED_DRAWER_FIELDS.every(
    (field) => typeof record[field] === 'string' && (record[field] as string).length > 0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
