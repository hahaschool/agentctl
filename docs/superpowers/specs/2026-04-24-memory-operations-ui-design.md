# Memory Operations UI — Design Spec (SUPERSEDED)

> **⚠️ STATUS: SUPERSEDED — DO NOT IMPLEMENT.**
>
> This v0 spec was rejected by two reviewers on 2026-04-24 for factual errors and
> architectural mistakes. Kept as a reference for the rewrite, not as a plan to execute.
>
> **Review artifacts (read these first):**
> - [Reviewer 1 — strict review, 414 lines, 45 issues](./2026-04-24-memory-operations-ui-spec-plan-strict-review.md)
> - [Reviewer 2 — batch critique, 570 lines, 1 fatal + 10 blockers](../reviews/2026-04-24-memory-operations-ui-review.md)
>
> **Headline problems:**
> 1. Assumed `api_accounts` mesh-syncs; it is explicitly local-only per `sync.ts:182`.
> 2. Hallucinated 5+ frontend file paths (`SettingsPage.tsx`, `apiFetch`, `MemoryGraphPage.tsx`, `MemoryConsolidationView.tsx`, `runConsolidation`).
> 3. Silent LiteLLM breaking change buried in feature PR (`/v1/embeddings` → `/embeddings`).
> 4. Runtime credential paths not updated to filter embedding-kind rows — would break `accounts.ts`, `sessions.ts`, `task-worker.ts`.
> 5. Cost, 401-auto-deactivate, audit log, `content_model` handling, batch-UPDATE all promised in spec but absent from plan.
>
> **Forward link:** The v1 rewrite lives at `2026-04-24-memory-operations-ui-design-v1.md` (per-machine providers, URL fix as precursor PR, verified file paths, transaction-safe single-active, content_model lock, cost tracking, audit logger wired).
>
> ---
>
> Historical content below preserved for traceability.
>
> **Date:** 2026-04-24 (original, superseded)
> **Author:** hahaschool + Claude (brainstorming skill)
> **Supersedes:** nothing; this was the first (failed) end-to-end design for memory maintenance UI
> **Related plans:** [2026-04-15 MemPalace memory evolution](../../plans/2026-04-15-mempalace-inspired-memory-evolution-plan.md)

## Problem

The memory subsystem has shipped most of its Phase 0-7 infrastructure (drawer schema, fact-source provenance, consolidation API, synthesis API, drawer-fusion search, browser/drawer/graph UI), but the **operator surface** — the way a human actually configures and runs this infrastructure — is incomplete:

1. **No UI to configure embedding providers.** Settings → Credentials & Access only stores Claude runtime credentials (`sk-ant-...`). The embedding client reads `LITELLM_URL` from the process environment. A user with 19,226 already-imported facts has no way to turn embedding on short of shell-editing `.env` and restarting the control plane.
2. **No UI to trigger long-running memory jobs.** `scripts/backfill-memory-drawers.ts`, `knowledge-maintenance.ts`, and `knowledge-synthesis.ts` exist and work, but they are CLI-only. The `/memory/maintenance` and `/memory/synthesis` pages surface **results** from a synchronous API call, not progress for a background backfill of 19k facts.
3. **Downstream UI silently degrades when embeddings are absent.** `/memory/maintenance`, `/memory/synthesis`, `/memory/graph`, `/memory/browser`, and `/memory/drawers` all render empty or partial results when the embedding client is unavailable. The user sees "no results" and concludes the feature is broken, when the real cause is an unconfigured provider.

The observable consequence: the user's DB currently holds **19,226 `memory_facts` with `embedding IS NULL`, 0 `memory_drawers`, 0 `memory_fact_sources`, and 0 `memory_edges`** — a halfway data load that makes `/memory/graph` look like a field of disconnected points.

## Goals

- **Configure an embedding provider from the UI**, with encrypted key storage that matches the existing runtime-credential pattern.
- **Trigger and observe long-running memory maintenance jobs from the UI**: embedding backfill, drawer backfill, consolidation run, synthesis run.
- **Warn operators loudly** when they land on a memory page whose value depends on an unconfigured provider.
- **Deliver incrementally.** Two PRs should be enough to unblock the immediate pain (configure OpenAI key, run embedding backfill on 19k facts); the remaining PRs finish the set.

