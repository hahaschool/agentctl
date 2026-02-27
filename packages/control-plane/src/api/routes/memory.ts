import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { Mem0Client } from '../../memory/mem0-client.js';

export type MemoryRoutesOptions = {
  mem0Client: Mem0Client;
};

export const memoryRoutes: FastifyPluginAsync<MemoryRoutesOptions> = async (app, opts) => {
  const { mem0Client } = opts;

  // ---------------------------------------------------------------------------
  // Search memories by semantic query
  // ---------------------------------------------------------------------------

  app.post<{
    Body: { query: string; agentId?: string; limit?: number };
  }>('/search', async (request, reply) => {
    const { query, agentId, limit } = request.body;

    if (!query || typeof query !== 'string') {
      return reply.code(400).send({ error: 'A non-empty "query" string is required' });
    }

    try {
      const result = await mem0Client.search({ query, agentId, limit });

      return { results: result.results };
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        return reply.code(502).send({ error: error.message, code: error.code });
      }
      return reply.code(500).send({ error: 'Failed to search memories' });
    }
  });

  // ---------------------------------------------------------------------------
  // Add a new memory
  // ---------------------------------------------------------------------------

  app.post<{
    Body: {
      messages: Array<{ role: string; content: string }>;
      agentId?: string;
      metadata?: Record<string, unknown>;
    };
  }>('/add', async (request, reply) => {
    const { messages, agentId, metadata } = request.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: 'A non-empty "messages" array is required' });
    }

    try {
      const result = await mem0Client.add({ messages, agentId, metadata });

      return { ok: true, results: result.results };
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        return reply.code(502).send({ error: error.message, code: error.code });
      }
      return reply.code(500).send({ error: 'Failed to add memory' });
    }
  });

  // ---------------------------------------------------------------------------
  // List all memories (optionally filtered by userId or agentId)
  // ---------------------------------------------------------------------------

  app.get<{
    Querystring: { userId?: string; agentId?: string };
  }>('/', async (request, reply) => {
    const { userId, agentId } = request.query;

    try {
      const result = await mem0Client.getAll(userId, agentId);

      return { results: result.results };
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        return reply.code(502).send({ error: error.message, code: error.code });
      }
      return reply.code(500).send({ error: 'Failed to list memories' });
    }
  });

  // ---------------------------------------------------------------------------
  // Delete a specific memory by ID
  // ---------------------------------------------------------------------------

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const memoryId = request.params.id;

    try {
      await mem0Client.delete(memoryId);

      return { ok: true, memoryId };
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        return reply.code(502).send({ error: error.message, code: error.code, memoryId });
      }
      return reply.code(500).send({ error: 'Failed to delete memory', memoryId });
    }
  });
};
