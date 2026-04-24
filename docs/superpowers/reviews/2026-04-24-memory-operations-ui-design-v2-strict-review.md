# Memory Operations UI v2 — Strict Critical Review

> Review date: 2026-04-24
> Target: `docs/superpowers/specs/2026-04-24-memory-operations-ui-design-v2.md` at commit `7eaab6b0`
> Verdict: **Reject as not implementation-ready.** v2 absorbs many v1 findings, but several new or remaining defects are architectural blockers, not wording issues.

## Review Method

- Read the full v2 spec, reviewer checklist, and verified-facts file.
- Independently grepped the current worktree for the referenced code paths.
- Checked Google official Gemini docs for the OpenAI-compatible embeddings endpoint/model details:
  - https://ai.google.dev/gemini-api/docs/openai
  - https://ai.google.dev/gemini-api/docs/embeddings

## P0 Blockers

### P0-1 — Mesh job ownership is still broken: any peer can steal a newly synced job before the origin claims it.

Spec evidence:
- `memory_ops_jobs` has `origin_machine_id` and nullable `executor_machine_id` (`v2:126-128`).
- `POST /jobs` sets only `origin_machine_id` (`v2:171-173`).
- Worker claim condition allows any worker to claim rows with `executor_machine_id IS NULL` (`v2:173`).
- Acceptance says "Job created on A -> `executor_machine_id=A`" (`v2:702`), but the schema/claim rule does not enforce that.

Why this fails:
- `memory_ops_jobs` is mesh-synced mutable (`v2:107`, `v2:149-153`), while `api_accounts` is local-only (`v2:23`, `v2:80`).
- A job created on A is inserted with `executor_machine_id=NULL`. If it syncs to B before A's worker claims it, B's worker satisfies `status='queued' AND executor_machine_id IS NULL`, claims it, then either:
  - cannot resolve A's local `credential_id`, and fails a valid job; or
  - runs the job with B's active provider if `credentialId` was omitted, violating the operator's provider/egress intent.

Required fix:
- Set `executor_machine_id = origin_machine_id` at job creation and require `executor_machine_id=$machineId` in the worker claim, or add `AND origin_machine_id=$machineId` to the claim. Cross-peer takeover must be an explicit future feature, not the default race outcome.

### P0-2 — `JOB_ALREADY_RUNNING` is not implemented by the stated advisory lock.

Spec evidence:
- Enqueue uses blocking `pg_advisory_xact_lock(hashtext($1)::bigint)` (`v2:179-185`).
- API claims `409 JOB_ALREADY_RUNNING (advisory lock loss)` (`v2:367-372`, `v2:638`).
- Checklist required duplicate-detect query/shared `scopeNormalize` usage (`checklist:28`), but v2 only defines the lock key (`v2:180-188`, `v2:426`).

Why this fails:
- `pg_advisory_xact_lock` blocks; it does not "lose". The second concurrent request waits, then continues after the first transaction commits.
- The schema has no `scope_normalized` column or unique partial index for non-terminal `(kind, scope)` jobs.
- Without a transactional query after acquiring the lock, same-kind/scope duplicates are still insertable. Across peers, this lock is also local to each peer database.

Required fix:
- Either use `pg_try_advisory_xact_lock` and explicitly return 409 on false, or keep blocking lock but perform a transactional duplicate query/constraint before INSERT. For mesh, use a synced durable invariant, not only a per-DB advisory lock.

### P0-3 — Rollout exposes job kinds before handlers exist.

Spec evidence:
- Shared params include all four kinds from PR A (`v2:417-424`).
- PR D ships `/api/memory/ops/jobs` route and queue (`v2:671`).
- PR E implements only `embedding-backfill` and `drawer-backfill` (`v2:672`, `v2:765-768`).
- PR F turns `MEMORY_OPS_ENABLED=true` and renders four JobCards (`v2:573-578`, `v2:673`).
- PR G only later adds `consolidation` and `synthesis` handlers (`v2:674`, `v2:780-783`).
- The checklist explicitly required `ENABLED_JOB_KINDS` gating (`checklist:65`), but that symbol or equivalent does not appear in v2.

