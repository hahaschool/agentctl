import type {
  AgentRuntime,
  AgentStatus,
  DispatchVerificationConfig,
  ExecutionSummary,
  HeartbeatRequest,
  RegisterWorkerRequest,
  SafetyDecisionRequest,
  SignalAgentRequest,
  StartAgentRequest,
  StopAgentRequest,
} from '@agentctl/shared';
import {
  AGENT_RUNTIMES,
  AGENT_STATUSES,
  ControlPlaneError,
  DEFAULT_WORKER_PORT,
  SAFETY_DECISIONS,
} from '@agentctl/shared';
import type { Queue } from 'bullmq';
import type { FastifyPluginAsync } from 'fastify';

import type { MemoryInjector } from '../../memory/memory-injector.js';
import type { MachineRegistryLike } from '../../registry/agent-registry.js';
import { AgentRegistry } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import type { RepeatableJobManager } from '../../scheduler/repeatable-jobs.js';
import type { AgentTaskJobData, AgentTaskJobName } from '../../scheduler/task-queue.js';
import { clampLimit, PAGINATION } from '../constants.js';
import { proxyWorkerRequest, replyWithProxyResult } from '../proxy-worker-request.js';
import { resolveWorkerUrl } from '../resolve-worker-url.js';

export type AgentRoutesOptions = {
  taskQueue?: Queue<AgentTaskJobData, void, AgentTaskJobName>;
  repeatableJobs?: RepeatableJobManager;
  registry?: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry;
  memoryInjector?: MemoryInjector | null;
  dispatchVerificationConfig?: DispatchVerificationConfig | null;
  workerPort?: number;
};

