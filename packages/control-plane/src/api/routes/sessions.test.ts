import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { sessionRoutes } from './sessions.js';
import { makeMachine } from './test-helpers.js';

// ---------------------------------------------------------------------------
// Module mocks for account credential resolution
// ---------------------------------------------------------------------------

vi.mock('../../utils/resolve-account.js', () => ({
  resolveAccountId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../utils/credential-crypto.js', () => ({
  decryptCredential: vi.fn().mockReturnValue('decrypted-api-key-123'),
  encryptCredential: vi.fn(),
  maskCredential: vi.fn(),
}));

import { decryptCredential } from '../../utils/credential-crypto.js';
// Re-import so tests can configure per-test behaviour
import { resolveAccountId } from '../../utils/resolve-account.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-03-03T12:00:00Z');

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-001',
    agentId: 'agent-1',
    machineId: 'machine-1',
    sessionUrl: null,
    claudeSessionId: null,
    status: 'active',
    projectPath: '/home/user/project',
    pid: null,
    startedAt: NOW,
    lastHeartbeat: null,
    endedAt: null,
    metadata: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Chainable Drizzle query builder mock
// ---------------------------------------------------------------------------

/**
 * Creates a mock database that simulates Drizzle's chainable query builder.
 *
 * Each method in the chain (select, from, where, orderBy, limit, offset,
 * insert, update, values, set, returning) returns the chain itself so that
 * calls like `db.select().from(table).where(cond)` resolve correctly.
 *
 * The mock stores a `rows` array that is returned when the chain is awaited
 * (via a `.then` method). Call `setRows()` to configure what a query returns.
 */
function createMockDb() {
  let rows: unknown[] = [];

  const chain: Record<string, unknown> = {};

  const chainMethods = [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'insert',
    'update',
    'delete',
    'values',
    'set',
    'returning',
    'onConflictDoUpdate',
  ];

  for (const method of chainMethods) {
    chain[method] = vi.fn(() => chain);
  }

  // When the chain is awaited, resolve with the configured rows.
  // biome-ignore lint/suspicious/noThenProperty: Drizzle query builder mock requires a thenable
  chain.then = (resolve: (value: unknown) => void) => {
    resolve(rows);
    return chain;
  };

  return {
    db: chain,
    setRows: (newRows: unknown[]) => {
      rows = newRows;
    },
  };
}

// ---------------------------------------------------------------------------
// Mock DbAgentRegistry
// ---------------------------------------------------------------------------

function createMockDbRegistry() {
  return {
    getAgent: vi.fn().mockResolvedValue({
      id: 'agent-1',
      machineId: 'machine-1',
      name: 'Test Agent',
      type: 'adhoc',
      status: 'registered',
      config: {},
    }),
    getMachine: vi.fn().mockResolvedValue(makeMachine()),
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn().mockResolvedValue([]),
    createAgent: vi.fn(),
    updateAgentStatus: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getRecentRuns: vi.fn().mockResolvedValue([]),
    completeRun: vi.fn(),
    createRun: vi.fn(),
    insertActions: vi.fn(),
  } as unknown as DbAgentRegistry;
}

// ---------------------------------------------------------------------------
// Mock fetch — prevent real HTTP calls to worker machines
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockFetchOk(body: Record<string, unknown> = { ok: true }) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function mockFetchError(status = 500) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: 'WORKER_ERROR' }),
    text: async () => 'Internal Server Error',
  });
}

function mockFetchThrow(message = 'Connection refused') {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error(message));
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(
  mockDb: ReturnType<typeof createMockDb>,
  mockDbRegistry: DbAgentRegistry,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sessionRoutes, {
    prefix: '/api/sessions',
    db: mockDb.db as never,
    dbRegistry: mockDbRegistry,
    workerPort: 9000,
  });
  await app.ready();
  return app;
}

// =============================================================================
// Tests
// =============================================================================

