// ---------------------------------------------------------------------------
// Worker-side memory_search MCP tool route
//
// Proxies hybrid search (vector + BM25 + graph) to the control-plane
// GET /api/memory/facts?q=...&scope=...&limit=...
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

type MemorySearchRouteOptions = FastifyPluginOptions & {
  controlPlaneUrl: string;
  logger: Logger;
};

type SearchBody = {
  query: string;
  scope?: string;
  limit?: number;
  tags?: string[];
};

export async function memorySearchRoutes(
  app: FastifyInstance,
  opts: MemorySearchRouteOptions,
): Promise<void> {
  const { controlPlaneUrl, logger } = opts;

  app.post(
    '/memory-search',
    async (request: FastifyRequest<{ Body: SearchBody }>, reply: FastifyReply) => {
      const body = request.body as SearchBody;
      const query = body?.query;

      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'query must be a non-empty string',
        });
      }

      const limit = body?.limit;
      if (limit !== undefined && (typeof limit !== 'number' || limit < 1 || limit > 200)) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'limit must be a number between 1 and 200',
        });
      }

      const params = new URLSearchParams({ q: query.trim() });
      if (body.scope) {
        params.set('scope', body.scope);
      }
      if (limit !== undefined) {
        params.set('limit', String(limit));
      }

      const url = `${controlPlaneUrl}/api/memory/facts?${params.toString()}`;

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error: unknown) {
        logger.error({ err: error, query }, 'Failed to reach control-plane for memory search');
        return reply.code(503).send({
          error: 'MEMORY_SEARCH_UNREACHABLE',
          message: 'Control-plane unreachable while performing memory search',
        });
      }

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({}));
        logger.warn(
          { query, status: response.status, body: responseBody },
          'Control-plane returned error for memory search',
        );
        return reply.code(response.status).send(responseBody);
      }

      const result = (await response.json()) as Record<string, unknown>;

      // Filter by tags client-side if provided (control-plane doesn't support tag filtering)
      if (body.tags && Array.isArray(body.tags) && body.tags.length > 0) {
        const tagSet = new Set(body.tags);
        const facts = Array.isArray(result.facts) ? result.facts : [];
        const filtered = (facts as Array<Record<string, unknown>>).filter((fact) => {
          const factTags = Array.isArray(fact.tags) ? (fact.tags as string[]) : [];
          return factTags.some((tag) => tagSet.has(tag));
        });
        return { ok: true, facts: filtered, total: filtered.length };
      }

      return { ok: true, ...result };
    },
  );
}
