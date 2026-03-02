import type {
  AgentStatus,
  HeartbeatRequest,
  RegisterWorkerRequest,
  SignalAgentRequest,
  StartAgentRequest,
  StopAgentRequest,
} from '@agentctl/shared';
import { AGENT_STATUSES, ControlPlaneError } from '@agentctl/shared';
import type { Queue } from 'bullmq';
import type { FastifyPluginAsync } from 'fastify';

import type { MemoryInjector } from '../../memory/memory-injector.js';
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
  memoryInjector?: MemoryInjector | null;
};

export const agentRoutes: FastifyPluginAsync<AgentRoutesOptions> = async (app, opts) => {
  const registry = opts.registry ?? new AgentRegistry();
  const { taskQueue, repeatableJobs, dbRegistry, memoryInjector = null } = opts;

  // ---------------------------------------------------------------------------
  // Machine registration & heartbeat
  // ---------------------------------------------------------------------------

  app.post<{ Body: RegisterWorkerRequest }>('/register', async (request, reply) => {
    const body = request.body;

    if (!body.machineId || typeof body.machineId !== 'string') {
      return reply.code(400).send({
        error: 'A non-empty "machineId" string is required',
        code: 'INVALID_MACHINE_ID',
      });
    }

    if (!body.hostname || typeof body.hostname !== 'string') {
      return reply.code(400).send({
        error: 'A non-empty "hostname" string is required',
        code: 'INVALID_HOSTNAME',
      });
    }

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

      const { status } = request.body;

      if (!status || !AGENT_STATUSES.includes(status as AgentStatus)) {
        return reply.code(400).send({
          error: `Invalid status. Must be one of: ${AGENT_STATUSES.join(', ')}`,
          code: 'INVALID_STATUS',
        });
      }

      await dbRegistry.updateAgentStatus(request.params.agentId, status);
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

      const DEFAULT_LIMIT = 20;
      const raw = request.query.limit;
      let limit = DEFAULT_LIMIT;

      if (raw !== undefined) {
        const parsed = Number(raw);

        if (!Number.isInteger(parsed) || parsed < 1) {
          limit = DEFAULT_LIMIT;
        } else {
          limit = parsed;
        }
      }

      return await dbRegistry.getRecentRuns(request.params.agentId, limit);
    },
  );

  // ---------------------------------------------------------------------------
  // Agent start / stop (existing BullMQ-based control)
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: StartAgentRequest }>(
    '/:id/start',
    async (request, reply) => {
      const { prompt, model, tools, resumeSession } = request.body;
      const agentId = request.params.id;

      if (taskQueue) {
        let machineId = agentId;

        if (dbRegistry) {
          const agent = await dbRegistry.getAgent(agentId);

          if (!agent) {
            return reply.code(404).send({
              error: 'AGENT_NOT_FOUND',
              message: `Agent '${agentId}' does not exist in the registry`,
            });
          }

          machineId = agent.machineId;
        }

        const jobData: AgentTaskJobData = {
          agentId,
          machineId,
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
  // Run completion callback — called by the agent worker when a run finishes
  // ---------------------------------------------------------------------------

  app.post<{
    Params: { id: string };
    Body: {
      runId: string;
      status: 'success' | 'failure';
      errorMessage?: string;
      costUsd?: number;
      durationMs?: number;
      sessionId?: string;
    };
  }>('/:id/complete', async (request, reply) => {
    if (!dbRegistry) {
      return reply.code(501).send({
        error: 'DATABASE_NOT_CONFIGURED',
        message: 'Completion endpoint requires a database registry',
      });
    }

    const { runId, status, errorMessage, costUsd, durationMs, sessionId } = request.body;

    if (!runId || typeof runId !== 'string') {
      return reply.code(400).send({
        error: 'INVALID_RUN_ID',
        message: 'A non-empty "runId" string is required',
      });
    }

    if (!status || (status !== 'success' && status !== 'failure')) {
      return reply.code(400).send({
        error: 'INVALID_STATUS',
        message: 'Status must be "success" or "failure"',
      });
    }

    try {
      await dbRegistry.completeRun(runId, {
        status,
        errorMessage: errorMessage ?? null,
        costUsd: costUsd != null ? String(costUsd) : null,
      });

      app.log.info(
        {
          agentId: request.params.id,
          runId,
          status,
          costUsd: costUsd ?? null,
          durationMs: durationMs ?? null,
          sessionId: sessionId ?? null,
        },
        'Agent run completion reported by worker',
      );

      // -----------------------------------------------------------------
      // Fire-and-forget: sync run metadata into memory on success
      // -----------------------------------------------------------------
      if (memoryInjector && status === 'success') {
        const agentId = request.params.id;
        const summary = `Agent run ${runId} completed successfully.`;

        memoryInjector
          .syncAfterRun(agentId, summary, {
            runId,
            status,
            costUsd: costUsd ?? null,
          })
          .catch((syncErr: unknown) => {
            app.log.warn(
              { err: syncErr, agentId, runId },
              'Memory sync after run completion failed — ignoring',
            );
          });
      }

      return reply.code(200).send({ ok: true, runId, status });
    } catch (err) {
      if (err instanceof ControlPlaneError && err.code === 'RUN_NOT_FOUND') {
        return reply.code(404).send({
          error: err.code,
          message: err.message,
        });
      }

      app.log.error(
        { err, runId, agentId: request.params.id },
        'Failed to process run completion callback',
      );

      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({
        error: 'COMPLETION_FAILED',
        message: `Failed to complete run: ${message}`,
      });
    }
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
