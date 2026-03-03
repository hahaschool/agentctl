import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { createServer } from '../server.js';

const logger = {
  child: () => logger,
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  silent: vi.fn(),
  level: 'silent',
} as unknown as Logger;

function createMockDbRegistry(overrides: Partial<DbAgentRegistry> = {}): DbAgentRegistry {
  return {
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn().mockResolvedValue([]),
    createAgent: vi.fn().mockResolvedValue('agent-new'),
    getAgent: vi.fn().mockResolvedValue(undefined),
    updateAgentStatus: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getRecentRuns: vi.fn().mockResolvedValue([]),
    completeRun: vi.fn(),
    createRun: vi.fn().mockResolvedValue('run-001'),
    insertActions: vi.fn().mockResolvedValue(3),
    getMachine: vi.fn(),
    queryActions: vi.fn().mockResolvedValue({ actions: [], total: 0, hasMore: false }),
    getAuditSummary: vi.fn().mockResolvedValue({
      totalActions: 0,
      topTools: [],
      topAgents: [],
      errorCount: 0,
    }),
    ...overrides,
  } as unknown as DbAgentRegistry;
}

// =============================================================================
// Tests WITH dbRegistry configured — audit routes are registered
// =============================================================================

describe('Audit routes — /api/audit (configured)', () => {
  let app: FastifyInstance;
  let mockDbRegistry: DbAgentRegistry;

  beforeAll(async () => {
    mockDbRegistry = createMockDbRegistry();
    app = await createServer({ logger, dbRegistry: mockDbRegistry });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock implementations after clearAllMocks
    vi.mocked(mockDbRegistry.insertActions).mockResolvedValue(3);
    vi.mocked(mockDbRegistry.queryActions).mockResolvedValue({
      actions: [],
      total: 0,
      hasMore: false,
    });
    vi.mocked(mockDbRegistry.getAuditSummary).mockResolvedValue({
      totalActions: 0,
      topTools: [],
      topAgents: [],
      errorCount: 0,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // POST /api/audit/actions — Happy path
  // ---------------------------------------------------------------------------

  describe('POST /api/audit/actions — happy path', () => {
    it('ingests a batch of actions and returns insertedCount', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockResolvedValueOnce(2);

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [
            { actionType: 'tool_use', toolName: 'Read', durationMs: 150 },
            { actionType: 'tool_use', toolName: 'Write', durationMs: 200 },
          ],
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.insertedCount).toBe(2);
    });

    it('calls dbRegistry.insertActions with the correct arguments', async () => {
      const actions = [
        {
          actionType: 'tool_use',
          toolName: 'Bash',
          toolInput: { command: 'ls' },
          toolOutputHash: 'sha256-abc123',
          durationMs: 500,
          approvedBy: 'user-1',
        },
      ];

      await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: { runId: 'run-xyz', actions },
      });

      expect(mockDbRegistry.insertActions).toHaveBeenCalledWith('run-xyz', actions);
    });

    it('accepts actions with only the required actionType field', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockResolvedValueOnce(1);

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-002',
          actions: [{ actionType: 'agent_start' }],
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.insertedCount).toBe(1);
    });

    it('accepts actions with null optional fields', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockResolvedValueOnce(1);

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-003',
          actions: [
            {
              actionType: 'tool_use',
              toolName: null,
              toolInput: null,
              toolOutputHash: null,
              durationMs: null,
              approvedBy: null,
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/audit/actions — Validation errors
  // ---------------------------------------------------------------------------

  describe('POST /api/audit/actions — validation', () => {
    it('returns 400 when runId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          actions: [{ actionType: 'tool_use' }],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.message).toMatch(/runId/i);
    });

    it('returns 400 when runId is an empty string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: '',
          actions: [{ actionType: 'tool_use' }],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.message).toMatch(/runId/i);
    });

    it('returns 400 when runId is not a string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 12345,
          actions: [{ actionType: 'tool_use' }],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.message).toMatch(/runId/i);
    });

    it('returns 400 when actions is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.message).toMatch(/actions/i);
    });

    it('returns 400 when actions is an empty array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.message).toMatch(/actions/i);
    });

    it('returns 400 when actions is not an array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: 'not-an-array',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.message).toMatch(/actions/i);
    });

    it('returns 400 when batch size exceeds maximum of 1000', async () => {
      const oversizedActions = Array.from({ length: 1001 }, (_, i) => ({
        actionType: `action-${i}`,
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: oversizedActions,
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.message).toMatch(/1001/);
      expect(body.message).toMatch(/1000/);
      expect(body.error).toBe('BATCH_SIZE_EXCEEDED');
    });

    it('accepts exactly 1000 actions (boundary)', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockResolvedValueOnce(1000);

      const maxActions = Array.from({ length: 1000 }, (_, i) => ({
        actionType: `action-${i}`,
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-boundary',
          actions: maxActions,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.ok).toBe(true);
      expect(body.insertedCount).toBe(1000);
    });

    it('returns 400 when an action has missing actionType', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [{ toolName: 'Read' }],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.message).toMatch(/actionType/i);
    });

    it('returns 400 when an action has empty string actionType', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [{ actionType: '' }],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.message).toMatch(/actionType/i);
    });

    it('returns 400 when an action has non-string actionType', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [{ actionType: 42 }],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.message).toMatch(/actionType/i);
    });

    it('returns 400 on first invalid action in a mixed batch', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [
            { actionType: 'tool_use', toolName: 'Read' },
            { actionType: '' }, // invalid
            { actionType: 'tool_use', toolName: 'Write' },
          ],
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.message).toMatch(/actionType/i);

      // dbRegistry.insertActions should NOT have been called
      expect(mockDbRegistry.insertActions).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/audit/actions — Error handling
  // ---------------------------------------------------------------------------

  describe('POST /api/audit/actions — error handling', () => {
    it('returns 502 when dbRegistry throws ControlPlaneError', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockRejectedValueOnce(
        new ControlPlaneError(
          'AUDIT_INSERT_FAILED',
          'Failed to insert audit actions: connection refused',
          {
            runId: 'run-001',
            actionCount: 1,
          },
        ),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [{ actionType: 'tool_use' }],
        },
      });

      expect(response.statusCode).toBe(502);

      const body = response.json();
      expect(body.error).toBe('AUDIT_INSERT_FAILED');
      expect(body.message).toMatch(/insert/i);
    });

    it('returns 500 when dbRegistry throws an unexpected error', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockRejectedValueOnce(new Error('connection reset'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [{ actionType: 'tool_use' }],
        },
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('INGEST_FAILED');
    });

    it('returns 500 when dbRegistry throws a non-Error value', async () => {
      vi.mocked(mockDbRegistry.insertActions).mockRejectedValueOnce('string error');

      const response = await app.inject({
        method: 'POST',
        url: '/api/audit/actions',
        payload: {
          runId: 'run-001',
          actions: [{ actionType: 'tool_use' }],
        },
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('INGEST_FAILED');
    });
  });
});

