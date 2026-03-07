// ---------------------------------------------------------------------------
// Control-plane file proxy routes — forwards file browsing/editing requests
// to the correct worker machine. Follows the same proxy pattern used for
// session content in sessions.ts.
//
// Mounted at /api/machines/:machineId/files
// ---------------------------------------------------------------------------

import { DEFAULT_WORKER_PORT } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { WORKER_REQUEST_TIMEOUT_MS } from '../constants.js';
import { proxyWorkerRequest } from '../proxy-worker-request.js';
import { resolveWorkerUrlByMachineIdOrThrow } from '../resolve-worker-url.js';

const MAX_FILE_CONTENT_LENGTH = 5_000_000; // 5 MB

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

      const result = await proxyWorkerRequest({
        workerBaseUrl,
        path: `/api/files?${qs.toString()}`,
        method: 'GET',
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      return reply.status(result.status).send(result.data);
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

      const result = await proxyWorkerRequest({
        workerBaseUrl,
        path: `/api/files/content?${qs.toString()}`,
        method: 'GET',
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      return reply.status(result.status).send(result.data);
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
    {
      schema: { tags: ['files'], summary: 'Write file content on a worker machine' },
      bodyLimit: MAX_FILE_CONTENT_LENGTH + 1_000_000, // allow JSON overhead above the content limit
    },
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

      if (body.content.length > MAX_FILE_CONTENT_LENGTH) {
        return reply.code(400).send({
          error: 'CONTENT_TOO_LARGE',
          message: `File content length ${body.content.length} exceeds maximum of ${MAX_FILE_CONTENT_LENGTH} bytes`,
        });
      }

      const workerBaseUrl = await resolveWorker(machineId);

      const result = await proxyWorkerRequest({
        workerBaseUrl,
        path: '/api/files/content',
        method: 'PUT',
        body: { path: body.path, content: body.content },
        timeoutMs: WORKER_REQUEST_TIMEOUT_MS,
      });

      if (!result.ok) {
        return reply.status(result.status).send({ error: result.error, message: result.message });
      }

      return reply.status(result.status).send(result.data);
    },
  );
};
