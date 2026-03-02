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

// ---------------------------------------------------------------------------
// Sample data fixtures
// ---------------------------------------------------------------------------

const sampleActions = [
  {
    id: 1,
    runId: 'session-abc',
    timestamp: new Date('2026-03-01T10:00:00Z'),
    actionType: 'tool_call',
    toolName: 'Read',
    toolInput: { file: 'src/index.ts' },
    toolOutputHash: null,
    durationMs: 100,
    approvedBy: 'auto',
    agentId: 'agent-1',
  },
  {
    id: 2,
    runId: 'session-abc',
    timestamp: new Date('2026-03-01T10:00:01Z'),
    actionType: 'tool_result',
    toolName: 'Read',
    toolInput: null,
    toolOutputHash: 'sha256-abc',
    durationMs: 150,
    approvedBy: null,
    agentId: 'agent-1',
  },
  {
    id: 3,
    runId: 'session-abc',
    timestamp: new Date('2026-03-01T10:00:02Z'),
    actionType: 'tool_call',
    toolName: 'Bash',
    toolInput: { command: 'ls' },
    toolOutputHash: null,
    durationMs: 200,
    approvedBy: 'auto',
    agentId: 'agent-1',
  },
];

// =============================================================================
// Tests WITH dbRegistry configured
// =============================================================================

describe('Replay routes — /api/audit/replay (configured)', () => {
  let app: FastifyInstance;
  let mockDbRegistry: DbAgentRegistry;

  beforeAll(async () => {
    mockDbRegistry = createMockDbRegistry();
    app = await createServer({ logger, dbRegistry: mockDbRegistry });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockDbRegistry.queryActions).mockResolvedValue({
      actions: sampleActions,
      total: 3,
      hasMore: false,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // GET /api/audit/replay/:sessionId — timeline
  // ---------------------------------------------------------------------------

  it('returns a session timeline for a valid sessionId', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/session-abc?agentId=agent-1',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.sessionId).toBe('session-abc');
    expect(body.agentId).toBe('agent-1');
    expect(body.totalEvents).toBe(3);
    expect(body.events).toHaveLength(3);
    expect(body.toolsUsed).toEqual(expect.arrayContaining(['Read', 'Bash']));
  });

  it('infers agentId from entries when not provided in querystring', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/session-abc',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.agentId).toBe('agent-1');
  });

  it('returns 404 when no entries match the sessionId', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/non-existent-session',
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();
    expect(body.code).toBe('SESSION_NOT_FOUND');
  });

  it('applies toolName filter to timeline events', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/session-abc?agentId=agent-1&toolName=Read',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.events.every((e: { tool: string }) => e.tool === 'Read')).toBe(true);
  });

  it('applies eventType filter to timeline events', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/session-abc?agentId=agent-1&eventType=tool_call',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.events.every((e: { eventType: string }) => e.eventType === 'tool_call')).toBe(true);
  });

  it('returns 502 when dbRegistry throws ControlPlaneError', async () => {
    vi.mocked(mockDbRegistry.queryActions).mockRejectedValueOnce(
      new ControlPlaneError('AUDIT_QUERY_FAILED', 'Query failed', {}),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/session-abc?agentId=agent-1',
    });

    expect(response.statusCode).toBe(502);

    const body = response.json();
    expect(body.code).toBe('AUDIT_QUERY_FAILED');
  });

  it('returns 500 when an unexpected error occurs', async () => {
    vi.mocked(mockDbRegistry.queryActions).mockRejectedValueOnce(new Error('unexpected'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/session-abc?agentId=agent-1',
    });

    expect(response.statusCode).toBe(500);

    const body = response.json();
    expect(body.error).toBe('Failed to build session replay');
  });

  // ---------------------------------------------------------------------------
  // GET /api/audit/replay/:sessionId/summary
  // ---------------------------------------------------------------------------

  it('returns a session summary', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/session-abc/summary?agentId=agent-1',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.sessionId).toBe('session-abc');
    expect(body.agentId).toBe('agent-1');
    expect(body.totalToolCalls).toBeGreaterThanOrEqual(0);
    expect(typeof body.denialRate).toBe('number');
    expect(typeof body.duration).toBe('number');
    expect(typeof body.averageDurationMs).toBe('number');
  });

  it('returns 404 for summary of unknown session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/unknown-session/summary',
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();
    expect(body.code).toBe('SESSION_NOT_FOUND');
  });

  // ---------------------------------------------------------------------------
  // GET /api/audit/replay/:sessionId/suspicious
  // ---------------------------------------------------------------------------

  it('returns suspicious patterns array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/session-abc/suspicious?agentId=agent-1',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 404 for suspicious patterns of unknown session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/unknown-session/suspicious',
    });

    expect(response.statusCode).toBe(404);

    const body = response.json();
    expect(body.code).toBe('SESSION_NOT_FOUND');
  });

  it('detects suspicious patterns from audit data with cost spikes', async () => {
    vi.mocked(mockDbRegistry.queryActions).mockResolvedValueOnce({
      actions: [
        {
          id: 10,
          runId: 'session-spike',
          timestamp: new Date('2026-03-01T10:00:00Z'),
          actionType: 'cost_update',
          toolName: 'Bash',
          toolInput: null,
          toolOutputHash: null,
          durationMs: 5000,
          approvedBy: 'auto',
          agentId: 'agent-1',
        },
      ],
      total: 1,
      hasMore: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/session-spike/suspicious?agentId=agent-1',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// =============================================================================
// Tests WITHOUT dbRegistry — replay routes are NOT registered (404)
// =============================================================================

describe('Replay routes — /api/audit/replay (not configured)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/audit/replay/:sessionId returns 404 when dbRegistry is not provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/session-abc',
    });

    expect(response.statusCode).toBe(404);
  });

  it('GET /api/audit/replay/:sessionId/summary returns 404 when dbRegistry is not provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/session-abc/summary',
    });

    expect(response.statusCode).toBe(404);
  });

  it('GET /api/audit/replay/:sessionId/suspicious returns 404 when dbRegistry is not provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit/replay/session-abc/suspicious',
    });

    expect(response.statusCode).toBe(404);
  });
});
