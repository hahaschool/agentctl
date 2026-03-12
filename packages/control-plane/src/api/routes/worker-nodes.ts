import {
  ControlPlaneError,
  type FleetOverview,
  isWorkerNodeStatus,
  WORKER_NODE_STATUSES,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { TaskRunStore } from '../../collaboration/task-run-store.js';
import type { WorkerNodeStore } from '../../collaboration/worker-node-store.js';

export type WorkerNodeRoutesOptions = {
  workerNodeStore: WorkerNodeStore;
  taskRunStore: TaskRunStore;
};

export const workerNodeRoutes: FastifyPluginAsync<WorkerNodeRoutesOptions> = async (app, opts) => {
  const { workerNodeStore, taskRunStore } = opts;

  // ── Register Node ──────────────────────────────────────────

  app.post<{
    Body: {
      hostname: string;
      tailscaleIp: string;
      maxConcurrentAgents?: number;
      capabilities?: string[];
    };
  }>(
    '/',
    { schema: { tags: ['fleet'], summary: 'Register a worker node' } },
    async (request, reply) => {
      const { hostname, tailscaleIp, maxConcurrentAgents, capabilities } = request.body;

      if (!hostname || typeof hostname !== 'string' || hostname.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_HOSTNAME',
          message: 'A non-empty "hostname" string is required',
        });
      }

      if (!tailscaleIp || typeof tailscaleIp !== 'string' || tailscaleIp.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_TAILSCALE_IP',
          message: 'A non-empty "tailscaleIp" string is required',
        });
      }

      const node = await workerNodeStore.registerNode({
        hostname: hostname.trim(),
        tailscaleIp: tailscaleIp.trim(),
        maxConcurrentAgents,
        capabilities,
      });

      return reply.code(201).send(node);
    },
  );

  // ── List Nodes ─────────────────────────────────────────────

  app.get('/', { schema: { tags: ['fleet'], summary: 'List all worker nodes' } }, async () => {
    return await workerNodeStore.listNodes();
  });

  // ── Get Node ───────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['fleet'], summary: 'Get worker node by ID' } },
    async (request, reply) => {
      const node = await workerNodeStore.getNode(request.params.id);
      if (!node) {
        return reply.code(404).send({
          error: 'NODE_NOT_FOUND',
          message: 'Worker node not found',
        });
      }
      return node;
    },
  );

  // ── Heartbeat ──────────────────────────────────────────────

  app.post<{ Params: { id: string }; Body: { currentLoad?: number } }>(
    '/:id/heartbeat',
    { schema: { tags: ['fleet'], summary: 'Update worker node heartbeat' } },
    async (request, reply) => {
      try {
        await workerNodeStore.updateHeartbeat(request.params.id);

        if (typeof request.body.currentLoad === 'number') {
          await workerNodeStore.updateLoad(request.params.id, request.body.currentLoad);
        }

        return { ok: true };
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'NODE_NOT_FOUND') {
          return reply.code(404).send({
            error: 'NODE_NOT_FOUND',
            message: 'Worker node not found',
          });
        }
        throw err;
      }
    },
  );

  // ── Update Status ──────────────────────────────────────────

  app.patch<{
    Params: { id: string };
    Body: { status: string };
  }>(
    '/:id',
    { schema: { tags: ['fleet'], summary: 'Update worker node status' } },
    async (request, reply) => {
      const { status } = request.body;

      if (!status || !isWorkerNodeStatus(status)) {
        return reply.code(400).send({
          error: 'INVALID_STATUS',
          message: `status must be one of: ${WORKER_NODE_STATUSES.join(', ')}`,
        });
      }

      try {
        await workerNodeStore.setStatus(request.params.id, status);
        return { ok: true };
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'NODE_NOT_FOUND') {
          return reply.code(404).send({
            error: 'NODE_NOT_FOUND',
            message: 'Worker node not found',
          });
        }
        throw err;
      }
    },
  );

  // ── Fleet Overview ─────────────────────────────────────────

  app.get(
    '/overview',
    { schema: { tags: ['fleet'], summary: 'Get aggregate fleet status' } },
    async () => {
      const nodes = await workerNodeStore.listNodes();
      const runs = await taskRunStore.listRuns();

      const overview: FleetOverview = {
        totalNodes: nodes.length,
        onlineNodes: nodes.filter((n) => n.status === 'online').length,
        offlineNodes: nodes.filter((n) => n.status === 'offline').length,
        drainingNodes: nodes.filter((n) => n.status === 'draining').length,
        totalAgentInstances: 0, // TODO: add agent instance store query
        activeTaskRuns: runs.filter((r) => r.status === 'running' || r.status === 'claimed').length,
        pendingTaskRuns: runs.filter((r) => r.status === 'pending').length,
        completedTaskRuns: runs.filter((r) => r.status === 'completed').length,
        failedTaskRuns: runs.filter((r) => r.status === 'failed').length,
      };

      return overview;
    },
  );
};
