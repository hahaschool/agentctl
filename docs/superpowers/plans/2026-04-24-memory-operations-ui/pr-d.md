# PR D — Backend: Jobs CRUD + BullMQ + SSE + Preview + Capabilities

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All job-orchestration infrastructure: BullMQ queue wired to DB jobs, `JobsRepository` (including cancel + durable state machine), `JobEventsRepository`, SSE streaming, preview endpoint, `/api/memory/ops/capabilities`. Workers are registered but no handlers yet (PR E adds them). `MEMORY_OPS_ENABLED_KINDS` is shipped as empty — no jobs can run yet.

**Architecture:** `memory-ops/config.ts` is the single source of truth for feature flags. `memory-ops/jobs-repository.ts` is the only writer to `memory_ops_jobs`. The BullMQ queue is an in-process singleton. Advisory lock + fleet-check SELECT inside DB transaction before INSERT. SSE stream reads from `memory_ops_job_events` using `pg_notify`.

**Prerequisite:** PRs A + B merged. Branch from `main`.

**Branch:**
```bash
git fetch origin
git worktree add .trees/pr-d -b agent/claude-1/feat/memory-ops-pr-d
cd .trees/pr-d
```

**Tech Stack:** BullMQ, `pg_notify` via `pg` client listen/notify, Zod discriminated union schemas, Fastify SSE (using `reply.raw` with `text/event-stream`).

---

## Files

**Create:**
- `packages/control-plane/src/memory/ops/config.ts`
- `packages/control-plane/src/memory/ops/queue.ts`
- `packages/control-plane/src/memory/ops/jobs-repository.ts`
- `packages/control-plane/src/memory/ops/jobs-repository.test.ts`
- `packages/control-plane/src/memory/ops/job-events-repository.ts`
- `packages/control-plane/src/memory/ops/sse-stream.ts`
- `packages/control-plane/src/memory/ops/preview.ts`
- `packages/control-plane/src/memory/ops/worker-runtime.ts`
- `packages/control-plane/src/api/routes/memory-ops.ts`
- `packages/control-plane/src/api/routes/memory-ops.test.ts`

**Modify:**
- `packages/control-plane/src/api/server.ts` — register memory-ops route
- `packages/control-plane/src/index.ts` — initialize queue + worker-runtime
- `packages/control-plane/src/audit/log-retention.ts` — extend for 14-day events + 90-day audit purge
- `.env.example` — add `MEMORY_OPS_ENABLED=false`, `MEMORY_OPS_ENABLED_KINDS=`

---

## Task 1: config.ts — feature flags

**Files:**
- Create: `packages/control-plane/src/memory/ops/config.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/control-plane/src/memory/ops/config.test.ts
import { vi } from 'vitest';

it('MEMORY_OPS_ENABLED is false by default', async () => {
  delete process.env.MEMORY_OPS_ENABLED;
  vi.resetModules();
  const { MEMORY_OPS_ENABLED } = await import('./config.js');
  expect(MEMORY_OPS_ENABLED).toBe(false);
});

it('ENABLED_JOB_KINDS parses comma-separated env var', async () => {
  process.env.MEMORY_OPS_ENABLED_KINDS = 'embedding-backfill,drawer-backfill';
  vi.resetModules();
  const { ENABLED_JOB_KINDS } = await import('./config.js');
  expect(ENABLED_JOB_KINDS.has('embedding-backfill')).toBe(true);
  expect(ENABLED_JOB_KINDS.has('consolidation')).toBe(false);
});

it('ENABLED_JOB_KINDS is empty set when env var is blank', async () => {
  process.env.MEMORY_OPS_ENABLED_KINDS = '';
  vi.resetModules();
  const { ENABLED_JOB_KINDS } = await import('./config.js');
  expect(ENABLED_JOB_KINDS.size).toBe(0);
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/memory/ops/config.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Create config.ts**

```typescript
// packages/control-plane/src/memory/ops/config.ts
import type { MemoryOpsJobKind } from '@agentctl/shared';

export const MEMORY_OPS_ENABLED = process.env.MEMORY_OPS_ENABLED === 'true';

export const ENABLED_JOB_KINDS: Set<MemoryOpsJobKind> = new Set(
  (process.env.MEMORY_OPS_ENABLED_KINDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean) as MemoryOpsJobKind[],
);

export const MEMORY_OPS_SIGNING_SECRET = process.env.MEMORY_OPS_SIGNING_SECRET ?? '';

export const MAX_FAIL_RATIO = parseFloat(process.env.MEMORY_OPS_MAX_FAIL_RATIO ?? '0.05');

export const DRAWER_SOURCE_ROOTS: string[] = (process.env.MEMORY_OPS_DRAWER_SOURCE_ROOTS ?? '')
  .split(':')
  .map(p => p.trim())
  .filter(Boolean);
```

- [ ] **Step 4: Run test — expect pass**

```bash
pnpm vitest run src/memory/ops/config.test.ts
# Expected: PASS
```

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/ops/config.ts packages/control-plane/src/memory/ops/config.test.ts
git commit -m "feat(memory-ops): config.ts — MEMORY_OPS_ENABLED, ENABLED_JOB_KINDS from env"
```

