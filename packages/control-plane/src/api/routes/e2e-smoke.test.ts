import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { createServer } from '../server.js';
import {
  createFullMockDbRegistry,
  createMockLogger,
  restoreFetch,
  saveOriginalFetch,
} from './test-helpers.js';

const logger = createMockLogger();
const originalFetch = saveOriginalFetch();

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockDbRegistry = {
  registerMachine: vi.fn(),
  heartbeat: vi.fn(),
  listMachines: vi.fn().mockResolvedValue([
    {
      id: 'smoke-test-machine',
      hostname: 'smoke-host',
      tailscaleIp: '100.64.0.99',
      os: 'linux',
      arch: 'x64',
      status: 'online',
      lastHeartbeat: new Date(),
      capabilities: { gpu: false, docker: true, maxConcurrentAgents: 2 },
      createdAt: new Date(),
    },
  ]),
  getMachine: vi.fn().mockResolvedValue(undefined),
  createAgent: vi.fn().mockResolvedValue('agent-new'),
  getAgent: vi.fn().mockResolvedValue({
    id: 'smoke-test-machine',
    machineId: 'smoke-test-machine',
    name: 'Smoke Test Agent',
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
  }),
  updateAgentStatus: vi.fn(),
  listAgents: vi.fn().mockResolvedValue([]),
  getRecentRuns: vi.fn().mockResolvedValue([]),
  completeRun: vi.fn().mockResolvedValue(undefined),
  createRun: vi.fn().mockResolvedValue('run-001'),
  insertActions: vi.fn().mockResolvedValue(1),
  queryActions: vi.fn().mockResolvedValue({ actions: [], total: 0 }),
  getAuditSummary: vi.fn().mockResolvedValue({ totalActions: 0 }),
  getRunTimeline: vi.fn().mockResolvedValue([]),
} as unknown as DbAgentRegistry;

const mockDb = {
  execute: vi.fn().mockResolvedValue({ rows: [] }),
};

const mockRedis = { ping: vi.fn().mockResolvedValue('PONG') };

const mockTaskQueue = {
  add: vi.fn().mockResolvedValue({ id: 'job-1' }),
};

const mockLitellmClient = {
  health: vi.fn().mockResolvedValue(true),
  listModels: vi.fn().mockResolvedValue(['claude-sonnet-4-20250514', 'gpt-4']),
  getModelInfo: vi.fn().mockResolvedValue([]),
  getSpend: vi.fn().mockResolvedValue([]),
  testModel: vi.fn().mockResolvedValue({ model: 'claude-sonnet-4-20250514', usage: {} }),
};

const mockMem0Client = {
  health: vi.fn().mockResolvedValue(true),
  search: vi.fn().mockResolvedValue({ results: [] }),
  add: vi.fn().mockResolvedValue({ results: [] }),
  getAll: vi.fn().mockResolvedValue({ results: [] }),
  delete: vi.fn().mockResolvedValue(undefined),
};

// ===========================================================================
// E2E Smoke Tests — Full server with all dependencies
// ===========================================================================

