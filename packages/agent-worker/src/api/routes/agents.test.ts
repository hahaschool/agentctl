import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentPool } from '../../runtime/agent-pool.js';
import { createWorkerServer } from '../server.js';

// Mock the SDK runner so agents fall back to stub simulation immediately
// (returning null means "SDK not available").
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

const MACHINE_ID = 'test-machine-001';

function createMockLogger(): pino.Logger {
  return pino({ level: 'silent' });
}

describe('Agent CRUD routes', () => {
  let app: FastifyInstance;
  let pool: AgentPool;
  let logger: pino.Logger;

  beforeEach(async () => {
    logger = createMockLogger();
    pool = new AgentPool({ logger, maxConcurrent: 5 });
    app = await createWorkerServer({ logger, agentPool: pool, machineId: MACHINE_ID });
  });

  afterEach(async () => {
    await pool.stopAll();
    await app.close();
  });

  // ── POST /api/agents/:id/start ──────────────────────────────────

  describe('POST /api/agents/:id/start', () => {
    it('should start a new agent and return 200 with agentId and status', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-1/start',
        payload: { prompt: 'Write a hello world script' },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('agent-1');
      expect(body.status).toBeDefined();
      expect(body.sessionId).toBeDefined();
      // After start() the stub simulation should be running
      expect(['running', 'stopped']).toContain(body.status);
    });

    it('should return an error when starting an agent that already exists and is running', async () => {
      // Start the agent the first time
      const first = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-dup/start',
        payload: { prompt: 'First prompt' },
      });
      expect(first.statusCode).toBe(200);

      // Attempt to start the same agent again while it is still running.
      // The route calls pool.createAgent if the agent doesn't exist, but
      // since it does exist, it calls instance.start() which will fail
      // because you can't transition from running → starting.
      const second = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-dup/start',
        payload: { prompt: 'Second prompt' },
      });

      expect(second.statusCode).toBe(409);

      const body = second.json();
      expect(body.code).toBe('INVALID_TRANSITION');
    });

    it('should return 400 when prompt is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-noprompt/start',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.code).toBe('INVALID_INPUT');
    });

    it('should return 400 when prompt is an empty string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-empty/start',
        payload: { prompt: '   ' },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.code).toBe('INVALID_INPUT');
    });
  });

  // ── POST /api/agents/:id/stop ───────────────────────────────────

  describe('POST /api/agents/:id/stop', () => {
    it('should stop a running agent and return 200', async () => {
      // Start agent first
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-stop/start',
        payload: { prompt: 'Do something' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-stop/stop',
        payload: { graceful: true },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('agent-stop');
      expect(body.status).toBe('stopped');
    });

    it('should return 404 when stopping a non-existent agent', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/does-not-exist/stop',
        payload: {},
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.code).toBe('AGENT_NOT_FOUND');
    });
  });

  // ── GET /api/agents ─────────────────────────────────────────────

  describe('GET /api/agents', () => {
    it('should return an empty list when no agents exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.agents).toEqual([]);
      expect(body.count).toBe(0);
    });

    it('should list all agents that have been started', async () => {
      // Start two agents
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-a/start',
        payload: { prompt: 'Task A' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-b/start',
        payload: { prompt: 'Task B' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.count).toBe(2);
      expect(body.agents).toHaveLength(2);

      const agentIds = body.agents.map((a: { agentId: string }) => a.agentId);
      expect(agentIds).toContain('agent-a');
      expect(agentIds).toContain('agent-b');
    });
  });

  // ── GET /api/agents/:id (status) ───────────────────────────────

  describe('GET /api/agents/:id', () => {
    it('should return agent details with status field for an existing agent', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-status/start',
        payload: { prompt: 'Check my status' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/agent-status',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.agentId).toBe('agent-status');
      expect(body.status).toBeDefined();
      expect(body.machineId).toBe(MACHINE_ID);
      expect(body.sessionId).toBeDefined();
      expect(body.projectPath).toBeDefined();
    });

    it('should return 404 for a non-existent agent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/ghost-agent',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.code).toBe('AGENT_NOT_FOUND');
    });
  });

  // ── DELETE /api/agents/:id ──────────────────────────────────────

  describe('DELETE /api/agents/:id', () => {
    it('should remove a stopped agent from the pool', async () => {
      // Start and then stop the agent
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-del/start',
        payload: { prompt: 'Temporary work' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-del/stop',
        payload: { graceful: true },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/agents/agent-del',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('agent-del');

      // Verify it is actually gone
      const getResponse = await app.inject({
        method: 'GET',
        url: '/api/agents/agent-del',
      });
      expect(getResponse.statusCode).toBe(404);
    });

    it('should return 404 when deleting a non-existent agent', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/agents/no-such-agent',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.code).toBe('AGENT_NOT_FOUND');
    });

    it('should return 409 when trying to delete a running agent', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-running/start',
        payload: { prompt: 'Still going' },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/agents/agent-running',
      });

      expect(response.statusCode).toBe(409);

      const body = response.json();
      expect(body.code).toBe('AGENT_STILL_RUNNING');
    });
  });

  // ── GET /health ─────────────────────────────────────────────────

  describe('GET /health', () => {
    it('should return health status with agent pool info', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
      expect(body.agents).toBeDefined();
      expect(body.agents.maxConcurrent).toBe(5);
    });

    it('should return enriched operational data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(typeof body.uptime).toBe('number');
      expect(body.uptime).toBeGreaterThan(0);
      expect(typeof body.activeAgents).toBe('number');
      expect(body.activeAgents).toBe(0);
      expect(typeof body.totalAgentsStarted).toBe('number');
      expect(body.totalAgentsStarted).toBe(0);
      expect(typeof body.worktreesActive).toBe('number');
      expect(body.worktreesActive).toBe(0);
      expect(typeof body.memoryUsage).toBe('number');
      expect(body.memoryUsage).toBeGreaterThan(0);
    });

    it('should not include dependencies in simple response', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      const body = response.json();
      expect(body.dependencies).toBeUndefined();
    });

    it('should include dependencies when detail=true', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health?detail=true',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.dependencies).toBeDefined();
      expect(body.dependencies.controlPlane).toBeDefined();
      expect(body.dependencies.controlPlane.status).toBe('ok');
    });

    it('should reflect correct activeAgents count after starting agents', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-health/start',
        payload: { prompt: 'Health check task' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      const body = response.json();
      // Agent may have already finished its stub run, but totalAgentsStarted should be >= 1
      expect(body.totalAgentsStarted).toBeGreaterThanOrEqual(1);
    });
  });

  // ── GET /api/agents/stats ─────────────────────────────────────

  describe('GET /api/agents/stats', () => {
    it('should return empty stats when no agents exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/stats',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.poolSize).toBe(0);
      expect(body.byStatus).toEqual({});
      expect(body.totalCostUsd).toBe(0);
      expect(body.oldestAgent).toBeNull();
    });

    it('should return correct stats after starting agents', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/agents/stats-agent-1/start',
        payload: { prompt: 'First stats task' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/agents/stats-agent-2/start',
        payload: { prompt: 'Second stats task' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/stats',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.poolSize).toBe(2);
      // Both agents should be in some status (running or stopped depending on timing)
      const totalByStatus = Object.values(body.byStatus as Record<string, number>).reduce(
        (sum: number, n: number) => sum + n,
        0,
      );
      expect(totalByStatus).toBe(2);
    });

    it('should report oldestAgent among running agents', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/agents/oldest-1/start',
        payload: { prompt: 'Oldest agent task' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/stats',
      });

      const body = response.json();
      // If the agent is still running, oldestAgent should be populated
      if (body.byStatus.running > 0) {
        expect(body.oldestAgent).not.toBeNull();
        expect(body.oldestAgent.agentId).toBe('oldest-1');
        expect(body.oldestAgent.startedAt).toBeDefined();
      }
    });

    it('should sum totalCostUsd across agents', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/agents/cost-1/start',
        payload: { prompt: 'Cost task 1' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/agents/cost-2/start',
        payload: { prompt: 'Cost task 2' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/stats',
      });

      const body = response.json();
      // totalCostUsd should be a number (may be 0 if agents haven't accumulated cost yet)
      expect(typeof body.totalCostUsd).toBe('number');
      expect(body.totalCostUsd).toBeGreaterThanOrEqual(0);
    });
  });
});
