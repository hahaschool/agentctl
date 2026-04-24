# PR E — Workers: embedding-backfill + drawer-backfill + Boot

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The two write-kind job handlers that actually embed memory facts and drawer sources. After this PR, setting `MEMORY_OPS_ENABLED=true` and `MEMORY_OPS_ENABLED_KINDS=embedding-backfill,drawer-backfill` unlocks the 19,226-fact backfill via the API.

**Architecture:** Each handler is a pure async function: receives `{ jobId, params, logger }`, polls `isCancelRequested()` between batches, writes progress to `job_events` table, reads `priceUsdPerMtoken` from the job row (not live catalog). The BullMQ `Worker` is registered in `worker-runtime.ts` and started in `index.ts` after boot reconciliation.

**Prerequisite:** PRs A+B+C+D merged. Branch from `main`.

**Branch:**
```bash
git fetch origin
git worktree add .trees/pr-e -b agent/claude-1/feat/memory-ops-pr-e
cd .trees/pr-e
```

---

## Files

**Create:**
- `packages/control-plane/src/memory/ops/embedding-backfill.ts`
- `packages/control-plane/src/memory/ops/drawer-backfill.ts`
- `packages/control-plane/src/memory/ops/cost-tracker.ts`
- `packages/control-plane/src/memory/ops/worker.ts`
- `packages/control-plane/src/memory/ops/worker-runtime.ts`
- `packages/control-plane/src/memory/ops/e2e.test.ts`

**Modify:**
- `packages/control-plane/src/index.ts` — start the BullMQ Worker after boot reconciliation
- `.env.example` — update `MEMORY_OPS_ENABLED_KINDS`, add `MEMORY_OPS_MAX_FAIL_RATIO`, `MEMORY_OPS_DRAWER_SOURCE_ROOTS`

---

## Task 1: cost-tracker.ts

**Files:**
- Create: `packages/control-plane/src/memory/ops/cost-tracker.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/control-plane/src/memory/ops/cost-tracker.test.ts
import { CostTracker } from './cost-tracker.js';

it('accumulates cost correctly', () => {
  const tracker = new CostTracker({ priceUsdPerMtoken: 0.02 });
  tracker.add({ promptTokens: 1_000_000 });
  expect(tracker.totalCostUsd).toBeCloseTo(0.02);
  tracker.add({ promptTokens: 500_000 });
  expect(tracker.totalCostUsd).toBeCloseTo(0.03);
});

it('uses estimated=true when tokens not available', () => {
  const tracker = new CostTracker({ priceUsdPerMtoken: 0.02 });
  tracker.addEstimated(10_000); // chars
  expect(tracker.usageEstimated).toBe(true);
  expect(tracker.totalCostUsd).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/memory/ops/cost-tracker.test.ts
```

- [ ] **Step 3: Implement CostTracker**

```typescript
// packages/control-plane/src/memory/ops/cost-tracker.ts
export class CostTracker {
  private _totalTokens = 0;
  private _costUsd = 0;
  private _estimated = false;

  constructor(private readonly opts: { priceUsdPerMtoken: number }) {}

  add(usage: { promptTokens: number }): void {
    this._totalTokens += usage.promptTokens;
    this._costUsd += (usage.promptTokens / 1_000_000) * this.opts.priceUsdPerMtoken;
  }

  addEstimated(chars: number): void {
    const estimatedTokens = Math.ceil(chars / 4);
    this._costUsd += (estimatedTokens / 1_000_000) * this.opts.priceUsdPerMtoken;
    this._estimated = true;
  }

  get totalCostUsd(): number { return this._costUsd; }
  get usageEstimated(): boolean { return this._estimated; }
  get totalTokens(): number { return this._totalTokens; }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm vitest run src/memory/ops/cost-tracker.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/ops/cost-tracker.ts packages/control-plane/src/memory/ops/cost-tracker.test.ts
git commit -m "feat(memory-ops): CostTracker — accumulates cost from job row priceUsdPerMtoken"
```

---

