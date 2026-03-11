// ---------------------------------------------------------------------------
// Worker-side memory_recall MCP tool route
//
// Performs graph traversal (BFS up to maxHops) from a seed fact, fetching
// related facts via the control-plane edges + facts endpoints.
//
// GET /api/memory/facts/:id         — get the seed fact + its direct edges
// GET /api/memory/edges?factId=...  — get edges for a given fact
// GET /api/memory/facts/:id         — fetch each discovered neighbour
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

const DEFAULT_MAX_HOPS = 2;
const MAX_ALLOWED_HOPS = 4;

type MemoryRecallRouteOptions = FastifyPluginOptions & {
  controlPlaneUrl: string;
  logger: Logger;
};

type RecallBody = {
  factId: string;
  maxHops?: number;
};

type FactRecord = Record<string, unknown>;
type EdgeRecord = { source_fact_id: string; target_fact_id: string } & Record<string, unknown>;

async function fetchFact(baseUrl: string, factId: string): Promise<FactRecord | null> {
  try {
    const response = await fetch(`${baseUrl}/api/memory/facts/${encodeURIComponent(factId)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as Record<string, unknown>;
    return (json.fact as FactRecord | undefined) ?? null;
  } catch {
    return null;
  }
}

async function fetchEdgesForFact(baseUrl: string, factId: string): Promise<EdgeRecord[]> {
  try {
    const params = new URLSearchParams({ factId });
    const response = await fetch(`${baseUrl}/api/memory/edges?${params.toString()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) return [];
    const json = (await response.json()) as Record<string, unknown>;
    return Array.isArray(json.edges) ? (json.edges as EdgeRecord[]) : [];
  } catch {
    return [];
  }
}

export async function memoryRecallRoutes(
  app: FastifyInstance,
  opts: MemoryRecallRouteOptions,
): Promise<void> {
  const { controlPlaneUrl, logger } = opts;

  app.post(
    '/memory-recall',
    async (request: FastifyRequest<{ Body: RecallBody }>, reply: FastifyReply) => {
      const body = request.body as RecallBody;
      const factId = body?.factId;

      if (!factId || typeof factId !== 'string' || factId.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: 'factId must be a non-empty string',
        });
      }

      const maxHops = body?.maxHops ?? DEFAULT_MAX_HOPS;
      if (typeof maxHops !== 'number' || maxHops < 1 || maxHops > MAX_ALLOWED_HOPS) {
        return reply.code(400).send({
          error: 'INVALID_PARAMS',
          message: `maxHops must be a number between 1 and ${MAX_ALLOWED_HOPS}`,
        });
      }

      // BFS traversal
      const visited = new Set<string>([factId]);
      const relatedFacts: FactRecord[] = [];
      let frontier: string[] = [factId];

      for (let hop = 0; hop < maxHops; hop++) {
        const nextFrontier: string[] = [];

        const edgeBatches = await Promise.all(
          frontier.map((id) => fetchEdgesForFact(controlPlaneUrl, id)),
        );

        for (const edges of edgeBatches) {
          for (const edge of edges) {
            const neighbourId =
              edge.source_fact_id === frontier[edgeBatches.indexOf(edges)]
                ? edge.target_fact_id
                : edge.source_fact_id;

            if (!visited.has(neighbourId)) {
              visited.add(neighbourId);
              nextFrontier.push(neighbourId);
            }
          }
        }

        if (nextFrontier.length === 0) break;

        // Fetch all neighbour facts in parallel
        const fetchedFacts = await Promise.all(
          nextFrontier.map((id) => fetchFact(controlPlaneUrl, id)),
        );

        for (const fact of fetchedFacts) {
          if (fact) {
            relatedFacts.push(fact);
          }
        }

        frontier = nextFrontier;
      }

      logger.debug(
        { seedFactId: factId, maxHops, relatedCount: relatedFacts.length },
        'memory_recall BFS complete',
      );

      return { ok: true, seedFactId: factId, maxHops, facts: relatedFacts };
    },
  );
}
