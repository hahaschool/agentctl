import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { embeddingBackfillHandler } from './embedding-backfill.js';

const logger = {
  warn: vi.fn(),
} as unknown as Logger;

function makeRepos(cancelRequested = false) {
  return {
    jobsRepository: {
      isCancelRequested: vi.fn().mockResolvedValue(cancelRequested),
      transition: vi.fn().mockResolvedValue({}),
    },
    eventsRepository: {
      insert: vi.fn().mockResolvedValue({}),
    },
  };
}

function makePool(rows: Array<{ id: string; content: string }>): Pool {
  let selected = false;
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('COUNT(*)::int')) {
        return { rows: [{ count: rows.length }] };
      }
      if (sql.includes('SELECT id, content')) {
        if (selected) return { rows: [] };
        selected = true;
        return { rows };
      }
      if (sql.includes('UPDATE memory_facts')) {
        return { rows: [], rowCount: 1, params };
      }
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as Pool;
}

function makeResolvedClient() {
  return {
    model: 'gemini-embedding-001',
    priceUsdPerMtoken: 0.5,
    client: {
      embedBatchWithUsage: vi.fn().mockResolvedValue({
        vectors: [Array.from({ length: 1536 }, () => 0.01)],
        usage: { promptTokens: 1000 },
        model: 'gemini-embedding-001',
      }),
    },
  };
}

describe('embeddingBackfillHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MEMORY_OPS_MAX_FAIL_RATIO;
  });

  it('writes embeddings and the resolved model to memory_facts', async () => {
    const pool = makePool([{ id: 'fact-1', content: 'hello world' }]);
    const resolvedClient = makeResolvedClient();
    const { jobsRepository, eventsRepository } = makeRepos();

    await embeddingBackfillHandler({
      jobId: 'job-1',
      params: { batchSize: 10 },
      logger,
      pool,
      resolvedClient,
      priceUsdPerMtoken: '0.02',
      jobsRepository,
      eventsRepository,
    });

    const updateCall = vi
      .mocked(pool.query)
      .mock.calls.find((call) => String(call[0]).includes('UPDATE memory_facts'));
    expect(updateCall?.[1]).toEqual(expect.arrayContaining(['gemini-embedding-001', 'fact-1']));
    expect(jobsRepository.transition).toHaveBeenCalledWith(
      'job-1',
      'completed',
      expect.objectContaining({ result: expect.objectContaining({ embedded: 1 }) }),
    );
    const completedCall = jobsRepository.transition.mock.calls.find(
      (call) => call[1] === 'completed',
    );
    const completedPayload = completedCall?.[2] as { result?: { costUsd?: number } } | undefined;
    expect(completedPayload?.result?.costUsd).toBeCloseTo(0.00002);
    expect(eventsRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'completed' }),
    );
  });

  it('cancels before processing a batch when cancel is requested', async () => {
    const pool = makePool([{ id: 'fact-1', content: 'hello world' }]);
    const resolvedClient = makeResolvedClient();
    const { jobsRepository, eventsRepository } = makeRepos(true);

    await embeddingBackfillHandler({
      jobId: 'job-1',
      params: {},
      logger,
      pool,
      resolvedClient,
      jobsRepository,
      eventsRepository,
    });

    expect(resolvedClient.client.embedBatchWithUsage).not.toHaveBeenCalled();
    expect(jobsRepository.transition).toHaveBeenCalledWith(
      'job-1',
      'cancelled',
      expect.objectContaining({ progress: expect.objectContaining({ processed: 0 }) }),
    );
  });

  it('fails the job when the failed row ratio exceeds the configured maximum', async () => {
    process.env.MEMORY_OPS_MAX_FAIL_RATIO = '0.05';
    const pool = makePool([
      { id: 'fact-1', content: 'hello' },
      { id: 'fact-2', content: 'world' },
    ]);
    const resolvedClient = makeResolvedClient();
    resolvedClient.client.embedBatchWithUsage.mockRejectedValue(new Error('upstream down'));
    const { jobsRepository, eventsRepository } = makeRepos();

    await embeddingBackfillHandler({
      jobId: 'job-1',
      params: { batchSize: 2 },
      logger,
      pool,
      resolvedClient,
      jobsRepository,
      eventsRepository,
    });

    expect(jobsRepository.transition).toHaveBeenCalledWith(
      'job-1',
      'failed',
      expect.objectContaining({ errorCode: 'MEMORY_OPS_FAIL_RATIO_EXCEEDED' }),
    );
    expect(eventsRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'failed' }),
    );
  });
});