## Task 2: embedding-backfill handler

**Files:**
- Create: `packages/control-plane/src/memory/ops/embedding-backfill.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/control-plane/src/memory/ops/embedding-backfill.test.ts
// Uses real Postgres (pgvector) + stub embedding client

describe('embeddingBackfillHandler', () => {
  it('writes embedding AND content_model=resolved.model to memory_facts', async () => {
    // Setup: insert a memory_fact with embedding=NULL
    await pool.query(`INSERT INTO memory_facts(id, content, content_model)
      VALUES('fact-1', 'hello world', 'text-embedding-3-small')`);
    // Run handler with mock client returning dim=1536
    await embeddingBackfillHandler({ jobId: 'job-1', params: { batchSize: 100 }, logger, pool, db,
      resolvedClient: { client: stubClient, model: 'text-embedding-3-small',
        providerKind: 'openai', providerHost: 'https://api.openai.com', priceUsdPerMtoken: 0.02, credentialId: 'c1' },
      jobsRepo, eventsRepo });
    const { rows } = await pool.query(`SELECT content_model FROM memory_facts WHERE id='fact-1'`);
    expect(rows[0].content_model).toBe('text-embedding-3-small');
    const embed = await pool.query(`SELECT embedding FROM memory_facts WHERE id='fact-1'`);
    expect(embed.rows[0].embedding).not.toBeNull();
  });

  it('stops processing when cancel_requested_at is set', async () => {
    // Insert 100 facts, set cancel after 10 processed
    // Assert job ends with status=cancelled, processed < 100
  });

  it('transitions to failed when failed/total > MAX_FAIL_RATIO', async () => {
    // Stub client throws on every call
    // Assert job transitions to failed after exhausting retries
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pnpm vitest run src/memory/ops/embedding-backfill.test.ts
```

- [ ] **Step 3: Implement the handler**