describe('E2E smoke tests — full control-plane server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({
      logger,
      taskQueue: mockTaskQueue as never,
      dbRegistry: mockDbRegistry,
      db: mockDb as never,
      redis: mockRedis,
      litellmClient: mockLitellmClient as never,
      mem0Client: mockMem0Client as never,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Infrastructure
  // -------------------------------------------------------------------------

  describe('Infrastructure', () => {
    it('GET /health returns 200 with ok status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });

    it('GET /health?detail=true includes dependency statuses', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health?detail=true',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.dependencies).toBeDefined();
      expect(body.dependencies.postgres).toBeDefined();
      expect(body.dependencies.redis).toBeDefined();
      expect(body.dependencies.mem0).toBeDefined();
      expect(body.dependencies.litellm).toBeDefined();
    });

    it('GET /metrics returns 200 with text/plain content type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(response.statusCode).toBe(200);

      const contentType = response.headers['content-type'];
      expect(String(contentType)).toContain('text/plain');

      const body = response.body;
      expect(body).toContain('agentctl_control_plane_up');
      expect(body).toContain('agentctl_agents_total');
      expect(body).toContain('agentctl_dependency_healthy');
    });

    it('returns X-Request-Id header on every response', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      const requestId = response.headers['x-request-id'];
      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe('string');
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('returns unique X-Request-Id per request', async () => {
      const r1 = await app.inject({ method: 'GET', url: '/health' });
      const r2 = await app.inject({ method: 'GET', url: '/health' });

      expect(r1.headers['x-request-id']).not.toBe(r2.headers['x-request-id']);
    });

    it('returns 404 for unknown GET routes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/does-not-exist',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('statusCode', 404);
    });

    it('returns 404 for unknown POST routes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/nonexistent',
        payload: { foo: 'bar' },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body).toHaveProperty('statusCode', 404);
    });
  });

  // -------------------------------------------------------------------------
  // CORS
  // -------------------------------------------------------------------------

  describe('CORS', () => {
    it('returns Access-Control-Allow-Origin in non-production mode', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });

    it('returns correct headers on preflight OPTIONS request', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/api/agents',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'POST',
        },
      });

      expect(response.statusCode).toBeLessThanOrEqual(204);
      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-methods']).toBeDefined();
    });

    it('exposes X-Request-Id via CORS exposed headers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      const exposed = response.headers['access-control-expose-headers'];
      expect(exposed).toBeDefined();
      expect(String(exposed)).toContain('X-Request-Id');
    });
  });

  // -------------------------------------------------------------------------
  // Rate Limiting
  // -------------------------------------------------------------------------

  describe('Rate limiting', () => {
    it('includes X-RateLimit headers on rate-limited endpoints', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents',
      });

      // Rate limit headers should be present on non-allowlisted routes
      const headers = response.headers;
      expect(headers['x-ratelimit-limit']).toBeDefined();
      expect(headers['x-ratelimit-remaining']).toBeDefined();
    });

    it('does not include X-RateLimit headers on /health', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      // /health is in the rate-limit allowList
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
    });

    it('does not include X-RateLimit headers on /metrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      // /metrics is in the rate-limit allowList
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Agent routes
  // -------------------------------------------------------------------------

  describe('Agents', () => {
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

    it('GET /api/agents returns an array', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/agents',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it('POST /api/agents/register with valid payload returns 200', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/register',
        payload: {
          machineId: 'smoke-test-machine',
          hostname: 'smoke-host',
          tailscaleIp: '100.64.0.99',
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

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.machineId).toBe('smoke-test-machine');
    });

    it('POST /api/agents/:id/start returns 200', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/smoke-test-machine/start',
        payload: {
          prompt: 'Smoke test prompt',
          model: 'claude-sonnet-4-20250514',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Webhook routes
  // -------------------------------------------------------------------------

  describe('Webhooks', () => {
    it('POST /api/webhooks returns 400 when url is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          eventTypes: ['agent.started'],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_URL');
    });

    it('POST /api/webhooks returns 400 when eventTypes is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          url: 'https://example.com/webhook',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_EVENT_TYPES');
    });

    it('GET /api/webhooks returns subscriptions array', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/webhooks',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('subscriptions');
      expect(Array.isArray(body.subscriptions)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scheduler routes
  // -------------------------------------------------------------------------

  describe('Scheduler', () => {
    it('GET /api/scheduler/jobs returns 501 when repeatableJobManager not configured', async () => {
      // Our full server was created without repeatableJobs, so the scheduler
      // guard returns 501
      const response = await app.inject({
        method: 'GET',
        url: '/api/scheduler/jobs',
      });

      expect(response.statusCode).toBe(501);

      const body = response.json();
      expect(body.error).toBe('SCHEDULER_NOT_CONFIGURED');
    });

    it('POST /api/scheduler/jobs/heartbeat returns 501 without repeatableJobManager', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/scheduler/jobs/heartbeat',
        payload: {
          agentId: 'test-agent',
          machineId: 'test-machine',
          intervalMs: 60000,
        },
      });

      expect(response.statusCode).toBe(501);
    });
  });

  // -------------------------------------------------------------------------
  // Router routes (LiteLLM)
  // -------------------------------------------------------------------------

  describe('Router', () => {
    it('GET /api/router/models returns model list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/router/models',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('models');
      expect(Array.isArray(body.models)).toBe(true);
      expect(body.models).toContain('claude-sonnet-4-20250514');
    });

    it('GET /api/router/health returns ok status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/router/health',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.status).toBe('ok');
    });

    it('GET /api/router/models/info returns deployments', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/router/models/info',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('deployments');
    });

    it('GET /api/router/spend returns spend entries', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/router/spend',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('entries');
    });
  });

  // -------------------------------------------------------------------------
  // Memory routes (Mem0)
  // -------------------------------------------------------------------------

  describe('Memory', () => {
    it('POST /api/memory/search returns results', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/search',
        payload: {
          query: 'test query',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('results');
      expect(Array.isArray(body.results)).toBe(true);
    });

    it('POST /api/memory/search returns 400 when query is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/search',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.message).toContain('query');
    });

    it('POST /api/memory/add returns 400 when messages is empty', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/add',
        payload: { messages: [] },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.message).toContain('messages');
    });

    it('GET /api/memory returns memory list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/memory',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('results');
    });
  });

  // -------------------------------------------------------------------------
  // Audit routes
  // -------------------------------------------------------------------------

  describe('Audit', () => {
    it('GET /api/audit returns paginated actions', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/audit',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('actions');
    });

    it('GET /api/audit/summary returns summary', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/audit/summary',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('totalActions');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling — global error handler
  // -------------------------------------------------------------------------

  describe('Error handling', () => {
    it('maps ControlPlaneError with _NOT_FOUND suffix to 404', async () => {
      const errApp = await createServer({ logger });

      errApp.get('/test-not-found', async () => {
        throw new ControlPlaneError('AGENT_NOT_FOUND', 'Agent does not exist', {});
      });

      await errApp.ready();

      try {
        const response = await errApp.inject({
          method: 'GET',
          url: '/test-not-found',
        });

        expect(response.statusCode).toBe(404);

        const body = response.json();
        expect(body.error).toBe('AGENT_NOT_FOUND');
        expect(body.message).toBe('Agent does not exist');
      } finally {
        await errApp.close();
      }
    });

    it('maps ControlPlaneError with INVALID_ prefix to 400', async () => {
      const errApp = await createServer({ logger });

      errApp.get('/test-invalid', async () => {
        throw new ControlPlaneError('INVALID_CONFIG', 'Configuration is invalid', {});
      });

      await errApp.ready();

      try {
        const response = await errApp.inject({
          method: 'GET',
          url: '/test-invalid',
        });

        expect(response.statusCode).toBe(400);

        const body = response.json();
        expect(body.error).toBe('INVALID_CONFIG');
        expect(body.message).toBe('Configuration is invalid');
      } finally {
        await errApp.close();
      }
    });

    it('maps ControlPlaneError with _UNAVAILABLE suffix to 503', async () => {
      const errApp = await createServer({ logger });

      errApp.get('/test-unavailable', async () => {
        throw new ControlPlaneError('SERVICE_UNAVAILABLE', 'Service is down', {});
      });

      await errApp.ready();

      try {
        const response = await errApp.inject({
          method: 'GET',
          url: '/test-unavailable',
        });

        expect(response.statusCode).toBe(503);

        const body = response.json();
        expect(body.error).toBe('SERVICE_UNAVAILABLE');
        expect(body.message).toBe('Service is down');
      } finally {
        await errApp.close();
      }
    });

    it('maps ControlPlaneError with _OFFLINE suffix to 503', async () => {
      const errApp = await createServer({ logger });

      errApp.get('/test-offline', async () => {
        throw new ControlPlaneError('MACHINE_OFFLINE', 'Machine is unreachable', {});
      });

      await errApp.ready();

      try {
        const response = await errApp.inject({
          method: 'GET',
          url: '/test-offline',
        });

        expect(response.statusCode).toBe(503);

        const body = response.json();
        expect(body.error).toBe('MACHINE_OFFLINE');
        expect(body.message).toBe('Machine is unreachable');
      } finally {
        await errApp.close();
      }
    });

    it('maps unknown errors to 500 with INTERNAL_ERROR', async () => {
      const errApp = await createServer({ logger });

      errApp.get('/test-unexpected', async () => {
        throw new Error('something broke');
      });

      await errApp.ready();

      try {
        const response = await errApp.inject({
          method: 'GET',
          url: '/test-unexpected',
        });

        expect(response.statusCode).toBe(500);

        const body = response.json();
        expect(body.error).toBe('INTERNAL_ERROR');
        expect(body.message).toBe('An unexpected error occurred');
      } finally {
        await errApp.close();
      }
    });
  });
});

