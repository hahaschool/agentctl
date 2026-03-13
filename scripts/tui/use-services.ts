// =============================================================================
// Hook: poll service health endpoints every 5 seconds
// =============================================================================

import { useEffect, useState } from 'react';

import type { ServiceInfo, ServiceStatus } from './types.js';

const POLL_INTERVAL_MS = 5_000;

const CONTROL_URL = (process.env.CONTROL_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const WORKER_URL = (process.env.WORKER_URL ?? 'http://localhost:9000').replace(/\/$/, '');
const WEB_URL = (process.env.WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');

function portFromUrl(url: string, fallback: number): number {
  try {
    const parsed = new URL(url);
    return parsed.port ? Number(parsed.port) : fallback;
  } catch {
    return fallback;
  }
}

const CP_PORT = portFromUrl(CONTROL_URL, 8080);
const WORKER_PORT = portFromUrl(WORKER_URL, 9000);
const WEB_PORT = portFromUrl(WEB_URL, 5173);
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);
const PG_PORT = Number(process.env.PG_PORT ?? 5433);

type HealthResponse = {
  readonly status?: string;
  readonly uptime?: number;
  readonly memory?: { rss?: number; heapUsed?: number };
  readonly dependencies?: Record<string, { status?: string }>;
};

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3_600)}h${Math.floor((seconds % 3_600) / 60)}m`;
}

function formatMemory(bytes: number): string {
  const mb = bytes / 1_048_576;
  return `${mb.toFixed(0)}MB`;
}

async function fetchServiceHealth(
  url: string,
  healthPath: string,
): Promise<{ status: ServiceStatus; uptime: string | null; memory: string | null }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const response = await fetch(`${url}${healthPath}`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return { status: 'error', uptime: null, memory: null };
    }

    const data = (await response.json()) as HealthResponse;
    const uptime = typeof data.uptime === 'number' ? formatUptime(data.uptime) : null;
    const memory = data.memory?.rss ? formatMemory(data.memory.rss) : null;

    return {
      status: data.status === 'ok' || data.status === 'healthy' ? 'ok' : 'error',
      uptime,
      memory,
    };
  } catch {
    return { status: 'error', uptime: null, memory: null };
  }
}

async function fetchSimpleHealth(url: string): Promise<ServiceStatus> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

function buildInitialServices(): readonly ServiceInfo[] {
  return [
    { name: 'Control Plane', port: CP_PORT, status: 'loading', uptime: null, memory: null },
    { name: 'Agent Worker', port: WORKER_PORT, status: 'loading', uptime: null, memory: null },
    { name: 'Web App', port: WEB_PORT, status: 'loading', uptime: null, memory: null },
    { name: 'Redis', port: REDIS_PORT, status: 'loading', uptime: null, memory: null },
    { name: 'PostgreSQL', port: PG_PORT, status: 'loading', uptime: null, memory: null },
  ];
}

export function useServices(): readonly ServiceInfo[] {
  const [services, setServices] = useState<readonly ServiceInfo[]>(buildInitialServices);

  useEffect(() => {
    let active = true;

    const poll = async (): Promise<void> => {
      const [cp, worker, web] = await Promise.all([
        fetchServiceHealth(CONTROL_URL, '/api/health'),
        fetchServiceHealth(WORKER_URL, '/api/health'),
        fetchSimpleHealth(WEB_URL),
      ]);

      // Redis and PostgreSQL status come from the CP health endpoint dependencies
      let redisStatus: ServiceStatus = 'error';
      let pgStatus: ServiceStatus = 'error';

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3_000);
        const response = await fetch(`${CONTROL_URL}/api/health`, { signal: controller.signal });
        clearTimeout(timeout);

        if (response.ok) {
          const data = (await response.json()) as HealthResponse;
          if (data.dependencies?.redis?.status === 'ok') redisStatus = 'ok';
          if (data.dependencies?.database?.status === 'ok') pgStatus = 'ok';
          if (data.dependencies?.postgresql?.status === 'ok') pgStatus = 'ok';
        }
      } catch {
        // Leave as error
      }

      if (!active) return;

      setServices([
        {
          name: 'Control Plane',
          port: CP_PORT,
          status: cp.status,
          uptime: cp.uptime,
          memory: cp.memory,
        },
        {
          name: 'Agent Worker',
          port: WORKER_PORT,
          status: worker.status,
          uptime: worker.uptime,
          memory: worker.memory,
        },
        {
          name: 'Web App',
          port: WEB_PORT,
          status: typeof web === 'string' ? web : 'error',
          uptime: null,
          memory: null,
        },
        { name: 'Redis', port: REDIS_PORT, status: redisStatus, uptime: null, memory: null },
        { name: 'PostgreSQL', port: PG_PORT, status: pgStatus, uptime: null, memory: null },
      ]);
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return services;
}
