# Memory Operations UI — v5 Design

> **Status:** candidate for implementation.
> **v4 → v5 delta:** Round-5 reviews (R1: 10 P0, 20 P1, 14 P2; R2: 4 P0, 10 P1, 14 P2) found: BullMQ enqueue wrong call signature, durable cancel state missing, egress confirmation flow structurally impossible, drawer-backfill estimate used wrong data source, sourceRoot prefix-confusion bypass, SIGNING_SECRET boot-fatal broke rollout, LITELLM_URL fallback contradicted v4 goal, web client never gained `details`, false race-window mitigation claim, advisory-lock ALREADY_RUNNING missing details. All addressed in v5. Appendix E is the round-5 disposition log.
> **Review source files:** v3 reviews → [R1](../reviews/2026-04-24-memory-operations-ui-design-v3-strict-review.md), [R2](../reviews/2026-04-24-memory-operations-ui-design-v3-strict-review-round-2.md). v4 reviews → [R1](../reviews/2026-04-24-memory-operations-ui-design-v4-strict-review.md), [R2](../reviews/2026-04-25-memory-operations-ui-design-v4-strict-review.md). All files now committed on this branch.

## 1. Problem

`memory_facts` rows with `embedding IS NULL`: 19,226 on the operator's laptop as of 2026-04-24; drawers and edges not populated. **Semantic/vector-dependent** surfaces on `/memory/graph`, drawer search, `MemorySearch.vectorSearch`, and consolidation's near-duplicate detection are empty or degraded. Non-vector features of `MemoryMaintenance.run` and `MemorySynthesis.runSynthesis` DO function without a provider; the degradation is partial, not total.

Root cause: no UI path to configure an embedding provider and no UI path to trigger maintenance jobs.

## 2. Goals

- Configure embedding providers (OpenAI, Gemini AI Studio) from Settings. Per-machine, encrypted at rest.
- Trigger + observe memory maintenance jobs from `/memory/operations`.
- All memory read/write paths resolve the active embedding provider from the DB.
- Ship critical path PR A → PR B → PR C → PR D → PR E so the 19,226-fact backfill runs after PR E.

## 3. Non-Goals (v1)

- iOS UI; providers beyond OpenAI + Gemini; cross-peer credential replication; `vector(1536)` schema migration; user-supplied `baseUrl`; swapping provider model with existing embeddings; cost budgets; scheduled runs; multiple simultaneous active providers; hash-chained audit log; crash-resumable workers; cross-peer job takeover; Gemini in UI before live dimension contract verified; arbitrary `sourceRoot` paths.

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Web (Next.js App Router)                                         │
│  Settings → Memory & Embeddings   /memory/operations             │
│  <MissingEmbeddingAlert /> on 8 views (§13.4)                    │
└──────────────┬───────────────────────────────┬───────────────────┘
               │ HTTP + SSE (same-peer only)   │
               ▼                               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Control plane (Fastify, per-machine)                             │
│                                                                  │
│  /api/memory/providers           CRUD + /test + /test-ephemeral  │
│  /api/memory/ops/jobs            CRUD + /cancel + /stream        │
│  /api/memory/ops/jobs/preview    egress preview + token          │
│  /api/memory/ops/capabilities    fleet status snapshot           │
│             │                                                    │
│             ▼                                                    │
│  memory-ops BullMQ Worker  (in-process, concurrency=1)           │
│    handlers: embedding-backfill, drawer-backfill,                │
│              consolidation, synthesis                            │
│             │                                                    │
│             ▼                                                    │
│  resolveEmbeddingClient({ pool, encKey, credentialId? })         │
│  Used by: memory-ops workers, MemorySearch, MemoryStore.addFact, │
│           drawer-store writes, drawer-search                     │
└──────────────────────────────────────────────────┬───────────────┘
                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│ PostgreSQL                                                       │
│  api_accounts (+ credential_kind, + credential_last4)            │
│  memory_ops_jobs (mesh-synced; + cancel_requested_at)            │
│  memory_ops_job_events (LOCAL-ONLY)                              │
│  memory_ops_audit (LOCAL-ONLY)                                   │
│  memory_facts.embedding / content_model (raw SQL only)           │
│  memory_drawers.embedding / embedding_model                      │
└──────────────────────────────────────────────────────────────────┘
```

**Concurrency story.** BullMQ queue namespaced per Redis DB (verified `tier-config.ts:99` `extractRedisDb`). Each tier runs one CP with one worker at `concurrency=1`. At most one job runs per CP at any time.

**Worker process model.** In-process with CP for v1. Boot-time reconciliation (in order, before `fastify.listen()` is called — see §5.2):
1. `UPDATE memory_ops_jobs SET status='failed', error_code='CP_RESTART_DURING_RUN', finished_at=now() WHERE status='running' AND executor_machine_id = $machineId`.
2. For each `queued` job row where `executor_machine_id=$machineId`: call `queue.getJob(jobId)` — if null (Redis lost it), re-enqueue with `queue.add(kind, { dbJobId }, { jobId: id, deduplication: { id } })`. If Redis unavailable during this pass, skip re-enqueue and continue — CP does not fail to start due to Redis unavailability.

`$machineId` throughout this spec = `getMachineId()` from `packages/control-plane/src/sync/machine-identity.ts:11`.

## 5. Data Model

### 5.1 `api_accounts` extensions

Table: `packages/control-plane/src/db/schema.ts:443` (`apiAccounts`). Local-only per `sync.ts:182`.

**Migration `0033_add_memory_ops.sql` (PR A, four statement groups):**

```sql
-- Group A — api_accounts extensions
ALTER TABLE api_accounts
  ADD COLUMN credential_kind text NOT NULL DEFAULT 'runtime',
  ADD CONSTRAINT api_accounts_kind_check
    CHECK (credential_kind IN ('runtime', 'embedding')),
  ADD COLUMN credential_last4 text;

CREATE UNIQUE INDEX api_accounts_one_active_embedding
  ON api_accounts (credential_kind)
  WHERE is_active = true AND credential_kind = 'embedding';

CREATE INDEX idx_api_accounts_kind ON api_accounts (credential_kind);

-- Group B — memory_ops_jobs
CREATE TABLE memory_ops_jobs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                      text NOT NULL
                            CHECK (kind IN ('embedding-backfill','drawer-backfill',
                                            'consolidation','synthesis')),
  status                    text NOT NULL
                            CHECK (status IN ('queued','running','cancelling',
                                              'completed','failed','cancelled')),
  params                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress                  jsonb NOT NULL
                            DEFAULT '{"processed":0,"embedded":0,"failed":0,"total":0,
                                      "costUsd":0,"usageEstimated":false}'::jsonb,
  result                    jsonb,
  error                     text,
  error_code                text,
  credential_id             uuid,
  provider_kind             text,
  provider_model            text,
  provider_host             text,
  price_usd_per_mtoken      numeric(12,8),
  origin_machine_id         text NOT NULL,
  executor_machine_id       text NOT NULL,
  cancel_requested_at       timestamptz,   -- durable cancel signal for worker
  started_at                timestamptz,
  finished_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  egress_confirmed_at       timestamptz,
  egress_confirmed_by       text,
  egress_snapshot           jsonb          -- per-kind; see §6.2 for shape
);

CREATE INDEX idx_memory_ops_jobs_status_executor
  ON memory_ops_jobs (status, executor_machine_id);
CREATE INDEX idx_memory_ops_jobs_kind_created
  ON memory_ops_jobs (kind, created_at DESC);
CREATE INDEX idx_memory_ops_jobs_kind_scope_status
  ON memory_ops_jobs ((COALESCE(params->>'scope','')), kind, status);

CREATE TRIGGER sync_capture
  AFTER INSERT OR UPDATE OF status, result, finished_at, error, error_code,
                             cancel_requested_at
     OR DELETE
  ON memory_ops_jobs
  FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