Why this fails:
- After PR F and before PR G, users can see and attempt all four job cards while two handlers do not exist.
- If the route accepts all schema-valid kinds, two kinds enqueue dead jobs. If the worker rejects them, the spec is missing the API contract, UI disabled state, error code, and tests.

Required fix:
- Add a server-side `ENABLED_JOB_KINDS` contract per PR and wire UI cards to that capability response. PR F must not enable or render runnable consolidation/synthesis jobs until PR G lands.

### P0-4 — The critical path contradicts the feature flag and UI rollout.

Spec evidence:
- Goal says critical path PR A -> PR E, so the 19,226-fact backfill runs after PR E (`v2:17`).
- `MEMORY_OPS_ENABLED` defaults false through PR E (`v2:380-384`, `v2:672`).
- Operations UI ships in PR F, not PR E (`v2:568-579`, `v2:673`).
- PR E row says "19k backfill unblocks via API" while still disabled by default (`v2:672`).

Why this fails:
- Under the spec's own default, PR E does not unblock the backfill via API; `POST /jobs` must return `FEATURE_DISABLED`.
- If the intended behavior is "operator can set env manually after PR E", the critical path and acceptance text must say that. If not, PR F is on the critical path.

Required fix:
- Either move the enablement/ops UI into PR E, or change the critical path and PR E acceptance to "handlers available but blocked until PR F/default-on or explicit operator opt-in."

### P0-5 — Cost tracking for all four job kinds is based on false code facts.

Spec evidence:
- v2 says `KnowledgeMaintenance` and `KnowledgeSynthesis` "currently accept an injected `EmbeddingClient`" and shows `new KnowledgeMaintenance({ ..., embeddingClient: wrappedClient })` (`v2:477`).

Code evidence:
- `KnowledgeMaintenanceOptions` contains `pool`, `memoryStore`, `logger`, `projectRoot?`; no `embeddingClient` (`packages/control-plane/src/memory/knowledge-maintenance.ts:116-122`).
- `KnowledgeSynthesisOptions` contains only `pool` and `logger`; no `memoryStore`, no `embeddingClient` (`packages/control-plane/src/memory/knowledge-synthesis.ts:64-67`).
- `KnowledgeSynthesis.runSynthesis()` uses SQL vector similarity over existing embeddings, not embedding API calls (`packages/control-plane/src/memory/knowledge-synthesis.ts:78-143`).

Why this fails:
- The shown `KnowledgeMaintenance` constructor call is not valid against current types unless the PR also changes the service API, which the spec does not list.
- `synthesis` has no embedding-client call to decorate; its cost should be zero unless the handler is redesigned to generate new embeddings.
- The stated "all four handler kinds accumulate cost" acceptance is therefore not true.

Required fix:
- State the real per-kind cost model. If consolidation/synthesis do not call external embedding providers, mark cost as zero and test that. If maintenance creates synthesized facts via a `MemoryStore`, inject a wrapped `MemoryStore`, not an extra `embeddingClient` option.

### P0-6 — Gemini support is not actually verified for the catalog entry.

Spec evidence:
- Catalog uses `gemini-embedding-001` on OpenAI-compatible `/v1beta/openai/embeddings` with `{ output_dimensionality: 1536 }` (`v2:403-408`, `v2:661`).
- Verified-facts file says Gemini OpenAI-compat endpoint was "NOT FETCHED" and must be verified (`verified-facts:49-53`).

Official docs evidence:
- Google OpenAI-compat docs show embeddings at `https://generativelanguage.googleapis.com/v1beta/openai/embeddings`, but the example model is `gemini-embedding-2-preview`, while prose says `gemini-embedding-2-preview` or `gemini-embedding-001` can be used.
- Google native embeddings docs now list stable `gemini-embedding-2` and stable `gemini-embedding-001`; they explicitly warn that the two embedding spaces are incompatible and note different normalization behavior.
- The OpenAI-compat page does not document `output_dimensionality` for embeddings; the native embeddings page documents `output_dimensionality` for native Gemini API calls.

