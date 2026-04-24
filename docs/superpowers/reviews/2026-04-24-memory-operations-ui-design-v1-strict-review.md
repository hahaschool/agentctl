# Memory Operations UI v1 Spec — Strict Review

Reviewed target: `docs/superpowers/specs/2026-04-24-memory-operations-ui-design-v1.md` at branch `agent/claude-1/docs/memory-ops-ui-spec`, commit `3a790475`.

Verdict: **do not implement v1 as written.** v1 fixes the biggest v0 narrative error by admitting providers are per-machine and `api_accounts` is local-only, but the rewrite is not architecturally locked. It still leaves multiple P0/P1 gaps where the implementation would either not compile, not enable memory search, queue jobs that cannot run, silently bypass the egress consent model, or sync rows that can fail on peer apply.

## P0 — Must Fix Before Writing Any Plan

### 1. Provider configuration is not wired into the existing memory runtime path

Spec lines 27, 423-438, and 615 add provider CRUD and a factory for jobs/tests, but the current app creates `MemorySearch`, `MemoryStore`, and drawer search from `LITELLM_URL` at boot:

- `packages/control-plane/src/index.ts:373-382` constructs `EmbeddingClient` only when `LITELLM_URL` is set.
- `packages/control-plane/src/api/server.ts:522-560` registers `/api/memory/search` only when `memorySearch` was injected.
- `packages/control-plane/src/api/server.ts:600-605` passes the boot-time `embeddingClient` to drawer search.
- `packages/control-plane/src/memory/memory-search.ts:238-244` embeds queries through that injected client.

That means a provider saved in Settings can backfill facts, but it does not make semantic search, drawer vector search, or new `MemoryStore.addFact()` embeddings use the configured provider. With no `LITELLM_URL`, `/api/memory/search` still will not be registered. This fails the stated root cause and makes the provider UI largely cosmetic for downstream memory behavior.

Required fix: specify a DB-backed embedding-provider resolver for all memory read/write paths, not only `memory-ops` jobs. Either replace the boot-time `LITELLM_URL` injection or document a compatibility bridge and tests proving Settings provider creation enables search without restart/env changes.

### 2. The PR 0 / PR A order cannot compile or deploy as described

Spec lines 456-468 and rollout line 613 put `credential_kind` runtime filters in PR 0, while the column and Drizzle schema are not added until PR A lines 104-125 and 234-241. Current code has no `apiAccounts.credentialKind` field (`packages/control-plane/src/db/schema.ts:443-461`). A PR 0 that filters on it either fails TypeScript if using Drizzle or fails SQL at runtime before migration 0033 exists.

The safe order is not "PR 0 before PR A" for the credential filter. The schema/migration and all runtime filters must land atomically in one PR, or PR 0 must be limited to the additive `EmbeddingClient` changes. Runtime credential contamination only becomes possible when embedding rows can be created, so there is no need to ship an impossible pre-migration filter PR.

### 3. The batch UPDATE is typed against `uuid`, but `memory_facts.id` is `text`

Spec lines 474-484 define:

```sql
AS x(id uuid, embedding text)
WHERE f.id = v.id
```

Current schema is `memory_facts.id text PRIMARY KEY` (`packages/control-plane/drizzle/0010_add_memory_layer.sql:18-24`, `packages/control-plane/src/db/schema.ts:354-360`), and runtime IDs are generated as timestamp/random strings, not UUIDs (`packages/control-plane/src/memory/memory-store.ts:103-109`). PostgreSQL will not compare `text = uuid` without an explicit cast, and the generated IDs are not castable UUIDs anyway.

This is a direct implementation blocker for the critical 19,226 fact backfill path. Change `jsonb_to_recordset` to `AS x(id text, embedding text)`, add a regression that uses a real generated memory ID, and stop calling this design "locked" until the SQL matches the live schema.

### 4. The `content_model` lock is based on rows that are not embedded

Spec line 39 says switching is locked once any fact exists with that `content_model`, and line 451 repeats that condition. Current `memory_facts.content_model` is `NOT NULL DEFAULT 'text-embedding-3-small'` (`packages/control-plane/drizzle/0010_add_memory_layer.sql:24`). The problem statement says all 19,226 facts currently have `embedding IS NULL`, but they still carry the default content model.

Result: v1 would immediately lock the operator to OpenAI small even before a single vector exists, blocking Gemini in the exact empty-embedding state this work is meant to solve.

