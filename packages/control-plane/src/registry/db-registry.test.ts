import { ControlPlaneError } from '@agentctl/shared';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../db/index.js';
import { DbAgentRegistry } from './db-registry.js';

// ---------------------------------------------------------------------------
// Shared mock logger (matches pattern from agents.test.ts)
// ---------------------------------------------------------------------------

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
// Chainable Drizzle mock factory
// ---------------------------------------------------------------------------

type MockDb = {
  insert: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

function createMockDb(terminalValue: unknown = []): MockDb {
  const mock: MockDb = {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    values: vi.fn(),
    set: vi.fn(),
    returning: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };

  // Every chaining method returns `mock` so calls can be chained in any order.
  // Terminal methods (`returning`, `limit`, bare `where` at end) resolve to a value.
  for (const key of Object.keys(mock) as (keyof MockDb)[]) {
    mock[key].mockReturnValue(mock);
  }

  // By default, awaiting the chain resolves via `then` on the mock itself.
  // We set terminal defaults that tests can override.
  mock.returning.mockResolvedValue(terminalValue);
  mock.limit.mockResolvedValue(terminalValue);

  // Make the mock itself thenable so `await db.select().from(t)` works
  // (Drizzle queries are thenable — calling `.then()` executes them).
  // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
  (mock as Record<string, unknown>).then = (
    resolve: (v: unknown) => unknown,
    reject: (e: unknown) => unknown,
  ) => Promise.resolve(terminalValue).then(resolve, reject);

  return mock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DbAgentRegistry', () => {
  let mockDb: MockDb;
  let registry: DbAgentRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    registry = new DbAgentRegistry(mockDb as unknown as Database, logger);
  });

  // -------------------------------------------------------------------------
  // registerMachine()
  // -------------------------------------------------------------------------

  describe('registerMachine()', () => {
    const machineData = {
      machineId: 'ec2-us-east-1',
      hostname: 'ip-10-0-0-42',
      tailscaleIp: '100.64.0.1',
      os: 'linux' as const,
      arch: 'x64' as const,
      capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
    };

    it('calls db.insert().values().onConflictDoUpdate() with machine data', async () => {
      await registry.registerMachine(machineData);

      expect(mockDb.insert).toHaveBeenCalledOnce();
      expect(mockDb.values).toHaveBeenCalledOnce();

      const insertedValues = mockDb.values.mock.calls[0][0];
      expect(insertedValues.id).toBe('ec2-us-east-1');
      expect(insertedValues.hostname).toBe('ip-10-0-0-42');
      expect(insertedValues.tailscaleIp).toBe('100.64.0.1');
      expect(insertedValues.os).toBe('linux');
      expect(insertedValues.arch).toBe('x64');
      expect(insertedValues.status).toBe('online');
      expect(insertedValues.lastHeartbeat).toBeInstanceOf(Date);
      expect(insertedValues.capabilities).toEqual(machineData.capabilities);
    });

    it('uses onConflictDoUpdate to upsert on machine id', async () => {
      await registry.registerMachine(machineData);

      expect(mockDb.onConflictDoUpdate).toHaveBeenCalledOnce();

      const conflictArg = mockDb.onConflictDoUpdate.mock.calls[0][0];
      expect(conflictArg.set.hostname).toBe('ip-10-0-0-42');
      expect(conflictArg.set.status).toBe('online');
    });

    it('logs the registration', async () => {
      await registry.registerMachine(machineData);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: 'ec2-us-east-1', hostname: 'ip-10-0-0-42' }),
        'Machine registered',
      );
    });
  });

  // -------------------------------------------------------------------------
  // heartbeat()
  // -------------------------------------------------------------------------

  describe('heartbeat()', () => {
    it('updates lastHeartbeat and status for the given machine', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'machine-1' }]);

      await registry.heartbeat('machine-1');

      expect(mockDb.update).toHaveBeenCalledOnce();
      expect(mockDb.set).toHaveBeenCalledOnce();

      const setValues = mockDb.set.mock.calls[0][0];
      expect(setValues.lastHeartbeat).toBeInstanceOf(Date);
      expect(setValues.status).toBe('online');
      expect(mockDb.where).toHaveBeenCalledOnce();
      expect(mockDb.returning).toHaveBeenCalledOnce();
    });

    it('throws ControlPlaneError when machine is not found', async () => {
      mockDb.returning.mockResolvedValue([]);

      await expect(registry.heartbeat('ghost-machine')).rejects.toThrow(ControlPlaneError);
      await expect(registry.heartbeat('ghost-machine')).rejects.toThrow(
        "Machine 'ghost-machine' is not registered",
      );
    });
  });

  // -------------------------------------------------------------------------
  // createAgent()
  // -------------------------------------------------------------------------

  describe('createAgent()', () => {
    const agentData = {
      machineId: 'machine-1',
      name: 'auth-fixer',
      type: 'heartbeat',
      schedule: '*/5 * * * *',
      projectPath: '/home/user/project',
      worktreeBranch: 'agent-1/feature/auth',
      config: { model: 'claude-sonnet-4-20250514' },
    };

    it('inserts agent row and returns the generated id', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'uuid-1234' }]);

      const agentId = await registry.createAgent(agentData);

      expect(agentId).toBe('uuid-1234');
      expect(mockDb.insert).toHaveBeenCalledOnce();
      expect(mockDb.values).toHaveBeenCalledOnce();
      expect(mockDb.returning).toHaveBeenCalledOnce();

      const insertedValues = mockDb.values.mock.calls[0][0];
      expect(insertedValues.machineId).toBe('machine-1');
      expect(insertedValues.name).toBe('auth-fixer');
      expect(insertedValues.type).toBe('heartbeat');
      expect(insertedValues.status).toBe('registered');
      expect(insertedValues.schedule).toBe('*/5 * * * *');
      expect(insertedValues.projectPath).toBe('/home/user/project');
      expect(insertedValues.worktreeBranch).toBe('agent-1/feature/auth');
      expect(insertedValues.config).toEqual({ model: 'claude-sonnet-4-20250514' });
    });

    it('defaults optional fields to null or empty object', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'uuid-5678' }]);

      await registry.createAgent({ machineId: 'm1', name: 'minimal', type: 'adhoc' });

      const insertedValues = mockDb.values.mock.calls[0][0];
      expect(insertedValues.schedule).toBeNull();
      expect(insertedValues.projectPath).toBeNull();
      expect(insertedValues.worktreeBranch).toBeNull();
      expect(insertedValues.config).toEqual({});
    });

    it('throws ControlPlaneError when insert returns no rows', async () => {
      mockDb.returning.mockResolvedValue([]);

      await expect(registry.createAgent(agentData)).rejects.toThrow(ControlPlaneError);
      await expect(registry.createAgent(agentData)).rejects.toThrow('Failed to insert agent row');
    });

    it('logs the creation with agentId and name', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'uuid-1234' }]);

      await registry.createAgent(agentData);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'uuid-1234', name: 'auth-fixer' }),
        'Agent created',
      );
    });
  });

  // -------------------------------------------------------------------------
  // getAgent()
  // -------------------------------------------------------------------------

  describe('getAgent()', () => {
    const agentRow = {
      id: 'agent-1',
      machineId: 'machine-1',
      name: 'test-agent',
      type: 'manual',
      status: 'running',
      schedule: null,
      projectPath: '/tmp/project',
      worktreeBranch: null,
      currentSessionId: 'sess-1',
      config: { model: 'claude-sonnet-4-20250514' },
      lastRunAt: new Date('2025-06-01'),
      lastCostUsd: '0.042000',
      totalCostUsd: '1.234000',
      createdAt: new Date('2025-01-01'),
    };

    it('returns mapped Agent when found', async () => {
      const db = createMockDb([agentRow]);
      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      const agent = await reg.getAgent('agent-1');

      expect(agent).toBeDefined();
      expect(agent?.id).toBe('agent-1');
      expect(agent?.machineId).toBe('machine-1');
      expect(agent?.name).toBe('test-agent');
      expect(agent?.type).toBe('manual');
      expect(agent?.status).toBe('running');
      expect(agent?.currentSessionId).toBe('sess-1');
      expect(agent?.lastCostUsd).toBe(0.042);
      expect(agent?.totalCostUsd).toBe(1.234);
      expect(agent?.createdAt).toEqual(new Date('2025-01-01'));
      expect(db.select).toHaveBeenCalledOnce();
      expect(db.from).toHaveBeenCalledOnce();
      expect(db.where).toHaveBeenCalledOnce();
    });

    it('returns undefined when no rows match', async () => {
      const db = createMockDb([]);
      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      const agent = await reg.getAgent('nonexistent');

      expect(agent).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getMachine()
  // -------------------------------------------------------------------------

  describe('getMachine()', () => {
    const machineRow = {
      id: 'machine-1',
      hostname: 'ec2-host',
      tailscaleIp: '100.64.0.1',
      os: 'linux',
      arch: 'x64',
      status: 'online',
      lastHeartbeat: new Date('2025-06-01T12:00:00Z'),
      capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
      createdAt: new Date('2025-01-01'),
    };

    it('returns mapped Machine when found', async () => {
      const db = createMockDb([machineRow]);
      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      const machine = await reg.getMachine('machine-1');

      expect(machine).toBeDefined();
      expect(machine?.id).toBe('machine-1');
      expect(machine?.hostname).toBe('ec2-host');
      expect(machine?.tailscaleIp).toBe('100.64.0.1');
      expect(machine?.os).toBe('linux');
      expect(machine?.arch).toBe('x64');
      expect(machine?.status).toBe('online');
      expect(machine?.lastHeartbeat).toEqual(new Date('2025-06-01T12:00:00Z'));
      expect(machine?.capabilities).toEqual({
        gpu: false,
        docker: true,
        maxConcurrentAgents: 4,
      });
      expect(db.select).toHaveBeenCalledOnce();
      expect(db.from).toHaveBeenCalledOnce();
      expect(db.where).toHaveBeenCalledOnce();
    });

    it('returns undefined when machine does not exist', async () => {
      const db = createMockDb([]);
      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      const machine = await reg.getMachine('nonexistent');

      expect(machine).toBeUndefined();
    });

    it('defaults capabilities when null in row', async () => {
      const db = createMockDb([
        { ...machineRow, capabilities: null, status: null, createdAt: null },
      ]);
      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      const machine = await reg.getMachine('machine-1');

      expect(machine?.capabilities).toEqual({
        gpu: false,
        docker: false,
        maxConcurrentAgents: 1,
      });
      expect(machine?.status).toBe('online');
      expect(machine?.createdAt).toBeInstanceOf(Date);
    });
  });

  // -------------------------------------------------------------------------
  // createRun()
  // -------------------------------------------------------------------------

  describe('createRun()', () => {
    const runData = {
      agentId: 'agent-1',
      trigger: 'manual',
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      sessionId: 'sess-abc',
    };

    it('inserts a run row and returns the generated id', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'run-001' }]);

      const runId = await registry.createRun(runData);

      expect(runId).toBe('run-001');
      expect(mockDb.insert).toHaveBeenCalledOnce();
      expect(mockDb.values).toHaveBeenCalledOnce();

      const insertedValues = mockDb.values.mock.calls[0][0];
      expect(insertedValues.agentId).toBe('agent-1');
      expect(insertedValues.trigger).toBe('manual');
      expect(insertedValues.status).toBe('running');
      expect(insertedValues.startedAt).toBeInstanceOf(Date);
      expect(insertedValues.model).toBe('claude-sonnet-4-20250514');
      expect(insertedValues.provider).toBe('anthropic');
      expect(insertedValues.sessionId).toBe('sess-abc');
    });

    it('defaults optional fields to null', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'run-002' }]);

      await registry.createRun({ agentId: 'agent-1', trigger: 'heartbeat' });

      const insertedValues = mockDb.values.mock.calls[0][0];
      expect(insertedValues.model).toBeNull();
      expect(insertedValues.provider).toBeNull();
      expect(insertedValues.sessionId).toBeNull();
    });

    it('throws ControlPlaneError when insert returns no rows', async () => {
      mockDb.returning.mockResolvedValue([]);

      await expect(registry.createRun(runData)).rejects.toThrow(ControlPlaneError);
      await expect(registry.createRun(runData)).rejects.toThrow('Failed to insert agent run row');
    });

    it('logs the creation with runId, agentId, and trigger', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'run-001' }]);

      await registry.createRun(runData);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'run-001', agentId: 'agent-1', trigger: 'manual' }),
        'Agent run created',
      );
    });
  });

  // -------------------------------------------------------------------------
  // completeRun()
  // -------------------------------------------------------------------------

  describe('completeRun()', () => {
    const completionData = {
      status: 'success',
      costUsd: '0.042000',
      tokensIn: 1500,
      tokensOut: 300,
      errorMessage: null,
      resultSummary: 'Fixed the login bug',
    };

    it('updates the run with completion data', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'run-001' }]);

      await registry.completeRun('run-001', completionData);

      expect(mockDb.update).toHaveBeenCalledOnce();
      expect(mockDb.set).toHaveBeenCalledOnce();
      expect(mockDb.where).toHaveBeenCalledOnce();
      expect(mockDb.returning).toHaveBeenCalledOnce();

      const setValues = mockDb.set.mock.calls[0][0];
      expect(setValues.status).toBe('success');
      expect(setValues.finishedAt).toBeInstanceOf(Date);
      expect(setValues.costUsd).toBe('0.042000');
      expect(setValues.tokensIn).toBe(1500);
      expect(setValues.tokensOut).toBe(300);
      expect(setValues.resultSummary).toBe('Fixed the login bug');
    });

    it('defaults optional fields to null', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'run-001' }]);

      await registry.completeRun('run-001', { status: 'failure' });

      const setValues = mockDb.set.mock.calls[0][0];
      expect(setValues.costUsd).toBeNull();
      expect(setValues.tokensIn).toBeNull();
      expect(setValues.tokensOut).toBeNull();
      expect(setValues.errorMessage).toBeNull();
      expect(setValues.resultSummary).toBeNull();
    });

    it('throws ControlPlaneError when run is not found', async () => {
      mockDb.returning.mockResolvedValue([]);

      await expect(registry.completeRun('ghost-run', completionData)).rejects.toThrow(
        ControlPlaneError,
      );
      await expect(registry.completeRun('ghost-run', completionData)).rejects.toThrow(
        "Run 'ghost-run' does not exist",
      );
    });

    it('logs the completion with runId and status', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'run-001' }]);

      await registry.completeRun('run-001', completionData);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'run-001', status: 'success' }),
        'Agent run completed',
      );
    });
  });

  // -------------------------------------------------------------------------
  // listAgents()
  // -------------------------------------------------------------------------

  describe('listAgents()', () => {
    const agentRows = [
      {
        id: 'agent-1',
        machineId: 'machine-1',
        name: 'agent-alpha',
        type: 'heartbeat',
        status: 'running',
        schedule: '*/5 * * * *',
        projectPath: '/tmp/p1',
        worktreeBranch: null,
        currentSessionId: null,
        config: {},
        lastRunAt: null,
        lastCostUsd: null,
        totalCostUsd: '0',
        createdAt: new Date('2025-01-01'),
      },
      {
        id: 'agent-2',
        machineId: 'machine-1',
        name: 'agent-beta',
        type: 'manual',
        status: 'stopped',
        schedule: null,
        projectPath: '/tmp/p2',
        worktreeBranch: null,
        currentSessionId: null,
        config: {},
        lastRunAt: null,
        lastCostUsd: null,
        totalCostUsd: '0.500000',
        createdAt: new Date('2025-02-01'),
      },
    ];

    it('returns all agents when machineId is not provided', async () => {
      const db = createMockDb(agentRows);
      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      const agents = await reg.listAgents();

      expect(agents).toHaveLength(2);
      expect(agents[0].id).toBe('agent-1');
      expect(agents[1].id).toBe('agent-2');
      expect(db.select).toHaveBeenCalledOnce();
      expect(db.from).toHaveBeenCalledOnce();
      // No where clause when machineId is not provided
      expect(db.where).not.toHaveBeenCalled();
    });

    it('filters by machineId when provided', async () => {
      const db = createMockDb(agentRows);
      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      await reg.listAgents('machine-1');

      expect(db.select).toHaveBeenCalledOnce();
      expect(db.from).toHaveBeenCalledOnce();
      expect(db.where).toHaveBeenCalledOnce();
    });

    it('maps totalCostUsd string to number', async () => {
      const db = createMockDb(agentRows);
      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      const agents = await reg.listAgents();

      expect(agents[0].totalCostUsd).toBe(0);
      expect(agents[1].totalCostUsd).toBe(0.5);
    });
  });

  // -------------------------------------------------------------------------
  // getRecentRuns()
  // -------------------------------------------------------------------------

  describe('getRecentRuns()', () => {
    const runRows = [
      {
        id: 'run-002',
        agentId: 'agent-1',
        trigger: 'manual',
        status: 'success',
        startedAt: new Date('2025-06-02'),
        finishedAt: new Date('2025-06-02T00:05:00Z'),
        costUsd: '0.050000',
        tokensIn: 2000,
        tokensOut: 500,
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
        sessionId: 'sess-2',
        errorMessage: null,
        resultSummary: 'Done',
      },
      {
        id: 'run-001',
        agentId: 'agent-1',
        trigger: 'heartbeat',
        status: 'failure',
        startedAt: new Date('2025-06-01'),
        finishedAt: new Date('2025-06-01T00:10:00Z'),
        costUsd: null,
        tokensIn: null,
        tokensOut: null,
        model: null,
        provider: null,
        sessionId: null,
        errorMessage: 'timeout',
        resultSummary: null,
      },
    ];

    it('queries runs ordered by startedAt desc with default limit', async () => {
      mockDb.limit.mockResolvedValue(runRows);

      const runs = await registry.getRecentRuns('agent-1');

      expect(runs).toHaveLength(2);
      expect(mockDb.select).toHaveBeenCalledOnce();
      expect(mockDb.from).toHaveBeenCalledOnce();
      expect(mockDb.where).toHaveBeenCalledOnce();
      expect(mockDb.orderBy).toHaveBeenCalledOnce();
      expect(mockDb.limit).toHaveBeenCalledWith(20);
    });

    it('respects custom limit parameter', async () => {
      mockDb.limit.mockResolvedValue([runRows[0]]);

      await registry.getRecentRuns('agent-1', 5);

      expect(mockDb.limit).toHaveBeenCalledWith(5);
    });

    it('maps costUsd string to number and null to null', async () => {
      mockDb.limit.mockResolvedValue(runRows);

      const runs = await registry.getRecentRuns('agent-1');

      expect(runs[0].costUsd).toBe(0.05);
      expect(runs[1].costUsd).toBeNull();
    });

    it('preserves all run fields in the mapped result', async () => {
      mockDb.limit.mockResolvedValue([runRows[0]]);

      const runs = await registry.getRecentRuns('agent-1');

      expect(runs[0]).toEqual({
        id: 'run-002',
        agentId: 'agent-1',
        trigger: 'manual',
        status: 'success',
        startedAt: new Date('2025-06-02'),
        finishedAt: new Date('2025-06-02T00:05:00Z'),
        costUsd: 0.05,
        tokensIn: 2000,
        tokensOut: 500,
        model: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
        sessionId: 'sess-2',
        errorMessage: null,
        resultSummary: 'Done',
      });
    });
  });

  // -------------------------------------------------------------------------
  // insertActions()
  // -------------------------------------------------------------------------

  describe('insertActions()', () => {
    const actions = [
      {
        actionType: 'tool_use',
        toolName: 'Read',
        toolInput: { file_path: '/tmp/foo.ts' },
        toolOutputHash: 'sha256-abc123',
        durationMs: 120,
        approvedBy: 'auto',
      },
      {
        actionType: 'tool_use',
        toolName: 'Write',
        toolInput: { file_path: '/tmp/bar.ts' },
        toolOutputHash: 'sha256-def456',
        durationMs: 80,
        approvedBy: null,
      },
    ];

    it('batch inserts actions and returns the count', async () => {
      mockDb.returning.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      const count = await registry.insertActions('run-001', actions);

      expect(count).toBe(2);
      expect(mockDb.insert).toHaveBeenCalledOnce();
      expect(mockDb.values).toHaveBeenCalledOnce();

      const insertedRows = mockDb.values.mock.calls[0][0];
      expect(insertedRows).toHaveLength(2);
      expect(insertedRows[0].runId).toBe('run-001');
      expect(insertedRows[0].actionType).toBe('tool_use');
      expect(insertedRows[0].toolName).toBe('Read');
      expect(insertedRows[1].toolName).toBe('Write');
    });

    it('returns 0 for empty actions array without querying db', async () => {
      const count = await registry.insertActions('run-001', []);

      expect(count).toBe(0);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('defaults optional fields to null', async () => {
      mockDb.returning.mockResolvedValue([{ id: 1 }]);

      await registry.insertActions('run-001', [{ actionType: 'message' }]);

      const insertedRows = mockDb.values.mock.calls[0][0];
      expect(insertedRows[0].toolName).toBeNull();
      expect(insertedRows[0].toolInput).toBeNull();
      expect(insertedRows[0].toolOutputHash).toBeNull();
      expect(insertedRows[0].durationMs).toBeNull();
      expect(insertedRows[0].approvedBy).toBeNull();
    });

    it('throws ControlPlaneError when database insert fails', async () => {
      mockDb.returning.mockRejectedValue(new Error('connection lost'));

      await expect(registry.insertActions('run-001', actions)).rejects.toThrow(ControlPlaneError);
      await expect(registry.insertActions('run-001', actions)).rejects.toThrow(
        'Failed to insert audit actions: connection lost',
      );
    });

    it('logs the insertion count', async () => {
      mockDb.returning.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      await registry.insertActions('run-001', actions);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'run-001', insertedCount: 2 }),
        'Audit actions inserted',
      );
    });
  });
});
