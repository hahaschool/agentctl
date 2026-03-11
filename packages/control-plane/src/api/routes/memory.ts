import type { MemoryFact, MemorySearchResult } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { Mem0Client, MemoryEntry } from '../../memory/mem0-client.js';
import type { MemorySearch } from '../../memory/memory-search.js';
import type { MemoryStore } from '../../memory/memory-store.js';

type MemoryRouteResult = MemoryEntry & {
  score?: number;
  sourcePath?: MemorySearchResult['source_path'];
};

type PostgresMemoryRoutesOptions = {
  memorySearch: Pick<MemorySearch, 'search'>;
  memoryStore: Pick<MemoryStore, 'addFact' | 'listFacts' | 'deleteFact'>;
  mem0Client?: undefined;
};

type Mem0MemoryRoutesOptions = {
  mem0Client: Mem0Client;
  memorySearch?: undefined;
  memoryStore?: undefined;
};

export type MemoryRoutesOptions = PostgresMemoryRoutesOptions | Mem0MemoryRoutesOptions;

export const memoryRoutes: FastifyPluginAsync<MemoryRoutesOptions> = async (app, opts) => {
  const pgBackend =
    opts.memorySearch && opts.memoryStore
      ? {
          memorySearch: opts.memorySearch,
          memoryStore: opts.memoryStore,
        }
      : null;
  const mem0Backend = opts.mem0Client ?? null;

  app.post<{
    Body: { query: string; agentId?: string; limit?: number };
  }>(
    '/search',
    { schema: { tags: ['memory'], summary: 'Search memories by semantic query' } },
    async (request, reply) => {
      const { query, agentId, limit } = request.body;

      if (!query || typeof query !== 'string') {
        return reply
          .code(400)
          .send({ error: 'INVALID_PARAMS', message: 'A non-empty "query" string is required' });
      }

      try {
        if (pgBackend) {
          const results = await pgBackend.memorySearch.search({
            query,
            visibleScopes: resolveVisibleScopes(agentId),
            limit,
          });
          return { results: results.map(normalizeSearchResult) };
        }

        const result = await requireMem0Backend(mem0Backend).search({ query, agentId, limit });
        return { results: result.results.map(normalizeMemoryEntry) };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply
          .code(500)
          .send({ error: 'SEARCH_FAILED', message: 'Failed to search memories' });
      }
    },
  );

  app.post<{
    Body: {
      messages: Array<{ role: string; content: string }>;
      agentId?: string;
      metadata?: Record<string, unknown>;
    };
  }>(
    '/add',
    { schema: { tags: ['memory'], summary: 'Add a new memory' } },
    async (request, reply) => {
      const { messages, agentId, metadata } = request.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return reply
          .code(400)
          .send({ error: 'INVALID_PARAMS', message: 'A non-empty "messages" array is required' });
      }

      try {
        if (pgBackend) {
          const fact = await pgBackend.memoryStore.addFact({
            scope: agentId ? `agent:${agentId}` : 'global',
            content: formatMessages(messages),
            entity_type: 'concept',
            source: {
              session_id: stringValue(metadata, 'sessionId') ?? stringValue(metadata, 'runId'),
              agent_id: agentId ?? null,
              machine_id: stringValue(metadata, 'machineId'),
              turn_index: null,
              extraction_method: 'manual',
            },
            confidence: 0.8,
          });

          return { ok: true, results: [normalizeFact(fact)] };
        }

        const result = await requireMem0Backend(mem0Backend).add({ messages, agentId, metadata });
        return { ok: true, results: result.results.map(normalizeMemoryEntry) };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({ error: 'ADD_FAILED', message: 'Failed to add memory' });
      }
    },
  );

  app.get<{
    Querystring: { userId?: string; agentId?: string };
  }>(
    '/',
    { schema: { tags: ['memory'], summary: 'List all memories' } },
    async (request, reply) => {
      const { userId, agentId } = request.query;

      try {
        if (pgBackend) {
          const results = await pgBackend.memoryStore.listFacts({
            visibleScopes: resolveVisibleScopes(agentId),
          });
          return { results: results.map(normalizeFact) };
        }

        const result = await requireMem0Backend(mem0Backend).getAll(userId, agentId);
        return { results: result.results.map(normalizeMemoryEntry) };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({ error: 'LIST_FAILED', message: 'Failed to list memories' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['memory'], summary: 'Delete a memory by ID' } },
    async (request, reply) => {
      const memoryId = request.params.id;

      try {
        if (pgBackend) {
          await pgBackend.memoryStore.deleteFact(memoryId);
        } else {
          await requireMem0Backend(mem0Backend).delete(memoryId);
        }

        return { ok: true, memoryId };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message, memoryId });
        }
        return reply
          .code(500)
          .send({ error: 'DELETE_FAILED', message: 'Failed to delete memory', memoryId });
      }
    },
  );
};

function formatMessages(messages: Array<{ role: string; content: string }>): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join('\n');
}

function resolveVisibleScopes(agentId?: string): string[] {
  return agentId ? [`agent:${agentId}`, 'global'] : ['global'];
}

function stringValue(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function requireMem0Backend(mem0Backend: Mem0Client | null): Mem0Client {
  if (mem0Backend) {
    return mem0Backend;
  }

  throw new Error('Mem0 backend is not configured');
}

function normalizeSearchResult(result: MemorySearchResult): MemoryRouteResult {
  return {
    ...normalizeFact(result.fact),
    score: result.score,
    sourcePath: result.source_path,
  };
}

function normalizeFact(fact: MemoryFact): MemoryRouteResult {
  return {
    id: fact.id,
    memory: fact.content,
    userId: null,
    agentId: fact.source.agent_id,
    metadata: {
      scope: fact.scope,
      entityType: fact.entity_type,
      source: fact.source,
    },
    createdAt: fact.created_at,
    updatedAt: fact.accessed_at,
  };
}

function normalizeMemoryEntry(entry: MemoryEntry): MemoryRouteResult {
  return {
    ...entry,
  };
}
