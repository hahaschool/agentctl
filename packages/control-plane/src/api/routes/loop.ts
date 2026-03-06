import { DEFAULT_WORKER_PORT } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { MachineRegistryLike } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { proxyWorkerRequest } from '../proxy-worker-request.js';
import { resolveWorkerUrl } from '../resolve-worker-url.js';

const PROXY_TIMEOUT_MS = 30_000;

export type LoopRoutesOptions = {
  registry: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry | null;
  workerPort?: number;
};

/**
 * Fastify plugin that registers loop management proxy routes.
 *
 * All requests are proxied to the worker machine running the agent.
 */
export const loopProxyRoutes: FastifyPluginAsync<LoopRoutesOptions> = async (app, opts) => {
  const { registry, dbRegistry, workerPort = DEFAULT_WORKER_PORT } = opts;

  // POST /api/agents/:id/loop — Start a loop (proxy to worker)
  app.post<{
    Params: { id: string };
    Body: { prompt: string; config: Record<string, unknown> };
    Querystring: { workerUrl?: string; machineId?: string };
  }>(
    '/:id/loop',
    { schema: { tags: ['agents'], summary: 'Start an agent loop' } },
    async (request, reply) => {
      const agentId = request.params.id;

      const resolved = await resolveWorkerUrl(agentId, request.query, {
        registry,
        dbRegistry,
        workerPort,
      });
      if (!resolved.ok) {
        return reply
          .status(resolved.status)
          .send({ error: resolved.error, message: resolved.message });
      }

      const result = await proxyWorkerRequest({
        workerBaseUrl: resolved.url,
        path: `/api/agents/${encodeURIComponent(agentId)}/loop`,
        method: 'POST',
        body: request.body,
        timeoutMs: PROXY_TIMEOUT_MS,
      });
      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      return reply.status(result.status).send(result.data);
    },
  );

  // PUT /api/agents/:id/loop — Pause or resume (proxy to worker)
  app.put<{
    Params: { id: string };
    Body: { action: string };
    Querystring: { workerUrl?: string; machineId?: string };
  }>(
    '/:id/loop',
    { schema: { tags: ['agents'], summary: 'Pause or resume an agent loop' } },
    async (request, reply) => {
      const agentId = request.params.id;
      const { action } = request.body;

      if (action !== 'pause' && action !== 'resume') {
        return reply.status(400).send({
          error: 'INVALID_ACTION',
          message: `Invalid loop action "${String(action)}". Must be "pause" or "resume".`,
        });
      }

      const resolved = await resolveWorkerUrl(agentId, request.query, {
        registry,
        dbRegistry,
        workerPort,
      });
      if (!resolved.ok) {
        return reply
          .status(resolved.status)
          .send({ error: resolved.error, message: resolved.message });
      }

      const result = await proxyWorkerRequest({
        workerBaseUrl: resolved.url,
        path: `/api/agents/${encodeURIComponent(agentId)}/loop`,
        method: 'PUT',
        body: request.body,
        timeoutMs: PROXY_TIMEOUT_MS,
      });
      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      return reply.status(result.status).send(result.data);
    },
  );

  // DELETE /api/agents/:id/loop — Stop loop (proxy to worker)
  app.delete<{
    Params: { id: string };
    Querystring: { workerUrl?: string; machineId?: string };
  }>(
    '/:id/loop',
    { schema: { tags: ['agents'], summary: 'Stop an agent loop' } },
    async (request, reply) => {
      const agentId = request.params.id;

      const resolved = await resolveWorkerUrl(agentId, request.query, {
        registry,
        dbRegistry,
        workerPort,
      });
      if (!resolved.ok) {
        return reply
          .status(resolved.status)
          .send({ error: resolved.error, message: resolved.message });
      }

      const result = await proxyWorkerRequest({
        workerBaseUrl: resolved.url,
        path: `/api/agents/${encodeURIComponent(agentId)}/loop`,
        method: 'DELETE',
        timeoutMs: PROXY_TIMEOUT_MS,
      });
      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      return reply.status(result.status).send(result.data);
    },
  );

  // GET /api/agents/:id/loop — Get loop status (proxy to worker)
  app.get<{
    Params: { id: string };
    Querystring: { workerUrl?: string; machineId?: string };
  }>(
    '/:id/loop',
    { schema: { tags: ['agents'], summary: 'Get agent loop status' } },
    async (request, reply) => {
      const agentId = request.params.id;

      const resolved = await resolveWorkerUrl(agentId, request.query, {
        registry,
        dbRegistry,
        workerPort,
      });
      if (!resolved.ok) {
        return reply
          .status(resolved.status)
          .send({ error: resolved.error, message: resolved.message });
      }

      const result = await proxyWorkerRequest({
        workerBaseUrl: resolved.url,
        path: `/api/agents/${encodeURIComponent(agentId)}/loop`,
        method: 'GET',
        timeoutMs: PROXY_TIMEOUT_MS,
      });
      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      return reply.status(result.status).send(result.data);
    },
  );
};
