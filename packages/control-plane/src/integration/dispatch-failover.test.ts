import { ControlPlaneError } from '@agentctl/shared';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbAgentRegistry } from '../registry/db-registry.js';
import { MachineCircuitBreaker } from '../scheduler/circuit-breaker.js';
import type { AgentTaskJobData, AgentTaskJobName } from '../scheduler/task-queue.js';
import { createTaskWorker } from '../scheduler/task-worker.js';

// ---------------------------------------------------------------------------
// Mock bullmq — capture the processor function passed to Worker constructor
// ---------------------------------------------------------------------------

type ProcessorFn = (job: Job<AgentTaskJobData, void, AgentTaskJobName>) => Promise<void>;

let capturedProcessor: ProcessorFn | null = null;

const mockWorkerInstance = {
  on: vi.fn().mockReturnThis(),
};

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((_queueName: string, processor: ProcessorFn) => {
    capturedProcessor = processor;
    return mockWorkerInstance;
  }),
}));

// ---------------------------------------------------------------------------
// Mock logger
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
// Helpers — factories for mock data
// ---------------------------------------------------------------------------

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-abc',
    machineId: 'machine-xyz',
    name: 'Test Agent',
    type: 'manual' as const,
    status: 'registered' as const,
    schedule: null,
    projectPath: '/home/user/project',
    worktreeBranch: null,
    currentSessionId: null,
    config: { model: 'claude-sonnet-4-20250514' },
    lastRunAt: null,
    lastCostUsd: null,
    totalCostUsd: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMachine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'machine-xyz',
    hostname: 'ec2-worker.tailnet',
    tailscaleIp: '100.64.0.1',
    os: 'linux' as const,
    arch: 'x64' as const,
    status: 'online' as const,
    lastHeartbeat: new Date(),
    capabilities: { gpu: false, docker: true, maxConcurrentAgents: 5 },
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockDbRegistry(overrides: Partial<DbAgentRegistry> = {}): DbAgentRegistry {
  return {
    getAgent: vi.fn().mockResolvedValue(makeAgent()),
    getMachine: vi.fn().mockResolvedValue(makeMachine()),
    createRun: vi.fn().mockResolvedValue('run-001'),
    completeRun: vi.fn().mockResolvedValue(undefined),
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn().mockResolvedValue([]),
    createAgent: vi.fn(),
    updateAgentStatus: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    getRecentRuns: vi.fn().mockResolvedValue([]),
    insertActions: vi.fn(),
    ...overrides,
  } as unknown as DbAgentRegistry;
}

function mockFetchSuccess(body: Record<string, unknown> = { ok: true, message: 'dispatched' }) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(body),
      text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    }),
  );
}

function mockFetchConnectionError(errorMessage = 'ECONNREFUSED') {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(errorMessage)));
}

function mockFetchFailure(status = 500, body = 'Internal Server Error') {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: vi.fn().mockRejectedValue(new Error('not json')),
      text: vi.fn().mockResolvedValue(body),
    }),
  );
}

function getProcessor(): ProcessorFn {
  if (!capturedProcessor) {
    throw new Error('No processor captured — did you call createTaskWorker()?');
  }
  return capturedProcessor;
}

function makeJob(
  overrides: Partial<AgentTaskJobData> = {},
): Job<AgentTaskJobData, void, AgentTaskJobName> {
  return {
    id: 'job-failover-1',
    name: 'agent:start' as const,
    data: {
      agentId: 'agent-abc',
      machineId: 'machine-xyz',
      prompt: 'Run failover tests',
      model: 'claude-sonnet-4-20250514',
      trigger: 'manual' as const,
      allowedTools: null,
      resumeSession: null,
      createdAt: '2026-03-03T00:00:00Z',
      ...overrides,
    },
  } as unknown as Job<AgentTaskJobData, void, AgentTaskJobName>;
}

// ===========================================================================
// Integration: multi-machine dispatch with circuit breaker failover
// ===========================================================================

