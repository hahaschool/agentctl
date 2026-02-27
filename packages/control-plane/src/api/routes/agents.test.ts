import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '../../registry/agent-registry.js';
import { createServer } from '../server.js';

const logger = {
  child: () => logger,
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  level: 'silent',
} as unknown as Logger;

describe('Agent routes — /api/agents', () => {
  let app: FastifyInstance;
  let registry: AgentRegistry;

  beforeAll(async () => {
    registry = new AgentRegistry();
    app = await createServer({ logger, registry });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // POST /api/agents/register — machine registration
  // -------------------------------------------------------------------------

  describe('POST /api/agents/register', () => {
    it('registers a machine and returns 200 with machineId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/register',
        payload: {
          machineId: 'ec2-us-east-1',
          hostname: 'ip-10-0-0-42',
          tailscaleIp: '100.64.0.1',
          os: 'linux',
          arch: 'x64',
          capabilities: {
            gpu: false,
            docker: true,
            maxConcurrentAgents: 4,
          },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.machineId).toBe('ec2-us-east-1');
    });

    it('registers a second machine successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/register',
        payload: {
          machineId: 'mac-mini-studio',
          hostname: 'mac-mini.local',
          tailscaleIp: '100.64.0.2',
          os: 'darwin',
          arch: 'arm64',
          capabilities: {
            gpu: true,
            docker: true,
            maxConcurrentAgents: 2,
          },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.machineId).toBe('mac-mini-studio');
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/agents — list registered machines
  // -------------------------------------------------------------------------

  describe('GET /api/agents', () => {
    it('returns all registered machines', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(2);

      const machineIds = body.map((m: { machineId: string }) => m.machineId);
      expect(machineIds).toContain('ec2-us-east-1');
      expect(machineIds).toContain('mac-mini-studio');
    });

    it('returns machines with expected fields', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents',
      });

      const body = response.json();
      const machine = body.find(
        (m: { machineId: string }) => m.machineId === 'ec2-us-east-1',
      );

      expect(machine).toBeDefined();
      expect(machine.hostname).toBe('ip-10-0-0-42');
      expect(machine.status).toBe('online');
      expect(machine.lastHeartbeat).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/agents/:id/heartbeat — machine heartbeat
  // -------------------------------------------------------------------------

  describe('POST /api/agents/:id/heartbeat', () => {
    it('sends heartbeat for a registered machine and returns 200', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/ec2-us-east-1/heartbeat',
        payload: {
          machineId: 'ec2-us-east-1',
          runningAgents: ['agent-1', 'agent-2'],
          cpuPercent: 45.2,
          memoryPercent: 62.8,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('heartbeat for an unregistered machine still returns 200', async () => {
      // The in-memory registry silently ignores unknown machineIds
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/unknown-machine/heartbeat',
        payload: {
          machineId: 'unknown-machine',
          runningAgents: [],
          cpuPercent: 0,
          memoryPercent: 0,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------

  describe('error cases', () => {
    it('POST /api/agents/register with empty body returns 200 (no server-side validation)', async () => {
      // The in-memory registry does not validate body fields — it simply
      // stores whatever machineId/hostname are provided (even undefined).
      // This test documents current behavior; stricter validation could be
      // added later with Fastify JSON Schema.
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/register',
        payload: {},
      });

      // Without schema validation, Fastify does not reject the request.
      // The handler calls registry.registerMachine(undefined, undefined).
      expect(response.statusCode).toBe(200);
    });

    it('GET on a non-existent route returns 404', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/nonexistent/route/does-not-exist',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/agents/:id/start — start an agent (no taskQueue)
  // -------------------------------------------------------------------------

  describe('POST /api/agents/:id/start', () => {
    it('returns ok without taskQueue configured', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/ec2-us-east-1/start',
        payload: {
          prompt: 'Fix the login bug',
          model: 'claude-sonnet-4-20250514',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('ec2-us-east-1');
      expect(body.prompt).toBe('Fix the login bug');
      expect(body.model).toBe('claude-sonnet-4-20250514');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/agents/:id/stop — stop an agent (no repeatableJobs)
  // -------------------------------------------------------------------------

  describe('POST /api/agents/:id/stop', () => {
    it('returns ok without repeatableJobs configured', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/ec2-us-east-1/stop',
        payload: {
          reason: 'user',
          graceful: true,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('ec2-us-east-1');
      expect(body.reason).toBe('user');
      expect(body.graceful).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // DB-only routes return 501 when dbRegistry is not configured
  // -------------------------------------------------------------------------

  describe('DB-only routes without dbRegistry', () => {
    it('POST /api/agents/agents returns 501', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agents',
        payload: {
          machineId: 'ec2-us-east-1',
          name: 'my-agent',
          type: 'autonomous',
        },
      });

      expect(response.statusCode).toBe(501);

      const body = response.json();
      expect(body.error).toBe('Database not configured');
    });

    it('GET /api/agents/agents/list returns 501', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/agents/list',
      });

      expect(response.statusCode).toBe(501);
    });

    it('GET /api/agents/agents/:agentId returns 501', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/agents/some-agent-id',
      });

      expect(response.statusCode).toBe(501);
    });

    it('PATCH /api/agents/agents/:agentId/status returns 501', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/agents/agents/some-agent-id/status',
        payload: { status: 'running' },
      });

      expect(response.statusCode).toBe(501);
    });

    it('GET /api/agents/agents/:agentId/runs returns 501', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/agents/some-agent-id/runs',
      });

      expect(response.statusCode).toBe(501);
    });
  });
});
