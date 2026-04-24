# Memory Operations UI — v2 Design (SUPERSEDED)

> **⚠️ STATUS: SUPERSEDED by v3.** Round-3 reviewers ([Reviewer 1](../reviews/2026-04-24-memory-operations-ui-design-v2-strict-review.md), [Reviewer 2](../reviews/2026-04-24-memory-operations-ui-design-v2-strict-review-round-2.md)) flagged 15 unique P0s: advisory lock outside transaction (silent race), executor_machine_id not set at insert (peer steal race), PR F exposes kinds before PR G handlers, cost tracking based on false code facts, `CANCEL_ACCEPTED` on 2xx body, audit to `agent_actions` without reconciling mesh-sync, invalidation bus named but unspecified, `MemoryStore.addFact` hot-path DB-and-decrypt, facts doc item 37 was factually wrong, etc. Reviewer 2 explicitly said "the spine is defensible" — v3 is surgical patches.
>
> **Forward link:** `2026-04-24-memory-operations-ui-design-v3.md` (same directory).
>
> Historical content below preserved for traceability.
>
> **Supersedes:** `2026-04-24-memory-operations-ui-design-v1.md` (v1, also rejected).
> **Fix checklist (v2-era):** `../reviews/2026-04-24-memory-operations-ui-v2-reviewer-checklist.md`
> **Verified facts (item 37 corrected 2026-04-24):** `../reviews/2026-04-24-memory-operations-ui-v2-verified-facts.md`

## 1. Problem

19,226 `memory_facts` rows with `embedding IS NULL`; 0 drawers; 0 edges. `/memory/graph`, `/memory/maintenance`, `/memory/synthesis`, `/memory/consolidation` silently return empty results. Root cause: no UI path to configure an embedding provider and no UI path to trigger the long-running maintenance jobs. CLI paths exist but require shell access.

## 2. Goals

- Configure embedding providers (OpenAI, Gemini AI Studio) from Settings. Per-machine, encrypted at rest.
- Trigger + observe memory maintenance jobs from `/memory/operations`.
- All existing memory read/write paths (`MemorySearch`, `MemoryStore.addFact`, drawer search) resolve the active embedding provider from the DB, not `LITELLM_URL` env.
- Ship critical path PR A → PR B → PR C → PR D → PR E so the 19,226-fact backfill runs after PR E.

## 3. Non-Goals (v1)

- iOS UI.
- Providers beyond OpenAI + Gemini (AI Studio). Voyage, Azure, Bedrock, Anthropic-routed, local Ollama deferred.
- Cross-peer credential replication. `api_accounts` is `local-only` per `packages/shared/src/types/sync.ts:182`.
- `memory_facts.embedding` / `memory_drawers.embedding` schema migration away from `vector(1536)`.
- User-supplied `baseUrl` (SSRF mitigation — catalog-only).
- Swapping provider model while facts exist with a different `content_model` — locked until a v1.1 `re-embed-all` job ships.
- Cost budgets / kill-switches at provider level (v1 records cost; does not enforce caps).
- Scheduled/cron maintenance runs.
- Multiple simultaneously active embedding providers.
- Hash-chained audit log. Current CP has no hash-chain infrastructure (verified: no `hashChain`, `audit_chain`, `prev_hash` in `packages/control-plane/src/`). v1 writes structured audit rows; chaining deferred.
- Resumable worker after CP crash. v1 marks in-flight jobs `failed` on reboot; resume is v1.1.

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
│ Control plane (Fastify, per-machine, guard = db+encryptionKey)   │
│                                                                  │
│  /api/memory/providers           CRUD + /test + /test-ephemeral  │
│  /api/memory/ops/jobs            CRUD + /cancel + /stream        │
│             │                                                    │
│             ▼                                                    │
│  memory-ops BullMQ Worker  (in-process with CP, concurrency=1)   │
│    handlers: embedding-backfill, drawer-backfill,                │
│              consolidation, synthesis                            │
│             │                                                    │
│             ▼                                                    │
│  resolveEmbeddingClient(pool, encKey, credentialId?)             │
│  Used by: memory-ops workers, MemorySearch, MemoryStore.addFact, │
│           drawer-store writes  (§7.3 replaces LITELLM_URL path)  │
└──────────────────────────────────────────────────┬───────────────┘
                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│ PostgreSQL                                                       │
│  api_accounts (+ credential_kind, + credential_last4)            │
│  memory_ops_jobs (mesh-synced mutable, origin+executor columns)  │
│  memory_ops_job_events (LOCAL-ONLY — SSE replay is same-peer)    │
│  memory_facts.embedding / content_model (raw SQL only;           │
│    Drizzle schema omits the vector column; verified              │
│    schema.ts:354-375)                                            │
│  memory_drawers.embedding / embedding_model                      │
└──────────────────────────────────────────────────────────────────┘
```

**Concurrency story.** BullMQ queue is namespaced per Redis DB (beta=DB 0, dev-1=DB 1, dev-2=DB 2 per memory rule 9). Each tier runs exactly one CP process with one worker at `concurrency=1`. Cross-peer duplicate protection is via `memory_ops_jobs.executor_machine_id` + conditional-claim UPDATE (§5.2), not Redis.

**Worker process model.** In-process with CP for v1. Boot-time reconciliation: `UPDATE memory_ops_jobs SET status='failed', error_code='CP_RESTART_DURING_RUN', finished_at=now() WHERE status='running' AND executor_machine_id = $machineId`. Crash-resumable execution is v1.1.

## 5. Data Model

### 5.1 `api_accounts` extensions

Table: `packages/control-plane/src/db/schema.ts:443` (`apiAccounts`). Local-only per `sync.ts:182`.

Existing columns: `id uuid`, `name text`, `provider text`, `credential text`, `credential_iv text`, `priority int`, `rate_limit jsonb`, `is_active bool`, `metadata jsonb`, `created_at`, `updated_at`.

**Migration `0033_add_memory_ops.sql` (PR A, single file, three statement groups):**

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
```

