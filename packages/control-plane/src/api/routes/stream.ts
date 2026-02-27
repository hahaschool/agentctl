import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { MachineRegistryLike } from '../../registry/agent-registry.js';

const DEFAULT_WORKER_URL = 'http://localhost:9000';

export type StreamRoutesOptions = {
  registry: MachineRegistryLike;
};

/**
 * Fastify plugin that proxies SSE streams from agent-workers to clients.
 *
 * `GET /api/agents/:id/stream` connects to the worker running the given
 * agent and relays its SSE stream. The worker URL is resolved from:
 *   1. The `workerUrl` query parameter (explicit override)
 *   2. The `machineId` query parameter looked up via the registry
 *   3. A default fallback for local development
 */
export const streamRoutes: FastifyPluginAsync<StreamRoutesOptions> = async (app, opts) => {
  const { registry } = opts;

  app.get<{
    Params: { id: string };
    Querystring: { workerUrl?: string; machineId?: string };
  }>('/:id/stream', async (request, reply) => {
    const agentId = request.params.id;
    const { workerUrl: explicitUrl, machineId } = request.query;

    // Resolve the upstream worker URL.
    let workerBaseUrl: string;

    if (explicitUrl) {
      workerBaseUrl = explicitUrl;
    } else if (machineId) {
      const machine = await registry.getMachine(machineId);

      if (!machine) {
        throw new ControlPlaneError(
          'MACHINE_NOT_FOUND',
          `Machine '${machineId}' is not registered`,
          { machineId },
        );
      }

      // Construct URL from the registered hostname (assumes port 9000).
      workerBaseUrl = `http://${machine.hostname}:9000`;
    } else {
      workerBaseUrl = DEFAULT_WORKER_URL;
    }

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
  });
};