Required fix: all lock/distribution/search-safety logic must be based on rows with `embedding IS NOT NULL`, and the UI copy must distinguish "declared default content_model" from "actual vector model".

### 5. Mixed-model protection is UI-only and does not protect the actual search APIs

Spec line 452 says the UI disables search when multiple `content_model` values appear. Current search SQL does not filter by `content_model` (`packages/control-plane/src/memory/memory-search.ts:248-264`), and drawer search has the same issue for `memory_drawers.embedding_model` (`packages/control-plane/src/api/routes/memory-drawers.ts:120-129`). MCP/worker/API callers can still hit the backend even if a React page hides a search box.

Required fix: backend vector search must either filter to the query embedding model or fail closed with a typed mixed-model error. Drawer embeddings need the same `embedding_model` treatment; v1 currently only discusses `memory_facts.content_model`.

### 6. Gemini endpoint and model details are wrong against current official docs

Spec lines 387 and 415-417 produce `https://generativelanguage.googleapis.com/v1beta/openai/v1/embeddings`. Google’s OpenAI compatibility docs show the base URL as `https://generativelanguage.googleapis.com/v1beta/openai/` and the REST embeddings endpoint as `/v1beta/openai/embeddings`, not `/openai/v1/embeddings`: https://ai.google.dev/gemini-api/docs/openai.

The current docs also show the OpenAI-compatible embedding example using `gemini-embedding-2-preview`, while native embeddings docs now center `gemini-embedding-2` and mention `gemini-embedding-001` normalization caveats for truncated dimensions: https://ai.google.dev/gemini-api/docs/embeddings. The v1 catalog still hardcodes `gemini-embedding-001` and does not justify why that legacy model is the v1 choice.

Required fix: define URL joining as `(baseUrl, embeddingsPath)` with tested OpenAI and Gemini cases. For OpenAI, use either `https://api.openai.com` + `/v1/embeddings` or `https://api.openai.com/v1` + `/embeddings`; do not mix both. For Gemini, use the documented OpenAI-compatible endpoint and update the model catalog from current docs.

### 7. Job mesh sync plus local-only providers still has no executor ownership model

Spec lines 36, 43, 228-232, and 647 say providers are per-machine while jobs sync across peers. But `memory_ops_jobs` has no `owner_machine_id`, `executor_node_id`, `origin_node_id`, or queue locality column (lines 136-152). Only the origin machine has the local provider and likely the BullMQ queue item. A peer will see a synced `queued` job with an opaque `credential_id`, but cannot know whether it should ignore it, display it as remote-owned, repair it, or process it.

This is not solved by the advisory lock claim in line 361. PostgreSQL advisory locks are local to one database. Mesh peers have their own local databases and sync row changes later. A lock on machine A does not block a worker on machine B.

Required fix: make jobs explicitly owned. The API must create jobs with `origin_machine_id`/`executor_machine_id`, workers must only claim local executable jobs, peer UI must render remote-owned jobs as read-only, and tests must cover a two-node mesh job lifecycle.

### 8. The advisory lock only prevents simultaneous POSTs, not duplicate running jobs

Spec line 361 says POST takes an advisory lock and that this gives protection while a job is running. If this is an xact-scoped lock, it is released as soon as the POST transaction commits. If it is a session lock on a pooled connection, it is unsafe to hold across a long-running job and will leak semantics through the pool. In neither case does the route-level lock reliably enforce "one active job per kind/scope" for the duration of the job.

Required fix: add a durable DB invariant, e.g. a normalized scope column plus partial unique index on `(kind, normalized_scope)` where status is `queued` or `running`, with explicit conflict mapping to `JOB_ALREADY_RUNNING`.

### 9. The egress confirmation is bypassable because it is only a UI dialog

Spec lines 506-517 require the UI to show a data-egress dialog, but `/api/memory/ops/jobs` line 347 has no `egressConfirmed`, `egressConfirmedAt`, `destinationHost`, or audit payload requirement. Any direct API caller, compromised browser context, or future CLI can start `embedding-backfill` or `drawer-backfill` without the consent step.

The dialog is also session-scoped and explicitly not persisted (line 514), so there is no durable audit evidence that an operator accepted external memory-content transfer.

Required fix: make egress acknowledgement a server-side precondition for job creation, persist the acceptance in `memory_ops_jobs.params` or an audit entry, and reject egressing job kinds without it. UI-only confirmation is not a security control.

