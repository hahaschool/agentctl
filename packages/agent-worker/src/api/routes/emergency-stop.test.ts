import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentPool } from '../../runtime/agent-pool.js';
import { createSilentLogger } from '../../test-helpers.js';
import { createWorkerServer } from '../server.js';
import { getActiveLoops } from './loop.js';

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

describe('Emergency stop routes', () => {
  let app: FastifyInstance;
  let pool: AgentPool;
  let logger: pino.Logger;

  beforeEach(async () => {
    logger = createSilentLogger();
    pool = new AgentPool({ logger, maxConcurrent: 5 });
    app = await createWorkerServer({ logger, agentPool: pool, machineId: MACHINE_ID });
    // Clear any leftover active loops from previous tests
    getActiveLoops().clear();
  });

  afterEach(async () => {
    // Stop any active loops before tearing down
    for (const controller of getActiveLoops().values()) {
      controller.stop();
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    getActiveLoops().clear();
    await pool.stopAll();
    await app.close();
  });

  // ── POST /api/agents/:id/emergency-stop ─────────────────────────

  describe('POST /api/agents/:id/emergency-stop', () => {
    it('should emergency stop a running agent and return 200', async () => {
      // Start an agent first
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-estop/start',
        payload: { prompt: 'Do some work' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-estop/emergency-stop',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('agent-estop');
      expect(body.stoppedAt).toBeDefined();
      expect(typeof body.stoppedAt).toBe('string');
    });

    it('should return 404 when emergency stopping a non-existent agent', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/ghost-agent/emergency-stop',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.code).toBe('AGENT_NOT_FOUND');
    });

    it('should stop an active loop when emergency stopping an agent', async () => {
      // Start a loop for the agent
      await app.inject({
        method: 'POST',
        url: '/api/agents/loop-estop/loop',
        payload: {
          prompt: 'Run in a loop',
          config: {
            mode: 'fixed-prompt',
            fixedPrompt: 'Keep going',
            maxIterations: 100,
            iterationDelayMs: 500,
          },
        },
      });

      // Verify loop is active
      expect(getActiveLoops().has('loop-estop')).toBe(true);

      // Emergency stop the agent
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/loop-estop/emergency-stop',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);

      // Loop should have been removed from active loops
      expect(getActiveLoops().has('loop-estop')).toBe(false);
    });

    it('should succeed even if the agent is already stopped', async () => {
      // Start and stop an agent
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-already-stopped/start',
        payload: { prompt: 'Quick task' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-already-stopped/stop',
        payload: { graceful: true },
      });

      // Emergency stop should still succeed (stop() handles already-stopped agents)
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-already-stopped/emergency-stop',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('agent-already-stopped');
    });

    it('should force-kill without graceful shutdown', async () => {
      // Start an agent
      await app.inject({
        method: 'POST',
        url: '/api/agents/force-kill/start',
        payload: { prompt: 'Long running task' },
      });

      // Verify agent is active. Async start now returns immediately, so the
      // agent may still be in the transitional "starting" state here.
      const statusBefore = await app.inject({
        method: 'GET',
        url: '/api/agents/force-kill',
      });
      expect(['starting', 'running', 'stopped']).toContain(statusBefore.json().status);

      // Emergency stop
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/force-kill/emergency-stop',
      });

      expect(response.statusCode).toBe(200);

      // Verify agent is stopped
      const statusAfter = await app.inject({
        method: 'GET',
        url: '/api/agents/force-kill',
      });
      expect(statusAfter.json().status).toBe('stopped');
    });
  });

  // ── POST /api/agents/emergency-stop-all ─────────────────────────

  describe('POST /api/agents/emergency-stop-all', () => {
    it('should emergency stop all running agents and return 200 with stoppedCount', async () => {
      // Start multiple agents
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-all-1/start',
        payload: { prompt: 'Task 1' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-all-2/start',
        payload: { prompt: 'Task 2' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/emergency-stop-all',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(typeof body.stoppedCount).toBe('number');
    });

    it('should return stoppedCount of 0 when no agents are running', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/emergency-stop-all',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.stoppedCount).toBe(0);
    });

    it('should stop all active loops when emergency stopping all agents', async () => {
      // Start a loop
      await app.inject({
        method: 'POST',
        url: '/api/agents/loop-all-1/loop',
        payload: {
          prompt: 'Loop work',
          config: {
            mode: 'fixed-prompt',
            fixedPrompt: 'Continue',
            maxIterations: 100,
            iterationDelayMs: 500,
          },
        },
      });

      // Start another agent (no loop)
      await app.inject({
        method: 'POST',
        url: '/api/agents/agent-all-3/start',
        payload: { prompt: 'Task 3' },
      });

      // Verify loop is active
      expect(getActiveLoops().size).toBeGreaterThanOrEqual(1);

      // Emergency stop all
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/emergency-stop-all',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(typeof body.loopsStopped).toBe('number');

      // All loops should be cleared
      expect(getActiveLoops().size).toBe(0);
    });

    it('should include loopsStopped count in the response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/emergency-stop-all',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('loopsStopped');
      expect(typeof body.loopsStopped).toBe('number');
    });
  });
});
