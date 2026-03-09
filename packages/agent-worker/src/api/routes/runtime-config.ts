import type { ApplyRuntimeConfigRequest, ApplyRuntimeConfigResponse } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';

import type {
  RuntimeConfigApplier,
  WorkerRuntimeConfigState,
} from '../../runtime/config/runtime-config-applier.js';

export type RuntimeConfigApplierLike = Pick<RuntimeConfigApplier, 'apply' | 'getState'>;

export type RuntimeConfigRoutesOptions = {
  machineId: string;
  runtimeConfigApplier: RuntimeConfigApplierLike;
  logger: Logger;
};

export const runtimeConfigRoutes: FastifyPluginAsync<RuntimeConfigRoutesOptions> = async (
  app,
  opts,
) => {
  const { machineId, runtimeConfigApplier, logger } = opts;

  app.post<{
    Body: ApplyRuntimeConfigRequest;
    Reply: ApplyRuntimeConfigResponse;
  }>('/apply', async (request, reply) => {
    if (!request.body?.config || request.body.machineId !== machineId) {
      return reply.code(400).send({
        error: 'INVALID_RUNTIME_CONFIG_REQUEST',
        message: 'machineId must match this worker and config is required',
      } as never);
    }

    const response = await runtimeConfigApplier.apply(request.body);
    logger.info({ machineId, configVersion: response.configVersion }, 'Applied managed runtime config');
    return response;
  });

  app.get<{ Reply: WorkerRuntimeConfigState }>('/state', async () => {
    return runtimeConfigApplier.getState(machineId);
  });
};
