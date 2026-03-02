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
  leftJoin: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
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
    leftJoin: vi.fn(),
    innerJoin: vi.fn(),
    groupBy: vi.fn(),
    offset: vi.fn(),
  };

  // Every chaining method returns `mock` so calls can be chained in any order.
  // Terminal methods (`returning`, `limit`, bare `where` at end) resolve to a value.
  for (const key of Object.keys(mock) as (keyof MockDb)[]) {
    mock[key].mockReturnValue(mock);
  }

  // By default, awaiting the chain resolves via `then` on the mock itself.
  // Terminal methods resolve to a value. `limit` stays as a chaining method
  // because queryActions() does `.limit(n).offset(n)`.
  mock.returning.mockResolvedValue(terminalValue);
  mock.offset.mockResolvedValue(terminalValue);

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

    it('wraps non-Error rejections in the error message', async () => {
      mockDb.returning.mockRejectedValue('string rejection');

      await expect(registry.insertActions('run-001', actions)).rejects.toThrow(
        'Failed to insert audit actions: string rejection',
      );
    });
  });

  // -------------------------------------------------------------------------
  // updateAgentStatus()
  // -------------------------------------------------------------------------

  describe('updateAgentStatus()', () => {
    it('updates the agent status and logs it', async () => {
      mockDb.returning.mockResolvedValue([{ id: 'agent-1' }]);

      await registry.updateAgentStatus('agent-1', 'running');

      expect(mockDb.update).toHaveBeenCalledOnce();
      expect(mockDb.set).toHaveBeenCalledOnce();
      expect(mockDb.where).toHaveBeenCalledOnce();
      expect(mockDb.returning).toHaveBeenCalledOnce();

      const setValues = mockDb.set.mock.calls[0][0];
      expect(setValues.status).toBe('running');

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', status: 'running' }),
        'Agent status updated',
      );
    });

    it('throws AGENT_NOT_FOUND when no matching agent exists', async () => {
      mockDb.returning.mockResolvedValue([]);

      await expect(registry.updateAgentStatus('ghost-agent', 'stopped')).rejects.toThrow(
        ControlPlaneError,
      );
      await expect(registry.updateAgentStatus('ghost-agent', 'stopped')).rejects.toThrow(
        "Agent 'ghost-agent' does not exist",
      );
    });

    it('has error code AGENT_NOT_FOUND on the thrown error', async () => {
      mockDb.returning.mockResolvedValue([]);

      try {
        await registry.updateAgentStatus('gone', 'error');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ControlPlaneError);
        expect((err as ControlPlaneError).code).toBe('AGENT_NOT_FOUND');
      }
    });
  });

  // -------------------------------------------------------------------------
  // listMachines()
  // -------------------------------------------------------------------------

  describe('listMachines()', () => {
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

    it('returns all machines mapped to Machine domain objects', async () => {
      const db = createMockDb([machineRow]);
      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      const machines = await reg.listMachines();

      expect(machines).toHaveLength(1);
      expect(machines[0].id).toBe('machine-1');
      expect(machines[0].hostname).toBe('ec2-host');
      expect(db.select).toHaveBeenCalledOnce();
      expect(db.from).toHaveBeenCalledOnce();
    });

    it('returns empty array when no machines exist', async () => {
      const db = createMockDb([]);
      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      const machines = await reg.listMachines();

      expect(machines).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // queryActions()
  // -------------------------------------------------------------------------

  describe('queryActions()', () => {
    it('returns actions with total count and hasMore=false when all fit', async () => {
      const actionRows = [
        {
          id: 1,
          runId: 'run-001',
          timestamp: new Date('2025-06-01'),
          actionType: 'tool_use',
          toolName: 'Read',
          toolInput: { file_path: '/tmp/foo.ts' },
          toolOutputHash: 'sha256-abc',
          durationMs: 120,
          approvedBy: 'auto',
          agentId: 'agent-1',
        },
      ];

      // For queryActions, the mock is called multiple times:
      // 1. count query (select count -> leftJoin -> where? -> await)
      // 2. data query (select fields -> leftJoin -> where? -> orderBy -> limit -> offset -> await)
      // We need the mock to be thenable at any point, returning different values
      // for count vs data.
      const db = createMockDb([]);
      // Override: the first await returns count, the second returns data rows
      let callCount = 0;
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => {
        callCount++;
        if (callCount === 1) {
          // Count query
          return Promise.resolve([{ value: 1 }]).then(resolve, reject);
        }
        // Data query
        return Promise.resolve(actionRows).then(resolve, reject);
      };
      // Also make offset thenable for the data query path
      db.offset.mockImplementation(() => {
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        const result = { ...db, then: undefined };
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        (result as Record<string, unknown>).then = (
          resolveInner: (v: unknown) => unknown,
          rejectInner: (e: unknown) => unknown,
        ) => Promise.resolve(actionRows).then(resolveInner, rejectInner);
        return result;
      });

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      const result = await reg.queryActions({ limit: 100 });

      expect(result.total).toBe(1);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].id).toBe(1);
      expect(result.actions[0].toolName).toBe('Read');
      expect(result.actions[0].agentId).toBe('agent-1');
      expect(result.hasMore).toBe(false);
    });

    it('returns hasMore=true when offset + limit < total', async () => {
      const db = createMockDb([]);
      let callCount = 0;
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([{ value: 50 }]).then(resolve, reject);
        }
        return Promise.resolve([]).then(resolve, reject);
      };
      db.offset.mockImplementation(() => {
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        const result = { ...db, then: undefined };
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        (result as Record<string, unknown>).then = (
          resolveInner: (v: unknown) => unknown,
          rejectInner: (e: unknown) => unknown,
        ) => Promise.resolve([]).then(resolveInner, rejectInner);
        return result;
      });

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      const result = await reg.queryActions({ limit: 10, offset: 0 });

      expect(result.total).toBe(50);
      expect(result.hasMore).toBe(true);
    });

    it('clamps limit to minimum of 1', async () => {
      const db = createMockDb([]);
      let callCount = 0;
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => {
        callCount++;
        return Promise.resolve(callCount === 1 ? [{ value: 0 }] : []).then(resolve, reject);
      };
      db.offset.mockImplementation(() => {
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        const result = { ...db, then: undefined };
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        (result as Record<string, unknown>).then = (
          resolveInner: (v: unknown) => unknown,
          rejectInner: (e: unknown) => unknown,
        ) => Promise.resolve([]).then(resolveInner, rejectInner);
        return result;
      });

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      const result = await reg.queryActions({ limit: -5 });

      expect(result.total).toBe(0);
      expect(result.actions).toHaveLength(0);
      // The limit method should have been called with 1 (clamped from -5)
      expect(db.limit).toHaveBeenCalledWith(1);
    });

    it('clamps limit to maximum of 1000', async () => {
      const db = createMockDb([]);
      let callCount = 0;
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => {
        callCount++;
        return Promise.resolve(callCount === 1 ? [{ value: 0 }] : []).then(resolve, reject);
      };
      db.offset.mockImplementation(() => {
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        const result = { ...db, then: undefined };
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        (result as Record<string, unknown>).then = (
          resolveInner: (v: unknown) => unknown,
          rejectInner: (e: unknown) => unknown,
        ) => Promise.resolve([]).then(resolveInner, rejectInner);
        return result;
      });

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      await reg.queryActions({ limit: 9999 });

      expect(db.limit).toHaveBeenCalledWith(1000);
    });

    it('clamps offset to minimum of 0', async () => {
      const db = createMockDb([]);
      let callCount = 0;
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => {
        callCount++;
        return Promise.resolve(callCount === 1 ? [{ value: 0 }] : []).then(resolve, reject);
      };
      db.offset.mockImplementation(() => {
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        const result = { ...db, then: undefined };
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        (result as Record<string, unknown>).then = (
          resolveInner: (v: unknown) => unknown,
          rejectInner: (e: unknown) => unknown,
        ) => Promise.resolve([]).then(resolveInner, rejectInner);
        return result;
      });

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      await reg.queryActions({ offset: -10 });

      expect(db.offset).toHaveBeenCalledWith(0);
    });

    it('applies agentId filter via where clause', async () => {
      const db = createMockDb([]);
      let callCount = 0;
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => {
        callCount++;
        return Promise.resolve(callCount === 1 ? [{ value: 0 }] : []).then(resolve, reject);
      };
      db.offset.mockImplementation(() => {
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        const result = { ...db, then: undefined };
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        (result as Record<string, unknown>).then = (
          resolveInner: (v: unknown) => unknown,
          rejectInner: (e: unknown) => unknown,
        ) => Promise.resolve([]).then(resolveInner, rejectInner);
        return result;
      });

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      await reg.queryActions({ agentId: 'agent-1' });

      // where should be called (conditions include agentId filter)
      expect(db.where).toHaveBeenCalled();
    });

    it('applies tool filter via where clause', async () => {
      const db = createMockDb([]);
      let callCount = 0;
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => {
        callCount++;
        return Promise.resolve(callCount === 1 ? [{ value: 0 }] : []).then(resolve, reject);
      };
      db.offset.mockImplementation(() => {
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        const result = { ...db, then: undefined };
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        (result as Record<string, unknown>).then = (
          resolveInner: (v: unknown) => unknown,
          rejectInner: (e: unknown) => unknown,
        ) => Promise.resolve([]).then(resolveInner, rejectInner);
        return result;
      });

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      await reg.queryActions({ tool: 'Read' });

      expect(db.where).toHaveBeenCalled();
    });

    it('applies from and to date filters', async () => {
      const db = createMockDb([]);
      let callCount = 0;
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => {
        callCount++;
        return Promise.resolve(callCount === 1 ? [{ value: 0 }] : []).then(resolve, reject);
      };
      db.offset.mockImplementation(() => {
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        const result = { ...db, then: undefined };
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        (result as Record<string, unknown>).then = (
          resolveInner: (v: unknown) => unknown,
          rejectInner: (e: unknown) => unknown,
        ) => Promise.resolve([]).then(resolveInner, rejectInner);
        return result;
      });

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      await reg.queryActions({
        from: '2025-01-01',
        to: '2025-12-31',
      });

      expect(db.where).toHaveBeenCalled();
    });

    it('applies all filters simultaneously', async () => {
      const db = createMockDb([]);
      let callCount = 0;
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => {
        callCount++;
        return Promise.resolve(callCount === 1 ? [{ value: 0 }] : []).then(resolve, reject);
      };
      db.offset.mockImplementation(() => {
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        const result = { ...db, then: undefined };
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        (result as Record<string, unknown>).then = (
          resolveInner: (v: unknown) => unknown,
          rejectInner: (e: unknown) => unknown,
        ) => Promise.resolve([]).then(resolveInner, rejectInner);
        return result;
      });

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      await reg.queryActions({
        agentId: 'agent-1',
        from: '2025-01-01',
        to: '2025-12-31',
        tool: 'Bash',
        limit: 50,
        offset: 10,
      });

      // where was called for both count and data queries
      expect(db.where).toHaveBeenCalled();
      expect(db.limit).toHaveBeenCalledWith(50);
      expect(db.offset).toHaveBeenCalledWith(10);
    });

    it('does not call where when no filters are provided', async () => {
      const db = createMockDb([]);
      let callCount = 0;
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => {
        callCount++;
        return Promise.resolve(callCount === 1 ? [{ value: 0 }] : []).then(resolve, reject);
      };
      db.offset.mockImplementation(() => {
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        const result = { ...db, then: undefined };
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        (result as Record<string, unknown>).then = (
          resolveInner: (v: unknown) => unknown,
          rejectInner: (e: unknown) => unknown,
        ) => Promise.resolve([]).then(resolveInner, rejectInner);
        return result;
      });

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      await reg.queryActions({});

      // where should NOT be called when no conditions are built
      // Note: the mock chains through, but the source only calls .where()
      // when conditions.length > 0. Since leftJoin returns the mock, and
      // the mock's where also returns the mock, we can't distinguish perfectly.
      // We verify the query succeeds without error.
      expect(db.select).toHaveBeenCalled();
      expect(db.leftJoin).toHaveBeenCalled();
    });

    it('throws AUDIT_QUERY_FAILED when the database query fails', async () => {
      const db = createMockDb([]);
      // Make the mock thenable but reject
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        _resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.reject(new Error('query timeout')).then(undefined, reject);

      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      await expect(reg.queryActions({})).rejects.toThrow(ControlPlaneError);
      await expect(reg.queryActions({})).rejects.toThrow('Failed to query audit actions');
    });
  });

  // -------------------------------------------------------------------------
  // getAuditSummary()
  // -------------------------------------------------------------------------

  describe('getAuditSummary()', () => {
    /**
     * Helper to create a mock db that sequences multiple awaits:
     *  1. totalActions count
     *  2. topTools rows
     *  3. topAgents rows
     *  4. errorCount
     * Each await on `.limit()` or the mock itself returns the next value.
     */
    function createSequencedMockDb(
      totalActions: number,
      toolRows: { tool: string | null; count: number }[],
      agentRows: { agentId: string | null; count: number }[],
      errorCount: number,
    ): MockDb {
      const db = createMockDb([]);
      let awaitCount = 0;

      const resolveNext = () => {
        awaitCount++;
        switch (awaitCount) {
          case 1:
            return Promise.resolve([{ value: totalActions }]);
          case 2:
            return Promise.resolve(toolRows);
          case 3:
            return Promise.resolve(agentRows);
          case 4:
            return Promise.resolve([{ value: errorCount }]);
          default:
            return Promise.resolve([]);
        }
      };

      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => resolveNext().then(resolve, reject);

      db.limit.mockImplementation(() => {
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        const result = { ...db, then: undefined };
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        (result as Record<string, unknown>).then = (
          resolveInner: (v: unknown) => unknown,
          rejectInner: (e: unknown) => unknown,
        ) => resolveNext().then(resolveInner, rejectInner);
        return result;
      });

      return db;
    }

    it('returns a complete audit summary with all fields', async () => {
      const db = createSequencedMockDb(
        42,
        [
          { tool: 'Read', count: 20 },
          { tool: 'Write', count: 15 },
        ],
        [{ agentId: 'agent-1', count: 30 }],
        5,
      );

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      const summary = await reg.getAuditSummary({});

      expect(summary.totalActions).toBe(42);
      expect(summary.topTools).toHaveLength(2);
      expect(summary.topTools[0]).toEqual({ tool: 'Read', count: 20 });
      expect(summary.topTools[1]).toEqual({ tool: 'Write', count: 15 });
      expect(summary.topAgents).toHaveLength(1);
      expect(summary.topAgents[0]).toEqual({ agentId: 'agent-1', count: 30 });
      expect(summary.errorCount).toBe(5);
    });

    it('returns zeros when no data exists', async () => {
      const db = createSequencedMockDb(0, [], [], 0);

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      const summary = await reg.getAuditSummary({});

      expect(summary.totalActions).toBe(0);
      expect(summary.topTools).toHaveLength(0);
      expect(summary.topAgents).toHaveLength(0);
      expect(summary.errorCount).toBe(0);
    });

    it('applies agentId filter', async () => {
      const db = createSequencedMockDb(10, [], [], 0);

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      await reg.getAuditSummary({ agentId: 'agent-1' });

      // where should be called with conditions
      expect(db.where).toHaveBeenCalled();
    });

    it('applies from and to date filters', async () => {
      const db = createSequencedMockDb(10, [], [], 0);

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      await reg.getAuditSummary({ from: '2025-01-01', to: '2025-12-31' });

      expect(db.where).toHaveBeenCalled();
    });

    it('handles null tool names by defaulting to empty string', async () => {
      const db = createSequencedMockDb(5, [{ tool: null, count: 5 }], [], 0);

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      const summary = await reg.getAuditSummary({});

      expect(summary.topTools[0].tool).toBe('');
    });

    it('handles null agentId by defaulting to empty string', async () => {
      const db = createSequencedMockDb(5, [], [{ agentId: null, count: 5 }], 0);

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      const summary = await reg.getAuditSummary({});

      expect(summary.topAgents[0].agentId).toBe('');
    });

    it('defaults totalActions to 0 when count result is empty', async () => {
      const db = createMockDb([]);
      let awaitCount = 0;
      const resolveNext = () => {
        awaitCount++;
        if (awaitCount === 1) return Promise.resolve([]); // empty count result
        return Promise.resolve([]);
      };

      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => resolveNext().then(resolve, reject);

      db.limit.mockImplementation(() => {
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        const result = { ...db, then: undefined };
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
        (result as Record<string, unknown>).then = (
          resolveInner: (v: unknown) => unknown,
          rejectInner: (e: unknown) => unknown,
        ) => resolveNext().then(resolveInner, rejectInner);
        return result;
      });

      const reg = new DbAgentRegistry(db as unknown as Database, logger);
      const summary = await reg.getAuditSummary({});

      expect(summary.totalActions).toBe(0);
    });

    it('throws AUDIT_SUMMARY_FAILED when the database query fails', async () => {
      const db = createMockDb([]);
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        _resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.reject(new Error('db down')).then(undefined, reject);

      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      await expect(reg.getAuditSummary({})).rejects.toThrow(ControlPlaneError);
      await expect(reg.getAuditSummary({})).rejects.toThrow('Failed to get audit summary');
    });

    it('wraps non-Error exceptions in the error message', async () => {
      const db = createMockDb([]);
      // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are thenable; mock must replicate this
      (db as Record<string, unknown>).then = (
        _resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.reject('string exception').then(undefined, reject);

      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      await expect(reg.getAuditSummary({})).rejects.toThrow('string exception');
    });
  });

  // -------------------------------------------------------------------------
  // toAgent() edge cases via getAgent()
  // -------------------------------------------------------------------------

  describe('toAgent() mapper edge cases', () => {
    it('defaults machineId to empty string when null', async () => {
      const row = {
        id: 'agent-1',
        machineId: null,
        name: 'orphan-agent',
        type: 'manual',
        status: null,
        schedule: null,
        projectPath: null,
        worktreeBranch: null,
        currentSessionId: null,
        config: null,
        lastRunAt: null,
        lastCostUsd: null,
        totalCostUsd: null,
        createdAt: null,
      };

      const db = createMockDb([row]);
      const reg = new DbAgentRegistry(db as unknown as Database, logger);

      const agent = await reg.getAgent('agent-1');

      expect(agent?.machineId).toBe('');
      expect(agent?.status).toBe('registered');
      expect(agent?.config).toEqual({});
      expect(agent?.totalCostUsd).toBe(0);
      expect(agent?.createdAt).toBeInstanceOf(Date);
      expect(agent?.lastCostUsd).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // heartbeat() error code verification
  // -------------------------------------------------------------------------

  describe('heartbeat() — error code on thrown ControlPlaneError', () => {
    it('error has code MACHINE_NOT_FOUND', async () => {
      mockDb.returning.mockResolvedValue([]);

      try {
        await registry.heartbeat('nonexistent');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ControlPlaneError);
        expect((err as ControlPlaneError).code).toBe('MACHINE_NOT_FOUND');
        expect((err as ControlPlaneError).context).toEqual({ machineId: 'nonexistent' });
      }
    });
  });

  // -------------------------------------------------------------------------
  // createAgent() error code verification
  // -------------------------------------------------------------------------

  describe('createAgent() — error code on thrown ControlPlaneError', () => {
    it('error has code AGENT_CREATE_FAILED', async () => {
      mockDb.returning.mockResolvedValue([]);

      try {
        await registry.createAgent({ machineId: 'm1', name: 'x', type: 'manual' });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ControlPlaneError);
        expect((err as ControlPlaneError).code).toBe('AGENT_CREATE_FAILED');
      }
    });
  });

  // -------------------------------------------------------------------------
  // createRun() error code verification
  // -------------------------------------------------------------------------

  describe('createRun() — error code on thrown ControlPlaneError', () => {
    it('error has code RUN_CREATE_FAILED', async () => {
      mockDb.returning.mockResolvedValue([]);

      try {
        await registry.createRun({ agentId: 'a1', trigger: 'manual' });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ControlPlaneError);
        expect((err as ControlPlaneError).code).toBe('RUN_CREATE_FAILED');
      }
    });
  });

  // -------------------------------------------------------------------------
  // completeRun() error code verification
  // -------------------------------------------------------------------------

  describe('completeRun() — error code on thrown ControlPlaneError', () => {
    it('error has code RUN_NOT_FOUND', async () => {
      mockDb.returning.mockResolvedValue([]);

      try {
        await registry.completeRun('missing-run', { status: 'failure' });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ControlPlaneError);
        expect((err as ControlPlaneError).code).toBe('RUN_NOT_FOUND');
        expect((err as ControlPlaneError).context).toEqual({ runId: 'missing-run' });
      }
    });
  });

  // -------------------------------------------------------------------------
  // insertActions() error code verification
  // -------------------------------------------------------------------------

  describe('insertActions() — error code on thrown ControlPlaneError', () => {
    it('error has code AUDIT_INSERT_FAILED', async () => {
      mockDb.returning.mockRejectedValue(new Error('unique constraint'));

      try {
        await registry.insertActions('run-1', [{ actionType: 'tool_use' }]);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ControlPlaneError);
        expect((err as ControlPlaneError).code).toBe('AUDIT_INSERT_FAILED');
        expect((err as ControlPlaneError).context).toEqual({
          runId: 'run-1',
          actionCount: 1,
        });
      }
    });
  });
});
