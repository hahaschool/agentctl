import type { FastifyInstance } from 'fastify';
import type pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentPool } from '../../runtime/agent-pool.js';
import { createSilentLogger } from '../../test-helpers.js';
import { createWorkerServer } from '../server.js';

// Mock the SDK runner so agents fall back to stub simulation immediately.
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

const MACHINE_ID = 'test-machine-stream';

describe('SSE streaming routes', () => {
  let app: FastifyInstance;
  let pool: AgentPool;
  let logger: pino.Logger;
  let address: string;

  beforeEach(async () => {
    logger = createSilentLogger();
    pool = new AgentPool({ logger, maxConcurrent: 5 });
    app = await createWorkerServer({ logger, agentPool: pool, machineId: MACHINE_ID });
    // Start a real HTTP server for SSE tests. reply.hijack() does not
    // work reliably with Fastify's inject() mock transport.
    address = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await pool.stopAll();
    await app.close();
  });

  describe('GET /api/agents/:id/stream', () => {
    it('should set SSE headers for an existing agent', async () => {
      // Create and start an agent via inject (still works for non-hijacked routes)
      const startResponse = await app.inject({
        method: 'POST',
        url: '/api/agents/stream-agent/start',
        payload: { prompt: 'Stream me' },
      });
      expect(startResponse.statusCode).toBe(200);

      // Use a real HTTP request to verify the SSE endpoint.
      // fetch() resolves with the Response once headers arrive,
      // even though the body stream stays open for SSE.
      const controller = new AbortController();

      const response = await fetch(`${address}/api/agents/stream-agent/stream`, {
        signal: controller.signal,
      });

      // Verify SSE headers before consuming any body
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/event-stream');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(response.headers.get('x-accel-buffering')).toBe('no');

      // Abort the stream to close the connection cleanly
      controller.abort();
    }, 10_000);

    it('should stream catch-up events in SSE format for an active agent', async () => {
      // Start an agent so it exists and has emitted events
      const startResponse = await app.inject({
        method: 'POST',
        url: '/api/agents/catchup-agent/start',
        payload: { prompt: 'Catch up test' },
      });
      expect(startResponse.statusCode).toBe(200);

      const controller = new AbortController();
      // Abort after a short delay to collect catch-up events
      const timeout = setTimeout(() => controller.abort(), 500);

      let bodyText = '';
      try {
        const response = await fetch(`${address}/api/agents/catchup-agent/stream`, {
          signal: controller.signal,
        });
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error('No reader available');

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bodyText += decoder.decode(value, { stream: true });
        }
      } catch {
        // AbortError is expected when the controller fires
      } finally {
        clearTimeout(timeout);
      }

      // The body should contain SSE-formatted frames. At minimum the
      // agent emits status events during start (starting -> running).
      expect(bodyText).toContain('event:');
      expect(bodyText).toContain('data:');
    }, 10_000);

    it('should return an error for a non-existent agent', async () => {
      // For non-existent agents, the route throws a WorkerError before
      // calling reply.hijack(), so Fastify's inject() works normally.
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/no-such-agent/stream',
      });

      // Fastify's default error handler turns unhandled errors into 500.
      expect(response.statusCode).toBeGreaterThanOrEqual(400);

      const body = response.json();
      expect(body.message).toContain('not found');
    });
  });
});
