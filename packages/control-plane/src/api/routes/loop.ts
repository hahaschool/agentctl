import type { FastifyPluginAsync } from 'fastify';

import type { MachineRegistryLike } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';

const WORKER_PORT = Number(process.env.WORKER_PORT) || 9000;
const PROXY_TIMEOUT_MS = 30_000;

export type LoopRoutesOptions = {
  registry: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry | null;
};

type ResolvedWorkerUrl =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string; message: string };

/**
 * Resolve the base URL of the worker running a given agent.
 *
 * Resolution order:
 *   1. Explicit `workerUrl` query parameter.
 *   2. `machineId` query parameter resolved via the machine registry.
 *   3. Automatic lookup via `dbRegistry` — agent -> machine -> tailscaleIp.
 */
async function resolveWorkerUrl(
  agentId: string,
  query: { workerUrl?: string; machineId?: string },
  registry: MachineRegistryLike,
  dbRegistry: DbAgentRegistry | null | undefined,
): Promise<ResolvedWorkerUrl> {
  const { workerUrl: explicitUrl, machineId } = query;

  if (explicitUrl) {
    return { ok: true, url: explicitUrl };
  }

  if (machineId) {
    const machine = await registry.getMachine(machineId);

    if (!machine) {
      return {
        ok: false,
        status: 404,
        error: 'MACHINE_NOT_FOUND',
        message: `Machine '${machineId}' is not registered`,
      };
    }

    const address = machine.tailscaleIp ?? machine.hostname;
    return { ok: true, url: `http://${address}:${String(WORKER_PORT)}` };
  }

  if (dbRegistry) {
    const agent = await dbRegistry.getAgent(agentId);

    if (!agent) {
      return {
        ok: false,
        status: 404,
        error: 'AGENT_NOT_FOUND',
        message: `Agent '${agentId}' does not exist in the registry`,
      };
    }

    const machine = await dbRegistry.getMachine(agent.machineId);

    if (!machine) {
      return {
        ok: false,
        status: 404,
        error: 'MACHINE_NOT_FOUND',
        message: `Machine '${agent.machineId}' for agent '${agentId}' is not registered`,
      };
    }

    if (machine.status === 'offline') {
      return {
        ok: false,
        status: 503,
        error: 'MACHINE_OFFLINE',
        message: `Machine '${machine.id}' (${machine.hostname}) is offline`,
      };
    }

    return { ok: true, url: `http://${machine.tailscaleIp}:${String(WORKER_PORT)}` };
  }

  return {
    ok: false,
    status: 500,
    error: 'REGISTRY_UNAVAILABLE',
    message:
      'Cannot resolve worker URL: no machineId provided and database registry is not configured',
  };
}

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
  const { registry, dbRegistry } = opts;

  // POST /api/agents/:id/loop — Start a loop (proxy to worker)
  app.post<{
    Params: { id: string };
    Body: { prompt: string; config: Record<string, unknown> };
    Querystring: { workerUrl?: string; machineId?: string };
  }>('/:id/loop', async (request, reply) => {
    const agentId = request.params.id;

    const resolved = await resolveWorkerUrl(agentId, request.query, registry, dbRegistry);
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
  });

  // PUT /api/agents/:id/loop — Pause or resume (proxy to worker)
  app.put<{
    Params: { id: string };
    Body: { action: string };
    Querystring: { workerUrl?: string; machineId?: string };
  }>('/:id/loop', async (request, reply) => {
    const agentId = request.params.id;

    const resolved = await resolveWorkerUrl(agentId, request.query, registry, dbRegistry);
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
  });

  // DELETE /api/agents/:id/loop — Stop loop (proxy to worker)
  app.delete<{
    Params: { id: string };
    Querystring: { workerUrl?: string; machineId?: string };
  }>('/:id/loop', async (request, reply) => {
    const agentId = request.params.id;

    const resolved = await resolveWorkerUrl(agentId, request.query, registry, dbRegistry);
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
  });

  // GET /api/agents/:id/loop — Get loop status (proxy to worker)
  app.get<{
    Params: { id: string };
    Querystring: { workerUrl?: string; machineId?: string };
  }>('/:id/loop', async (request, reply) => {
    const agentId = request.params.id;

    const resolved = await resolveWorkerUrl(agentId, request.query, registry, dbRegistry);
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
  });
};