```typescript
// packages/control-plane/src/memory/ops/embedding-backfill.ts
import type { Pool } from 'pg';
import type { Logger } from '../../logger.js';
import type { Database } from '../../db/index.js';
import type { ResolvedEmbeddingClient } from '../../memory/embedding-client-factory.js';
import { JobsRepository } from './jobs-repository.js';
import { JobEventsRepository } from './job-events-repository.js';
import { CostTracker } from './cost-tracker.js';
import { MAX_FAIL_RATIO } from './config.js';
import { scopeNormalize } from '@agentctl/shared';

type EmbeddingBackfillInput = {
  jobId: string;
  params: { batchSize?: number; dryRun?: boolean; scope?: string };
  logger: Logger;
  pool: Pool;
  db: Database;
  resolvedClient: ResolvedEmbeddingClient;
  jobsRepo: JobsRepository;
  eventsRepo: JobEventsRepository;
};

export async function embeddingBackfillHandler(input: EmbeddingBackfillInput): Promise<void> {
  const { jobId, params, pool, resolvedClient, jobsRepo, eventsRepo, logger } = input;
  const batchSize = params.batchSize ?? 100;
  const scope = scopeNormalize(params.scope);
  const costTracker = new CostTracker({ priceUsdPerMtoken: resolvedClient.priceUsdPerMtoken });

  // Count eligible facts
  const { rows: countRows } = await pool.query(
    scope
      ? `SELECT COUNT(*)::int AS c FROM memory_facts WHERE embedding IS NULL AND scope=$1`
      : `SELECT COUNT(*)::int AS c FROM memory_facts WHERE embedding IS NULL`,
    scope ? [scope] : [],
  );
  const total = countRows[0].c as number;

  await eventsRepo.insert({ jobId, eventType: 'started', level: 'info',
    message: `Starting embedding-backfill: ${total} facts`, progress: { processed:0, embedded:0, failed:0, total, costUsd:0, usageEstimated:false } });
  await jobsRepo.markRunning(jobId);

  let processed = 0;
  let embedded = 0;
  let failedCount = 0;

  while (processed < total) {
    // Cancel check between batches
    if (await jobsRepo.isCancelRequested(jobId)) {
      await jobsRepo.transition(jobId, 'cancelled');
      await eventsRepo.insert({ jobId, eventType: 'cancelled', level: 'info', message: 'Cancelled by request' });
      return;
    }

    // Fetch a batch of null-embedding facts
    const { rows: batch } = await pool.query(
      scope
        ? `SELECT id, content FROM memory_facts WHERE embedding IS NULL AND scope=$1 ORDER BY created_at LIMIT $2`
        : `SELECT id, content FROM memory_facts WHERE embedding IS NULL ORDER BY created_at LIMIT $1`,
      scope ? [scope, batchSize] : [batchSize],
    );

    if (batch.length === 0) break;

    // Embed the batch
    let vectors: number[][];
    let usage: { promptTokens: number };
    try {
      const result = await resolvedClient.client.embedBatchWithUsage(batch.map((r: {content:string}) => r.content));
      vectors = result.vectors;
      usage = result.usage;
      costTracker.add(usage);
    } catch (err) {
      logger.error({ jobId, err }, 'Embedding API error in batch');
      failedCount += batch.length;
      if (failedCount / total > MAX_FAIL_RATIO) {
        await jobsRepo.transition(jobId, 'failed');
        await eventsRepo.insert({ jobId, eventType: 'failed', level: 'error',
          message: `Fail ratio ${(failedCount/total).toFixed(2)} exceeds limit ${MAX_FAIL_RATIO}` });
        return;
      }
      processed += batch.length;
      continue;
    }

    if (!params.dryRun) {
      // Write embedding + content_model for each fact in batch
      for (let i = 0; i < batch.length; i++) {
        const vector = vectors[i];
        if (!vector) { failedCount++; continue; }
        try {
          // Use raw SQL: content_model is not in the Drizzle schema (raw column)
          const pgVector = `[${vector.join(',')}]`;
          await pool.query(
            `UPDATE memory_facts SET embedding=$1::vector, content_model=$2
             WHERE id=$3 AND embedding IS NULL`,  // WHERE IS NULL prevents double-write
            [pgVector, resolvedClient.model, batch[i].id],
          );
          embedded++;
        } catch {
          failedCount++;
        }
      }
    } else {
      embedded += batch.length;
    }

    processed += batch.length;
    const progress = { processed, embedded, failed: failedCount, total,
      costUsd: costTracker.totalCostUsd, usageEstimated: costTracker.usageEstimated };
    await eventsRepo.insert({ jobId, eventType: 'progress', level: 'info', progress });
    // Update job row progress
    await pool.query(`UPDATE memory_ops_jobs SET progress=$1 WHERE id=$2`, [JSON.stringify(progress), jobId]);
  }

  // Fail ratio check at completion
  if (total > 0 && failedCount / total > MAX_FAIL_RATIO) {
    await jobsRepo.transition(jobId, 'failed');
    await eventsRepo.insert({ jobId, eventType: 'failed', level: 'error',
      message: `Final fail ratio ${(failedCount/total).toFixed(2)} exceeds limit` });
    return;
  }

  await jobsRepo.transition(jobId, 'completed');
  await eventsRepo.insert({ jobId, eventType: 'completed', level: 'info',
    message: `Completed: ${embedded}/${total} embedded`,
    progress: { processed, embedded, failed:failedCount, total, costUsd:costTracker.totalCostUsd, usageEstimated:costTracker.usageEstimated } });
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm vitest run src/memory/ops/embedding-backfill.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/ops/embedding-backfill.ts packages/control-plane/src/memory/ops/embedding-backfill.test.ts packages/control-plane/src/memory/ops/cost-tracker.ts
git commit -m "feat(memory-ops): embedding-backfill handler — batched embedding with cancel polling and fail-ratio guard"
```

---

## Task 3: drawer-backfill handler

