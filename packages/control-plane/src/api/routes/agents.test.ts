import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
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
      const machine = body.find((m: { machineId: string }) => m.machineId === 'ec2-us-east-1');

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
          runningAgents: [
            { agentId: 'agent-1', sessionId: 'sess-abc' },
            { agentId: 'agent-2', sessionId: null },
          ],
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
    it('POST /api/agents/register with empty body returns 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/register',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.code).toBe('INVALID_MACHINE_ID');
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
  // POST /api/agents/:id/complete — run completion (no dbRegistry)
  // -------------------------------------------------------------------------

  describe('POST /api/agents/:id/complete (no dbRegistry)', () => {
    it('returns 501 when dbRegistry is not configured', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/complete',
        payload: { runId: 'run-001', status: 'success' },
      });

      expect(response.statusCode).toBe(501);

      const body = response.json();
      expect(body.error).toBe('DATABASE_NOT_CONFIGURED');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/agents/:id/signal — signal (no dbRegistry/taskQueue)
  // -------------------------------------------------------------------------

  describe('POST /api/agents/:id/signal (no dbRegistry)', () => {
    it('returns 400 when prompt is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/signal',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_SIGNAL_BODY');
    });

    it('returns 501 when dbRegistry is not configured', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/signal',
        payload: { prompt: 'Update the tests' },
      });

      expect(response.statusCode).toBe(501);

      const body = response.json();
      expect(body.error).toBe('DATABASE_NOT_CONFIGURED');
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

// ---------------------------------------------------------------------------
// Tests with a mock dbRegistry — completion + signal routes
// ---------------------------------------------------------------------------

describe('Agent routes — with dbRegistry', () => {
  let app: FastifyInstance;

  const mockDbRegistry = {
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn().mockResolvedValue([]),
    createAgent: vi.fn().mockResolvedValue('agent-new'),
    getAgent: vi.fn().mockResolvedValue({
      id: 'agent-1',
      machineId: 'machine-1',
      name: 'Test Agent',
      config: { model: 'claude-sonnet-4-20250514', allowedTools: null },
    }),
    updateAgentStatus: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getRecentRuns: vi.fn().mockResolvedValue([]),
    completeRun: vi.fn().mockResolvedValue(undefined),
    createRun: vi.fn().mockResolvedValue('run-001'),
    insertActions: vi.fn(),
    getMachine: vi.fn(),
  } as unknown as DbAgentRegistry;

  const mockTaskQueue = {
    add: vi.fn().mockResolvedValue({ id: 'job-signal-1' }),
  };

  beforeAll(async () => {
    app = await createServer({
      logger,
      dbRegistry: mockDbRegistry,
      taskQueue: mockTaskQueue as never,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // POST /api/agents/:id/complete
  // -------------------------------------------------------------------------

  describe('POST /api/agents/:id/complete', () => {
    it('completes a run successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/complete',
        payload: {
          runId: 'run-001',
          status: 'success',
          costUsd: 0.42,
          durationMs: 12000,
          sessionId: 'sess-abc',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.runId).toBe('run-001');
      expect(body.status).toBe('success');
    });

    it('returns 400 when runId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/complete',
        payload: { status: 'success' },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_RUN_ID');
    });

    it('returns 400 when status is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/complete',
        payload: { runId: 'run-001', status: 'pending' },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_STATUS');
    });

    it('returns 404 when run does not exist', async () => {
      vi.mocked(mockDbRegistry.completeRun).mockRejectedValueOnce(
        new ControlPlaneError('RUN_NOT_FOUND', 'Run not found', {}),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/complete',
        payload: { runId: 'run-ghost', status: 'failure', errorMessage: 'crashed' },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('RUN_NOT_FOUND');
    });

    it('returns 500 on unexpected database error', async () => {
      vi.mocked(mockDbRegistry.completeRun).mockRejectedValueOnce(new Error('connection lost'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/complete',
        payload: { runId: 'run-001', status: 'failure' },
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('COMPLETION_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/agents/:id/signal
  // -------------------------------------------------------------------------

  describe('POST /api/agents/:id/signal', () => {
    it('enqueues a signal job successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/signal',
        payload: {
          prompt: 'Also update the tests',
          metadata: { source: 'webhook', eventType: 'pr_merged' },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('agent-1');
      expect(body.jobId).toBe('job-signal-1');
    });

    it('returns 400 when prompt is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/signal',
        payload: { prompt: '' },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_SIGNAL_BODY');
    });

    it('returns 500 when agent is not found in registry', async () => {
      vi.mocked(mockDbRegistry.getAgent).mockResolvedValueOnce(undefined as never);

      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/ghost-agent/signal',
        payload: { prompt: 'Do something' },
      });

      // ControlPlaneError thrown → Fastify default handler returns 500
      expect(response.statusCode).toBe(500);
    });
  });
});