Why this fails:
- v2's endpoint path is now plausible, but the specific `(OpenAI compat, gemini-embedding-001, output_dimensionality)` combination is not proven by the official OpenAI-compat example.
- Because the database column is fixed at `vector(1536)`, this cannot be left to "try it in e2e later"; a 3072-dimensional response breaks writes.

Required fix:
- Make PR A include a live or recorded contract test for the exact Gemini catalog entry. Prefer the official OpenAI-compatible example model unless Google confirms `gemini-embedding-001` plus dimensionality override through the OpenAI layer. Also document normalization if using 1536-dimensional `gemini-embedding-001`.

### P0-7 — Mixed-model search protection is underspecified and likely still leaks wrong-model results.

Spec evidence:
- v2 says mixed-model search "restricts results to the majority model" (`v2:494`).
- Existing `MemorySearch` wiring replacement is only described as swapping the injected client for a getter (`v2:463-469`).

Code evidence:
- Current `MemorySearch.vectorSearch()` filters `embedding IS NOT NULL` but has no `content_model = <query model>` predicate (`packages/control-plane/src/memory/memory-search.ts:248-267`).
- `bm25Search()` and `graphSearch()` return facts independently of embedding model (`packages/control-plane/src/memory/memory-search.ts:274-388`).
- `EmbeddingClient.model` is private and has no accessor (`packages/control-plane/src/memory/embedding-client.ts:31-48`).

Why this fails:
- A vector-only filter is not enough because RRF merges vector, BM25, and graph results; wrong-model facts can still appear via non-vector paths.
- The spec does not define how `MemorySearch` learns the active provider model after the factory returns only `EmbeddingClient`.
- "Majority model" is also not the same as "query model"; filtering to majority can still be wrong if the active provider is not the majority model.

Required fix:
- Return `{ client, model, dim }` from the factory or expose model metadata. Apply the model predicate consistently to vector/BM25/graph retrieval, drawer vector retrieval, and any route that fuses memory facts. Reject active provider mismatch server-side, not just in the UI.

### P0-8 — Runtime credential isolation misses at least one write path and several explicit account-id paths.

Spec evidence:
- v2 says all reads/writes to `api_accounts` must filter `credential_kind='runtime'` (`v2:517-528`).

Code evidence:
- `agents.ts` allows `PATCH /api/agents/:agentId` to set arbitrary `accountId` without validating it against `api_accounts` at all (`packages/control-plane/src/api/routes/agents.ts:333-419`).
- `sessions.ts` resolves explicit/session/agent account IDs through `apiAccounts.id` lookups; v2 lists sessions generally, but the spec does not call out each explicit account-id ingress (`packages/control-plane/src/api/routes/sessions.ts:597-598`, `778-779`, `991-992`, `1168-1169`).
- `settings.ts` project account mappings currently insert arbitrary `accountId`; v2 lists the table but does not specify the read-side join behavior after old invalid mappings exist (`packages/control-plane/src/api/routes/settings.ts:147-152`).

Why this fails:
- An embedding credential can still be attached to an agent via `agents.ts`, then later leak into runtime dispatch unless every downstream lookup is perfect.
- The correct invariant is "embedding credentials are never assignable through runtime account selectors", not only "runtime dispatch filters when it happens to read."

Required fix:
- Add `agents.ts` to §9 and Appendix A. Validate all account-id ingress points against `credential_kind='runtime'`; add migration/cleanup handling for pre-existing invalid mappings after the new column is introduced.

## P1 Major Issues

### P1-1 — The content-model lock is described as UI behavior, but it must be a server-side provider invariant.

Spec evidence:
- "UI blocks save with `MODEL_MISMATCH`" (`v2:493`).
- Error table includes `MODEL_MISMATCH` (`v2:642`), but `/api/memory/providers` contract does not explicitly require the create/patch route to run the lock query (`v2:287-313`).

Why this matters:
- Direct API calls can bypass UI-only validation. This is the same class of bug v2 fixed for egress.

