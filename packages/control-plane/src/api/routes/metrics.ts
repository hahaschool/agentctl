import { ControlPlaneError, PrometheusRegistry } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import type { Mem0Client } from '../../memory/mem0-client.js';
import type { MachineRegistryLike } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import type { LiteLLMClient } from '../../router/litellm-client.js';
import { HEALTH_CHECK_TIMEOUT_MS } from '../constants.js';

const HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export type MetricsRoutesOptions = {
  registry?: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry;
  db?: Database;
  redis?: { ping: () => Promise<string> };
  mem0Client?: Mem0Client;
  litellmClient?: LiteLLMClient;
  runsDispatched?: { count: number };
  requestTracker: RequestTracker;
};

/**
 * In-memory request tracking state.
 *
 * Shared between the `onResponse` hook (which records each request)
 * and the `/metrics` handler (which reads the counters).
 */
export type RequestTracker = {
  /** Counter: total requests by {method, path, status} */
  requests: Map<string, number>;
  /** Histogram: request durations by {method, path} */
  durations: Map<string, { sum: number; count: number; buckets: number[] }>;
};

/**
 * Create a fresh request tracker instance.
 */
export function createRequestTracker(): RequestTracker {
  return {
    requests: new Map(),
    durations: new Map(),
  };
}

/**
 * Normalize a URL path to a route pattern so that dynamic segments
 * don't create cardinality explosions.
 *
 * Examples:
 *   /api/agents/abc-123/start  ->  /api/agents/:id/start
 *   /api/agents/abc-123/runs   ->  /api/agents/:id/runs
 *   /health                    ->  /health
 *   /metrics                   ->  /metrics
 */
export function normalizeRoutePath(url: string): string {
  // Strip query string
  const path = url.split('?')[0];

  // Split into segments and replace UUIDs / dynamic-looking IDs
  const segments = path.split('/');
  const normalized = segments.map((seg) => {
    if (!seg) {
      return seg;
    }
    // Match UUIDs (8-4-4-4-12) or general IDs (alphanumeric + hyphens, at least 4 chars)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) {
      return ':id';
    }
    // Match short IDs that look dynamic (mixed alphanum+hyphens, 4+ chars, not a pure word)
    if (/^[a-z0-9]+-[a-z0-9-]+$/i.test(seg) && seg.length >= 4) {
      return ':id';
    }
    return seg;
  });

  return normalized.join('/');
}

/**
 * Record a completed request in the tracker.
 */
export function recordRequest(
  tracker: RequestTracker,
  method: string,
  path: string,
  status: number,
  durationSeconds: number,
): void {
  const normalizedPath = normalizeRoutePath(path);
  const statusStr = String(status);

  // Increment request counter
  const counterKey = `${method}|${normalizedPath}|${statusStr}`;
  tracker.requests.set(counterKey, (tracker.requests.get(counterKey) ?? 0) + 1);

  // Record duration in histogram
  const histKey = `${method}|${normalizedPath}`;
  let hist = tracker.durations.get(histKey);
  if (!hist) {
    hist = {
      sum: 0,
      count: 0,
      buckets: new Array(HISTOGRAM_BUCKETS.length).fill(0) as number[],
    };
    tracker.durations.set(histKey, hist);
  }
  hist.sum += durationSeconds;
  hist.count += 1;
  for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) {
    if (durationSeconds <= HISTOGRAM_BUCKETS[i]) {
      hist.buckets[i] += 1;
    }
  }
}

/**
 * Check a dependency with a timeout. Returns true if healthy, false otherwise.
 */
