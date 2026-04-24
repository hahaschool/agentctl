import type { ConnectionOptions } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

const bullmqMocks = vi.hoisted(() => ({
  Queue: vi.fn(),
  close: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: bullmqMocks.Queue,
}));

describe('memory ops queue singleton', () => {
  afterEach(async () => {
    bullmqMocks.Queue.mockReset();
    bullmqMocks.close.mockReset();
    vi.resetModules();
  });

  it('initializes a singleton queue with the memory-ops queue name', async () => {
    bullmqMocks.Queue.mockImplementation((name: string, options: object) => ({
      name,
      options,
      close: bullmqMocks.close,
    }));

    const { initMemoryOpsQueue, getMemoryOpsQueue } = await import('./queue.js');
    const connection = { host: 'localhost', port: 6379 } satisfies ConnectionOptions;

    const queueA = initMemoryOpsQueue(connection);
    const queueB = getMemoryOpsQueue();

    expect(queueA).toBe(queueB);
    expect(bullmqMocks.Queue).toHaveBeenCalledWith(
      'memory-ops',
      expect.objectContaining({
        connection,
        defaultJobOptions: expect.objectContaining({
          removeOnComplete: expect.anything(),
          removeOnFail: expect.anything(),
        }),
      }),
    );
  });

  it('closes and clears the singleton during test reset', async () => {
    bullmqMocks.Queue.mockImplementation(() => ({
      close: bullmqMocks.close,
    }));

    const { initMemoryOpsQueue, resetMemoryOpsQueueForTesting } = await import('./queue.js');
    initMemoryOpsQueue({ host: 'localhost', port: 6379 } satisfies ConnectionOptions);

    await resetMemoryOpsQueueForTesting();

    expect(bullmqMocks.close).toHaveBeenCalledTimes(1);
  });
});
