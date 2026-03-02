import http from 'node:http';
import type { AddressInfo } from 'node:net';
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

const MACHINE_ID = 'test-machine-health';

function createMockLogger(): pino.Logger {
  return pino({ level: 'silent' });
}

// ── Control plane reachable ──────────────────────────────────────────────
describe('GET /health (control plane reachable)', () => {
  let app: FastifyInstance;
  let pool: AgentPool;
  let fakeServer: http.Server;
  let fakeServerUrl: string;

  beforeAll(async () => {
    // Start a tiny HTTP server that returns 200 on /health
    fakeServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      fakeServer.listen(0, '127.0.0.1', resolve);
    });

    const addr = fakeServer.address() as AddressInfo;
    fakeServerUrl = `http://127.0.0.1:${addr.port}`;

    const logger = createMockLogger();
    pool = new AgentPool({ logger, maxConcurrent: 3 });
    app = await createWorkerServer({
      logger,
      agentPool: pool,
      machineId: MACHINE_ID,
      controlPlaneUrl: fakeServerUrl,
    });
    await app.ready();
  });

  afterAll(async () => {
    await pool.stopAll();
    await app.close();
    await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
  });

  it('returns ok status when control plane is reachable', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('ok');
  });

  it('returns ok with dependency detail when detail=true', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.dependencies.controlPlane.status).toBe('ok');
    expect(body.dependencies.controlPlane.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('preserves existing pool stats in response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const body = response.json();
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.activeAgents).toBe('number');
    expect(typeof body.totalAgentsStarted).toBe('number');
    expect(typeof body.worktreesActive).toBe('number');
    expect(typeof body.memoryUsage).toBe('number');
    expect(body.agents).toBeDefined();
    expect(body.agents.maxConcurrent).toBe(3);
  });
});

// ── Control plane unreachable ────────────────────────────────────────────
describe('GET /health (control plane unreachable)', () => {
  let app: FastifyInstance;
  let pool: AgentPool;

  beforeAll(async () => {
    const logger = createMockLogger();
    pool = new AgentPool({ logger, maxConcurrent: 3 });
    // Point to a port that nothing is listening on
    app = await createWorkerServer({
      logger,
      agentPool: pool,
      machineId: MACHINE_ID,
      controlPlaneUrl: 'http://127.0.0.1:1',
    });
    await app.ready();
  });

  afterAll(async () => {
    await pool.stopAll();
    await app.close();
  });

  it('returns degraded status when control plane is unreachable', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('degraded');
  });

  it('shows control plane error in detail mode', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.dependencies.controlPlane.status).toBe('error');
    expect(body.dependencies.controlPlane.error).toBeDefined();
  });

  it('still returns pool stats even when degraded', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const body = response.json();
    expect(body.agents).toBeDefined();
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.memoryUsage).toBe('number');
  });
});

// ── Control plane returns error status ────────────────────────────────────
describe('GET /health (control plane returns HTTP error)', () => {
  let app: FastifyInstance;
  let pool: AgentPool;
  let fakeServer: http.Server;
  let fakeServerUrl: string;

  beforeAll(async () => {
    // Start a tiny HTTP server that returns 500 on /health
    fakeServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Internal failure' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      fakeServer.listen(0, '127.0.0.1', resolve);
    });

    const addr = fakeServer.address() as AddressInfo;
    fakeServerUrl = `http://127.0.0.1:${addr.port}`;

    const logger = createMockLogger();
    pool = new AgentPool({ logger, maxConcurrent: 3 });
    app = await createWorkerServer({
      logger,
      agentPool: pool,
      machineId: MACHINE_ID,
      controlPlaneUrl: fakeServerUrl,
    });
    await app.ready();
  });

  afterAll(async () => {
    await pool.stopAll();
    await app.close();
    await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
  });

  it('returns degraded status when control plane returns 500', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('degraded');
  });

  it('shows control plane error with HTTP status in detail mode', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.dependencies.controlPlane.status).toBe('error');
    expect(body.dependencies.controlPlane.error).toContain('500');
    expect(body.dependencies.controlPlane.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('still returns valid pool stats when control plane is erroring', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const body = response.json();
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.memoryUsage).toBe('number');
    expect(body.agents).toBeDefined();
    expect(body.agents.maxConcurrent).toBe(3);
  });

  it('does not include dependencies in simple (non-detail) response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const body = response.json();
    expect(body.dependencies).toBeUndefined();
  });
});

// ── No control plane configured ─────────────────────────────────────────
describe('GET /health (no control plane configured)', () => {
  let app: FastifyInstance;
  let pool: AgentPool;

  beforeAll(async () => {
    const logger = createMockLogger();
    pool = new AgentPool({ logger, maxConcurrent: 3 });
    app = await createWorkerServer({
      logger,
      agentPool: pool,
      machineId: MACHINE_ID,
      // controlPlaneUrl intentionally omitted
    });
    await app.ready();
  });

  afterAll(async () => {
    await pool.stopAll();
    await app.close();
  });

  it('returns ok status when no control plane URL is configured', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.status).toBe('ok');
  });

  it('returns ok controlPlane dependency in detail mode', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    const body = response.json();
    expect(body.dependencies.controlPlane.status).toBe('ok');
  });
});