---

## Task 2: BullMQ queue setup

**Files:**
- Create: `packages/control-plane/src/memory/ops/queue.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/control-plane/src/memory/ops/queue.test.ts
import { getMemoryOpsQueue, resetQueueForTesting } from './queue.js';

afterEach(() => resetQueueForTesting());

it('queue.add uses jobId in opts (3rd arg), not data', async () => {
  const queue = getMemoryOpsQueue({ redisUrl: 'redis://localhost:6379', db: 1 });
  // Spy on the underlying BullMQ Queue.add to verify call signature
  const addSpy = vi.spyOn(queue, 'add');
  const dbJobId = 'test-uuid-1';
  await queue.add('embedding-backfill', { dbJobId }, { jobId: dbJobId });
  expect(addSpy).toHaveBeenCalledWith(
    'embedding-backfill',
    { dbJobId },
    expect.objectContaining({ jobId: dbJobId }),
  );
  // getJob by dbJobId must find the job
  const job = await queue.getJob(dbJobId);
  expect(job?.id).toBe(dbJobId);
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
pnpm vitest run src/memory/ops/queue.test.ts
# Expected: FAIL — module not found (requires Redis; skip if no Redis in test env)
```

- [ ] **Step 3: Create queue.ts**

```typescript
// packages/control-plane/src/memory/ops/queue.ts
import { Queue } from 'bullmq';

type QueueOptions = { redisUrl: string; db: number };

let _queue: Queue | null = null;

export function getMemoryOpsQueue(opts: QueueOptions): Queue {
  if (!_queue) {
    _queue = new Queue('memory-ops', {
      connection: { url: opts.redisUrl, db: opts.db },
      defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200 },
    });
  }
  return _queue;
}

export async function resetQueueForTesting(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}
```

The Redis URL and DB number are obtained from the existing `tier-config.ts` (see `extractRedisDb` at `tier-config.ts:99`). Pass them to `getMemoryOpsQueue()` at CP startup in `index.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/control-plane/src/memory/ops/queue.ts packages/control-plane/src/memory/ops/queue.test.ts
git commit -m "feat(memory-ops): BullMQ queue singleton — jobId in opts (3rd arg) for boot recovery"
```

---

## Task 3: JobsRepository

**Files:**
- Create: `packages/control-plane/src/memory/ops/jobs-repository.ts`
- Create: `packages/control-plane/src/memory/ops/jobs-repository.test.ts`

This is the most critical repository. It handles: INSERT with advisory lock + fleet check, cancel logic, state machine transitions, boot reconciliation.

- [ ] **Step 1: Write failing tests (key invariants)**

```typescript
// packages/control-plane/src/memory/ops/jobs-repository.test.ts
// Uses real Docker Postgres (pgvector image from existing CI setup)

describe('JobsRepository', () => {
  it('transition to completed routes to cancelled when cancel_requested_at is set', async () => {
    const repo = new JobsRepository(pool, db);
    const id = await repo.insert({ kind: 'embedding-backfill', originMachineId: 'm1', executorMachineId: 'm1', params: {} });
    await repo.markRunning(id);
    await repo.requestCancel(id); // sets cancel_requested_at
    await repo.transition(id, 'completed'); // should actually transition to 'cancelled'
    const job = await repo.findById(id);
    expect(job?.status).toBe('cancelled'); // NOT 'completed'
  });

  it('isCancelRequested returns true after requestCancel', async () => {
    const repo = new JobsRepository(pool, db);
    const id = await repo.insert({ kind: 'consolidation', originMachineId: 'm1', executorMachineId: 'm1', params: {} });
    await repo.markRunning(id);
    expect(await repo.isCancelRequested(id)).toBe(false);
    await repo.requestCancel(id);
    expect(await repo.isCancelRequested(id)).toBe(true);
  });

  it('insert throws CONCURRENT_JOB_REQUEST on advisory lock contention (same machine)', async () => {
    // Simulate two concurrent inserts on same machine+kind+scope
    // Second one should throw CONCURRENT_JOB_REQUEST
    // This is tested by holding a transaction open with advisory lock while second insert runs
    const repo = new JobsRepository(pool, db);
    // Acquire advisory lock manually to simulate a concurrent insert holding it
    const lockKey = `memory-ops:embedding-backfill:`; // empty scope
    await pool.query(`SELECT pg_advisory_lock(hashtext($1)::bigint)`, [lockKey]);
    await expect(repo.insert({ kind: 'embedding-backfill', originMachineId: 'm1', executorMachineId: 'm1', params: {} }))
      .rejects.toMatchObject({ code: 'CONCURRENT_JOB_REQUEST' });
    await pool.query(`SELECT pg_advisory_unlock(hashtext($1)::bigint)`, [lockKey]);
  });

  it('insert throws JOB_ALREADY_RUNNING when fleet has active job', async () => {
    const repo = new JobsRepository(pool, db);
    // Seed a running job on a different machine
    await pool.query(`INSERT INTO memory_ops_jobs(kind,status,params,origin_machine_id,executor_machine_id)
      VALUES('embedding-backfill','running','{}','m2','m2')`);
    await expect(repo.insert({ kind: 'embedding-backfill', originMachineId: 'm1', executorMachineId: 'm1', params: {} }))
      .rejects.toMatchObject({ code: 'JOB_ALREADY_RUNNING' });
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pnpm vitest run src/memory/ops/jobs-repository.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Implement JobsRepository**

```typescript
// packages/control-plane/src/memory/ops/jobs-repository.ts
import type { Pool } from 'pg';
import type { Database } from '../../db/index.js';
import { memoryOpsJobs } from '../../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import { ControlPlaneError } from '../../errors.js';
import { scopeNormalize, type MemoryOpsJobKind, type MemoryOpsJobStatus, REQUIRES_PROVIDER } from '@agentctl/shared';