-- Group C — memory_ops_job_events (LOCAL-ONLY)
CREATE TABLE memory_ops_job_events (
  event_id   bigserial PRIMARY KEY,
  job_id     uuid NOT NULL REFERENCES memory_ops_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL
             CHECK (event_type IN ('started','progress','log','completed',
                                   'failed','cancelled','cancelling')),
  level      text CHECK (level IN ('info','warn','error')),
  message    text,
  progress   jsonb,
  payload    jsonb,         -- bounded to 64 KB; for result overflow
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_ops_job_events_job ON memory_ops_job_events (job_id, event_id);
-- NO sync_capture trigger. NOT in TABLE_SYNC_CONFIG.

-- Group D — memory_ops_audit (LOCAL-ONLY)
CREATE TABLE memory_ops_audit (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor     text NOT NULL,
  action    text NOT NULL,
  target    text NOT NULL,
  context   jsonb NOT NULL DEFAULT '{}'::jsonb,
  timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_ops_audit_action_ts ON memory_ops_audit (action, timestamp DESC);
CREATE INDEX idx_memory_ops_audit_target ON memory_ops_audit (target);
-- LOCAL-ONLY. NO sync_capture. Not in TABLE_SYNC_CONFIG.
```

### 5.2 Mesh ownership and fleet-wide exclusion (R1-P0-1, R1-P0-2, R2-P0-2 fixes)

**Owner model:** `origin_machine_id = executor_machine_id = getMachineId()` set at INSERT. v1: jobs always run on their origin peer. v1.1 adds cross-peer takeover.

**Fleet-wide exclusion — honest statement:** The `memory_ops_jobs` table is mesh-synced. Before inserting a write-kind job (`embedding-backfill`, `drawer-backfill`), the POST handler does:

```sql
SELECT id, executor_machine_id
FROM memory_ops_jobs
WHERE kind = $kind
  AND COALESCE(params->>'scope', '') = $normalizedScope
  AND status IN ('queued', 'running', 'cancelling');
```

If any row is found (any machine), throw `ControlPlaneError('JOB_ALREADY_RUNNING')`.

**Race window — unmitigated in v1:** Two peers that both reach this SELECT before either has committed their INSERT will each see zero rows and both proceed to INSERT. This is a real race. Its consequence: each peer embeds a different subset of null-embedding rows with its own active provider's model, producing mixed model vectors in the HNSW index — exactly the corruption scenario described as the P0-1 problem. The `WHERE f.embedding IS NULL` guard in the batch UPDATE only prevents a fact from being embedded TWICE by the same worker; it offers zero protection against two workers each claiming DIFFERENT null rows. **Do not present this guard as a mitigation.** v1.1 closes the window with a Redis `SET NX PX` distributed lock on a fleet-shared Redis instance, or a PostgreSQL serialization table. Until v1.1 ships, operators MUST NOT run concurrent embedding-backfill jobs across peers with different active providers.

For SQL-only kinds (`consolidation`, `synthesis`), no fleet check is needed. Local advisory lock suffices.

**Outbox enqueue pattern (R1-P0-2 / BullMQ signature fix):** BullMQ `Queue.add(name, data, opts)`. The `jobId` must go in the third `opts` argument, NOT in `data`. If placed in `data`, BullMQ generates its own id and `queue.getJob(dbJobId)` returns null, breaking boot recovery.

```
Phase 1 — inside db.transaction():
  1. SELECT pg_try_advisory_xact_lock(hashtext('memory-ops:' || $kind || ':' || $normalizedScope)::bigint) AS acquired
     If false → throw ControlPlaneError('CONCURRENT_JOB_REQUEST')  ← separate code from ALREADY_RUNNING
  2. Fleet-check SELECT (write kinds only)
     If found → throw ControlPlaneError('JOB_ALREADY_RUNNING', context: { existingJobId, existingMachine })
  3. Resolve active provider (write kinds); persist credential_id, provider_kind, provider_model,
     provider_host, price_usd_per_mtoken, egress_snapshot (per-kind builder — see §6.2 preview)
  4. INSERT memory_ops_jobs row, status='queued'
  [commit]

Phase 2 — after commit:
  5. await bullmqQueue.add(kind, { dbJobId: insertedId }, { jobId: insertedId })
     On enqueue failure → UPDATE memory_ops_jobs SET status='failed',
                          error_code='QUEUE_ENQUEUE_FAILED', finished_at=now()
                          WHERE id=$insertedId AND status='queued'
```

`CONCURRENT_JOB_REQUEST` (advisory-lock path, 409): no `existingJobId` — the competing request is in-flight on the same machine and has no committed row yet. `JOB_ALREADY_RUNNING` (fleet-check path, 409): `details = { existingJobId, existingMachine }`.

**Durable cancel (R1-P0-3 fix):** `cancel_requested_at` is the durable cancel signal. Worker handlers poll `JobsRepository.isCancelRequested(jobId)` between batches. Cancel route:
1. If `status='queued'`: UPDATE to `status='cancelled', finished_at=now()` directly (no worker started).
2. If `status='running'` or `status='cancelling'`: UPDATE `cancel_requested_at=now(), status='cancelling'`.
3. If already terminal: 409 `JOB_NOT_CANCELLABLE`.

Worker, between batches: `SELECT cancel_requested_at FROM memory_ops_jobs WHERE id=$id`. If non-null → stop processing → `JobsRepository.transition(id, 'cancelled')`. The `transition` method enforces legal state machine via `WHERE status IN ('running','cancelling')`. A natural handler return after `cancel_requested_at` is set: the method `transition(id, 'completed')` must check `cancel_requested_at IS NULL` — if set, it transitions to `cancelled` instead. This prevents complete-after-cancel race.

**Scope storage:** always store `params.scope = normalizedScope` (never null). Fleet-check uses `COALESCE(params->>'scope','') = $normalizedScope` defensively.

**Boot reconciliation is synchronous before `fastify.listen()` (R2-P1-10 fix):** boot pass completes before server accepts HTTP. A POST /jobs arriving while boot is running is impossible; boot is a blocking init step.

### 5.3 Progress shape

```typescript
type MemoryOpsProgress = {
  processed: number;      // units attempted (facts for backfill, chunks for drawer-backfill)
  embedded: number;       // successfully written
  failed: number;         // per-unit failures within retry budget
  total: number;          // eligible work snapshot at job start (0 = valid; completes immediately)
  costUsd: number;        // accumulated
  usageEstimated: boolean; // true when token count is chars/4
  etaSeconds?: number;
  currentBatch?: number;
};
```

Per-kind `processed` unit: `embedding-backfill` = facts; `drawer-backfill` = source chunks; `consolidation` = candidates; `synthesis` = synthesis groups.

### 5.4 Drizzle schema additions (PR A)

`apiAccounts` additions:
```typescript
credentialKind: text('credential_kind').notNull().default('runtime'),
credentialLast4: text('credential_last4'),
```

`memoryOpsJobs`:
```typescript
export const memoryOpsJobs = pgTable('memory_ops_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
  progress: jsonb('progress').notNull().default(sql`'{"processed":0,"embedded":0,"failed":0,"total":0,"costUsd":0,"usageEstimated":false}'::jsonb`),
  result: jsonb('result'),
  error: text('error'),
  errorCode: text('error_code'),
  credentialId: uuid('credential_id'),
  providerKind: text('provider_kind'),
  providerModel: text('provider_model'),
  providerHost: text('provider_host'),
  priceUsdPerMtoken: numeric('price_usd_per_mtoken', { precision: 12, scale: 8 }),
  originMachineId: text('origin_machine_id').notNull(),
  executorMachineId: text('executor_machine_id').notNull(),
  cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  egressConfirmedAt: timestamp('egress_confirmed_at', { withTimezone: true }),
  egressConfirmedBy: text('egress_confirmed_by'),
  egressSnapshot: jsonb('egress_snapshot'),
}, (table) => [
  index('idx_memory_ops_jobs_status_executor').on(table.status, table.executorMachineId),
  index('idx_memory_ops_jobs_kind_created').on(table.kind, table.createdAt),
  // Expression index — raw SQL; managed by hand-written migration.
  // Future db:generate runs must not DROP this index. Document in migration note.
  // index('idx_memory_ops_jobs_kind_scope_status') — see migration SQL.
]);
```

**Note on expression index:** `idx_memory_ops_jobs_kind_scope_status` uses `COALESCE(params->>'scope','')`, a JSONB expression that Drizzle cannot express in `index().on()` syntax without a raw SQL escape. This index is defined only in the hand-written migration SQL. Add a comment in the Drizzle table file: `// CAUTION: idx_memory_ops_jobs_kind_scope_status is a raw-SQL expression index in migration 0033. Never drop it.` This prevents a future `drizzle-kit generate` diff from emitting `DROP INDEX`.

`memoryOpsJobEvents` (R2-P1-1 fix):
```typescript
export const memoryOpsJobEvents = pgTable('memory_ops_job_events', {
  eventId: bigserial('event_id', { mode: 'bigint' }).primaryKey(),
  jobId: uuid('job_id').notNull().references(() => memoryOpsJobs.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  level: text('level'),
  message: text('message'),
  progress: jsonb('progress'),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_memory_ops_job_events_job').on(table.jobId, table.eventId),
]);
// NOT in TABLE_SYNC_CONFIG. No sync_capture trigger.
```

`memoryOpsAudit` (R2-P1-2 fix):
```typescript
export const memoryOpsAudit = pgTable('memory_ops_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  target: text('target').notNull(),
  context: jsonb('context').notNull().default(sql`'{}'::jsonb`),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_memory_ops_audit_action_ts').on(table.action, table.timestamp),
  index('idx_memory_ops_audit_target').on(table.target),
]);
// LOCAL-ONLY. Not in TABLE_SYNC_CONFIG. No sync_capture trigger.
```

### 5.5 `TABLE_SYNC_CONFIG` update (PR A)

```typescript
memory_ops_jobs: 'mutable',
// memory_ops_job_events: intentionally absent (LOCAL-ONLY)
// memory_ops_audit: intentionally absent (LOCAL-ONLY)
```

### 5.6 Migration rollback

`0033_add_memory_ops.down.sql`:
```sql
DROP TABLE IF EXISTS memory_ops_job_events;
DROP TABLE IF EXISTS memory_ops_jobs;
DROP TABLE IF EXISTS memory_ops_audit;
DROP INDEX IF EXISTS api_accounts_one_active_embedding;
DROP INDEX IF EXISTS idx_api_accounts_kind;
ALTER TABLE api_accounts
  DROP COLUMN IF EXISTS credential_last4,
  DROP CONSTRAINT IF EXISTS api_accounts_kind_check,
  DROP COLUMN IF EXISTS credential_kind;
```

Rollback verification: assert all four tables, indexes, constraints, and added columns removed; existing `api_accounts` rows survive with original columns.

## 6. API Contract

Routes registered in `server.ts` under `db + pgPool + encryptionKey` guard. Provider routes additionally receive `pgPool` for raw SQL model-distribution queries. Pattern matches `accountRoutes` at `server.ts:828-847`.

### 6.1 `/api/memory/providers` (PR B)

```
GET    /                    -> 200 { providers: EmbeddingProvider[] }
POST   /                    -> 201 { provider: EmbeddingProvider }
                                409 DUPLICATE_ACTIVE_EMBEDDING
                                422 VALIDATION_ERROR
POST   /test-ephemeral      -> 200 { ok, dim, model, costUsd, latencyMs, signedToken }
                                401 PROVIDER_AUTH_FAILED
                                422 VALIDATION_ERROR
                                429 RATE_LIMITED (5/min per IP)
                                503 SIGNING_SECRET_MISSING (if MEMORY_OPS_SIGNING_SECRET absent)
PATCH  /:id                 -> 200 { provider }
                                404 PROVIDER_NOT_FOUND
                                409 PROVIDER_HAS_ACTIVE_JOBS | MODEL_MISMATCH | DUPLICATE_ACTIVE_EMBEDDING
                                422 VALIDATION_ERROR
DELETE /:id                 -> 204 | 404 PROVIDER_NOT_FOUND | 409 PROVIDER_HAS_ACTIVE_JOBS
POST   /:id/test            -> 200 { ok, dim, model, costUsd, latencyMs }
                                401 PROVIDER_AUTH_FAILED
                                404 PROVIDER_NOT_FOUND
                                429 RATE_LIMITED (5/min per IP)
```

**`MEMORY_OPS_SIGNING_SECRET` — route-disable, not boot-fatal (R1-P0-7 fix):** If `MEMORY_OPS_SIGNING_SECRET` is absent at runtime, `POST /test-ephemeral` returns 503 `SIGNING_SECRET_MISSING`. Provider creation without `recentTestResult` continues to work. CP boots cleanly. Operators provision the secret before using test-before-save. Add rollout acceptance: "CP with old env file (no `MEMORY_OPS_SIGNING_SECRET`) starts and serves all routes except `/test-ephemeral`."

**`/test-ephemeral` signed token format:** `{ provider, model, apiKeyFingerprint: hmac(secret, apiKey), dim, ok, testedAt: Date.now() }`. Expiry 5 minutes.

**`recentTestResult` — server validation (R1-P1-1, R1-P1-2, R2-P1-3 fixes):** Server MUST verify:
1. `hmac(secret, submittedApiKey) === token.apiKeyFingerprint`.
2. `Date.now() - token.testedAt < 300_000` (5 minutes). If expired: 422 `VALIDATION_ERROR` with `issues[0].message = 'recentTestResult expired'`.

If `recentTestResult` is valid, persist test metadata (`lastTestOk: true`, `lastTestError: null`, `lastTestedAt`, `dim`, `model`, `latencyMs`) to `api_accounts.metadata`. Do NOT reset to null in this path.

If `recentTestResult` is absent or invalid (and not required), still create the provider but without test metadata.

**PATCH field matrix (R1-P1-1 fix):**

| Field | Condition | Effect |
|---|---|---|
| `apiKey` | without valid `recentTestResult` | re-encrypt, recompute `credential_last4`, reset `lastTestOk=null`, `lastTestError=null`, `lastTestedAt=null` |
| `apiKey` | with valid `recentTestResult` | re-encrypt, recompute `credential_last4`, persist successful test metadata (NO reset to null) |
| `name` | — | write name |
| `model` | — | server model-lock check (§8); 409 `MODEL_MISMATCH` or `PROVIDER_HAS_ACTIVE_JOBS` if blocked |
| `active=true` | — | run model-lock check; atomically deactivate other embedding rows in same TX; set target active; 409 `DUPLICATE_ACTIVE_EMBEDDING` only if DB constraint fires (concurrent request edge case); 409 `MODEL_MISMATCH` if lock check fails |
| `active=false` | — | 409 `PROVIDER_HAS_ACTIVE_JOBS` with `details.blockingJobIds` if jobs reference this credential; else flip |

**Provider activation — switch mode (R1-P1-9 fix):** `PATCH /:id { active: true }` atomically deactivates all other `credential_kind='embedding'` rows in the same transaction, then activates the target. This avoids the operator needing to deactivate the old provider first. The DB partial unique index is a last-resort guard for concurrent same-request races (should not normally fire with switch-mode).

**Test-before-save server enforcement (R1-P1-10 fix):** Creating an active provider without `recentTestResult` is allowed in v1 (no server enforcement). However, job creation checks provider health: if the active provider has `lastTestOk=false` (not null — null means never tested, which is allowed), POST `/jobs` returns 409 `PROVIDER_AUTH_FAILED`. This makes "deliberately broken provider" a job-time gate, not a creation gate. Document in UI: "We recommend testing before saving. Untested providers may fail when jobs start."

**Manual test deactivation (R1-P1-9 carried):** `POST /:id/test` returning 401 sets `metadata.lastTestOk=false` and `lastTestError`. It does NOT flip `is_active=false`. Deactivation requires an explicit `PATCH /:id { active: false }` which has the active-job guard.

**EmbeddingClient auth and request shape (R1-P1-18 fix):** When `apiKey` is provided, client sets `Authorization: Bearer ${apiKey}`. `extraBody` is merged AFTER the base body `{ model, input }` — catalog fields cannot override `model` or `input`. Tests: OpenAI request shape (no extraBody), Gemini request shape (extraBody with `output_dimensionality: 1536`).

**Provider response type `EmbeddingProvider` (R1-P1-13):**
```typescript
type EmbeddingProvider = {
  id: string;                 // uuid
  name: string;
  provider: 'openai' | 'gemini';
  model: string;
  apiKeyLast4: string | null;
  isActive: boolean;
  metadata: EmbeddingProviderMetadata;
  createdAt: string;
  updatedAt: string;
};
type EmbeddingProviderMetadata = {
  lastTestOk: boolean | null;
  lastTestError: string | null;
  lastTestedAt: string | null;
  dim: number | null;
  latencyMs: number | null;
  costUsd: number | null;
};
```

DB snake_case (`last_test_ok`) → API camelCase (`lastTestOk`) transform applied in route serializer.

**MODEL_MISMATCH `details` across both tables (R1-P1-7 fix):**
```typescript
// details shape for MODEL_MISMATCH:
{ existingModels: Array<{ table: 'memory_facts'|'memory_drawers', model: string, count: number }>, incomingModel: string }
```
Combined distribution query:
```sql
SELECT 'memory_facts' AS tbl, content_model AS model, COUNT(*) AS c
FROM memory_facts WHERE embedding IS NOT NULL GROUP BY content_model
UNION ALL
SELECT 'memory_drawers', embedding_model, COUNT(*)
FROM memory_drawers WHERE embedding IS NOT NULL GROUP BY embedding_model;
```
If the combined set has exactly one distinct model and it equals `incomingModel`, activation is allowed. If it has one model and it differs, `MODEL_MISMATCH`. If it has ≥ 2 models, `MODEL_MISMATCH` with all models listed.

### 6.2 `/api/memory/ops/jobs` and `/api/memory/ops/capabilities` (PR D)

**Top-level POST /jobs body schema (R2-P1-4 fix):**
```typescript
const memoryOpsJobCreateSchema = z.object({
  kind: z.enum(['embedding-backfill','drawer-backfill','consolidation','synthesis']),
  previewToken: z.string().optional(),      // required for write kinds; see preview endpoint
  egressConfirmed: z.boolean().default(false), // must be true for write kinds
  params: memoryOpsJobParamsSchema,          // discriminated union per kind (§6.3)
});
```

**`ENABLED_JOB_KINDS` mechanism (R2-P1-5 fix):** `ENABLED_JOB_KINDS` is parsed from the env var `MEMORY_OPS_ENABLED_KINDS` (comma-separated, e.g. `"embedding-backfill,drawer-backfill"`). Module `src/memory/ops/config.ts` exports:
```typescript
export const MEMORY_OPS_ENABLED = process.env.MEMORY_OPS_ENABLED === 'true';
export const ENABLED_JOB_KINDS = new Set(
  (process.env.MEMORY_OPS_ENABLED_KINDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
) as Set<MemoryOpsJobKind>;
```
PR D: ships `MEMORY_OPS_ENABLED_KINDS=` (empty). PR E: `MEMORY_OPS_ENABLED_KINDS=embedding-backfill,drawer-backfill`. PR G: `MEMORY_OPS_ENABLED_KINDS=embedding-backfill,drawer-backfill,consolidation,synthesis`. `MEMORY_OPS_ENABLED=false` disables `POST /jobs` entirely; `ENABLED_JOB_KINDS` controls which kinds are accepted within that.

```
POST   /api/memory/ops/jobs/preview  -> 200 { snapshot, previewToken }
                                          400 EGRESS_NOT_CONFIRMED (if egressConfirmed=false?)
                                            Note: preview does NOT require egressConfirmed;
                                            it only computes the estimate.
                                          409 EMBEDDING_NO_PROVIDER
                                          422 VALIDATION_ERROR

POST   /api/memory/ops/jobs          -> 201 { job: MemoryOpsJob }
                                         400 EGRESS_NOT_CONFIRMED
                                         400 FEATURE_DISABLED
                                         400 JOB_KIND_NOT_ENABLED (with details.enabledKinds)
                                         400 EGRESS_SNAPSHOT_STALE (snapshot changed vs previewToken)
                                         409 EMBEDDING_NO_PROVIDER
                                         409 CONCURRENT_JOB_REQUEST (advisory-lock path)
                                         409 JOB_ALREADY_RUNNING (fleet-check path, details: {existingJobId,existingMachine})
                                         422 VALIDATION_ERROR

GET    /api/memory/ops/jobs          -> 200 { jobs: MemoryOpsJob[] }
                                         Filters: kind (repeatable), status (repeatable or comma-separated),
                                         limit (≤200, default 50), localOnly (bool; filters by executor_machine_id=local)

GET    /api/memory/ops/capabilities  -> 200 {
                                           enabled: bool,
                                           enabledKinds: MemoryOpsJobKind[],
                                           machineId: string,
                                           hasActiveProvider: bool,
                                           activeProviderModel?: string,
                                           activeProviderLastTestOk: bool | null,
                                           fleetJobsByKindAndScope: Array<{
                                             kind: MemoryOpsJobKind;
                                             scope: string;        // normalizedScope
                                             queued: number;
                                             running: number;
                                             cancelling: number;
                                           }>
                                         }

GET    /api/memory/ops/jobs/:id      -> 200 { job } | 404 JOB_NOT_FOUND

POST   /api/memory/ops/jobs/:id/cancel -> 200 { status: 'cancelled'|'cancelling', job }
                                           403 REMOTE_PEER_JOB
                                           404 JOB_NOT_FOUND
                                           409 JOB_NOT_CANCELLABLE

GET    /api/memory/ops/jobs/:id/stream -> text/event-stream
                                          same-peer only; Last-Event-Id respected
                                          403 REMOTE_PEER_JOB if executor_machine_id ≠ local
                                          initial event: type=peer { machineId, eventSequenceStart }
```

**`capabilities.fleetJobsByKindAndScope` (R1-P1-3 fix):** Returns per-kind-per-scope fleet counts. UI evaluates JobCard disabled state per the job kind AND the currently-selected scope:

| Kind | Disabled when |
|---|---|
| `embedding-backfill`, `drawer-backfill` | `!enabled` OR (`hasActiveProvider=false` OR `activeProviderLastTestOk=false`) OR `fleetJobsByKindAndScope` has entry matching kind+selectedScope with `queued+running+cancelling > 0` |
| `consolidation`, `synthesis` | `!enabled` OR local GET /jobs returns a non-terminal job of that kind+scope |

**Preview endpoint (R1-P0-4 fix):** `POST /api/memory/ops/jobs/preview` accepts `{ kind, params }` (no egressConfirmed). Returns:
```typescript
type JobPreviewResponse = {
  snapshot: EgressSnapshot;
  previewToken: string;  // HMAC(MEMORY_OPS_SIGNING_SECRET, JSON.stringify(snapshot) + timestamp)
  expiresAt: string;     // 10 minutes
};
type EgressSnapshot = {
  kind: 'embedding-backfill' | 'drawer-backfill';
  providerKind: string;
  providerModel: string;
  providerHost: string;
  priceUsdPerMtoken: number;
  rowCount?: number;           // embedding-backfill: eligible facts
  chunkCount?: number;         // drawer-backfill: estimated chunks
  fileCount?: number;          // drawer-backfill: resolved source files
  totalBytes?: number;         // drawer-backfill: total bytes
  tokenEstimate: number;       // chars/4 heuristic
  costEstimate: number;        // tokenEstimate/1e6 * priceUsdPerMtoken
  contentClass: string;        // 'memory-facts' | 'drawer-source-files'
  computedAt: string;
};
```

UI shows `snapshot` content in the egress dialog. POST `/jobs` then includes `previewToken` + `egressConfirmed: true`. Server verifies `previewToken`, recomputes the snapshot, and rejects with `EGRESS_SNAPSHOT_STALE` if `rowCount`, `providerModel`, or `providerHost` changed materially (>10% row count delta or any provider change). If `MEMORY_OPS_SIGNING_SECRET` is absent, preview endpoint returns 503 `SIGNING_SECRET_MISSING` and the UI shows egress estimates without a bound token (user must check `egressConfirmed` without staleness protection).

**Per-kind egress snapshot builders (R1-P0-5 fix):**
- `embedding-backfill`: `SELECT COUNT(*) FROM memory_facts WHERE embedding IS NULL` (scoped if `params.scope` provided). Chars from a random 1 % sample × 100.
- `drawer-backfill`: Walk `sourceRoot` (already validated, see §6.3). Count files, sum bytes, estimate chunks from byte count ÷ average chunk size (configurable, default 2000 chars). Do NOT use `memory_facts` counts.

**`PROVIDER_RATE_LIMITED` call site (R2-P1-6 fix):** This code is a **job-row `error_code`**, not an HTTP response code from the API. When the embedding provider API returns 429 during a worker batch, the handler applies exponential backoff up to 3 retries, then sets `job.error_code='PROVIDER_RATE_LIMITED'` and transitions to `status='failed'`. The route-level 429 is only `RATE_LIMITED` (our own rate limit on test endpoints). Remove `PROVIDER_RATE_LIMITED` from the §14 HTTP response table; add a note: "used as a `job.error_code` stored in DB on upstream 429 exhaustion."

**SSE stream for remote peer (R2-P1-7 fix):** `GET /api/memory/ops/jobs/:id/stream` returns 403 `REMOTE_PEER_JOB { executorMachineId }` if `job.executor_machine_id ≠ getMachineId()`. UI must not attempt streaming for remote jobs; show the job row's synced status and final progress instead.

**SSE plumbing:** `pg_notify` fires in the same transaction as every `memory_ops_jobs` write AND every `memory_ops_job_events` insert. No "when possible" — always same transaction. Payload = job_id only.

**Cancel route semantics:** returns 200 `{ status: 'cancelled'|'cancelling', job }`. Queued jobs cancelled immediately (status='cancelled'). Running jobs set cancel_requested_at (status='cancelling') and the response reflects that intermediate state. Test: complete-after-cancel race: if `cancel_requested_at IS NOT NULL`, `JobsRepository.transition(id,'completed')` transitions to `cancelled` instead.

**Peer read-only progress (R1-P1-14 fix):** Remote peers see only the synced `status` and final `progress` (synced on job completion). Live progress events and log streaming are available on the executor peer only. Acceptance: "A job on peer A syncs to peer B with status and final progress only; GET /jobs/:id/stream on peer B returns 403 REMOTE_PEER_JOB."

### 6.3 Shared types (PR A)

**`EMBEDDING_MODEL_CATALOG`** with `verified` flag (R1-P0-10 fix):

| provider | model | dim | baseUrl | embeddingsPath | extraBody | $/Mtok | verified |
|---|---|---|---|---|---|---|---|
| openai | text-embedding-3-small | 1536 | `https://api.openai.com` | `/v1/embeddings` | `{}` | 0.02 | true |
| gemini | gemini-embedding-001 | 1536 | `https://generativelanguage.googleapis.com/v1beta/openai` | `/embeddings` | `{ output_dimensionality: 1536 }` | 0.15 | **false** |

The `verified: false` flag makes Gemini hidden from the Settings UI until Gate 2 passes. The catalog entry ships in PR A; `MemoryEmbeddingsSection.tsx` filters to `verified: true` entries only. Gate 2 (live dimension contract with `GEMINI_API_KEY` in CI) flips `verified: true` and exposes Gemini in the UI.

**Gate 1** (required before PR A merges): HTTP request to `https://generativelanguage.googleapis.com/v1beta/openai/embeddings` with fake key → assert `401 Unauthorized` (not 404/ENOTFOUND). Proves URL and path are correct.

**Gate 2** (required before `verified: true` flip, can be a follow-on commit): real `GEMINI_API_KEY` → assert response vector length = 1536, response model = catalog model, `output_dimensionality` honored. If compat layer ignores `output_dimensionality`, switch catalog entry to `gemini-embedding-2-preview` and re-run.

`validateCatalog()` runs at boot: every `verified: true` entry has `dim === 1536`; throws `Error('CATALOG_INVALID: ...')` if not. This throw is allowed to propagate uncaught — CP must not start with an invalid catalog. PM2 will restart; error visible in `pm2 logs`.

`embeddingProviderCreateSchema`: `.strict()` (no `baseUrl`). `.superRefine` checks `(provider, model)` in catalog AND `catalog.verified === true`; 422 `VALIDATION_ERROR` with `issues[0].message='provider not verified'` if Gemini is unverified.

**`scopeNormalize` module (R2-P2-5 fix):** exported from `packages/shared/src/memory/ops.ts`. Add to PR A scope in Appendix A.

**`drawer-backfill.sourceRoot` path containment (R1-P0-6 fix):** At boot, canonicalize every configured root: `MEMORY_OPS_DRAWER_SOURCE_ROOTS.split(':').map(r => fs.realpathSync(r))`. On request:
1. `const resolvedPath = fs.realpathSync(sourceRoot)` — throws if symlink escape or non-existent.
2. `const rel = path.relative(canonicalRoot, resolvedPath)` for each configured root.
3. Require `rel === ''` or `(!rel.startsWith('..') && !path.isAbsolute(rel))`. Pure prefix check (`startsWith`) is NOT sufficient — `/allowed-evil` starts with `/allowed`.
4. During traversal: `lstat` every candidate file; if symlink, `realpath` and re-check containment; reject non-contained symlink targets.
5. Extension allowlist enforced per file. Byte/file count limits enforced before reading content.

Required tests: `/allowed` vs `/allowed-evil` (must reject), allowed-root symlink escape, nested symlink escape, oversized tree, disallowed extension.

**`memoryOpsJobParamsSchema`** (per-kind discriminated union):

| kind | extra fields | egressConfirmed required |
|---|---|---|
| `embedding-backfill` | `batchSize` (1–500, default 100), `dryRun?` | yes |
| `drawer-backfill` | `sourceType: 'claude-mem'|'jsonl'`, `sourceRoot` (non-empty; containment validated server-side), `batchSize` (default 50) | yes |
| `consolidation` | — | no |
| `synthesis` | — | no |

**Per-kind `requiresProvider`:** embedding-backfill yes, drawer-backfill yes, consolidation no, synthesis no.

**`sessionStorage` egress ack key (R1-P1-19 fix):** key = `memory-ops-egress-ack:${credentialId}:${providerModel}:${kind}:${normalizedScope}:${sourceRootHash}`. Different kind/scope/sourceRoot requires new confirmation even for same credential.

## 7. Embedding Client + Cost Tracking

### 7.1 `EmbeddingClient` extension (PR A, additive only)

Additive changes — default behavior preserved:
- New options: `apiKey?: string` (`Authorization: Bearer ${apiKey}`), `extraBody?: Record<string, unknown>` (merged after base body; cannot override `model`/`input`), `embeddingsPath?: string` (default `/v1/embeddings`).
- New method: `embedBatchWithUsage(texts): Promise<{ vectors, usage: { promptTokens }, model }>`.
- `ControlPlaneError('EMBEDDING_API_ERROR', ...)` context gains `status: number`.
- Existing callers untouched.

### 7.2 Catalog — see §6.3.

### 7.3 `resolveEmbeddingClient` factory (PR B)

```typescript
export async function resolveEmbeddingClient(input: {
  pool: Pool; db: Database; encryptionKey: string; logger: Logger; credentialId?: string;
}): Promise<ResolvedEmbeddingClient>;
```

**Resolution order (R1-P0-8 fix — LITELLM_URL removed):**
1. If `credentialId` provided: fetch that `api_accounts` row, require `credential_kind='embedding'`. If not found → throw `ControlPlaneError('EMBEDDING_CREDENTIAL_NOT_FOUND')`. If found but decrypt fails → throw `ControlPlaneError('EMBEDDING_CREDENTIAL_DECRYPT_FAILED')`.
2. Else: fetch single `is_active=true AND credential_kind='embedding'` row. If none → throw `ControlPlaneError('EMBEDDING_NO_PROVIDER')`.
3. **No LITELLM_URL fallback.** The `LITELLM_URL` env var routes LLM completions through LiteLLM Proxy — it is NOT an embedding source. Its former use as an embedding fallback violated the spec goal (audit, egress, Settings visibility). PR B adds a migration note: "If you relied on `LITELLM_URL` for embedding calls, add an OpenAI provider in Settings → Memory & Embeddings."

**Cache:**
```typescript
const cache = new Map<string, { resolved: ResolvedEmbeddingClient; expiresAt: number }>();
const TTL_MS = 60_000;
// Key = credentialId || 'active'
```
Every provider write clears BOTH the specific `credentialId` key AND `'active'`.

**Invalidation bus lifecycle (R2-P2-9 fix):** `resetBusForTesting()` (1) removes all existing `provider.changed` listeners; (2) clears the cache; (3) re-registers the standard cache-clearing listener. Subsequent tests have a clean listener. `bus.setMaxListeners(3)`.

### 7.3.1 Provider invalidation bus (PR B)

Node `EventEmitter` singleton. One `provider.changed` event type. Exactly one listener registered at module initialization. `resetBusForTesting()` exported for tests. `memoryProvidersRoutes` emits after every successful POST/PATCH/DELETE/test.

### 7.3.2 Memory runtime rewiring (PR B) — complete file list

- `src/index.ts` — drop `if (LITELLM_URL) { embeddingClient = ... }` block.
- `src/memory/memory-search.ts` — factory getter; `vectorSearch` applies `embedding IS NOT NULL AND content_model = $queryModel`; BM25/graph paths have NO `content_model` filter (existing filters removed — see P2-6 audit below).
- `src/memory/memory-store.ts` — `addFact` writes `resolved.model` to `content_model`.
- `src/memory/memory-drawer-store.ts` — `writeSource` writes `resolved.model` to `embedding_model`.
- `src/memory/memory-drawer-search.ts` — factory getter; `embedding IS NOT NULL AND embedding_model = $queryModel`.
- `src/api/routes/memory-drawers.ts` — receives factory getter.
- `src/api/routes/memory-facts.ts:285-290,681-690` — drawer fusion uses factory getter.
- `src/api/server.ts` — passes factory getter; extends `controlPlaneErrorToStatus()`.
- `src/index.ts` — removes LITELLM_URL block.

**Existing non-vector query audit (R2-P2-6):** before PR B merges, grep `MemorySearch.bm25Search`, `MemorySearch.graphSearch`, and `MemorySearch.keywordSearch` (or equivalent method names in `memory-search.ts`) for any `content_model` WHERE clause. Remove any found. Add failing tests: facts with `content_model='old-model'` are still returned by BM25/graph when active provider uses a different model.

**Embedding write path tests:** `addFact` and `writeSource` with a non-default provider (e.g., `gemini-embedding-001`): assert written model = `resolved.model`.

### 7.4 Cost accounting

| Kind | Cost model |
|---|---|
| `embedding-backfill` | `costUsd += usage.promptTokens / 1e6 * priceUsdPerMtoken` (from job row, not mutable catalog) |
| `drawer-backfill` | same |
| `consolidation` | costUsd = 0 |
| `synthesis` | costUsd = 0 |

Worker reads `priceUsdPerMtoken` from the job row (`memory_ops_jobs.price_usd_per_mtoken`), not from a live catalog lookup. This ensures historical accuracy even if catalog prices update.

Token estimate fallback: `Math.ceil(textLength / 4)`, `usageEstimated = true`.

## 8. `content_model` + `embedding_model` Lock and Search Predicate

**Model lock:** `SELECT tbl, model, COUNT(*) FROM (combined query from §6.1) GROUP BY tbl, model`. 0 rows → any provider. 1 distinct model = X → new provider must have `model = X`. ≥ 2 distinct → `MODEL_MISMATCH`. Checked server-side on PATCH/activate.

**Unified search predicate:**
- Vector path: `embedding IS NOT NULL AND content_model = $queryModel` (facts), `embedding IS NOT NULL AND embedding_model = $queryModel` (drawers).
- Non-vector paths (BM25, graph, keyword): NO `content_model` filter.
- `content_model IS NULL` clause removed everywhere (column is `NOT NULL DEFAULT`).

**`MIXED_MODEL_BLOCKED` (409, not 503 — R1-P1-8 fix):** fires when the scoped vector result is empty but embedded rows with a different model exist. Scope-aware (R2-P2-7 fix):
```
if (params.scope): COUNT WHERE embedding IS NOT NULL AND content_model=$q AND scope=$scope
else:              COUNT WHERE embedding IS NOT NULL AND content_model=$q
```
If that COUNT = 0 but global `COUNT WHERE embedding IS NOT NULL > 0` → 409 `MIXED_MODEL_BLOCKED`.

**`<MixedModelsBanner />`:** rendered when combined distribution query returns ≥ 2 distinct models. Text: "Memory facts were embedded with different models. Vector search is restricted to {activeModel}. The re-embed-all job is not yet available in v1; use the manual SQL workaround in /docs."

## 9. Runtime Credential Path Filter (PR A)

All `api_accounts` reads filter by `credential_kind='runtime'`:
- `src/api/routes/{accounts,sessions,oauth,agents}.ts`, `src/scheduler/task-worker.ts`.
- `src/api/routes/settings.ts:81-83` — validates `defaultAccountId` against `api_accounts` with `credential_kind='runtime'` filter; 422 `INVALID_ACCOUNT_KIND` if embedding row. Route: `PUT /api/settings/defaults`, body: `{ defaultAccountId }`.
- `project_account_mappings` write path — same check.

**Actor identity for audit (R1-P1-17 fix):** `actor` = `X-AgentCTL-Actor` request header if present; else `local:${os.hostname()}` for web UI requests (no auth in v1); else `worker:${machineId}` for background worker events. Document in §10.

## 10. Audit Logger (PR A interface + PR B/D impl)

`memory_ops_audit` table is LOCAL-ONLY (Group D in migration — DDL in §5.1).

**`redactSensitiveKeys` module path (R2-P2-3 fix):** exported from `packages/shared/src/memory/ops-audit.ts`. Removes any nested key whose name contains `key`, `token`, `secret`, `password`, `credential` (case-insensitive). Max context size 64 KB; truncate to summary if exceeded.

Interface: single `write(entry)` method. Action enum: `provider.{create,update,delete,rotate-key,test-ephemeral,test-succeeded,test-failed}` + `job.{create,cancel,complete,fail}`.

Retention: 90 days via `log-retention.ts`. Events: 14 days.

## 11. SSRF / Egress Controls

- `baseUrl` not user-configurable (catalog-only; Zod `.strict()`).
- `sourceRoot` restricted to configured paths with `realpath` + `path.relative` containment (§6.3).
- Egress preview + previewToken required for write kinds (§6.2).
- Redaction: drawer writes sanitized; `memory_facts.content` sent as-is post-confirmation.

## 12. Data Egress UI Copy

Before first write-kind job: show egress dialog populated from `POST /api/memory/ops/jobs/preview` response (`snapshot` fields: destination host, row/chunk count, token estimate, cost estimate, content class). Require explicit checkbox. Submit with `previewToken` + `egressConfirmed: true`. Session-storage skip key includes credential, model, kind, scope, sourceRoot hash (§6.3).

## 13. UI Surface

### 13.1 Settings → Memory & Embeddings (PR C — `minor` bump)

- File: `packages/web/src/views/settings/MemoryEmbeddingsSection.tsx`.
- Registered in `SettingsView.tsx:26-67`; `SettingsSection id="memory-embeddings"`.
- Provider list: `useQuery(memoryProvidersQuery())` — only `verified: true` catalog entries shown in Add dialog.
- Add/Edit dialog: test-before-save via `/test-ephemeral`; stores `signedToken`. PATCH with new key: use `/test-ephemeral`.
- Save banner: "This provider will only be available on this machine."

**`core.ts` / `ApiError` update (R1-P0-9 / R2-P0-1 fix — in PR C scope):**
- Add `public details?: Record<string, unknown>` to `ApiError` constructor.
- `core.ts` `request<T>()`: parse `body.details` and pass to `ApiError`. Keep `body.hint` parsing for backward compatibility (existing routes still emit `hint`; future routes emit `details`).
- `packages/web/src/lib/api/core.ts` added to PR C file list.

### 13.2 `/memory/operations` (PR F — `minor` bump)

- View: `packages/web/src/views/MemoryOperationsPage.tsx`.
- JobCard disabled predicate: per §6.2, using `fleetJobsByKindAndScope` from capabilities.
- Peer-owned jobs: read-only; no Cancel; no stream.

**`<MissingEmbeddingAlert />` copy for passive peer (R1-P1-16 fix):** "No embedding provider is configured on this machine. Configure one to run jobs here; remote jobs can still be viewed."

### 13.3 `<MissingEmbeddingAlert />`

Renders when: `!isPending && (providers.length === 0 OR metadata.lastTestOk === false OR metadata.lastTestOk === null)` (R2-P2-8 fix: `isPending` guard added). During `isPending` or `isError`: render nothing.

### 13.4 Alert mount points — 10 views (8 with alert)

| View | File | Alert |
|---|---|---|
| Memory Browser | `packages/web/src/views/MemoryBrowserView.tsx` | Yes |
| Memory Dashboard | `packages/web/src/views/MemoryDashboardView.tsx` | Yes |
| Memory Drawers | `packages/web/src/views/MemoryDrawersView.tsx` | Yes |
| Memory Import | `packages/web/src/views/MemoryImportView.tsx` | **No** |
| Memory Maintenance | `packages/web/src/views/MemoryMaintenancePage.tsx` | Yes |
| Memory Reports | `packages/web/src/views/MemoryReportsView.tsx` | Yes |
| Memory Scope Manager | `packages/web/src/views/MemoryScopeManagerView.tsx` | **No** |
| Memory Synthesis | `packages/web/src/views/MemorySynthesisPage.tsx` | Yes |
| Knowledge Graph | `packages/web/src/views/KnowledgeGraphView.tsx` | Yes |
| Consolidation Board | `packages/web/src/views/ConsolidationBoardView.tsx` | Yes |

### 13.5 Web API client

Barrel: `packages/web/src/lib/api.ts`. Core: `request<T>()` at `core.ts:21`. New: `api/memory-providers.ts`, `api/memory-ops.ts`. Query helpers in `queries.ts` under `queryKeys.memory.*`.

## 14. Error Envelope and Status Map

**Flat envelope:** `{ "error": "STABLE_CODE", "message": "human-readable", "details": { ... } }`. Server emits `details` from `ControlPlaneError.context`. Client `ApiError` carries `details?: Record<string, unknown>` (added in PR C).

**`controlPlaneErrorToStatus()` — Map-based extension (R2-P1-8 fix):** PR B converts the existing pattern-match function to use an explicit Map for new codes (existing patterns retained as fallback):

```typescript
const MEMORY_OPS_STATUS_MAP = new Map<string, number>([
  ['VALIDATION_ERROR', 422],
  ['EMBEDDING_NO_PROVIDER', 409],
  ['PROVIDER_AUTH_FAILED', 401],
  ['RATE_LIMITED', 429],
  ['EMBEDDING_CREDENTIAL_DECRYPT_FAILED', 500],
  ['EMBEDDING_CREDENTIAL_NOT_FOUND', 404],
  ['PROVIDER_HAS_ACTIVE_JOBS', 409],
  ['PROVIDER_NOT_FOUND', 404],
  ['JOB_NOT_FOUND', 404],
  ['JOB_NOT_CANCELLABLE', 409],
  ['REMOTE_PEER_JOB', 403],
  ['CONCURRENT_JOB_REQUEST', 409],
  ['JOB_ALREADY_RUNNING', 409],
  ['DUPLICATE_ACTIVE_EMBEDDING', 409],
  ['EGRESS_NOT_CONFIRMED', 400],
  ['EGRESS_SNAPSHOT_STALE', 400],
  ['FEATURE_DISABLED', 400],
  ['JOB_KIND_NOT_ENABLED', 400],
  ['MODEL_MISMATCH', 409],
  ['MIXED_MODEL_BLOCKED', 409],     // 409 not 503 (R1-P1-8 fix)
  ['INVALID_ACCOUNT_KIND', 422],
  ['QUEUE_ENQUEUE_FAILED', 500],
  ['SIGNING_SECRET_MISSING', 503],
  ['CATALOG_INVALID', 500],
]);
```

**Complete error table:**

| `error` code | HTTP | `details` shape |
|---|---|---|
| `VALIDATION_ERROR` | 422 | `{ issues: ZodIssue[] }` |
| `EMBEDDING_NO_PROVIDER` | 409 | `{}` |
| `PROVIDER_AUTH_FAILED` | 401 | `{}` |
| `RATE_LIMITED` | 429 | `{}` |
| `EMBEDDING_CREDENTIAL_DECRYPT_FAILED` | 500 | `{}` |
| `EMBEDDING_CREDENTIAL_NOT_FOUND` | 404 | `{}` |
| `PROVIDER_HAS_ACTIVE_JOBS` | 409 | `{ blockingJobIds: string[] }` |
| `PROVIDER_NOT_FOUND` | 404 | `{}` |
| `JOB_NOT_FOUND` | 404 | `{}` |
| `JOB_NOT_CANCELLABLE` | 409 | `{}` |
| `REMOTE_PEER_JOB` | 403 | `{ executorMachineId: string }` |
| `CONCURRENT_JOB_REQUEST` | 409 | `{}` (advisory-lock; no existingJobId available) |
| `JOB_ALREADY_RUNNING` | 409 | `{ existingJobId: string; existingMachine: string }` |
| `DUPLICATE_ACTIVE_EMBEDDING` | 409 | `{ constraint: string }` |
| `EGRESS_NOT_CONFIRMED` | 400 | `{}` |
| `EGRESS_SNAPSHOT_STALE` | 400 | `{ snapshot: EgressSnapshot }` (recomputed) |
| `FEATURE_DISABLED` | 400 | `{}` |
| `JOB_KIND_NOT_ENABLED` | 400 | `{ enabledKinds: string[] }` |
| `MODEL_MISMATCH` | 409 | `{ existingModels: Array<{table,model,count}>, incomingModel: string }` |
| `MIXED_MODEL_BLOCKED` | 409 | `{ queryModel: string; existingModels: string[] }` |
| `INVALID_ACCOUNT_KIND` | 422 | `{ expectedKind: 'runtime'; actualKind: string }` |
| `QUEUE_ENQUEUE_FAILED` | 500 | `{}` |
| `SIGNING_SECRET_MISSING` | 503 | `{}` |
| `CATALOG_INVALID` | 500 | `{ message: string }` |
| `PROVIDER_RATE_LIMITED` | — | **job-row `error_code` only** (not an HTTP response code) |

Note: `context.sourceRootViolation` → `details.sourceRootViolation` everywhere (R1-P1-5 fix). `ControlPlaneError.context` is server-internal; the route serializer maps it to `details`.

**All §14 codes must have integration tests asserting HTTP status and `details` shape (non-empty codes).**

## 15. Testing Strategy

**Docker Postgres with pgvector** for integration tests.

**Required integration tests (complete):**

1. Partial unique index fires under concurrent active-inserts.
2. Batch UPDATE writes `embedding` and `content_model = resolved.model` (not hardcoded constant).
3. `addFact` with non-default provider → `content_model = resolved.model`.
4. `writeSource` (drawer) with non-default provider → `embedding_model = resolved.model`.
5. Drawer search: returns only rows where `embedding IS NOT NULL AND embedding_model = $queryModel`.
6. Fleet-wide write-job exclusion: two simulated peers (different `MACHINE_ID`) both POST `embedding-backfill` with same scope — second returns 409 `JOB_ALREADY_RUNNING` IF jobs table is already synced. Race window test: both peers POST before sync — second INSERT proceeds (documented unmitigated window).
7. CONCURRENT_JOB_REQUEST: advisory lock causes a second concurrent same-machine POST to return 409 `CONCURRENT_JOB_REQUEST` (distinct from `JOB_ALREADY_RUNNING`).
8. BullMQ: `queue.add()` called with `{ jobId: insertedId }` in the third opts argument. `queue.getJob(insertedId)` returns the job.
9. Outbox — Redis enqueue fails: job row `status='failed'`, `error_code='QUEUE_ENQUEUE_FAILED'`.
10. Outbox — DB commit fails: no BullMQ job referencing the non-existent DB id.
11. Cancel queued job: status transitions directly to `cancelled`.
12. Cancel running job: `cancel_requested_at` set, status = `cancelling`; worker sees signal, transitions to `cancelled`; `completed` transition after cancel signal routes to `cancelled` instead.
13. Double cancel: second cancel on already-cancelled job → 409 `JOB_NOT_CANCELLABLE`.
14. Scope canonicalization: omitted/blank/whitespace/mixed-case scope all collide.
15. Preview endpoint returns correct per-kind snapshot: `embedding-backfill` uses `memory_facts` COUNT; `drawer-backfill` uses source tree file count.
16. Preview token expiry: expired previewToken → `EGRESS_SNAPSHOT_STALE`.
17. Missing `MEMORY_OPS_SIGNING_SECRET`: `/test-ephemeral` → 503; all other routes work.
18. Boot reconciliation: completes before `fastify.listen()` (verified by ordering test or integration test that checks no HTTP request is processed during boot pass).
19. `PUT /api/settings/defaults` with embedding-kind `defaultAccountId` → 422 `INVALID_ACCOUNT_KIND`.
20. `PATCH /api/agents/:id` with embedding-kind `accountId` → 422 `INVALID_ACCOUNT_KIND`.
21. Every §14 code returns specified HTTP status and `details` shape.
22. Bus: exactly 1 listener after 1000 factory calls; `resetBusForTesting()` + re-emit → cache clears correctly.
23. `sourceRoot` path-prefix bypass (`/allowed-evil` vs `/allowed`): rejected with 422.
24. `sourceRoot` symlink escape, oversized tree, disallowed extension: all 422.
25. Provider activation switch-mode: PATCH active=true atomically deactivates old provider.
26. `recentTestResult` expiry: 300s-old token → 422 `VALIDATION_ERROR`.
27. `recentTestResult` fingerprint mismatch: wrong apiKey → 422.
28. SSE stream for remote-peer job → 403 `REMOTE_PEER_JOB`.
29. Gemini Gate 1: fake key → 401 from real URL (not 404).
30. Migration 0033 + rollback: all four tables and columns removed; existing `api_accounts` rows survive.
31. BM25/graph search returns facts with `content_model='old-model'` when active provider uses different model.

**Required e2e (Playwright):**
1. OpenAI full journey: Add → Test → Save → preview egress → confirm → Run backfill → progress → `/memory/maintenance` non-empty.
2. Gemini full journey (when Gate 2 passes): stubbed endpoint; assert `output_dimensionality:1536` in request.
3. Alert coverage: no provider → `MissingEmbeddingAlert` on 8 views; absent on Import + ScopeManager.

## 16. Rollout

| PR | Scope | Bump | Notes |
|---|---|---|---|
| **A** | Migration 0033 (4 groups); Drizzle schema (all 3 tables + index note); TABLE_SYNC_CONFIG; EmbeddingClient additive; credential_kind filter; MemoryOpsAuditLogger interface; catalog + shared types (providers, ops, ops-audit, scopeNormalize). Gemini `verified:false`. **Gate 1 must pass before merge.** | patch | Critical path |
| **B** | factory + cache + bus; `/api/memory/providers` routes (switch-mode activation, pgPool); audit-logger impl; all memory runtime rewiring (full list §7.3.2 incl drawer-search + memory-facts.ts fusion); extend `controlPlaneErrorToStatus()` Map; LITELLM_URL removed from factory; `.env.example` += `MEMORY_OPS_SIGNING_SECRET` (no boot-fatal). Coverage + perf baseline committed at `docs/superpowers/specs/2026-04-24-memory-operations-ui-coverage-baseline.md` (coverage) and `-perf-baseline.md` (performance). | patch | Critical path |
| **C** | Settings → Memory & Embeddings UI; **`packages/web/src/lib/api/core.ts`** updated (ApiError + details); `queries.ts` additions. | minor | Critical path |
| **D** | memory-ops config (ENABLED_JOB_KINDS); BullMQ queue; JobsRepository (+ isCancelRequested, transition); JobEventsRepository; `/api/memory/ops/jobs` CRUD + cancel + stream + preview; `/api/memory/ops/capabilities`; `MEMORY_OPS_ENABLED_KINDS=` (empty); log-retention extension. | patch | Critical path |
| **E** | `embedding-backfill` + `drawer-backfill` handlers; worker boot; cost-tracker (reads priceUsdPerMtoken from job row); 401 deactivates; `MEMORY_OPS_ENABLED_KINDS=embedding-backfill,drawer-backfill`; `.env.example` += `MEMORY_OPS_ENABLED=false`, `MEMORY_OPS_MAX_FAIL_RATIO=0.05`, `MEMORY_OPS_DRAWER_SOURCE_ROOTS`, `MEMORY_OPS_ENABLED_KINDS`. | patch | Critical path — 19k backfill available via API with `MEMORY_OPS_ENABLED=true` |
| **F** | `/memory/operations` page + 8 alerts + `<MixedModelsBanner />` + sidebar + egress dialog; `.env.example` flip `MEMORY_OPS_ENABLED=true`. | minor | Non-critical |
| **G** | consolidation + synthesis handlers; `MEMORY_OPS_ENABLED_KINDS=...all four`; Playwright e2e; Gate 2 flip (`verified:true` for Gemini if passed); CHANGELOG + runbook. | patch | Non-critical |

## 17. Operational Runbook

**Normal ops:**
- Pause enqueues: `export MEMORY_OPS_ENABLED=false; pm2 restart <process>`.
- Force-fail stuck running job: `UPDATE memory_ops_jobs SET status='failed', error_code='MANUAL_FAIL', finished_at=now() WHERE id=$id AND status IN ('running','cancelling') AND executor_machine_id=$machineId`.
- Purge events: `DELETE FROM memory_ops_job_events WHERE created_at < now() - interval '14 days'` (automated by log-retention.ts).
- **Purge audit (R2-P2-10 fix):** `DELETE FROM memory_ops_audit WHERE timestamp < now() - interval '90 days'` (automated by log-retention.ts). Verify: `SELECT COUNT(*) FROM memory_ops_audit WHERE timestamp < now() - interval '90 days'` should return 0 after retention runs.

**Origin-offline stuck-job runbook:**
1. Identify: `SELECT id, kind, status, executor_machine_id FROM memory_ops_jobs WHERE status IN ('queued','running','cancelling') AND executor_machine_id = '<offline-machine>'`.
2. `status='queued'`: safe to force-fail/cancel. `UPDATE ... SET status='cancelled', finished_at=now() WHERE id=$id AND status='queued'`. Then POST a new job.
3. `status='running'/'cancelling'`: partial embedding writes may exist. Force-fail with `error_code='EXECUTOR_OFFLINE'`. Then POST a new job. **Note (R2-P2-14 fix): if peer A (offline) used a different provider model than peer B (current), POSTing a new job from peer B may return 409 `MODEL_MISMATCH` (model-lock conflict — some rows already embedded with peer A's model). Resolve by ensuring peer B has the same provider model, or run the manual re-embed-all workaround before POSTing.**

**Re-embed all (manual workaround, v1.1 not shipped):**
```sql
-- ⚠️ FLEET-WIDE: memory_facts is mesh-synced. Stop all CPs before running.
UPDATE memory_facts SET embedding = NULL WHERE content_model = '<old-model>';
UPDATE memory_drawers SET embedding = NULL WHERE embedding_model = '<old-model>';
```
Then configure new provider and POST backfill.

**PM2 process names:**

| Tier | Process | Redis DB |
|---|---|---|
| beta | `agentctl-cp-beta` | 0 (verified `tier-config.ts:99` `extractRedisDb`) |
| dev-1 | `agentctl-cp-dev1` | 1 |
| dev-2 | `agentctl-cp-dev2` | 2 |

## 18. Acceptance Criteria

- Add OpenAI provider, Test → shows `dim=1536, costUsd>0, latencyMs>0` before Save.
- With `MEMORY_OPS_SIGNING_SECRET` absent: `/test-ephemeral` → 503; all other routes serve.
- Preview endpoint: `POST /preview { kind:'embedding-backfill' }` → `{ snapshot: { rowCount, tokenEstimate, costEstimate, providerHost }, previewToken }`.
- Preview endpoint for drawer-backfill: `snapshot.rowCount` is absent; `snapshot.fileCount` and `snapshot.chunkCount` reflect source tree (not `memory_facts`).
- No provider → `MissingEmbeddingAlert` on 8 views; absent on Import + ScopeManager; renders with `!isPending` guard.
- Embedding-backfill with active provider: writes `embedding` AND `content_model = provider.model`; progress monotonically increasing; ends `completed` when `failed/total < 0.05`.
- Cancel queued job: `status='cancelled'` immediately. Cancel running job: `status='cancelling'`; worker stops after current batch; `status='cancelled'`.
- Two concurrent POST `/providers { active:true }` → one 201, one 409 `DUPLICATE_ACTIVE_EMBEDDING`.
- PATCH active=true: old active provider deactivated atomically in same transaction.
- `PATCH /:id { apiKey: newKey, recentTestResult: validToken }` → `lastTestOk=true`, NOT null.
- `PATCH /:id { apiKey: newKey }` (no token) → `lastTestOk=null`.
- Two simultaneous POST /jobs from same machine, same kind/scope: one returns 409 `CONCURRENT_JOB_REQUEST`.
- Two simultaneous POST /jobs from different machines, same kind/scope (jobs table already synced): second returns 409 `JOB_ALREADY_RUNNING` with `details.existingJobId`.
- SSE reconnect on same peer with `Last-Event-Id: N` → replays N+1..current.
- `GET /jobs/:id/stream` for remote-peer job → 403 `REMOTE_PEER_JOB`.
- Remote peer sees job status + final progress; live progress not visible on non-executor peer.
- `PUT /api/settings/defaults` with embedding-kind account → 422 `INVALID_ACCOUNT_KIND`.
- `PATCH /api/agents/:id` with embedding-kind account → 422 `INVALID_ACCOUNT_KIND`.
- `POST /jobs` without `previewToken` for write kind (when `MEMORY_OPS_SIGNING_SECRET` set) → 400 `EGRESS_NOT_CONFIRMED` or `EGRESS_SNAPSHOT_STALE`.
- `JOB_KIND_NOT_ENABLED` acceptance: `MEMORY_OPS_ENABLED=true`, `MEMORY_OPS_ENABLED_KINDS=embedding-backfill` → POST `{ kind:'synthesis' }` → 400 with `details.enabledKinds=['embedding-backfill']`.
- Migration 0033 on existing runtime rows: all rows have `credential_kind='runtime'`; index doesn't fire.
- **Performance (R2-P2-13 fix):** `addFact` benchmark defined in `-perf-baseline.md` committed by PR B. Evaluation on PR E: 1,000 sequential `addFact` calls with warm cache and stub provider; P99 ≤ baseline + 15%. Not a PR B pre-merge gate.
- Manual performance target (PR G): 19,226 facts → OpenAI, median < 10 min, cost ~$0.05–$0.10.

## 19. Risks

| Risk | Mitigation |
|---|---|
| **Fleet backfill race (unmitigated in v1)** | Two peers with different providers can simultaneously claim different null-embedding rows, producing mixed model vectors. Operator guidance: never run concurrent write-kind jobs across peers with different active providers. v1.1 closes with Redis SET NX distributed lock on fleet-shared Redis. |
| **Origin peer offline with queued/running job** | Runbook in §17 covers force-fail + MODEL_MISMATCH recovery. UI shows read-only status for remote jobs. |
| Gemini compat layer ignores `output_dimensionality` | Gate 2 catches before catalog `verified: true`; fallback to `gemini-embedding-2-preview`. |
| Price catalog drift | Worker reads price from job row; catalog audited quarterly. |
| Mesh peer on old schema | `sync_nodes_schema_ahead_rejection` (migration 0027) rejects cross-version sync. |
| Worker crash during backfill | Boot reconciliation marks running jobs failed; v1.1: resumable. |
| In-process worker blocks Fastify event loop | BullMQ async; monitor P99 API latency in dev-1 during E2E backfill. |

---

## Appendix A — Files created/modified per PR

**PR A:** `drizzle/0033_add_memory_ops.sql` + `.down.sql`; `drizzle/meta/_journal.json`; `src/db/schema.ts` (apiAccounts + memoryOpsJobs + memoryOpsJobEvents + memoryOpsAudit + index note); `packages/shared/src/types/sync.ts`; `packages/shared/src/memory/{providers,ops,ops-audit}.ts` (incl. `scopeNormalize`); `src/memory/embedding-client.ts` (additive); runtime-kind filter: `src/api/routes/{accounts,sessions,oauth,settings,agents}.ts` + `src/scheduler/task-worker.ts`. Gate 1 contract test.

**PR B:** `src/memory/embedding-client-factory.ts` (+ cache; imports bus; NO LITELLM_URL); `src/memory/provider-invalidation-bus.ts` (bus; separate from factory); `src/api/routes/memory-providers.ts` (switch-mode activation; pgPool); `src/memory/ops/audit-logger.ts`; full memory rewiring (§7.3.2 list incl. `memory-drawer-search.ts`, `routes/memory-drawers.ts`, `routes/memory-facts.ts`); `src/api/server.ts` (MEMORY_OPS_STATUS_MAP extension); `src/index.ts` (drop LITELLM_URL block); `.env.example` += `MEMORY_OPS_SIGNING_SECRET`; `docs/.../...-coverage-baseline.md`; `docs/.../..-perf-baseline.md`.

**PR C** (minor): `packages/web/src/lib/api/core.ts` (ApiError + details field); `packages/web/src/lib/api/memory-providers.ts`; `src/components/memory/ProviderDialog.tsx`; `src/views/settings/MemoryEmbeddingsSection.tsx`; `src/views/SettingsView.tsx`; `src/lib/api.ts`; `src/lib/queries.ts`.

**PR D:** `src/memory/ops/{config,queue,jobs-repository,job-events-repository,sse-stream,preview,worker-runtime}.ts`; `src/api/routes/memory-ops.ts` (all routes incl. `/capabilities` at `/api/memory/ops/capabilities` and `/jobs/preview`; ENABLED_JOB_KINDS=empty); `src/api/server.ts`; `src/index.ts`; `src/audit/log-retention.ts`.

**PR E:** `src/memory/ops/{embedding-backfill,drawer-backfill,worker,cost-tracker}.ts`; `src/memory/ops/e2e.test.ts`; `src/index.ts` (worker boot); `MEMORY_OPS_ENABLED_KINDS=embedding-backfill,drawer-backfill`; `.env.example` += `MEMORY_OPS_ENABLED=false`, `MEMORY_OPS_MAX_FAIL_RATIO=0.05`, `MEMORY_OPS_DRAWER_SOURCE_ROOTS`, `MEMORY_OPS_ENABLED_KINDS`.

**PR F** (minor): `packages/web/src/lib/api/memory-ops.ts`; `src/components/memory/{JobCard,RecentJobsTable,JobDetailDrawer,MissingEmbeddingAlert,MixedModelsBanner,EgressConfirmationDialog}.tsx`; `src/views/MemoryOperationsPage.tsx`; `src/app/memory/operations/page.tsx`; `src/components/memory/MemorySidebar.tsx`; 8-view alert mounts; `src/lib/queries.ts`; `.env.example` flip `MEMORY_OPS_ENABLED=true`.

**PR G:** `src/memory/ops/{consolidation,synthesis}.ts`; `packages/web/e2e/memory-ops/{openai-happy,gemini-happy,missing-embedding-alert}.spec.ts`; Gate 2 contract test + Gemini `verified:true` flip (conditional on Gate 2 pass); `MEMORY_OPS_ENABLED_KINDS=embedding-backfill,drawer-backfill,consolidation,synthesis`; `CHANGELOG.md`; `docs/QUICKSTART.md`.

---

## Appendix B — Round-2 traceability

All Round-2 P0s dispositioned. See `reviews/2026-04-24-memory-operations-ui-v2-reviewer-checklist.md`.

---

## Appendix C — Round-3 traceability

All Round-3 P0s dispositioned in v3. See v3 Appendix C. Note: Appendix C/D are traceability records, not proof of readiness.

---

## Appendix D — Round-4 traceability

All Round-4 P0s (R1: 12; R2: 4) dispositioned in v4. See v4 Appendix D.

---

## Appendix E — Round-5 disposition

Round-5 reviews on v4: [R1](../reviews/2026-04-24-memory-operations-ui-design-v4-strict-review.md) (10 P0, 20 P1, 14 P2) + [R2](../reviews/2026-04-25-memory-operations-ui-design-v4-strict-review.md) (4 P0, 10 P1, 14 P2).

### R1 P0 (10) — all fixed in v5

| # | Issue | v5 fix |
|---|---|---|
| 1 | Fleet exclusion doesn't protect mesh-synced embeddings | §5.2: honest unmitigated race statement; §19 risk row; operator guidance to not run concurrent backfills |
| 2 | BullMQ `queue.add` passes jobId in data, not opts | §5.2: `queue.add(kind, { dbJobId }, { jobId })` |
| 3 | Cancel has no durable state | §5.2: `cancel_requested_at` column; worker polls; transition() enforces terminal invariant |
| 4 | Egress confirmation impossible before POST | §6.2: `POST /jobs/preview` returns `{ snapshot, previewToken }`; create validates token |
| 5 | drawer-backfill egress estimate from memory_facts (wrong) | §6.2: per-kind snapshot builders; drawer uses source tree counts |
| 6 | sourceRoot prefix-confusion bypass | §6.3: `path.relative(canonicalRoot, resolvedPath)` containment check |
| 7 | SIGNING_SECRET boot-fatal breaks rollout | §6.1: route-disable not boot-fatal; `/test-ephemeral` → 503 `SIGNING_SECRET_MISSING` |
| 8 | LITELLM_URL fallback violates v4 goal | §7.3: step 3 removed; EMBEDDING_NO_PROVIDER if no DB provider |
| 9 | `details` not consumable by web client | §13.1/§6.1: core.ts ApiError + details in PR C scope |
| 10 | Gemini catalog unverified before UI exposure | §6.3: `verified: false`; UI filters to verified entries; Gate 2 required before flip |

### R1 P1 (20) — all fixed in v5

| # | v5 fix |
|---|---|
| 1 | PATCH matrix: split apiKey ± recentTestResult → §6.1 |
| 2 | Expired/invalid recentTestResult: 422 VALIDATION_ERROR → §6.1 |
| 3 | Capabilities by kind only → §6.2: `fleetJobsByKindAndScope` array |
| 4 | GET /jobs local-only predicate → §6.2: `localOnly` filter |
| 5 | context.sourceRootViolation → details.sourceRootViolation → §14 note |
| 6 | resolveEmbeddingClient missing-credential → EMBEDDING_CREDENTIAL_NOT_FOUND → §7.3 |
| 7 | MODEL_MISMATCH details across both tables → §6.1 combined query + details shape |
| 8 | MIXED_MODEL_BLOCKED 503→409; fact-only → §8: 409 + drawer-aware |
| 9 | Provider activation semantics → §6.1: switch mode |
| 10 | Test-before-save server invariant → §6.1: job creation checks lastTestOk=false |
| 11 | Provider price not snapshotted → §5.2/§5.4: `price_usd_per_mtoken` column; worker reads from job row |
| 12 | Drizzle schema incomplete → §5.4: memoryOpsJobEvents + memoryOpsAudit + index note |
| 13 | Response types missing → §6.1: EmbeddingProvider, EmbeddingProviderMetadata shapes |
| 14 | Peer progress overclaimed → §6.2: acceptance note; §18 acceptance |
| 15 | Origin-offline not in §19 → §19 risk row |
| 16 | Alert copy for passive peer → §13.2 |
| 17 | Audit actor undefined → §9: actor source defined |
| 18 | EmbeddingClient auth underspecified → §6.1 + §7.1: Authorization header + extraBody merge |
| 19 | sessionStorage ack too broad → §6.3: key includes model, kind, scope, sourceRootHash |
| 20 | Appendix D overclaims → note in each appendix |

### R2 P0 (4) — all fixed in v5

| # | v5 fix |
|---|---|
| 1 | core.ts ApiError has no details → PR C scope, §13.1 |
| 2 | Race-window mitigation claim wrong → §5.2: honest unmitigated statement |
| 3 | Round-4 review files not on branch → committed in git (`89e03859`) |
| 4 | Advisory-lock JOB_ALREADY_RUNNING lacks existingJobId → §5.2: CONCURRENT_JOB_REQUEST (lock path) vs JOB_ALREADY_RUNNING (fleet-check path) |

### R2 P1 (10) — all fixed in v5

| # | v5 fix |
|---|---|
| 1 | Drizzle for memoryOpsJobEvents absent → §5.4 |
| 2 | Drizzle for memoryOpsAudit absent → §5.4 |
| 3 | recentTestResult expiry not specified → §6.1: 300s check |
| 4 | POST /jobs body schema undefined → §6.2: memoryOpsJobCreateSchema |
| 5 | ENABLED_JOB_KINDS undefined → §6.2: config.ts, MEMORY_OPS_ENABLED_KINDS env var |
| 6 | PROVIDER_RATE_LIMITED no call site → §14: job-row error_code only, not HTTP response |
| 7 | SSE stream for remote peer undefined → §6.2: 403 REMOTE_PEER_JOB |
| 8 | controlPlaneErrorToStatus extension unspecified → §14: MEMORY_OPS_STATUS_MAP approach |
| 9 | idx_memory_ops_jobs_kind_scope_status missing from Drizzle → §5.4: raw-SQL note + caution comment |
| 10 | Boot reconciliation unsequenced → §4/§5.2: completes before fastify.listen() |

### R1 P2 + R2 P2 — all addressed in v5

Coverage baseline split to separate `-perf-baseline.md` file (R1-P2-1). Missing error codes added: `EMBEDDING_CREDENTIAL_NOT_FOUND`, `SIGNING_SECRET_MISSING`, `CATALOG_INVALID`, `EGRESS_SNAPSHOT_STALE` (R1-P2-2). Provider metadata shape enumerated (R1-P2-3). `MEMORY_OPS_MAX_FAIL_RATIO` boot validation defined (R1-P2-4 — add to §4 config module). `validateCatalog()` propagates uncaught to crash CP on invalid catalog (R1-P2-5). `MIXED_MODEL_BLOCKED` banner copy says "v1 cannot re-embed" (R1-P2-6). `payload` column described as "bounded payload" not "full payload" (R1-P2-7). `processed` unit defined per kind (§5.3, R1-P2-8). Audit retention rationale: 90 days matches PCI-DSS minimum for access logs applied to egress audit (R1-P2-9). `MEMORY_OPS_SIGNING_SECRET` generation: `openssl rand -hex 32`, same guidance as `CREDENTIAL_ENCRYPTION_KEY` (R1-P2-10). `JOB_KIND_NOT_ENABLED` acceptance case added to §18 (R1-P2-11). `egress_confirmed_by` null for SQL-only kinds — documented (R1-P2-12). Rollback verification covers tables + indexes + constraints + columns (§5.6, R1-P2-13). `tier-config.extractRedisDb` citation re-added to §17 (R1-P2-14). Architecture diagram updated with `/api/memory/ops/capabilities` (R2-P2-1 — see §4). Group D DDL in §5.1 alongside Groups A-C (R2-P2-2). `redactSensitiveKeys` module path (R2-P2-3 — §10). `pg_notify` always same transaction (R2-P2-4 — §6.2). `scopeNormalize` module path (R2-P2-5 — §6.3). Non-vector query audit (R2-P2-6 — §7.3.2). MIXED_MODEL_BLOCKED scope-aware (R2-P2-7 — §8). Alert isPending guard (R2-P2-8 — §13.3). `resetBusForTesting()` re-registers listener (R2-P2-9 — §7.3). Audit retention runbook (R2-P2-10 — §17). PR B annotation fixed (R2-P2-11 — Appendix A). `validateCatalog()` hard crash (R2-P2-12 — §6.3). Benchmark baseline temporal loop fixed (R2-P2-13 — §18). Origin-offline MODEL_MISMATCH warning (R2-P2-14 — §17).