## Non-Goals (v1)

- iOS client surface — web-only.
- Embedding providers beyond OpenAI + Gemini (AI Studio). Voyage / Azure / Bedrock / Anthropic-routed / local Ollama are deferred to v2.
- Schema migration of `memory_facts.embedding` from `vector(1536)` to a variable-dimension column. Both chosen providers can produce 1536-dim vectors, so v1 keeps the existing schema.
- Multiple simultaneously active embedding providers. v1 has one active at a time; switching is a Settings operation.
- Scheduled / cron maintenance runs. v1 is manual-trigger only; scheduler integration is v2.
- Cost budgets and kill switches. v1 records cost per job but does not enforce caps.
- Automatic rebuild of `memory_edges` during embedding backfill. Edge synthesis remains a separately-triggered job.

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│ Web (Next.js)                                                 │
│  ┌─────────────────────┐   ┌──────────────────────────────┐   │
│  │ Settings → Memory   │   │ /memory/operations           │   │
│  │ & Embeddings        │   │  [4 JobCards | history table │   │
│  │  (CRUD providers)   │   │   | SSE detail drawer]       │   │
│  └──────────┬──────────┘   └─────────────┬────────────────┘   │
│             │                            │                    │
│  ┌──────────┴────────────────────────────┴─────────────────┐  │
│  │ <MissingEmbeddingAlert /> on maintenance, synthesis,   │  │
│  │ consolidation, graph, browser, drawers pages           │  │
│  └──────────────────────────┬─────────────────────────────┘  │
└─────────────────────────────┼─────────────────────────────────┘
                              │ HTTP + SSE
┌─────────────────────────────┼─────────────────────────────────┐
│ Control plane (Fastify)     │                                 │
│                             ▼                                 │
│  /api/memory/providers         (CRUD + /test)                 │
│  /api/memory/ops/jobs          (CRUD + /cancel + /stream)     │
│                     │                                         │
│                     ▼                                         │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ memory-ops BullMQ queue                                │   │
│  │  ├── embedding-backfill worker                         │   │
│  │  ├── drawer-backfill worker (wraps existing script)   │   │
│  │  ├── consolidation worker                              │   │
│  │  └── synthesis worker                                  │   │
│  └──────────────────────┬─────────────────────────────────┘   │
│                         ▼                                     │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ EmbeddingClient factory                                │   │
│  │  - resolves credential_id → metadata           │   │
│  │  - OpenAI: api.openai.com/v1/embeddings               │   │
│  │  - Gemini: generativelanguage.googleapis.com/.../openai│   │
│  └────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│ PostgreSQL                                                    │
│  api_accounts (+ credential_kind; metadata holds provider cfg)│
│  memory_ops_jobs (new)                                        │
│  memory_facts / memory_drawers / memory_fact_sources / edges  │
└───────────────────────────────────────────────────────────────┘
```

## Data Model

### `api_accounts` extension

The existing runtime-credential table is `api_accounts` (Drizzle schema `apiAccounts` in `packages/control-plane/src/db/schema.ts`). Columns already present: `id`, `name`, `provider`, `credential` (AES-GCM-encrypted secret), `credential_iv`, `priority`, `rate_limit`, `is_active`, `metadata` (jsonb), `created_at`, `updated_at`. The UI labels these "Managed Credentials"; the schema name stays `api_accounts`.

v1 adds a single new column and one index:

```sql
-- drizzle/0033a_api_accounts_credential_kind.sql
ALTER TABLE api_accounts
  ADD COLUMN credential_kind text NOT NULL DEFAULT 'runtime';

ALTER TABLE api_accounts
  ADD CONSTRAINT api_accounts_kind_check
  CHECK (credential_kind IN ('runtime', 'embedding'));

