import { DEFAULT_WORKER_PORT } from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import type { MachineRegistryLike } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { EMERGENCY_STOP_TIMEOUT_MS } from '../constants.js';
import { proxyWorkerRequest, replyWithProxyResult } from '../proxy-worker-request.js';
import { readRateLimitEnv } from '../rate-limit.js';
import { resolveWorkerUrl } from '../resolve-worker-url.js';

export type EmergencyStopRoutesOptions = {
  registry: MachineRegistryLike;
  dbRegistry?: DbAgentRegistry | null;
  workerPort?: number;
};

// Rate-limit the emergency-stop writes: a single request can shut down an
// agent or fan out stop commands to every worker in the fleet. A flood could
// repeatedly trigger expensive worker-side teardown, saturate outbound fan-out
// traffic, or be used as a denial-of-service vector against the fleet.
const EMERGENCY_STOP_RATE_LIMIT = {
  max: 20,
  timeWindow: 60_000,
} as const;

/**
 * Fastify plugin that registers emergency stop proxy routes.
 *
 * Single-agent stop is proxied to the worker running that agent.
 * Stop-all fans out to ALL known online worker machines.
 */
export const emergencyStopProxyRoutes: FastifyPluginAsync<EmergencyStopRoutesOptions> = async (
  app,
  opts,
) => {
  const { registry, dbRegistry, workerPort = DEFAULT_WORKER_PORT } = opts;

  const emergencyStopRateLimitMax = readRateLimitEnv(
    'EMERGENCY_STOP_RATE_LIMIT_MAX',
    EMERGENCY_STOP_RATE_LIMIT.max,
  );
  const emergencyStopRateLimitWindowMs = readRateLimitEnv(
    'EMERGENCY_STOP_RATE_LIMIT_WINDOW_MS',
    EMERGENCY_STOP_RATE_LIMIT.timeWindow,
  );
  const emergencyStopRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many emergency stop requests',
  });
  const emergencyStopFastifyRateLimit = {
    max: emergencyStopRateLimitMax,
    timeWindow: emergencyStopRateLimitWindowMs,
    errorResponseBuilder: emergencyStopRateLimitError,
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) =>
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown'),
    errorResponseBuilder: emergencyStopRateLimitError,
  });

  // POST /api/agents/:id/emergency-stop — Emergency stop a single agent (proxy to worker)
  app.post<{
    Params: { id: string };
    Querystring: { workerUrl?: string; machineId?: string };
  }>(
    '/:id/emergency-stop',
    {
      schema: { tags: ['agents'], summary: 'Emergency stop a single agent' },
      config: { rateLimit: emergencyStopFastifyRateLimit },
      preHandler: [app.rateLimit(emergencyStopFastifyRateLimit)],
    },
    async (request, reply) => {
      const agentId = request.params.id;

      app.log.error({ agentId }, 'Emergency stop requested via control plane');

      const resolved = await resolveWorkerUrl(agentId, request.query, {
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
        path: `/api/agents/${encodeURIComponent(agentId)}/emergency-stop`,
        method: 'POST',
        timeoutMs: EMERGENCY_STOP_TIMEOUT_MS,
      });
      if (!result.ok) {
        return replyWithProxyResult(reply, result);
      }

      // Update agent status in the database to 'stopped'
      if (dbRegistry) {
        try {
          await dbRegistry.updateAgentStatus(agentId, 'stopped');
        } catch {
          // Best-effort: don't fail the emergency stop if the DB update fails
          app.log.warn({ agentId }, 'Failed to update agent status in DB after emergency stop');
        }
      }

      return replyWithProxyResult(reply, result);
    },
  );

  // POST /api/agents/emergency-stop-all — Emergency stop ALL agents on ALL workers
  app.post(
    '/emergency-stop-all',
    {
      schema: { tags: ['agents'], summary: 'Emergency stop all agents on all workers' },
      config: { rateLimit: emergencyStopFastifyRateLimit },
      preHandler: [app.rateLimit(emergencyStopFastifyRateLimit)],
    },
    async (_request, reply) => {
      app.log.error('Emergency stop ALL requested via control plane');

      type MachineResult = {
        machineId: string;
        stoppedCount: number;
        error?: string;
      };

      const results: MachineResult[] = [];

      // Get all registered machines
      let allMachines: { hostname: string; tailscaleIp?: string; [key: string]: unknown }[];

      if (dbRegistry) {
        allMachines = await dbRegistry.listMachines();
      } else {
        allMachines = await registry.listMachines();
      }

      // Fan out emergency-stop-all to each online machine
      const proxyPromises = allMachines.map(async (machine) => {
        const machineId = (machine.id ?? machine.machineId ?? machine.hostname) as string;
        const machineStatus = machine.status as string | undefined;

        // Skip offline machines
        if (machineStatus === 'offline') {
          results.push({ machineId, stoppedCount: 0, error: 'machine_offline' });
          return;
        }

        const address = machine.tailscaleIp ?? machine.hostname;
        const workerUrl = `http://${address}:${String(workerPort)}`;

        const result = await proxyWorkerRequest({
          workerBaseUrl: workerUrl,
          path: '/api/agents/emergency-stop-all',
          method: 'POST',
          timeoutMs: EMERGENCY_STOP_TIMEOUT_MS,
        });

        if (!result.ok) {
          results.push({ machineId, stoppedCount: 0, error: result.message });
          return;
        }

        const data = result.data as { stoppedCount?: number };
        results.push({ machineId, stoppedCount: data.stoppedCount ?? 0 });
      });

      await Promise.allSettled(proxyPromises);

      app.log.error({ results }, 'Emergency stop ALL completed across all machines');

      return reply.status(200).send({
        ok: true,
        results,
      });
    },
  );
};