Design notes:
- `credential_kind` lands in **PR A**, same PR as the runtime-filter code that depends on it (fixes [R1b P0#2, R2b P0-1]).
- `credential_last4` is populated on INSERT/PATCH-with-new-key. PATCH without `apiKey` leaves it untouched.
- Partial unique index is a DB invariant for single-active-embedding — not API-layer race prevention. Loser sees Postgres `SQLSTATE 23505` → route maps to `409 DUPLICATE_ACTIVE_EMBEDDING` (§14).
- Existing runtime rows default to `credential_kind='runtime'`; no behavior change.

### 5.2 `memory_ops_jobs` (new, mesh-synced mutable)

```sql
-- Group B — memory_ops_jobs
CREATE TABLE memory_ops_jobs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                   text NOT NULL
                         CHECK (kind IN ('embedding-backfill','drawer-backfill',
                                         'consolidation','synthesis')),
  status                 text NOT NULL
                         CHECK (status IN ('queued','running','completed',
                                           'failed','cancelled')),
  params                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress               jsonb NOT NULL
                         DEFAULT '{"processed":0,"embedded":0,"failed":0,"total":0,"costUsd":0}'::jsonb,
  result                 jsonb,
  error                  text,
  error_code             text,          -- structured code for UI parsing
  credential_id          uuid,          -- no FK; api_accounts is local-only
  origin_machine_id      text NOT NULL, -- identifies the peer that created the job
  executor_machine_id    text,          -- peer that claims + runs; NULL = unclaimed
  started_at             timestamptz,
  finished_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  egress_confirmed_at    timestamptz,   -- server-recorded egress ack
  egress_confirmed_by    text
);

CREATE INDEX idx_memory_ops_jobs_status_executor
  ON memory_ops_jobs (status, executor_machine_id);
CREATE INDEX idx_memory_ops_jobs_kind_created
  ON memory_ops_jobs (kind, created_at DESC);

-- Column-level trigger: only fire mesh-sync on status / result / finished_at changes,
-- NOT on progress updates (which happen ~192× per 19k-row backfill).
CREATE TRIGGER sync_capture
  AFTER INSERT OR UPDATE OF status, result, finished_at, error, error_code
     OR DELETE
  ON memory_ops_jobs
  FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');
```

Then update `packages/shared/src/types/sync.ts` `TABLE_SYNC_CONFIG` (line 162):

```typescript
memory_ops_jobs: 'mutable',
```

`SYNCED_TABLES` derives automatically (sync.ts:190-192). `TABLE_PK_COLUMN` defaults to `'id'`; no entry needed.

**Progress shape (fixes [R1b P1#16, R2b §B P0-15 partial]):**

```typescript
type MemoryOpsProgress = {
  processed: number; // batches attempted
  embedded: number;  // successfully written
  failed: number;    // per-fact failures within retry budget
  total: number;     // eligible work snapshot at job start
  costUsd: number;   // accumulated across all four handler kinds
  etaSeconds?: number;
  currentBatch?: number;
};
```

**Mesh ownership (fixes [R1b P0#7]):**
- `POST /jobs` sets `origin_machine_id = process.env.MACHINE_ID` (or hostname fallback).
- Any CP worker claim: `UPDATE memory_ops_jobs SET status='running', started_at=now(), executor_machine_id=$machineId WHERE id=$jobId AND status='queued' AND (executor_machine_id IS NULL OR executor_machine_id=$machineId)`. Losers get `UPDATE 0 rows` and abort.
- Peer UI renders `executor_machine_id != LOCAL` as read-only.
- JobCard disables `Run now` when (a) local has no active provider AND kind requires one, OR (b) a job of the same kind/scope is already running anywhere in the mesh.

**Advisory lock at enqueue (fixes [R1b P0#8, R2b P0-3, R2b P0-4]):**

```typescript
const normalizedScope = (scope ?? '').trim().toLowerCase();
const lockKey = `memory-ops:${kind}:${normalizedScope}`;
await pool.query(
  `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
  [lockKey],
);
```

Pattern mirrors `packages/control-plane/src/sync/apply-change.ts:180` (verified). The `::bigint` cast is required — `hashtext` returns `int4`. The lock is `xact`-scoped: released when the enqueue transaction commits. It prevents same-instant duplicate enqueues from the same CP. Cross-peer protection is NOT the lock's job — that's `executor_machine_id` + claim UPDATE (above).

### 5.3 `memory_ops_job_events` (new, LOCAL-ONLY)

```sql
-- Group C — memory_ops_job_events (local-only; SSE replay is same-peer)
CREATE TABLE memory_ops_job_events (
  event_id   bigserial PRIMARY KEY,
  job_id     uuid NOT NULL REFERENCES memory_ops_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL
             CHECK (event_type IN ('started','progress','log','completed',
                                   'failed','cancelled')),
  level      text CHECK (level IN ('info','warn','error')),
  message    text,
  progress   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_ops_job_events_job ON memory_ops_job_events (job_id, event_id);
CREATE INDEX idx_memory_ops_job_events_created ON memory_ops_job_events (created_at);
-- NO sync_capture trigger. Table NOT added to TABLE_SYNC_CONFIG.
```

Design decision (fixes [R1b P0#11, R2b P0-6]):
- Events **do not mesh-sync**. SSE `Last-Event-Id` replay is same-peer only.
- Single CP per machine; the UI reconnects to the same CP it started with. Operational reality matches the design.
- Dropping sync eliminates bigserial PK collision and FK-ordering-on-apply concerns.

**Size caps (fixes [R2b P2-40]):**
- `message` max 512 chars — application-level truncation before INSERT.
- `progress` is bounded by the struct shape (~100 bytes).
- `memory_ops_jobs.result` has a 16 KB soft cap — overflow writes a summary to `result` and full payload as an `event_type='log'` row.

**Retention (fixes [R2b P2-41]):**
- 14-day retention via extension of `packages/control-plane/src/audit/log-retention.ts`.
- PR D modifies that file to add a `memoryOpsEventRetentionDays` config + DELETE query.

### 5.4 Drizzle schema additions (PR A)

`apiAccounts` (near existing columns):

```typescript
credentialKind: text('credential_kind').notNull().default('runtime'),
credentialLast4: text('credential_last4'),
```

`memoryOpsJobs` (new table — `memory_facts.embedding` remains raw-SQL-only per the project convention at `memory-store.ts:231,606`):

```typescript
export const memoryOpsJobs = pgTable(
  'memory_ops_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
    progress: jsonb('progress').notNull().default(
      sql`'{"processed":0,"embedded":0,"failed":0,"total":0,"costUsd":0}'::jsonb`,
    ),
    result: jsonb('result'),
    error: text('error'),
    errorCode: text('error_code'),
    credentialId: uuid('credential_id'),
    originMachineId: text('origin_machine_id').notNull(),
    executorMachineId: text('executor_machine_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    egressConfirmedAt: timestamp('egress_confirmed_at', { withTimezone: true }),
    egressConfirmedBy: text('egress_confirmed_by'),
  },
  (table) => [
    index('idx_memory_ops_jobs_status_executor').on(table.status, table.executorMachineId),
    index('idx_memory_ops_jobs_kind_created').on(table.kind, table.createdAt),
  ],
);
```

`memoryOpsJobEvents` similar shape; `eventId` is `bigserial` → use Drizzle `bigserial()` or `bigint` + sequence.

### 5.5 Migration rollback (fixes [R2b P1-31])

`0033_add_memory_ops.down.sql` — manual runbook, not auto-applied (Drizzle doesn't auto-run downs):

```sql
DROP TABLE IF EXISTS memory_ops_job_events;
DROP TABLE IF EXISTS memory_ops_jobs;
DROP INDEX IF EXISTS api_accounts_one_active_embedding;
DROP INDEX IF EXISTS idx_api_accounts_kind;
ALTER TABLE api_accounts
  DROP COLUMN IF EXISTS credential_last4,
  DROP CONSTRAINT IF EXISTS api_accounts_kind_check,
  DROP COLUMN IF EXISTS credential_kind;
```

## 6. API Contract

All routes are registered in `server.ts` under the existing `db + encryptionKey` guard — same pattern as `accountRoutes` (verified: `packages/control-plane/src/api/server.ts:828-847`).

### 6.1 `/api/memory/providers` (PR B)

```
GET    /                    -> 200 { providers: EmbeddingProvider[] }
                                order: is_active DESC, priority ASC, created_at ASC
POST   /                    -> 201 { provider: EmbeddingProvider }
                                409 DUPLICATE_ACTIVE_EMBEDDING on 23505 unique-violation
                                422 VALIDATION_ERROR on Zod failure
POST   /test-ephemeral      -> 200 { ok, dim, model, costUsd, latencyMs, signedToken }
                                401 PROVIDER_AUTH_FAILED
                                422 VALIDATION_ERROR
                                429 RATE_LIMITED (ours) | 429 PROVIDER_RATE_LIMITED (upstream)
                                  No persistence. signedToken = HMAC(secret, payloadHash),
                                  5-min TTL; POST / can accept it to carry test result.
PATCH  /:id                 -> 200 { provider }
                                404 PROVIDER_NOT_FOUND
                                409 PROVIDER_HAS_ACTIVE_JOBS when apiKey rotate OR deactivate
                                      with queued/running jobs referencing credential_id
                                422 VALIDATION_ERROR
DELETE /:id                 -> 204
                                404 PROVIDER_NOT_FOUND
                                409 PROVIDER_HAS_ACTIVE_JOBS (with blockingJobIds in body)
POST   /:id/test            -> 200 { ok, dim, model, costUsd, latencyMs }
                                401 PROVIDER_AUTH_FAILED (also deactivates row)
                                404 PROVIDER_NOT_FOUND
                                429 RATE_LIMITED (5/min per IP)
```

**PATCH field matrix (fixes [R2b P1-23]):**

| Field | Effect |
|---|---|
| `apiKey` provided | re-encrypt, recompute `credential_last4`, reset `last_test_ok=null` and `last_test_error=null` in metadata, set `updated_at=now()` |
| `name` | write name, set `updated_at=now()` |
| `model` | write into `metadata.model`, set `updated_at=now()` (fails 409 if jobs running) |
| `active=true` | flip target row active; DB partial unique index blocks conflict; on 23505 → 409 DUPLICATE_ACTIVE_EMBEDDING |
| `active=false` | fails 409 PROVIDER_HAS_ACTIVE_JOBS if any queued/running job references this credential; else flip |

**Request payloads:**

```jsonc
// POST / (create)
{
  "name": "OpenAI personal",
  "provider": "openai",                   // 'openai' | 'gemini'
  "model": "text-embedding-3-small",       // must match catalog
  "apiKey": "sk-...",                      // write-only
  "active": true,
  "recentTestResult": {                    // optional; from /test-ephemeral
    "ok": true,
    "dim": 1536,
    "model": "text-embedding-3-small",
    "costUsd": 0.00000002,
    "signedToken": "<HMAC token>",
    "testedAt": "2026-04-24T..."
  }
}

// POST /test-ephemeral — never persists
{
  "provider": "openai",
  "model": "text-embedding-3-small",
  "apiKey": "sk-..."
  // baseUrl derived from catalog; cannot be overridden
}
```

**Response shape (fixes [R1b P0#12] — flat envelope matches existing `server.ts:937-962` + `web/src/lib/api/core.ts:21-44`):**

```jsonc
// Success
{ "provider": { "id": "uuid", "name": "...", "apiKeyLast4": "...", ... } }

// Error — flat, matches existing project envelope
{ "error": "DUPLICATE_ACTIVE_EMBEDDING", "message": "...", "hint": "..." }
```

### 6.2 `/api/memory/ops/jobs` (PR D)

```
POST   /                   -> 201 { job: MemoryOpsJob }
                               400 EGRESS_NOT_CONFIRMED (embedding-backfill, drawer-backfill)
                               400 FEATURE_DISABLED when MEMORY_OPS_ENABLED=false
                               409 EMBEDDING_NO_PROVIDER
                               409 JOB_ALREADY_RUNNING (advisory lock loss)
                               422 VALIDATION_ERROR
GET    /                   -> 200 { jobs: MemoryOpsJob[] }  (filter: kind, status, limit≤200)
GET    /:id                -> 200 | 404
POST   /:id/cancel         -> 200 { job } | 202 CANCEL_ACCEPTED | 409 JOB_NOT_CANCELLABLE
GET    /:id/stream         -> text/event-stream
                               same-peer only; Last-Event-Id respected from local bigserial
```

**Feature flag (fixes [R2b P1-32]):**
- `MEMORY_OPS_ENABLED` env var, defaults to `false`.
- PR E ships the env var default OFF — operators must opt in.
- PR F flips the default to `true` and documents in CHANGELOG.
- Turns off POST only; GET (read-only) is always on.

**Egress enforcement (fixes [R1b P0#9]):**
- `embedding-backfill` and `drawer-backfill` require `egressConfirmed: true` in the POST body.
- Server persists `egress_confirmed_at=now()` and `egress_confirmed_by=<header 'X-AgentCTL-Actor' OR 'local:${hostname}'>`.
- UI ALSO keeps `sessionStorage['memory-ops-egress-ack:<credentialId>']='true'` to skip the dialog on subsequent same-tab runs (fixes [R2b P1-34]).
- Direct curl without `egressConfirmed: true` → 400.

**SSE plumbing (fixes [R2b P2-43]):**
- CP boot opens one dedicated `pg.Client` with `LISTEN memory_ops_job_channel`.
- The repo writer does `pg_notify('memory_ops_job_channel', jobId)` after every `memory_ops_jobs` write.
- A fan-out map (in-memory) routes notifications to subscribed SSE clients keyed by `job_id`.
- SSE handler fetches new `memory_ops_job_events` rows since the client's `Last-Event-Id`.
- Payload ≤ 8 KB always (pg_notify budget respected — we only send `job_id`, not the row).

### 6.3 Shared types (PR A)

`packages/shared/src/memory/providers.ts` — exports `EmbeddingProviderKind = z.enum(['openai','gemini'])` and `EMBEDDING_MODEL_CATALOG`:

| provider | model | dim | baseUrl | embeddingsPath | extraBody | $/Mtok |
|---|---|---|---|---|---|---|
| openai | text-embedding-3-small | 1536 | `https://api.openai.com` | `/v1/embeddings` | `{}` | 0.02 |
| gemini | gemini-embedding-001 | 1536 | `https://generativelanguage.googleapis.com/v1beta/openai` | `/embeddings` | `{ output_dimensionality: 1536 }` | 0.15 |

Gemini `embeddingsPath='/embeddings'` (NOT `/v1/embeddings`) per Google's OpenAI-compat endpoint; verifying URL shape in PR A test (fixes [R1b P0#6]).

`validateCatalog()` runs at boot: every entry's `dim === 1536` (matches `vector(1536)` column); throws otherwise.

`embeddingProviderCreateSchema`:
- Fields: `name` (1..80), `provider` (enum), `model` (non-empty), `apiKey` (min 8), `active` (default true), `recentTestResult?` (from `/test-ephemeral`).
- `.strict()` — unknown keys (e.g., `baseUrl`) fail validation (fixes [R2b P0-9]).
- `.superRefine` checks `(provider, model)` exists in catalog; emits `VALIDATION_ERROR` with `context.issues[0].message === 'model not in catalog'` otherwise.

`packages/shared/src/memory/ops.ts` — Zod discriminated union `memoryOpsJobParamsSchema` over `kind` literal (fixes [R2b P1-30]). Per-kind fields:

| kind | base fields | extra fields | egressConfirmed required |
|---|---|---|---|
| `embedding-backfill` | `scope?`, `dryRun?`, `credentialId?` | `batchSize` (1-500, default 100) | **yes** |
| `drawer-backfill` | same | `sourceType: 'claude-mem'\|'jsonl'`, `sourceRoot` (non-empty), `batchSize` (default 50) | **yes** |
| `consolidation` | same | — | no |
| `synthesis` | same | — | no |

`scope` is coerced via `scopeNormalize(s) = (s ?? '').trim().toLowerCase()` shared with the advisory-lock key (§5.2). Exact-match semantics; prefix matching is v1.1.

## 7. Embedding Client + Cost Tracking

### 7.1 `EmbeddingClient` extension (PR A, additive only)

Current state (verified `packages/control-plane/src/memory/embedding-client.ts:64`): URL is `${baseUrl}/v1/embeddings`; no apiKey; no usage in return type.

PR A additive changes — default behavior preserved:

- New options: `apiKey?: string`, `extraBody?: Record<string, unknown>`, `embeddingsPath?: string` (default `/v1/embeddings`).
- New method: `embedBatchWithUsage(texts): Promise<{ vectors, usage: { promptTokens }, model }>`. `embed` / `embedBatch` unchanged.
- `ControlPlaneError('EMBEDDING_API_ERROR', ...)` context gains typed `status: number`. Handlers check `err.context?.status === 401`, not string match (fixes [R1b P0#18]).
- Existing callers (`index.ts:378` — LITELLM_URL path) untouched. When PR A ships, the old code continues to work; PR A begins migration.

### 7.2 Catalog — see §6.3.

### 7.3 `resolveEmbeddingClient` factory (PR B) — the memory-runtime wiring fix

Fixes [R1b P0#1] (root cause: provider UI cosmetic because `MemorySearch` / `MemoryStore.addFact` / `drawer-store` wrote through the boot-time `LITELLM_URL` `EmbeddingClient`):

```typescript
// packages/control-plane/src/memory/embedding-client-factory.ts (new in PR B)
export async function resolveEmbeddingClient(input: {
  pool: Pool;
  db: Database;                // Drizzle for the SELECT
  encryptionKey: string;
  logger: Logger;
  credentialId?: string;
}): Promise<EmbeddingClient>;
```

- If `credentialId` provided, selects that row (if `credential_kind='embedding'`).
- Else selects the single `is_active=true AND credential_kind='embedding'` row.
- Throws `ControlPlaneError('EMBEDDING_NO_PROVIDER', ...)` when none found.
- Throws `ControlPlaneError('EMBEDDING_CREDENTIAL_DECRYPT_FAILED', ...)` on decrypt failure.

**All memory runtime wiring switches to the factory (PR B):**

- `packages/control-plane/src/index.ts` — replace the `if (LITELLM_URL) { embeddingClient = new EmbeddingClient(...) }` block with a **lazy accessor** that every consumer calls. Cache at request/job level; re-resolve on `api_accounts` change notification (via an in-memory invalidation bus emitted on provider CRUD).
- `packages/control-plane/src/memory/memory-search.ts` — replace the injected `embeddingClient` with a `() => resolveEmbeddingClient(...)` getter.
- `packages/control-plane/src/memory/memory-store.ts` — same substitution at the embed call site.
- `packages/control-plane/src/memory/memory-drawer-store.ts` — same.
- `packages/control-plane/src/api/server.ts` — route registration now uses the factory-based accessor instead of the boot-time `embeddingClient?` param.

Outcome: configuring a provider in Settings immediately enables `/api/memory/search` without restart. No `LITELLM_URL` env needed (retained as fallback only for transition compatibility; deprecated).

### 7.4 Cost accounting across all four kinds (fixes [R2b P0-15])

- `EmbeddingClient.embedBatchWithUsage` returns `usage.promptTokens`.
- `embedding-backfill` and `drawer-backfill` accumulate directly.
- `consolidation` and `synthesis` call into `KnowledgeMaintenance.run(scope?)` and `KnowledgeSynthesis.runSynthesis(scope?)` (verified APIs per `/tmp/memory-ops-v2-facts.md` items 22-23). Those services currently accept an injected `EmbeddingClient`. PR E wraps the injected client with a cost-tracking decorator that increments the outer job's `progress.costUsd` on every `embedBatchWithUsage` call. Handler side: `const tracker = new CostTracker(); const wrappedClient = wrapWithCostTracking(baseClient, tracker); await new KnowledgeMaintenance({ pool, memoryStore, logger, embeddingClient: wrappedClient }).run(scope);`
- `usage.promptTokens` absent from provider response → fall back to a `tiktoken` estimate (4 tokens per char heuristic) and set `progress.usageEstimated=true` on the job (fixes [R1b P1#23]).

## 8. `content_model` + `embedding_model` Lock (fixes [R1b P0#4, P0#5, R2b P0-14])

**Lock condition** — based on ACTUAL embedded rows, not the column default:

```sql
-- Is the active provider's model safe to use?
SELECT content_model, COUNT(*) AS c
FROM memory_facts
WHERE embedding IS NOT NULL
GROUP BY content_model;
```

- 0 rows with embeddings → any provider allowed.
- 1 distinct `content_model` X, ≥ 1 row → new provider must have `model = X`, else UI blocks save with `MODEL_MISMATCH` error and directs to re-embed-all (v1.1).
- ≥ 2 distinct `content_model` → DB is already poisoned; UI shows persistent warning banner + "Re-embed all" CTA (link to v1.1 task). **Search still functions** but with a `mixed-models` fail-closed filter that restricts results to the majority model (fixes [R1b P0#5], soft-landing per [R2b P2-46]).

**Same rule for `memory_drawers.embedding_model`** (fixes [R2b P0-14]):
- drawer-backfill writes both `embedding` and `embedding_model` in the batch UPDATE.
- UI lock considers both columns unioned.

**Batch UPDATE SQL (fixes [R1b P0#3]):**

```sql
-- memory_facts.id is TEXT (verified drizzle/0010_add_memory_layer.sql:19; schema.ts:357)
UPDATE memory_facts AS f
SET    embedding     = v.embedding::vector,
       content_model = $2
FROM   (SELECT id, embedding
        FROM jsonb_to_recordset($1::jsonb)
        AS x(id text, embedding text)) v   -- id is TEXT not UUID
WHERE  f.id = v.id AND f.embedding IS NULL;
```

Same cast pattern as `memory-store.ts:231,606` (verified). `$1` is `[{"id":"...","embedding":"[0.1,0.2,...]"}, ...]`. Drawer equivalent uses `memory_drawers.embedding` + `memory_drawers.embedding_model`.

**Performance target** for 19,226 facts: **8 minutes wall-clock at median**. 192 batches × (~2.5s OpenAI round-trip + ~30ms batch UPDATE) + overhead. Plan PR E acceptance records the real number.

## 9. Runtime Credential Path Filter (PR A)

All reads/writes to `api_accounts` must filter by `credential_kind='runtime'` (fixes [R1b P1#18, R2b P0-1]):

- `packages/control-plane/src/api/routes/accounts.ts` — GET `/`, POST, PATCH, DELETE, POST `/:id/test`.
- `packages/control-plane/src/scheduler/task-worker.ts:301-312` (runtime credential resolution).
- `packages/control-plane/src/api/routes/sessions.ts:1597-1601` (failover selection).
- `packages/control-plane/src/api/routes/oauth.ts` (asserts runtime only).
- `packages/control-plane/src/api/routes/settings.ts:79-88` (validates `default_account_id` — must fail 422 if target row is `credential_kind='embedding'`).
- `project_account_mappings` writes — validate target `api_accounts.credential_kind='runtime'` (verified: `project_account_mappings` table exists via `schema.ts:464-475`).

PR A adds one failing test per site proving the filter is applied; then implements.

## 10. Audit Logger (PR A interface + PR B/D implementation)

Fixes [R2b P0-18, R1b P1#20].

`packages/shared/src/memory/ops-audit.ts` (PR A) exports `MemoryOpsAuditEntry { actor, action, target, context, timestamp }` and `interface MemoryOpsAuditLogger { write(entry): Promise<void> }`.

- `actor`: `req.headers['x-agentctl-actor']` with `local:${os.hostname()}` fallback.
- `action` enum: `provider.{create,update,delete,rotate-key,test,test-failed}` + `job.{create,cancel,complete,fail}`.
- `target`: provider_id or job_id.
- `context`: structured metadata, never plaintext keys.

Concrete impl (PR D): `packages/control-plane/src/memory/ops/audit-logger.ts` writes to the existing `agent_actions` table (verified shape at `packages/control-plane/src/api/routes/audit.ts:48-93`) — `action_type=entry.action`, `tool_name='memory-ops'`, `tool_input={ target, context, actor }`.

**No hash-chain in v1** (CP has none today — verified by grep). Every write path (provider CRUD + test + test-ephemeral + job POST/cancel + internal state changes) calls the logger.

## 11. SSRF / Egress Controls

- **`baseUrl` not user-configurable.** Catalog-only (§6.3); Zod `.strict()` rejects unknown fields → VALIDATION_ERROR.
- **Egress ack is server-enforced** (§6.2); UI dialog is a convenience on top.
- **Redaction truth** (fixes [R1b P0#10]): `redactMemoryWriteMetadata` + `sanitizeMemoryDrawerContent` cover **drawer writes only**, not `memory_facts.content`. v1 transmits existing fact content as-is to the provider after operator egress confirmation. Document this explicitly in §12 (below) and in the UI dialog copy.

## 12. Data Egress UI Copy

Before the first `embedding-backfill` / `drawer-backfill`: show destination host (from catalog), estimated row count, estimated tokens + cost; warn plainly that existing facts leave as-is while new drawer imports are sanitized; require an explicit "I understand memory content will leave this machine" checkbox. Submit posts `egressConfirmed:true` (§6.2) server-side.

## 13. UI Surface

### 13.1 Settings → Memory & Embeddings (PR C — `minor` bump)

- File: `packages/web/src/views/settings/MemoryEmbeddingsSection.tsx` (new).
- Registered in `SettingsView.tsx` nav array (`:26-67`) after `credentials-access`, before `workers-sync`. Uses `SettingsSection` wrapper (verified: `packages/web/src/views/settings/SettingsShell.tsx:56-82`).
- Provider list via `useQuery(memoryProvidersQuery())` — follows existing hook pattern (verified: `queries.ts` exports `queryOptions()` helpers consumed at the call site with `useQuery(...)`; e.g., `MemoryBrowserView.tsx:166`).
- Add/Edit dialog:
  - Test-before-save via POST `/api/memory/providers/test-ephemeral`. Success stores the `signedToken` in dialog state; POST `/` includes `recentTestResult` payload.
  - Edit mode + apiKey unchanged → Test calls `/:id/test`.
  - Edit mode + apiKey changed → Test calls `/test-ephemeral`.
- Save banner: "This provider will only be available on this machine."

### 13.2 `/memory/operations` (PR F — `minor` bump)

- View: `packages/web/src/views/MemoryOperationsPage.tsx`.
- Route: `packages/web/src/app/memory/operations/page.tsx`.
- Sidebar: add to `MEMORY_NAV_ITEMS` in `packages/web/src/components/memory/MemorySidebar.tsx:13-40` (verified exists with 10 items).
- Layout:
  - `<MissingEmbeddingAlert />` at top.
  - Egress confirmation dialog on first backfill per browser session.
  - 4 `<JobCard />` grid. `Run now` button disabled when: (a) any job of that kind is running anywhere in the mesh, (b) local peer lacks an active provider AND kind needs one, or (c) `MEMORY_OPS_ENABLED=false`.
  - `<RecentJobsTable />` (20 rows) — kind/status filter.
  - `<JobDetailDrawer />` — live SSE, cancel button, log tail. Peer-owned jobs render read-only (no Cancel).

### 13.3 `<MissingEmbeddingAlert />`

File: `packages/web/src/components/memory/MissingEmbeddingAlert.tsx`.

Renders when:
- `useQuery(memoryProvidersQuery())` returns empty, OR
- The active provider's `metadata.last_test_ok === false`, OR
- `metadata.last_test_ok === null` (never tested).

Non-dismissible. Links to `/settings#memory-embeddings` anchor (wired via `SettingsSection id="memory-embeddings"`).

### 13.4 Alert mount points — all 10 views (fixes [R2b P0-5])

| View | File | Mount alert? |
|---|---|---|
| Memory Browser | `packages/web/src/views/MemoryBrowserView.tsx` | Yes |
| Memory Dashboard | `packages/web/src/views/MemoryDashboardView.tsx` | Yes |
| Memory Drawers | `packages/web/src/views/MemoryDrawersView.tsx` | Yes |
| Memory Import | `packages/web/src/views/MemoryImportView.tsx` | **No** — import doesn't require embeddings |
| Memory Maintenance | `packages/web/src/views/MemoryMaintenancePage.tsx` | Yes |
| Memory Reports | `packages/web/src/views/MemoryReportsView.tsx` | Yes |
| Memory Scope Manager | `packages/web/src/views/MemoryScopeManagerView.tsx` | **No** — scope CRUD is orthogonal |
| Memory Synthesis | `packages/web/src/views/MemorySynthesisPage.tsx` | Yes |
| Knowledge Graph | `packages/web/src/views/KnowledgeGraphView.tsx` | Yes |
| Consolidation Board | `packages/web/src/views/ConsolidationBoardView.tsx` | Yes |

8 mounts, 2 exempt. File count matches reality: 10 (verified via `ls`).

### 13.5 Web API client

- Barrel: single file `packages/web/src/lib/api.ts` (verified; NOT `api/index.ts`).
- Core helper: `request<T>(path, init)` (verified `core.ts:21`). `apiFetch` does not exist.
- New modules:
  - `packages/web/src/lib/api/memory-providers.ts` — exports typed client methods.
  - `packages/web/src/lib/api/memory-ops.ts` — same.
- Query helpers added to `queries.ts` under existing `queryKeys.memory.*` namespace (verified: `queries.ts:159-181`).
- `queryOptions(...)` pattern matches existing hooks (PR C does NOT add `useQuery` to import list since views always call `useQuery(providersQuery())`).

## 14. Error Envelope (flat; matches existing project code)

Fixes [R1b P0#12]. Matches `server.ts:937-962` + `web/src/lib/api/core.ts:21-44`.

```jsonc
{ "error": "STABLE_CODE", "message": "...", "hint": "..." }
```

| Scenario | HTTP | `error` code |
|---|---|---|
| Zod input invalid | 422 | `VALIDATION_ERROR` |
| No active embedding provider on job create | 409 | `EMBEDDING_NO_PROVIDER` |
| Provider 401 at test or mid-job | 401 | `PROVIDER_AUTH_FAILED` |
| Provider 429 upstream | 429 | `PROVIDER_RATE_LIMITED` |
| Our own rate limit | 429 | `RATE_LIMITED` |
| Decrypt failure | 500 | `EMBEDDING_CREDENTIAL_DECRYPT_FAILED` |
| Delete or deactivate provider with active jobs | 409 | `PROVIDER_HAS_ACTIVE_JOBS` |
| Provider not found | 404 | `PROVIDER_NOT_FOUND` |
| Cancel on terminal job | 409 | `JOB_NOT_CANCELLABLE` |
| Cancel already in progress | 202 | `CANCEL_ACCEPTED` |
| Advisory-lock loss on enqueue | 409 | `JOB_ALREADY_RUNNING` |
| Partial unique index violation | 409 | `DUPLICATE_ACTIVE_EMBEDDING` |
| Egress not confirmed on egressing job | 400 | `EGRESS_NOT_CONFIRMED` |
| MEMORY_OPS_ENABLED=false on POST /jobs | 400 | `FEATURE_DISABLED` |
| New provider model != existing content_model | 409 | `MODEL_MISMATCH` |
| Job exists but originates from another peer | 403 | `REMOTE_PEER_JOB` (for cancel attempts) |

## 15. Testing Strategy

- **Docker Postgres with pgvector for integration tests** (fixes [R2b P1-28]). `pg-mem` cannot run `::vector` casts. Reuse the pattern from existing memory-store tests (verified: `packages/control-plane/src/memory/memory-store.test.ts` uses real PG in test helpers).
- Every PR: failing test → implementation → passing test → commit.
- **Coverage goal:** match or exceed each package's existing coverage baseline; no new regressions.
- **Playwright path** (fixes [R2b P0-12]): `packages/web/e2e/memory-ops/*.spec.ts` — real directory. Existing directory has 49 spec files; reuse setup/teardown patterns.
- **Required integration tests:**
  - Partial unique index fires under concurrent active-inserts (Docker PG).
  - Batch UPDATE writes N rows in one round trip; updates both `embedding` and `content_model`.
  - Ownership claim races: two CPs with different `MACHINE_ID` — only one wins.
  - 401 response from stub provider → job fails + `api_accounts.is_active=false`.
  - `egressConfirmed:false` on POST /jobs → 400 `EGRESS_NOT_CONFIRMED`.
  - Migration 0033 + rollback against a populated `api_accounts` table.
  - `memory_facts.embedding` ADD-equivalent lock check: no-embeddings state allows any provider.
- **Required e2e (Playwright):**
  1. OpenAI full journey: Settings → Add → Test pre-save → Save → confirm egress → Run embedding-backfill → see progress → `/memory/maintenance` non-empty.
  2. Gemini full journey: stubbed at `https://generativelanguage.googleapis.com/v1beta/openai/embeddings`. Asserts `output_dimensionality:1536` in body.
  3. Alert coverage: no provider → `MissingEmbeddingAlert` on all 8 target views; absent on Import + ScopeManager.

## 16. Rollout

| PR | Scope | Bump | Enabled by default | Critical path? |
|---|---|---|---|---|
| **A** | Migration `0033_add_memory_ops.sql` + rollback script (all three statement groups: `api_accounts` extensions, `memory_ops_jobs`, `memory_ops_job_events`); Drizzle schema; `TABLE_SYNC_CONFIG` += `memory_ops_jobs`; `EmbeddingClient` additive (`apiKey` / `extraBody` / `embeddingsPath` / `embedBatchWithUsage` / typed error `context.status`); runtime-path `credential_kind='runtime'` filter on all call sites (§9); `MemoryOpsAuditLogger` interface; catalog + shared types | **patch** | n/a | Yes |
| **B** | `/api/memory/providers` CRUD + `/test` + `/test-ephemeral` + `resolveEmbeddingClient` factory; migrate `MemorySearch` / `MemoryStore` / `memory-drawer-store` off `LITELLM_URL`-gated boot-time client; audit logger concrete impl for provider events | **patch** | n/a | Yes |
| **C** | Settings → Memory & Embeddings UI | **minor** | first user-visible UI | Yes |
| **D** | `memory-ops` BullMQ queue + `JobsRepository` + `JobEventsRepository` + `/api/memory/ops/jobs` CRUD + SSE; `MEMORY_OPS_ENABLED=false` default; log-retention extension for job events | **patch** | n/a | Yes |
| **E** | `embedding-backfill` + `drawer-backfill` handlers + worker boot + cost tracker + 401 deactivate | **patch** | `MEMORY_OPS_ENABLED=false` | Yes — **19k backfill unblocks via API** |
| **F** | `/memory/operations` page + 8 `MissingEmbeddingAlert` mounts + sidebar entry + egress dialog; `MEMORY_OPS_ENABLED=true` default; audit logger for job events | **minor** | **Yes** | No |
| **G** | `consolidation` + `synthesis` handlers with cost-tracker wrap; Playwright e2e (3 specs); CHANGELOG + runbook | **patch** | n/a | No |

**Rollback order:** reverting PR E without PR F is safe iff `MEMORY_OPS_ENABLED=false` is set first (route rejects POST) and the queue is drained. PR D can stand alone (routes exist, handlers silently unavailable). PR A+A+B can be reverted via the 0033-down SQL (§5.5).

## 17. Operational Runbook

Ships with PR G's release notes.

- **Pause the queue:** `pm2 stop agentctl-cp-<tier>` (worker is in-process; no separate command). For finer control, set `MEMORY_OPS_ENABLED=false` and restart.
- **Force-fail stuck running jobs:** first stop the CP process for the owning machine (`pm2 stop ...`), then run `UPDATE memory_ops_jobs SET status='failed', error_code='MANUAL_FAIL', error='manual intervention', finished_at=now() WHERE status='running' AND executor_machine_id=$1`. Ordering matters — DO NOT run the UPDATE with worker still active (§17 vs §18 invariant fix, [R2b P1-22]).
- **Purge old events:** handled automatically by log-retention worker; manual: `DELETE FROM memory_ops_job_events WHERE created_at < now() - interval '14 days'`.
- **Orphan credential_id on peer:** occurs when a job row syncs to a peer that never had the originating provider. UI labels it "(provider: not visible on this machine)"; to recover, either create a provider locally and retry the job, or delete the stale row.
- **Re-embed all with new model** (v1.1 not yet implemented): `UPDATE memory_facts SET embedding = NULL WHERE content_model = '<old>'`, then enable a new provider, then POST `/api/memory/ops/jobs {kind:'embedding-backfill', egressConfirmed:true}`. Warn: memory search returns empty during the re-embed window.

## 18. Acceptance Criteria

- Given an empty `api_accounts` list, opening Settings → Memory & Embeddings and adding an OpenAI provider, clicking Test shows `dim=1536, costUsd > 0, latencyMs > 0` BEFORE Save.
- With no provider, `<MissingEmbeddingAlert />` renders on all 8 target views; absent on Memory Import + Memory ScopeManager.
- With an active provider + ≥ 1 fact having `embedding IS NULL`, triggering `embedding-backfill`:
  - writes both `embedding` and `content_model` per fact;
  - reports `progress.embedded`, `progress.processed`, `progress.costUsd` monotonically increasing;
  - ends `status='completed'` when `failed / total < 0.05`; else `status='failed'`.
- Deleting active provider with a running job → 409 + `blockingJobIds`. After cancel → 204.
- Two concurrent POST /providers `{active:true}` → one 201, one 409 `DUPLICATE_ACTIVE_EMBEDDING`.
- Rotating key resets `lastTestOk=null`, clears `lastTestError`; bumps `updated_at`.
- OpenAI 401 mid-job → job `status='failed'`, `error_code='PROVIDER_AUTH_FAILED'`, provider `is_active=false`.
- Cancelling mid-batch → `status='cancelled'`, never rewrites to `completed` even if handler returns naturally. Terminal-transition invariant enforced in repo (WHERE status IN ('queued','running')).
- SSE reconnect with `Last-Event-Id: N` on the same peer → replays N+1..current from `memory_ops_job_events`.
- Peer mesh: provider created on A not visible on B (expected, documented). Job created on A → `executor_machine_id=A`; visible on B as read-only.
- POST /jobs without `egressConfirmed:true` for embedding-backfill → 400 `EGRESS_NOT_CONFIRMED`.
- POST /jobs with `MEMORY_OPS_ENABLED=false` → 400 `FEATURE_DISABLED`.
- Migration 0033 on a populated `api_accounts` (19k facts pre-existing) completes successfully; every pre-existing row ends with `credential_kind='runtime'`; partial unique index does not fire on runtime rows.

**Manual performance bench:** 19,226 facts → OpenAI `text-embedding-3-small`, median < 10 min, cost ≈ $0.05-$0.10. Real number recorded in PR E by dev-1 verification.

## 19. Risks

| Risk | Mitigation |
|---|---|
| Gemini AI Studio URL convention drifts | Catalog is single source of truth; `validateCatalog()` runs at boot; add live `/v1beta/openai/models` smoke test behind `MEMORY_OPS_CATALOG_SMOKE=1`. |
| Price catalog drifts | Quarterly catalog-audit PR in risk register. Cost column in DB is historical (captured at job time); stays correct even if catalog updates. |
| Mesh peer runs old schema | Existing `sync_nodes_schema_ahead_rejection` (migration 0027) rejects cross-version sync. PR A includes mesh-behind test. |
| Worker crash during long backfill | v1: boot reconciliation marks jobs failed. v1.1: resumable via `memory_ops_jobs.progress.currentBatch`. |
| In-process worker blocks Fastify event loop | BullMQ offloads to a dedicated async iteration; fetch is non-blocking; DB calls are async. Monitor p99 API latency during a 19k backfill in PR E dev-1. |

## 20. Open Questions

None. All reviewer items are dispositioned in Appendix B.

---

## Appendix A — Files created/modified per PR

Every path verified against `/Users/hahaschool/agentctl/.trees/memory-ops-spec` or `/tmp/memory-ops-v2-facts.md`.

**Convention:** every `.ts` file adds a matching `.test.ts`; `.tsx` → `.test.tsx`. Tests not listed separately unless path diverges.

### PR A (schema + shared types + runtime filter + client additive)
- A: `drizzle/0033_add_memory_ops.sql` + `0033_add_memory_ops.down.sql`
- M: `drizzle/meta/_journal.json`
- M: `packages/control-plane/src/db/schema.ts` — apiAccounts (+columns), add memoryOpsJobs + memoryOpsJobEvents
- M: `packages/shared/src/types/sync.ts` — TABLE_SYNC_CONFIG entry
- A: `packages/shared/src/memory/{providers,ops,ops-audit}.ts`
- M: `packages/shared/src/memory/index.ts`
- M: `packages/control-plane/src/memory/embedding-client.ts` (additive)
- M: `packages/control-plane/src/api/routes/{accounts,sessions,oauth,settings}.ts` — runtime-kind filter
- M: `packages/control-plane/src/scheduler/task-worker.ts` — runtime-kind filter

### PR B (provider backend + runtime rewiring)
- A: `packages/control-plane/src/memory/embedding-client-factory.ts`
- A: `packages/control-plane/src/api/routes/memory-providers.ts`
- A: `packages/control-plane/src/memory/ops/audit-logger.ts`
- M: `packages/control-plane/src/memory/{memory-search,memory-store,memory-drawer-store}.ts` — factory accessor
- M: `packages/control-plane/src/api/server.ts` — register route + factory-cache invalidation
- M: `packages/control-plane/src/index.ts` — retain LITELLM_URL as deprecated fallback only

### PR C (Settings UI) — `minor` bump
- A: `packages/web/src/lib/api/memory-providers.ts`
- A: `packages/web/src/components/memory/ProviderDialog.tsx`
- A: `packages/web/src/views/settings/MemoryEmbeddingsSection.tsx`
- M: `packages/web/src/views/SettingsView.tsx` — nav item + section id
- M: `packages/web/src/lib/api.ts` — re-exports
- M: `packages/web/src/lib/queries.ts` — add `memoryProvidersQuery()` under `queryKeys.memory.providers`

### PR D (queue + routes + SSE)
- A: `packages/control-plane/src/memory/ops/{queue,jobs-repository,job-events-repository,sse-stream,worker-runtime}.ts`
- A: `packages/control-plane/src/api/routes/memory-ops.ts`
- M: `packages/control-plane/src/api/server.ts` — register route + pg LISTEN client
- M: `packages/control-plane/src/index.ts` — boot queue (not worker yet)
- M: `packages/control-plane/src/audit/log-retention.ts` — add `memory_ops_job_events` retention

### PR E (backfill handlers)
- A: `packages/control-plane/src/memory/ops/{embedding-backfill,drawer-backfill,worker,cost-tracker}.ts`
- A: `packages/control-plane/src/memory/ops/e2e.test.ts` — stub-server journey
- M: `packages/control-plane/src/index.ts` — boot worker

### PR F (ops UI + alerts) — `minor` bump
- A: `packages/web/src/lib/api/memory-ops.ts`
- A: `packages/web/src/components/memory/{JobCard,RecentJobsTable,JobDetailDrawer,MissingEmbeddingAlert,EgressConfirmationDialog}.tsx`
- A: `packages/web/src/views/MemoryOperationsPage.tsx`
- A: `packages/web/src/app/memory/operations/page.tsx`
- M: `packages/web/src/components/memory/MemorySidebar.tsx` — add Operations nav item
- M: 8 views in §13.4 — mount `<MissingEmbeddingAlert />`
- M: `packages/web/src/lib/queries.ts` — add ops hooks
- M: `.env.example` — `MEMORY_OPS_ENABLED=true` default

### PR G (consolidation + synthesis + e2e)
- A: `packages/control-plane/src/memory/ops/{consolidation,synthesis}.ts`
- A: `packages/web/e2e/memory-ops/{openai-happy,gemini-happy,missing-embedding-alert}.spec.ts`
- M: `packages/control-plane/src/memory/ops/worker.ts` — register new kinds
- M: `CHANGELOG.md`; `docs/QUICKSTART.md` — runbook snippet

---

## Appendix B — Reviewer traceability

Numbered disposition list: `/tmp/memory-ops-v2-reviewer-checklist.md` (74 items). All Round 2 P0s (Reviewer 1 × 12 + Reviewer 2 × 18 = 30) dispositioned Fix; 65 total Fix, 5 Absorbed-by-upstream-decision, 0 Deferred within v1 scope.

Material cross-references (§ mappings):
- R1b P0: #1 → §7.3, #2 → §5.1 (schema in PR A), #3 → §8 (id text), #4 → §8 (embedded rows only), #5 → §8 (backend filter), #6 → §6.3 (embeddingsPath='/embeddings'), #7 → §5.2 (executor_machine_id), #8 → §5.2 (executor column is the real invariant), #9 → §6.2 (server-enforced egress), #10 → §11 (facts as-is truth), #11 → §5.3 (events local-only), #12 → §14 (flat envelope).
- R2b P0-5 → §13.4, P0-11 → §17, P0-12 → Appendix A (`packages/web/e2e/`), P0-13 → §16 (C/F minor), P0-16 → §13.5 (queryOptions), P0-17 → §4 (boot reconciliation), P0-18 → §10.

Deferred to v1.1 with explicit note in §3: crash-resumable workers, facts-content sanitize-before-embed, hash-chained audit, prefix scope matching.
