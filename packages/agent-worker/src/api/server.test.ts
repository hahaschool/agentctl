import { AgentError, WorkerError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPool } from '../runtime/agent-pool.js';
import { ExecutionEnvironmentRegistry } from '../runtime/execution-environment-registry.js';
import { createSilentLogger } from '../test-helpers.js';
import { createWorkerServer } from './server.js';

// Mock the SDK runner so agents fall back to stub simulation immediately
vi.mock('../runtime/sdk-runner.js', () => ({
  runWithSdk: vi.fn().mockResolvedValue(null),
}));

// Mock the audit logger so tests don't touch the filesystem.
vi.mock('../hooks/audit-logger.js', () => {
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

const MACHINE_ID = 'test-machine-server';

describe('manual takeover route registration', () => {
  let app: FastifyInstance;
  let pool: AgentPool;
  let rcSessionManager: {
    startSession: ReturnType<typeof vi.fn>;
    getSessionByNativeSessionId: ReturnType<typeof vi.fn>;
    getSessionByProjectPath: ReturnType<typeof vi.fn>;
    stopSession: ReturnType<typeof vi.fn>;
    stopAll: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const logger = createSilentLogger();
    pool = new AgentPool({ logger, maxConcurrent: 3 });
    rcSessionManager = {
      startSession: vi.fn(async () => ({
        id: 'rc-1',
        agentId: 'agent-1',
        pid: 1234,
        sessionUrl: 'https://claude.ai/code/session-123',
        nativeSessionId: 'claude-native-1',
        status: 'online',
        permissionMode: 'default',
        projectPath: '/workspace/app',
        startedAt: new Date('2026-03-11T10:00:00Z'),
        lastHeartbeat: new Date('2026-03-11T10:00:10Z'),
        error: null,
      })),
      getSessionByNativeSessionId: vi.fn(() => null),
      getSessionByProjectPath: vi.fn(() => null),
      stopSession: vi.fn(async () => undefined),
      stopAll: vi.fn(async () => undefined),
    };
    app = await createWorkerServer({
      logger,
      agentPool: pool,
      machineId: MACHINE_ID,
      rcSessionManager: rcSessionManager as never,
    });
    await app.ready();
  });

  afterEach(async () => {
    await pool.stopAll();
    await app.close();
  });

  it('registers manual takeover routes on the worker server', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions/claude-native-1/manual-takeover',
      payload: {
        agentId: 'agent-1',
        projectPath: '/workspace/app',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().manualTakeover.workerSessionId).toBe('rc-1');
  });
});