CREATE INDEX idx_api_accounts_kind ON api_accounts(credential_kind);
```

- Existing rows land on `credential_kind='runtime'` — behaviour unchanged for Claude/Codex runtime auth.
- The existing `metadata jsonb` column carries provider-specific params — no new column needed:
  - OpenAI: `{ "base_url": "https://api.openai.com/v1", "model": "text-embedding-3-small" }`
  - Gemini (AI Studio): `{ "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-embedding-001", "output_dimensionality": 1536 }`
- `is_active` already exists; the "single active provider per kind" invariant is enforced at the API layer, not via a partial unique index, because runtime and embedding can each have their own active row.
- Mesh sync inherits automatically — `sync_capture_change()` already serializes the full row via `to_jsonb(NEW)`, so the new column flows to peers without code changes.
- Schema-ahead mesh peers reject the change until they migrate, honouring the existing `sync_nodes_schema_ahead_rejection` contract.

### `memory_ops_jobs` (new)

```sql
-- drizzle/0033b_memory_ops_jobs.sql
CREATE TABLE memory_ops_jobs (
  id            text PRIMARY KEY,
  kind          text NOT NULL
                CHECK (kind IN ('embedding-backfill','drawer-backfill','consolidation','synthesis')),
  status        text NOT NULL
                CHECK (status IN ('queued','running','completed','failed','cancelled')),
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress      jsonb NOT NULL DEFAULT '{"done":0,"total":0,"costUsd":0,"errorCount":0}'::jsonb,
  result        jsonb,
  error         text,
  credential_id uuid REFERENCES api_accounts(id) ON DELETE SET NULL,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text
);

CREATE INDEX idx_memory_ops_jobs_status ON memory_ops_jobs(status);
CREATE INDEX idx_memory_ops_jobs_kind_created
  ON memory_ops_jobs(kind, created_at DESC);

CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE ON memory_ops_jobs
  FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');
```

- `credential_id` lets a failed job tell the operator *which* provider to rotate. `ON DELETE SET NULL` — deleting a provider does not cascade-destroy job history.
- `progress` is a single JSONB column to avoid schema churn when adding new progress fields. Canonical shape: `{ done, total, costUsd, errorCount, currentBatch?, etaSeconds? }`.
- Mesh sync is enabled — running a backfill on one peer surfaces to others so a human cannot accidentally double-run.

## API Contract

All routes live under `/api/memory/` in control-plane. Existing `/api/memory/maintenance`, `/api/memory/synthesis`, `/api/memory/consolidation` routes are **unchanged** — v1 adds a thin background-job layer beside them rather than replacing them. A web page can continue to call the synchronous API when it wants an immediate result, and switch to the queued API when the work is long-running.

### Provider CRUD

```
GET    /api/memory/providers                  -> { providers: EmbeddingProvider[] }
POST   /api/memory/providers                  -> { provider: EmbeddingProvider }
PATCH  /api/memory/providers/:id              -> { provider: EmbeddingProvider }
DELETE /api/memory/providers/:id              -> 204
POST   /api/memory/providers/:id/test         -> { ok: true, dim: 1536, model, costUsd }
                                              -> 401/422 with structured error on failure
