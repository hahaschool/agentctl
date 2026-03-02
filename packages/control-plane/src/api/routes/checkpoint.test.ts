import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

// ---------------------------------------------------------------------------
// Mock DB (drizzle-like update/set/where/returning chain)
// ---------------------------------------------------------------------------

const mockUpdateReturning = vi.fn().mockResolvedValue([{ id: 'agent-001' }]);
const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockDbUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

const mockDb = {
  update: mockDbUpdate,
} as unknown as Parameters<typeof createServer>[0]['db'];

// ---------------------------------------------------------------------------
// Mock DbAgentRegistry
// ---------------------------------------------------------------------------

const mockDbRegistry = {
  registerMachine: vi.fn(),
  heartbeat: vi.fn(),
  listMachines: vi.fn().mockResolvedValue([]),
  createAgent: vi.fn().mockResolvedValue('agent-new'),
  getAgent: vi.fn().mockResolvedValue({
    id: 'agent-001',
    machineId: 'machine-1',
    name: 'Test Agent',
    type: 'loop',
    status: 'running',
    config: {},
  }),
  updateAgentStatus: vi.fn(),
  listAgents: vi.fn().mockResolvedValue([]),
  getRecentRuns: vi.fn().mockResolvedValue([]),
  completeRun: vi.fn(),
  createRun: vi.fn().mockResolvedValue('run-001'),
  insertActions: vi.fn(),
  getMachine: vi.fn().mockResolvedValue(null),
} as unknown as DbAgentRegistry;

// ---------------------------------------------------------------------------
// Valid checkpoint body
// ---------------------------------------------------------------------------

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentId: 'agent-001',
    runId: 'run-001',
    iteration: 5,
    totalCost: 0.05,
    elapsedMs: 30_000,
    status: 'running',
    ...overrides,
  };
}

// ============================================================================
// Tests WITHOUT dbRegistry/db — checkpoint route is not registered
// ============================================================================

describe('Checkpoint route — without db', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ logger });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/agents/:id/checkpoint returns 404 when checkpoint routes are not registered', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody(),
    });

    // The route simply does not exist when db is not configured
    expect(response.statusCode).toBe(404);
  });
});

// ============================================================================
// Tests WITH dbRegistry + db
// ============================================================================

describe('Checkpoint route — with db', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({
      logger,
      dbRegistry: mockDbRegistry,
      db: mockDb,
    });
    await app.ready();
  });

  afterEach(() => {
    vi.mocked(mockDbRegistry.getAgent)
      .mockReset()
      .mockResolvedValue({
        id: 'agent-001',
        machineId: 'machine-1',
        name: 'Test Agent',
        type: 'loop',
        status: 'running',
        config: {},
      } as never);

    mockDbUpdate.mockClear();
    mockUpdateSet.mockClear();
    mockUpdateWhere.mockClear();
    mockUpdateReturning.mockClear().mockResolvedValue([{ id: 'agent-001' }]);
  });

  afterAll(async () => {
    await app.close();
  });

  // --- Success ---

  it('returns 200 on valid checkpoint', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.agentId).toBe('agent-001');
    expect(body.runId).toBe('run-001');
    expect(body.iteration).toBe(5);
  });

  it('calls db.update for both agents and agent_runs tables', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody(),
    });

    // Two update calls: one for agents table, one for agent_runs table
    expect(mockDbUpdate).toHaveBeenCalledTimes(2);
  });

  it('passes lastResult to the run update when provided', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody({ lastResult: 'summary of iteration' }),
    });

    // Verify the second update call (agent_runs) includes resultSummary
    const secondUpdateSetCall = mockUpdateSet.mock.calls[1];
    expect(secondUpdateSetCall[0]).toHaveProperty('resultSummary', 'summary of iteration');
  });

  it('sets resultSummary to null when lastResult is not provided', async () => {
    const body = validBody();
    delete body.lastResult;

    await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: body,
    });

    const secondUpdateSetCall = mockUpdateSet.mock.calls[1];
    expect(secondUpdateSetCall[0]).toHaveProperty('resultSummary', null);
  });

  // --- Validation errors ---

  it('returns 400 when runId is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody({ runId: '' }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_RUN_ID');
  });

  it('returns 400 when iteration is negative', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody({ iteration: -1 }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_ITERATION');
  });

  it('returns 400 when iteration is not an integer', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody({ iteration: 1.5 }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_ITERATION');
  });

  it('returns 400 when totalCost is negative', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody({ totalCost: -0.01 }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_TOTAL_COST');
  });

  it('returns 400 when elapsedMs is negative', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody({ elapsedMs: -100 }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_ELAPSED_MS');
  });

  it('returns 400 when status is invalid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody({ status: 'invalid-status' }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_STATUS');
  });

  it('returns 400 when status is missing', async () => {
    const body = validBody();
    delete body.status;

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('INVALID_STATUS');
  });

  // --- Agent not found ---

  it('returns 404 when agent does not exist', async () => {
    vi.mocked(mockDbRegistry.getAgent).mockResolvedValueOnce(undefined as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/ghost-agent/checkpoint',
      payload: validBody({ agentId: 'ghost-agent' }),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('AGENT_NOT_FOUND');
  });

  // --- DB error ---

  it('returns 500 when database update throws', async () => {
    mockDbUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          throw new Error('DB connection failed');
        }),
      }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody(),
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toBe('CHECKPOINT_FAILED');
  });

  // --- Status mapping ---

  it('accepts all valid checkpoint statuses', async () => {
    for (const status of ['running', 'paused', 'completed', 'failed']) {
      vi.mocked(mockDbRegistry.getAgent).mockResolvedValueOnce({
        id: 'agent-001',
        machineId: 'machine-1',
        name: 'Test Agent',
        type: 'loop',
        status: 'running',
        config: {},
      } as never);

      mockDbUpdate.mockClear();
      mockDbUpdate.mockReturnValue({ set: mockUpdateSet });
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
      mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });

      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-001/checkpoint',
        payload: validBody({ status }),
      });

      expect(response.statusCode).toBe(200);
    }
  });

  it('accepts iteration of 0', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody({ iteration: 0 }),
    });

    expect(response.statusCode).toBe(200);
  });

  it('accepts totalCost of 0', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody({ totalCost: 0 }),
    });

    expect(response.statusCode).toBe(200);
  });

  it('accepts elapsedMs of 0', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-001/checkpoint',
      payload: validBody({ elapsedMs: 0 }),
    });

    expect(response.statusCode).toBe(200);
  });
});
