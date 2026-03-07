import { WorkerError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TerminalManager } from '../../runtime/terminal-manager.js';
import { terminalRoutes } from './terminal.js';

// ---------------------------------------------------------------------------
// Mock node-pty — we never spawn real PTY processes in tests
// ---------------------------------------------------------------------------

const mockOnData = vi.fn();
const mockOnExit = vi.fn();
const mockWrite = vi.fn();
const mockResize = vi.fn();
const mockKill = vi.fn();

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    write: mockWrite,
    resize: mockResize,
    kill: mockKill,
    onData: mockOnData,
    onExit: mockOnExit,
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): pino.Logger {
  return pino({ level: 'silent' });
}

/**
 * Build a minimal Fastify app with just the terminal routes registered.
 * Includes a simple error handler that maps WorkerError codes to HTTP status.
 */
async function buildApp(
  maxTerminals?: number,
): Promise<{ app: FastifyInstance; terminalManager: TerminalManager }> {
  const Fastify = await import('fastify');
  const app = Fastify.default({ logger: false });

  const logger = createMockLogger();
  const terminalManager = new TerminalManager({ logger, maxTerminals });

  // Replicate the error handler from server.ts so WorkerErrors get proper HTTP codes
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof WorkerError) {
      let statusCode = 500;
      if (err.code.endsWith('_NOT_FOUND')) statusCode = 404;
      else if (err.code.startsWith('INVALID_')) statusCode = 400;
      else if (err.code === 'TERMINAL_LIMIT_REACHED') statusCode = 429;
      else if (err.code === 'TERMINAL_ALREADY_EXISTS') statusCode = 409;
      return reply.status(statusCode).send({
        error: err.code,
        message: err.message,
      });
    }
    // Fastify schema validation errors
    if ((err as { statusCode?: number; validation?: unknown }).statusCode === 400) {
      return reply.status(400).send(err);
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: err.message });
  });

  await app.register(terminalRoutes, {
    prefix: '/api/terminal',
    terminalManager,
    logger,
  });

  return { app, terminalManager };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Terminal routes', () => {
  let app: FastifyInstance;
  let terminalManager: TerminalManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    const built = await buildApp();
    app = built.app;
    terminalManager = built.terminalManager;
  });

  afterEach(async () => {
    terminalManager.killAll();
    await app.close();
  });

  // =========================================================================
  // POST /api/terminal — spawn terminal
  // =========================================================================

  describe('POST /api/terminal (spawn)', () => {
    it('spawns a terminal and returns TerminalInfo', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/terminal',
        payload: { id: 'term-1' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe('term-1');
      expect(body.pid).toBe(12345);
      expect(body.cols).toBe(120);
      expect(body.rows).toBe(30);
      expect(body.createdAt).toBeDefined();
    });

    it('spawns a terminal with custom dimensions and command', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/terminal',
        payload: { id: 'term-custom', command: '/bin/bash', cols: 80, rows: 24 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe('term-custom');
      expect(body.command).toBe('/bin/bash');
      expect(body.cols).toBe(80);
      expect(body.rows).toBe(24);
    });

    it('returns 400 when id is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/terminal',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 409 when terminal id already exists', async () => {
      // Spawn first terminal
      await app.inject({
        method: 'POST',
        url: '/api/terminal',
        payload: { id: 'dup-term' },
      });

      // Try to spawn with same id
      const res = await app.inject({
        method: 'POST',
        url: '/api/terminal',
        payload: { id: 'dup-term' },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error).toBe('TERMINAL_ALREADY_EXISTS');
    });
  });

  // =========================================================================
  // GET /api/terminal — list terminals
  // =========================================================================

  describe('GET /api/terminal (list)', () => {
    it('returns empty list when no terminals are spawned', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/terminal',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('returns spawned terminals', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/terminal',
        payload: { id: 'term-a' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/terminal',
        payload: { id: 'term-b' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/terminal',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(2);
      const ids = body.map((t: { id: string }) => t.id);
      expect(ids).toContain('term-a');
      expect(ids).toContain('term-b');
    });
  });

  // =========================================================================
  // GET /api/terminal/:id — get terminal info
  // =========================================================================

  describe('GET /api/terminal/:id (get info)', () => {
    it('returns terminal info for an existing terminal', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/terminal',
        payload: { id: 'term-info' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/terminal/term-info',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe('term-info');
      expect(body.pid).toBe(12345);
    });

    it('returns 404 for non-existent terminal', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/terminal/nonexistent',
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe('TERMINAL_NOT_FOUND');
    });
  });

  // =========================================================================
  // POST /api/terminal/:id/resize — resize terminal
  // =========================================================================

  describe('POST /api/terminal/:id/resize', () => {
    it('resizes an existing terminal', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/terminal',
        payload: { id: 'term-resize' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/terminal/term-resize/resize',
        payload: { cols: 200, rows: 50 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.cols).toBe(200);
      expect(body.rows).toBe(50);

      // Verify dimensions were updated
      const infoRes = await app.inject({
        method: 'GET',
        url: '/api/terminal/term-resize',
      });
      const info = infoRes.json();
      expect(info.cols).toBe(200);
      expect(info.rows).toBe(50);
    });

    it('returns 404 when terminal does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/terminal/nonexistent/resize',
        payload: { cols: 80, rows: 24 },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe('TERMINAL_NOT_FOUND');
    });

    it('returns 400 when cols or rows are missing', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/terminal',
        payload: { id: 'term-resize-bad' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/terminal/term-resize-bad/resize',
        payload: { cols: 80 },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // DELETE /api/terminal/:id — kill terminal
  // =========================================================================

  describe('DELETE /api/terminal/:id (kill)', () => {
    it('kills an existing terminal and removes it from the list', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/terminal',
        payload: { id: 'term-kill' },
      });

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: '/api/terminal/term-kill',
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().success).toBe(true);

      // Verify it's gone from list
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/terminal',
      });
      expect(listRes.json()).toEqual([]);
    });

    it('returns 404 when killing a non-existent terminal', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/terminal/nonexistent',
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe('TERMINAL_NOT_FOUND');
    });
  });

  // =========================================================================
  // Terminal limit enforcement
  // =========================================================================

  describe('terminal limit', () => {
    it('returns 429 when maximum terminal limit is reached', async () => {
      // Build an app with maxTerminals=2
      const built = await buildApp(2);
      const limitApp = built.app;
      const limitManager = built.terminalManager;

      try {
        await limitApp.inject({
          method: 'POST',
          url: '/api/terminal',
          payload: { id: 'limit-1' },
        });
        await limitApp.inject({
          method: 'POST',
          url: '/api/terminal',
          payload: { id: 'limit-2' },
        });

        const res = await limitApp.inject({
          method: 'POST',
          url: '/api/terminal',
          payload: { id: 'limit-3' },
        });

        expect(res.statusCode).toBe(429);
        const body = res.json();
        expect(body.error).toBe('TERMINAL_LIMIT_REACHED');
      } finally {
        limitManager.killAll();
        await limitApp.close();
      }
    });
  });
});
