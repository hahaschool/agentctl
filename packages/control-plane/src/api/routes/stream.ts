import { ControlPlaneError, DEFAULT_WORKER_PORT } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { MachineRegistryLike } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { resolveWorkerUrlOrThrow } from '../resolve-worker-url.js';

export type StreamRoutesOptions = {
  registry: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry | null;
  workerPort?: number;
};

/**
 * Fastify plugin that proxies SSE streams from agent-workers to clients.
 *
 * `GET /api/agents/:id/stream` connects to the worker running the given
 * agent and relays its SSE stream. The worker URL is resolved from:
 *   1. The `workerUrl` query parameter (explicit override)
 *   2. The `machineId` query parameter looked up via the registry
 *   3. Automatic lookup via `dbRegistry` — resolves agent -> machine -> tailscaleIp
 *
 * All machine-based resolution uses `tailscaleIp` for cross-machine
 * communication over the Tailscale mesh, consistent with `task-worker.ts`.
 */
export const streamRoutes: FastifyPluginAsync<StreamRoutesOptions> = async (app, opts) => {
  const { registry, dbRegistry, workerPort = DEFAULT_WORKER_PORT } = opts;

  app.get<{
    Params: { id: string };
    Querystring: { workerUrl?: string; machineId?: string };
  }>(
    '/:id/stream',
    { schema: { tags: ['stream'], summary: 'Proxy SSE stream from agent worker' } },
    async (request, reply) => {
      const agentId = request.params.id;

      const workerBaseUrl = await resolveWorkerUrlOrThrow(agentId, request.query, {
        registry,
        dbRegistry,
        workerPort,
      });

      const upstreamUrl = `${workerBaseUrl}/api/agents/${encodeURIComponent(agentId)}/stream`;

      // Fetch the upstream SSE stream from the worker.
      let upstream: Response;

      try {
        upstream = await fetch(upstreamUrl, {
          signal: request.raw.destroyed ? AbortSignal.abort() : undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'WORKER_UNREACHABLE',
          `Failed to connect to worker at ${workerBaseUrl}: ${message}`,
          { agentId, workerBaseUrl },
        );
      }

      if (!upstream.ok) {
        throw new ControlPlaneError(
          'WORKER_STREAM_ERROR',
          `Worker returned HTTP ${String(upstream.status)} for agent '${agentId}'`,
          { agentId, workerBaseUrl, httpStatus: upstream.status },
        );
      }

      if (!upstream.body) {
        throw new ControlPlaneError(
          'WORKER_EMPTY_BODY',
          `Worker returned an empty response body for agent '${agentId}'`,
          { agentId, workerBaseUrl },
        );
      }

      // Hijack the Fastify response so we manage the raw stream ourselves.
      reply.hijack();

      const raw = reply.raw;

      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const reader = upstream.body.getReader();
      let cancelled = false;

      // Pipe upstream SSE data to the client.
      const pump = async (): Promise<void> => {
        try {
          for (;;) {
            const { done, value } = await reader.read();

            if (done || cancelled) {
              break;
            }

            if (!raw.destroyed) {
              raw.write(value);
            } else {
              break;
            }
          }
        } catch {
          // Upstream closed or errored — nothing to do except clean up.
        } finally {
          if (!raw.destroyed) {
            raw.end();
          }
        }
      };

      // Start pumping in the background.
      void pump();

      // When the downstream client disconnects, cancel the upstream reader.
      request.raw.on('close', () => {
        cancelled = true;
        reader.cancel().catch(() => {
          // Ignore cancel errors — the stream is already torn down.
        });
      });
    },
  );
};