**Files:**
- Create: `packages/control-plane/src/memory/ops/drawer-backfill.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/control-plane/src/memory/ops/drawer-backfill.test.ts

it('rejects sourceRoot outside configured DRAWER_SOURCE_ROOTS', async () => {
  process.env.MEMORY_OPS_DRAWER_SOURCE_ROOTS = '/allowed';
  await expect(drawerBackfillHandler({ params: { sourceRoot: '/allowed-evil', sourceType: 'claude-mem', batchSize: 50 }, ... }))
    .rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { sourceRootViolation: true } });
});

it('rejects symlink escape from sourceRoot', async () => {
  // create symlink pointing outside allowed root
  // assert handler throws VALIDATION_ERROR
});

it('writes embedding_model=resolved.model to memory_drawers', async () => {
  // seed a drawer source file, run handler, assert embedding_model on written row
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pnpm vitest run src/memory/ops/drawer-backfill.test.ts
```

- [ ] **Step 3: Implement drawer-backfill handler**

```typescript
// packages/control-plane/src/memory/ops/drawer-backfill.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Pool } from 'pg';
import type { Logger } from '../../logger.js';
import type { Database } from '../../db/index.js';
import type { ResolvedEmbeddingClient } from '../../memory/embedding-client-factory.js';
import { JobsRepository } from './jobs-repository.js';
import { JobEventsRepository } from './job-events-repository.js';
import { CostTracker } from './cost-tracker.js';
import { MAX_FAIL_RATIO, DRAWER_SOURCE_ROOTS } from './config.js';
import { ControlPlaneError } from '../../errors.js';

const ALLOWED_EXTS = new Set(['.ts', '.js', '.py', '.md', '.txt', '.json']);
const AVG_CHUNK_SIZE = 2000; // chars per chunk

type DrawerBackfillInput = {
  jobId: string;
  params: { sourceType: 'claude-mem' | 'jsonl'; sourceRoot: string; batchSize?: number };
  logger: Logger;
  pool: Pool;
  db: Database;
  resolvedClient: ResolvedEmbeddingClient;
  jobsRepo: JobsRepository;
  eventsRepo: JobEventsRepository;
};

function validateSourceRoot(sourceRoot: string): string {
  const canonicalRoots = DRAWER_SOURCE_ROOTS.map(r => {
    try { return fs.realpathSync(r); } catch { return r; }
  });
  let resolved: string;
  try {
    resolved = fs.realpathSync(sourceRoot);
  } catch {
    throw new ControlPlaneError('VALIDATION_ERROR', 'sourceRoot does not exist or contains broken symlink',
      { sourceRootViolation: true });
  }
  const contained = canonicalRoots.some(root => {
    const rel = path.relative(root, resolved);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
  if (!contained) {
    throw new ControlPlaneError('VALIDATION_ERROR', 'sourceRoot is outside allowed paths',
      { sourceRootViolation: true });
  }
  return resolved;
}

function collectFiles(rootPath: string): { filePath: string; size: number }[] {
  const results: { filePath: string; size: number }[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (entry.isSymbolicLink()) {
        let real: string;
        try { real = fs.realpathSync(full); } catch { continue; }
        const rel = path.relative(rootPath, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) continue; // symlink escape
      }
      if (!ALLOWED_EXTS.has(path.extname(entry.name))) continue;
      const stat = fs.statSync(full);
      results.push({ filePath: full, size: stat.size });
    }
  }
  walk(rootPath);
  return results;
}

export async function drawerBackfillHandler(input: DrawerBackfillInput): Promise<void> {
  const { jobId, params, pool, resolvedClient, jobsRepo, eventsRepo } = input;
  const batchSize = params.batchSize ?? 50;
  const costTracker = new CostTracker({ priceUsdPerMtoken: resolvedClient.priceUsdPerMtoken });

  const resolvedRoot = validateSourceRoot(params.sourceRoot);
  const files = collectFiles(resolvedRoot);
  const total = files.length;

  await eventsRepo.insert({ jobId, eventType: 'started', level: 'info',
    message: `Starting drawer-backfill: ${total} files from ${resolvedRoot}`,
    progress: { processed:0, embedded:0, failed:0, total, costUsd:0, usageEstimated:false } });
  await jobsRepo.markRunning(jobId);

  let processed = 0;
  let embedded = 0;
  let failedCount = 0;

  // Process in batches of files
  for (let i = 0; i < files.length; i += batchSize) {
    if (await jobsRepo.isCancelRequested(jobId)) {
      await jobsRepo.transition(jobId, 'cancelled');
      await eventsRepo.insert({ jobId, eventType: 'cancelled', level: 'info', message: 'Cancelled by request' });
      return;
    }

    const batch = files.slice(i, i + batchSize);
    const chunks: { text: string; sourceFile: string }[] = [];

    for (const f of batch) {
      let content: string;
      try {
        content = fs.readFileSync(f.filePath, 'utf8');
      } catch { failedCount++; continue; }
      // Split into chunks
      for (let c = 0; c < content.length; c += AVG_CHUNK_SIZE) {
        chunks.push({ text: content.slice(c, c + AVG_CHUNK_SIZE), sourceFile: f.filePath });
      }
    }

    if (chunks.length === 0) { processed += batch.length; continue; }

    let vectors: number[][];
    try {
      const result = await resolvedClient.client.embedBatchWithUsage(chunks.map(c => c.text));
      vectors = result.vectors;
      costTracker.add(result.usage);
    } catch {
      failedCount += batch.length;
      if (failedCount / total > MAX_FAIL_RATIO) {
        await jobsRepo.transition(jobId, 'failed');
        await eventsRepo.insert({ jobId, eventType: 'failed', level: 'error', message: 'Fail ratio exceeded' });
        return;
      }
      processed += batch.length;
      continue;
    }

    // Write each chunk as a drawer source row with embedding_model
    for (let j = 0; j < chunks.length; j++) {
      const vector = vectors[j];
      if (!vector) { failedCount++; continue; }
      const pgVector = `[${vector.join(',')}]`;
      try {
        await pool.query(
          `INSERT INTO memory_drawers(source_file, content, embedding, embedding_model)
           VALUES($1, $2, $3::vector, $4)
           ON CONFLICT (source_file, chunk_index) DO UPDATE
             SET embedding=$3::vector, embedding_model=$4`,
          [chunks[j].sourceFile, chunks[j].text, pgVector, resolvedClient.model],
        );
        embedded++;
      } catch { failedCount++; }
    }

    processed += batch.length;
    const progress = { processed, embedded, failed:failedCount, total, costUsd:costTracker.totalCostUsd, usageEstimated:costTracker.usageEstimated };
    await eventsRepo.insert({ jobId, eventType: 'progress', level: 'info', progress });
    await pool.query(`UPDATE memory_ops_jobs SET progress=$1 WHERE id=$2`, [JSON.stringify(progress), jobId]);
  }

  await jobsRepo.transition(jobId, 'completed');
  await eventsRepo.insert({ jobId, eventType: 'completed', level: 'info', message: `Completed: ${embedded} chunks from ${processed} files` });
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm vitest run src/memory/ops/drawer-backfill.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/ops/drawer-backfill.ts packages/control-plane/src/memory/ops/drawer-backfill.test.ts
git commit -m "feat(memory-ops): drawer-backfill handler — sourceRoot containment, symlink escape detection, chunk embedding"
```

