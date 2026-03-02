import type { ControlPlaneError } from '@agentctl/shared';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepeatableJobManager, type RepeatableJobManager } from './repeatable-jobs.js';
import type { AgentTaskJobData, AgentTaskJobName } from './task-queue.js';

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

function makeJobData(overrides: Partial<AgentTaskJobData> = {}): AgentTaskJobData {
  return {
    agentId: 'agent-1',
    machineId: 'machine-1',
    prompt: null,
    model: null,
    trigger: 'heartbeat',
    allowedTools: null,
    resumeSession: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

type MockQueue = {
  add: ReturnType<typeof vi.fn>;
  getRepeatableJobs: ReturnType<typeof vi.fn>;
  removeRepeatableByKey: ReturnType<typeof vi.fn>;
};

function makeMockQueue(
  overrides: Partial<MockQueue> = {},
): Queue<AgentTaskJobData, void, AgentTaskJobName> {
  return {
    add: vi.fn().mockResolvedValue(undefined),
    getRepeatableJobs: vi.fn().mockResolvedValue([]),
    removeRepeatableByKey: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Queue<AgentTaskJobData, void, AgentTaskJobName>;
}

describe('createRepeatableJobManager()', () => {
  let queue: ReturnType<typeof makeMockQueue>;
  let manager: RepeatableJobManager;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = makeMockQueue();
    manager = createRepeatableJobManager(queue, logger);
  });

  describe('addHeartbeatJob()', () => {
    it('calls queue.add with name "agent:heartbeat"', async () => {
      const jobData = makeJobData();
      await manager.addHeartbeatJob('agent-1', 30000, jobData);

      expect(queue.add).toHaveBeenCalledOnce();
      const [name] = (queue.add as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(name).toBe('agent:heartbeat');
    });

    it('passes the job data as the second argument', async () => {
      const jobData = makeJobData({ agentId: 'agent-42', machineId: 'machine-99' });
      await manager.addHeartbeatJob('agent-42', 5000, jobData);

      const [, data] = (queue.add as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(data).toEqual(jobData);
    });

    it('sets repeat.every to the provided intervalMs', async () => {
      const jobData = makeJobData();
      await manager.addHeartbeatJob('agent-1', 60000, jobData);

      const [, , opts] = (queue.add as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(opts.repeat.every).toBe(60000);
    });

    it('sets repeat.key to "heartbeat:<agentId>"', async () => {
      const jobData = makeJobData();
      await manager.addHeartbeatJob('agent-1', 30000, jobData);

      const [, , opts] = (queue.add as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(opts.repeat.key).toBe('heartbeat:agent-1');
    });

    it('sets jobId to the same key as repeat.key', async () => {
      const jobData = makeJobData();
      await manager.addHeartbeatJob('agent-1', 30000, jobData);

      const [, , opts] = (queue.add as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(opts.jobId).toBe(opts.repeat.key);
    });

    it('logs info after a successful add', async () => {
      const infoSpy = vi.spyOn(logger, 'info');
      const jobData = makeJobData();
      await manager.addHeartbeatJob('agent-1', 30000, jobData);

      expect(infoSpy).toHaveBeenCalledOnce();
      const [context, message] = infoSpy.mock.calls[0];
      expect((context as Record<string, unknown>).agentId).toBe('agent-1');
      expect((context as Record<string, unknown>).intervalMs).toBe(30000);
      expect(typeof message).toBe('string');
    });

    it('throws ControlPlaneError with code HEARTBEAT_JOB_ADD_FAILED when queue.add rejects', async () => {
      (queue.add as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Redis connection refused'),
      );

      await expect(manager.addHeartbeatJob('agent-1', 30000, makeJobData())).rejects.toMatchObject({
        name: 'ControlPlaneError',
        code: 'HEARTBEAT_JOB_ADD_FAILED',
      });
    });

    it('includes agentId in the ControlPlaneError context on failure', async () => {
      (queue.add as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));

      let thrown: ControlPlaneError | null = null;
      try {
        await manager.addHeartbeatJob('agent-77', 1000, makeJobData());
      } catch (err) {
        thrown = err as ControlPlaneError;
      }

      expect(thrown).not.toBeNull();
      expect(thrown?.context?.agentId).toBe('agent-77');
    });
  });

  describe('addCronJob()', () => {
    it('calls queue.add with name "agent:cron"', async () => {
      const jobData = makeJobData({ trigger: 'schedule' });
      await manager.addCronJob('agent-1', '0 * * * *', jobData);

      expect(queue.add).toHaveBeenCalledOnce();
      const [name] = (queue.add as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(name).toBe('agent:cron');
    });

    it('passes the job data as the second argument', async () => {
      const jobData = makeJobData({ agentId: 'agent-5', trigger: 'schedule' });
      await manager.addCronJob('agent-5', '*/15 * * * *', jobData);

      const [, data] = (queue.add as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(data).toEqual(jobData);
    });

    it('sets repeat.pattern to the provided cron expression', async () => {
      const cronExpression = '0 9 * * 1-5';
      await manager.addCronJob('agent-1', cronExpression, makeJobData());

      const [, , opts] = (queue.add as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(opts.repeat.pattern).toBe(cronExpression);
    });

    it('sets repeat.key to "cron:<agentId>"', async () => {
      await manager.addCronJob('agent-2', '0 0 * * *', makeJobData());

      const [, , opts] = (queue.add as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(opts.repeat.key).toBe('cron:agent-2');
    });

    it('sets jobId to the same key as repeat.key', async () => {
      await manager.addCronJob('agent-2', '0 0 * * *', makeJobData());

      const [, , opts] = (queue.add as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(opts.jobId).toBe(opts.repeat.key);
    });

    it('logs info after a successful add', async () => {
      const infoSpy = vi.spyOn(logger, 'info');
      await manager.addCronJob('agent-1', '*/5 * * * *', makeJobData());

      expect(infoSpy).toHaveBeenCalledOnce();
      const [context] = infoSpy.mock.calls[0];
      expect((context as Record<string, unknown>).agentId).toBe('agent-1');
      expect((context as Record<string, unknown>).cronExpression).toBe('*/5 * * * *');
    });

    it('throws ControlPlaneError with code CRON_JOB_ADD_FAILED when queue.add rejects', async () => {
      (queue.add as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('queue full'));

      await expect(manager.addCronJob('agent-1', '* * * * *', makeJobData())).rejects.toMatchObject(
        {
          name: 'ControlPlaneError',
          code: 'CRON_JOB_ADD_FAILED',
        },
      );
    });

    it('includes agentId and cronExpression in the ControlPlaneError context on failure', async () => {
      (queue.add as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

      let thrown: ControlPlaneError | null = null;
      try {
        await manager.addCronJob('agent-3', '0 12 * * *', makeJobData());
      } catch (err) {
        thrown = err as ControlPlaneError;
      }

      expect(thrown).not.toBeNull();
      expect(thrown?.context?.agentId).toBe('agent-3');
      expect(thrown?.context?.cronExpression).toBe('0 12 * * *');
    });
  });

  describe('listRepeatableJobs()', () => {
    it('calls queue.getRepeatableJobs() once', async () => {
      await manager.listRepeatableJobs();
      expect(queue.getRepeatableJobs).toHaveBeenCalledOnce();
    });

    it('returns an empty array when there are no repeatable jobs', async () => {
      const result = await manager.listRepeatableJobs();
      expect(result).toEqual([]);
    });

    it('maps BullMQ repeatable job fields to RepeatableJobInfo shape', async () => {
      (queue.getRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          key: 'heartbeat:agent-1',
          name: 'agent:heartbeat',
          pattern: null,
          every: 30000,
          next: 1700000000000,
        },
        {
          key: 'cron:agent-2',
          name: 'agent:cron',
          pattern: '0 * * * *',
          every: null,
          next: 1700003600000,
        },
      ]);

      const result = await manager.listRepeatableJobs();

      expect(result).toHaveLength(2);

      expect(result[0]).toEqual({
        key: 'heartbeat:agent-1',
        name: 'agent:heartbeat',
        pattern: null,
        every: '30000',
        next: 1700000000000,
      });

      expect(result[1]).toEqual({
        key: 'cron:agent-2',
        name: 'agent:cron',
        pattern: '0 * * * *',
        every: null,
        next: 1700003600000,
      });
    });

    it('converts numeric every to string in the mapped result', async () => {
      (queue.getRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          key: 'heartbeat:agent-5',
          name: 'agent:heartbeat',
          pattern: null,
          every: 5000,
          next: null,
        },
      ]);

      const result = await manager.listRepeatableJobs();
      expect(result[0].every).toBe('5000');
    });

    it('maps missing next and pattern to null', async () => {
      (queue.getRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          key: 'heartbeat:agent-6',
          name: 'agent:heartbeat',
          pattern: undefined,
          every: undefined,
          next: undefined,
        },
      ]);

      const result = await manager.listRepeatableJobs();
      expect(result[0].pattern).toBeNull();
      expect(result[0].every).toBeNull();
      expect(result[0].next).toBeNull();
    });

    it('throws ControlPlaneError with code REPEATABLE_JOB_LIST_FAILED when getRepeatableJobs rejects', async () => {
      (queue.getRepeatableJobs as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Redis error'),
      );

      await expect(manager.listRepeatableJobs()).rejects.toMatchObject({
        name: 'ControlPlaneError',
        code: 'REPEATABLE_JOB_LIST_FAILED',
      });
    });
  });

  describe('removeJobsByAgentId()', () => {
    it('calls queue.getRepeatableJobs() to discover existing jobs', async () => {
      await manager.removeJobsByAgentId('agent-1');
      expect(queue.getRepeatableJobs).toHaveBeenCalledOnce();
    });

    it('returns 0 when there are no repeatable jobs', async () => {
      const count = await manager.removeJobsByAgentId('agent-1');
      expect(count).toBe(0);
      expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
    });

    it('removes the heartbeat job for the given agentId', async () => {
      (queue.getRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          key: 'heartbeat:agent-1::30000',
          name: 'agent:heartbeat',
          pattern: null,
          every: 30000,
          next: null,
        },
      ]);

      const count = await manager.removeJobsByAgentId('agent-1');

      expect(queue.removeRepeatableByKey).toHaveBeenCalledOnce();
      expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('heartbeat:agent-1::30000');
      expect(count).toBe(1);
    });

    it('removes the cron job for the given agentId', async () => {
      (queue.getRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          key: 'cron:agent-2::0 * * * *',
          name: 'agent:cron',
          pattern: '0 * * * *',
          every: null,
          next: null,
        },
      ]);

      const count = await manager.removeJobsByAgentId('agent-2');

      expect(queue.removeRepeatableByKey).toHaveBeenCalledOnce();
      expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('cron:agent-2::0 * * * *');
      expect(count).toBe(1);
    });

    it('removes both heartbeat and cron jobs when both exist for the same agentId', async () => {
      (queue.getRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          key: 'heartbeat:agent-3::60000',
          name: 'agent:heartbeat',
          pattern: null,
          every: 60000,
          next: null,
        },
        {
          key: 'cron:agent-3::0 0 * * *',
          name: 'agent:cron',
          pattern: '0 0 * * *',
          every: null,
          next: null,
        },
      ]);

      const count = await manager.removeJobsByAgentId('agent-3');

      expect(queue.removeRepeatableByKey).toHaveBeenCalledTimes(2);
      expect(count).toBe(2);
    });

    it('does not remove jobs belonging to a different agentId', async () => {
      (queue.getRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          key: 'heartbeat:agent-99::30000',
          name: 'agent:heartbeat',
          pattern: null,
          every: 30000,
          next: null,
        },
        {
          key: 'cron:agent-99::0 * * * *',
          name: 'agent:cron',
          pattern: '0 * * * *',
          every: null,
          next: null,
        },
      ]);

      const count = await manager.removeJobsByAgentId('agent-1');

      expect(queue.removeRepeatableByKey).not.toHaveBeenCalled();
      expect(count).toBe(0);
    });

    it('only removes jobs matching the target agentId when multiple agents have jobs', async () => {
      (queue.getRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          key: 'heartbeat:agent-1::30000',
          name: 'agent:heartbeat',
          pattern: null,
          every: 30000,
          next: null,
        },
        {
          key: 'heartbeat:agent-2::30000',
          name: 'agent:heartbeat',
          pattern: null,
          every: 30000,
          next: null,
        },
        {
          key: 'cron:agent-1::0 * * * *',
          name: 'agent:cron',
          pattern: '0 * * * *',
          every: null,
          next: null,
        },
      ]);

      const count = await manager.removeJobsByAgentId('agent-1');

      expect(queue.removeRepeatableByKey).toHaveBeenCalledTimes(2);
      expect(count).toBe(2);

      const removedKeys = (queue.removeRepeatableByKey as ReturnType<typeof vi.fn>).mock.calls.map(
        (call: unknown[]) => call[0] as string,
      );
      expect(removedKeys).toContain('heartbeat:agent-1::30000');
      expect(removedKeys).toContain('cron:agent-1::0 * * * *');
      expect(removedKeys).not.toContain('heartbeat:agent-2::30000');
    });

    it('logs info for each removed job', async () => {
      const infoSpy = vi.spyOn(logger, 'info');

      (queue.getRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          key: 'heartbeat:agent-1::30000',
          name: 'agent:heartbeat',
          pattern: null,
          every: 30000,
          next: null,
        },
        {
          key: 'cron:agent-1::0 * * * *',
          name: 'agent:cron',
          pattern: '0 * * * *',
          every: null,
          next: null,
        },
      ]);

      await manager.removeJobsByAgentId('agent-1');

      expect(infoSpy).toHaveBeenCalledTimes(2);
    });

    it('throws ControlPlaneError with code REPEATABLE_JOB_REMOVE_FAILED when getRepeatableJobs rejects', async () => {
      (queue.getRepeatableJobs as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Redis gone'),
      );

      await expect(manager.removeJobsByAgentId('agent-1')).rejects.toMatchObject({
        name: 'ControlPlaneError',
        code: 'REPEATABLE_JOB_REMOVE_FAILED',
      });
    });

    it('throws ControlPlaneError with code REPEATABLE_JOB_REMOVE_FAILED when removeRepeatableByKey rejects', async () => {
      (queue.getRepeatableJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          key: 'heartbeat:agent-1::30000',
          name: 'agent:heartbeat',
          pattern: null,
          every: 30000,
          next: null,
        },
      ]);
      (queue.removeRepeatableByKey as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('remove failed'),
      );

      await expect(manager.removeJobsByAgentId('agent-1')).rejects.toMatchObject({
        name: 'ControlPlaneError',
        code: 'REPEATABLE_JOB_REMOVE_FAILED',
      });
    });

    it('includes agentId in the ControlPlaneError context on failure', async () => {
      (queue.getRepeatableJobs as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

      let thrown: ControlPlaneError | null = null;
      try {
        await manager.removeJobsByAgentId('agent-boom');
      } catch (err) {
        thrown = err as ControlPlaneError;
      }

      expect(thrown).not.toBeNull();
      expect(thrown?.context?.agentId).toBe('agent-boom');
    });
  });
});
