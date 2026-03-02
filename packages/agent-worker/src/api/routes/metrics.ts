import { PrometheusRegistry } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { AgentPool } from '../../runtime/agent-pool.js';

export type WorkerMetricsRoutesOptions = {
  agentPool: AgentPool;
};

const startTime = Date.now();

export const workerMetricsRoutes: FastifyPluginAsync<WorkerMetricsRoutesOptions> = async (
  app,
  opts,
) => {
  const { agentPool } = opts;

  app.get('/metrics', async (_request, reply) => {
    const prom = new PrometheusRegistry();

    // --- Static gauge ---
    prom.register('agentctl_worker_up', 'Worker is up', 'gauge');
    prom.set('agentctl_worker_up', 1);

    // --- Agent pool gauges ---
    prom.register(
      'agentctl_worker_agents_active',
      'Currently active agents on this worker',
      'gauge',
    );
    prom.set('agentctl_worker_agents_active', agentPool.getRunningCount());

    // --- Agent start counter ---
    prom.register(
      'agentctl_worker_agents_started_total',
      'Total agents started on this worker',
      'counter',
    );
    prom.set('agentctl_worker_agents_started_total', agentPool.getTotalAgentsStarted());

    // --- Memory usage ---
    prom.register('agentctl_worker_memory_bytes', 'Worker process RSS in bytes', 'gauge');
    prom.set('agentctl_worker_memory_bytes', process.memoryUsage().rss);

    // --- Uptime ---
    prom.register('agentctl_worker_uptime_seconds', 'Worker uptime in seconds', 'gauge');
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    prom.set('agentctl_worker_uptime_seconds', uptimeSeconds);

    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(prom.render());
  });
};