Required fix:
- Move the lock into provider POST/PATCH activation on the server. UI should only preflight/explain the server result.

### P1-2 — Egress confirmation is still a bare boolean, not a server-generated confirmation of what will leave.

Spec evidence:
- API requires only `egressConfirmed: true` (`v2:386-390`).
- UI displays destination host/row count/token estimate/cost (`v2:551-553`).

Why this matters:
- `curl ... { egressConfirmed: true }` bypasses the informed-confirmation payload while still passing the server check.
- The server does not bind the ack to provider host, model, credential, row count, estimated token range, or timestamped quote.

Required fix:
- Add a `/quote-egress` or preflight endpoint returning a short-lived signed token over `{kind, credentialId, providerHost, model, rowEstimate, tokenEstimate, costEstimate}`. `POST /jobs` should accept the signed token, not just a boolean.

### P1-3 — Provider test token semantics are under-specified and replayable by design.

Spec evidence:
- `/test-ephemeral` returns `signedToken = HMAC(secret, payloadHash), 5-min TTL`; POST `/` can accept it (`v2:295-300`, `v2:335-341`, `v2:563-565`).

Missing details:
- Which secret signs it.
- Whether the hash includes provider, model, key fingerprint, dim, cost, actor, and timestamp.
- Whether the server accepts a create without a recent successful test.
- How replay is prevented across tabs or different API keys with the same provider/model.

Required fix:
- Define the token payload and validation rules. At minimum bind to provider/model/API-key fingerprint/dim/testedAt and reject create/activate when no valid success token exists.

### P1-4 — PR A migration path is wrong in Appendix A.

Spec evidence:
- Appendix A lists `drizzle/0033_add_memory_ops.sql` and `.down.sql` (`v2:731-733`).

Code evidence:
- Existing migrations live under `packages/control-plane/drizzle/`; there is no root `drizzle/` directory in this worktree.

Required fix:
- Use `packages/control-plane/drizzle/0033_add_memory_ops.sql`, `packages/control-plane/drizzle/0033_add_memory_ops.down.sql`, and update `packages/control-plane/drizzle/meta/_journal.json`.

### P1-5 — The re-embed runbook only handles `memory_facts`, but the lock also considers drawers.

Spec evidence:
- Lock considers both `memory_facts.content_model` and `memory_drawers.embedding_model` (`v2:496-499`).
- Re-embed runbook only nulls `memory_facts.embedding` (`v2:686`).

Why this fails:
- If drawers contain old-model embeddings, enabling a new provider should remain blocked by the drawer side of the lock.

Required fix:
- Add drawer reset/backfill steps or explicitly say the v1.1 re-embed-all job covers both facts and drawers atomically.

### P1-6 — The runbook command is still not a real cross-tier command.

Spec evidence:
- "Pause the queue: `pm2 stop agentctl-cp-<tier>`" (`v2:682`).

Code evidence:
- Beta CP process is `agentctl-cp-beta` (`infra/pm2/ecosystem.beta.config.cjs:37`).
- Dev processes are `agentctl-cp-dev1` and `agentctl-cp-dev2`, not `agentctl-cp-dev-1` / `agentctl-cp-dev-2` (`infra/pm2/ecosystem.dev1.config.cjs:8`, `infra/pm2/ecosystem.dev2.config.cjs:8`).
- Mesh process is `agentctl-cp-mesh` (`infra/pm2/ecosystem.mesh.config.cjs:41`).

Required fix:
- Replace placeholder command with a tier/process-name table or a command that derives process names from the tier config.

### P1-7 — `memory_ops_job_events.result` overflow plan contradicts the event schema.

Spec evidence:
- `memory_ops_job_events` has `message` max 512 chars and `progress` bounded to the progress shape (`v2:216-219`).
- Overflow plan says full payload is written as an `event_type='log'` row (`v2:219`).

Why this fails:
- There is no `payload jsonb` column. A 16KB+ result cannot be stored in `message` after truncation, and `progress` is the wrong shape.

