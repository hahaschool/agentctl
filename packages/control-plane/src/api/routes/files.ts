// ---------------------------------------------------------------------------
// Control-plane file proxy routes — forwards file browsing/editing requests
// to the correct worker machine. Follows the same proxy pattern used for
// session content in sessions.ts.
//
// Mounted at /api/machines/:machineId/files
// ---------------------------------------------------------------------------

import { ControlPlaneError, DEFAULT_WORKER_PORT } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { resolveWorkerUrlByMachineIdOrThrow } from '../resolve-worker-url.js';

const FILE_REQUEST_TIMEOUT_MS = 10_000;

export type FileProxyRoutesOptions = {
  dbRegistry: DbAgentRegistry;
  workerPort?: number;
};

export const fileProxyRoutes: FastifyPluginAsync<FileProxyRoutesOptions> = async (app, opts) => {
  const { dbRegistry, workerPort = DEFAULT_WORKER_PORT } = opts;

  /** Resolve the worker base URL for a machine. */
  const resolveWorker = (machineId: string): Promise<string> =>
    resolveWorkerUrlByMachineIdOrThrow(machineId, { dbRegistry, workerPort });

  // -------------------------------------------------------------------------
  // GET /:machineId/files — list directory contents
  // -------------------------------------------------------------------------

  app.get<{
    Params: { machineId: string };
    Querystring: { path?: string };
  }>(
    '/:machineId/files',
    { schema: { tags: ['files'], summary: 'List directory contents on a worker machine' } },
    async (request, reply) => {
      const { machineId } = request.params;
      const { path } = request.query;

      if (!path || typeof path !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_PATH',
          message: 'A non-empty "path" query parameter is required',
        });
      }

      const workerBaseUrl = await resolveWorker(machineId);
      const qs = new URLSearchParams({ path });
      const url = `${workerBaseUrl}/api/files?${qs.toString()}`;

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(FILE_REQUEST_TIMEOUT_MS),
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
          `Failed to list files on worker at ${workerBaseUrl}: ${errMessage}`,
          { machineId },
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /:machineId/files/content — read file content
  // -------------------------------------------------------------------------

  app.get<{
    Params: { machineId: string };
    Querystring: { path?: string };
  }>(
    '/:machineId/files/content',
    { schema: { tags: ['files'], summary: 'Read file content from a worker machine' } },
    async (request, reply) => {
      const { machineId } = request.params;
      const { path } = request.query;

      if (!path || typeof path !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_PATH',
          message: 'A non-empty "path" query parameter is required',
        });
      }

      const workerBaseUrl = await resolveWorker(machineId);
      const qs = new URLSearchParams({ path });
      const url = `${workerBaseUrl}/api/files/content?${qs.toString()}`;

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(FILE_REQUEST_TIMEOUT_MS),
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
          `Failed to read file from worker at ${workerBaseUrl}: ${errMessage}`,
          { machineId },
        );
      }
    },
  );

  // -------------------------------------------------------------------------
  // PUT /:machineId/files/content — write file content
  // -------------------------------------------------------------------------

  app.put<{
    Params: { machineId: string };
    Body: { path?: string; content?: string };
  }>(
    '/:machineId/files/content',
    { schema: { tags: ['files'], summary: 'Write file content on a worker machine' } },
    async (request, reply) => {
      const { machineId } = request.params;
      const body = request.body ?? {};

      if (!body.path || typeof body.path !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_PATH',
          message: 'Request body must include a "path" string field',
        });
      }

      if (typeof body.content !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_CONTENT',
          message: 'Request body must include a "content" string field',
        });
      }

      const workerBaseUrl = await resolveWorker(machineId);
      const url = `${workerBaseUrl}/api/files/content`;

      try {
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: body.path, content: body.content }),
          signal: AbortSignal.timeout(FILE_REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
          const resBody = await res
            .json()
            .catch(() => ({ error: 'UNKNOWN', message: res.statusText }));
          return reply.code(res.status).send(resBody);
        }

        return await res.json();
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        throw new ControlPlaneError(
          'WORKER_UNREACHABLE',
          `Failed to write file on worker at ${workerBaseUrl}: ${errMessage}`,
          { machineId },
        );
      }
    },
  );
};