// =============================================================================
// Tests for GET /api/audit — query audit actions
// =============================================================================

describe('Audit routes — GET /api/audit (query)', () => {
  let app: FastifyInstance;
  let mockDbRegistry: DbAgentRegistry;

  const sampleActions = [
    {
      id: 1,
      runId: 'run-001',
      timestamp: new Date('2026-03-01T10:00:00Z'),
      actionType: 'pre_tool_use',
      toolName: 'Bash',
      toolInput: null,
      toolOutputHash: null,
      durationMs: null,
      approvedBy: 'auto',
      agentId: 'agent-1',
    },
    {
      id: 2,
      runId: 'run-001',
      timestamp: new Date('2026-03-01T10:01:00Z'),
      actionType: 'post_tool_use',
      toolName: 'Bash',
      toolInput: null,
      toolOutputHash: 'sha256-abc',
      durationMs: 150,
      approvedBy: null,
      agentId: 'agent-1',
    },
  ];

  beforeAll(async () => {
    mockDbRegistry = createMockDbRegistry();
    app = await createServer({ logger, dbRegistry: mockDbRegistry });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockDbRegistry.queryActions).mockResolvedValue({
      actions: sampleActions,
      total: 2,
      hasMore: false,
    });
    vi.mocked(mockDbRegistry.getAuditSummary).mockResolvedValue({
      totalActions: 50,
      topTools: [
        { tool: 'Bash', count: 30 },
        { tool: 'Read', count: 20 },
      ],
      topAgents: [{ agentId: 'agent-1', count: 50 }],
      errorCount: 3,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // GET /api/audit — happy path
  // ---------------------------------------------------------------------------

  it('returns actions with default pagination', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.actions).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.hasMore).toBe(false);

    expect(mockDbRegistry.queryActions).toHaveBeenCalledWith({
      agentId: undefined,
      from: undefined,
      to: undefined,
      tool: undefined,
      limit: 100,
      offset: 0,
    });
  });

  it('passes agentId filter to queryActions', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit?agentId=agent-1',
    });

    expect(response.statusCode).toBe(200);

    expect(mockDbRegistry.queryActions).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1' }),
    );
  });

  it('passes tool filter to queryActions', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit?tool=Bash',
    });

    expect(response.statusCode).toBe(200);

    expect(mockDbRegistry.queryActions).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'Bash' }),
    );
  });

  it('passes from and to date filters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit?from=2026-03-01T00:00:00Z&to=2026-03-02T00:00:00Z',
    });

    expect(response.statusCode).toBe(200);

    expect(mockDbRegistry.queryActions).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '2026-03-01T00:00:00Z',
        to: '2026-03-02T00:00:00Z',
      }),
    );
  });

  it('passes custom limit and offset', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit?limit=50&offset=10',
    });

    expect(response.statusCode).toBe(200);

    expect(mockDbRegistry.queryActions).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, offset: 10 }),
    );
  });

  it('caps limit at 1000', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit?limit=5000',
    });

    expect(response.statusCode).toBe(200);

    expect(mockDbRegistry.queryActions).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1000 }),
    );
  });

  it('returns hasMore=true when more results exist beyond the page', async () => {
    vi.mocked(mockDbRegistry.queryActions).mockResolvedValueOnce({
      actions: sampleActions,
      total: 150,
      hasMore: true,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/audit?limit=2',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.hasMore).toBe(true);
    expect(body.total).toBe(150);
  });

  // ---------------------------------------------------------------------------
  // GET /api/audit — validation errors
  // ---------------------------------------------------------------------------

  it('returns 400 for invalid limit (non-numeric)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit?limit=abc',
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.message).toMatch(/limit/i);
  });

  it('returns 400 for negative limit', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit?limit=-5',
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.message).toMatch(/limit/i);
  });

  it('returns 400 for negative offset', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit?offset=-1',
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.message).toMatch(/offset/i);
  });

  it('returns 400 for invalid from date', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit?from=not-a-date',
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.message).toMatch(/from/i);
  });

  it('returns 400 for invalid to date', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit?to=not-a-date',
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.message).toMatch(/to/i);
  });

  // ---------------------------------------------------------------------------
  // GET /api/audit — error handling
  // ---------------------------------------------------------------------------

  it('returns 502 when queryActions throws ControlPlaneError', async () => {
    vi.mocked(mockDbRegistry.queryActions).mockRejectedValueOnce(
      new ControlPlaneError('AUDIT_QUERY_FAILED', 'Query failed: connection refused', {}),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/audit',
    });

    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.error).toBe('AUDIT_QUERY_FAILED');
  });

  it('returns 500 when queryActions throws an unexpected error', async () => {
    vi.mocked(mockDbRegistry.queryActions).mockRejectedValueOnce(new Error('boom'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/audit',
    });

    expect(response.statusCode).toBe(500);

    const body = response.json();
    expect(body.error).toBe('QUERY_FAILED');
  });
});

