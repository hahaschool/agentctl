import { ControlPlaneError } from '@agentctl/shared';
import type { Job } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../api/server.js';
import type { DbAgentRegistry } from '../registry/db-registry.js';
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
// Mock logger — shared across Fastify server and task worker
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

// ===========================================================================
// Integration: dispatch → completion lifecycle
// ===========================================================================

describe('Integration: dispatch → completion lifecycle', () => {
  let app: FastifyInstance;
  let dbRegistry: DbAgentRegistry;
  let mockTaskQueue: { add: ReturnType<typeof vi.fn> };

  beforeAll(async () => {
    dbRegistry = createMockDbRegistry();

    mockTaskQueue = {
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    };

    app = await createServer({
      logger,
      dbRegistry,
      taskQueue: mockTaskQueue as never,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    capturedProcessor = null;
    vi.clearAllMocks();

    // Re-wire default mock return values after clearAllMocks
    vi.mocked(dbRegistry.getAgent).mockResolvedValue(makeAgent());
    vi.mocked(dbRegistry.getMachine).mockResolvedValue(makeMachine());
    vi.mocked(dbRegistry.createRun).mockResolvedValue('run-001');
    vi.mocked(dbRegistry.completeRun).mockResolvedValue(undefined);
    vi.mocked(dbRegistry.listMachines).mockResolvedValue([]);
    vi.mocked(dbRegistry.listAgents).mockResolvedValue([]);
    vi.mocked(dbRegistry.getRecentRuns).mockResolvedValue([]);
    mockTaskQueue.add.mockResolvedValue({ id: 'job-1' });
  });

  // -------------------------------------------------------------------------
  // Happy path: start → dispatch → complete with success
  // -------------------------------------------------------------------------

  describe('happy path: start → dispatch → complete with success', () => {
    it('validates the full lifecycle from HTTP start through processor dispatch to completion callback', async () => {
      // ---------------------------------------------------------------
      // Step 1: Start an agent via POST /api/agents/:id/start
      // ---------------------------------------------------------------
      const startResponse = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-abc/start',
        payload: {
          prompt: 'Implement the auth module',
          model: 'claude-opus-4-6',
        },
      });

      expect(startResponse.statusCode).toBe(200);

      const startBody = startResponse.json();
      expect(startBody.ok).toBe(true);
      expect(startBody.agentId).toBe('agent-abc');
      expect(startBody.jobId).toBe('job-1');

      // Verify the job was enqueued with correct data
      expect(mockTaskQueue.add).toHaveBeenCalledOnce();
      expect(mockTaskQueue.add).toHaveBeenCalledWith(
        'agent:start',
        expect.objectContaining({
          agentId: 'agent-abc',
          machineId: 'machine-xyz',
          prompt: 'Implement the auth module',
          model: 'claude-opus-4-6',
          trigger: 'manual',
        }),
      );

      // ---------------------------------------------------------------
      // Step 2: Process the job by calling the task worker processor
      //         with the enqueued job data
      // ---------------------------------------------------------------
      mockFetchSuccess({ ok: true, message: 'agent started' });

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
      });

      const processor = getProcessor();

      // Build the job object from the data that was enqueued
      const enqueuedJobData = mockTaskQueue.add.mock.calls[0][1] as AgentTaskJobData;
      const job = {
        id: 'job-1',
        name: 'agent:start',
        data: enqueuedJobData,
      } as unknown as Job<AgentTaskJobData, void, AgentTaskJobName>;

      await processor(job);

      // Verify createRun was called to create a run record
      expect(dbRegistry.createRun).toHaveBeenCalledOnce();
      expect(dbRegistry.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-abc',
          trigger: 'manual',
          model: 'claude-opus-4-6',
        }),
      );

      // Verify the dispatch went to the correct worker URL
      expect(fetch).toHaveBeenCalledOnce();
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toContain('100.64.0.1:9000');
      expect(fetchCall[0]).toContain('/api/agents/agent-abc/start');

      // Verify the dispatch payload includes the runId and prompt
      const dispatchBody = JSON.parse(fetchCall[1]?.body as string) as {
        runId: string;
        prompt: string;
      };
      expect(dispatchBody.runId).toBe('run-001');
      expect(dispatchBody.prompt).toBe('Implement the auth module');

      // completeRun should NOT be called by the processor — the agent
      // is still running asynchronously on the worker
      expect(dbRegistry.completeRun).not.toHaveBeenCalled();

      // ---------------------------------------------------------------
      // Step 3: Complete the run via POST /api/agents/:id/complete
      //         (simulating the agent worker callback)
      // ---------------------------------------------------------------
      const completeResponse = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-abc/complete',
        payload: {
          runId: 'run-001',
          status: 'success',
          costUsd: 0.42,
          durationMs: 15000,
          sessionId: 'sess-xyz',
        },
      });

      expect(completeResponse.statusCode).toBe(200);

      const completeBody = completeResponse.json();
      expect(completeBody.ok).toBe(true);
      expect(completeBody.runId).toBe('run-001');
      expect(completeBody.status).toBe('success');

      // Verify completeRun was called with the correct status
      expect(dbRegistry.completeRun).toHaveBeenCalledOnce();
      expect(dbRegistry.completeRun).toHaveBeenCalledWith('run-001', {
        status: 'success',
        errorMessage: null,
        costUsd: '0.42',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Failure path: start → dispatch → complete with failure + errorMessage
  // -------------------------------------------------------------------------

  describe('failure path: start → dispatch → complete with failure', () => {
    it('propagates the error message through the full lifecycle', async () => {
      // ---------------------------------------------------------------
      // Step 1: Start the agent
      // ---------------------------------------------------------------
      const startResponse = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-abc/start',
        payload: {
          prompt: 'Refactor the database layer',
          model: 'claude-sonnet-4-20250514',
        },
      });

      expect(startResponse.statusCode).toBe(200);
      expect(startResponse.json().ok).toBe(true);
      expect(mockTaskQueue.add).toHaveBeenCalledOnce();

      // ---------------------------------------------------------------
      // Step 2: Process the job — dispatch succeeds (worker accepts it)
      // ---------------------------------------------------------------
      mockFetchSuccess({ ok: true, message: 'agent started' });

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
      });

      const processor = getProcessor();

      const enqueuedJobData = mockTaskQueue.add.mock.calls[0][1] as AgentTaskJobData;
      const job = {
        id: 'job-2',
        name: 'agent:start',
        data: enqueuedJobData,
      } as unknown as Job<AgentTaskJobData, void, AgentTaskJobName>;

      await processor(job);

      expect(dbRegistry.createRun).toHaveBeenCalledOnce();
      expect(dbRegistry.completeRun).not.toHaveBeenCalled();

      // ---------------------------------------------------------------
      // Step 3: Agent fails on the worker — completion callback reports
      //         failure with an error message
      // ---------------------------------------------------------------
      const completeResponse = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-abc/complete',
        payload: {
          runId: 'run-001',
          status: 'failure',
          errorMessage: 'Agent exceeded token limit and was terminated',
          durationMs: 60000,
        },
      });

      expect(completeResponse.statusCode).toBe(200);

      const completeBody = completeResponse.json();
      expect(completeBody.ok).toBe(true);
      expect(completeBody.runId).toBe('run-001');
      expect(completeBody.status).toBe('failure');

      // Verify completeRun was called with failure status and error message
      expect(dbRegistry.completeRun).toHaveBeenCalledOnce();
      expect(dbRegistry.completeRun).toHaveBeenCalledWith('run-001', {
        status: 'failure',
        errorMessage: 'Agent exceeded token limit and was terminated',
        costUsd: null,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Dispatch failure: worker HTTP returns non-2xx → processor marks run failed
  // -------------------------------------------------------------------------

  describe('dispatch failure: worker rejects the HTTP request', () => {
    it('marks the run as failed when dispatch returns a non-2xx response', async () => {
      // Start the agent
      const startResponse = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-abc/start',
        payload: {
          prompt: 'Run the migration',
          model: 'claude-opus-4-6',
        },
      });

      expect(startResponse.statusCode).toBe(200);

      // Process the job with a failing worker dispatch
      mockFetchFailure(503, 'Service Unavailable');

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
      });

      const processor = getProcessor();

      const enqueuedJobData = mockTaskQueue.add.mock.calls[0][1] as AgentTaskJobData;
      const job = {
        id: 'job-3',
        name: 'agent:start',
        data: enqueuedJobData,
      } as unknown as Job<AgentTaskJobData, void, AgentTaskJobName>;

      // The processor should throw because the dispatch failed
      await expect(processor(job)).rejects.toBeInstanceOf(ControlPlaneError);

      // createRun should have been called (run was created before dispatch attempt)
      expect(dbRegistry.createRun).toHaveBeenCalledOnce();

      // completeRun should have been called by the processor's error handler
      // to mark the run as failed
      expect(dbRegistry.completeRun).toHaveBeenCalledOnce();
      expect(dbRegistry.completeRun).toHaveBeenCalledWith(
        'run-001',
        expect.objectContaining({ status: 'failure' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Validation: complete with missing runId returns 400
  // -------------------------------------------------------------------------

  describe('validation: complete endpoint input checks', () => {
    it('returns 400 when runId is missing from the completion payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-abc/complete',
        payload: {
          status: 'success',
          costUsd: 0.1,
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_RUN_ID');

      // completeRun should never be called for invalid input
      expect(dbRegistry.completeRun).not.toHaveBeenCalled();
    });

    it('returns 400 when status is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-abc/complete',
        payload: {
          runId: 'run-001',
          status: 'pending',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_STATUS');

      expect(dbRegistry.completeRun).not.toHaveBeenCalled();
    });

    it('returns 400 when runId is an empty string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-abc/complete',
        payload: {
          runId: '',
          status: 'success',
        },
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.error).toBe('INVALID_RUN_ID');
    });
  });

  // -------------------------------------------------------------------------
  // Guard: complete without dbRegistry returns 501
  // -------------------------------------------------------------------------

  describe('guard: complete without dbRegistry returns 501', () => {
    let appWithoutDb: FastifyInstance;

    beforeAll(async () => {
      appWithoutDb = await createServer({ logger });
      await appWithoutDb.ready();
    });

    afterAll(async () => {
      await appWithoutDb.close();
    });

    it('returns 501 when dbRegistry is not configured', async () => {
      const response = await appWithoutDb.inject({
        method: 'POST',
        url: '/api/agents/agent-abc/complete',
        payload: {
          runId: 'run-001',
          status: 'success',
        },
      });

      expect(response.statusCode).toBe(501);

      const body = response.json();
      expect(body.error).toBe('DATABASE_NOT_CONFIGURED');
    });
  });

  // -------------------------------------------------------------------------
  // Run record reflects lifecycle: agent not found via getAgent → 404
  // -------------------------------------------------------------------------

  describe('run record integrity', () => {
    it('returns 404 when completeRun throws RUN_NOT_FOUND', async () => {
      vi.mocked(dbRegistry.completeRun).mockRejectedValueOnce(
        new ControlPlaneError('RUN_NOT_FOUND', 'Run not found', {}),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-abc/complete',
        payload: {
          runId: 'run-ghost',
          status: 'failure',
          errorMessage: 'something went wrong',
        },
      });

      expect(response.statusCode).toBe(404);

      const body = response.json();
      expect(body.error).toBe('RUN_NOT_FOUND');
    });

    it('returns 500 when completeRun throws an unexpected database error', async () => {
      vi.mocked(dbRegistry.completeRun).mockRejectedValueOnce(
        new Error('connection reset by peer'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-abc/complete',
        payload: {
          runId: 'run-001',
          status: 'failure',
        },
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.error).toBe('COMPLETION_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  // End-to-end: verifies that processor creates a run then the completion
  // callback correctly references the same runId
  // -------------------------------------------------------------------------

  describe('runId consistency across dispatch and completion', () => {
    it('uses the same runId from createRun in both dispatch payload and completion callback', async () => {
      const uniqueRunId = 'run-unique-42';
      vi.mocked(dbRegistry.createRun).mockResolvedValueOnce(uniqueRunId);

      mockFetchSuccess({ ok: true, message: 'accepted' });

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: dbRegistry,
      });

      const processor = getProcessor();

      const job = {
        id: 'job-consistency',
        name: 'agent:start' as const,
        data: {
          agentId: 'agent-abc',
          machineId: 'machine-xyz',
          prompt: 'Check runId consistency',
          model: 'claude-opus-4-6',
          trigger: 'manual' as const,
          tools: null,
          resumeSession: null,
          createdAt: '2026-03-02T00:00:00Z',
        },
      } as unknown as Job<AgentTaskJobData, void, AgentTaskJobName>;

      await processor(job);

      // Verify dispatch payload included the correct runId
      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const dispatchPayload = JSON.parse(fetchCall[1]?.body as string) as { runId: string };
      expect(dispatchPayload.runId).toBe(uniqueRunId);

      // Now complete via the HTTP endpoint with the same runId
      const completeResponse = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-abc/complete',
        payload: {
          runId: uniqueRunId,
          status: 'success',
          costUsd: 1.23,
        },
      });

      expect(completeResponse.statusCode).toBe(200);
      expect(completeResponse.json().runId).toBe(uniqueRunId);

      // completeRun should reference the same runId
      expect(dbRegistry.completeRun).toHaveBeenCalledWith(
        uniqueRunId,
        expect.objectContaining({ status: 'success' }),
      );
    });
  });
});