async function isHealthy(name: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(new Error(`${name} health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)),
          HEALTH_CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

export const metricsRoutes: FastifyPluginAsync<MetricsRoutesOptions> = async (app, opts) => {
  const {
    registry,
    dbRegistry,
    db,
    redis,
    mem0Client,
    litellmClient,
    runsDispatched,
    requestTracker: tracker,
  } = opts;

  app.get(
    '/metrics',
    { schema: { tags: ['health'], summary: 'Get Prometheus metrics' } },
    async (_request, reply) => {
      const prom = new PrometheusRegistry();

      // --- Static gauges ---
      prom.register('agentctl_control_plane_up', 'Control plane is up', 'gauge');
      prom.set('agentctl_control_plane_up', 1);

      // --- Agent counts ---
      let totalAgents = 0;
      let activeAgents = 0;

      if (dbRegistry) {
        try {
          const allAgents = await dbRegistry.listAgents();
          totalAgents = allAgents.length;
          activeAgents = allAgents.filter((a) => a.status === 'running').length;
        } catch {
          // If DB is unreachable, leave counts at 0
        }
      } else if (registry) {
        const machines = await registry.listMachines();
        totalAgents = machines.length;
        // In-memory registry tracks machines, not individual agent status;
        // treat all registered machines as "active" for this gauge.
        activeAgents = machines.filter(
          (m) => (m as { status?: string }).status === 'online',
        ).length;
      }

      prom.register('agentctl_agents_total', 'Total registered agents', 'gauge');
      prom.set('agentctl_agents_total', totalAgents);

      prom.register('agentctl_agents_active', 'Currently running agents', 'gauge');
      prom.set('agentctl_agents_active', activeAgents);

      // --- Runs dispatched ---
      prom.register('agentctl_runs_total', 'Total runs dispatched', 'counter');
      prom.set('agentctl_runs_total', runsDispatched?.count ?? 0);

      // --- HTTP request tracking ---
      prom.register('agentctl_http_requests_total', 'Total HTTP requests', 'counter');
      for (const [key, count] of tracker.requests) {
        const [method, path, status] = key.split('|');
        prom.set('agentctl_http_requests_total', count, { method, path, status });
      }

      // --- HTTP request duration histogram ---
      // Since the PrometheusRegistry histogram API expects individual observe() calls
      // but we've pre-aggregated the data, render the histogram manually and append
      // it to the registry output.
      let histogramOutput = '';
      if (tracker.durations.size > 0) {
        histogramOutput +=
          '# HELP agentctl_http_request_duration_seconds HTTP request duration in seconds\n';
        histogramOutput += '# TYPE agentctl_http_request_duration_seconds histogram\n';

        for (const [key, hist] of tracker.durations) {
          const [method, path] = key.split('|');
          const baseLabels = `method="${method}",path="${path}"`;

          for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) {
            histogramOutput += `agentctl_http_request_duration_seconds_bucket{${baseLabels},le="${HISTOGRAM_BUCKETS[i]}"} ${hist.buckets[i]}\n`;
          }
          histogramOutput += `agentctl_http_request_duration_seconds_bucket{${baseLabels},le="+Inf"} ${hist.count}\n`;
          histogramOutput += `agentctl_http_request_duration_seconds_sum{${baseLabels}} ${hist.sum}\n`;
          histogramOutput += `agentctl_http_request_duration_seconds_count{${baseLabels}} ${hist.count}\n`;
        }
      }

      // --- Dependency health ---
      prom.register(
        'agentctl_dependency_healthy',
        'Dependency health status (1=healthy, 0=unhealthy)',
        'gauge',
      );

      const [pgHealthy, redisHealthy, mem0Healthy, litellmHealthy] = await Promise.all([
        db
          ? isHealthy('postgres', async () => {
              const { sql: sqlTag } = await import('drizzle-orm');
              await db.execute(sqlTag`SELECT 1`);
            })
          : true,
        redis
          ? isHealthy('redis', async () => {
              await redis.ping();
            })
          : true,
        mem0Client
          ? isHealthy('mem0', async () => {
              const healthy = await mem0Client.health();
              if (!healthy)
                throw new ControlPlaneError('HEALTH_CHECK_FAILED', 'Mem0 health check failed', {
                  component: 'mem0',
                });
            })
          : true,
        litellmClient
          ? isHealthy('litellm', async () => {
              const healthy = await litellmClient.health();
              if (!healthy)
                throw new ControlPlaneError('HEALTH_CHECK_FAILED', 'LiteLLM health check failed', {
                  component: 'litellm',
                });
            })
          : true,
      ]);

      prom.set('agentctl_dependency_healthy', pgHealthy ? 1 : 0, { name: 'postgres' });
      prom.set('agentctl_dependency_healthy', redisHealthy ? 1 : 0, { name: 'redis' });
      prom.set('agentctl_dependency_healthy', mem0Healthy ? 1 : 0, { name: 'mem0' });
      prom.set('agentctl_dependency_healthy', litellmHealthy ? 1 : 0, { name: 'litellm' });

      // --- Combine output ---
      const registryOutput = prom.render();
      const fullOutput = registryOutput + histogramOutput;

      return reply
        .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
        .send(fullOutput);
    },
  );
};
