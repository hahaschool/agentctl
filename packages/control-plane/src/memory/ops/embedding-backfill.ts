import { ControlPlaneError, type MemoryOpsProgress, scopeNormalize } from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { ResolvedEmbeddingClient } from '../embedding-client-factory.js';
import { readMemoryOpsConfig } from './config.js';
import { CostTracker } from './cost-tracker.js';
import type { JobEventsRepository } from './job-events-repository.js';
import type { JobsRepository } from './jobs-repository.js';

export type EmbeddingBackfillParams = {
  batchSize?: number;
  dryRun?: boolean;
  scope?: string;
};

export type EmbeddingBackfillInput = {
  jobId: string;
  params?: Record<string, unknown>;
  logger: Logger;
  pool: Pool;
  resolvedClient: Pick<ResolvedEmbeddingClient, 'client' | 'model' | 'priceUsdPerMtoken'>;
  priceUsdPerMtoken?: number | string | null;
  jobsRepository: Pick<JobsRepository, 'isCancelRequested' | 'transition'>;
  eventsRepository: Pick<JobEventsRepository, 'insert'>;
};

type FactBatchRow = {
  id: string;
  content: string;
};

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;

export async function embeddingBackfillHandler(input: EmbeddingBackfillInput): Promise<void> {
  const params = parseParams(input.params);
  const scope = scopeNormalize(params.scope);
  const batchSize = clampBatchSize(params.batchSize, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
  const maxFailRatio = readMemoryOpsConfig().maxFailRatio;
  const costTracker = new CostTracker({
    priceUsdPerMtoken:
      parsePrice(input.priceUsdPerMtoken) ?? input.resolvedClient.priceUsdPerMtoken,
  });

  const total = await countEligibleFacts(input.pool, scope);
  let processed = 0;
  let embedded = 0;
  let failed = 0;
  const excludedIds = new Set<string>();

  while (processed < total) {
    const progress = buildProgress({ processed, embedded, failed, total, costTracker });
    if (await input.jobsRepository.isCancelRequested(input.jobId)) {
      await input.jobsRepository.transition(input.jobId, 'cancelled', { progress });
      await input.eventsRepository.insert({
        jobId: input.jobId,
        eventType: 'cancelled',
        level: 'info',
        message: 'Cancelled by request',
        progress,
      });
      return;
    }

    const batch = await selectFactBatch(input.pool, scope, [...excludedIds], batchSize);
    if (batch.length === 0) {
      break;
    }

    if (params.dryRun) {
      costTracker.addEstimated(totalChars(batch));
      embedded += batch.length;
      processed += batch.length;
      for (const fact of batch) excludedIds.add(fact.id);
      await emitProgress(input, buildProgress({ processed, embedded, failed, total, costTracker }));
      continue;
    }

    let vectors: number[][];
    try {
      const result = await input.resolvedClient.client.embedBatchWithUsage(
        batch.map((row) => row.content),
      );
      vectors = result.vectors;
      if (result.usage.promptTokens > 0) {
        costTracker.add(result.usage);
      } else {
        costTracker.addEstimated(totalChars(batch));
      }
    } catch (error) {
      input.logger.warn({ jobId: input.jobId, err: error }, 'Embedding backfill batch failed');
      failed += batch.length;
      for (const fact of batch) excludedIds.add(fact.id);
      processed += batch.length;
      const failedProgress = buildProgress({ processed, embedded, failed, total, costTracker });
      if (exceedsFailRatio(failed, total, maxFailRatio)) {
        await failJob(input, failedProgress, maxFailRatio);
        return;
      }
      await emitProgress(input, failedProgress);
      continue;
    }

    for (let index = 0; index < batch.length; index += 1) {
      const fact = batch[index];
      const vector = vectors[index];
      if (!fact || !vector) {
        failed += 1;
        if (fact) excludedIds.add(fact.id);
        continue;
      }

      try {
        await input.pool.query(
          `UPDATE memory_facts
              SET embedding = $1::vector,
                  content_model = $2,
                  embedding_version = 1
            WHERE id = $3
              AND embedding IS NULL
              AND valid_until IS NULL`,
          [toPgVector(vector), input.resolvedClient.model, fact.id],
        );
        embedded += 1;
      } catch (error) {
        input.logger.warn(
          { jobId: input.jobId, factId: fact.id, err: error },
          'Fact update failed',
        );
        failed += 1;
        excludedIds.add(fact.id);
      }
    }

    processed += batch.length;
    const batchProgress = buildProgress({ processed, embedded, failed, total, costTracker });
    if (exceedsFailRatio(failed, total, maxFailRatio)) {
      await failJob(input, batchProgress, maxFailRatio);
      return;
    }
    await emitProgress(input, batchProgress);
  }

  const finalProgress = buildProgress({ processed, embedded, failed, total, costTracker });
  if (exceedsFailRatio(failed, total, maxFailRatio)) {
    await failJob(input, finalProgress, maxFailRatio);
    return;
  }

  await input.jobsRepository.transition(input.jobId, 'completed', {
    progress: finalProgress,
    result: {
      processed,
      embedded,
      failed,
      dryRun: params.dryRun,
      costUsd: costTracker.totalCostUsd,
      usageEstimated: costTracker.usageEstimated,
    },
  });
  await input.eventsRepository.insert({
    jobId: input.jobId,
    eventType: 'completed',
    level: 'info',
    message: `Completed embedding-backfill: ${embedded}/${total} facts`,
    progress: finalProgress,
  });
}

function parseParams(
  params: Record<string, unknown> | undefined,
): Required<EmbeddingBackfillParams> {
  return {
    batchSize: typeof params?.batchSize === 'number' ? params.batchSize : DEFAULT_BATCH_SIZE,
    dryRun: params?.dryRun === true,
    scope: typeof params?.scope === 'string' ? params.scope : '',
  };
}

function clampBatchSize(value: number, fallback: number, max: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value), max)) : fallback;
}

