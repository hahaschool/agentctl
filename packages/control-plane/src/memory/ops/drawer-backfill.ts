import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  ControlPlaneError,
  MEMORY_EMBEDDING_VERSION,
  type MemoryDrawerSourceType,
  type MemoryOpsProgress,
  type MemoryScope,
  sanitizeName,
  scopeNormalize,
} from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

import type { ResolvedEmbeddingClient } from '../embedding-client-factory.js';
import { chunkMemoryDrawerContent } from '../memory-drawer-chunker.js';
import {
  hashMemoryDrawerContent,
  sanitizeMemoryDrawerContent,
} from '../memory-drawer-sanitizer.js';
import { readMemoryOpsConfig } from './config.js';
import { CostTracker } from './cost-tracker.js';
import type { JobEventsRepository } from './job-events-repository.js';
import type { JobsRepository } from './jobs-repository.js';

export type DrawerBackfillParams = {
  batchSize?: number;
  dryRun?: boolean;
  scope?: string;
  sourceRoot?: string;
  sourceType?: 'session-jsonl' | 'claude-mem';
  topic?: string;
};

export type DrawerBackfillInput = {
  jobId: string;
  params?: Record<string, unknown>;
  logger: Logger;
  pool: Pool;
  resolvedClient: Pick<ResolvedEmbeddingClient, 'client' | 'model' | 'priceUsdPerMtoken'>;
  priceUsdPerMtoken?: number | string | null;
  jobsRepository: Pick<JobsRepository, 'isCancelRequested' | 'transition'>;
  eventsRepository: Pick<JobEventsRepository, 'insert'>;
};

type SourceFile = {
  filePath: string;
  relativePath: string;
  size: number;
};

type ChunkToWrite = {
  content: string;
  contentSha256: string;
  sourceId: string;
  sourceUri: string;
  chunkIndex: number;
  sourceJson: Record<string, unknown>;
  redactionStatus: string;
  tokenCount: number;
};

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.css',
  '.go',
  '.h',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsonl',
  '.jsx',
  '.md',
  '.mdx',
  '.py',
  '.rs',
  '.swift',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

