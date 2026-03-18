import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import {
  type PermissionDecision,
  resolvePendingPermissionDecision,
} from '../../runtime/sdk-runner.js';

type PermissionResponseRouteOptions = FastifyPluginOptions & {
  logger: Logger;
};

type PermissionResponseParams = {
  agentId: string;
};

type PermissionResponseBody = PermissionDecision;

function isPermissionDecision(value: unknown): value is PermissionDecision['decision'] {
  return value === 'approved' || value === 'denied';
}

export async function permissionResponseRoutes(
  app: FastifyInstance,
  options: PermissionResponseRouteOptions,
): Promise<void> {
  const { logger } = options;

  app.post<{ Params: PermissionResponseParams; Body: PermissionResponseBody }>(
    '/:agentId/permission-response',
    async (
      request: FastifyRequest<{ Params: PermissionResponseParams; Body: PermissionResponseBody }>,
      reply: FastifyReply,
    ) => {
      const { agentId } = request.params;
      const requestId = request.body?.requestId;
      const decision = request.body?.decision;

      if (!requestId || typeof requestId !== 'string' || requestId.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_PERMISSION_RESPONSE',
          message: 'requestId must be a non-empty string',
        });
      }

      if (!isPermissionDecision(decision)) {
        return reply.code(400).send({
          error: 'INVALID_PERMISSION_RESPONSE',
          message: "decision must be one of: 'approved', 'denied'",
        });
      }

      const resolved = resolvePendingPermissionDecision({ requestId, decision }, agentId);
      if (!resolved) {
        logger.warn(
          { agentId, requestId, decision },
          'Permission response ignored because no pending request was found',
        );
        return reply.code(404).send({
          error: 'PERMISSION_REQUEST_NOT_FOUND',
          message: `No pending permission request found for requestId '${requestId}'`,
        });
      }

      logger.info({ agentId, requestId, decision }, 'Resolved pending permission request');
      return reply.code(200).send({ ok: true });
    },
  );
}
