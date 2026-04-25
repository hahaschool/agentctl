import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';
import pg from 'pg';
import type { Logger } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { embeddingBackfillHandler } from './embedding-backfill.js';
import { JobEventsRepository } from './job-events-repository.js';
import { JobsRepository } from './jobs-repository.js';

const DATABASE_URL = process.env.DATABASE_URL;
const MACHINE_ID = 'memory-ops-e2e';

const logger = {
  warn: vi.fn(),
} as unknown as Logger;

function makeVector(seed: number): number[] {
  return Array.from({ length: 1536 }, (_unused, index) => (index === 0 ? seed : 0.001));
}

describe.skipIf(!DATABASE_URL)('memory ops workers integration', () => {
  let pool: Pool;
  const factIds: string[] = [];
  const jobIds: string[] = [];

  beforeAll(() => {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for memory ops worker integration tests');
    }
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterEach(async () => {
    if (jobIds.length > 0) {
      await pool.query('DELETE FROM memory_ops_jobs WHERE id = ANY($1::uuid[])', [jobIds]);
      jobIds.length = 0;
    }
    if (factIds.length > 0) {
      await pool.query('DELETE FROM memory_facts WHERE id = ANY($1::text[])', [factIds]);
      factIds.length = 0;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('runs embedding-backfill through real repositories and writes embeddings', async () => {
    const jobsRepository = new JobsRepository(pool);
    const eventsRepository = new JobEventsRepository(pool);
    const resolvedClient = {
      model: 'gemini-embedding-001',
      priceUsdPerMtoken: 0.5,
      client: {
        embedBatchWithUsage: vi.fn(async (texts: string[]) => ({
          vectors: texts.map((_text, index) => makeVector(index + 1)),
          usage: { promptTokens: texts.length * 100 },
          model: 'gemini-embedding-001',
        })),
      },
    };

    for (const content of ['alpha memory fact', 'beta memory fact']) {
      const id = `memory-ops-e2e-${randomUUID()}`;
      factIds.push(id);
      await pool.query(
        `INSERT INTO memory_facts (id, scope, content, content_model, entity_type, embedding)
         VALUES ($1, 'global', $2, 'legacy-model', 'fact', NULL)`,
        [id, content],
      );
    }

    const job = await jobsRepository.insert({
      kind: 'embedding-backfill',
      params: { batchSize: 10, scope: 'global' },
      originMachineId: MACHINE_ID,
      executorMachineId: MACHINE_ID,
      providerKind: 'gemini',
      providerModel: 'gemini-embedding-001',
      providerHost: 'https://generativelanguage.googleapis.com',
      priceUsdPerMtoken: '0.02',
    });
    jobIds.push(job.id);

    await embeddingBackfillHandler({
      jobId: job.id,
      params: job.params,
      logger,
      pool,
      resolvedClient,
      priceUsdPerMtoken: job.priceUsdPerMtoken,
      jobsRepository,
      eventsRepository,
    });

    const facts = await pool.query<{ content_model: string; has_embedding: boolean }>(
      `SELECT content_model, embedding IS NOT NULL AS has_embedding
         FROM memory_facts
        WHERE id = ANY($1::text[])
        ORDER BY id`,
      [factIds],
    );
    expect(facts.rows).toHaveLength(2);
    expect(facts.rows.every((row) => row.content_model === 'gemini-embedding-001')).toBe(true);
    expect(facts.rows.every((row) => row.has_embedding)).toBe(true);

    const updatedJob = await jobsRepository.findById(job.id);
    expect(updatedJob).toMatchObject({
      status: 'completed',
      result: expect.objectContaining({ embedded: 2, failed: 0 }),
    });
  });
});