Required fix:
- Either add a bounded `payload jsonb`/artifact table, or say overflow details are intentionally discarded after summary.

### P1-8 — Error envelope claims `hint`, but the global handler currently drops it.

Spec evidence:
- Success/error example includes `{ "error": "...", "message": "...", "hint": "..." }` (`v2:354-362`, `v2:622-624`).

Code evidence:
- Existing global `ControlPlaneError` handler sends only `{ error, message }` (`packages/control-plane/src/api/server.ts:937-943`).
- Web `ApiError` can consume `hint`, but the server does not emit it from `ControlPlaneError`.

Required fix:
- Either modify the global handler to include a safe optional hint/context, or require all memory routes to return manual error payloads when hints are needed. Do not claim this already matches existing code.

### P1-9 — Audit logging to `agent_actions` makes provider audit mesh-synced without a stated privacy decision.

Spec evidence:
- Provider credentials are per-machine/local-only (`v2:14`, `v2:23`, `v2:80`).
- MemoryOpsAuditLogger writes provider/job events to `agent_actions` (`v2:541-543`).

Code evidence:
- `agent_actions` is append-only synced (`packages/shared/src/types/sync.ts:162-165`).

Why this matters:
- Provider create/update/test/failure events for a local credential will sync to peers unless scrubbed or moved to a local-only table. That may be acceptable, but the spec never makes the privacy decision.

Required fix:
- Explicitly choose: either local-only memory ops audit table, or mesh-synced audit with a redaction contract listing allowed fields. Add tests proving plaintext keys and provider-sensitive details cannot enter `tool_input`.

### P1-10 — The spec still relies on stale `/tmp` traceability paths.

Spec evidence:
- Header points to `/tmp/memory-ops-v2-reviewer-checklist.md` and `/tmp/memory-ops-v2-facts.md` (`v2:5-6`).
- Appendix repeats `/tmp/memory-ops-v2-reviewer-checklist.md` (`v2:788-790`).

Why this matters:
- The review artifacts are in `docs/superpowers/reviews/`, not `/tmp`. A spec that claims every assertion is traceable must not link to ephemeral, non-repo paths.

Required fix:
- Replace all `/tmp` references with repo-relative links to the actual checklist/facts files.

### P1-11 — Existing tests are mischaracterized as real Postgres/pgvector tests.

Spec evidence:
- v2 says to reuse the pattern from existing `memory-store.test.ts`, claiming it uses real PG test helpers (`v2:647`).

Code evidence:
- `memory-store.test.ts` creates a mock pool with `query: vi.fn()` (`packages/control-plane/src/memory/memory-store.test.ts:16-20`) and casts it into `MemoryStore` (`memory-store.test.ts:31-36`).

Required fix:
- Keep the Docker Postgres requirement, but remove the false "reuse existing memory-store tests" claim or point to the actual helper if one exists elsewhere.

### P1-12 — `MEMORY_OPS_ENABLED` semantics are split across route, worker, and UI with no health/capability endpoint.

Spec evidence:
- Flag turns off POST only; GET is always on (`v2:380-384`).
- UI disables Run buttons when flag false (`v2:576`).

Missing contract:
- How the web knows the flag state. `/api/memory/ops/jobs` GET returns jobs, not capabilities.
- How the worker behaves if the flag flips while a job is queued/running.

Required fix:
- Add `GET /api/memory/ops/capabilities` returning `{ enabled, enabledKinds, localProviderState, machineId }`. Define whether existing queued/running jobs continue or are failed when the flag changes.

## P2 Required Tightening

### P2-1 — Problem statement overclaims root cause.

Spec evidence:
- v2 says `/memory/graph`, `/memory/maintenance`, `/memory/synthesis`, `/memory/consolidation` silently return empty due to no provider (`v2:10`).

Code evidence:
- `KnowledgeMaintenance` can lint stale paths, deleted files, coverage, and graph clusters without an embedding provider (`packages/control-plane/src/memory/knowledge-maintenance.ts:190-240`).
- `KnowledgeSynthesis` has non-embedding stale/orphan/grouping logic (`packages/control-plane/src/memory/knowledge-synthesis.ts:97-220`).

