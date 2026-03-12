import { ControlPlaneError, isTaskRunStatus, TASK_RUN_STATUSES } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { TaskRunStore } from '../../collaboration/task-run-store.js';
import type { WorkerLeaseStore } from '../../collaboration/worker-lease-store.js';

export type TaskRunRoutesOptions = {
  taskRunStore: TaskRunStore;
  workerLeaseStore: WorkerLeaseStore;
};

export const taskRunRoutes: FastifyPluginAsync<TaskRunRoutesOptions> = async (app, opts) => {
  const { taskRunStore, workerLeaseStore } = opts;

  // ── Create Run ─────────────────────────────────────────────

  app.post<{
    Body: {
      definitionId: string;
      spaceId?: string;
      threadId?: string;
    };
  }>(
    '/',
    { schema: { tags: ['task-runs'], summary: 'Create a task run' } },
    async (request, reply) => {
      const { definitionId, spaceId, threadId } = request.body;

      if (!definitionId || typeof definitionId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_DEFINITION_ID',
          message: 'A non-empty "definitionId" string is required',
        });
      }

      const run = await taskRunStore.createRun({ definitionId, spaceId, threadId });
      return reply.code(201).send(run);
    },
  );

  // ── Get Run ────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['task-runs'], summary: 'Get task run by ID' } },
    async (request, reply) => {
      const run = await taskRunStore.getRun(request.params.id);
      if (!run) {
        return reply.code(404).send({
          error: 'RUN_NOT_FOUND',
          message: 'Task run not found',
        });
      }

      const lease = await workerLeaseStore.getLease(run.id);
      return { ...run, lease: lease ?? null };
    },
  );

  // ── Update Status ──────────────────────────────────────────

  app.patch<{
    Params: { id: string };
    Body: {
      status: string;
      result?: Record<string, unknown>;
      error?: Record<string, unknown>;
    };
  }>(
    '/:id',
    { schema: { tags: ['task-runs'], summary: 'Update task run status' } },
    async (request, reply) => {
      const { status, result, error } = request.body;

      if (!status || !isTaskRunStatus(status)) {
        return reply.code(400).send({
          error: 'INVALID_STATUS',
          message: `status must be one of: ${TASK_RUN_STATUSES.join(', ')}`,
        });
      }

      try {
        const run = await taskRunStore.updateStatus(request.params.id, {
          status,
          result,
          error,
        });
        return run;
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'RUN_NOT_FOUND') {
          return reply.code(404).send({
            error: 'RUN_NOT_FOUND',
            message: 'Task run not found',
          });
        }
        throw err;
      }
    },
  );

  // ── Claim Lease ────────────────────────────────────────────

  app.post<{
    Params: { id: string };
    Body: {
      workerId: string;
      agentInstanceId: string;
      durationMs?: number;
    };
  }>(
    '/:id/claim',
    { schema: { tags: ['task-runs'], summary: 'Claim a worker lease for this task run' } },
    async (request, reply) => {
      const { workerId, agentInstanceId, durationMs } = request.body;

      if (!workerId || typeof workerId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_WORKER_ID',
          message: 'A non-empty "workerId" string is required',
        });
      }

      if (!agentInstanceId || typeof agentInstanceId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_AGENT_INSTANCE_ID',
          message: 'A non-empty "agentInstanceId" string is required',
        });
      }

      // Verify run exists and is pending
      const run = await taskRunStore.getRun(request.params.id);
      if (!run) {
        return reply.code(404).send({
          error: 'RUN_NOT_FOUND',
          message: 'Task run not found',
        });
      }

      if (run.status !== 'pending') {
        return reply.code(409).send({
          error: 'RUN_NOT_CLAIMABLE',
          message: `Task run is in '${run.status}' status, only 'pending' runs can be claimed`,
        });
      }

      try {
        const lease = await workerLeaseStore.claimLease(
          request.params.id,
          workerId,
          agentInstanceId,
          durationMs,
        );

        // Update run status to claimed
        await taskRunStore.updateStatus(request.params.id, { status: 'claimed' });

        return reply.code(201).send(lease);
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'LEASE_ALREADY_EXISTS') {
          return reply.code(409).send({
            error: 'LEASE_ALREADY_EXISTS',
            message: 'A lease already exists for this task run',
          });
        }
        throw err;
      }
    },
  );

  // ── Heartbeat (Renew Lease) ────────────────────────────────

  app.post<{
    Params: { id: string };
    Body: { durationMs?: number };
  }>(
    '/:id/heartbeat',
    { schema: { tags: ['task-runs'], summary: 'Renew worker lease and update heartbeat' } },
    async (request, reply) => {
      const { durationMs } = request.body;

      try {
        const lease = await workerLeaseStore.renewLease(request.params.id, durationMs);
        await taskRunStore.updateHeartbeat(request.params.id);
        return lease;
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'LEASE_NOT_FOUND') {
          return reply.code(404).send({
            error: 'LEASE_NOT_FOUND',
            message: 'No active lease found for this task run',
          });
        }
        throw err;
      }
    },
  );

  // ── List Runs ──────────────────────────────────────────────

  app.get('/', { schema: { tags: ['task-runs'], summary: 'List all task runs' } }, async () => {
    return await taskRunStore.listRuns();
  });
};
