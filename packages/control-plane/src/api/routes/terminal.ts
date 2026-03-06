// ---------------------------------------------------------------------------
// Control-plane terminal proxy routes — forwards terminal management requests
// to the correct worker machine and proxies WebSocket connections for
// interactive terminal I/O.
//
// Mounted at /api/machines/:machineId/terminal
// ---------------------------------------------------------------------------

import { ControlPlaneError, DEFAULT_WORKER_PORT } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';

import type { DbAgentRegistry } from '../../registry/db-registry.js';

const TERMINAL_REQUEST_TIMEOUT_MS = 10_000;

/** Get the best address for a machine, preferring tailscaleIp with hostname fallback. */
function machineAddress(machine: { tailscaleIp?: string | null; hostname: string }): string {
  return machine.tailscaleIp ?? machine.hostname;
}

export type TerminalRouteOptions = {
  logger: Logger;
  dbRegistry: DbAgentRegistry;
  workerPort?: number;
};

export const terminalProxyRoutes: FastifyPluginAsync<TerminalRouteOptions> = async (app, opts) => {
  const { dbRegistry, logger, workerPort = DEFAULT_WORKER_PORT } = opts;

  /**
   * Look up a machine and build the worker base URL. Throws if the machine
   * is not found or is offline.
   */
  async function resolveWorker(machineId: string): Promise<string> {
    const machine = await dbRegistry.getMachine(machineId);

    if (!machine) {
      throw new ControlPlaneError('MACHINE_NOT_FOUND', `Machine '${machineId}' is not registered`, {
        machineId,
      });
    }

    if (machine.status === 'offline') {
      throw new ControlPlaneError(
        'MACHINE_OFFLINE',
        `Machine '${machineId}' (${machine.hostname}) is offline`,
        { machineId },
      );
    }

    return `http://${machineAddress(machine)}:${String(workerPort)}`;
  }

  // -------------------------------------------------------------------------
  // GET /:machineId/terminal — list terminals on machine
  // -------------------------------------------------------------------------

  app.get<{
    Params: { machineId: string };
  }>(
    '/:machineId/terminal',
    { schema: { tags: ['terminal'], summary: 'List terminals on a worker machine' } },
    async (request, reply) => {
      const { machineId } = request.params;
      const workerBaseUrl = await resolveWorker(machineId);
      const url = `${workerBaseUrl}/api/terminal`;

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(TERMINAL_REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
          const body = await res
            .json()
            .catch(() => ({ error: 'UNKNOWN', message: res.statusText }));
          return reply.code(res.status).send(body);
        }

        return await res.json();
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'WORKER_UNREACHABLE',
          `Failed to list terminals on worker at ${workerBaseUrl}: ${errMessage}`,
          { machineId },
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /:machineId/terminal — spawn terminal on machine
  // -------------------------------------------------------------------------

  app.post<{
    Params: { machineId: string };
    Body: Record<string, unknown>;
  }>(
    '/:machineId/terminal',
    { schema: { tags: ['terminal'], summary: 'Spawn a terminal on a worker machine' } },
    async (request, reply) => {
      const { machineId } = request.params;
      const workerBaseUrl = await resolveWorker(machineId);
      const url = `${workerBaseUrl}/api/terminal`;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request.body ?? {}),
          signal: AbortSignal.timeout(TERMINAL_REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
          const body = await res
            .json()
            .catch(() => ({ error: 'UNKNOWN', message: res.statusText }));
          return reply.code(res.status).send(body);
        }

        const data = await res.json();
        return reply.code(res.status).send(data);
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'WORKER_UNREACHABLE',
          `Failed to spawn terminal on worker at ${workerBaseUrl}: ${errMessage}`,
          { machineId },
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /:machineId/terminal/:termId — get terminal info
  // -------------------------------------------------------------------------

  app.get<{
    Params: { machineId: string; termId: string };
  }>(
    '/:machineId/terminal/:termId',
    { schema: { tags: ['terminal'], summary: 'Get terminal info from a worker machine' } },
    async (request, reply) => {
      const { machineId, termId } = request.params;
      const workerBaseUrl = await resolveWorker(machineId);
      const url = `${workerBaseUrl}/api/terminal/${encodeURIComponent(termId)}`;

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(TERMINAL_REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
          const body = await res
            .json()
            .catch(() => ({ error: 'UNKNOWN', message: res.statusText }));
          return reply.code(res.status).send(body);
        }

        return await res.json();
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'WORKER_UNREACHABLE',
          `Failed to get terminal info from worker at ${workerBaseUrl}: ${errMessage}`,
          { machineId, termId },
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /:machineId/terminal/:termId/resize — resize terminal
  // -------------------------------------------------------------------------

  app.post<{
    Params: { machineId: string; termId: string };
    Body: { cols: number; rows: number };
  }>(
    '/:machineId/terminal/:termId/resize',
    { schema: { tags: ['terminal'], summary: 'Resize a terminal on a worker machine' } },
    async (request, reply) => {
      const { machineId, termId } = request.params;
      const { cols, rows } = request.body;

      if (typeof cols !== 'number' || typeof rows !== 'number' || cols < 1 || rows < 1) {
        return reply.status(400).send({
          error: 'INVALID_DIMENSIONS',
          message: 'cols and rows must be positive numbers',
        });
      }

      const workerBaseUrl = await resolveWorker(machineId);
      const url = `${workerBaseUrl}/api/terminal/${encodeURIComponent(termId)}/resize`;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request.body ?? {}),
          signal: AbortSignal.timeout(TERMINAL_REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
          const body = await res
            .json()
            .catch(() => ({ error: 'UNKNOWN', message: res.statusText }));
          return reply.code(res.status).send(body);
        }

        const data = await res.json();
        return reply.code(res.status).send(data);
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'WORKER_UNREACHABLE',
          `Failed to resize terminal on worker at ${workerBaseUrl}: ${errMessage}`,
          { machineId, termId },
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /:machineId/terminal/:termId — kill terminal
  // -------------------------------------------------------------------------

  app.delete<{
    Params: { machineId: string; termId: string };
  }>(
    '/:machineId/terminal/:termId',
    { schema: { tags: ['terminal'], summary: 'Kill a terminal on a worker machine' } },
    async (request, reply) => {
      const { machineId, termId } = request.params;
      const workerBaseUrl = await resolveWorker(machineId);
      const url = `${workerBaseUrl}/api/terminal/${encodeURIComponent(termId)}`;

      try {
        const res = await fetch(url, {
          method: 'DELETE',
          signal: AbortSignal.timeout(TERMINAL_REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
          const body = await res
            .json()
            .catch(() => ({ error: 'UNKNOWN', message: res.statusText }));
          return reply.code(res.status).send(body);
        }

        const data = await res.json();
        return reply.code(res.status).send(data);
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'WORKER_UNREACHABLE',
          `Failed to kill terminal on worker at ${workerBaseUrl}: ${errMessage}`,
          { machineId, termId },
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /:machineId/terminal/:termId/ws — WebSocket proxy to worker terminal
  // -------------------------------------------------------------------------

  app.get<{ Params: { machineId: string; termId: string } }>(
    '/:machineId/terminal/:termId/ws',
    { websocket: true },
    async (socket, request) => {
      const { machineId, termId } = request.params;

      let workerBaseUrl: string;
      try {
        workerBaseUrl = await resolveWorker(machineId);
      } catch (err) {
        const message = err instanceof ControlPlaneError ? err.message : String(err);
        logger.error({ err: message, machineId, termId }, 'Failed to resolve worker for terminal WS');
        socket.close(1011, message);
        return;
      }

      const wsUrl =
        workerBaseUrl.replace(/^http/, 'ws') +
        `/api/terminal/${encodeURIComponent(termId)}/ws`;

      const { WebSocket } = await import('ws');
      const upstream = new WebSocket(wsUrl);

      upstream.on('open', () => {
        logger.info({ machineId, termId, wsUrl }, 'Upstream terminal WS connected');

        socket.on('message', (data) => {
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(data.toString());
          }
        });

        upstream.on('message', (data) => {
          if (socket.readyState === 1) {
            // OPEN
            socket.send(data.toString());
          }
        });
      });

      upstream.on('close', () => {
        logger.info({ machineId, termId }, 'Upstream terminal WS closed');
        socket.close();
      });

      upstream.on('error', (err) => {
        logger.error({ err: err.message, machineId, termId }, 'Upstream terminal WS error');
        socket.close();
      });

      socket.on('close', () => {
        logger.info({ machineId, termId }, 'Client terminal WS closed');
        upstream.close();
      });

      socket.on('error', (err) => {
        logger.warn({ err: err.message, machineId, termId }, 'Client terminal WS error');
        upstream.close();
      });
    },
  );
};
