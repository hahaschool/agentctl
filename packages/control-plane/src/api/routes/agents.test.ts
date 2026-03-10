import { ControlPlaneError, generateDispatchSigningKeyPair } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '../../registry/agent-registry.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { createServer } from '../server.js';
import {
  createFullMockDbRegistry,
  createMockLogger,
  makeMachine,
  mockFetchOk,
  mockFetchThrow,
  restoreFetch,
  saveOriginalFetch,
} from './test-helpers.js';

const logger = createMockLogger();

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

  describe('dispatch verification bootstrap responses', () => {
    it('returns the control-plane dispatch verification config on register', async () => {
      const signingKeyPair = generateDispatchSigningKeyPair();
      const bootstrapApp = await createServer({
        logger,
        registry: new AgentRegistry(),
        dispatchVerificationConfig: {
          version: 1,
          algorithm: 'ed25519',
          publicKey: signingKeyPair.publicKey,
        },
      });

      await bootstrapApp.ready();

      const response = await bootstrapApp.inject({
        method: 'POST',
        url: '/api/agents/register',
        payload: {
          machineId: 'dispatch-bootstrap-machine',
          hostname: 'bootstrap.local',
          tailscaleIp: '100.64.0.10',
          os: 'linux',
          arch: 'x64',
          capabilities: {
            gpu: false,
            docker: true,
            maxConcurrentAgents: 2,
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        machineId: 'dispatch-bootstrap-machine',
        dispatchVerification: {
          version: 1,
          algorithm: 'ed25519',
          publicKey: signingKeyPair.publicKey,
        },
      });

      await bootstrapApp.close();
    });

    it('returns the control-plane dispatch verification config on heartbeat', async () => {
      const signingKeyPair = generateDispatchSigningKeyPair();
      const bootstrapRegistry = new AgentRegistry();
      bootstrapRegistry.registerMachine('heartbeat-bootstrap-machine', 'heartbeat.local');

      const bootstrapApp = await createServer({
        logger,
        registry: bootstrapRegistry,
        dispatchVerificationConfig: {
          version: 1,
          algorithm: 'ed25519',
          publicKey: signingKeyPair.publicKey,
        },
      });

      await bootstrapApp.ready();

      const response = await bootstrapApp.inject({
        method: 'POST',
        url: '/api/agents/heartbeat-bootstrap-machine/heartbeat',
        payload: {
          machineId: 'heartbeat-bootstrap-machine',
          runningAgents: [],
          cpuPercent: 12,
          memoryPercent: 34,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        dispatchVerification: {
          version: 1,
          algorithm: 'ed25519',
          publicKey: signingKeyPair.publicKey,
        },
      });

      await bootstrapApp.close();
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
      expect(body.error).toBe('INVALID_MACHINE_ID');
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
  // POST /api/agents/:id/safety-decision — worker proxy
  // -------------------------------------------------------------------------

  describe('POST /api/agents/:id/safety-decision (no dbRegistry)', () => {
    it('returns 400 when the decision is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/safety-decision',
        payload: { decision: 'ship-it' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'INVALID_SAFETY_DECISION',
      });
    });

    it('returns 500 when the worker URL cannot be resolved', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/safety-decision',
        payload: { decision: 'approve' },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        error: 'REGISTRY_UNAVAILABLE',
      });
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
    it('POST /api/agents returns 501', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents',
        payload: {
          machineId: 'ec2-us-east-1',
          name: 'my-agent',
          type: 'autonomous',
        },
      });

      expect(response.statusCode).toBe(501);

      const body = response.json();
      expect(body.error).toBe('DATABASE_NOT_CONFIGURED');
    });

    it('GET /api/agents/list returns 501', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/list',
      });

      expect(response.statusCode).toBe(501);
    });

    it('GET /api/agents/:agentId returns 501', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/some-agent-id',
      });

      expect(response.statusCode).toBe(501);
    });

    it('PATCH /api/agents/:agentId/status returns 501', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/agents/some-agent-id/status',
        payload: { status: 'running' },
      });

      expect(response.statusCode).toBe(501);
    });

    it('GET /api/agents/:agentId/runs returns 501', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/some-agent-id/runs',
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
  // POST /api/agents — create agent with dbRegistry
  // -------------------------------------------------------------------------

  describe('POST /api/agents (with dbRegistry)', () => {
    it('creates an agent and returns the new agentId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents',
        payload: {
          machineId: 'machine-1',
          name: 'my-new-agent',
          type: 'autonomous',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('agent-new');
      expect(mockDbRegistry.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          machineId: 'machine-1',
          name: 'my-new-agent',
          type: 'autonomous',
        }),
      );
    });

    it('rejects an invalid runtime value with 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents',
        payload: {
          machineId: 'machine-1',
          name: 'bad-runtime-agent',
          type: 'autonomous',
          runtime: 'invalid-runtime',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_RUNTIME');
      expect(body.message).toContain('invalid-runtime');
    });

    it('accepts a valid runtime value', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents',
        payload: {
          machineId: 'machine-1',
          name: 'nanoclaw-agent',
          type: 'autonomous',
          runtime: 'nanoclaw',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('agent-new');
      expect(mockDbRegistry.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          machineId: 'machine-1',
          name: 'nanoclaw-agent',
          type: 'autonomous',
          runtime: 'nanoclaw',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/agents/:agentId/status — validation
  // -------------------------------------------------------------------------

  describe('PATCH /api/agents/:agentId/status (with dbRegistry)', () => {
    it('updates agent status with a valid status', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/agents/agent-1/status',
        payload: { status: 'running' },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(mockDbRegistry.updateAgentStatus).toHaveBeenCalledWith('agent-1', 'running');
    });

    it('returns 400 for an invalid status value', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/agents/agent-1/status',
        payload: { status: 'bogus_status' },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_STATUS');
    });

    it('returns 400 when status is empty string', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/agents/agent-1/status',
        payload: { status: '' },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_STATUS');
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/agents/:agentId/runs — with limit parameter
  // -------------------------------------------------------------------------

  describe('GET /api/agents/:agentId/runs (with dbRegistry)', () => {
    it('returns runs with default limit when no limit is specified', async () => {
      vi.mocked(mockDbRegistry.getRecentRuns).mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/agent-1/runs',
      });

      expect(response.statusCode).toBe(200);
      expect(mockDbRegistry.getRecentRuns).toHaveBeenCalledWith('agent-1', 20);
    });

    it('passes a valid limit parameter to getRecentRuns', async () => {
      vi.mocked(mockDbRegistry.getRecentRuns).mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/agent-1/runs?limit=5',
      });

      expect(response.statusCode).toBe(200);
      expect(mockDbRegistry.getRecentRuns).toHaveBeenCalledWith('agent-1', 5);
    });

    it('falls back to default limit for invalid limit parameter (non-integer)', async () => {
      vi.mocked(mockDbRegistry.getRecentRuns).mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/agent-1/runs?limit=abc',
      });

      expect(response.statusCode).toBe(200);
      expect(mockDbRegistry.getRecentRuns).toHaveBeenCalledWith('agent-1', 20);
    });

    it('falls back to default limit for limit < 1', async () => {
      vi.mocked(mockDbRegistry.getRecentRuns).mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/agent-1/runs?limit=0',
      });

      expect(response.statusCode).toBe(200);
      expect(mockDbRegistry.getRecentRuns).toHaveBeenCalledWith('agent-1', 20);
    });

    it('falls back to default limit for negative limit', async () => {
      vi.mocked(mockDbRegistry.getRecentRuns).mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/agent-1/runs?limit=-5',
      });

      expect(response.statusCode).toBe(200);
      expect(mockDbRegistry.getRecentRuns).toHaveBeenCalledWith('agent-1', 20);
    });

    it('falls back to default limit for fractional limit', async () => {
      vi.mocked(mockDbRegistry.getRecentRuns).mockResolvedValueOnce([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/agent-1/runs?limit=3.7',
      });

      expect(response.statusCode).toBe(200);
      expect(mockDbRegistry.getRecentRuns).toHaveBeenCalledWith('agent-1', 20);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/agents/:agentId — agent retrieval
  // -------------------------------------------------------------------------

  describe('GET /api/agents/:agentId (with dbRegistry)', () => {
    it('returns agent details when agent exists', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/agent-1',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.id).toBe('agent-1');
      expect(body.machineId).toBe('machine-1');
    });

    it('returns 404 when agent does not exist', async () => {
      vi.mocked(mockDbRegistry.getAgent).mockResolvedValueOnce(undefined as never);

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/nonexistent-agent',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('AGENT_NOT_FOUND');
    });
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

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('AGENT_NOT_FOUND');
    });
  });
});