export async function drawerBackfillHandler(input: DrawerBackfillInput): Promise<void> {
  const params = parseParams(input.params);
  const sourceRoot = validateSourceRoot(params.sourceRoot);
  const files = collectSourceFiles(sourceRoot);
  const batchSize = clampBatchSize(params.batchSize, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
  const maxFailRatio = readMemoryOpsConfig().maxFailRatio;
  const costTracker = new CostTracker({
    priceUsdPerMtoken:
      parsePrice(input.priceUsdPerMtoken) ?? input.resolvedClient.priceUsdPerMtoken,
  });

  let processed = 0;
  let embedded = 0;
  let failed = 0;
  const total = files.length;
  const scope = sanitizeScope(params.scope);
  const sourceType = mapSourceType(params.sourceType);
  const topic = sanitizeName(params.topic || 'memory-ops');

  for (let offset = 0; offset < files.length; offset += batchSize) {
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

    const batch = files.slice(offset, offset + batchSize);
    const chunks: ChunkToWrite[] = [];
    for (const file of batch) {
      try {
        chunks.push(...readFileChunks(file, sourceRoot));
      } catch (error) {
        input.logger.warn(
          { jobId: input.jobId, filePath: file.filePath, err: error },
          'Drawer source file could not be read',
        );
        failed += 1;
      }
    }

    if (chunks.length === 0) {
      processed += batch.length;
      const emptyProgress = buildProgress({ processed, embedded, failed, total, costTracker });
      if (exceedsFailRatio(failed, total, maxFailRatio)) {
        await failJob(input, emptyProgress, maxFailRatio);
        return;
      }
      await emitProgress(input, emptyProgress);
      continue;
    }

    let vectors: number[][] = [];
    if (params.dryRun) {
      costTracker.addEstimated(chunks.reduce((sum, chunk) => sum + chunk.content.length, 0));
    } else {
      try {
        const result = await input.resolvedClient.client.embedBatchWithUsage(
          chunks.map((chunk) => chunk.content),
        );
        vectors = result.vectors;
        if (result.usage.promptTokens > 0) {
          costTracker.add(result.usage);
        } else {
          costTracker.addEstimated(chunks.reduce((sum, chunk) => sum + chunk.content.length, 0));
        }
      } catch (error) {
        input.logger.warn({ jobId: input.jobId, err: error }, 'Drawer backfill batch failed');
        failed += batch.length;
        processed += batch.length;
        const failedProgress = buildProgress({ processed, embedded, failed, total, costTracker });
        if (exceedsFailRatio(failed, total, maxFailRatio)) {
          await failJob(input, failedProgress, maxFailRatio);
          return;
        }
        await emitProgress(input, failedProgress);
        continue;
      }
    }

    if (params.dryRun) {
      embedded += chunks.length;
    } else {
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const vector = vectors[index];
        if (!chunk || !vector) {
          failed += 1;
          continue;
        }
        try {
          await insertDrawerChunk(input.pool, {
            chunk,
            scope,
            sourceType,
            topic,
            model: input.resolvedClient.model,
            vector,
          });
          embedded += 1;
        } catch (error) {
          input.logger.warn({ jobId: input.jobId, err: error }, 'Drawer chunk write failed');
          failed += 1;
        }
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
    message: `Completed drawer-backfill: ${embedded} chunks from ${processed} files`,
    progress: finalProgress,
  });
}

function parseParams(params: Record<string, unknown> | undefined): Required<DrawerBackfillParams> {
  return {
    batchSize: typeof params?.batchSize === 'number' ? params.batchSize : DEFAULT_BATCH_SIZE,
    dryRun: params?.dryRun === true,
    scope: typeof params?.scope === 'string' ? params.scope : 'global',
    sourceRoot: typeof params?.sourceRoot === 'string' ? params.sourceRoot : '',
    sourceType:
      params?.sourceType === 'session-jsonl' || params?.sourceType === 'claude-mem'
        ? params.sourceType
        : 'claude-mem',
    topic: typeof params?.topic === 'string' ? params.topic : 'memory-ops',
  };
}

function validateSourceRoot(sourceRoot: string): string {
  if (!sourceRoot) {
    throw new ControlPlaneError('VALIDATION_ERROR', 'drawer-backfill requires sourceRoot', {
      sourceRootViolation: true,
    });
  }

  const allowedRoots = readMemoryOpsConfig().drawerSourceRoots.map(resolveRealPath);
  if (allowedRoots.length === 0) {
    throw new ControlPlaneError(
      'VALIDATION_ERROR',
      'MEMORY_OPS_DRAWER_SOURCE_ROOTS is not configured',
      { sourceRootViolation: true },
    );
  }

  const resolvedSourceRoot = resolveRealPath(sourceRoot);
  if (!allowedRoots.some((root) => isWithinRoot(resolvedSourceRoot, root))) {
    throw new ControlPlaneError('VALIDATION_ERROR', 'sourceRoot is outside allowed paths', {
      sourceRootViolation: true,
    });
  }
  return resolvedSourceRoot;
}

function collectSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];
  const stack = [root];
  const visitedPaths = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      const resolved = resolveRealPath(current);
      if (!isWithinRoot(resolved, root)) {
        throw new ControlPlaneError('VALIDATION_ERROR', 'sourceRoot contains a symlink escape', {
          sourceRootViolation: true,
        });
      }
      if (visitedPaths.has(resolved)) {
        continue;
      }
      stack.push(resolved);
      continue;
    }

    if (stat.isDirectory()) {
      const resolvedDirectory = resolveRealPath(current);
      if (visitedPaths.has(resolvedDirectory)) {
        continue;
      }
      visitedPaths.add(resolvedDirectory);
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        stack.push(path.join(current, entry.name));
      }
      continue;
    }

    if (!stat.isFile() || !TEXT_EXTENSIONS.has(path.extname(current).toLowerCase())) {
      continue;
    }

    files.push({
      filePath: current,
      relativePath: path.relative(root, current),
      size: stat.size,
    });
  }

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function readFileChunks(file: SourceFile, sourceRoot: string): ChunkToWrite[] {
  const content = fs.readFileSync(file.filePath, 'utf8');
  const sanitized = sanitizeMemoryDrawerContent(content);
  return chunkMemoryDrawerContent(sanitized.content).map((chunk) => ({
    content: chunk.content,
    contentSha256: hashMemoryDrawerContent(chunk.content),
    sourceId: file.relativePath,
    sourceUri: file.filePath,
    chunkIndex: chunk.chunkIndex,
    sourceJson: {
      sourceRoot,
      relativePath: file.relativePath,
      size: file.size,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
    },
    redactionStatus: sanitized.redactionStatus,
    tokenCount: Math.ceil(chunk.content.length / 4),
  }));
}

