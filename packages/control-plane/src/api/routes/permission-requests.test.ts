import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { permissionRequestRoutes } from './permission-requests.js';
import {
  createMockDbRegistry,
  mockFetchOk,
  restoreFetch,
  saveOriginalFetch,
} from './test-helpers.js';

// ── Mock WS broadcast ─────────────────────────────────────────────────────
vi.mock('./ws.js', () => ({
  broadcastPermissionEvent: vi.fn(),
}));

// ── DB Mock ───────────────────────────────────────────────────────────────

const ROW_ID = '00000000-0000-4000-a000-000000000001';
const AGENT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const SESSION_ID = 'sess-001';
const MACHINE_ID = 'machine-1';
const REQUEST_ID = 'req-001';

function makePendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROW_ID,
    agentId: AGENT_ID,
    sessionId: SESSION_ID,
    machineId: MACHINE_ID,
    requestId: REQUEST_ID,
    toolName: 'Bash',
    toolInput: { command: 'ls -la' },
    description: null,
    status: 'pending',
    requestedAt: new Date(),
    timeoutAt: new Date(Date.now() + 300_000),
    resolvedAt: null,
    resolvedBy: null,
    decision: null,
    ...overrides,
  };
}

/** Chain-mockable Drizzle DB mock */
function createMockDrizzleDb() {
  const rows: Array<Record<string, unknown>> = [];

  const returningFn = vi.fn().mockImplementation(async () => rows);
  const setFn = vi
    .fn()
    .mockReturnValue({ where: vi.fn().mockReturnValue({ returning: returningFn }) });
  const valuesFn = vi.fn().mockReturnValue({ returning: returningFn });
  const orderByFn = vi.fn().mockReturnValue(rows);
  const whereFn = vi.fn().mockReturnValue({ orderBy: orderByFn });

  const db = {
    insert: vi.fn().mockReturnValue({ values: valuesFn }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: whereFn,
        orderBy: orderByFn,
      }),
    }),
    update: vi.fn().mockReturnValue({ set: setFn }),
    _rows: rows,
    _returningFn: returningFn,
    _setFn: setFn,
    _valuesFn: valuesFn,
  };

  return db;
}

// ── Test Suite ─────────────────────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;

beforeAll(() => {
  originalFetch = saveOriginalFetch();
});

afterAll(() => {
  restoreFetch(originalFetch);
});

describe('permission-requests routes', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof createMockDrizzleDb>;

  beforeEach(async () => {
    db = createMockDrizzleDb();
    mockFetchOk({ ok: true });

    app = Fastify({ logger: false });
    await app.register(permissionRequestRoutes, {
      prefix: '/api/permission-requests',
      db: db as never,
      dbRegistry: createMockDbRegistry(),
      workerPort: 9000,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  // ── POST / ──────────────────────────────────────────────────────────────

  describe('POST /api/permission-requests', () => {
    const validBody = {
      agentId: AGENT_ID,
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      requestId: REQUEST_ID,
      toolName: 'Bash',
      toolInput: { command: 'ls -la' },
      timeoutSeconds: 300,
    };

    it('creates a pending permission request and returns 201', async () => {
      const created = makePendingRow();
      db._returningFn.mockResolvedValueOnce([created]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/permission-requests',
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.status).toBe('pending');
      expect(body.toolName).toBe('Bash');
    });

    it('returns 400 when agentId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/permission-requests',
        payload: { ...validBody, agentId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_AGENT_ID');
    });

    it('returns 400 when sessionId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/permission-requests',
        payload: { ...validBody, sessionId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_SESSION_ID');
    });

    it('returns 400 when toolName is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/permission-requests',
        payload: { ...validBody, toolName: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_TOOL_NAME');
    });

    it('returns 400 when timeoutSeconds is not a positive integer', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/permission-requests',
        payload: { ...validBody, timeoutSeconds: -1 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_TIMEOUT_SECONDS');
    });

    it('returns 400 when requestId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/permission-requests',
        payload: { ...validBody, requestId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_REQUEST_ID');
    });
  });

  // ── GET / ───────────────────────────────────────────────────────────────

  describe('GET /api/permission-requests', () => {
    it('returns all permission requests', async () => {
      const rows = [makePendingRow(), makePendingRow({ id: 'other-id', status: 'approved' })];
      // The db.select().from().orderBy() chain returns rows
      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue(rows) }),
          orderBy: vi.fn().mockReturnValue(rows),
        }),
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/permission-requests',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(2);
    });

    it('filters by status when provided', async () => {
      const pendingRows = [makePendingRow()];
      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue(pendingRows) }),
          orderBy: vi.fn().mockReturnValue(pendingRows),
        }),
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/permission-requests?status=pending',
      });

      expect(res.statusCode).toBe(200);
    });

    it('returns 400 for invalid status filter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/permission-requests?status=invalid',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_STATUS');
    });
  });

  // ── PATCH /:id ──────────────────────────────────────────────────────────

  describe('PATCH /api/permission-requests/:id', () => {
    it('approves a pending request', async () => {
      const pending = makePendingRow();
      const approved = { ...pending, status: 'approved', decision: 'approved' };

      // Mock select().from().where() for the existence check
      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue([pending]),
        }),
      });
      // Mock update().set().where().returning() for the update
      db.update.mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([approved]),
          }),
        }),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/permission-requests/${ROW_ID}`,
        payload: { decision: 'approved' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('approved');
    });

    it('denies a pending request', async () => {
      const pending = makePendingRow();
      const denied = { ...pending, status: 'denied', decision: 'denied' };

      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue([pending]),
        }),
      });
      db.update.mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([denied]),
          }),
        }),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/permission-requests/${ROW_ID}`,
        payload: { decision: 'denied' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('denied');
    });

    it('returns 404 when request does not exist', async () => {
      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue([]),
        }),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/permission-requests/${ROW_ID}`,
        payload: { decision: 'approved' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('PERMISSION_REQUEST_NOT_FOUND');
    });

    it('returns 409 when request is already resolved', async () => {
      const alreadyApproved = makePendingRow({ status: 'approved' });

      db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue([alreadyApproved]),
        }),
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/permission-requests/${ROW_ID}`,
        payload: { decision: 'denied' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('PERMISSION_REQUEST_ALREADY_RESOLVED');
    });

    it('returns 400 when decision is invalid', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/permission-requests/${ROW_ID}`,
        payload: { decision: 'maybe' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_DECISION');
    });
  });
});