export const agentRoutes: FastifyPluginAsync<AgentRoutesOptions> = async (app, opts) => {
  const registry = opts.registry ?? new AgentRegistry();
  const {
    taskQueue,
    repeatableJobs,
    dbRegistry,
    memoryInjector = null,
    dispatchVerificationConfig = null,
    workerPort = DEFAULT_WORKER_PORT,
  } = opts;

  // ---------------------------------------------------------------------------
  // Machine registration & heartbeat
  // ---------------------------------------------------------------------------

  app.post<{ Body: RegisterWorkerRequest }>(
    '/register',
    { schema: { tags: ['machines'], summary: 'Register a machine' } },
    async (request, reply) => {
      const body = request.body;

      if (!body.machineId || typeof body.machineId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_MACHINE_ID',
          message: 'A non-empty "machineId" string is required',
        });
      }

      if (!body.hostname || typeof body.hostname !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_HOSTNAME',
          message: 'A non-empty "hostname" string is required',
        });
      }

      if (dbRegistry) {
        await dbRegistry.registerMachine(body);
      } else {
        await registry.registerMachine(body.machineId, body.hostname);
      }

      return {
        ok: true,
        machineId: body.machineId,
        ...(dispatchVerificationConfig ? { dispatchVerification: dispatchVerificationConfig } : {}),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: HeartbeatRequest }>(
    '/:id/heartbeat',
    { schema: { tags: ['machines'], summary: 'Machine heartbeat' } },
    async (request) => {
      if (dbRegistry) {
        await dbRegistry.heartbeat(request.params.id, request.body.capabilities);
      } else {
        await registry.heartbeat(request.params.id);
      }

      return {
        ok: true,
        ...(dispatchVerificationConfig ? { dispatchVerification: dispatchVerificationConfig } : {}),
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Machine listing
  // ---------------------------------------------------------------------------

  app.get(
    '/',
    { schema: { tags: ['machines'], summary: 'List registered machines' } },
    async () => {
      if (dbRegistry) {
        return await dbRegistry.listMachines();
      }

      return await registry.listMachines();
    },
  );

  // ---------------------------------------------------------------------------
  // Agent CRUD (only available when dbRegistry is configured)
  // ---------------------------------------------------------------------------

  const VALID_RUNTIMES = AGENT_RUNTIMES.map((r) => r.value);

  app.post<{
    Body: {
      machineId: string;
      name: string;
      type: string;
      runtime?: string;
      schedule?: string;
      projectPath?: string;
      worktreeBranch?: string;
      config?: Record<string, unknown>;
    };
  }>('/', { schema: { tags: ['agents'], summary: 'Create an agent' } }, async (request, reply) => {
    if (!dbRegistry) {
      return reply
        .code(501)
        .send({ error: 'DATABASE_NOT_CONFIGURED', message: 'Database not configured' });
    }

    const { machineId, name, type } = request.body;

    if (!machineId || typeof machineId !== 'string') {
      return reply.code(400).send({
        error: 'INVALID_BODY',
        message: 'A non-empty "machineId" string is required',
      });
    }

    if (!name || typeof name !== 'string') {
      return reply.code(400).send({
        error: 'INVALID_BODY',
        message: 'A non-empty "name" string is required',
      });
    }

    if (!type || typeof type !== 'string') {
      return reply.code(400).send({
        error: 'INVALID_BODY',
        message: 'A non-empty "type" string is required',
      });
    }

    if (request.body.runtime && !VALID_RUNTIMES.includes(request.body.runtime as AgentRuntime)) {
      return reply.code(400).send({
        error: 'INVALID_RUNTIME',
        message: `Invalid runtime: ${request.body.runtime}. Must be one of: ${VALID_RUNTIMES.join(', ')}`,
      });
    }

    const agentId = await dbRegistry.createAgent(request.body);
    return { ok: true, agentId };
  });

  app.get<{ Querystring: { machineId?: string; limit?: string; offset?: string } }>(
    '/list',
    { schema: { tags: ['agents'], summary: 'List agents with pagination' } },
    async (request, reply) => {
      if (!dbRegistry) {
        return reply
          .code(501)
          .send({ error: 'DATABASE_NOT_CONFIGURED', message: 'Database not configured' });
      }

      // Validate limit
      let limit = PAGINATION.agents.defaultLimit;
      if (request.query.limit !== undefined) {
        const parsed = Number(request.query.limit);
        if (!Number.isFinite(parsed) || parsed < 1) {
          return reply
            .code(400)
            .send({ error: 'INVALID_PARAMS', message: '"limit" must be a positive integer' });
        }
        limit = clampLimit(parsed, PAGINATION.agents);
      }

      // Validate offset
      let offset = 0;
      if (request.query.offset !== undefined) {
        const parsed = Number(request.query.offset);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return reply
            .code(400)
            .send({ error: 'INVALID_PARAMS', message: '"offset" must be a non-negative integer' });
        }
        offset = Math.floor(parsed);
      }

      return await dbRegistry.listAgentsPaginated({
        machineId: request.query.machineId,
        limit,
        offset,
      });
    },
  );

  app.get<{ Params: { agentId: string } }>(
    '/:agentId',
    { schema: { tags: ['agents'], summary: 'Get agent by ID' } },
    async (request, reply) => {
      if (!dbRegistry) {
        return reply
          .code(501)
          .send({ error: 'DATABASE_NOT_CONFIGURED', message: 'Database not configured' });
      }

      const agent = await dbRegistry.getAgent(request.params.agentId);

      if (!agent) {
        return reply.code(404).send({ error: 'AGENT_NOT_FOUND', message: 'Agent not found' });
      }

      return agent;
    },
  );

  app.patch<{
    Params: { agentId: string };
    Body: {
      accountId?: string | null;
      name?: string;
      machineId?: string;
      type?: string;
      schedule?: string | null;
      config?: Record<string, unknown>;
    };
  }>(
    '/:agentId',
    { schema: { tags: ['agents'], summary: 'Update agent fields' } },
    async (request, reply) => {
      if (!dbRegistry) {
        return reply
          .code(501)
          .send({ error: 'DATABASE_NOT_CONFIGURED', message: 'Database not configured' });
      }

      const { accountId, name, machineId, type, schedule, config } = request.body;

      // Validate accountId is either null/undefined or a string
      if (accountId !== undefined && accountId !== null && typeof accountId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_ACCOUNT_ID',
          message: 'accountId must be a string or null',
        });
      }

      // Validate name if provided
      if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
        return reply.code(400).send({
          error: 'INVALID_NAME',
          message: 'name must be a non-empty string',
        });
      }

      if (typeof name === 'string' && name.length > 256) {
        return reply.code(400).send({
          error: 'NAME_TOO_LONG',
          message: 'name must be under 256 characters',
        });
      }

      // Validate machineId if provided
      if (machineId !== undefined && typeof machineId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_MACHINE_ID',
          message: 'machineId must be a string',
        });
      }

      // Validate type if provided
      if (type !== undefined && typeof type !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_TYPE',
          message: 'type must be a string',
        });
      }

      // Validate schedule if provided (allow null to clear)
      if (schedule !== undefined && schedule !== null && typeof schedule !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_SCHEDULE',
          message: 'schedule must be a string or null',
        });
      }

      if (typeof schedule === 'string' && schedule.length > 100) {
        return reply.code(400).send({
          error: 'SCHEDULE_TOO_LONG',
          message: 'schedule must be under 100 characters',
        });
      }

      // Validate config if provided
      if (config !== undefined && (typeof config !== 'object' || config === null)) {
        return reply.code(400).send({
          error: 'INVALID_CONFIG',
          message: 'config must be an object',
        });
      }

      try {
        const agent = await dbRegistry.updateAgent(request.params.agentId, {
          accountId,
          name,
          machineId,
          type,
          schedule,
          config,
        });
        return agent;
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'AGENT_NOT_FOUND') {
          return reply.code(404).send({ error: err.code, message: err.message });
        }

        throw err;
      }
    },
  );

  app.patch<{ Params: { agentId: string }; Body: { status: string } }>(
    '/:agentId/status',
    { schema: { tags: ['agents'], summary: 'Update agent status' } },
    async (request, reply) => {
      if (!dbRegistry) {
        return reply
          .code(501)
          .send({ error: 'DATABASE_NOT_CONFIGURED', message: 'Database not configured' });
      }

      const { status } = request.body;

      if (!status || !AGENT_STATUSES.includes(status as AgentStatus)) {
        return reply.code(400).send({
          error: 'INVALID_STATUS',
          message: `Invalid status. Must be one of: ${AGENT_STATUSES.join(', ')}`,
        });
      }

      try {
        await dbRegistry.updateAgentStatus(request.params.agentId, status);
        return { ok: true };
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'AGENT_NOT_FOUND') {
          return reply.code(404).send({ error: err.code, message: err.message });
        }

        throw err;
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Run tracking (only available when dbRegistry is configured)
  // ---------------------------------------------------------------------------

  app.get<{ Params: { agentId: string }; Querystring: { limit?: string } }>(
    '/:agentId/runs',
    { schema: { tags: ['agents'], summary: 'Recent runs for agent' } },
    async (request, reply) => {
      if (!dbRegistry) {
        return reply
          .code(501)
          .send({ error: 'DATABASE_NOT_CONFIGURED', message: 'Database not configured' });
      }

      const raw = request.query.limit;
      let limit = PAGINATION.agentRuns.defaultLimit;

      if (raw !== undefined) {
        limit = clampLimit(Number(raw), PAGINATION.agentRuns);
      }

      return await dbRegistry.getRecentRuns(request.params.agentId, limit);
    },
  );

  // ---------------------------------------------------------------------------
  // Agent start / stop (existing BullMQ-based control)
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: StartAgentRequest & { machineId?: string } }>(
    '/:id/start',
    { schema: { tags: ['agents'], summary: 'Start an agent task' } },
    async (request, reply) => {
      const {
        prompt,
        model,
        allowedTools,
        resumeSession,
        machineId: requestedMachineId,
      } = request.body;
      const agentId = request.params.id;

      if (typeof prompt === 'string' && prompt.length > 32_000) {
        return reply.code(400).send({
          error: 'PROMPT_TOO_LONG',
          message: 'Prompt must be under 32,000 characters',
        });
      }

      if (taskQueue) {
        let machineId = agentId;

        if (dbRegistry) {
          let agent = await dbRegistry.getAgent(agentId);

          if (!agent) {
            // Auto-create the agent on first use so iOS clients can start
            // agents without a separate registration step.
            let targetMachineId = requestedMachineId;

            if (!targetMachineId) {
              const onlineMachine = await dbRegistry.findOnlineMachine();

              if (!onlineMachine) {
                return reply.code(503).send({
                  error: 'NO_MACHINES_AVAILABLE',
                  message: 'Cannot auto-create agent: no online machines are registered',
                });
              }

              targetMachineId = onlineMachine.id;
            }

            const newAgentId = await dbRegistry.createAgent({
              machineId: targetMachineId,
              name: agentId,
              type: 'adhoc',
            });

            agent = await dbRegistry.getAgent(newAgentId);

            if (!agent) {
              return reply.code(500).send({
                error: 'AGENT_CREATE_FAILED',
                message: `Failed to auto-create agent for '${agentId}'`,
              });
            }

            app.log.info(
              { agentId: newAgentId, machineId: targetMachineId, originalId: agentId },
              'Auto-created adhoc agent on first use via HTTP',
            );
          }

          machineId = agent.machineId;
        }

        // Fall back to the agent's configured model and tools when
        // not explicitly overridden in the start request.
        const agentConfig = dbRegistry
          ? (await dbRegistry.getAgent(agentId))?.config
          : undefined;

        const jobData: AgentTaskJobData = {
          agentId,
          machineId,
          prompt: prompt ?? null,
          model: model ?? (agentConfig?.model as string | null) ?? null,
          trigger: 'manual',
          allowedTools: allowedTools ?? (agentConfig?.allowedTools as string[] | null) ?? null,
          resumeSession: resumeSession ?? null,
          createdAt: new Date().toISOString(),
        };

        const job = await taskQueue.add('agent:start', jobData);

        return { ok: true, agentId, jobId: job.id, prompt, model };
      }

      return { ok: true, agentId, prompt, model };
    },
  );

  app.post<{
    Params: { id: string };
    Body: SafetyDecisionRequest;
    Querystring: { workerUrl?: string; machineId?: string };
  }>(
    '/:id/safety-decision',
    {
      schema: {
        tags: ['agents'],
        summary: 'Apply a workdir safety decision to a pending agent run',
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      const { decision } = request.body;
      const query = request.query;

      if (!decision || !SAFETY_DECISIONS.includes(decision)) {
        return reply.code(400).send({
          error: 'INVALID_SAFETY_DECISION',
          message: `Decision must be one of: ${SAFETY_DECISIONS.join(', ')}`,
        });
      }

      const resolved = await resolveWorkerUrl(agentId, query, {
        registry,
        dbRegistry,
        workerPort,
      });
      if (!resolved.ok) {
        return reply
          .status(resolved.status)
          .send({ error: resolved.error, message: resolved.message });
      }

      const result = await proxyWorkerRequest({
        workerBaseUrl: resolved.url,
        path: `/api/agents/${encodeURIComponent(agentId)}/safety-decision`,
        method: 'POST',
        body: request.body,
      });

      return replyWithProxyResult(reply, result);
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/agents/:id/steer — proxy steering message to worker
  // ---------------------------------------------------------------------------

  app.post<{
    Params: { id: string };
    Body: { message: string };
    Querystring: { workerUrl?: string; machineId?: string };
  }>(
    '/:id/steer',
    {
      schema: {
        tags: ['agents'],
        summary: 'Inject a steering message into a running agent session',
      },
    },
    async (request, reply) => {
      const agentId = request.params.id;
      const { message } = request.body;
      const query = request.query;

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_STEER_MESSAGE',
          message: 'A non-empty "message" string is required',
        });
      }

      if (message.length > 32_000) {
        return reply.code(400).send({
          error: 'STEER_MESSAGE_TOO_LONG',
          message: 'Steering message must be under 32,000 characters',
        });
      }

      const resolved = await resolveWorkerUrl(agentId, query, {
        registry,
        dbRegistry,
        workerPort,
      });
      if (!resolved.ok) {
        return reply
          .status(resolved.status)
          .send({ error: resolved.error, message: resolved.message });
      }

      const result = await proxyWorkerRequest({
        workerBaseUrl: resolved.url,
        path: `/api/agents/${encodeURIComponent(agentId)}/steer`,
        method: 'POST',
        body: request.body,
      });

      return replyWithProxyResult(reply, result);
    },
  );

  app.post<{ Params: { id: string }; Body: StopAgentRequest }>(
    '/:id/stop',
    { schema: { tags: ['agents'], summary: 'Stop an agent' } },
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
      tokensIn?: number;
      tokensOut?: number;
      durationMs?: number;
      sessionId?: string;
      resultSummary?: ExecutionSummary;
    };
  }>(
    '/:id/complete',
    { schema: { tags: ['agents'], summary: 'Run completion callback' } },
    async (request, reply) => {
      if (!dbRegistry) {
        return reply.code(501).send({
          error: 'DATABASE_NOT_CONFIGURED',
          message: 'Completion endpoint requires a database registry',
        });
      }

      const {
        runId,
        status,
        errorMessage,
        costUsd,
        tokensIn,
        tokensOut,
        durationMs,
        sessionId,
        resultSummary,
      } = request.body;

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
          sessionId: sessionId ?? null,
          errorMessage: errorMessage ?? null,
          costUsd: costUsd != null ? String(costUsd) : null,
          tokensIn: tokensIn ?? null,
          tokensOut: tokensOut ?? null,
          resultSummary: resultSummary ?? null,
        });

        // Update agent's currentSessionId for session resume support
        if (sessionId && status === 'success') {
          try {
            await dbRegistry.updateAgent(request.params.id, {
              currentSessionId: sessionId,
            });
          } catch (err) {
            app.log.warn(
              { err, agentId: request.params.id, sessionId },
              'Failed to update agent currentSessionId',
            );
          }
        }

        // Create rc_sessions entry so Sessions section shows agent runs
        if (sessionId) {
          try {
            const agent = await dbRegistry.getAgent(request.params.id);
            await dbRegistry.createSessionFromRun({
              sessionId,
              agentId: request.params.id,
              machineId: agent?.machineId ?? 'unknown',
              status,
              projectPath: agent?.projectPath ?? null,
              model: agent?.config?.model ?? null,
              endedAt: new Date(),
            });
          } catch (sessionErr) {
            app.log.warn(
              { err: sessionErr, agentId: request.params.id, sessionId },
              'Failed to create rc_sessions entry from run completion — ignoring',
            );
          }
        }

        app.log.info(
          {
            agentId: request.params.id,
            runId,
            status,
            costUsd: costUsd ?? null,
            tokensIn: tokensIn ?? null,
            tokensOut: tokensOut ?? null,
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
          const summary =
            resultSummary?.executiveSummary ??
            resultSummary?.workCompleted ??
            `Agent run ${runId} completed successfully.`;

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
    },
  );

  // ---------------------------------------------------------------------------
  // Signal trigger — fire an external signal to trigger an agent run
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: SignalAgentRequest }>(
    '/:id/signal',
    { schema: { tags: ['agents'], summary: 'Signal a running agent' } },
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
        return reply.code(404).send({
          error: 'AGENT_NOT_FOUND',
          message: `Agent '${agentId}' does not exist in the registry`,
        });
      }

      const jobData: AgentTaskJobData = {
        agentId,
        machineId: agent.machineId,
        prompt,
        model: agent.config?.model ?? null,
        trigger: 'signal',
        allowedTools: agent.config?.allowedTools ?? null,
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