type InsertInput = {
  kind: MemoryOpsJobKind;
  originMachineId: string;
  executorMachineId: string;
  params: Record<string, unknown>;
  credentialId?: string;
  providerKind?: string;
  providerModel?: string;
  providerHost?: string;
  priceUsdPerMtoken?: number;
  egressSnapshot?: Record<string, unknown>;
};

export class JobsRepository {
  constructor(private readonly pool: Pool, private readonly db: Database) {}

  async insert(input: InsertInput): Promise<string> {
    const normalizedScope = scopeNormalize(input.params.scope as string | undefined);

    // Phase 1: advisory lock + fleet check + INSERT inside a transaction
    let insertedId: string;
    await this.db.transaction(async (tx) => {
      // Advisory lock — prevents two requests on the SAME machine racing to insert same kind+scope
      const lockKey = `memory-ops:${input.kind}:${normalizedScope}`;
      const { rows: lockRows } = await this.pool.query(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS acquired`,
        [lockKey],
      );
      if (!lockRows[0].acquired) {
        throw new ControlPlaneError('CONCURRENT_JOB_REQUEST', 'A concurrent request for the same job kind is in progress');
      }

      // Fleet-check SELECT — prevents duplicate running jobs across peers (write kinds only)
      if (REQUIRES_PROVIDER[input.kind]) {
        const { rows: fleetRows } = await this.pool.query(
          `SELECT id, executor_machine_id FROM memory_ops_jobs
           WHERE kind = $1
             AND COALESCE(params->>'scope', '') = $2
             AND status IN ('queued', 'running', 'cancelling')`,
          [input.kind, normalizedScope],
        );
        if (fleetRows.length > 0) {
          throw new ControlPlaneError(
            'JOB_ALREADY_RUNNING',
            `A ${input.kind} job is already running`,
            { existingJobId: fleetRows[0].id, existingMachine: fleetRows[0].executor_machine_id },
          );
        }
      }

      // INSERT
      const [row] = await tx
        .insert(memoryOpsJobs)
        .values({
          kind: input.kind,
          status: 'queued',
          params: { ...input.params, scope: normalizedScope },
          originMachineId: input.originMachineId,
          executorMachineId: input.executorMachineId,
          credentialId: input.credentialId,
          providerKind: input.providerKind,
          providerModel: input.providerModel,
          providerHost: input.providerHost,
          priceUsdPerMtoken: input.priceUsdPerMtoken?.toString(),
          egressSnapshot: input.egressSnapshot,
        })
        .returning({ id: memoryOpsJobs.id });
      insertedId = row.id;
    });

    return insertedId!;
  }

  async transition(id: string, newStatus: MemoryOpsJobStatus): Promise<void> {
    // If transitioning to 'completed' but cancel was requested, transition to 'cancelled' instead
    const effectiveStatus =
      newStatus === 'completed'
        ? await this.cancelOverride(id)
        : newStatus;

    await this.db
      .update(memoryOpsJobs)
      .set({
        status: effectiveStatus,
        finishedAt: ['completed', 'failed', 'cancelled'].includes(effectiveStatus) ? new Date() : undefined,
      })
      .where(
        and(
          eq(memoryOpsJobs.id, id),
          inArray(memoryOpsJobs.status, ['running', 'cancelling']),
        ),
      );
  }

  private async cancelOverride(id: string): Promise<MemoryOpsJobStatus> {
    const { rows } = await this.pool.query(
      `SELECT cancel_requested_at FROM memory_ops_jobs WHERE id = $1`,
      [id],
    );
    return rows[0]?.cancel_requested_at ? 'cancelled' : 'completed';
  }

  async requestCancel(id: string): Promise<'cancelled' | 'cancelling'> {
    // If queued: cancel immediately
    const { rows: queued } = await this.pool.query(
      `UPDATE memory_ops_jobs SET status='cancelled', finished_at=now()
       WHERE id=$1 AND status='queued' RETURNING id`,
      [id],
    );
    if (queued.length > 0) return 'cancelled';
    // If running or cancelling: set cancel_requested_at
    const { rows: running } = await this.pool.query(
      `UPDATE memory_ops_jobs SET cancel_requested_at=now(), status='cancelling'
       WHERE id=$1 AND status IN ('running','cancelling') RETURNING id`,
      [id],
    );
    if (running.length > 0) return 'cancelling';
    throw new ControlPlaneError('JOB_NOT_CANCELLABLE', 'Job is already in a terminal state or does not exist');
  }

  async isCancelRequested(id: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT cancel_requested_at FROM memory_ops_jobs WHERE id=$1`,
      [id],
    );
    return rows[0]?.cancel_requested_at != null;
  }

  async markRunning(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE memory_ops_jobs SET status='running', started_at=now() WHERE id=$1 AND status='queued'`,
      [id],
    );
  }

  async findById(id: string) {
    const rows = await this.db
      .select()
      .from(memoryOpsJobs)
      .where(eq(memoryOpsJobs.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async failEnqueue(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE memory_ops_jobs SET status='failed', error_code='QUEUE_ENQUEUE_FAILED', finished_at=now()
       WHERE id=$1 AND status='queued'`,
      [id],
    );
  }

  /** Boot reconciliation: mark running jobs as failed, re-enqueue queued ones. */
  async bootReconcile(machineId: string, queue: import('bullmq').Queue): Promise<void> {
    // Mark running jobs as failed (CP restarted mid-job)
    await this.pool.query(
      `UPDATE memory_ops_jobs SET status='failed', error_code='CP_RESTART_DURING_RUN', finished_at=now()
       WHERE status='running' AND executor_machine_id=$1`,
      [machineId],
    );
    // Re-enqueue queued jobs that lost their Redis entry
    const { rows: queued } = await this.pool.query(
      `SELECT id, kind FROM memory_ops_jobs WHERE status='queued' AND executor_machine_id=$1`,
      [machineId],
    );
    for (const row of queued) {
      try {
        const existing = await queue.getJob(row.id);
        if (!existing) {
          await queue.add(row.kind, { dbJobId: row.id }, { jobId: row.id, deduplication: { id: row.id } });
        }
      } catch {
        // Redis unavailable — skip, don't crash CP
      }
    }
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm vitest run src/memory/ops/jobs-repository.test.ts
# Expected: PASS (requires Postgres with migration 0033 applied)
```

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/memory/ops/jobs-repository.ts packages/control-plane/src/memory/ops/jobs-repository.test.ts
git commit -m "feat(memory-ops): JobsRepository — advisory lock, fleet check, cancel state machine, boot reconcile"
```

---

## Task 4: JobEventsRepository + SSE stream

**Files:**
- Create: `packages/control-plane/src/memory/ops/job-events-repository.ts`
- Create: `packages/control-plane/src/memory/ops/sse-stream.ts`

- [ ] **Step 1: Implement JobEventsRepository**

```typescript
// packages/control-plane/src/memory/ops/job-events-repository.ts
import type { Pool } from 'pg';

export type JobEvent = {
  eventId: string;
  jobId: string;
  eventType: string;
  level: string | null;
  message: string | null;
  progress: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export class JobEventsRepository {
  constructor(private readonly pool: Pool) {}

  async insert(event: Omit<JobEvent, 'eventId' | 'createdAt'>): Promise<void> {
    await this.pool.query(
      `INSERT INTO memory_ops_job_events (job_id, event_type, level, message, progress, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [event.jobId, event.eventType, event.level, event.message,
       event.progress ? JSON.stringify(event.progress) : null,
       event.payload ? JSON.stringify(event.payload) : null],
    );
  }

  async since(jobId: string, afterEventId: bigint): Promise<JobEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM memory_ops_job_events
       WHERE job_id=$1 AND event_id > $2
       ORDER BY event_id ASC`,
      [jobId, afterEventId],
    );
    return rows;
  }
}
```

- [ ] **Step 2: Implement SSE stream**

```typescript
// packages/control-plane/src/memory/ops/sse-stream.ts
import type { Pool } from 'pg';
import { Client } from 'pg';
import type { FastifyReply } from 'fastify';
import { JobEventsRepository } from './job-events-repository.js';

export async function streamJobEvents(
  opts: { pool: Pool; reply: FastifyReply; jobId: string; lastEventId: string | null; executorMachineId: string; localMachineId: string },
): Promise<void> {
  if (opts.executorMachineId !== opts.localMachineId) {
    opts.reply.code(403).send({
      error: 'REMOTE_PEER_JOB',
      message: 'This job is executing on a different peer; SSE streaming is only available on the executor.',
      details: { executorMachineId: opts.executorMachineId },
    });
    return;
  }

  const eventsRepo = new JobEventsRepository(opts.pool);
  const afterEventId = BigInt(opts.lastEventId ?? '0');

  // Set SSE headers
  opts.reply.raw.setHeader('Content-Type', 'text/event-stream');
  opts.reply.raw.setHeader('Cache-Control', 'no-cache');
  opts.reply.raw.setHeader('Connection', 'keep-alive');

  // Send peer identification event
  opts.reply.raw.write(`event: peer\ndata: ${JSON.stringify({ machineId: opts.localMachineId })}\n\n`);

  // Replay missed events
  const missed = await eventsRepo.since(opts.jobId, afterEventId);
  for (const ev of missed) {
    opts.reply.raw.write(`id: ${ev.eventId}\nevent: ${ev.eventType}\ndata: ${JSON.stringify(ev)}\n\n`);
  }

  // Subscribe to pg_notify for live events
  const notifyClient = new Client({ connectionString: process.env.DATABASE_URL });
  await notifyClient.connect();
  await notifyClient.query(`LISTEN memory_ops_events`);

  const cleanup = () => {
    notifyClient.end().catch(() => {});
    opts.reply.raw.end();
  };

  opts.reply.raw.on('close', cleanup);

  notifyClient.on('notification', async (msg) => {
    if (msg.payload !== opts.jobId) return;
    const latest = await eventsRepo.since(opts.jobId, BigInt(missed[missed.length - 1]?.eventId ?? afterEventId));
    for (const ev of latest) {
      opts.reply.raw.write(`id: ${ev.eventId}\nevent: ${ev.eventType}\ndata: ${JSON.stringify(ev)}\n\n`);
      if (['completed', 'failed', 'cancelled'].includes(ev.eventType)) {
        cleanup();
        return;
      }
    }
  });

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    opts.reply.raw.write(': heartbeat\n\n');
  }, 30_000);

  opts.reply.raw.on('close', () => clearInterval(heartbeat));
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/control-plane/src/memory/ops/job-events-repository.ts packages/control-plane/src/memory/ops/sse-stream.ts
git commit -m "feat(memory-ops): JobEventsRepository + SSE stream with pg_notify and Last-Event-Id replay"
```

---

## Task 5: Preview endpoint + `/api/memory/ops` routes

**Files:**
- Create: `packages/control-plane/src/memory/ops/preview.ts`
- Create: `packages/control-plane/src/api/routes/memory-ops.ts`

- [ ] **Step 1: Implement preview.ts**

```typescript
// packages/control-plane/src/memory/ops/preview.ts
import { createHmac } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Pool } from 'pg';

import { MEMORY_OPS_SIGNING_SECRET, DRAWER_SOURCE_ROOTS } from './config.js';
import { ControlPlaneError } from '../../errors.js';
import { resolveEmbeddingClient } from '../../memory/embedding-client-factory.js';
import type { Database } from '../../db/index.js';
import type { Logger } from '../../logger.js';
import type { EgressSnapshot } from '@agentctl/shared';
import { scopeNormalize } from '@agentctl/shared';

const PREVIEW_TTL_MS = 10 * 60 * 1000;

export async function buildEgressSnapshot(
  kind: 'embedding-backfill' | 'drawer-backfill',
  params: Record<string, unknown>,
  opts: { pool: Pool; db: Database; encryptionKey: string; logger: Logger },
): Promise<EgressSnapshot> {
  const resolved = await resolveEmbeddingClient(opts);
  const scope = scopeNormalize(params.scope as string | undefined);

  if (kind === 'embedding-backfill') {
    const { rows } = await opts.pool.query(
      scope
        ? `SELECT COUNT(*)::int AS c FROM memory_facts WHERE embedding IS NULL AND scope=$1`
        : `SELECT COUNT(*)::int AS c FROM memory_facts WHERE embedding IS NULL`,
      scope ? [scope] : [],
    );
    const rowCount = rows[0].c as number;
    // Sample 1% for token estimate
    const { rows: sample } = await opts.pool.query(
      `SELECT content FROM memory_facts WHERE embedding IS NULL ORDER BY RANDOM() LIMIT $1`,
      [Math.max(1, Math.floor(rowCount * 0.01))],
    );
    const sampleChars = sample.reduce((s: number, r: { content: string }) => s + r.content.length, 0);
    const tokenEstimate = rowCount > 0
      ? Math.ceil((sampleChars / Math.max(1, sample.length)) * rowCount / 4)
      : 0;

    return {
      kind, providerKind: resolved.providerKind, providerModel: resolved.model,
      providerHost: resolved.providerHost, priceUsdPerMtoken: resolved.priceUsdPerMtoken,
      rowCount, tokenEstimate, costEstimate: (tokenEstimate / 1e6) * resolved.priceUsdPerMtoken,
      contentClass: 'memory-facts', computedAt: new Date().toISOString(),
    };
  }

  // drawer-backfill: walk sourceRoot
  const sourceRoot = params.sourceRoot as string;
  // Validate containment
  const canonicalRoots = DRAWER_SOURCE_ROOTS.map(r => fs.realpathSync(r));
  const resolved_path = fs.realpathSync(sourceRoot);
  const contained = canonicalRoots.some(root => {
    const rel = path.relative(root, resolved_path);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
  if (!contained) {
    throw new ControlPlaneError('VALIDATION_ERROR', 'sourceRoot is outside allowed paths',
      { sourceRootViolation: true });
  }

  // Walk and count files
  const ALLOWED_EXTS = new Set(['.ts', '.js', '.py', '.md', '.txt', '.json']);
  let fileCount = 0;
  let totalBytes = 0;
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        const real = fs.realpathSync(full);
        const relCheck = path.relative(resolved_path, real);
        if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) continue; // symlink escape
      }
      if (!ALLOWED_EXTS.has(path.extname(entry.name))) continue;
      fileCount++;
      totalBytes += fs.statSync(full).size;
    }
  }
  walk(resolved_path);

  const AVG_CHUNK_SIZE = 2000;
  const chunkCount = Math.ceil(totalBytes / AVG_CHUNK_SIZE);
  const tokenEstimate = Math.ceil(totalBytes / 4);

  return {
    kind, providerKind: resolved.providerKind, providerModel: resolved.model,
    providerHost: resolved.providerHost, priceUsdPerMtoken: resolved.priceUsdPerMtoken,
    fileCount, totalBytes, chunkCount, tokenEstimate,
    costEstimate: (tokenEstimate / 1e6) * resolved.priceUsdPerMtoken,
    contentClass: 'drawer-source-files', computedAt: new Date().toISOString(),
  };
}

export function signSnapshot(snapshot: EgressSnapshot): string {
  if (!MEMORY_OPS_SIGNING_SECRET) return '';
  const payload = JSON.stringify(snapshot) + Date.now().toString();
  return createHmac('sha256', MEMORY_OPS_SIGNING_SECRET).update(payload).digest('hex');
}

export function verifyPreviewToken(token: string, snapshot: EgressSnapshot): boolean {
  if (!MEMORY_OPS_SIGNING_SECRET) return false;
  // Decode token format: HMAC(secret, JSON(snapshot)+timestamp)
  // Store timestamp in token for expiry check (encode as: base64(json)+'.'+sig)
  try {
    const [dataB64, sig] = token.split('.');
    const data = JSON.parse(Buffer.from(dataB64, 'base64').toString());
    if (Date.now() - data.ts > PREVIEW_TTL_MS) return false;
    const expected = createHmac('sha256', MEMORY_OPS_SIGNING_SECRET)
      .update(dataB64)
      .digest('hex');
    if (sig !== expected) return false;
    // Staleness check: verify key snapshot fields haven't changed >10%
    const currentSnapshot = data.snapshot as EgressSnapshot;
    if (snapshot.providerModel !== currentSnapshot.providerModel) return false;
    if (snapshot.providerHost !== currentSnapshot.providerHost) return false;
    if (currentSnapshot.rowCount !== undefined && snapshot.rowCount !== undefined) {
      const delta = Math.abs(snapshot.rowCount - currentSnapshot.rowCount) / Math.max(1, currentSnapshot.rowCount);
      if (delta > 0.1) return false; // >10% change
    }
    return true;
  } catch {
    return false;
  }
}

export function createPreviewToken(snapshot: EgressSnapshot): string {
  const dataB64 = Buffer.from(JSON.stringify({ snapshot, ts: Date.now() })).toString('base64');
  const sig = createHmac('sha256', MEMORY_OPS_SIGNING_SECRET).update(dataB64).digest('hex');
  return `${dataB64}.${sig}`;
}
```

- [ ] **Step 2: Implement memory-ops.ts route**

```typescript
// packages/control-plane/src/api/routes/memory-ops.ts
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import { eq, inArray } from 'drizzle-orm';

import type { Database } from '../../db/index.js';
import { memoryOpsJobs } from '../../db/schema.js';
import { ControlPlaneError } from '../../errors.js';
import { MEMORY_OPS_ENABLED, ENABLED_JOB_KINDS, MEMORY_OPS_SIGNING_SECRET } from '../../memory/ops/config.js';
import { JobsRepository } from '../../memory/ops/jobs-repository.js';
import { JobEventsRepository } from '../../memory/ops/job-events-repository.js';
import { streamJobEvents } from '../../memory/ops/sse-stream.js';
import { buildEgressSnapshot, createPreviewToken, verifyPreviewToken } from '../../memory/ops/preview.js';
import { resolveEmbeddingClient } from '../../memory/embedding-client-factory.js';
import { getMachineId } from '../../sync/machine-identity.js';
import { scopeNormalize, REQUIRES_PROVIDER } from '@agentctl/shared';
import type { Logger } from '../../logger.js';

const memoryOpsJobParamsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('embedding-backfill'), batchSize: z.number().int().min(1).max(500).default(100), dryRun: z.boolean().optional(), scope: z.string().optional() }),
  z.object({ kind: z.literal('drawer-backfill'), sourceType: z.enum(['claude-mem','jsonl']), sourceRoot: z.string().min(1), batchSize: z.number().int().min(1).default(50), scope: z.string().optional() }),
  z.object({ kind: z.literal('consolidation'), scope: z.string().optional() }),
  z.object({ kind: z.literal('synthesis'), scope: z.string().optional() }),
]);

const jobCreateSchema = z.object({
  kind: z.enum(['embedding-backfill','drawer-backfill','consolidation','synthesis']),
  previewToken: z.string().optional(),
  egressConfirmed: z.boolean().default(false),
  params: z.record(z.unknown()),
});

type MemoryOpsRouteOptions = {
  db: Database;
  pool: Pool;
  encryptionKey: string;
  logger: Logger;
};

export const memoryOpsRoutes: FastifyPluginAsync<MemoryOpsRouteOptions> = async (fastify, opts) => {
  const jobsRepo = new JobsRepository(opts.pool, opts.db);
  const eventsRepo = new JobEventsRepository(opts.pool);
  const machineId = getMachineId();

  // POST /api/memory/ops/jobs/preview
  fastify.post('/jobs/preview', async (req, reply) => {
    const { kind, params } = req.body as { kind: string; params: Record<string, unknown> };
    if (!MEMORY_OPS_SIGNING_SECRET) {
      throw new ControlPlaneError('SIGNING_SECRET_MISSING', 'MEMORY_OPS_SIGNING_SECRET not set');
    }
    const snapshot = await buildEgressSnapshot(kind as 'embedding-backfill' | 'drawer-backfill', params, opts);
    const previewToken = createPreviewToken(snapshot);
    reply.send({ snapshot, previewToken, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  });

  // POST /api/memory/ops/jobs
  fastify.post('/jobs', async (req, reply) => {
    if (!MEMORY_OPS_ENABLED) throw new ControlPlaneError('FEATURE_DISABLED', 'Memory operations are disabled');

    const body = jobCreateSchema.parse(req.body);
    const params = memoryOpsJobParamsSchema.parse({ kind: body.kind, ...body.params });

    if (!ENABLED_JOB_KINDS.has(body.kind as import('@agentctl/shared').MemoryOpsJobKind)) {
      throw new ControlPlaneError('JOB_KIND_NOT_ENABLED', `Job kind ${body.kind} is not enabled`,
        { enabledKinds: [...ENABLED_JOB_KINDS] });
    }

    let credentialId: string | undefined;
    let providerKind: string | undefined;
    let providerModel: string | undefined;
    let providerHost: string | undefined;
    let priceUsdPerMtoken: number | undefined;
    let egressSnapshotData: Record<string, unknown> | undefined;

    if (REQUIRES_PROVIDER[body.kind as import('@agentctl/shared').MemoryOpsJobKind]) {
      // Egress confirmation required for write kinds
      if (!body.egressConfirmed) {
        throw new ControlPlaneError('EGRESS_NOT_CONFIRMED', 'You must confirm data egress before creating this job');
      }

      const resolved = await resolveEmbeddingClient(opts);
      credentialId = resolved.credentialId;
      providerKind = resolved.providerKind;
      providerModel = resolved.model;
      providerHost = resolved.providerHost;
      priceUsdPerMtoken = resolved.priceUsdPerMtoken;

      // Verify previewToken if SIGNING_SECRET is configured
      if (MEMORY_OPS_SIGNING_SECRET && body.previewToken) {
        const snapshot = await buildEgressSnapshot(body.kind as 'embedding-backfill'|'drawer-backfill', body.params as Record<string,unknown>, opts);
        egressSnapshotData = snapshot as unknown as Record<string, unknown>;
        if (!verifyPreviewToken(body.previewToken, snapshot)) {
          throw new ControlPlaneError('EGRESS_SNAPSHOT_STALE', 'The egress snapshot has changed; please re-run preview', { snapshot });
        }
      }
    }

    const insertedId = await jobsRepo.insert({
      kind: body.kind as import('@agentctl/shared').MemoryOpsJobKind,
      originMachineId: machineId,
      executorMachineId: machineId,
      params: params as Record<string, unknown>,
      credentialId, providerKind, providerModel, providerHost, priceUsdPerMtoken,
      egressSnapshot: egressSnapshotData,
    });

    // Phase 2: enqueue in BullMQ (outside transaction)
    const queue = opts.db as unknown as { queue?: import('bullmq').Queue };
    // queue is injected via opts; see index.ts setup
    try {
      // The queue instance is passed to the route via fastify.decorate or similar
      // See worker-runtime.ts for the actual queue reference
      const { getMemoryOpsQueue } = await import('../ops/queue.js');
      const q = getMemoryOpsQueue({ redisUrl: process.env.REDIS_URL!, db: 0 });
      await q.add(body.kind, { dbJobId: insertedId }, { jobId: insertedId });
    } catch {
      await jobsRepo.failEnqueue(insertedId);
      throw new ControlPlaneError('QUEUE_ENQUEUE_FAILED', 'Failed to enqueue job');
    }

    const job = await jobsRepo.findById(insertedId);
    reply.code(201).send({ job });
  });

  // GET /api/memory/ops/jobs
  fastify.get('/jobs', async (req, reply) => {
    const query = req.query as { kind?: string; status?: string; limit?: string; localOnly?: string };
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
    const conditions = [];
    if (query.kind) conditions.push(`kind = ANY($${conditions.length + 1})`);
    if (query.status) conditions.push(`status = ANY($${conditions.length + 1})`);
    if (query.localOnly === 'true') conditions.push(`executor_machine_id = '${machineId}'`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const values = [
      ...(query.kind ? [query.kind.split(',')] : []),
      ...(query.status ? [query.status.split(',')] : []),
    ];
    const { rows } = await opts.pool.query(
      `SELECT * FROM memory_ops_jobs ${where} ORDER BY created_at DESC LIMIT $${values.length + 1}`,
      [...values, limit],
    );
    reply.send({ jobs: rows });
  });

  // GET /api/memory/ops/jobs/:id
  fastify.get('/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await jobsRepo.findById(id);
    if (!job) throw new ControlPlaneError('JOB_NOT_FOUND', `Job ${id} not found`);
    reply.send({ job });
  });

  // POST /api/memory/ops/jobs/:id/cancel
  fastify.post('/jobs/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await jobsRepo.findById(id);
    if (!job) throw new ControlPlaneError('JOB_NOT_FOUND', `Job ${id} not found`);
    if (job.executorMachineId !== machineId) {
      throw new ControlPlaneError('REMOTE_PEER_JOB', 'Cannot cancel a job running on a different peer',
        { executorMachineId: job.executorMachineId });
    }
    const status = await jobsRepo.requestCancel(id);
    const updated = await jobsRepo.findById(id);
    reply.send({ status, job: updated });
  });

  // GET /api/memory/ops/jobs/:id/stream
  fastify.get('/jobs/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await jobsRepo.findById(id);
    if (!job) throw new ControlPlaneError('JOB_NOT_FOUND', `Job ${id} not found`);
    const lastEventId = (req.headers['last-event-id'] as string) ?? null;
    await streamJobEvents({
      pool: opts.pool, reply, jobId: id,
      lastEventId, executorMachineId: job.executorMachineId, localMachineId: machineId,
    });
  });

  // GET /api/memory/ops/capabilities
  fastify.get('/capabilities', async (_req, reply) => {
    const resolved = await resolveEmbeddingClient(opts).catch(() => null);
    const { rows: fleetRows } = await opts.pool.query(
      `SELECT kind, COALESCE(params->>'scope','') AS scope,
              COUNT(*) FILTER (WHERE status='queued') AS queued,
              COUNT(*) FILTER (WHERE status='running') AS running,
              COUNT(*) FILTER (WHERE status='cancelling') AS cancelling
       FROM memory_ops_jobs
       WHERE status IN ('queued','running','cancelling')
       GROUP BY kind, COALESCE(params->>'scope','')`,
    );
    reply.send({
      enabled: MEMORY_OPS_ENABLED,
      enabledKinds: [...ENABLED_JOB_KINDS],
      machineId,
      hasActiveProvider: resolved !== null,
      activeProviderModel: resolved?.model,
      activeProviderLastTestOk: null, // populated from api_accounts.metadata.lastTestOk
      fleetJobsByKindAndScope: fleetRows,
    });
  });
};
```

- [ ] **Step 3: Run tests**

```bash
pnpm vitest run src/api/routes/memory-ops.test.ts
# Expected: PASS for all scenarios tested
```

- [ ] **Step 4: Register in server.ts + update index.ts**

In `server.ts`, register the route with the same guard pattern as providers:
```typescript
await fastify.register(memoryOpsRoutes, {
  prefix: '/api/memory/ops',
  db, pool, encryptionKey, logger,
});
```

In `index.ts`, add boot reconciliation (synchronous, before `fastify.listen()`):
```typescript
// Before fastify.listen():
const queue = getMemoryOpsQueue({ redisUrl, db: redisDb });
const jobsRepo = new JobsRepository(pool, db);
await jobsRepo.bootReconcile(getMachineId(), queue);
```

- [ ] **Step 5: Update log-retention.ts**

In `packages/control-plane/src/audit/log-retention.ts`, add:
```typescript
// 14-day retention for memory_ops_job_events:
await pool.query(`DELETE FROM memory_ops_job_events WHERE created_at < now() - interval '14 days'`);
// 90-day retention for memory_ops_audit:
await pool.query(`DELETE FROM memory_ops_audit WHERE timestamp < now() - interval '90 days'`);
```

- [ ] **Step 6: Update .env.example**

```
MEMORY_OPS_ENABLED=false
MEMORY_OPS_ENABLED_KINDS=
```

- [ ] **Step 7: Full build + test + push + open PR**

```bash
pnpm build && pnpm vitest run && pnpm lint
git add packages/control-plane/src/memory/ops/ packages/control-plane/src/api/routes/memory-ops.ts packages/control-plane/src/api/server.ts packages/control-plane/src/index.ts packages/control-plane/src/audit/log-retention.ts .env.example
git commit -m "feat(memory-ops): PR D — jobs CRUD, BullMQ, SSE, preview endpoint, capabilities route"
git push origin agent/claude-1/feat/memory-ops-pr-d
gh pr create --base main \
  --title "feat(memory-ops): PR D — job orchestration infrastructure" \
  --body "BullMQ queue, JobsRepository (advisory lock + fleet check + cancel state machine), SSE streaming, preview endpoint, capabilities. ENABLED_JOB_KINDS='' — no jobs run yet."
```
