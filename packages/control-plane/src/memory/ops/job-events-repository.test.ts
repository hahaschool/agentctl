import { describe, expect, it, vi } from 'vitest';

import { JobEventsRepository } from './job-events-repository.js';

function createMockPool() {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO memory_ops_job_events')) {
        return {
          rows: [
            {
              event_id: '7',
              job_id: 'job-1',
              event_type: 'progress',
              level: 'info',
              message: 'halfway',
              progress: {
                processed: 5,
                embedded: 5,
                failed: 0,
                total: 10,
                costUsd: 0,
                usageEstimated: true,
              },
              payload: { batch: 1 },
              created_at: new Date('2026-04-25T00:00:00Z'),
            },
          ],
        };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    client,
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn(async () => ({ rows: [] })),
  };
}

describe('JobEventsRepository', () => {
  it('inserts event rows and notifies SSE listeners in the same transaction', async () => {
    const pool = createMockPool();
    const repo = new JobEventsRepository(pool as never);

    const event = await repo.insert({
      jobId: 'job-1',
      eventType: 'progress',
      level: 'info',
      message: 'halfway',
      progress: {
        processed: 5,
        embedded: 5,
        failed: 0,
        total: 10,
        costUsd: 0,
        usageEstimated: true,
      },
      payload: { batch: 1 },
    });

    expect(event.eventId).toBe('7');
    expect(pool.client.query).toHaveBeenCalledWith('BEGIN');
    expect(pool.client.query).toHaveBeenCalledWith("SELECT pg_notify('memory_ops_events', $1)", [
      'job-1',
    ]);
    expect(pool.client.query).toHaveBeenCalledWith('COMMIT');
  });
});
