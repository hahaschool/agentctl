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

describe('Loop management routes', () => {
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
    // Give loops time to settle
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    getActiveLoops().clear();
    await pool.stopAll();
    await app.close();
  });

  // ── POST /api/agents/:id/loop ─────────────────────────────────────

  describe('POST /api/agents/:id/loop', () => {
    it('should start a loop and return 200 with loop state', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/loop-agent-1/loop',
        payload: {
          prompt: 'Do some iterative work',
          config: {
            mode: 'fixed-prompt',
            fixedPrompt: 'Continue working',
            maxIterations: 3,
            iterationDelayMs: 500,
          },
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('loop-agent-1');
      expect(body.loop).toBeDefined();
      expect(body.loop.status).toBe('running');
      expect(body.loop.iteration).toBeDefined();
    });

    it('should return 400 when prompt is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/loop-agent-noprompt/loop',
        payload: {
          config: {
            mode: 'result-feedback',
            maxIterations: 3,
          },
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.code).toBe('INVALID_INPUT');
    });

    it('should return 400 when prompt is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/loop-agent-empty/loop',
        payload: {
          prompt: '   ',
          config: {
            mode: 'result-feedback',
            maxIterations: 3,
          },
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.code).toBe('INVALID_INPUT');
    });

    it('should return 400 when config is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/loop-agent-noconfig/loop',
        payload: {
          prompt: 'Do work',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.code).toBe('INVALID_INPUT');
    });

    it('should return 400 when config has no limits', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/loop-agent-nolimits/loop',
        payload: {
          prompt: 'Do work',
          config: {
            mode: 'result-feedback',
          },
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.code).toBe('LOOP_NO_LIMITS');
    });

    it('should return 409 when loop is already running for the same agent', async () => {
      // Start the first loop
      const first = await app.inject({
        method: 'POST',
        url: '/api/agents/loop-agent-dup/loop',
        payload: {
          prompt: 'First loop',
          config: {
            mode: 'fixed-prompt',
            fixedPrompt: 'Continue',
            maxIterations: 100,
            iterationDelayMs: 500,
          },
        },
      });
      expect(first.statusCode).toBe(200);

      // Attempt to start a second loop for the same agent
      const second = await app.inject({
        method: 'POST',
        url: '/api/agents/loop-agent-dup/loop',
        payload: {
          prompt: 'Second loop',
          config: {
            mode: 'result-feedback',
            maxIterations: 5,
            iterationDelayMs: 500,
          },
        },
      });

      expect(second.statusCode).toBe(409);

      const body = second.json();
      expect(body.code).toBe('LOOP_ALREADY_RUNNING');
    });
  });

  // ── PUT /api/agents/:id/loop ──────────────────────────────────────

  describe('PUT /api/agents/:id/loop', () => {
    it('should pause a running loop and return updated state', async () => {
      // Start a loop first
      await app.inject({
        method: 'POST',
        url: '/api/agents/loop-pause/loop',
        payload: {
          prompt: 'Do iterative work',
          config: {
            mode: 'fixed-prompt',
            fixedPrompt: 'Keep going',
            maxIterations: 100,
            iterationDelayMs: 500,
          },
        },
      });

      // Pause it
      const response = await app.inject({
        method: 'PUT',
        url: '/api/agents/loop-pause/loop',
        payload: { action: 'pause' },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.loop.status).toBe('paused');
    });

    it('should resume a paused loop and return updated state', async () => {
      // Start a loop
      await app.inject({
        method: 'POST',
        url: '/api/agents/loop-resume/loop',
        payload: {
          prompt: 'Do iterative work',
          config: {
            mode: 'fixed-prompt',
            fixedPrompt: 'Keep going',
            maxIterations: 100,
            iterationDelayMs: 500,
          },
        },
      });

      // Pause it
      await app.inject({
        method: 'PUT',
        url: '/api/agents/loop-resume/loop',
        payload: { action: 'pause' },
      });

      // Resume it
      const response = await app.inject({
        method: 'PUT',
        url: '/api/agents/loop-resume/loop',
        payload: { action: 'resume' },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.loop.status).toBe('running');
    });

    it('should return 400 when action is invalid', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/agents/loop-bad-action/loop',
        payload: { action: 'restart' },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.code).toBe('INVALID_INPUT');
    });

    it('should return 404 when no loop exists for the agent', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/agents/nonexistent-loop/loop',
        payload: { action: 'pause' },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.code).toBe('LOOP_NOT_FOUND');
    });

    it('should return 409 when trying to pause an already paused loop', async () => {
      // Start a loop
      await app.inject({
        method: 'POST',
        url: '/api/agents/loop-double-pause/loop',
        payload: {
          prompt: 'Work',
          config: {
            mode: 'fixed-prompt',
            fixedPrompt: 'Go',
            maxIterations: 100,
            iterationDelayMs: 500,
          },
        },
      });

      // Pause once
      await app.inject({
        method: 'PUT',
        url: '/api/agents/loop-double-pause/loop',
        payload: { action: 'pause' },
      });

      // Pause again
      const response = await app.inject({
        method: 'PUT',
        url: '/api/agents/loop-double-pause/loop',
        payload: { action: 'pause' },
      });

      expect(response.statusCode).toBe(409);

      const body = response.json();
      expect(body.code).toBe('LOOP_NOT_RUNNING');
    });

    it('should return 409 when trying to resume a running loop', async () => {
      // Start a loop
      await app.inject({
        method: 'POST',
        url: '/api/agents/loop-resume-running/loop',
        payload: {
          prompt: 'Work',
          config: {
            mode: 'fixed-prompt',
            fixedPrompt: 'Go',
            maxIterations: 100,
            iterationDelayMs: 500,
          },
        },
      });

      // Try to resume a running loop (should fail)
      const response = await app.inject({
        method: 'PUT',
        url: '/api/agents/loop-resume-running/loop',
        payload: { action: 'resume' },
      });

      expect(response.statusCode).toBe(409);

      const body = response.json();
      expect(body.code).toBe('LOOP_NOT_PAUSED');
    });
  });

  // ── DELETE /api/agents/:id/loop ───────────────────────────────────

  describe('DELETE /api/agents/:id/loop', () => {
    it('should stop a running loop and return final state', async () => {
      // Start a loop
      await app.inject({
        method: 'POST',
        url: '/api/agents/loop-stop/loop',
        payload: {
          prompt: 'Run for a while',
          config: {
            mode: 'fixed-prompt',
            fixedPrompt: 'Keep running',
            maxIterations: 100,
            iterationDelayMs: 500,
          },
        },
      });

      // Stop it
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/agents/loop-stop/loop',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe('loop-stop');
      expect(body.loop).toBeDefined();
    });

    it('should return 404 when stopping a non-existent loop', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/agents/no-such-loop/loop',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.code).toBe('LOOP_NOT_FOUND');
    });
  });

  // ── GET /api/agents/:id/loop ──────────────────────────────────────

  describe('GET /api/agents/:id/loop', () => {
    it('should return loop state for an active loop', async () => {
      // Start a loop
      await app.inject({
        method: 'POST',
        url: '/api/agents/loop-status/loop',
        payload: {
          prompt: 'Check my status',
          config: {
            mode: 'fixed-prompt',
            fixedPrompt: 'Status check',
            maxIterations: 100,
            iterationDelayMs: 500,
          },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/loop-status/loop',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.agentId).toBe('loop-status');
      expect(body.loop).toBeDefined();
      expect(body.loop.status).toBe('running');
      expect(body.loop.startedAt).toBeDefined();
      expect(typeof body.loop.iteration).toBe('number');
      expect(typeof body.loop.totalCostUsd).toBe('number');
    });

    it('should return 404 when querying a non-existent loop', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/ghost-loop/loop',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.code).toBe('LOOP_NOT_FOUND');
    });
  });
});
