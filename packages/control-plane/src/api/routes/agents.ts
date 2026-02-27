import type {
  HeartbeatRequest,
  RegisterWorkerRequest,
  SignalAgentRequest,
  StartAgentRequest,
  StopAgentRequest,
} from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import type { Queue } from 'bullmq';
import type { FastifyPluginAsync } from 'fastify';

import type { MachineRegistryLike } from '../../registry/agent-registry.js';
import { AgentRegistry } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import type { RepeatableJobManager } from '../../scheduler/repeatable-jobs.js';
import type { AgentTaskJobData, AgentTaskJobName } from '../../scheduler/task-queue.js';

export type AgentRoutesOptions = {
  taskQueue?: Queue<AgentTaskJobData, void, AgentTaskJobName>;
  repeatableJobs?: RepeatableJobManager;
  registry?: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry;
};

export const agentRoutes: FastifyPluginAsync<AgentRoutesOptions> = async (app, opts) => {
  const registry = opts.registry ?? new AgentRegistry();
  const { taskQueue, repeatableJobs, dbRegistry } = opts;

  // ---------------------------------------------------------------------------
  // Machine registration & heartbeat
  // ---------------------------------------------------------------------------

  app.post<{ Body: RegisterWorkerRequest }>('/register', async (request) => {
    const body = request.body;

    if (dbRegistry) {
      await dbRegistry.registerMachine(body);
    } else {
      await registry.registerMachine(body.machineId, body.hostname);
    }

    return { ok: true, machineId: body.machineId };
  });

  app.post<{ Params: { id: string }; Body: HeartbeatRequest }>(
    '/:id/heartbeat',
    async (request) => {
      if (dbRegistry) {
        await dbRegistry.heartbeat(request.params.id);
      } else {
        await registry.heartbeat(request.params.id);
      }

      return { ok: true };
    },
  );

  // ---------------------------------------------------------------------------
  // Machine listing
  // ---------------------------------------------------------------------------

  app.get('/', async () => {
    if (dbRegistry) {
      return await dbRegistry.listMachines();
    }

    return await registry.listMachines();
  });

  // ---------------------------------------------------------------------------
  // Agent CRUD (only available when dbRegistry is configured)
  // ---------------------------------------------------------------------------

  app.post<{
    Body: {
      machineId: string;
      name: string;
      type: string;
      schedule?: string;
      projectPath?: string;
      worktreeBranch?: string;
      config?: Record<string, unknown>;
    };
  }>('/agents', async (request, reply) => {
    if (!dbRegistry) {
      return reply.code(501).send({ error: 'Database not configured' });
    }

    const agentId = await dbRegistry.createAgent(request.body);
    return { ok: true, agentId };
  });

  app.get<{ Querystring: { machineId?: string } }>('/agents/list', async (request, reply) => {
    if (!dbRegistry) {
      return reply.code(501).send({ error: 'Database not configured' });
    }

    return await dbRegistry.listAgents(request.query.machineId);
  });

  app.get<{ Params: { agentId: string } }>('/agents/:agentId', async (request, reply) => {
    if (!dbRegistry) {
      return reply.code(501).send({ error: 'Database not configured' });
    }

    const agent = await dbRegistry.getAgent(request.params.agentId);

    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    return agent;
  });

  app.patch<{ Params: { agentId: string }; Body: { status: string } }>(
    '/agents/:agentId/status',
    async (request, reply) => {
      if (!dbRegistry) {
        return reply.code(501).send({ error: 'Database not configured' });
      }

      await dbRegistry.updateAgentStatus(request.params.agentId, request.body.status);
      return { ok: true };
    },
  );

  // ---------------------------------------------------------------------------
  // Run tracking (only available when dbRegistry is configured)
  // ---------------------------------------------------------------------------

  app.get<{ Params: { agentId: string }; Querystring: { limit?: string } }>(
    '/agents/:agentId/runs',
    async (request, reply) => {
      if (!dbRegistry) {
        return reply.code(501).send({ error: 'Database not configured' });
      }

      const limit = request.query.limit ? Number(request.query.limit) : undefined;
      return await dbRegistry.getRecentRuns(request.params.agentId, limit);
    },
  );

  // ---------------------------------------------------------------------------
  // Agent start / stop (existing BullMQ-based control)
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: StartAgentRequest }>('/:id/start', async (request) => {
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
  });

  app.post<{ Params: { id: string }; Body: StopAgentRequest }>('/:id/stop', async (request) => {
    const { reason, graceful } = request.body;
    const agentId = request.params.id;

    if (repeatableJobs) {
      const removedCount = await repeatableJobs.removeJobsByAgentId(agentId);
      return { ok: true, agentId, reason, graceful, removedRepeatableJobs: removedCount };
    }

    return { ok: true, agentId, reason, graceful };
  });

  // ---------------------------------------------------------------------------
  // Signal trigger — fire an external signal to trigger an agent run
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: SignalAgentRequest }>(
    '/:id/signal',
    async (request, reply) => {
      const agentId = request.params.id;
      const { prompt, metadata } = request.body;

      if (!prompt || typeof prompt !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_SIGNAL_BODY',
          message: 'Signal request must include a non-empty "prompt" string',
        });
      }

      if (!dbRegistry) {
        return reply.code(501).send({
          error: 'DATABASE_NOT_CONFIGURED',
          message: 'Signal endpoint requires a database registry',
        });
      }

      if (!taskQueue) {
        return reply.code(501).send({
          error: 'QUEUE_NOT_CONFIGURED',
          message: 'Signal endpoint requires a task queue',
        });
      }

      const agent = await dbRegistry.getAgent(agentId);

      if (!agent) {
        throw new ControlPlaneError(
          'AGENT_NOT_FOUND',
          `Agent '${agentId}' does not exist in the registry`,
          { agentId },
        );
      }

      const jobData: AgentTaskJobData = {
        agentId,
        machineId: agent.machineId,
        prompt,
        model: agent.config?.model ?? null,
        trigger: 'signal',
        tools: agent.config?.allowedTools ?? null,
        resumeSession: null,
        createdAt: new Date().toISOString(),
        signalMetadata: metadata,
      };

      const job = await taskQueue.add('agent:signal', jobData);

      app.log.info({ agentId, jobId: job.id, trigger: 'signal' }, 'Signal job enqueued');

      return { ok: true, agentId, jobId: job.id };
    },
  );
};