```

Payload (POST/PATCH):
```json
{
  "name": "OpenAI personal",
  "provider": "openai" | "gemini",
  "model": "text-embedding-3-small",
  "apiKey": "sk-...",                 // write-only, AES-GCM encrypted at rest
  "baseUrl": "https://api.openai.com/v1",
  "outputDimensionality": 1536,       // gemini only
  "active": true                      // deactivates others (single-active v1)
}
```

Response shape:
```json
{
  "id": "prov_01J...",
  "name": "OpenAI personal",
  "provider": "openai",
  "model": "text-embedding-3-small",
  "baseUrl": "https://api.openai.com/v1",
  "apiKeyLast4": "...Zq8M",           // key itself never leaves server
  "dim": 1536,
  "active": true,
  "lastTestAt": "2026-04-24T18:30:00Z",
  "lastTestOk": true,
  "lastTestError": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

### Ops Job CRUD

```
POST   /api/memory/ops/jobs                   -> { job: MemoryOpsJob }
GET    /api/memory/ops/jobs?kind=&status=&limit=  -> { jobs: MemoryOpsJob[] }
GET    /api/memory/ops/jobs/:id               -> { job: MemoryOpsJob }
POST   /api/memory/ops/jobs/:id/cancel        -> { job: MemoryOpsJob }
GET    /api/memory/ops/jobs/:id/stream        -> text/event-stream (SSE)
```

POST payload:
```json
{
  "kind": "embedding-backfill",
  "params": {
    "scope": "project:agentctl",       // optional scope filter
    "batchSize": 100,
    "dryRun": false,
    "credentialId": "prov_01J..."      // falls back to active provider when absent
  }
}
```

SSE event types: `progress`, `log`, `completed`, `failed`, `cancelled`. Each event carries the full `MemoryOpsJob` snapshot plus (for `log`) a line of worker output. Heartbeat every 15 s so proxies do not close the stream.

### Shared `EmbeddingProvider` + `MemoryOpsJob` types

Added to `packages/shared/src/memory/` and re-exported from `@agentctl/shared`. Web + control-plane + worker consume the same Zod-validated shapes.

## Embedding Client Factory

Current `EmbeddingClient` is already OpenAI-compat-shaped (`POST {baseUrl}/v1/embeddings`). v1 keeps the class, adds a factory:

```typescript
export async function resolveEmbeddingClient(input: {
  credentialId?: string;
  pool: Pool;
  logger: Logger;
  extraBody?: Record<string, unknown>;  // passed through to the /embeddings call
}): Promise<EmbeddingClient>;
```

- When `credentialId` is absent, resolves the single `active=true` `credential_kind='embedding'` row.
- Decrypts the stored key, constructs the `EmbeddingClient` with `baseUrl` + `model` from `metadata`.
- For Gemini, merges `{ output_dimensionality: 1536 }` into the request body. For OpenAI, passes through unchanged.
- Throws `ControlPlaneError('EMBEDDING_NO_PROVIDER', ...)` when no provider is configured — routes surface this as `409 Conflict` with a structured code the UI can key `<MissingEmbeddingAlert />` on.

`embedding-client.ts` grows one optional `extraBody` constructor option so Gemini's dimensionality parameter rides through without a provider-specific branch.

## Background Jobs

A new BullMQ queue `memory-ops` is initialised alongside the existing agent-task queue in `scheduler/`. Each job kind lives in its own file under `control-plane/src/memory/ops/`:

| File | Kind | Source | Batch | Idempotency | Cost |
|---|---|---|---|---|---|
| `embedding-backfill.ts` | `embedding-backfill` | `SELECT id, content FROM memory_facts WHERE embedding IS NULL AND scope LIKE $1 ORDER BY created_at LIMIT $2 OFFSET $3` | 100 facts | `fact.id` — update is a no-op if `embedding IS NOT NULL` | counted per OpenAI/Gemini usage response |
| `drawer-backfill.ts` | `drawer-backfill` | Wraps `scripts/backfill-memory-drawers.ts` — accepts `sourceType: 'claude-mem' \| 'jsonl'` + `sourceRoot` | 50 chunks | `(source_type, source_id, chunk_index)` (existing constraint) | embedding calls counted |
| `consolidation.ts` | `consolidation` | Calls `knowledge-maintenance.ts::runConsolidation` | full run | one active consolidation at a time per scope | embedding + LLM calls counted |
| `synthesis.ts` | `synthesis` | Calls `knowledge-synthesis.ts::runSynthesis` | full run | one active synthesis at a time per scope | same |

Each worker:
1. Claims the job row (`UPDATE memory_ops_jobs SET status='running', started_at=now() WHERE id=$1 AND status='queued'` — losers abort).
2. Loops batches, updating `progress` after each via a single `UPDATE ... SET progress = $progress`.
3. Emits a `pg_notify('memory_ops_job', job_id)` after every progress write. The SSE route listens on this channel and fans the payload to subscribed clients.
4. On rate-limit (HTTP 429 / quota) from the provider: BullMQ's attempt/backoff handles retry. After `maxAttempts=3`, marks the batch failed and logs a structured error into `progress.errorCount` + appends a log line. Worker continues to the next batch — one bad batch does not fail the whole job.
5. On auth failure (401 / invalid key): fails the job immediately, deactivates the provider (`api_accounts.is_active = false` on that `credential_kind='embedding'` row), and surfaces a `PROVIDER_AUTH_FAILED` error code the UI can open the rotate-key dialog on. `lastTestOk` is a derived UI field recomputed from the latest `/providers/:id/test` result (stored in `metadata`).
6. On cancel signal (row updated to `status='cancelled'`): checks between batches, exits cleanly, records `finished_at`.

Concurrency: `memory-ops` queue `concurrency=1` per kind in v1 — there is no benefit to running two embedding-backfills against the same DB, and it keeps progress accounting simple.

## Frontend

### Settings → Memory & Embeddings

New section added to `packages/web/src/views/settings/` as `MemoryEmbeddingsSection.tsx`, wired into `SettingsPage.tsx` directory below `Credentials & Access`.

Section contents:
- **Active provider card** (or empty state with "Add your first embedding provider").
- **Provider list**: table rows with `name · provider · model · last-4 · dim · last test · [Test] [Rotate key] [Edit] [Delete]`.
- **Add / Edit dialog**: Zod-validated form with provider dropdown, model dropdown (provider-filtered), API key input (write-only; on edit shows last-4 + "Rotate key" toggle), `active` checkbox, Test button that runs a live `embed("test")` and displays `dim` + `costUsd` before save.
- **Provider/model matrix** encoded in `packages/web/src/lib/embedding-providers.ts` as a single source of truth for the UI and (via export) for server-side validation.

### `/memory/operations`

New route `packages/web/src/app/memory/operations/page.tsx` + view `views/MemoryOperationsPage.tsx`. Sidebar secondary-nav under "Memory" adds "Operations".

Layout:
- **4 job cards** (one per kind), each showing idle/running/error state, last successful run summary, and a `Run now` button. Running card hosts an inline progress bar fed by SSE. Parameter overrides (scope filter, batch size, dry-run) live in a `<Popover>` behind a `⚙` icon on each card.
- **Recent Jobs table** below, 20 rows, kind + status filters, row click opens the detail drawer.
- **Detail drawer** (right-hand sheet): job metadata, live progress, last 200 log lines (auto-scrolling tail), Cancel button when `running`, Retry button when `failed`.

### `<MissingEmbeddingAlert />`

Single component in `packages/web/src/components/memory/MissingEmbeddingAlert.tsx`. Hits `GET /api/memory/providers` via React Query (stale time 30 s), renders when either:
- The response is empty, or
- The active provider's `lastTestOk === false`.

Mounted on the top of:
- `/memory/maintenance` (MemoryMaintenancePage)
- `/memory/synthesis` (MemorySynthesisPage)
- `/memory/consolidation` (MemoryConsolidationView, when present)
- `/memory/graph` (MemoryGraphPage)
- `/memory/browser` (MemoryBrowserView)
- `/memory/drawers` (MemoryDrawersView)

Copy: "Embeddings aren't configured — search, synthesis, and graph features will return empty or incomplete results. [Configure an embedding provider →]"

## Error Handling

| Scenario | Behaviour |
|---|---|
| Job enqueued but no active provider | `409 Conflict` with code `EMBEDDING_NO_PROVIDER`; UI routes user to Settings. |
| Provider test fails at creation | Save returns `422` with provider error body; dialog stays open with inline error. |
| OpenAI 429 (rate-limited) | BullMQ exponential backoff, job `progress.errorCount++`. Persisting rate-limit above 3 attempts per batch logs + skips. |
| Provider auth (401) mid-job | Job marked `failed`, provider row `is_active=false`, metadata `lastTestOk=false`. Ops detail drawer offers "Rotate key" link. |
| Stream disconnect | SSE reconnect with `Last-Event-Id`; fallback polling at 5 s. |
| Delete provider with running jobs | `409 Conflict` listing the blocking job ids. |
| Migration 0033 not yet applied on mesh peer | Existing `sync_nodes_schema_ahead_rejection` rejects with current error code. No new handling needed. |
| Cancel during critical section | Worker checks cancel flag between batches only; in-flight HTTP request completes naturally. |

All control-plane errors emit structured `ControlPlaneError` with stable codes so the UI keys off `error.code`, not message text.

## Security

- API keys are stored AES-GCM-encrypted in `api_accounts.credential` with the IV in `api_accounts.credential_iv`, matching the existing runtime-credential pattern. The plaintext key never leaves the control-plane process after creation. `GET` responses return only `apiKeyLast4`.
- `POST /api/memory/providers/:id/test` is rate-limited (5 req / min / account) to prevent key-fishing.
- `POST /api/memory/ops/jobs` requires the same approval level as existing maintenance routes (operator role). Read endpoints are viewer-level.
- Audit log: every provider create/update/delete and every job create/cancel emits a hash-chained entry via the existing `audit-logger.ts`, tagged `memory-ops`.
- Cost disclosure: job responses include `costUsd`; the Operations page aggregates monthly totals as a transparency measure, but does not enforce a budget in v1.
- Mesh sync does NOT replicate the plaintext API key — only the encrypted blob + metadata. Peer decryption uses each machine's local key-wrap, same as existing runtime credentials.

## Testing Strategy

### Backend unit

- `resolveEmbeddingClient`: 2 providers × (happy / 401 / 429 / no active provider). Each path asserts structured error code.
- Job handlers: for each of the 4 kinds, cover success (1 batch + multi-batch), mid-run cancel, provider auth failure, rate-limit with backoff, empty source (no facts to embed).
- `memory_ops_jobs` repository: CRUD + status transitions + concurrency (two workers racing to claim).
- Routes: contract tests via Fastify `inject()` — success + every documented error code.

### Backend integration

- BullMQ end-to-end: enqueue a job, drive it with a stub embedding server, assert DB state transitions and SSE events.
- SSE route: reconnect with `Last-Event-Id` replays missed events; heartbeats arrive on schedule.

### Frontend unit

- `MemoryEmbeddingsSection`: add / test / rotate / delete / switch-active paths (React Testing Library).
- `MemoryOperationsPage`: JobCard in 5 states (idle/queued/running/completed/failed); RecentJobs filter/sort; detail drawer open/close.
- `MissingEmbeddingAlert`: renders on empty providers, failed test; suppressed when healthy.
- `embedding-providers.ts` matrix: model validation rejects non-1536-dim configurations.

### Playwright e2e

Two full-journey specs:
1. **OpenAI happy path**: empty DB + 100 seeded facts → configure OpenAI provider with a fixture key (backed by a local stub server) → test succeeds → run embedding-backfill → see progress → completion → `/memory/maintenance` now returns results. Approx 2 min runtime.
2. **Gemini happy path**: same flow with Gemini stub server, asserts `output_dimensionality` rides through.
3. **Alert coverage**: with no provider configured, assert `MissingEmbeddingAlert` renders on all six downstream pages.

e2e uses local HTTP stub servers (prism / msw-node) that imitate OpenAI + Gemini `/embeddings` — **no live provider calls in CI**, but a manual checklist documents how to point at live providers during pre-release verification.

Coverage target: 80%+ on new code, per project `testing.md`.

## Rollout Plan — Phased PRs

Each PR independently:
- runs in its own worktree off `origin/main`,
- passes `pnpm build` + `pnpm lint` + unit tests,
- is verified in dev-1 via `env-up.sh dev-1` before version bump,
- gets a `patch` version bump and is promoted to beta via `env-promote.sh`.

| PR | Scope | Unblocks |
|---|---|---|
| **A** | Migration 0033 (both parts) + shared types + repo code for `api_accounts.credential_kind` | schema foundation |
| **B** | `/api/memory/providers` CRUD + `/test` + `EmbeddingClient` factory (backend-only) | embedding API ready |
| **C** | Settings → Memory & Embeddings UI | **operator can now configure a key from the browser** |
| **D** | `memory-ops` queue + `memory_ops_jobs` CRUD routes + SSE stream skeleton (no handlers yet) | job plumbing |
| **E** | `embedding-backfill` + `drawer-backfill` handlers | **19,226 facts can now be backfilled from the UI** |
| **F** | `/memory/operations` page + `<MissingEmbeddingAlert />` mounted on 6 pages | operator-visible maintenance control |
| **G** | `consolidation` + `synthesis` handlers wired into queue + Playwright e2e specs + release notes | full v1 |

**Critical path** (minimum to resolve the user's immediate pain): **A → B → C → D → E**. After E merges, the operator can configure OpenAI in Settings, trigger embedding-backfill via a one-off API call, and watch it complete. F adds the dashboard UI; G closes out the feature.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Google's OpenAI-compat `/embeddings` shim changes or degrades | Gemini client path falls through to a native-Gemini adapter hidden behind the same `EmbeddingClient` interface. Adapter work is a single file, boxed for v1.1 if needed. |
| Operators delete a credential while a job is running | `DELETE /api/memory/providers/:id` returns `409` with the list of blocking job ids. Ops page offers "cancel blocking jobs" helper. |
| Rate-limit from provider during 19k backfill | BullMQ exponential backoff + per-batch errorCount + continue-on-failure. At the end the job completes with partial coverage, and re-running picks up only the still-null rows. |
| Mesh peer runs maintenance while local peer also runs it | `memory_ops_jobs` mesh sync exposes the running job to both UIs; the queue-level `concurrency=1` per kind prevents duplicate execution on the integrator peer. Operators on a non-integrator peer see the running job, not a new Run button. |
| Migration 0033 breaks older peers before they upgrade | Existing `sync_nodes_schema_ahead_rejection` mechanism rejects cross-version sync until the peer upgrades. Out-of-scope to reinvent. |
| Cost blowout on 3072-dim or repeated misuse | Not a v1 concern — we only allow 1536-dim models; cost for 19k facts is approximately $0.08 on OpenAI small, $0.15 on Gemini. Budgets/caps come in v2. |

## Acceptance Criteria

- A user with no embedding-kind rows in `api_accounts` can: open Settings → Memory & Embeddings → add an OpenAI provider → test it → see `dim=1536, costUsd≈0.00000002` → save.
- Opening `/memory/maintenance` with no provider shows `<MissingEmbeddingAlert />` linking to Settings.
- After configuring a provider, the alert is gone; clicking **Run embedding-backfill** on `/memory/operations` causes 19k facts to be embedded in ≤ 15 minutes with a live progress bar; job history records cost and outcome.
- Deleting the provider while a job is running returns 409; cancelling the job and deleting succeeds.
- Rotating the API key does not create a new provider row; old job history still references the same `credential_id`.
- Running embedding-backfill a second time immediately is a no-op (`WHERE embedding IS NULL` returns zero rows).
- Mesh peers see the same provider list and job history.
- All new code has ≥ 80% test coverage; Playwright e2e spec passes in CI.

## Open Questions (carry into writing-plans)

1. Should `/memory/operations` offer a **"Run all maintenance"** super-button (backfill embeddings → backfill drawers → consolidation → synthesis as a chained sequence)? Flagged as v1 nice-to-have; probably easy once `memory-ops` queue exists, but adds a chain-of-jobs abstraction that is not otherwise needed.
2. Does the user want `<MissingEmbeddingAlert />` to be dismissible ("don't show again for this session")? v1 default is non-dismissible — a dismissed alert defeats the whole point.
3. Should `embedding-backfill` also run on `memory_drawers.embedding IS NULL` in the same job, or only on `memory_facts`? v1 proposal: separate passes, because drawers carry different content length distributions and batching heuristics.
4. When a user rotates an API key on a provider, should that automatically mark `lastTestOk` until a new test is run? v1 proposal: yes, and the edit dialog suggests running Test before closing.

These are small enough that writing-plans will resolve them as part of the per-PR task list.
