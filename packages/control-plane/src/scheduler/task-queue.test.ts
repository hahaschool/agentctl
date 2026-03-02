import type { ConnectionOptions } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_TASKS_QUEUE,
  type AgentTaskJobData,
  type AgentTaskJobName,
  createTaskQueue,
} from './task-queue.js';

// ---------------------------------------------------------------------------
// Mock bullmq — capture the arguments passed to the Queue constructor
// ---------------------------------------------------------------------------

let capturedQueueName: string | null = null;
let capturedQueueOptions: Record<string, unknown> | null = null;

const mockQueueInstance = {
  add: vi.fn(),
  close: vi.fn(),
  getJobs: vi.fn(),
};

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation((name: string, opts: Record<string, unknown>) => {
    capturedQueueName = name;
    capturedQueueOptions = opts;
    return mockQueueInstance;
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('task-queue', () => {
  beforeEach(() => {
    capturedQueueName = null;
    capturedQueueOptions = null;
    vi.clearAllMocks();
  });

  describe('AGENT_TASKS_QUEUE constant', () => {
    it('equals "agent-tasks"', () => {
      expect(AGENT_TASKS_QUEUE).toBe('agent-tasks');
    });

    it('is a string', () => {
      expect(typeof AGENT_TASKS_QUEUE).toBe('string');
    });
  });

  describe('createTaskQueue()', () => {
    const connection: ConnectionOptions = { host: 'localhost', port: 6379 };

    it('creates a Queue with the AGENT_TASKS_QUEUE name', () => {
      createTaskQueue(connection);

      expect(capturedQueueName).toBe(AGENT_TASKS_QUEUE);
    });

    it('returns the Queue instance', () => {
      const queue = createTaskQueue(connection);

      expect(queue).toBe(mockQueueInstance);
    });

    it('passes the connection options to the Queue', () => {
      const customConnection: ConnectionOptions = {
        host: 'redis.tailnet',
        port: 6380,
      };

      createTaskQueue(customConnection);

      expect(capturedQueueOptions).toMatchObject({
        connection: customConnection,
      });
    });

    describe('default job options', () => {
      it('sets attempts to 3', () => {
        createTaskQueue(connection);

        const defaultJobOptions = (capturedQueueOptions as Record<string, unknown>)
          .defaultJobOptions as Record<string, unknown>;

        expect(defaultJobOptions.attempts).toBe(3);
      });

      it('uses exponential backoff with 1000ms delay', () => {
        createTaskQueue(connection);

        const defaultJobOptions = (capturedQueueOptions as Record<string, unknown>)
          .defaultJobOptions as Record<string, unknown>;

        expect(defaultJobOptions.backoff).toEqual({
          type: 'exponential',
          delay: 1000,
        });
      });

      it('configures removeOnComplete to keep up to 1000 jobs', () => {
        createTaskQueue(connection);

        const defaultJobOptions = (capturedQueueOptions as Record<string, unknown>)
          .defaultJobOptions as Record<string, unknown>;

        expect(defaultJobOptions.removeOnComplete).toEqual({ count: 1000 });
      });

      it('configures removeOnFail to keep up to 5000 jobs', () => {
        createTaskQueue(connection);

        const defaultJobOptions = (capturedQueueOptions as Record<string, unknown>)
          .defaultJobOptions as Record<string, unknown>;

        expect(defaultJobOptions.removeOnFail).toEqual({ count: 5000 });
      });
    });

    describe('with different connection configurations', () => {
      it('works with a minimal connection (host only)', () => {
        const minimalConnection: ConnectionOptions = { host: '127.0.0.1' };

        const queue = createTaskQueue(minimalConnection);

        expect(queue).toBe(mockQueueInstance);
        expect(capturedQueueOptions).toMatchObject({
          connection: minimalConnection,
        });
      });

      it('works with full Redis connection options', () => {
        const fullConnection: ConnectionOptions = {
          host: 'redis.internal',
          port: 6379,
          password: 'secret',
          db: 2,
        };

        const queue = createTaskQueue(fullConnection);

        expect(queue).toBe(mockQueueInstance);
        expect(capturedQueueOptions).toMatchObject({
          connection: fullConnection,
        });
      });
    });

    it('can be called multiple times to create independent queues', async () => {
      const { Queue } = vi.mocked(await import('bullmq'));

      const queue1 = createTaskQueue({ host: 'host-1' });
      const queue2 = createTaskQueue({ host: 'host-2' });

      // Both calls should invoke the Queue constructor
      expect(Queue).toHaveBeenCalledTimes(2);

      // Both should return the mock instance (in our mock setup)
      expect(queue1).toBeDefined();
      expect(queue2).toBeDefined();
    });
  });

  describe('AgentTaskJobData type shape (runtime validation)', () => {
    it('accepts a fully populated job data object', () => {
      const jobData: AgentTaskJobData = {
        agentId: 'agent-001',
        machineId: 'machine-xyz',
        prompt: 'Build the feature',
        model: 'claude-opus-4-6',
        trigger: 'manual',
        tools: ['Read', 'Write', 'Bash'],
        resumeSession: 'session-abc',
        createdAt: '2026-03-02T00:00:00Z',
        signalMetadata: { source: 'webhook' },
      };

      expect(jobData.agentId).toBe('agent-001');
      expect(jobData.machineId).toBe('machine-xyz');
      expect(jobData.prompt).toBe('Build the feature');
      expect(jobData.model).toBe('claude-opus-4-6');
      expect(jobData.trigger).toBe('manual');
      expect(jobData.tools).toEqual(['Read', 'Write', 'Bash']);
      expect(jobData.resumeSession).toBe('session-abc');
      expect(jobData.createdAt).toBe('2026-03-02T00:00:00Z');
      expect(jobData.signalMetadata).toEqual({ source: 'webhook' });
    });

    it('accepts nullable fields as null', () => {
      const jobData: AgentTaskJobData = {
        agentId: 'agent-002',
        machineId: 'machine-abc',
        prompt: null,
        model: null,
        trigger: 'heartbeat',
        tools: null,
        resumeSession: null,
        createdAt: '2026-03-02T12:00:00Z',
      };

      expect(jobData.prompt).toBeNull();
      expect(jobData.model).toBeNull();
      expect(jobData.tools).toBeNull();
      expect(jobData.resumeSession).toBeNull();
    });

    it('allows signalMetadata to be omitted (optional field)', () => {
      const jobData: AgentTaskJobData = {
        agentId: 'agent-003',
        machineId: 'machine-def',
        prompt: 'Run task',
        model: null,
        trigger: 'signal',
        tools: null,
        resumeSession: null,
        createdAt: '2026-03-02T06:00:00Z',
      };

      expect(jobData.signalMetadata).toBeUndefined();
    });
  });

  describe('AgentTaskJobName type (runtime validation)', () => {
    it('accepts all valid job name values', () => {
      const names: AgentTaskJobName[] = [
        'agent:start',
        'agent:heartbeat',
        'agent:cron',
        'agent:signal',
      ];

      expect(names).toHaveLength(4);
      expect(names).toContain('agent:start');
      expect(names).toContain('agent:heartbeat');
      expect(names).toContain('agent:cron');
      expect(names).toContain('agent:signal');
    });
  });
});