describe('Integration: multi-machine dispatch with circuit breaker failover', () => {
  let dbRegistry: DbAgentRegistry;
  let circuitBreaker: MachineCircuitBreaker;

  beforeEach(() => {
    capturedProcessor = null;
    vi.clearAllMocks();

    // Re-wire after clearAllMocks so chained .on() calls return `this`
    mockWorkerInstance.on.mockReturnThis();

    dbRegistry = createMockDbRegistry();
    circuitBreaker = new MachineCircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 60_000,
      logger,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 1. Normal dispatch: healthy worker responds 200
  // -------------------------------------------------------------------------

  describe('normal dispatch to healthy worker', () => {
    it('dispatches to the worker and records success on the circuit breaker', async () => {
      mockFetchSuccess({ ok: true, message: 'agent started' });

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
        circuitBreaker,
      });

      const processor = getProcessor();
      await processor(makeJob());

      // Verify the dispatch went to the correct tailscale IP
      expect(fetch).toHaveBeenCalledOnce();
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toContain('100.64.0.1:9000');
      expect(fetchCall[0]).toContain('/api/agents/agent-abc/start');

      // Verify a run record was created
      expect(dbRegistry.createRun).toHaveBeenCalledOnce();
      expect(dbRegistry.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-abc',
          trigger: 'manual',
        }),
      );

      // completeRun should NOT be called — the agent is still running on the worker
      expect(dbRegistry.completeRun).not.toHaveBeenCalled();

      // Circuit breaker should remain closed after success
      expect(circuitBreaker.getState('machine-xyz')).toBe('closed');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Worker unreachable: connection refused
  // -------------------------------------------------------------------------

  describe('worker unreachable', () => {
    it('propagates DISPATCH_CONNECTION_ERROR when the worker does not respond', async () => {
      mockFetchConnectionError('connect ECONNREFUSED 100.64.0.1:9000');

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
        circuitBreaker,
      });

      const processor = getProcessor();

      const error = await processor(makeJob()).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ControlPlaneError);
      expect((error as ControlPlaneError).code).toBe('DISPATCH_CONNECTION_ERROR');

      // Run should have been created before the dispatch attempt
      expect(dbRegistry.createRun).toHaveBeenCalledOnce();

      // Run should be marked as failed because dispatch threw
      expect(dbRegistry.completeRun).toHaveBeenCalledOnce();
      expect(dbRegistry.completeRun).toHaveBeenCalledWith(
        'run-001',
        expect.objectContaining({ status: 'failure' }),
      );
    });

    it('propagates DISPATCH_HTTP_ERROR when the worker returns 503', async () => {
      mockFetchFailure(503, 'Service Unavailable');

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
        circuitBreaker,
      });

      const processor = getProcessor();

      const error = await processor(makeJob()).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ControlPlaneError);
      expect((error as ControlPlaneError).code).toBe('DISPATCH_HTTP_ERROR');

      // Run should be marked as failed
      expect(dbRegistry.completeRun).toHaveBeenCalledOnce();
      expect(dbRegistry.completeRun).toHaveBeenCalledWith(
        'run-001',
        expect.objectContaining({ status: 'failure' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. Circuit breaker opens after N consecutive failures
  // -------------------------------------------------------------------------

  describe('circuit breaker opens after failure threshold', () => {
    it('rejects dispatch immediately with MACHINE_CIRCUIT_OPEN after 3 consecutive failures', async () => {
      // Simulate 3 prior consecutive failures to open the circuit
      circuitBreaker.recordFailure('machine-xyz');
      circuitBreaker.recordFailure('machine-xyz');
      circuitBreaker.recordFailure('machine-xyz');

      expect(circuitBreaker.getState('machine-xyz')).toBe('open');

      // Now attempt a dispatch — should be rejected without hitting fetch
      mockFetchSuccess();

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
        circuitBreaker,
      });

      const processor = getProcessor();

      const error = await processor(makeJob()).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ControlPlaneError);
      expect((error as ControlPlaneError).code).toBe('MACHINE_CIRCUIT_OPEN');

      // fetch should never have been called — the circuit is open
      expect(fetch).not.toHaveBeenCalled();

      // No run record should be created because the dispatch was blocked
      // before reaching createRun (circuit breaker check is before createRun)
      expect(dbRegistry.createRun).not.toHaveBeenCalled();
    });

    it('accumulates failures through actual dispatches until the circuit opens', async () => {
      mockFetchConnectionError('connect ECONNREFUSED');

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
        circuitBreaker,
      });

      const processor = getProcessor();

      // Failures 1, 2, and 3 — each dispatch attempt fails
      for (let i = 0; i < 3; i++) {
        const runId = `run-fail-${i}`;
        vi.mocked(dbRegistry.createRun).mockResolvedValueOnce(runId);

        await processor(makeJob()).catch(() => {});
      }

      // After 3 failures, the circuit should be open
      expect(circuitBreaker.getState('machine-xyz')).toBe('open');

      // Fourth attempt should be blocked by the circuit breaker (no fetch)
      const fetchCallCountBefore = vi.mocked(fetch).mock.calls.length;

      const error = await processor(makeJob()).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(ControlPlaneError);
      expect((error as ControlPlaneError).code).toBe('MACHINE_CIRCUIT_OPEN');

      // No additional fetch call
      expect(vi.mocked(fetch).mock.calls.length).toBe(fetchCallCountBefore);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Circuit breaker half-open: after cooldown, one probe is allowed
  // -------------------------------------------------------------------------

  describe('circuit breaker half-open after cooldown', () => {
    it('allows one probe request through after the reset timeout elapses', () => {
      vi.useFakeTimers();

      // Open the circuit with 3 failures
      circuitBreaker.recordFailure('machine-xyz');
      circuitBreaker.recordFailure('machine-xyz');
      circuitBreaker.recordFailure('machine-xyz');

      expect(circuitBreaker.getState('machine-xyz')).toBe('open');
      expect(circuitBreaker.isOpen('machine-xyz')).toBe(true);

      // Advance time past the 60s reset timeout
      vi.advanceTimersByTime(60_001);

      // Circuit should now be half-open — isOpen returns false (probe allowed)
      expect(circuitBreaker.isOpen('machine-xyz')).toBe(false);
      expect(circuitBreaker.getState('machine-xyz')).toBe('half-open');
    });

    it('closes the circuit when the probe succeeds', () => {
      vi.useFakeTimers();

      circuitBreaker.recordFailure('machine-xyz');
      circuitBreaker.recordFailure('machine-xyz');
      circuitBreaker.recordFailure('machine-xyz');

      // Advance past the reset timeout to transition to half-open
      vi.advanceTimersByTime(60_001);
      expect(circuitBreaker.isOpen('machine-xyz')).toBe(false);

      // Record a success (probe passed)
      circuitBreaker.recordSuccess('machine-xyz');

      expect(circuitBreaker.getState('machine-xyz')).toBe('closed');
    });

    it('re-opens the circuit when the probe fails', () => {
      vi.useFakeTimers();

      circuitBreaker.recordFailure('machine-xyz');
      circuitBreaker.recordFailure('machine-xyz');
      circuitBreaker.recordFailure('machine-xyz');

      // Advance past the reset timeout to transition to half-open
      vi.advanceTimersByTime(60_001);
      // Trigger the half-open transition via isOpen check
      expect(circuitBreaker.isOpen('machine-xyz')).toBe(false);
      expect(circuitBreaker.getState('machine-xyz')).toBe('half-open');

      // The probe fails
      circuitBreaker.recordFailure('machine-xyz');

      // Circuit should be re-opened
      expect(circuitBreaker.getState('machine-xyz')).toBe('open');
      expect(circuitBreaker.isOpen('machine-xyz')).toBe(true);
    });

    it('allows a full dispatch through the task worker after half-open transition', async () => {
      vi.useFakeTimers();

      // Open the circuit
      circuitBreaker.recordFailure('machine-xyz');
      circuitBreaker.recordFailure('machine-xyz');
      circuitBreaker.recordFailure('machine-xyz');
      expect(circuitBreaker.getState('machine-xyz')).toBe('open');

      // Advance past the reset timeout
      vi.advanceTimersByTime(60_001);

      // Set up a successful fetch for the probe dispatch
      mockFetchSuccess({ ok: true, message: 'probe accepted' });

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
        circuitBreaker,
      });

      const processor = getProcessor();
      await processor(makeJob());

      // The dispatch should go through (fetch was called)
      expect(fetch).toHaveBeenCalledOnce();

      // Circuit should be closed after the successful probe
      expect(circuitBreaker.getState('machine-xyz')).toBe('closed');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Machine offline: dispatch skips with proper error
  // -------------------------------------------------------------------------

  describe('machine offline', () => {
    it('rejects dispatch with MACHINE_OFFLINE when the machine status is offline', async () => {
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(makeMachine({ status: 'offline' }));

      mockFetchSuccess();

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
        circuitBreaker,
      });

      const processor = getProcessor();

      const error = await processor(makeJob()).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ControlPlaneError);
      expect((error as ControlPlaneError).code).toBe('MACHINE_OFFLINE');

      // fetch should never have been called — offline check is before dispatch
      expect(fetch).not.toHaveBeenCalled();

      // No run record because the check happens before createRun
      expect(dbRegistry.createRun).not.toHaveBeenCalled();
    });

    it('rejects dispatch with AGENT_NOT_FOUND when the agent does not exist', async () => {
      vi.mocked(dbRegistry.getAgent).mockResolvedValue(undefined);

      mockFetchSuccess();

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
        circuitBreaker,
      });

      const processor = getProcessor();

      const error = await processor(makeJob()).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ControlPlaneError);
      expect((error as ControlPlaneError).code).toBe('AGENT_NOT_FOUND');

      expect(fetch).not.toHaveBeenCalled();
      expect(dbRegistry.createRun).not.toHaveBeenCalled();
    });

    it('rejects dispatch with MACHINE_NOT_FOUND when the machine is not registered', async () => {
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(undefined);

      mockFetchSuccess();

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
        circuitBreaker,
      });

      const processor = getProcessor();

      const error = await processor(makeJob()).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ControlPlaneError);
      expect((error as ControlPlaneError).code).toBe('MACHINE_NOT_FOUND');

      expect(fetch).not.toHaveBeenCalled();
      expect(dbRegistry.createRun).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases: circuit breaker with multiple machines
  // -------------------------------------------------------------------------

  describe('circuit breaker isolation across machines', () => {
    it('only blocks the machine whose circuit is open, not other machines', async () => {
      // Open circuit for machine-xyz
      circuitBreaker.recordFailure('machine-xyz');
      circuitBreaker.recordFailure('machine-xyz');
      circuitBreaker.recordFailure('machine-xyz');
      expect(circuitBreaker.getState('machine-xyz')).toBe('open');

      // machine-abc should still be closed
      expect(circuitBreaker.getState('machine-abc')).toBe('closed');

      // Set up a second machine for dispatch
      const secondMachine = makeMachine({
        id: 'machine-abc',
        hostname: 'mac-mini.tailnet',
        tailscaleIp: '100.64.0.2',
      });

      const secondAgent = makeAgent({
        id: 'agent-on-abc',
        machineId: 'machine-abc',
      });

      vi.mocked(dbRegistry.getAgent).mockResolvedValue(secondAgent);
      vi.mocked(dbRegistry.getMachine).mockResolvedValue(secondMachine);

      mockFetchSuccess({ ok: true, message: 'dispatched to mac mini' });

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
        circuitBreaker,
      });

      const processor = getProcessor();
      await processor(makeJob({ agentId: 'agent-on-abc', machineId: 'machine-abc' }));

      // Dispatch should succeed to machine-abc
      expect(fetch).toHaveBeenCalledOnce();
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toContain('100.64.0.2:9000');

      // machine-xyz should still be open
      expect(circuitBreaker.getState('machine-xyz')).toBe('open');
      // machine-abc should remain closed
      expect(circuitBreaker.getState('machine-abc')).toBe('closed');
    });
  });

  // -------------------------------------------------------------------------
  // Edge case: no circuit breaker provided (null)
  // -------------------------------------------------------------------------

  describe('dispatch without circuit breaker configured', () => {
    it('dispatches normally when circuitBreaker is null', async () => {
      mockFetchSuccess({ ok: true, message: 'dispatched' });

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
        circuitBreaker: null,
      });

      const processor = getProcessor();
      await processor(makeJob());

      expect(fetch).toHaveBeenCalledOnce();
      expect(dbRegistry.createRun).toHaveBeenCalledOnce();
      expect(dbRegistry.completeRun).not.toHaveBeenCalled();
    });
  });
});
