import type {
  EntityType,
  FactSource,
  FeedbackSignal,
  MemoryFact,
  MemoryScope,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { MemorySearch } from '../../memory/memory-search.js';
import type { MemoryStore, UpdateFactInput } from '../../memory/memory-store.js';

const VALID_FEEDBACK_SIGNALS: FeedbackSignal[] = ['used', 'irrelevant', 'outdated'];

type MemoryFactRoutesOptions = {
  memorySearch: Pick<MemorySearch, 'search'>;
  memoryStore: Pick<
    MemoryStore,
    | 'addFact'
    | 'getFact'
    | 'invalidateFact'
    | 'listEdges'
    | 'listFacts'
    | 'recordFeedback'
    | 'updateFact'
  >;
};

const DEFAULT_LIMIT = 50;

const DEFAULT_SOURCE: FactSource = {
  session_id: null,
  agent_id: null,
  machine_id: null,
  turn_index: null,
  extraction_method: 'manual',
};

export const memoryFactRoutes: FastifyPluginAsync<MemoryFactRoutesOptions> = async (app, opts) => {
  const { memorySearch, memoryStore } = opts;

  app.get<{
    Querystring: {
      q?: string;
      scope?: MemoryScope;
      entityType?: EntityType;
      sessionId?: string;
      agentId?: string;
      machineId?: string;
      minConfidence?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/',
    { schema: { tags: ['memory'], summary: 'Search or list memory facts' } },
    async (request) => {
      const { q, scope, entityType, sessionId, agentId, machineId, minConfidence } = request.query;
      const limit = parseInteger(request.query.limit, DEFAULT_LIMIT);
      const offset = parseInteger(request.query.offset, 0);
      const minConfidenceValue = parseFloatValue(minConfidence);

      if (q && q.trim().length > 0) {
        const visibleScopes = scope ? [scope] : [];
        const results = await memorySearch.search({
          query: q,
          visibleScopes,
          limit: limit + offset,
          entityType,
        });
        const facts = results
          .map((result) => result.fact)
          .filter((fact) =>
            factMatchesFilters(fact, {
              sessionId,
              agentId,
              machineId,
              minConfidence: minConfidenceValue,
            }),
          );

        return {
          ok: true,
          facts: facts.slice(offset, offset + limit),
          total: facts.length,
        };
      }

      const facts = await memoryStore.listFacts({
        scope,
        entityType,
        sessionId,
        agentId,
        machineId,
        minConfidence: minConfidenceValue,
        limit,
        offset,
      });

      return {
        ok: true,
        facts,
        total: facts.length,
      };
    },
  );

  app.post<{
    Body: {
      content: string;
      scope: MemoryScope;
      entityType: EntityType;
      confidence?: number;
      source?: FactSource;
    };
  }>(
    '/',
    { schema: { tags: ['memory'], summary: 'Create a memory fact' } },
    async (request, reply) => {
      const { content, scope, entityType, confidence, source } = request.body;

      const fact = await memoryStore.addFact({
        content,
        scope,
        entity_type: entityType,
        confidence,
        source: source ?? DEFAULT_SOURCE,
      });

      return reply.code(201).send({ ok: true, fact });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['memory'], summary: 'Get a memory fact with its relationships' } },
    async (request, reply) => {
      const fact = await memoryStore.getFact(request.params.id);
      if (!fact) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Memory fact not found' });
      }

      const edges = await memoryStore.listEdges({ factId: request.params.id });
      return { ok: true, fact, edges };
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      scope?: MemoryScope;
      content?: string;
      entityType?: EntityType;
      confidence?: number;
      strength?: number;
    };
  }>(
    '/:id',
    { schema: { tags: ['memory'], summary: 'Update editable memory fact fields' } },
    async (request, reply) => {
      const patch: UpdateFactInput = {};
      if (request.body.scope) patch.scope = request.body.scope;
      if (request.body.content !== undefined) patch.content = request.body.content;
      if (request.body.entityType) patch.entity_type = request.body.entityType;
      if (request.body.confidence !== undefined) patch.confidence = request.body.confidence;
      if (request.body.strength !== undefined) patch.strength = request.body.strength;

      const fact = await memoryStore.updateFact(request.params.id, patch);
      if (!fact) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Memory fact not found' });
      }

      return { ok: true, fact };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['memory'], summary: 'Invalidate a memory fact' } },
    async (request) => {
      await memoryStore.invalidateFact(request.params.id);
      return { ok: true, id: request.params.id };
    },
  );

  app.post<{
    Params: { id: string };
    Body: { signal: string };
  }>(
    '/:id/feedback',
    { schema: { tags: ['memory'], summary: 'Record feedback signal for a memory fact' } },
    async (request, reply) => {
      const { signal } = request.body;

      if (!signal || !VALID_FEEDBACK_SIGNALS.includes(signal as FeedbackSignal)) {
        return reply.code(400).send({
          error: 'INVALID_SIGNAL',
          message: `signal must be one of: ${VALID_FEEDBACK_SIGNALS.join(', ')}`,
        });
      }

      const fact = await memoryStore.recordFeedback(request.params.id, signal as FeedbackSignal);
      if (!fact) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Memory fact not found' });
      }

      return { ok: true, fact };
    },
  );
};

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatValue(value: string | undefined): number | undefined {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : undefined;
}

function factMatchesFilters(
  fact: MemoryFact,
  filters: {
    sessionId?: string;
    agentId?: string;
    machineId?: string;
    minConfidence?: number;
  },
): boolean {
  if (filters.sessionId && fact.source.session_id !== filters.sessionId) {
    return false;
  }
  if (filters.agentId && fact.source.agent_id !== filters.agentId) {
    return false;
  }
  if (filters.machineId && fact.source.machine_id !== filters.machineId) {
    return false;
  }
  if (filters.minConfidence !== undefined && fact.confidence < filters.minConfidence) {
    return false;
  }
  return true;
}