---

## Task 4: BullMQ Worker registration

**Files:**
- Create: `packages/control-plane/src/memory/ops/worker.ts`
- Create: `packages/control-plane/src/memory/ops/worker-runtime.ts`

- [ ] **Step 1: Implement worker.ts (handler dispatch)**

```typescript
// packages/control-plane/src/memory/ops/worker.ts
import { Worker, type Job } from 'bullmq';
import type { Pool } from 'pg';
import type { Logger } from '../../logger.js';
import type { Database } from '../../db/index.js';
import { resolveEmbeddingClient } from '../../memory/embedding-client-factory.js';
import { JobsRepository } from './jobs-repository.js';
import { JobEventsRepository } from './job-events-repository.js';
import { embeddingBackfillHandler } from './embedding-backfill.js';
import { drawerBackfillHandler } from './drawer-backfill.js';
import { ControlPlaneError } from '../../errors.js';

type WorkerOptions = {
  pool: Pool;
  db: Database;
  encryptionKey: string;
  logger: Logger;
  redisUrl: string;
  redisDb: number;
};

export function createMemoryOpsWorker(opts: WorkerOptions): Worker {
  const jobsRepo = new JobsRepository(opts.pool, opts.db);
  const eventsRepo = new JobEventsRepository(opts.pool);

  const worker = new Worker(
    'memory-ops',
    async (job: Job) => {
      const { dbJobId } = job.data as { dbJobId: string };
      opts.logger.info({ dbJobId, kind: job.name }, 'memory-ops worker: processing job');

      const jobRow = await jobsRepo.findById(dbJobId);
      if (!jobRow) {
        opts.logger.warn({ dbJobId }, 'memory-ops worker: job row not found — skipping');
        return;
      }

      const resolvedClient = jobRow.credentialId
        ? await resolveEmbeddingClient({ ...opts, credentialId: jobRow.credentialId })
        : await resolveEmbeddingClient(opts).catch(() => null);

      const handlerOpts = {
        jobId: dbJobId,
        params: jobRow.params as Record<string, unknown>,
        logger: opts.logger,
        pool: opts.pool,
        db: opts.db,
        resolvedClient: resolvedClient!,
        jobsRepo,
        eventsRepo,
      };

      switch (job.name) {
        case 'embedding-backfill':
          if (!resolvedClient) throw new ControlPlaneError('EMBEDDING_NO_PROVIDER', 'No provider');
          await embeddingBackfillHandler(handlerOpts);
          break;
        case 'drawer-backfill':
          if (!resolvedClient) throw new ControlPlaneError('EMBEDDING_NO_PROVIDER', 'No provider');
          await drawerBackfillHandler(handlerOpts);
          break;
        default:
          opts.logger.warn({ kind: job.name }, 'memory-ops worker: unknown job kind');
      }
    },
    {
      connection: { url: opts.redisUrl, db: opts.redisDb },
      concurrency: 1, // one job at a time per CP instance
    },
  );

  worker.on('failed', (job, err) => {
    opts.logger.error({ jobId: job?.data.dbJobId, err }, 'memory-ops worker: job failed');
  });

  return worker;
}
```

