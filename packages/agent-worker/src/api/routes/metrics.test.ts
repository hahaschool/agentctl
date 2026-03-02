import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentPool } from '../../runtime/agent-pool.js';
import { createWorkerServer } from '../server.js';

// Mock the SDK runner so agents fall back to stub simulation immediately
vi.mock('../../runtime/sdk-runner.js', () => ({
  runWithSdk: vi.fn().mockResolvedValue(null),
}));

// Mock the audit logger so tests don't touch the filesystem.
vi.mock('../../hooks/audit-logger.js', () => {
  class AuditLogger {
    async write(): Promise<void> {}
    getLogFilePath(): string {
      return '/dev/null';
    }
  }
  return {
    AuditLogger,
    sha256: () => 'mock-hash',
  };
});

const MACHINE_ID = 'test-machine-metrics';

function createMockLogger(): pino.Logger {
  return pino({ level: 'silent' });
}

describe('GET /metrics (agent-worker)', () => {
  let app: FastifyInstance;
  let pool: AgentPool;

  beforeAll(async () => {
    const logger = createMockLogger();
    pool = new AgentPool({ logger, maxConcurrent: 3 });
    app = await createWorkerServer({
      logger,
      agentPool: pool,
      machineId: MACHINE_ID,
    });
    await app.ready();
  });

  afterAll(async () => {
    await pool.stopAll();
    await app.close();
  });

  it('returns 200 with text/plain content type', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
  });

  it('contains agentctl_worker_up gauge', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    const body = response.body;
    expect(body).toContain('# HELP agentctl_worker_up');
    expect(body).toContain('# TYPE agentctl_worker_up gauge');
    expect(body).toContain('agentctl_worker_up 1');
  });

  it('contains agentctl_worker_agents_active gauge', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.body).toContain('# TYPE agentctl_worker_agents_active gauge');
    expect(response.body).toContain('agentctl_worker_agents_active 0');
  });

  it('contains agentctl_worker_agents_started_total counter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.body).toContain('# TYPE agentctl_worker_agents_started_total counter');
    expect(response.body).toContain('agentctl_worker_agents_started_total 0');
  });

  it('contains agentctl_worker_memory_bytes gauge', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    const body = response.body;
    expect(body).toContain('# HELP agentctl_worker_memory_bytes');
    expect(body).toContain('# TYPE agentctl_worker_memory_bytes gauge');
    // RSS should be a positive number (in bytes, typically > 1MB)
    const match = body.match(/agentctl_worker_memory_bytes (\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThan(0);
  });

  it('contains agentctl_worker_uptime_seconds gauge', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    const body = response.body;
    expect(body).toContain('# HELP agentctl_worker_uptime_seconds');
    expect(body).toContain('# TYPE agentctl_worker_uptime_seconds gauge');
    const match = body.match(/agentctl_worker_uptime_seconds (\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(0);
  });

  it('outputs valid Prometheus text format with HELP and TYPE for every metric', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    const body = response.body;
    const lines = body.split('\n');

    // Every metric should have a HELP and TYPE line before its value
    const metricNames = [
      'agentctl_worker_up',
      'agentctl_worker_agents_active',
      'agentctl_worker_agents_started_total',
      'agentctl_worker_memory_bytes',
      'agentctl_worker_uptime_seconds',
    ];

    for (const name of metricNames) {
      expect(lines.some((l: string) => l.startsWith(`# HELP ${name}`))).toBe(true);
      expect(lines.some((l: string) => l.startsWith(`# TYPE ${name}`))).toBe(true);
    }
  });

  it('ends output with a trailing newline', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.body.endsWith('\n')).toBe(true);
  });
});
