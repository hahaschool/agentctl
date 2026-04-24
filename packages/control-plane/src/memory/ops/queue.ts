import type { MemoryOpsJobKind } from '@agentctl/shared';
import { type ConnectionOptions, Queue, type QueueOptions } from 'bullmq';

export const MEMORY_OPS_QUEUE = 'memory-ops';

export type MemoryOpsQueueData = {
  dbJobId: string;
};

export type MemoryOpsQueueName = MemoryOpsJobKind;
export type MemoryOpsQueue = Queue<MemoryOpsQueueData, void, MemoryOpsQueueName>;

let queue: MemoryOpsQueue | null = null;

export function initMemoryOpsQueue(connection: ConnectionOptions): MemoryOpsQueue {
  if (!queue) {
    const opts: QueueOptions = {
      connection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    };
    queue = new Queue<MemoryOpsQueueData, void, MemoryOpsQueueName>(MEMORY_OPS_QUEUE, opts);
  }
  return queue;
}

export function getMemoryOpsQueue(connection?: ConnectionOptions): MemoryOpsQueue {
  if (queue) {
    return queue;
  }
  if (!connection) {
    throw new Error('Memory operations queue has not been initialised');
  }
  return initMemoryOpsQueue(connection);
}

export async function resetMemoryOpsQueueForTesting(): Promise<void> {
  if (!queue) {
    return;
  }
  await queue.close();
  queue = null;
}