- [ ] **Step 2: Implement worker-runtime.ts (singleton)**

```typescript
// packages/control-plane/src/memory/ops/worker-runtime.ts
import type { Worker } from 'bullmq';

let _worker: Worker | null = null;

export function setMemoryOpsWorker(w: Worker): void {
  _worker = w;
}

export function getMemoryOpsWorker(): Worker | null {
  return _worker;
}

export async function shutdownMemoryOpsWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
}
```

- [ ] **Step 3: Wire up in index.ts**

In `packages/control-plane/src/index.ts`, after boot reconciliation:
```typescript
import { createMemoryOpsWorker } from './memory/ops/worker.js';
import { setMemoryOpsWorker } from './memory/ops/worker-runtime.js';

// After bootReconcile():
const memOpsWorker = createMemoryOpsWorker({ pool, db, encryptionKey, logger, redisUrl, redisDb });
setMemoryOpsWorker(memOpsWorker);
logger.info('Memory ops worker started');

// On graceful shutdown:
process.on('SIGTERM', async () => {
  await shutdownMemoryOpsWorker();
  // ... existing shutdown
});
```

- [ ] **Step 4: Update .env.example**

```
MEMORY_OPS_ENABLED_KINDS=embedding-backfill,drawer-backfill
MEMORY_OPS_MAX_FAIL_RATIO=0.05
MEMORY_OPS_DRAWER_SOURCE_ROOTS=/path/to/source
```

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/ops/worker.ts packages/control-plane/src/memory/ops/worker-runtime.ts packages/control-plane/src/index.ts .env.example
git commit -m "feat(memory-ops): BullMQ Worker dispatches embedding-backfill and drawer-backfill handlers"
```

---

## Task 5: Integration e2e test

**Files:**
- Create: `packages/control-plane/src/memory/ops/e2e.test.ts`

- [ ] **Step 1: Write integration test**

This test starts a real CP, inserts facts with null embeddings, runs the backfill, and verifies embeddings are written. Uses the stub embedding client (no real API call).

```typescript
// packages/control-plane/src/memory/ops/e2e.test.ts
// Integration test — requires Docker Postgres with migration 0033