describe('E2E smoke tests — runtime management', () => {
  let app: FastifyInstance;
  const runtimeMachine = {
    id: 'runtime-smoke-machine',
    hostname: 'runtime-smoke-host',
    tailscaleIp: '100.64.0.77',
    os: 'linux',
    arch: 'x64',
    status: 'online',
    lastHeartbeat: new Date(),
    capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
    createdAt: new Date(),
  };
  const dbRegistry = createFullMockDbRegistry({
    listMachines: vi.fn().mockResolvedValue([runtimeMachine]),
    getMachine: vi.fn(async (machineId: string) =>
      machineId === runtimeMachine.id ? runtimeMachine : undefined,
    ),
  });

  beforeEach(async () => {
    app = await createServer({
      logger,
      dbRegistry,
      redis: mockRedis,
      litellmClient: mockLitellmClient as never,
      mem0Client: mockMem0Client as never,
    });
    await app.ready();
  });

  afterEach(async () => {
    restoreFetch(originalFetch);
    vi.clearAllMocks();
    vi.mocked(dbRegistry.listMachines).mockResolvedValue([runtimeMachine]);
    vi.mocked(dbRegistry.getMachine).mockImplementation(async (machineId: string) =>
      machineId === runtimeMachine.id ? runtimeMachine : undefined,
    );
    await app.close();
  });

  it('creates, preflights, hands off, and summarizes unified runtime sessions', async () => {
    const projectPath = '/workspace/runtime-smoke';
    const snapshot = {
      sourceRuntime: 'codex',
      sourceSessionId: 'ms-source',
      sourceNativeSessionId: 'codex-native-1',
      projectPath,
      worktreePath: `${projectPath}/.trees/runtime-smoke`,
      branch: 'main',
      headSha: 'abc123',
      dirtyFiles: ['packages/control-plane/src/api/routes/handoffs.ts'],
      diffSummary: 'Runtime smoke handoff diff.',
      conversationSummary: 'Continue from the runtime smoke handoff.',
      openTodos: ['verify handoff history'],
      nextSuggestedPrompt: 'Continue from the handoff snapshot.',
      activeConfigRevision: 1,
      activeMcpServers: ['mem0'],
      activeSkills: ['systematic-debugging'],
      reason: 'manual',
    } as const;

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          session: {
            runtime: 'codex',
            sessionId: 'worker-codex-1',
            nativeSessionId: 'codex-native-1',
            agentId: 'adhoc',
            projectPath,
            model: null,
            status: 'active',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          nativeImportCapable: false,
          attempt: {
            ok: false,
            sourceRuntime: 'codex',
            targetRuntime: 'claude-code',
            reason: 'not_implemented',
            metadata: { probe: 'codex-to-claude' },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          strategy: 'snapshot-handoff',
          snapshot,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          strategy: 'snapshot-handoff',
          attemptedStrategies: ['snapshot-handoff'],
          nativeImportAttempt: {
            ok: false,
            sourceRuntime: 'codex',
            targetRuntime: 'claude-code',
            reason: 'not_implemented',
            metadata: { probe: 'codex-to-claude' },
          },
          snapshot,
          session: {
            runtime: 'claude-code',
            sessionId: 'worker-claude-1',
            nativeSessionId: 'claude-native-1',
            agentId: 'adhoc',
            projectPath,
            model: null,
            status: 'active',
          },
        }),
      });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions',
      payload: {
        runtime: 'codex',
        machineId: runtimeMachine.id,
        projectPath,
        prompt: 'Start runtime smoke session.',
      },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().session.runtime).toBe('codex');
    const sourceSessionId = createResponse.json().session.id as string;

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/runtime-sessions?limit=10',
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().count).toBe(1);

    const preflightResponse = await app.inject({
      method: 'GET',
      url: `/api/runtime-sessions/${sourceSessionId}/handoff/preflight?targetRuntime=claude-code&targetMachineId=${runtimeMachine.id}`,
    });

    expect(preflightResponse.statusCode).toBe(200);
    expect(preflightResponse.json().nativeImportCapable).toBe(false);
    expect(preflightResponse.json().attempt.reason).toBe('not_implemented');

    const handoffResponse = await app.inject({
      method: 'POST',
      url: `/api/runtime-sessions/${sourceSessionId}/handoff`,
      payload: {
        targetRuntime: 'claude-code',
        targetMachineId: runtimeMachine.id,
        reason: 'manual',
        prompt: 'Continue on Claude Code.',
      },
    });

    expect(handoffResponse.statusCode).toBe(202);
    expect(handoffResponse.json().strategy).toBe('snapshot-handoff');
    expect(handoffResponse.json().session.runtime).toBe('claude-code');
    expect(handoffResponse.json().nativeImportAttempt.reason).toBe('not_implemented');

    const historyResponse = await app.inject({
      method: 'GET',
      url: `/api/runtime-sessions/${sourceSessionId}/handoffs?limit=10`,
    });

    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json().count).toBe(1);
    expect(historyResponse.json().handoffs[0].targetRuntime).toBe('claude-code');

    const summaryResponse = await app.inject({
      method: 'GET',
      url: '/api/runtime-sessions/handoffs/summary?limit=10',
    });

    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json()).toEqual({
      ok: true,
      summary: {
        total: 1,
        succeeded: 1,
        failed: 0,
        pending: 0,
        nativeImportSuccesses: 0,
        nativeImportFallbacks: 1,
      },
      limit: 10,
    });
  });

  it('records dispatch-time task-affinity suggestions in run handoff history', async () => {
    const projectPath = '/workspace/runtime-affinity-smoke';

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        session: {
          runtime: 'codex',
          sessionId: 'worker-codex-affinity',
          nativeSessionId: 'codex-native-affinity',
          agentId: 'adhoc',
          projectPath,
          model: null,
          status: 'active',
        },
      }),
    });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions',
      payload: {
        runtime: 'codex',
        machineId: runtimeMachine.id,
        projectPath,
        prompt: 'Polish the React CSS UI before handoff.',
        runId: 'run-affinity-smoke',
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const historyResponse = await app.inject({
      method: 'GET',
      url: '/api/runs/run-affinity-smoke/handoff-history?limit=10',
    });

    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json()).toMatchObject({
      count: 1,
      decisions: [
        {
          sourceRunId: 'run-affinity-smoke',
          trigger: 'task-affinity',
          stage: 'dispatch',
          status: 'suggested',
          signalPayload: expect.objectContaining({
            prompt: 'Polish the React CSS UI before handoff.',
            targetRuntime: 'claude-code',
            matchedRuleId: 'frontend-heavy-to-claude',
          }),
        },
      ],
    });
  });

  it('tracks native-import handoffs in runtime summary analytics', async () => {
    const projectPath = '/workspace/runtime-native-smoke';
    const snapshot = {
      sourceRuntime: 'claude-code',
      sourceSessionId: 'ms-source-native',
      sourceNativeSessionId: 'claude-native-1',
      projectPath,
      worktreePath: `${projectPath}/.trees/runtime-native-smoke`,
      branch: 'main',
      headSha: 'def456',
      dirtyFiles: ['packages/agent-worker/src/runtime/native-import/codex-to-claude.ts'],
      diffSummary: 'Runtime native-import smoke diff.',
      conversationSummary: 'Continue from the runtime native-import handoff.',
      openTodos: ['verify native import analytics'],
      nextSuggestedPrompt: 'Continue from the native-import session.',
      activeConfigRevision: 2,
      activeMcpServers: ['mem0', 'clickhouse'],
      activeSkills: ['systematic-debugging', 'verification-before-completion'],
      reason: 'manual',
    } as const;

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          session: {
            runtime: 'claude-code',
            sessionId: 'worker-claude-1',
            nativeSessionId: 'claude-native-1',
            agentId: 'adhoc',
            projectPath,
            model: null,
            status: 'active',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          nativeImportCapable: true,
          attempt: {
            ok: true,
            sourceRuntime: 'claude-code',
            targetRuntime: 'codex',
            reason: 'succeeded',
            metadata: { probe: 'claude-to-codex' },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          strategy: 'snapshot-handoff',
          snapshot,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          strategy: 'native-import',
          attemptedStrategies: ['native-import'],
          nativeImportAttempt: {
            ok: true,
            sourceRuntime: 'claude-code',
            targetRuntime: 'codex',
            reason: 'succeeded',
            metadata: { probe: 'claude-to-codex' },
          },
          snapshot,
          session: {
            runtime: 'codex',
            sessionId: 'worker-codex-2',
            nativeSessionId: 'codex-native-2',
            agentId: 'adhoc',
            projectPath,
            model: null,
            status: 'active',
          },
        }),
      });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions',
      payload: {
        runtime: 'claude-code',
        machineId: runtimeMachine.id,
        projectPath,
        prompt: 'Start runtime native-import smoke session.',
      },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json().session.runtime).toBe('claude-code');
    const sourceSessionId = createResponse.json().session.id as string;

    const preflightResponse = await app.inject({
      method: 'GET',
      url: `/api/runtime-sessions/${sourceSessionId}/handoff/preflight?targetRuntime=codex&targetMachineId=${runtimeMachine.id}`,
    });

    expect(preflightResponse.statusCode).toBe(200);
    expect(preflightResponse.json().nativeImportCapable).toBe(true);
    expect(preflightResponse.json().attempt.reason).toBe('succeeded');

    const handoffResponse = await app.inject({
      method: 'POST',
      url: `/api/runtime-sessions/${sourceSessionId}/handoff`,
      payload: {
        targetRuntime: 'codex',
        targetMachineId: runtimeMachine.id,
        reason: 'manual',
        prompt: 'Continue on Codex via native import.',
      },
    });

    expect(handoffResponse.statusCode).toBe(202);
    expect(handoffResponse.json().strategy).toBe('native-import');
    expect(handoffResponse.json().session.runtime).toBe('codex');
    expect(handoffResponse.json().nativeImportAttempt.reason).toBe('succeeded');

    const historyResponse = await app.inject({
      method: 'GET',
      url: `/api/runtime-sessions/${sourceSessionId}/handoffs?limit=10`,
    });

    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json().count).toBe(1);
    expect(historyResponse.json().handoffs[0].strategy).toBe('native-import');

    const summaryResponse = await app.inject({
      method: 'GET',
      url: '/api/runtime-sessions/handoffs/summary?limit=10',
    });

    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json()).toEqual({
      ok: true,
      summary: {
        total: 1,
        succeeded: 1,
        failed: 0,
        pending: 0,
        nativeImportSuccesses: 1,
        nativeImportFallbacks: 0,
      },
      limit: 10,
    });
  });

  it('records failed handoffs and error session state when target startup fails', async () => {
    const projectPath = '/workspace/runtime-failure-smoke';
    const snapshot = {
      sourceRuntime: 'codex',
      sourceSessionId: 'ms-source-failure',
      sourceNativeSessionId: 'codex-native-failure',
      projectPath,
      worktreePath: `${projectPath}/.trees/runtime-failure-smoke`,
      branch: 'main',
      headSha: 'ghi789',
      dirtyFiles: ['packages/control-plane/src/api/routes/e2e-smoke.test.ts'],
      diffSummary: 'Runtime failure smoke diff.',
      conversationSummary: 'Continue after the failed runtime handoff.',
      openTodos: ['inspect target worker failure'],
      nextSuggestedPrompt: 'Retry the handoff after fixing the worker.',
      activeConfigRevision: 3,
      activeMcpServers: ['mem0'],
      activeSkills: ['systematic-debugging'],
      reason: 'manual',
    } as const;

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          session: {
            runtime: 'codex',
            sessionId: 'worker-codex-failure',
            nativeSessionId: 'codex-native-failure',
            agentId: 'adhoc',
            projectPath,
            model: null,
            status: 'active',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          strategy: 'snapshot-handoff',
          snapshot,
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({
          error: 'WORKER_UNREACHABLE',
          message: 'Target worker could not start runtime handoff',
        }),
        statusText: 'Bad Gateway',
      });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/runtime-sessions',
      payload: {
        runtime: 'codex',
        machineId: runtimeMachine.id,
        projectPath,
        prompt: 'Start runtime failure smoke session.',
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const sourceSessionId = createResponse.json().session.id as string;

    const handoffResponse = await app.inject({
      method: 'POST',
      url: `/api/runtime-sessions/${sourceSessionId}/handoff`,
      payload: {
        targetRuntime: 'claude-code',
        targetMachineId: runtimeMachine.id,
        reason: 'manual',
        prompt: 'Attempt the failing handoff.',
      },
    });

    expect(handoffResponse.statusCode).toBe(502);
    expect(handoffResponse.json()).toMatchObject({
      error: 'WORKER_UNREACHABLE',
      message: 'Target worker could not start runtime handoff',
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/runtime-sessions?limit=10',
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().count).toBe(2);
    expect(
      listResponse.json().sessions.map((session: { runtime: string; status: string }) => ({
        runtime: session.runtime,
        status: session.status,
      })),
    ).toEqual(
      expect.arrayContaining([
        { runtime: 'codex', status: 'active' },
        { runtime: 'claude-code', status: 'error' },
      ]),
    );

    const historyResponse = await app.inject({
      method: 'GET',
      url: `/api/runtime-sessions/${sourceSessionId}/handoffs?limit=10`,
    });

    expect(historyResponse.statusCode).toBe(200);
    expect(historyResponse.json().count).toBe(1);
    expect(historyResponse.json().handoffs[0]).toMatchObject({
      targetRuntime: 'claude-code',
      strategy: 'snapshot-handoff',
      status: 'failed',
      errorMessage: 'Target worker could not start runtime handoff',
    });

    const summaryResponse = await app.inject({
      method: 'GET',
      url: '/api/runtime-sessions/handoffs/summary?limit=10',
    });

    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json()).toEqual({
      ok: true,
      summary: {
        total: 1,
        succeeded: 0,
        failed: 1,
        pending: 0,
        nativeImportSuccesses: 0,
        nativeImportFallbacks: 0,
      },
      limit: 10,
    });
  });
});

