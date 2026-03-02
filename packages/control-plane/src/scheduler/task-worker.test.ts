import { ControlPlaneError } from '@agentctl/shared';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemoryInjector } from '../memory/memory-injector.js';
import type { DbAgentRegistry } from '../registry/db-registry.js';
import { AGENT_TASKS_QUEUE, type AgentTaskJobData, type AgentTaskJobName } from './task-queue.js';
import { createTaskWorker } from './task-worker.js';

// ---------------------------------------------------------------------------
// Mock bullmq — capture the processor function passed to Worker constructor
// ---------------------------------------------------------------------------

type ProcessorFn = (job: Job<AgentTaskJobData, void, AgentTaskJobName>) => Promise<void>;

let capturedProcessor: ProcessorFn | null = null;
let capturedQueueName: string | null = null;
let capturedOptions: Record<string, unknown> | null = null;

const mockWorkerInstance = {
  on: vi.fn().mockReturnThis(),
};

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((queueName: string, processor: ProcessorFn, options: Record<string, unknown>) => {
    capturedQueueName = queueName;
    capturedProcessor = processor;
    capturedOptions = options;
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
// Helpers
// ---------------------------------------------------------------------------

function makeJob(
  overrides: Partial<AgentTaskJobData> = {},
  jobName: AgentTaskJobName = 'agent:start',
): Job<AgentTaskJobData, void, AgentTaskJobName> {
  const data: AgentTaskJobData = {
    agentId: 'agent-abc',
    machineId: 'machine-xyz',
    prompt: 'Implement the feature',
    model: 'claude-opus-4-6',
    trigger: 'manual',
    tools: null,
    resumeSession: null,
    createdAt: '2026-03-02T00:00:00Z',
    ...overrides,
  };

  return {
    id: 'job-1',
    name: jobName,
    data,
  } as unknown as Job<AgentTaskJobData, void, AgentTaskJobName>;
}

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-abc',
    machineId: 'machine-xyz',
    name: 'Test Agent',
    type: 'manual',
    status: 'registered',
    schedule: null,
    projectPath: '/home/user/project',
    worktreeBranch: null,
    currentSessionId: null,
    config: {},
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
    os: 'linux',
    arch: 'x64',
    status: 'online',
    lastHeartbeat: new Date(),
    capabilities: { gpu: false, docker: true, maxConcurrentAgents: 5 },
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockRegistry(overrides: Partial<DbAgentRegistry> = {}): DbAgentRegistry {
  return {
    getAgent: vi.fn().mockResolvedValue(makeAgent()),
    getMachine: vi.fn().mockResolvedValue(makeMachine()),
    createRun: vi.fn().mockResolvedValue('run-001'),
    completeRun: vi.fn().mockResolvedValue(undefined),
    registerMachine: vi.fn(),
    heartbeat: vi.fn(),
    listMachines: vi.fn(),
    createAgent: vi.fn(),
    updateAgentStatus: vi.fn(),
    listAgents: vi.fn(),
    getRecentRuns: vi.fn(),
    insertActions: vi.fn(),
    ...overrides,
  } as unknown as DbAgentRegistry;
}

function createMockMemoryInjector(context: string | null = null): MemoryInjector {
  return {
    buildMemoryContext: vi.fn().mockResolvedValue(context ?? ''),
    syncAfterRun: vi.fn(),
  } as unknown as MemoryInjector;
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

// ---------------------------------------------------------------------------
// Retrieve the processor after createTaskWorker() is called
// ---------------------------------------------------------------------------

function getProcessor(): ProcessorFn {
  if (!capturedProcessor) {
    throw new Error('No processor captured — did you call createTaskWorker()?');
  }
  return capturedProcessor;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTaskWorker()', () => {
  beforeEach(() => {
    capturedProcessor = null;
    capturedQueueName = null;
    capturedOptions = null;
    vi.clearAllMocks();
  });

  it('creates a Worker bound to the correct queue name', () => {
    createTaskWorker({
      connection: { host: 'localhost', port: 6379 },
      logger,
    });

    expect(capturedQueueName).toBe(AGENT_TASKS_QUEUE);
  });

  it('respects the concurrency option passed to Worker', () => {
    createTaskWorker({
      connection: { host: 'localhost', port: 6379 },
      logger,
      concurrency: 10,
    });

    expect(capturedOptions).toMatchObject({ concurrency: 10 });
  });

  it('defaults concurrency to 5 when not provided', () => {
    createTaskWorker({
      connection: { host: 'localhost', port: 6379 },
      logger,
    });

    expect(capturedOptions).toMatchObject({ concurrency: 5 });
  });

  it('registers completed, failed, and error event listeners on the worker', () => {
    createTaskWorker({
      connection: { host: 'localhost', port: 6379 },
      logger,
    });

    const onCalls: string[] = mockWorkerInstance.on.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(onCalls).toContain('completed');
    expect(onCalls).toContain('failed');
    expect(onCalls).toContain('error');
  });

  describe('processor — guard checks', () => {
    it('throws REGISTRY_UNAVAILABLE when registry is null', async () => {
      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry: null,
      });

      const processor = getProcessor();
      const job = makeJob();

      await expect(processor(job)).rejects.toMatchObject({
        name: 'ControlPlaneError',
        code: 'REGISTRY_UNAVAILABLE',
      });
    });

    it('throws AGENT_NOT_FOUND when registry.getAgent() returns undefined', async () => {
      const registry = createMockRegistry({
        getAgent: vi.fn().mockResolvedValue(undefined),
      });

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry,
      });

      const processor = getProcessor();
      const job = makeJob();

      await expect(processor(job)).rejects.toMatchObject({
        name: 'ControlPlaneError',
        code: 'AGENT_NOT_FOUND',
      });
    });

    it('throws MACHINE_NOT_FOUND when registry.getMachine() returns undefined', async () => {
      const registry = createMockRegistry({
        getAgent: vi.fn().mockResolvedValue(makeAgent()),
        getMachine: vi.fn().mockResolvedValue(undefined),
      });

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry,
      });

      const processor = getProcessor();
      const job = makeJob();

      await expect(processor(job)).rejects.toMatchObject({
        name: 'ControlPlaneError',
        code: 'MACHINE_NOT_FOUND',
      });
    });

    it('throws MACHINE_OFFLINE when the target machine has status "offline"', async () => {
      const registry = createMockRegistry({
        getAgent: vi.fn().mockResolvedValue(makeAgent()),
        getMachine: vi.fn().mockResolvedValue(makeMachine({ status: 'offline' })),
      });

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry,
      });

      const processor = getProcessor();
      const job = makeJob();

      await expect(processor(job)).rejects.toMatchObject({
        name: 'ControlPlaneError',
        code: 'MACHINE_OFFLINE',
      });
    });
  });

  describe('processor — successful dispatch', () => {
    it('creates a run record and dispatches to worker without completing the run', async () => {
      const registry = createMockRegistry();
      mockFetchSuccess({ ok: true, message: 'agent started' });

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry,
      });

      const processor = getProcessor();
      const job = makeJob();

      await processor(job);

      expect(registry.createRun).toHaveBeenCalledOnce();
      expect(registry.createRun).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-abc', trigger: 'manual' }),
      );

      expect(fetch).toHaveBeenCalledOnce();

      // completeRun should NOT be called on success — the agent is still
      // running asynchronously on the worker. The worker reports final
      // status via the audit reporter or completion callback.
      expect(registry.completeRun).not.toHaveBeenCalled();
    });

    it('dispatches to the correct Tailscale URL for the machine', async () => {
      const registry = createMockRegistry({
        getMachine: vi.fn().mockResolvedValue(makeMachine({ tailscaleIp: '100.64.0.42' })),
      });
      mockFetchSuccess();

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry,
      });

      const processor = getProcessor();
      const job = makeJob();

      await processor(job);

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      expect(fetchCall[0]).toContain('100.64.0.42:9000');
      expect(fetchCall[0]).toContain('/api/agents/agent-abc/start');
    });
  });

  describe('processor — dispatch failure', () => {
    it('marks the run as failed when dispatch returns a non-2xx response', async () => {
      const registry = createMockRegistry();
      mockFetchFailure(500, 'Internal Server Error');

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry,
      });

      const processor = getProcessor();
      const job = makeJob();

      await expect(processor(job)).rejects.toBeInstanceOf(ControlPlaneError);

      expect(registry.createRun).toHaveBeenCalledOnce();
      expect(registry.completeRun).toHaveBeenCalledOnce();
      expect(registry.completeRun).toHaveBeenCalledWith(
        'run-001',
        expect.objectContaining({ status: 'failure' }),
      );
    });

    it('does not attempt to complete a run when createRun itself fails', async () => {
      const registry = createMockRegistry({
        createRun: vi.fn().mockRejectedValue(
          new ControlPlaneError('RUN_CREATE_FAILED', 'DB error', {}),
        ),
      });
      mockFetchSuccess();

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry,
      });

      const processor = getProcessor();
      const job = makeJob();

      await expect(processor(job)).rejects.toBeInstanceOf(ControlPlaneError);

      // completeRun should never be called because runId was never assigned
      expect(registry.completeRun).not.toHaveBeenCalled();
    });
  });

  describe('processor — memory injection', () => {
    it('prepends memory context to the prompt when memoryInjector returns context', async () => {
      const registry = createMockRegistry();
      const memoryInjector = createMockMemoryInjector('## Relevant Memories\n- User prefers TypeScript');
      mockFetchSuccess();

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry,
        memoryInjector,
      });

      const processor = getProcessor();
      const job = makeJob({ prompt: 'Write the auth module' });

      await processor(job);

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1]?.body as string) as { prompt: string };

      expect(requestBody.prompt).toMatch(/## Relevant Memories/);
      expect(requestBody.prompt).toMatch(/Write the auth module/);
      expect(requestBody.prompt.indexOf('## Relevant Memories')).toBeLessThan(
        requestBody.prompt.indexOf('Write the auth module'),
      );
    });

    it('uses the original prompt unchanged when memoryInjector returns empty string', async () => {
      const registry = createMockRegistry();
      const memoryInjector = createMockMemoryInjector('');
      mockFetchSuccess();

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry,
        memoryInjector,
      });

      const processor = getProcessor();
      const originalPrompt = 'Write the auth module';
      const job = makeJob({ prompt: originalPrompt });

      await processor(job);

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1]?.body as string) as { prompt: string };

      expect(requestBody.prompt).toBe(originalPrompt);
    });
  });

  describe('processor — signal jobs', () => {
    it('logs signalMetadata for agent:signal jobs', async () => {
      const registry = createMockRegistry();
      mockFetchSuccess();

      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
        registry,
      });

      const processor = getProcessor();
      const job = makeJob(
        {
          trigger: 'signal',
          signalMetadata: { source: 'webhook', eventType: 'pr_merged' },
        },
        'agent:signal',
      );

      await processor(job);

      const infoCallArgs = vi.mocked(logger.info).mock.calls;
      const signalLog = infoCallArgs.find(
        (args) =>
          typeof args[0] === 'object' &&
          args[0] !== null &&
          'signalMetadata' in (args[0] as Record<string, unknown>),
      );

      expect(signalLog).toBeDefined();
      expect((signalLog![0] as Record<string, unknown>).signalMetadata).toEqual({
        source: 'webhook',
        eventType: 'pr_merged',
      });
    });
  });
});
