import { ControlPlaneError } from '@agentctl/shared';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';
import {
  createMockDbRegistry as createMockRegistry,
  makeAgent,
  makeJob,
  makeMachine,
  mockFetchFailure,
  mockFetchSuccess,
} from '../integration/test-helpers.js';
import type { MemoryInjector } from '../memory/memory-injector.js';
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
  Worker: vi
    .fn()
    .mockImplementation(
      (queueName: string, processor: ProcessorFn, options: Record<string, unknown>) => {
        capturedQueueName = queueName;
        capturedProcessor = processor;
        capturedOptions = options;
        return mockWorkerInstance;
      },
    ),
}));

const logger = createMockLogger();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockMemoryInjector(context: string | null = null): MemoryInjector {
  return {
    buildMemoryContext: vi.fn().mockResolvedValue(context ?? ''),
    syncAfterRun: vi.fn(),
  } as unknown as MemoryInjector;
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

    const onCalls: string[] = mockWorkerInstance.on.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
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
        createRun: vi
          .fn()
          .mockRejectedValue(new ControlPlaneError('RUN_CREATE_FAILED', 'DB error', {})),
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
      const memoryInjector = createMockMemoryInjector(
        '## Relevant Memories\n- User prefers TypeScript',
      );
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

  // -------------------------------------------------------------------------
  // Worker event handlers (completed, failed, error)
  // -------------------------------------------------------------------------

  describe('worker event handlers', () => {
    it('completed event handler logs the job details', () => {
      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
      });

      // Find the 'completed' event handler registered via worker.on()
      const completedCall = mockWorkerInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'completed',
      );
      expect(completedCall).toBeDefined();

      const completedHandler = completedCall[1] as (
        job: Job<AgentTaskJobData, void, AgentTaskJobName>,
      ) => void;

      const job = makeJob({ agentId: 'agent-completed-test' });
      completedHandler(job);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-1',
          agentId: 'agent-completed-test',
        }),
        'Job completed',
      );
    });

    it('failed event handler logs the job details and error', () => {
      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
      });

      // Find the 'failed' event handler registered via worker.on()
      const failedCall = mockWorkerInstance.on.mock.calls.find((c: unknown[]) => c[0] === 'failed');
      expect(failedCall).toBeDefined();

      const failedHandler = failedCall[1] as (
        job: Job<AgentTaskJobData, void, AgentTaskJobName> | undefined,
        err: Error,
      ) => void;

      const job = makeJob({ agentId: 'agent-failed-test' });
      const error = new Error('Processing exploded');

      failedHandler(job, error);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'job-1',
          agentId: 'agent-failed-test',
          err: error,
        }),
        'Job failed',
      );
    });

    it('failed event handler handles undefined job gracefully', () => {
      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
      });

      const failedCall = mockWorkerInstance.on.mock.calls.find((c: unknown[]) => c[0] === 'failed');
      expect(failedCall).toBeDefined();

      const failedHandler = failedCall[1] as (
        job: Job<AgentTaskJobData, void, AgentTaskJobName> | undefined,
        err: Error,
      ) => void;

      const error = new Error('Unknown failure');

      // Call with undefined job — should not throw
      failedHandler(undefined, error);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: undefined,
          agentId: undefined,
          err: error,
        }),
        'Job failed',
      );
    });

    it('error event handler logs the worker-level error', () => {
      createTaskWorker({
        connection: { host: 'localhost', port: 6379 },
        logger,
      });

      // Find the 'error' event handler registered via worker.on()
      const errorCall = mockWorkerInstance.on.mock.calls.find((c: unknown[]) => c[0] === 'error');
      expect(errorCall).toBeDefined();

      const errorHandler = errorCall[1] as (err: Error) => void;
      const error = new Error('Redis connection lost');

      errorHandler(error);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: error }),
        'Task worker error',
      );
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
      expect((signalLog?.[0] as Record<string, unknown>).signalMetadata).toEqual({
        source: 'webhook',
        eventType: 'pr_merged',
      });
    });
  });
});