### 10. The redaction claim is false for existing `memory_facts`

Spec line 515 says existing redaction/sanitizer paths already redact known secret patterns before any write and implies seeded `sk-...` memory content will be redacted before provider egress. That is true for drawer writes through `sanitizeMemoryDrawerContent` (`packages/control-plane/src/memory/memory-drawer-sanitizer.ts:68-97`), not for already-existing `memory_facts.content`. The critical job sends `memory_facts.content` to an external embedding API, and v1 does not run that content through the drawer sanitizer.

Required fix: either explicitly state that existing facts are sent as-is after operator confirmation, or add a fact-content redaction/sanitization pass before embedding and define how sanitized content maps back to stored facts. The current wording gives a false security assurance.

### 11. `memory_ops_job_events` sync can collide on `event_id`

Spec lines 189-209 define `event_id bigserial PRIMARY KEY` and `sync_id uuid` for mesh identity, then line 218 cites `agent_actions` as precedent. Current append-only apply logic inserts every payload column and only handles conflict on the sync PK column (`packages/control-plane/src/sync/apply-change.ts:145-150`). If two peers have local `event_id = 1` for different events, applying a remote payload with `event_id = 1` can violate the actual primary key before `ON CONFLICT (sync_id)` helps.

Required fix: make `sync_id` the primary key and store a separate `event_seq` for per-job SSE ordering, or otherwise prove the apply path strips/remaps local bigserial IDs before insert. Do not add another bigserial-PK append-only synced table without fixing this class of bug.

### 12. API error envelope contradicts the current project standard and frontend parser

Spec lines 326-334 and 573-592 define nested errors:

```json
{ "error": { "code": "STABLE_CODE", "message": "...", "context": {} } }
```

Current Fastify global errors are flat `{ error: err.code, message: err.message }` (`packages/control-plane/src/api/server.ts:936-943`), route-level errors follow the same flat shape, and the web `request()` helper reads `body.error` and `body.message` as strings (`packages/web/src/lib/api/core.ts:34-40`). A nested error object would make `ApiError.code` an object at runtime unless the frontend core is changed.

Required fix: either align v1 to the flat project envelope or explicitly include the cross-cutting frontend/backend error-shape migration in the plan and tests.

## P1 — Major Design Gaps

### 13. The provider test lifecycle does not close the `lastTestOk` loop

Spec lines 318-320 expose `lastTestAt`, `lastTestOk`, and `lastTestError`, and lines 545-546 make null/false trigger a blocking alert. But only the 401 path in lines 490-492 says test metadata is updated. Success, non-401 failure, and pre-save `/test-ephemeral` outcomes are not specified.

This can produce a provider that was tested before save but persists with `lastTestOk = null`, causing `<MissingEmbeddingAlert />` to remain non-dismissible after successful setup.

Required fix: specify metadata writes for successful saved tests and failed tests, and bind pre-save proof to the exact payload hash so Save is disabled if provider/model/key changes after the test.

### 14. `/test-ephemeral` is used by UI but missing from the API contract

Spec line 527 introduces `POST /api/memory/providers/test-ephemeral`, but section 6.1 lists only collection CRUD and `/:id/test`. There is no payload shape, rate limit, error envelope, audit behavior, or guarantee that the endpoint never persists plaintext/secrets. Appendix A lists it in PR B, but the actual contract is absent.

Required fix: promote it into section 6.1 with the same rigor as the persisted test endpoint, including per-IP/key-hash throttling and secret-safe logging requirements.

### 15. Provider active-conflict mapping is underspecified

Spec line 129 says the partial unique index fixes the race, and acceptance line 642 requires the loser to return `409 DUPLICATE_ACTIVE_EMBEDDING`. Section 14's error table does not include that code, and section 6.1 does not say how PostgreSQL `23505` from `api_accounts_one_active_embedding` is mapped to 409.

Required fix: add the explicit database-error mapping and integration test for concurrent active inserts/patches.

### 16. `MemoryOpsJob.error` is text, but acceptance expects a structured code

Migration lines 145-147 define `error text`. Line 492 writes a string like `PROVIDER_AUTH_FAILED: ...`, while acceptance line 644 expects `error.code='PROVIDER_AUTH_FAILED'`. The UI Rotate Key CTA would have to parse a string, exactly the pattern the rewrite tried to remove for provider HTTP status.

