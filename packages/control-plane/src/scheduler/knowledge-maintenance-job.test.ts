import { describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';

import {
  DEFAULT_MAINTENANCE_CRON,
  KNOWLEDGE_MAINTENANCE_JOB_NAME,
  KNOWLEDGE_MAINTENANCE_QUEUE,
  registerMaintenanceSchedule,
} from './knowledge-maintenance-job.js';

describe('knowledge-maintenance-job constants', () => {
  it('has expected queue name', () => {
    expect(KNOWLEDGE_MAINTENANCE_QUEUE).toBe('knowledge-maintenance');
  });

  it('has expected job name', () => {
    expect(KNOWLEDGE_MAINTENANCE_JOB_NAME).toBe('maintenance:run');
  });

  it('has a monthly cron expression', () => {
    expect(DEFAULT_MAINTENANCE_CRON).toBe('0 3 1 * *');
  });
});

describe('registerMaintenanceSchedule', () => {
  it('adds a repeatable job to the queue', async () => {
    const logger = createMockLogger();
    const mockQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };

    await registerMaintenanceSchedule(mockQueue as never, DEFAULT_MAINTENANCE_CRON, logger);

    expect(mockQueue.add).toHaveBeenCalledWith(
      KNOWLEDGE_MAINTENANCE_JOB_NAME,
      expect.objectContaining({
        triggeredAt: expect.any(String),
      }),
      expect.objectContaining({
        repeat: {
          pattern: DEFAULT_MAINTENANCE_CRON,
          key: 'knowledge-maintenance:monthly',
        },
      }),
    );
  });

  it('logs error when queue.add fails', async () => {
    const logger = createMockLogger();
    const mockQueue = {
      add: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
    };

    // Should not throw
    await registerMaintenanceSchedule(mockQueue as never, DEFAULT_MAINTENANCE_CRON, logger);

    expect(logger.error).toHaveBeenCalled();
  });
});
