import { DEFAULT_WORKER_PORT } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { MachineRegistryLike } from '../../registry/agent-registry.js';
import { LOOP_PROXY_TIMEOUT_MS } from '../constants.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { proxyWorkerRequest } from '../proxy-worker-request.js';
import { resolveWorkerUrl } from '../resolve-worker-url.js';

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
    Body: { prompt?: unknown; config?: unknown };
    Querystring: { workerUrl?: string; machineId?: string };
  }>(
    '/:id/loop',
    { schema: { tags: ['agents'], summary: 'Start an agent loop' } },
    async (request, reply) => {
      const agentId = request.params.id;
      const body = request.body ?? {};

      if (!body.prompt || typeof body.prompt !== 'string') {
        return reply.status(400).send({
          error: 'INVALID_PROMPT',
          message: 'Request body must include a non-empty "prompt" string',
        });
      }

      if ((body.prompt as string).length > 32_000) {
        return reply.status(400).send({
          error: 'PROMPT_TOO_LONG',
          message: `Prompt length ${(body.prompt as string).length} exceeds maximum of 32000 characters`,
        });
      }

      if (
        body.config !== undefined &&
        (typeof body.config !== 'object' || body.config === null || Array.isArray(body.config))
      ) {
        return reply.status(400).send({
          error: 'INVALID_CONFIG',
          message: '"config" must be a plain object',
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
        method: 'POST',
        body: request.body,
        timeoutMs: LOOP_PROXY_TIMEOUT_MS,
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
        timeoutMs: LOOP_PROXY_TIMEOUT_MS,
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
        timeoutMs: LOOP_PROXY_TIMEOUT_MS,
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
        timeoutMs: LOOP_PROXY_TIMEOUT_MS,
      });
      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      return reply.status(result.status).send(result.data);
    },
  );
};
