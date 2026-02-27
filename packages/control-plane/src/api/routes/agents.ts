import type { FastifyPluginAsync } from 'fastify';
import type {
  RegisterWorkerRequest,
  HeartbeatRequest,
  StartAgentRequest,
  StopAgentRequest,
} from '@agentctl/shared';

import { AgentRegistry } from '../../registry/agent-registry.js';

export const agentRoutes: FastifyPluginAsync = async (app) => {
  const registry = new AgentRegistry();

  app.post<{ Body: RegisterWorkerRequest }>('/register', async (request) => {
    const { machineId, hostname } = request.body;
    registry.registerMachine(machineId, hostname);
    return { ok: true, machineId };
  });

  app.post<{ Params: { id: string }; Body: HeartbeatRequest }>(
    '/:id/heartbeat',
    async (request) => {
      registry.heartbeat(request.params.id);
      return { ok: true };
    },
  );

  app.get('/', async () => {
    return registry.listMachines();
  });

  app.post<{ Params: { id: string }; Body: StartAgentRequest }>(
    '/:id/start',
    async (request) => {
      const { prompt, model } = request.body;
      // TODO: dispatch via BullMQ
      return { ok: true, agentId: request.params.id, prompt, model };
    },
  );

  app.post<{ Params: { id: string }; Body: StopAgentRequest }>(
    '/:id/stop',
    async (request) => {
      const { reason, graceful } = request.body;
      // TODO: signal worker to stop agent
      return { ok: true, agentId: request.params.id, reason, graceful };
    },
  );
};