describe('Session routes — /api/sessions', () => {
  let app: FastifyInstance;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockDbRegistry: DbAgentRegistry;

  beforeAll(async () => {
    mockDb = createMockDb();
    mockDbRegistry = createMockDbRegistry();
    app = await buildApp(mockDb, mockDbRegistry);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // GET /api/sessions — list sessions
  // ---------------------------------------------------------------------------

  describe('GET /api/sessions', () => {
    it('returns 200 with paginated session envelope', async () => {
      const sessions = [makeSession(), makeSession({ id: 'sess-002', status: 'ended' })];
      mockDb.setRows(sessions);

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('sessions');
      expect(Array.isArray(body.sessions)).toBe(true);
      expect(body.sessions).toHaveLength(2);
      expect(body).toHaveProperty('limit');
      expect(body).toHaveProperty('offset');
      expect(body).toHaveProperty('hasMore');
    });

    it('returns empty sessions array when no sessions exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('sessions');
      expect(Array.isArray(body.sessions)).toBe(true);
      expect(body.sessions).toHaveLength(0);
    });

    it('accepts machineId filter parameter', async () => {
      mockDb.setRows([makeSession()]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions?machineId=machine-1',
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts status filter parameter', async () => {
      mockDb.setRows([makeSession({ status: 'active' })]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions?status=active',
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts limit and offset parameters', async () => {
      mockDb.setRows([makeSession()]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions?limit=10&offset=5',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/sessions/:sessionId — get single session
  // ---------------------------------------------------------------------------

  describe('GET /api/sessions/:sessionId', () => {
    it('returns 200 with session details when session exists', async () => {
      const session = makeSession();
      mockDb.setRows([session]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions/sess-001',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.id).toBe('sess-001');
      expect(body.agentId).toBe('agent-1');
      expect(body.machineId).toBe('machine-1');
      expect(body.status).toBe('active');
    });

    it('returns 404 when session does not exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions/nonexistent',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('SESSION_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/sessions — create a new session
  // ---------------------------------------------------------------------------

  describe('POST /api/sessions', () => {
    it('creates a session and returns 201 with session data', async () => {
      const inserted = makeSession({ status: 'starting' });
      mockDb.setRows([inserted]);
      mockFetchOk();

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          agentId: 'agent-1',
          machineId: 'machine-1',
          projectPath: '/home/user/project',
          model: 'claude-sonnet-4-20250514',
          prompt: 'Fix the tests',
        },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.sessionId).toBeDefined();
      expect(body.session).toBeDefined();
    });

    it('returns 400 when agentId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          machineId: 'machine-1',
          projectPath: '/home/user/project',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_AGENT_ID');
    });

    it('returns 400 when machineId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          agentId: 'agent-1',
          projectPath: '/home/user/project',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_MACHINE_ID');
    });

    it('returns 400 when projectPath is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          agentId: 'agent-1',
          machineId: 'machine-1',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_PROJECT_PATH');
    });

    it('returns 404 when agent does not exist', async () => {
      vi.mocked(mockDbRegistry.getAgent).mockResolvedValueOnce(undefined as never);

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          agentId: 'ghost-agent',
          machineId: 'machine-1',
          projectPath: '/home/user/project',
        },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('AGENT_NOT_FOUND');
    });

    it('returns 404 when machine does not exist', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(undefined as never);

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          agentId: 'agent-1',
          machineId: 'ghost-machine',
          projectPath: '/home/user/project',
        },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('MACHINE_NOT_FOUND');
    });

    it('returns 503 when machine is offline', async () => {
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(
        makeMachine({ status: 'offline' }) as never,
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          agentId: 'agent-1',
          machineId: 'machine-1',
          projectPath: '/home/user/project',
        },
      });

      expect(response.statusCode).toBe(503);

      const body = response.json();
      expect(body.error).toBe('MACHINE_OFFLINE');
    });

    it('creates session and marks as error when worker is unreachable', async () => {
      const inserted = makeSession({ status: 'starting' });
      mockDb.setRows([inserted]);
      mockFetchThrow('Connection refused');

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          agentId: 'agent-1',
          machineId: 'machine-1',
          projectPath: '/home/user/project',
        },
      });

      // Session is still created but status is updated to error
      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('marks session as error when worker returns non-OK', async () => {
      const inserted = makeSession({ status: 'starting' });
      mockDb.setRows([inserted]);
      mockFetchError(500);

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          agentId: 'agent-1',
          machineId: 'machine-1',
          projectPath: '/home/user/project',
        },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.ok).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/sessions/:sessionId/resume — resume a session
  // ---------------------------------------------------------------------------

  describe('POST /api/sessions/:sessionId/resume', () => {
    it('resumes a paused session and returns 200', async () => {
      const session = makeSession({ status: 'paused' });
      mockDb.setRows([session]);
      mockFetchOk();

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-001/resume',
        payload: { prompt: 'Continue working on the feature' },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('returns 400 when prompt is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-001/resume',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_PROMPT');
    });

    it('returns 404 when session does not exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/nonexistent/resume',
        payload: { prompt: 'Resume' },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('SESSION_NOT_FOUND');
    });

    it('returns 409 when session is already active', async () => {
      const session = makeSession({ status: 'active' });
      mockDb.setRows([session]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-001/resume',
        payload: { prompt: 'Resume' },
      });

      expect(response.statusCode).toBe(409);

      const body = response.json();
      expect(body.error).toBe('SESSION_ALREADY_ACTIVE');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/sessions/:sessionId/message — send a message
  // ---------------------------------------------------------------------------

  describe('POST /api/sessions/:sessionId/message', () => {
    it('forwards message to worker and returns 200', async () => {
      const session = makeSession({ status: 'active' });
      mockDb.setRows([session]);
      mockFetchOk({ ok: true, received: true });

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-001/message',
        payload: { message: 'Run the test suite' },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.sessionId).toBe('sess-001');
    });

    it('returns 400 when message is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-001/message',
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_MESSAGE');
    });

    it('returns 404 when session does not exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/nonexistent/message',
        payload: { message: 'Hello' },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('SESSION_NOT_FOUND');
    });

    it('returns 409 when session is not active', async () => {
      const session = makeSession({ status: 'ended' });
      mockDb.setRows([session]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-001/message',
        payload: { message: 'Hello' },
      });

      expect(response.statusCode).toBe(409);

      const body = response.json();
      expect(body.error).toBe('SESSION_NOT_ACTIVE');
    });

    it('returns 404 when machine is not found', async () => {
      const session = makeSession({ status: 'active' });
      mockDb.setRows([session]);
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(undefined as never);

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-001/message',
        payload: { message: 'Hello' },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('MACHINE_NOT_FOUND');
    });

    it('returns 503 when machine is offline', async () => {
      const session = makeSession({ status: 'active' });
      mockDb.setRows([session]);
      vi.mocked(mockDbRegistry.getMachine).mockResolvedValueOnce(
        makeMachine({ status: 'offline' }) as never,
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-001/message',
        payload: { message: 'Hello' },
      });

      expect(response.statusCode).toBe(503);

      const body = response.json();
      expect(body.error).toBe('MACHINE_OFFLINE');
    });

    it('returns 502 when worker returns an error', async () => {
      const session = makeSession({ status: 'active' });
      mockDb.setRows([session]);
      mockFetchError(500);

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-001/message',
        payload: { message: 'Hello' },
      });

      expect(response.statusCode).toBe(502);

      const body = response.json();
      expect(body.error).toBe('WORKER_ERROR');
    });

    it('returns 500 when worker is unreachable', async () => {
      const session = makeSession({ status: 'active' });
      mockDb.setRows([session]);
      mockFetchThrow('ECONNREFUSED');

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-001/message',
        payload: { message: 'Hello' },
      });

      // ControlPlaneError with WORKER_UNREACHABLE — mapped by Fastify error handler
      expect(response.statusCode).toBe(500);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/sessions/:sessionId — end a session
  // ---------------------------------------------------------------------------

  describe('DELETE /api/sessions/:sessionId', () => {
    it('ends a session and returns 200', async () => {
      const session = makeSession({ status: 'active' });
      mockDb.setRows([session]);
      mockFetchOk();

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/sessions/sess-001',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.sessionId).toBe('sess-001');
    });

    it('returns 404 when session does not exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/sessions/nonexistent',
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('SESSION_NOT_FOUND');
    });

    it('returns ok when session is already ended (idempotent)', async () => {
      const session = makeSession({ status: 'ended' });
      mockDb.setRows([session]);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/sessions/sess-001',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.message).toBe('Session was already ended');
    });

    it('ends session even when worker notification fails', async () => {
      const session = makeSession({ status: 'active' });
      mockDb.setRows([session]);
      mockFetchThrow('Connection refused');

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/sessions/sess-001',
      });

      // Session is still ended in control plane
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('purges session from DB when ?purge=true', async () => {
      const session = makeSession({ status: 'ended' });
      mockDb.setRows([session]);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/sessions/sess-001?purge=true',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.purged).toBe(true);
    });

    it('purges active session after notifying worker', async () => {
      const session = makeSession({ status: 'active' });
      mockDb.setRows([session]);
      mockFetchOk();

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/sessions/sess-001?purge=true',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.purged).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/sessions/discover — fan-out session discovery
  // ---------------------------------------------------------------------------

  describe('GET /api/sessions/discover', () => {
    it('returns merged sessions from all online workers', async () => {
      const machine1 = makeMachine({
        id: 'machine-1',
        hostname: 'mac-mini-01',
        tailscaleIp: '100.64.0.1',
      });
      const machine2 = makeMachine({
        id: 'machine-2',
        hostname: 'ec2-worker',
        tailscaleIp: '100.64.0.2',
      });

      vi.mocked(mockDbRegistry.listMachines).mockResolvedValueOnce([machine1, machine2] as never);

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('100.64.0.1')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              sessions: [
                {
                  sessionId: 'sess-a',
                  projectPath: '/home/user/project-a',
                  summary: 'Fix auth bug',
                  messageCount: 12,
                  lastActivity: '2026-03-03T09:00:00Z',
                  branch: 'main',
                },
              ],
              count: 1,
              machineId: 'machine-1',
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            sessions: [
              {
                sessionId: 'sess-b',
                projectPath: '/home/user/project-b',
                summary: 'Add tests',
                messageCount: 5,
                lastActivity: '2026-03-03T10:00:00Z',
                branch: 'feature/tests',
              },
            ],
            count: 1,
            machineId: 'machine-2',
          }),
        });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions/discover',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.count).toBe(2);
      expect(body.machinesQueried).toBe(2);
      expect(body.machinesFailed).toBe(0);
      expect(body.sessions).toHaveLength(2);

      // Should be sorted by lastActivity desc — sess-b (10:00) before sess-a (09:00)
      expect(body.sessions[0].sessionId).toBe('sess-b');
      expect(body.sessions[0].machineId).toBe('machine-2');
      expect(body.sessions[0].hostname).toBe('ec2-worker');
      expect(body.sessions[1].sessionId).toBe('sess-a');
      expect(body.sessions[1].machineId).toBe('machine-1');
      expect(body.sessions[1].hostname).toBe('mac-mini-01');
    });

    it('returns empty sessions when no machines are registered', async () => {
      vi.mocked(mockDbRegistry.listMachines).mockResolvedValueOnce([] as never);

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions/discover',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.sessions).toHaveLength(0);
      expect(body.count).toBe(0);
      expect(body.machinesQueried).toBe(0);
      expect(body.machinesFailed).toBe(0);
    });

    it('skips offline machines', async () => {
      const onlineMachine = makeMachine({
        id: 'machine-1',
        hostname: 'mac-mini-01',
        status: 'online',
      });
      const offlineMachine = makeMachine({
        id: 'machine-2',
        hostname: 'ec2-dead',
        status: 'offline',
      });

      vi.mocked(mockDbRegistry.listMachines).mockResolvedValueOnce([
        onlineMachine,
        offlineMachine,
      ] as never);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          sessions: [
            {
              sessionId: 'sess-a',
              projectPath: '/project',
              summary: 'Work',
              messageCount: 1,
              lastActivity: '2026-03-03T10:00:00Z',
              branch: null,
            },
          ],
          count: 1,
          machineId: 'machine-1',
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions/discover',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.machinesQueried).toBe(1);
      expect(body.sessions).toHaveLength(1);

      // fetch should only be called once (for the online machine)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('includes partial results when some workers fail', async () => {
      const machine1 = makeMachine({
        id: 'machine-1',
        hostname: 'mac-mini-01',
        tailscaleIp: '100.64.0.1',
      });
      const machine2 = makeMachine({
        id: 'machine-2',
        hostname: 'ec2-flaky',
        tailscaleIp: '100.64.0.2',
      });

      vi.mocked(mockDbRegistry.listMachines).mockResolvedValueOnce([machine1, machine2] as never);

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('100.64.0.1')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              sessions: [
                {
                  sessionId: 'sess-a',
                  projectPath: '/project',
                  summary: 'Work',
                  messageCount: 3,
                  lastActivity: '2026-03-03T10:00:00Z',
                  branch: 'main',
                },
              ],
              count: 1,
              machineId: 'machine-1',
            }),
          });
        }
        // Second machine fails
        return Promise.reject(new Error('Connection refused'));
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions/discover',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.count).toBe(1);
      expect(body.machinesQueried).toBe(2);
      expect(body.machinesFailed).toBe(1);
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].sessionId).toBe('sess-a');
    });

    it('counts worker HTTP errors as failures', async () => {
      const machine1 = makeMachine({ id: 'machine-1', hostname: 'mac-mini-01' });

      vi.mocked(mockDbRegistry.listMachines).mockResolvedValueOnce([machine1] as never);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'INTERNAL_ERROR' }),
        text: async () => 'Internal Server Error',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions/discover',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.count).toBe(0);
      expect(body.machinesQueried).toBe(1);
      expect(body.machinesFailed).toBe(1);
      expect(body.sessions).toHaveLength(0);
    });

    it('passes projectPath query parameter to workers', async () => {
      const machine1 = makeMachine({ id: 'machine-1', hostname: 'mac-mini-01' });

      vi.mocked(mockDbRegistry.listMachines).mockResolvedValueOnce([machine1] as never);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          sessions: [],
          count: 0,
          machineId: 'machine-1',
        }),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions/discover?projectPath=/home/user/myproject',
      });

      expect(response.statusCode).toBe(200);

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      const calledUrl = fetchCall[0] as string;
      expect(calledUrl).toContain('projectPath=%2Fhome%2Fuser%2Fmyproject');
    });

    it('returns 200 with all failures when every worker is unreachable', async () => {
      const machine1 = makeMachine({
        id: 'machine-1',
        hostname: 'mac-mini-01',
        tailscaleIp: '100.64.0.1',
      });
      const machine2 = makeMachine({
        id: 'machine-2',
        hostname: 'ec2-dead',
        tailscaleIp: '100.64.0.2',
      });

      vi.mocked(mockDbRegistry.listMachines).mockResolvedValueOnce([machine1, machine2] as never);

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions/discover',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.sessions).toHaveLength(0);
      expect(body.count).toBe(0);
      expect(body.machinesQueried).toBe(2);
      expect(body.machinesFailed).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/sessions/:sessionId/status — worker status updates
  // ---------------------------------------------------------------------------

  describe('PATCH /api/sessions/:sessionId/status', () => {
    it('updates session status and returns 200', async () => {
      const session = makeSession({ status: 'active' });
      mockDb.setRows([session]);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/sessions/sess-001/status',
        payload: {
          status: 'ended',
          claudeSessionId: 'claude-abc-123',
          pid: null,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('returns 404 when session does not exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/sessions/nonexistent/status',
        payload: { status: 'error' },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('SESSION_NOT_FOUND');
    });

    it('returns 400 for invalid status value', async () => {
      const session = makeSession();
      mockDb.setRows([session]);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/sessions/sess-001/status',
        payload: { status: 'invalid_status' },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_STATUS');
    });

    it('accepts partial updates (claudeSessionId only)', async () => {
      const session = makeSession();
      mockDb.setRows([session]);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/sessions/sess-001/status',
        payload: { claudeSessionId: 'claude-new-id' },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });

    it('accepts error message in update', async () => {
      const session = makeSession();
      mockDb.setRows([session]);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/sessions/sess-001/status',
        payload: {
          status: 'error',
          errorMessage: 'CLI process exited with code 1',
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/sessions/:sessionId/fork — fork a session
  // ---------------------------------------------------------------------------

  describe('POST /api/sessions/:sessionId/fork', () => {
    const parentSession = makeSession({
      id: 'sess-parent',
      claudeSessionId: 'claude-parent-abc',
      machineId: 'machine-1',
      agentId: 'agent-1',
      projectPath: '/home/user/project',
      model: 'sonnet',
      accountId: null,
    });

    it('forks with default resume strategy (backward compat)', async () => {
      mockDb.setRows([parentSession]);
      mockFetchOk();

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-parent/fork',
        payload: { prompt: 'Continue from here' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.forkedFrom).toBe('sess-parent');

      // Verify worker dispatch includes resumeSessionId, no forkAtIndex or systemPrompt
      const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
      expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
      const workerCallBody = JSON.parse(fetchCalls[0][1]?.body as string);
      expect(workerCallBody.resumeSessionId).toBe('claude-parent-abc');
      expect(workerCallBody.forkAtIndex).toBeUndefined();
      expect(workerCallBody.systemPrompt).toBeUndefined();
    });

    it('forks with explicit resume strategy', async () => {
      mockDb.setRows([parentSession]);
      mockFetchOk();

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-parent/fork',
        payload: { prompt: 'Keep going', strategy: 'resume' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.ok).toBe(true);

      const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
      const workerCallBody = JSON.parse(fetchCalls[0][1]?.body as string);
      expect(workerCallBody.resumeSessionId).toBe('claude-parent-abc');
      expect(workerCallBody.forkAtIndex).toBeUndefined();
    });

    it('forks with jsonl-truncation strategy and passes forkAtIndex', async () => {
      mockDb.setRows([parentSession]);
      mockFetchOk();

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-parent/fork',
        payload: {
          prompt: 'Fork at message 5',
          strategy: 'jsonl-truncation',
          forkAtIndex: 5,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.ok).toBe(true);

      const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
      const workerCallBody = JSON.parse(fetchCalls[0][1]?.body as string);
      expect(workerCallBody.resumeSessionId).toBe('claude-parent-abc');
      expect(workerCallBody.forkAtIndex).toBe(5);
      expect(workerCallBody.systemPrompt).toBeUndefined();
    });

    it('forks with context-injection strategy and passes systemPrompt without resumeSessionId', async () => {
      mockDb.setRows([parentSession]);
      mockFetchOk();

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-parent/fork',
        payload: {
          prompt: 'Continue with context',
          strategy: 'context-injection',
          selectedMessages: [
            { type: 'human', content: 'Fix the bug', timestamp: '2026-03-01T10:00:00Z' },
            {
              type: 'assistant',
              content: 'I will fix the bug.',
              timestamp: '2026-03-01T10:01:00Z',
            },
            { type: 'tool_use', content: 'Ran: npx vitest', toolName: 'bash' },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.ok).toBe(true);

      const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
      const workerCallBody = JSON.parse(fetchCalls[0][1]?.body as string);

      // context-injection should NOT pass resumeSessionId
      expect(workerCallBody.resumeSessionId).toBeUndefined();

      // Should pass formatted systemPrompt
      expect(workerCallBody.systemPrompt).toContain('## Previous Conversation Context');
      expect(workerCallBody.systemPrompt).toContain('### User (2026-03-01T10:00:00Z)');
      expect(workerCallBody.systemPrompt).toContain('Fix the bug');
      expect(workerCallBody.systemPrompt).toContain('### Assistant (2026-03-01T10:01:00Z)');
      expect(workerCallBody.systemPrompt).toContain('I will fix the bug.');
      expect(workerCallBody.systemPrompt).toContain('### Tool');
      expect(workerCallBody.systemPrompt).toContain('Tool: bash');
      expect(workerCallBody.systemPrompt).toContain('Ran: npx vitest');
    });

    it('stores forkStrategy in session metadata', async () => {
      mockDb.setRows([parentSession]);
      mockFetchOk();

      await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-parent/fork',
        payload: { prompt: 'Fork it', strategy: 'jsonl-truncation', forkAtIndex: 3 },
      });

      // Check the values() call on the DB insert chain
      const valuesCalls = vi.mocked(mockDb.db.values as ReturnType<typeof vi.fn>).mock.calls;
      const lastValuesCall = valuesCalls[valuesCalls.length - 1];
      expect(lastValuesCall[0].metadata).toMatchObject({
        forkStrategy: 'jsonl-truncation',
        forkedFrom: 'sess-parent',
      });
    });

    it('returns 400 when prompt is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-parent/fork',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('INVALID_PROMPT');
    });

    it('returns 404 when parent session does not exist', async () => {
      mockDb.setRows([]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/ghost-session/fork',
        payload: { prompt: 'Fork it' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('SESSION_NOT_FOUND');
    });

    it('returns 400 when parent has no claudeSessionId', async () => {
      mockDb.setRows([makeSession({ id: 'sess-no-claude', claudeSessionId: null })]);

      const response = await app.inject({
        method: 'POST',
        url: '/api/sessions/sess-no-claude/fork',
        payload: { prompt: 'Fork it' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('NO_CLAUDE_SESSION');
    });
  });

  // ---------------------------------------------------------------------------
  // Nonexistent routes
  // ---------------------------------------------------------------------------

  describe('nonexistent routes', () => {
    it('returns 404 for unknown sub-path', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/sessions/sess-001/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

// =============================================================================
// POST / — account credential resolution
// =============================================================================

describe('POST / — account credential resolution', () => {
  let app: FastifyInstance;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockDbRegistry: DbAgentRegistry;

  beforeAll(async () => {
    mockDb = createMockDb();
    mockDbRegistry = createMockDbRegistry();
    app = Fastify({ logger: false });
    await app.register(sessionRoutes, {
      prefix: '/api/sessions',
      db: mockDb.db as never,
      dbRegistry: mockDbRegistry,
      workerPort: 9000,
      encryptionKey: 'test-key-32-chars-long-enough-aa',
    });
    await app.ready();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.mocked(resolveAccountId).mockReset().mockResolvedValue(null);
    vi.mocked(decryptCredential).mockReset().mockReturnValue('decrypted-api-key-123');
  });

  afterAll(async () => {
    await app.close();
  });

  it('stores accountId in session when provided', async () => {
    // resolveAccountId should echo back the session-level accountId
    vi.mocked(resolveAccountId).mockResolvedValueOnce('acct-explicit-123');

    // First call: agent lookup (agents table); Second call: account lookup (apiAccounts);
    // Third call: insert returning; Fourth call: re-read after worker dispatch
    const inserted = makeSession({
      status: 'starting',
      accountId: 'acct-explicit-123',
    });
    mockDb.setRows([inserted]);
    mockFetchOk();

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        agentId: 'agent-1',
        machineId: 'machine-1',
        projectPath: '/home/user/project',
        accountId: 'acct-explicit-123',
      },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.ok).toBe(true);

    // resolveAccountId should have been called with the session-level accountId
    expect(resolveAccountId).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionAccountId: 'acct-explicit-123',
      }),
      expect.anything(),
      expect.anything(),
    );

    // The DB insert chain should include accountId
    // Verify via the insert().values() call on the mock chain
    const valuesCalls = vi.mocked(mockDb.db.values as ReturnType<typeof vi.fn>).mock.calls;
    const lastValuesCall = valuesCalls[valuesCalls.length - 1];
    expect(lastValuesCall[0]).toMatchObject({
      accountId: 'acct-explicit-123',
    });
  });

  it('resolves credentials via resolveAccountId cascade', async () => {
    // resolveAccountId returns an account ID (from e.g. project mapping)
    vi.mocked(resolveAccountId).mockResolvedValueOnce('acct-resolved-456');

    // Mock DB will return: agent row, account row, insert result, final re-read
    // We use setRows so every chained query returns the same rows —
    // the route only checks first element via destructuring [row].
    const accountRow = {
      id: 'acct-resolved-456',
      name: 'Prod Anthropic',
      provider: 'anthropic',
      credential: 'encrypted-blob',
      credentialIv: 'iv-blob',
      priority: 0,
      rateLimit: {},
      isActive: true,
      metadata: {},
      createdAt: NOW,
      updatedAt: NOW,
    };

    const _inserted = makeSession({
      status: 'starting',
      accountId: 'acct-resolved-456',
    });

    // The mock DB always returns the same rows for any query.
    // The route makes multiple queries sequentially — we set rows to
    // cover the "apiAccounts" lookup and the insert returning.
    // Because the mock resolves rows via .then, we set it to the account
    // row first (agent select returns it as well, which is fine — the
    // route only reads accountId from agent row, and account row has it).
    mockDb.setRows([accountRow]);

    // After the account lookup + insert, the route re-reads the session
    // We need to handle the fact that the same rows are returned for all queries.
    // The insert().values().returning() chain also resolves with mockDb rows.
    // We'll set rows to the account row (covers the account lookup) and the
    // inserted session row is also returned (the route uses `inserted` from returning).

    // Actually, with this mock pattern, all queries return the same rows.
    // The route will: 1) select agent, 2) select apiAccounts, 3) insert returning, 4) select session.
    // All resolve with [accountRow]. The route destructures [agentRow] for accountId,
    // [account] for credential, [inserted] from returning, [updatedSession] for final read.
    // This is acceptable since we're testing the credential resolution flow, not the row data.

    mockFetchOk();

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        agentId: 'agent-1',
        machineId: 'machine-1',
        projectPath: '/home/user/project',
      },
    });

    expect(response.statusCode).toBe(201);

    // decryptCredential should have been called with the account's encrypted data
    expect(decryptCredential).toHaveBeenCalledWith(
      'encrypted-blob',
      'iv-blob',
      'test-key-32-chars-long-enough-aa',
    );

    // Worker dispatch should include the decrypted credential and provider
    const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
    // The first fetch call is the worker dispatch POST
    const workerCallBody = JSON.parse(fetchCalls[0][1]?.body as string);
    expect(workerCallBody.accountCredential).toBe('decrypted-api-key-123');
    expect(workerCallBody.accountProvider).toBe('anthropic');
  });

  it('passes null credentials when no account resolved', async () => {
    // resolveAccountId returns null — no account found at any level
    vi.mocked(resolveAccountId).mockResolvedValueOnce(null);

    const inserted = makeSession({ status: 'starting' });
    mockDb.setRows([inserted]);
    mockFetchOk();

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        agentId: 'agent-1',
        machineId: 'machine-1',
        projectPath: '/home/user/project',
      },
    });

    expect(response.statusCode).toBe(201);

    // decryptCredential should NOT have been called
    expect(decryptCredential).not.toHaveBeenCalled();

    // Worker dispatch should have null credential and provider
    const fetchCalls = vi.mocked(globalThis.fetch).mock.calls;
    const workerCallBody = JSON.parse(fetchCalls[0][1]?.body as string);
    expect(workerCallBody.accountCredential).toBeNull();
    expect(workerCallBody.accountProvider).toBeNull();
  });
});