async function insertDrawerChunk(
  pool: Pool,
  input: {
    chunk: ChunkToWrite;
    scope: MemoryScope;
    sourceType: MemoryDrawerSourceType;
    topic: string;
    model: string;
    vector: readonly number[];
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO memory_drawers (
       id, scope, topic, source_type, source_id, source_uri, chunk_index,
       content, content_sha256, embedding, embedding_model, embedding_version,
       token_count, source_json, sync_visibility, archived_at, redaction_status
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10::vector, $11, $12,
       $13, $14::jsonb, 'local', NULL, $15
     )
     ON CONFLICT (source_type, source_id, chunk_index)
     DO UPDATE SET
       scope = EXCLUDED.scope,
       topic = EXCLUDED.topic,
       source_uri = EXCLUDED.source_uri,
       content = EXCLUDED.content,
       content_sha256 = EXCLUDED.content_sha256,
       embedding = EXCLUDED.embedding,
       embedding_model = EXCLUDED.embedding_model,
       embedding_version = EXCLUDED.embedding_version,
       token_count = EXCLUDED.token_count,
       source_json = EXCLUDED.source_json,
       redaction_status = EXCLUDED.redaction_status,
       updated_at = now()`,
    [
      randomUUID(),
      input.scope,
      input.topic,
      input.sourceType,
      input.chunk.sourceId,
      input.chunk.sourceUri,
      input.chunk.chunkIndex,
      input.chunk.content,
      input.chunk.contentSha256,
      toPgVector(input.vector),
      input.model,
      MEMORY_EMBEDDING_VERSION,
      input.chunk.tokenCount,
      JSON.stringify(input.chunk.sourceJson),
      input.chunk.redactionStatus,
    ],
  );
}

async function emitProgress(
  input: DrawerBackfillInput,
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
  input: DrawerBackfillInput,
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

function sanitizeScope(scope: string): MemoryScope {
  return sanitizeName(scopeNormalize(scope) || 'global') as MemoryScope;
}

function mapSourceType(sourceType: DrawerBackfillParams['sourceType']): MemoryDrawerSourceType {
  return sourceType === 'session-jsonl' ? 'session-jsonl' : 'claude-mem-observation';
}

function clampBatchSize(value: number, fallback: number, max: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value), max)) : fallback;
}

function exceedsFailRatio(failed: number, total: number, maxFailRatio: number): boolean {
  return total > 0 && failed / total > maxFailRatio;
}

function parsePrice(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function resolveRealPath(target: string): string {
  try {
    return path.resolve(fs.realpathSync(target));
  } catch (error) {
    throw new ControlPlaneError('VALIDATION_ERROR', 'sourceRoot could not be resolved', {
      sourceRootViolation: true,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function isWithinRoot(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toPgVector(vector: readonly number[]): string {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new ControlPlaneError('EMBEDDING_INVALID_VECTOR', 'Embedding vector is invalid');
  }
  return `[${vector.join(',')}]`;
}