Required fix:
- Narrow the statement: semantic/vector-dependent parts are empty or degraded; not the entire maintenance/synthesis/consolidation surface.

### P2-2 — `MissingEmbeddingAlert` criteria will show alerts after a successful save if metadata naming is not normalized.

Spec evidence:
- UI checks `metadata.last_test_ok` (`v2:584-587`).
- PATCH matrix says reset `last_test_ok` and `last_test_error` (`v2:319`).
- Acceptance uses camelCase `lastTestOk` / `lastTestError` (`v2:698`).

Required fix:
- Pick snake_case or camelCase for persisted metadata and response DTOs; document conversion if they differ.

### P2-3 — `sourceRoot` for drawer backfill is under-specified for path safety.

Spec evidence:
- `drawer-backfill` accepts `sourceRoot` as non-empty (`v2:421-423`).

Why this matters:
- Existing drawer import/backfill code deals with filesystem roots and sanitization. A "non-empty" schema is not enough for a server route that can crawl files.

Required fix:
- Require canonicalization under an allowed root, symlink policy, max files/bytes, and reuse the existing drawer sanitizer/import path constraints.

### P2-4 — `memory_ops_jobs` has no `updated_at`, making operational sorting/debugging weaker.

Spec evidence:
- Table has `created_at`, `started_at`, `finished_at`, but no `updated_at` (`v2:111-133`).

Why this matters:
- Progress is deliberately not mesh-synced, so local debugging needs an update timestamp to detect stale progress and stalled workers without scanning events.

Required fix:
- Add `updated_at` updated on every repository write, or explicitly justify using latest event timestamp instead.

### P2-5 — Event retention config location is vague.

Spec evidence:
- "PR D modifies log-retention.ts to add `memoryOpsEventRetentionDays` config" (`v2:221-223`, `v2:763`).

Missing details:
- Env var name.
- Default validation range.
- Whether event retention deletes before/after job retention.

Required fix:
- Define env/config key, default, min/max, and deletion ordering relative to `memory_ops_jobs`.

### P2-6 — Playwright count claim is stale.

Spec evidence:
- v2 says `packages/web/e2e/` has 49 spec files (`v2:650`).

Code evidence:
- Current worktree has 46 top-level `*.spec.ts` files under `packages/web/e2e/`.

Required fix:
- Avoid exact file-count claims unless generated at review time.

### P2-7 — The 19,226-fact performance estimate ignores provider rate limits and payload sizes.

Spec evidence:
- Estimate is 192 batches x 2.5s + 30ms, median 8-10 minutes (`v2:515`, `v2:707`).

Why this matters:
- Batch size, token volume, provider rate limits, retry policy, and JSON/vector serialization can dominate. The spec also supports Gemini, which has different limits and dimensions.

Required fix:
- Make this an empirical acceptance target only after PR E benchmarking, with separate OpenAI/Gemini rows and rate-limit assumptions.

## Items v2 Actually Fixed

- `memory_facts.id` is now `text` in the batch update (`v2:503-510`).
- `memory_ops_job_events` is local-only, avoiding bigserial mesh collisions (`v2:190-214`).
- Existing flat error envelope is recognized, though `hint` still needs a server contract (`v2:618-624`).
- `ConsolidationBoardView` is now included in alert mount points (`v2:591-606`).
- `api_accounts` being local-only is acknowledged (`v2:23`, `v2:80`).

## Final Disposition

v2 is substantially better than v1, but it is **not** ready to turn into an implementation plan. The blockers above must be corrected in the spec before work is split across PRs. The highest-risk fixes are:

1. Make job ownership origin-local by construction.
2. Replace advisory-lock prose with a real durable duplicate invariant.
3. Gate job kinds per rollout PR.
4. Correct the Gemini catalog against official docs.
5. Rewrite cost tracking claims for maintenance/synthesis based on actual code.
6. Enforce model/credential/egress invariants server-side, not only in UI copy.