// ===========================================================================
// E2E smoke — server with scheduler configured
// ===========================================================================

describe('E2E smoke — scheduler with repeatableJobManager', () => {
  let app: FastifyInstance;

  const mockRepeatableJobs = {
    listRepeatableJobs: vi.fn().mockResolvedValue([]),
    addHeartbeatJob: vi.fn().mockResolvedValue(undefined),
    addCronJob: vi.fn().mockResolvedValue(undefined),
    removeJobsByAgentId: vi.fn().mockResolvedValue(1),
  };

  beforeAll(async () => {
    app = await createServer({
      logger,
      repeatableJobs: mockRepeatableJobs as never,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/scheduler/jobs returns job list when manager is configured', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/scheduler/jobs',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toHaveProperty('jobs');
    expect(Array.isArray(body.jobs)).toBe(true);
  });

  it('POST /api/scheduler/jobs/heartbeat validates agentId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scheduler/jobs/heartbeat',
      payload: {
        machineId: 'machine-1',
        intervalMs: 60000,
      },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.error).toBe('INVALID_AGENT_ID');
  });

  it('POST /api/scheduler/jobs/cron validates pattern', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scheduler/jobs/cron',
      payload: {
        agentId: 'agent-1',
        machineId: 'machine-1',
      },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.error).toBe('INVALID_CRON_PATTERN');
  });
});