describe('Agent routes — safety decision proxying', () => {
  let app: FastifyInstance;
  let originalFetch: typeof globalThis.fetch;
  const mockDbRegistry = createFullMockDbRegistry({
    getAgent: vi.fn().mockResolvedValue({
      id: 'agent-1',
      machineId: 'machine-1',
      name: 'Agent One',
      type: 'adhoc',
      status: 'starting',
      schedule: null,
      projectPath: null,
      worktreeBranch: null,
      currentSessionId: null,
      config: {},
      lastRunAt: null,
      lastCostUsd: null,
      totalCostUsd: 0,
      createdAt: new Date(),
    }),
    getMachine: vi.fn().mockResolvedValue(makeMachine()),
  });

  beforeAll(async () => {
    originalFetch = saveOriginalFetch();
    app = await createServer({
      logger,
      registry: new AgentRegistry(),
      dbRegistry: mockDbRegistry,
      workerPort: 9123,
    });
    await app.ready();
  });

  afterEach(() => {
    restoreFetch(originalFetch);
    vi.clearAllMocks();
    vi.mocked(mockDbRegistry.getAgent).mockResolvedValue({
      id: 'agent-1',
      machineId: 'machine-1',
      name: 'Agent One',
      type: 'adhoc',
      status: 'starting',
      schedule: null,
      projectPath: null,
      worktreeBranch: null,
      currentSessionId: null,
      config: {},
      lastRunAt: null,
      lastCostUsd: null,
      totalCostUsd: 0,
      createdAt: new Date(),
    } as never);
    vi.mocked(mockDbRegistry.getMachine).mockResolvedValue(makeMachine() as never);
  });

  afterAll(async () => {
    restoreFetch(originalFetch);
    await app.close();
  });

  it('proxies a safety decision to the resolved worker', async () => {
    mockFetchOk({
      ok: true,
      agentId: 'agent-1',
      status: 'running',
      sessionId: 'sess-123',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/safety-decision',
      payload: { decision: 'sandbox' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      agentId: 'agent-1',
      status: 'running',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://100.64.0.1:9123/api/agents/agent-1/safety-decision',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'sandbox' }),
      }),
    );
  });

  it('returns 502 when the worker cannot be reached', async () => {
    mockFetchThrow('connection refused');

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/safety-decision',
      payload: { decision: 'approve' },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: 'WORKER_UNREACHABLE',
    });
  });
});

