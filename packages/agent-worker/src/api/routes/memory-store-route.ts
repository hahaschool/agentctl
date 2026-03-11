// ---------------------------------------------------------------------------
// Worker-side memory_store MCP tool route
//
// Proxies fact storage to the control-plane
// POST /api/memory/facts
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

const VALID_ENTITY_TYPES = [
  'code_artifact',
  'decision',
  'pattern',
  'error',
  'person',
  'concept',
  'preference',
  'skill',
  'experience',
  'principle',
  'question',
] as const;

type MemoryStoreRouteOptions = FastifyPluginOptions & {
  controlPlaneUrl: string;
  logger: Logger;
};

type StoreBody = {
  content: string;
  scope: string;
  entityType: string;
  confidence?: number;
  tags?: string[];
};

export async function memoryStoreRoutes(
  app: FastifyInstance,
  opts: MemoryStoreRouteOptions,
): Promise<void> {
  const { controlPlaneUrl, logger } = opts;

  app.post(
    '/memory-store',
    async (request: FastifyRequest<{ Body: StoreBody }>, reply: FastifyReply) => {
      const body = request.body as StoreBody;

      if (!body.content || typeof body.content !== 'string' || body.content.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'content must be a non-empty string',
        });
      }

      if (!body.scope || typeof body.scope !== 'string' || body.scope.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'scope must be a non-empty string',
        });
      }

      if (
        !body.entityType ||
        !(VALID_ENTITY_TYPES as readonly string[]).includes(body.entityType)
      ) {
        return reply.code(400).send({
          error: 'INVALID_ENTITY_TYPE',
          message: `entityType must be one of: ${VALID_ENTITY_TYPES.join(', ')}`,
        });
      }

      if (
        body.confidence !== undefined &&
        (typeof body.confidence !== 'number' || body.confidence < 0 || body.confidence > 1)
      ) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'confidence must be a number between 0 and 1',
        });
      }

      const url = `${controlPlaneUrl}/api/memory/facts`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: body.content.trim(),
            scope: body.scope.trim(),
            entityType: body.entityType,
            confidence: body.confidence,
            source: {
              session_id: null,
              agent_id: null,
              machine_id: null,
              turn_index: null,
              extraction_method: 'manual',
            },
          }),
        });
      } catch (error: unknown) {
        logger.error({ err: error }, 'Failed to reach control-plane for memory store');
        return reply.code(503).send({
          error: 'MEMORY_STORE_UNREACHABLE',
          message: 'Control-plane unreachable while storing memory fact',
        });
      }

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({}));
        logger.warn(
          { status: response.status, body: responseBody },
          'Control-plane returned error for memory store',
        );
        return reply.code(response.status).send(responseBody);
      }

      const result = (await response.json()) as Record<string, unknown>;
      return reply.code(201).send({ ok: true, ...result });
    },
  );
}