// =============================================================================
// Tests for GET /api/audit/summary — aggregated stats
// =============================================================================

describe('Audit routes — GET /api/audit/summary', () => {
  let app: FastifyInstance;
  let mockDbRegistry: DbAgentRegistry;

  beforeAll(async () => {
    mockDbRegistry = createMockDbRegistry();
    app = await createServer({ logger, dbRegistry: mockDbRegistry });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockDbRegistry.getAuditSummary).mockResolvedValue({
      totalActions: 100,
      topTools: [
        { tool: 'Bash', count: 50 },
        { tool: 'Read', count: 30 },
        { tool: 'Write', count: 20 },
      ],
      topAgents: [
        { agentId: 'agent-1', count: 60 },
        { agentId: 'agent-2', count: 40 },
      ],
      errorCount: 5,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns summary with all fields', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/summary',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.totalActions).toBe(100);
    expect(body.topTools).toHaveLength(3);
    expect(body.topTools[0]).toEqual({ tool: 'Bash', count: 50 });
    expect(body.topAgents).toHaveLength(2);
    expect(body.topAgents[0]).toEqual({ agentId: 'agent-1', count: 60 });
    expect(body.errorCount).toBe(5);
  });

  it('passes agentId filter to getAuditSummary', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/summary?agentId=agent-1',
    });

    expect(response.statusCode).toBe(200);

    expect(mockDbRegistry.getAuditSummary).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1' }),
    );
  });

  it('passes from and to date filters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/summary?from=2026-03-01T00:00:00Z&to=2026-03-02T00:00:00Z',
    });

    expect(response.statusCode).toBe(200);

    expect(mockDbRegistry.getAuditSummary).toHaveBeenCalledWith({
      agentId: undefined,
      from: '2026-03-01T00:00:00Z',
      to: '2026-03-02T00:00:00Z',
    });
  });

  it('returns 400 for invalid from date', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/summary?from=garbage',
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.message).toMatch(/from/i);
  });

  it('returns 400 for invalid to date', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/summary?to=garbage',
    });

    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.message).toMatch(/to/i);
  });

  it('returns 502 when getAuditSummary throws ControlPlaneError', async () => {
    vi.mocked(mockDbRegistry.getAuditSummary).mockRejectedValueOnce(
      new ControlPlaneError('AUDIT_SUMMARY_FAILED', 'Summary failed: timeout', {}),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/summary',
    });

    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.error).toBe('AUDIT_SUMMARY_FAILED');
  });

  it('returns 500 when getAuditSummary throws an unexpected error', async () => {
    vi.mocked(mockDbRegistry.getAuditSummary).mockRejectedValueOnce(new Error('boom'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/summary',
    });

    expect(response.statusCode).toBe(500);

    const body = response.json();
    expect(body.error).toBe('SUMMARY_FAILED');
  });
});

// =============================================================================
// Tests WITHOUT dbRegistry — audit routes are NOT registered (404)
// =============================================================================

describe('Audit routes — /api/audit (not configured)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/audit/actions returns 404 when dbRegistry is not provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/audit/actions',
      payload: {
        runId: 'run-001',
        actions: [{ actionType: 'tool_use' }],
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it('GET /api/audit returns 404 when dbRegistry is not provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit',
    });

    expect(response.statusCode).toBe(404);
  });

  it('GET /api/audit/summary returns 404 when dbRegistry is not provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/summary',
    });

    expect(response.statusCode).toBe(404);
  });
});