// ---------------------------------------------------------------------------
// Tests for agent auto-creation on start
// ---------------------------------------------------------------------------

describe('Agent routes — start with auto-creation', () => {
  let app: FastifyInstance;

  const mockDbRegistry = {
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn().mockResolvedValue([
      {
        id: 'machine-1',
        hostname: 'test-host',
        tailscaleIp: '100.64.0.1',
        os: 'linux',
        arch: 'x64',
        status: 'online',
        lastHeartbeat: new Date(),
        capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
        createdAt: new Date(),
      },
    ]),
    findOnlineMachine: vi.fn().mockResolvedValue({
      id: 'machine-1',
      hostname: 'test-host',
      tailscaleIp: '100.64.0.1',
      os: 'linux',
      arch: 'x64',
      status: 'online',
      lastHeartbeat: new Date(),
      capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
      createdAt: new Date(),
    }),
    createAgent: vi.fn().mockResolvedValue('new-agent-uuid'),
    getAgent: vi.fn(),
    updateAgentStatus: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getRecentRuns: vi.fn().mockResolvedValue([]),
    completeRun: vi.fn(),
    createRun: vi.fn(),
    insertActions: vi.fn(),
    getMachine: vi.fn(),
  } as unknown as DbAgentRegistry;

  const mockTaskQueue = {
    add: vi.fn().mockResolvedValue({ id: 'job-auto-1' }),
  };

  beforeAll(async () => {
    app = await createServer({
      logger,
      dbRegistry: mockDbRegistry,
      taskQueue: mockTaskQueue as never,
    });
    await app.ready();
  });

  afterEach(() => {
    vi.mocked(mockDbRegistry.getAgent).mockReset();
    vi.mocked(mockDbRegistry.createAgent).mockReset().mockResolvedValue('new-agent-uuid');
    vi.mocked(mockDbRegistry.findOnlineMachine)
      .mockReset()
      .mockResolvedValue({
        id: 'machine-1',
        hostname: 'test-host',
        tailscaleIp: '100.64.0.1',
        os: 'linux',
        arch: 'x64',
        status: 'online',
        lastHeartbeat: new Date(),
        capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
        createdAt: new Date(),
      } as never);
    vi.mocked(mockTaskQueue.add).mockReset().mockResolvedValue({ id: 'job-auto-1' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('auto-creates an adhoc agent and enqueues start job when agent does not exist', async () => {
    // First call returns undefined (not found), second call returns the newly created agent
    vi.mocked(mockDbRegistry.getAgent)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 'new-agent-uuid',
        machineId: 'machine-1',
        name: 'unknown-agent',
        type: 'adhoc',
        status: 'registered',
        schedule: null,
        projectPath: null,
        worktreeBranch: null,
        currentSessionId: null,
        config: {},
        lastRunAt: null,
        lastCostUsd: null,
        totalCostUsd: 0,
        createdAt: new Date(),
      } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/unknown-agent/start',
      payload: { prompt: 'Fix the login bug' },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.jobId).toBe('job-auto-1');

    // Agent should have been auto-created with the first online machine
    expect(mockDbRegistry.createAgent).toHaveBeenCalledWith({
      machineId: 'machine-1',
      name: 'unknown-agent',
      type: 'adhoc',
    });

    // Task queue should have been called with the correct machineId
    expect(mockTaskQueue.add).toHaveBeenCalledWith(
      'agent:start',
      expect.objectContaining({
        agentId: 'unknown-agent',
        machineId: 'machine-1',
        prompt: 'Fix the login bug',
      }),
    );
  });

  it('uses explicitly provided machineId for auto-creation', async () => {
    vi.mocked(mockDbRegistry.getAgent)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        id: 'new-agent-uuid',
        machineId: 'specific-machine',
        name: 'targeted-agent',
        type: 'adhoc',
        status: 'registered',
        schedule: null,
        projectPath: null,
        worktreeBranch: null,
        currentSessionId: null,
        config: {},
        lastRunAt: null,
        lastCostUsd: null,
        totalCostUsd: 0,
        createdAt: new Date(),
      } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/targeted-agent/start',
      payload: {
        prompt: 'Deploy to staging',
        machineId: 'specific-machine',
      },
    });

    expect(response.statusCode).toBe(200);

    // Should use the explicitly provided machineId, not query listMachines
    expect(mockDbRegistry.createAgent).toHaveBeenCalledWith({
      machineId: 'specific-machine',
      name: 'targeted-agent',
      type: 'adhoc',
    });

    expect(mockDbRegistry.findOnlineMachine).not.toHaveBeenCalled();
  });

  it('returns 503 when no online machines are available for auto-creation', async () => {
    vi.mocked(mockDbRegistry.getAgent).mockResolvedValueOnce(undefined);
    vi.mocked(mockDbRegistry.findOnlineMachine).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/orphan-agent/start',
      payload: { prompt: 'Do something' },
    });

    expect(response.statusCode).toBe(503);

    const body = response.json();
    expect(body.error).toBe('NO_MACHINES_AVAILABLE');

    // createAgent should NOT have been called
    expect(mockDbRegistry.createAgent).not.toHaveBeenCalled();
  });

  it('skips auto-creation when agent already exists in registry', async () => {
    vi.mocked(mockDbRegistry.getAgent).mockResolvedValueOnce({
      id: 'existing-agent',
      machineId: 'machine-1',
      name: 'Existing Agent',
      type: 'manual',
      status: 'registered',
      schedule: null,
      projectPath: null,
      worktreeBranch: null,
      currentSessionId: null,
      config: {},
      lastRunAt: null,
      lastCostUsd: null,
      totalCostUsd: 0,
      createdAt: new Date(),
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/existing-agent/start',
      payload: { prompt: 'Run tests' },
    });

    expect(response.statusCode).toBe(200);

    // createAgent should NOT have been called for existing agents
    expect(mockDbRegistry.createAgent).not.toHaveBeenCalled();

    // Job should be enqueued with the existing agent's machineId
    expect(mockTaskQueue.add).toHaveBeenCalledWith(
      'agent:start',
      expect.objectContaining({
        agentId: 'existing-agent',
        machineId: 'machine-1',
      }),
    );
  });

  it('returns 503 when only offline machines exist', async () => {
    vi.mocked(mockDbRegistry.getAgent).mockResolvedValueOnce(undefined);
    // findOnlineMachine returns null because the DB query filters by status='online'
    vi.mocked(mockDbRegistry.findOnlineMachine).mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/new-agent/start',
      payload: { prompt: 'Something' },
    });

    expect(response.statusCode).toBe(503);

    const body = response.json();
    expect(body.error).toBe('NO_MACHINES_AVAILABLE');
  });
});
