// ---------------------------------------------------------------------------
// Tests for pre-compact memory checkpoint route
// ---------------------------------------------------------------------------

import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSilentLogger } from '../../test-helpers.js';
import { capturePreCompactCheckpoint, preCompactRoutes } from './pre-compact.js';

const CONTROL_PLANE_URL = 'http://localhost:8080';
const SESSION_ID = 'session-abc123';

function makeApp(
  controlPlaneUrl = CONTROL_PLANE_URL,
  scheduleCapture?: (task: () => void) => void,
): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(preCompactRoutes, {
    prefix: '/api/sessions',
    controlPlaneUrl,
    logger: createSilentLogger(),
    scheduleCapture,
  });
  return app;
}

// ---------------------------------------------------------------------------
// Route tests
// ---------------------------------------------------------------------------

describe('preCompactRoutes POST /:sessionId/pre-compact', () => {
  let app: FastifyInstance;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    app = makeApp();
    await app.ready();
  });

  afterEach(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    globalThis.fetch = originalFetch;
    await app.close();
    vi.clearAllMocks();
  });

  it('returns 202 immediately for a valid request', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, id: 'fact-1' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/pre-compact`,
      payload: {
        agentId: 'agent-1',
        machineId: 'machine-1',
        contextSizeTokens: 45_000,
        recentMessages: ['user: hello', 'assistant: hi there'],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ queued: true });
  });

  it('returns 400 when agentId is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/pre-compact`,
      payload: {
        machineId: 'machine-1',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PARAMS');
  });

  it('returns 400 when machineId is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/pre-compact`,
      payload: {
        agentId: 'agent-1',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PARAMS');
  });

  it('returns 400 when agentId is an empty string', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/pre-compact`,
      payload: {
        agentId: '',
        machineId: 'machine-1',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PARAMS');
  });

  it('returns 400 when recentMessages exceeds max length (50)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/pre-compact`,
      payload: {
        agentId: 'agent-1',
        machineId: 'machine-1',
        recentMessages: Array.from({ length: 51 }, (_, i) => `message ${i}`),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_PARAMS');
  });

  it('accepts request without optional fields', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/pre-compact`,
      payload: {
        agentId: 'agent-1',
        machineId: 'machine-1',
      },
    });

    expect(response.statusCode).toBe(202);
  });

  it('fires async capture to the control plane', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock;

    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/pre-compact`,
      payload: {
        agentId: 'agent-1',
        machineId: 'machine-1',
        contextSizeTokens: 45_000,
        recentMessages: ['user: what is 2+2?', 'assistant: 4'],
      },
    });

    expect(response.statusCode).toBe(202);

    // Wait for the async capture to settle
    await new Promise((resolve) => setImmediate(resolve));
    // Give the async fetch a tick to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchMock).toHaveBeenCalledWith(
      `${CONTROL_PLANE_URL}/api/memory/facts`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(callBody.scope).toBe('agent:agent-1');
    expect(callBody.entityType).toBe('experience');
    expect(callBody.source.extraction_method).toBe('pre_compact_hook');
    expect(callBody.source.session_id).toBe(SESSION_ID);
    expect(callBody.content).toContain('45000 tokens');
    expect(callBody.content).toContain('user: what is 2+2?');
  });

  it('defers checkpoint capture until after the 202 response path', async () => {
    await app.close();

    const scheduledTasks: Array<() => void> = [];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock;

    app = makeApp(CONTROL_PLANE_URL, (task) => {
      scheduledTasks.push(task);
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/pre-compact`,
      payload: {
        agentId: 'agent-1',
        machineId: 'machine-1',
        recentMessages: ['user: preserve this'],
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ queued: true });
    expect(scheduledTasks).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();

    scheduledTasks[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// capturePreCompactCheckpoint unit tests
// ---------------------------------------------------------------------------

describe('capturePreCompactCheckpoint', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('posts memory fact to control plane with correct shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock;

    const logger = createSilentLogger();

    await capturePreCompactCheckpoint(
      SESSION_ID,
      {
        agentId: 'agent-1',
        machineId: 'machine-1',
        contextSizeTokens: 30_000,
        recentMessages: ['user: foo', 'assistant: bar'],
      },
      CONTROL_PLANE_URL,
      logger,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CONTROL_PLANE_URL}/api/memory/facts`);
    const body = JSON.parse(init.body as string);
    expect(body.scope).toBe('agent:agent-1');
    expect(body.entityType).toBe('experience');
    expect(body.confidence).toBe(0.7);
    expect(body.source.extraction_method).toBe('pre_compact_hook');
    expect(body.source.agent_id).toBe('agent-1');
    expect(body.source.machine_id).toBe('machine-1');
    expect(body.source.session_id).toBe(SESSION_ID);
  });

  it('still posts when only session id is available (minimal content)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock;

    const logger = createSilentLogger();

    // No contextSizeTokens and no recentMessages → content still includes
    // the session line, so the function posts with minimal content.
    await capturePreCompactCheckpoint(
      SESSION_ID,
      {
        agentId: 'agent-1',
        machineId: 'machine-1',
      },
      CONTROL_PLANE_URL,
      logger,
    );

    // The session line alone is sufficient content, so fetch is called once
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.content).toContain(SESSION_ID);
  });

  it('logs error and does not throw when control plane is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const logger = createSilentLogger();

    // Should not throw
    await expect(
      capturePreCompactCheckpoint(
        SESSION_ID,
        { agentId: 'agent-1', machineId: 'machine-1' },
        CONTROL_PLANE_URL,
        logger,
      ),
    ).resolves.toBeUndefined();
  });

  it('logs warning and does not throw when control plane returns non-200', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'SERVICE_UNAVAILABLE' }),
    });

    const logger = createSilentLogger();

    await expect(
      capturePreCompactCheckpoint(
        SESSION_ID,
        { agentId: 'agent-1', machineId: 'machine-1' },
        CONTROL_PLANE_URL,
        logger,
      ),
    ).resolves.toBeUndefined();
  });

  it('only includes the last 10 recent messages in the fact content', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock;

    const messages = Array.from({ length: 20 }, (_, i) => `message-${i}`);
    const logger = createSilentLogger();

    await capturePreCompactCheckpoint(
      SESSION_ID,
      { agentId: 'agent-1', machineId: 'machine-1', recentMessages: messages },
      CONTROL_PLANE_URL,
      logger,
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // Should contain the last 10 messages (indices 10–19)
    expect(body.content).toContain('message-19');
    expect(body.content).toContain('message-10');
    expect(body.content).not.toContain('message-0');
    expect(body.content).not.toContain('message-9');
  });
});