Required fix: add `error_code text`, make `error`/`error_message` semantics explicit, or make `error jsonb` with a typed shape. Acceptance and schema must agree.

### 17. PR D/F can expose job kinds before handlers exist

The schema accepts all four kinds at PR A lines 136-140. PR D exposes `/api/memory/ops/jobs` for all kinds (lines 343-358). PR E implements only `embedding-backfill` and `drawer-backfill` (line 618). PR F renders 4 JobCards (lines 538-540) before PR G adds `consolidation` and `synthesis` handlers (lines 620, 735-741).

This creates a shipped state where the UI/API can enqueue consolidation and synthesis jobs that no worker can execute.

Required fix: gate allowed job kinds by implemented handler, or move consolidation/synthesis handlers before the 4-card UI is exposed.

### 18. Runtime `api_accounts` filter list is incomplete

Spec lines 462-468 list accounts, task-worker, sessions, and oauth, then says any unfiltered Drizzle query is a bug. The authoritative Appendix PR 0 file list omits `packages/control-plane/src/api/routes/settings.ts`, which validates `default_account_id` by selecting from `apiAccounts` (`packages/control-plane/src/api/routes/settings.ts:79-88`). It also does not mention project account mapping writes, which accept `accountId` without validating kind.

Required fix: include Settings/defaults and project-account mappings in the runtime-kind filter scope, with tests that embedding credential IDs cannot become runtime defaults or project mappings.

### 19. `memory_facts.embedding` is still absent from the Drizzle schema

Previous Reviewer 1 issue #37 is not really absorbed. Current migration has `memory_facts.embedding vector(1536)` (`packages/control-plane/drizzle/0010_add_memory_layer.sql:18-24`), but the Drizzle table omits the column (`packages/control-plane/src/db/schema.ts:354-375`). v1 says batch update will use raw SQL, but model-distribution queries, stats, and tests will naturally reach for Drizzle unless the plan forbids it.

Required fix: either add `embedding` to `memoryFacts` using the existing `vector1536` custom type, or state all embedding-null/model-distribution operations use raw SQL and test the omission explicitly.

### 20. Audit logger design names fields that do not exist in the current audit model

Spec lines 497-504 say every entry includes `actor`, `action`, `target`, `tag`, `timestamp`, and `hashChain`. Existing memory write audit input has no actor/action/target/hash chain (`packages/shared/src/memory/audit.ts:25-56`), and current audit routes write flat `agent_actions` records (`packages/control-plane/src/api/routes/audit.ts:48-93`), not a hash-chained memory-ops audit table.

Required fix: define the persistence target and schema. If this is only a no-op interface call in tests, it does not satisfy the security/audit requirement.

### 21. Drawer backfill is a local file egress surface, not just an embedding provider job

Spec lines 73 and 617-618 say `drawer-backfill` wraps the existing script. The script takes a `source-root` and reads session/claude-mem data from the filesystem (`scripts/backfill-memory-drawers.ts`). v1 does not define `MemoryOpsJobParams` concretely enough to show source-root validation, allowed roots, symlink handling, max file sizes, or audit of which local paths were read before content leaves the machine for embeddings.

Required fix: specify the drawer-backfill params contract and path allowlist. SSRF prevention does not cover local file exfiltration.

### 22. Job/event payload size limits are still mostly app promises, not database invariants

Spec line 226 caps log messages at 512 chars "via app"; lines 145-146 and 197 leave `result`, `error`, and event `progress` unbounded. Existing sync applies full JSON payloads. Large result/error/progress payloads can still bloat `sync_change_log` and peer transfers.

Required fix: put DB CHECKs or repository-level hard caps with tests around `message`, `error`, `result`, and `progress`. Do not rely on UI/server discipline alone for mesh-synced payload budgets.

### 23. Cost tracking has no missing-usage fallback

Spec lines 442-444 assume provider responses include `usage.promptTokens`. The current `EmbeddingClient` response type treats usage as optional (`packages/control-plane/src/memory/embedding-client.ts:9-18`). Gemini OpenAI-compatible responses and provider errors need explicit handling when usage is absent. Otherwise `costUsd` can silently be zero/NaN while the UI claims cost tracking is complete.

Required fix: define fallback token estimation or a typed `usageUnavailable` state, and test OpenAI, Gemini, and missing-usage responses separately.

