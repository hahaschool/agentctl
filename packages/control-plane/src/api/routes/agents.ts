import type { FastifyPluginAsync } from 'fastify';
import type { Queue } from 'bullmq';
import type {
  RegisterWorkerRequest,
  HeartbeatRequest,
  StartAgentRequest,
  StopAgentRequest,
} from '@agentctl/shared';

import { AgentRegistry } from '../../registry/agent-registry.js';
import type { AgentTaskJobData, AgentTaskJobName } from '../../scheduler/task-queue.js';
import type { RepeatableJobManager } from '../../scheduler/repeatable-jobs.js';

export type AgentRoutesOptions = {
  taskQueue?: Queue<AgentTaskJobData, void, AgentTaskJobName>;
  repeatableJobs?: RepeatableJobManager;
  registry?: AgentRegistry;
};

export const agentRoutes: FastifyPluginAsync<AgentRoutesOptions> = async (app, opts) => {
  const registry = opts.registry ?? new AgentRegistry();
  const { taskQueue, repeatableJobs } = opts;

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
      const { prompt, model, tools, resumeSession } = request.body;
      const agentId = request.params.id;

      if (taskQueue) {
        const jobData: AgentTaskJobData = {
          agentId,
          machineId: agentId,
          prompt: prompt ?? null,
          model: model ?? null,
          trigger: 'manual',
          tools: tools ?? null,
          resumeSession: resumeSession ?? null,
          createdAt: new Date().toISOString(),
        };

        const job = await taskQueue.add('agent:start', jobData);

        return { ok: true, agentId, jobId: job.id, prompt, model };
      }

      return { ok: true, agentId, prompt, model };
    },
  );

  app.post<{ Params: { id: string }; Body: StopAgentRequest }>(
    '/:id/stop',
    async (request) => {
      const { reason, graceful } = request.body;
      const agentId = request.params.id;

      if (repeatableJobs) {
        const removedCount = await repeatableJobs.removeJobsByAgentId(agentId);
        return { ok: true, agentId, reason, graceful, removedRepeatableJobs: removedCount };
      }

      return { ok: true, agentId, reason, graceful };
    },
  );
};