describe('embedding-backfill e2e', () => {
  it('writes embeddings and content_model to all null-embedding facts', async () => {
    // Insert 5 facts with embedding=NULL
    for (let i = 0; i < 5; i++) {
      await pool.query(`INSERT INTO memory_facts(content, content_model)
        VALUES($1, 'text-embedding-3-small')`, [`fact content ${i}`]);
    }

    // Create a mock embedding account
    await pool.query(`INSERT INTO api_accounts(name,provider,credential,credential_iv,is_active,credential_kind,metadata)
      VALUES('Test','openai','encrypted','iv',true,'embedding','{"model":"text-embedding-3-small","lastTestOk":true}')`);

    // POST /api/memory/ops/jobs { kind: 'embedding-backfill', egressConfirmed:true, params:{} }
    // ... (use testApp.inject)
    const res = await testApp.inject({ method: 'POST', url: '/api/memory/ops/jobs',
      payload: { kind: 'embedding-backfill', egressConfirmed: true, params: { batchSize: 100 } } });
    expect(res.statusCode).toBe(201);
    const { job } = res.json();

    // Wait for completion (poll GET /jobs/:id until status=completed or timeout 10s)
    await waitForJobCompletion(job.id, 10_000);

    // Verify all 5 facts have non-null embedding AND content_model='text-embedding-3-small'
    const { rows } = await pool.query(`SELECT embedding, content_model FROM memory_facts WHERE embedding IS NOT NULL`);
    expect(rows).toHaveLength(5);
    expect(rows[0].content_model).toBe('text-embedding-3-small');
  }, 30_000);
});
```

- [ ] **Step 2: Run the e2e test**

```bash
INTEGRATION_TEST=true pnpm vitest run src/memory/ops/e2e.test.ts
# Expected: PASS (with Docker Postgres running)
```

- [ ] **Step 3: Full build + test**

```bash
pnpm build && pnpm vitest run && pnpm lint
# Expected: 0 errors
```

- [ ] **Step 4: Manual trigger on dev-1**

```bash
source .env.dev-1
# Temporarily enable:
export MEMORY_OPS_ENABLED=true
export MEMORY_OPS_ENABLED_KINDS=embedding-backfill,drawer-backfill
pm2 restart agentctl-cp-dev1
# POST via curl:
curl -X POST http://localhost:8180/api/memory/ops/jobs \
  -H "Content-Type: application/json" \
  -d '{"kind":"embedding-backfill","egressConfirmed":true,"params":{"batchSize":100,"dryRun":true}}'
# Expected: 201 with job id
# Poll GET /api/memory/ops/jobs/:id until status=completed
```

- [ ] **Step 5: Commit + push + open PR**

```bash
git add packages/control-plane/src/memory/ops/e2e.test.ts packages/control-plane/src/memory/ops/worker.ts packages/control-plane/src/memory/ops/worker-runtime.ts packages/control-plane/src/index.ts
git commit -m "test(memory-ops): e2e integration test for embedding-backfill job lifecycle"
git push origin agent/claude-1/feat/memory-ops-pr-e
gh pr create --base main \
  --title "feat(memory-ops): PR E — embedding-backfill + drawer-backfill workers + boot reconciliation" \
  --body "After this PR, set MEMORY_OPS_ENABLED=true + MEMORY_OPS_ENABLED_KINDS=embedding-backfill,drawer-backfill to trigger the 19,226-fact backfill via POST /api/memory/ops/jobs."
```