### 24. Testing strategy allows `pg-mem` for features it cannot prove

Spec lines 598-603 allow "pg-mem or Docker-backed" for partial unique index concurrency, advisory locks, pgvector batch update, triggers, and sync behavior. `pg-mem` is not a credible substitute for pgvector/advisory-lock/trigger/concurrent-index behavior here.

Required fix: require real PostgreSQL for migration, vector, trigger, lock, and two-node sync tests. `pg-mem` can be used only for repository logic that does not rely on those database features.

### 25. Versioning claims still conflict with user-visible rollout

Spec line 622 says PRs 0 and A-F are patch-only because they are not user-visible, but PR C adds Settings UI and PR F adds `/memory/operations`, sidebar entry, alerts, egress dialog, job cards, tables, and drawer. Those are user-visible features by definition.

Required fix: either mark the first shipped UI PR as the minor bump or stop claiming semver compliance.

## P2 — Required Corrections Before Handoff

### 26. Retention policy contradicts itself

Spec line 204 and risk line 660 say 7-day retention for `memory_ops_job_events`; runbook line 630 says purge older than 30 days. Pick one. Also current `log-retention` code is an audit/run/webhook/checkpoint manager, not a generic config-driven worker for arbitrary tables, so "add an entry to its config" needs concrete code scope.

### 27. The test rule path is nonexistent

Spec line 596 cites `.claude/rules/common/testing.md`; that file does not exist in this worktree. Do not anchor implementation requirements to scratch/nonexistent local files.

### 28. The spec depends on an unversioned scratch fact file

Lines 6 and 672 cite `/tmp/memory-ops-rewrite-facts.md` as the source of authoritative facts. `/tmp` is not reviewable, not pushed, and not stable. Any facts required for implementation must be in the spec, plan, or committed evidence appendix.

### 29. `MissingEmbeddingAlert` navigation remains underspecified

Spec line 547 says the alert links to Settings, but line 527's UX depends on a specific Memory & Embeddings section. The previous review called out hash-anchor drift; v1 does not define the anchor ID or test it. Add a concrete route/fragment such as `/settings#memory-embeddings` and a SettingsView test.

### 30. API docs/OpenAPI update is still missing

Previous Reviewer 1 issue #36 is not absorbed. Appendix A does not include `docs/API.md`, OpenAPI schemas, or route schema definitions for the new provider/job/event endpoints. The current server uses Swagger tags and route schemas in many places; memory ops should not ship as undocumented internal endpoints.

## Prior Review Absorption Summary

Absorbed or mostly absorbed:

- v1 correctly drops cross-peer credential replication and treats `api_accounts` as local-only.
- v1 moves provider `baseUrl` to a server catalog and removes custom endpoint input.
- v1 adds `credential_last4`, a partial unique index for active embedding provider rows, and append-only job events for SSE replay.
- v1 recognizes the need for `content_model`, cost accounting, structured 401 handling, and batch updates.

Not absorbed or regressed:

- Runtime account filtering is still rollout-incoherent and incomplete.
- Search/runtime embedding client wiring is missing entirely.
- `content_model` lock semantics are wrong for existing unembedded rows.
- Batch update SQL is invalid against text memory IDs.
- Cross-peer job execution semantics are not designed.
- Advisory-lock duplicate prevention is not durable.
- Egress consent and redaction are not enforced server-side.
- Event mesh sync is unsafe with `bigserial` primary keys.
- Error envelope, audit schema, versioning, and docs remain inconsistent with the codebase.

## Required Rewrite Bar

Before implementation planning, v1 needs another rewrite pass that does all of the following:

1. Define provider resolution for every memory embedding caller, not only jobs.
2. Merge credential-kind migration and runtime filtering into a deployable sequence.
3. Correct memory fact ID typing and model-lock semantics.
4. Add server-enforced egress acknowledgement and truthful redaction behavior.
5. Add explicit job ownership/executor semantics for mesh.
6. Replace route-level advisory-lock duplicate prevention with a durable DB invariant.
7. Fix synced event primary-key design.
8. Align API error envelopes and frontend parsing.
9. Make provider testing metadata and `/test-ephemeral` contract complete.
10. Require real PostgreSQL tests for vector/sync/lock paths.

Bottom line: **v1 is directionally better than v0, but it is not implementation-ready.** The spec should not be handed to planning until the P0s above are corrected in the spec itself.
