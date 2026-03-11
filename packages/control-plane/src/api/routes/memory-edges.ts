import type { EntityType, MemoryScope, RelationType } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { MemoryStore } from '../../memory/memory-store.js';

type MemoryEdgeRoutesOptions = {
  memoryStore: Pick<MemoryStore, 'addEdge' | 'deleteEdge' | 'listEdges'>;
};

type MemoryGraphRoutesOptions = {
  memoryStore: Pick<MemoryStore, 'listEdges' | 'listFacts'>;
};

export const memoryEdgeRoutes: FastifyPluginAsync<MemoryEdgeRoutesOptions> = async (app, opts) => {
  const { memoryStore } = opts;

  app.get<{
    Querystring: { sourceFactId?: string; targetFactId?: string };
  }>('/', { schema: { tags: ['memory'], summary: 'List memory edges' } }, async (request) => {
    const edges = await memoryStore.listEdges({
      sourceFactId: request.query.sourceFactId,
      targetFactId: request.query.targetFactId,
    });

    return { ok: true, edges };
  });

  app.post<{
    Body: {
      sourceFactId: string;
      targetFactId: string;
      relation: RelationType;
      weight?: number;
    };
  }>('/', { schema: { tags: ['memory'], summary: 'Create a memory edge' } }, async (request, reply) => {
    const edge = await memoryStore.addEdge({
      source_fact_id: request.body.sourceFactId,
      target_fact_id: request.body.targetFactId,
      relation: request.body.relation,
      weight: request.body.weight,
    });

    return reply.code(201).send({ ok: true, edge });
  });

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['memory'], summary: 'Delete a memory edge' } },
    async (request) => {
      await memoryStore.deleteEdge(request.params.id);
      return { ok: true, id: request.params.id };
    },
  );
};

export const memoryGraphRoutes: FastifyPluginAsync<MemoryGraphRoutesOptions> = async (app, opts) => {
  const { memoryStore } = opts;

  app.get<{
    Querystring: {
      scope?: MemoryScope;
      entityType?: EntityType;
      limit?: string;
    };
  }>('/', { schema: { tags: ['memory'], summary: 'List graph nodes and edges' } }, async (request) => {
    const limit = parseInteger(request.query.limit, 200);
    const nodes = await memoryStore.listFacts({
      scope: request.query.scope,
      entityType: request.query.entityType,
      limit,
      offset: 0,
    });
    const edges = await memoryStore.listEdges({ factIds: nodes.map((node) => node.id) });

    return {
      ok: true,
      nodes,
      edges,
    };
  });
};

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
