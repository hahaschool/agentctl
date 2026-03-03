import type { FastifyPluginAsync } from 'fastify';

import type { MachineRegistryLike } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { resolveWorkerUrl } from '../resolve-worker-url.js';

const DEFAULT_WORKER_PORT = 9000;
const PROXY_TIMEOUT_MS = 30_000;

export type LoopRoutesOptions = {
  registry: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry | null;
  workerPort?: number;
};

/**
 * Proxy an HTTP request to the agent worker and return its response.
 */
async function proxyToWorker(
  workerBaseUrl: string,
  agentId: string,
  method: string,
  body?: unknown,
): Promise<
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string; message: string }
> {
  const url = `${workerBaseUrl}/api/agents/${encodeURIComponent(agentId)}/loop`;

  const fetchOptions: RequestInit = {
    method,
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json' },
  };

  if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
    fetchOptions.body = JSON.stringify(body);
  }

  let response: Response;

  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 502,
      error: 'WORKER_UNREACHABLE',
      message: `Failed to connect to worker at ${workerBaseUrl}: ${message}`,
    };
  }

  const data: unknown = await response.json();
  return { ok: true, status: response.status, data };
}

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

      const result = await proxyToWorker(resolved.url, agentId, 'POST', request.body);
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

      const result = await proxyToWorker(resolved.url, agentId, 'PUT', request.body);
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

      const result = await proxyToWorker(resolved.url, agentId, 'DELETE');
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

      const result = await proxyToWorker(resolved.url, agentId, 'GET');
      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      return reply.status(result.status).send(result.data);
    },
  );
};