describe('execution environment registry wiring', () => {
  let app: FastifyInstance;
  let pool: AgentPool;

  beforeEach(async () => {
    const logger = createSilentLogger();
    pool = new AgentPool({ logger, maxConcurrent: 3 });
    app = await createWorkerServer({
      logger,
      agentPool: pool,
      machineId: MACHINE_ID,
      executionEnvironmentRegistry: new ExecutionEnvironmentRegistry(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await pool.stopAll();
    await app.close();
  });

  it('accepts an injected execution environment registry when booting the worker server', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Global error handler — WorkerError, AgentError, validation, generic errors
// ---------------------------------------------------------------------------

describe('Global error handler', () => {
  let app: FastifyInstance;
  let pool: AgentPool;
  let logger: pino.Logger;

  beforeEach(async () => {
    logger = createSilentLogger();
    pool = new AgentPool({ logger, maxConcurrent: 3 });
    app = await createWorkerServer({ logger, agentPool: pool, machineId: MACHINE_ID });

    // Register test routes BEFORE calling ready()
    app.get('/test-worker-not-found', async () => {
      throw new WorkerError('AGENT_NOT_FOUND', 'Agent not found', { agentId: 'x' });
    });
    app.get('/test-worker-unavailable', async () => {
      throw new WorkerError('SERVICE_UNAVAILABLE', 'Service down');
    });
    app.get('/test-worker-offline', async () => {
      throw new WorkerError('MACHINE_OFFLINE', 'Machine is offline');
    });
    app.get('/test-worker-invalid', async () => {
      throw new WorkerError('INVALID_INPUT', 'Bad input');
    });
    app.get('/test-worker-unmapped', async () => {
      throw new WorkerError('SOMETHING_ELSE', 'Unknown error');
    });
    app.get('/test-agent-not-found', async () => {
      throw new AgentError('RESOURCE_NOT_FOUND', 'Resource missing');
    });
    app.get('/test-agent-invalid', async () => {
      throw new AgentError('INVALID_CONFIG', 'Bad config');
    });
    app.get('/test-generic-error', async () => {
      throw new Error('something broke');
    });
    app.post(
      '/test-validation',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
            },
          },
        },
      },
      async (request) => {
        return { ok: true, name: (request.body as { name: string }).name };
      },
    );

    await app.ready();
  });

  afterEach(async () => {
    await pool.stopAll();
    await app.close();
  });

  it('returns 404 for WorkerError with _NOT_FOUND code', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test-worker-not-found',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toBe('AGENT_NOT_FOUND');
    expect(body.message).toBe('Agent not found');
  });

  it('returns 503 for WorkerError with _UNAVAILABLE code', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test-worker-unavailable',
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.error).toBe('SERVICE_UNAVAILABLE');
  });

  it('returns 503 for WorkerError with _OFFLINE code', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test-worker-offline',
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.error).toBe('MACHINE_OFFLINE');
  });

  it('returns 400 for WorkerError with INVALID_ prefix', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test-worker-invalid',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('INVALID_INPUT');
  });

  it('returns 500 for WorkerError with unmapped code', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test-worker-unmapped',
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error).toBe('SOMETHING_ELSE');
  });

  it('returns 404 for AgentError with _NOT_FOUND code', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test-agent-not-found',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toBe('RESOURCE_NOT_FOUND');
    expect(body.message).toBe('Resource missing');
  });

  it('returns 400 for AgentError with INVALID_ prefix', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test-agent-invalid',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBe('INVALID_CONFIG');
  });

  it('returns 500 with INTERNAL_ERROR for generic unhandled errors', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test-generic-error',
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('An unexpected error occurred');
  });

  it('returns 400 for Fastify validation errors', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/test-validation',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ notName: 123 }),
    });

    expect(response.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// onSend hook — structured request logging at different status code ranges
// ---------------------------------------------------------------------------

describe('onSend structured request logging', () => {
  let app: FastifyInstance;
  let pool: AgentPool;
  let mockLogger: pino.Logger;
  let logSpy: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    logSpy = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    mockLogger = {
      info: logSpy.info,
      warn: logSpy.warn,
      error: logSpy.error,
      debug: logSpy.debug,
      fatal: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
      child: () => mockLogger,
      level: 'debug',
    } as unknown as pino.Logger;

    pool = new AgentPool({ logger: pino({ level: 'silent' }), maxConcurrent: 3 });
    app = await createWorkerServer({
      logger: mockLogger,
      agentPool: pool,
      machineId: MACHINE_ID,
    });

    // Register a route that triggers a 500 before calling ready()
    app.get('/test-500-route', async () => {
      throw new Error('Boom');
    });

    await app.ready();
  });

  afterEach(async () => {
    await pool.stopAll();
    await app.close();
  });

  it('logs at info level for 2xx responses', async () => {
    await app.inject({
      method: 'GET',
      url: '/health',
    });

    const infoCall = logSpy.info.mock.calls.find(
      (call: unknown[]) => typeof call[1] === 'string' && call[1] === 'request completed',
    );
    expect(infoCall).toBeDefined();
  });

  it('logs at warn level for 4xx responses', async () => {
    // 404 from a nonexistent route
    await app.inject({
      method: 'GET',
      url: '/nonexistent-path-that-does-not-exist',
    });

    const warnCall = logSpy.warn.mock.calls.find(
      (call: unknown[]) => typeof call[1] === 'string' && call[1] === 'request completed',
    );
    expect(warnCall).toBeDefined();
  });

  it('logs at error level for 5xx responses', async () => {
    await app.inject({
      method: 'GET',
      url: '/test-500-route',
    });

    const errorCall = logSpy.error.mock.calls.find(
      (call: unknown[]) => typeof call[1] === 'string' && call[1] === 'request completed',
    );
    expect(errorCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// onRequest hook — debug logging for incoming requests
// ---------------------------------------------------------------------------

describe('onRequest debug logging', () => {
  let app: FastifyInstance;
  let pool: AgentPool;
  let mockLogger: pino.Logger;
  let debugSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    debugSpy = vi.fn();
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: debugSpy,
      fatal: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
      child: () => mockLogger,
      level: 'debug',
    } as unknown as pino.Logger;

    pool = new AgentPool({ logger: pino({ level: 'silent' }), maxConcurrent: 3 });
    app = await createWorkerServer({ logger: mockLogger, agentPool: pool, machineId: MACHINE_ID });
    await app.ready();
  });

  afterEach(async () => {
    await pool.stopAll();
    await app.close();
  });

  it('logs incoming request at debug level', async () => {
    await app.inject({
      method: 'GET',
      url: '/health',
    });

    const debugCall = debugSpy.mock.calls.find(
      (call: unknown[]) => typeof call[1] === 'string' && call[1] === 'incoming request',
    );
    expect(debugCall).toBeDefined();
    expect(debugCall[0]).toMatchObject({
      method: 'GET',
      url: '/health',
    });
  });
});

// ---------------------------------------------------------------------------
// workerErrorToStatus — verify all mapping branches via error handler
// ---------------------------------------------------------------------------

describe('workerErrorToStatus mapping via error handler', () => {
  let app: FastifyInstance;
  let pool: AgentPool;
  let logger: pino.Logger;

  beforeEach(async () => {
    logger = createSilentLogger();
    pool = new AgentPool({ logger, maxConcurrent: 3 });
    app = await createWorkerServer({ logger, agentPool: pool, machineId: MACHINE_ID });

    // Register all test routes before ready()
    const codes = [
      'AGENT_NOT_FOUND',
      'RESOURCE_NOT_FOUND',
      'SERVICE_UNAVAILABLE',
      'MACHINE_UNAVAILABLE',
      'NODE_OFFLINE',
      'MACHINE_OFFLINE',
      'INVALID_REQUEST',
      'INVALID_PARAMS',
      'RANDOM_CODE',
      'POOL_EXHAUSTED',
    ];

    for (const code of codes) {
      app.get(`/test-status-${code}`, async () => {
        throw new WorkerError(code, `Error: ${code}`);
      });
    }

    await app.ready();
  });

  afterEach(async () => {
    await pool.stopAll();
    await app.close();
  });

  it.each([
    ['AGENT_NOT_FOUND', 404],
    ['RESOURCE_NOT_FOUND', 404],
    ['SERVICE_UNAVAILABLE', 503],
    ['MACHINE_UNAVAILABLE', 503],
    ['NODE_OFFLINE', 503],
    ['MACHINE_OFFLINE', 503],
    ['INVALID_REQUEST', 400],
    ['INVALID_PARAMS', 400],
    ['RANDOM_CODE', 500],
    ['POOL_EXHAUSTED', 500],
  ])('WorkerError with code %s returns HTTP %i', async (code, expectedStatus) => {
    const response = await app.inject({
      method: 'GET',
      url: `/test-status-${code}`,
    });

    expect(response.statusCode).toBe(expectedStatus);
  });
});

// ---------------------------------------------------------------------------
// Health endpoint — basic structure from createWorkerServer
// ---------------------------------------------------------------------------

describe('Health endpoint — no controlPlaneUrl', () => {
  let app: FastifyInstance;
  let pool: AgentPool;
  let logger: pino.Logger;

  beforeEach(async () => {
    logger = createSilentLogger();
    pool = new AgentPool({ logger, maxConcurrent: 5 });
    app = await createWorkerServer({ logger, agentPool: pool, machineId: MACHINE_ID });
    await app.ready();
  });

  afterEach(async () => {
    await pool.stopAll();
    await app.close();
  });

  it('returns ok status and agent stats in basic response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.activeAgents).toBe('number');
    expect(typeof body.totalAgentsStarted).toBe('number');
    expect(typeof body.worktreesActive).toBe('number');
    expect(typeof body.memoryUsage).toBe('object');
    expect(typeof body.memoryUsage.rss).toBe('number');
    expect(body.agents).toBeDefined();
    expect(body.agents.maxConcurrent).toBe(5);
    // dependencies should not be present in simple mode
    expect(body.dependencies).toBeUndefined();
  });

  it('returns dependencies in detail mode', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health?detail=true',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.dependencies).toBeDefined();
    expect(body.dependencies.controlPlane.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Route registration — registered plugins are reachable
// ---------------------------------------------------------------------------

describe('Route registration', () => {
  let app: FastifyInstance;
  let pool: AgentPool;
  let logger: pino.Logger;

  beforeEach(async () => {
    logger = createSilentLogger();
    pool = new AgentPool({ logger, maxConcurrent: 3 });
    app = await createWorkerServer({ logger, agentPool: pool, machineId: MACHINE_ID });
    await app.ready();
  });

  afterEach(async () => {
    await pool.stopAll();
    await app.close();
  });

  it('registers agent routes under /api/agents', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/agents',
    });

    // Should return the list (even if empty)
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('agents');
    expect(body).toHaveProperty('count');
  });

  it('registers metrics route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.statusCode).toBe(200);
  });
});
