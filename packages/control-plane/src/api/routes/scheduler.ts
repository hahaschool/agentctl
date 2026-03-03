import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { RepeatableJobManager } from '../../scheduler/repeatable-jobs.js';

export type SchedulerRoutesOptions = {
  repeatableJobManager: RepeatableJobManager | null;
};

export const schedulerRoutes: FastifyPluginAsync<SchedulerRoutesOptions> = async (app, opts) => {
  const { repeatableJobManager } = opts;

  // ---------------------------------------------------------------------------
  // Guard — return 501 for all routes when the manager is not configured
  // ---------------------------------------------------------------------------

  app.addHook('preHandler', async (_request, reply) => {
    if (!repeatableJobManager) {
      return reply.code(501).send({
        error: 'SCHEDULER_NOT_CONFIGURED',
        message: 'Repeatable job scheduler is not configured',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /jobs — List all repeatable jobs
  // ---------------------------------------------------------------------------

  app.get(
    '/jobs',
    { schema: { tags: ['scheduler'], summary: 'List all repeatable jobs' } },
    async (_request, reply) => {
      try {
        const jobs = await repeatableJobManager?.listRepeatableJobs();

        return { jobs };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(500).send({ error: error.code, message: error.message });
        }
        return reply
          .code(500)
          .send({ error: 'LIST_JOBS_FAILED', message: 'Failed to list repeatable jobs' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /jobs/heartbeat — Add a heartbeat (interval-based) repeatable job
  // ---------------------------------------------------------------------------

  app.post<{
    Body: { agentId: string; machineId: string; intervalMs: number };
  }>(
    '/jobs/heartbeat',
    { schema: { tags: ['scheduler'], summary: 'Create heartbeat schedule' } },
    async (request, reply) => {
      const { agentId, machineId, intervalMs } = request.body;

      if (!agentId || typeof agentId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_AGENT_ID',
          message: 'A non-empty "agentId" string is required',
        });
      }

      if (!machineId || typeof machineId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_MACHINE_ID',
          message: 'A non-empty "machineId" string is required',
        });
      }

      if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) {
        return reply.code(400).send({
          error: 'INVALID_INTERVAL',
          message: '"intervalMs" must be a positive number',
        });
      }

      try {
        await repeatableJobManager?.addHeartbeatJob(agentId, intervalMs, {
          agentId,
          machineId,
          prompt: null,
          model: null,
          trigger: 'heartbeat',
          allowedTools: null,
          resumeSession: null,
          createdAt: new Date().toISOString(),
        });

        return { ok: true, agentId, machineId, intervalMs };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(500).send({ error: error.code, message: error.message });
        }
        return reply
          .code(500)
          .send({ error: 'ADD_HEARTBEAT_FAILED', message: 'Failed to add heartbeat job' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // POST /jobs/cron — Add a cron-based repeatable job
  // ---------------------------------------------------------------------------

  app.post<{
    Body: { agentId: string; machineId: string; pattern: string; model?: string };
  }>(
    '/jobs/cron',
    { schema: { tags: ['scheduler'], summary: 'Create cron schedule' } },
    async (request, reply) => {
      const { agentId, machineId, pattern, model } = request.body;

      if (!agentId || typeof agentId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_AGENT_ID',
          message: 'A non-empty "agentId" string is required',
        });
      }

      if (!machineId || typeof machineId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_MACHINE_ID',
          message: 'A non-empty "machineId" string is required',
        });
      }

      if (!pattern || typeof pattern !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_CRON_PATTERN',
          message: 'A non-empty "pattern" string is required',
        });
      }

      try {
        await repeatableJobManager?.addCronJob(agentId, pattern, {
          agentId,
          machineId,
          prompt: null,
          model: model ?? null,
          trigger: 'schedule',
          allowedTools: null,
          resumeSession: null,
          createdAt: new Date().toISOString(),
        });

        return { ok: true, agentId, machineId, pattern, model: model ?? null };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(500).send({ error: error.code, message: error.message });
        }
        return reply
          .code(500)
          .send({ error: 'ADD_CRON_FAILED', message: 'Failed to add cron job' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // DELETE /jobs/:key — Remove a specific repeatable job by key
  // ---------------------------------------------------------------------------

  app.delete<{ Params: { key: string } }>(
    '/jobs/:key',
    { schema: { tags: ['scheduler'], summary: 'Remove a scheduled job by key' } },
    async (request, reply) => {
      const { key } = request.params;

      try {
        const removedCount = await repeatableJobManager?.removeJobsByAgentId(key);

        return { ok: true, key, removedCount };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(500).send({ error: error.code, message: error.message });
        }
        return reply
          .code(500)
          .send({ error: 'REMOVE_JOB_FAILED', message: 'Failed to remove repeatable job' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // DELETE /jobs — Remove ALL repeatable jobs (requires ?confirm=true)
  // ---------------------------------------------------------------------------

  app.delete<{ Querystring: { confirm?: string } }>(
    '/jobs',
    { schema: { tags: ['scheduler'], summary: 'Remove all jobs (requires ?confirm=true)' } },
    async (request, reply) => {
      const { confirm } = request.query;

      if (confirm !== 'true') {
        return reply.code(400).send({
          error: 'CONFIRMATION_REQUIRED',
          message: 'Removing all repeatable jobs requires ?confirm=true query parameter',
        });
      }

      try {
        // The preHandler guarantees repeatableJobManager is non-null here.
        const manager = repeatableJobManager as NonNullable<typeof repeatableJobManager>;
        const jobs = await manager.listRepeatableJobs();

        // Remove jobs one by one using removeJobsByAgentId for each unique agent
        // by extracting the agentId from each job key
        const seenAgents = new Set<string>();
        let totalRemoved = 0;

        for (const job of jobs) {
          // Job keys follow the pattern "prefix:agentId" — extract the agentId
          const parts = job.key.split(':');
          const agentId = parts.length > 1 ? parts.slice(1).join(':') : job.key;

          if (!seenAgents.has(agentId)) {
            seenAgents.add(agentId);
            const removed = await manager.removeJobsByAgentId(agentId);
            totalRemoved += removed;
          }
        }

        return { ok: true, removedCount: totalRemoved };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(500).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'REMOVE_ALL_JOBS_FAILED',
          message: 'Failed to remove all repeatable jobs',
        });
      }
    },
  );
};