async function countEligibleFacts(pool: Pool, scope: string): Promise<number> {
  const result = await pool.query<{ count: number | string }>(
    `SELECT COUNT(*)::int AS count
       FROM memory_facts
      WHERE embedding IS NULL
        AND valid_until IS NULL
        AND ($1::text = '' OR LOWER(scope) = $1)`,
    [scope],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function selectFactBatch(
  pool: Pool,
  scope: string,
  excludedIds: string[],
  batchSize: number,
): Promise<FactBatchRow[]> {
  const result = await pool.query<FactBatchRow>(
    `SELECT id, content
       FROM memory_facts
      WHERE embedding IS NULL
        AND valid_until IS NULL
        AND ($1::text = '' OR LOWER(scope) = $1)
        AND NOT (id = ANY($2::text[]))
      ORDER BY created_at, id
      LIMIT $3`,
    [scope, excludedIds, batchSize],
  );
  return result.rows;
}

async function emitProgress(
  input: EmbeddingBackfillInput,
  progress: MemoryOpsProgress,
): Promise<void> {
  await input.jobsRepository.transition(input.jobId, 'running', { progress });
  await input.eventsRepository.insert({
    jobId: input.jobId,
    eventType: 'progress',
    level: 'info',
    progress,
  });
}

async function failJob(
  input: EmbeddingBackfillInput,
  progress: MemoryOpsProgress,
  maxFailRatio: number,
): Promise<void> {
  const message = `Fail ratio exceeded memory ops limit ${maxFailRatio}`;
  await input.jobsRepository.transition(input.jobId, 'failed', {
    progress,
    error: message,
    errorCode: 'MEMORY_OPS_FAIL_RATIO_EXCEEDED',
  });
  await input.eventsRepository.insert({
    jobId: input.jobId,
    eventType: 'failed',
    level: 'error',
    message,
    progress,
  });
}

function buildProgress(input: {
  processed: number;
  embedded: number;
  failed: number;
  total: number;
  costTracker: CostTracker;
}): MemoryOpsProgress {
  return {
    processed: input.processed,
    embedded: input.embedded,
    failed: input.failed,
    total: input.total,
    costUsd: input.costTracker.totalCostUsd,
    usageEstimated: input.costTracker.usageEstimated,
  };
}

function exceedsFailRatio(failed: number, total: number, maxFailRatio: number): boolean {
  return total > 0 && failed / total > maxFailRatio;
}

function totalChars(batch: readonly FactBatchRow[]): number {
  return batch.reduce((sum, row) => sum + row.content.length, 0);
}

function parsePrice(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function toPgVector(vector: readonly number[]): string {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new ControlPlaneError('EMBEDDING_INVALID_VECTOR', 'Embedding vector is invalid');
  }
  return `[${vector.join(',')}]`;
}
