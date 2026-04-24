# Memory Operations UI v3 Spec - Strict Critical Review

> Review date: 2026-04-24
> Target: `docs/superpowers/specs/2026-04-24-memory-operations-ui-design-v3.md` at branch `agent/claude-1/docs/memory-ops-ui-spec`
> Verdict: **Reject as not implementation-ready.** v3 fixes several round-3 checklist items, but the plan writer still cannot implement it safely without inventing behavior. The remaining defects are not wording polish; they affect data ownership, provider isolation, API behavior, security, and acceptance measurability.

## Review Method

- Read the full v3 spec and the requested focus sections.
- Compared Appendix C against the two round-3 v2 reviews.
- Rechecked local code anchors in the same worktree for the routes, memory stores, search paths, sync config, schema, and error envelope.
- Findings below are one-pass and complete for this review. P0 means block the implementation plan; P1 means must fix before coding the relevant PR; P2 means fix before declaring the spec locked.

## What v3 Did Fix

- §5.2 now says `executor_machine_id` is set at insert time and worker claim requires executor match.
- §5.2 now places the advisory lock in an explicit transaction and uses `pg_try_advisory_xact_lock`.
- §6.1 adds server-side `MODEL_MISMATCH` to provider create/patch/activate flows.
- §6.2 adds `ENABLED_JOB_KINDS` and a capabilities route concept.
- §7.4 corrects consolidation/synthesis cost to zero for v1.
- §10 moves audit out of `agent_actions` into local-only `memory_ops_audit`.
- §14 removes `CANCEL_ACCEPTED` and adds `MODEL_MISMATCH` / `REMOTE_PEER_JOB`.
- Appendix C maps all 15 round-3 P0s to v3 sections.

Those fixes are real, but they are not enough.

## P0 Blockers

### P0-1 - v3 allows concurrent cross-peer backfills against mesh-synced shared memory tables.

Spec evidence:
- §4 says `memory_facts` is mesh-synced mutable and §17 explicitly warns that nulling embeddings propagates fleet-wide (`v3:68-70`, `v3:809-810`).
- §5.2 says cross-peer "running" visibility is informational and a second peer **can** run the same kind/scope because each peer has its own queue/provider (`v3:180`).
- §13.2 says the opposite: disable Run when any job of that kind is running anywhere in the mesh (`v3:685`).

Why this fails:
- `memory_facts.embedding/content_model` and `memory_drawers.embedding/embedding_model` are shared through mesh sync. They are not per-peer local state.
- If peer A and peer B both start `embedding-backfill` from an all-null state with different active providers, both pass the model lock, both write embeddings, and sync conflict/last-writer behavior can poison the fleet with mixed model state.
- This is not only duplicate cost. It is shared data corruption risk.

Required fix:
- Pick a single invariant and make every section match it.
- If embeddings stay mesh-synced in v1, egressing write jobs must be fleet-wide mutually exclusive per `(kind, normalizedScope)` or per affected table/scope. The server must block known non-terminal mesh jobs, and the UI must reflect that. If the team wants per-peer backfills, embedding columns must become local-only, which v3 explicitly rejects as a non-goal.
- Add a required test with two MACHINE_IDs and different provider models attempting same-scope backfill.

### P0-2 - The enqueue design puts a Redis side effect inside a Postgres transaction and falsely implies atomicity.

Spec evidence:
- §5.2 says POST `/jobs` does all four steps inside one Drizzle transaction: advisory lock, duplicate SELECT, INSERT row, enqueue BullMQ job (`v3:186`).

Why this fails:
- BullMQ enqueue is an external Redis side effect. It cannot be rolled back by a Postgres transaction.
- If Redis enqueue succeeds and the DB transaction later rolls back, a worker can receive a job id with no durable DB row.
- If the DB INSERT commits and Redis enqueue fails, the UI shows a queued job that no worker will ever pick up.

Required fix:
- Use an outbox pattern or split the operation honestly:
  1. In DB transaction: lock, duplicate check, insert durable `queued` job row.
  2. After commit: enqueue BullMQ.
  3. If enqueue fails: transition the DB job to `failed` with `QUEUE_ENQUEUE_FAILED`, or let an outbox poller enqueue pending rows.
- Add tests for both failure orders.

### P0-3 - Same-scope duplicate detection is still bypassable for omitted scope.

Spec evidence:
- §5.2 duplicate SELECT compares `params->>'scope' = $normalizedScope` (`v3:186`).
- §6.3 defines `scopeNormalize(s) = (s ?? '').trim().toLowerCase()` (`v3:453`).
- Per-kind params make `scope?` optional (`v3:448-451`).

Why this fails:
- If the request omits `scope`, `normalizedScope` is `''`, but `params->>'scope'` is SQL NULL unless the implementation stores a canonical scope field.
- `NULL = ''` is not true, so a second request after the first commits can miss the existing queued/running row and enqueue a duplicate.

Required fix:
- Canonicalize before insert and always store `params.scope = normalizedScope`, or query with `coalesce(params->>'scope', '') = $normalizedScope`.
- Add a generated/stored `scope_normalized` column or repository helper if this remains a common predicate.
- Required tests: omitted scope, blank scope, whitespace scope, and mixed-case scope all collide.

### P0-4 - Job creation does not require materializing the provider actually authorized for egress.

Spec evidence:
- Job schema has nullable `credential_id` (`v3:130`).
- Job params make `credentialId?` optional (`v3:448`).
- §5.2 insert step mentions `executor_machine_id` but not resolving/persisting the active provider (`v3:186`).
- §6.2 egress ack is a boolean and timestamp/user columns (`v3:409-413`).

Why this fails:
- If a job omits `credentialId`, the worker can resolve "active provider" later. The active provider may have changed after the operator saw the egress dialog.
- Delete/deactivate protection checks queued/running jobs "referencing credential_id"; null jobs will not block provider mutation.
- Audit and cost attribution cannot prove which destination/model was acknowledged.

Required fix:
- At POST `/jobs`, resolve the provider inside the enqueue transaction for all provider-using jobs and persist at least `credential_id`, provider kind, model, destination host, price used, and an egress confirmation snapshot.
- Worker execution must use the persisted credential id, not re-resolve the active provider by default.
- If no provider is required for a kind, say that explicitly and do not store a fake credential id.

### P0-5 - The runtime rewiring still misses drawer search, even though drawer search is a stated goal.

Spec evidence:
- Goal says drawer search resolves the active embedding provider from DB (`v3:19`).
- §7.3.2 lists `memory-search.ts`, `memory-store.ts`, `memory-drawer-store.ts`, `server.ts`, and `index.ts`, but not `memory-drawer-search.ts` or `api/routes/memory-drawers.ts` (`v3:517-525`).
- Appendix A PR B also omits `src/api/routes/memory-drawers.ts` and `src/memory/memory-drawer-search.ts` (`v3:868`).

Code evidence:
- `memoryDrawerRoutes` receives the boot-time `embeddingClient` from `createServer` (`packages/control-plane/src/api/server.ts:600-605`).
- Drawer fusion in facts routes also uses the injected `embeddingClient` (`packages/control-plane/src/api/routes/memory-facts.ts:285-290`, `packages/control-plane/src/api/routes/memory-facts.ts:681-690`).

Why this fails:
- Settings can configure a provider and memory fact search may use it, while drawer search remains tied to the old `LITELLM_URL` boot client or keyword-only behavior.

Required fix:
- Include `memory-drawer-search.ts`, `api/routes/memory-drawers.ts`, and drawer fusion in PR B rewiring.
- The drawer vector path must resolve `{ client, model }` through the same factory/cache and apply the drawer `embedding_model` predicate.

### P0-6 - Memory writes still risk hard-coding `text-embedding-3-small` into model metadata.

Spec evidence:
- §7.3.2 says `MemoryStore.addFact` and `memory-drawer-store` call the factory, but does not state they write the resolved provider model into `content_model` / `embedding_model` (`v3:523-524`).
- §18 only requires backfill to write `content_model`; it does not require normal `addFact` or drawer writes to do so (`v3:821-824`).

Code evidence:
- `MemoryStore.addFact` inserts `DEFAULT_CONTENT_MODEL` and returns `DEFAULT_CONTENT_MODEL` (`packages/control-plane/src/memory/memory-store.ts:225-240`, `packages/control-plane/src/memory/memory-store.ts:252-257`).
- `MemoryDrawerStore.writeSource` inserts `MEMORY_EMBEDDING_MODEL` (`packages/control-plane/src/memory/memory-drawer-store.ts:140-184`).

Why this fails:
- If the active provider is Gemini or any future non-default model, newly generated vectors can be labeled as `text-embedding-3-small`.
- Then §8's model lock, mixed-model filtering, and `MODEL_MISMATCH` gates all operate on false metadata.

Required fix:
- PR B must explicitly change every embedding write path to persist `resolved.model` when an embedding is successfully generated.
- If embedding generation fails and a null embedding is stored, either allow a nullable model marker or ensure later search/model-lock predicates never treat the default as evidence of an actual vector model.
- Add tests for `MemoryStore.addFact`, `MemoryDrawerStore.writeSource`, drawer backfill, and embedding backfill with a non-default model.

### P0-7 - Mixed-model search is still internally contradictory and has a dead predicate.

Spec evidence:
- §8 says mixed-model search restricts to the majority model (`v3:560`).
- §8 later says search filters to `$queryModel` from the active provider (`v3:567-569`).
- The banner text says search is filtered to `{active}` (`v3:570`).
- The BM25/graph predicate is `content_model = $queryModel OR content_model IS NULL` (`v3:568`).

Code/schema evidence:
- `memory_facts.content_model` is `NOT NULL DEFAULT 'text-embedding-3-small'` (`packages/control-plane/src/db/schema.ts:360`).

Why this fails:
- Majority model, active/query model, and fail-closed 503 are three different policies.
- `content_model IS NULL` is unreachable in the current schema.
- Unembedded facts have a default `content_model` even when no embedding exists, so a provider switch can hide valid keyword/graph results if BM25/graph filters only on `content_model`.

Required fix:
- Define one policy:
  - Vector path: `embedding IS NOT NULL AND content_model = $queryModel`.
  - Non-vector fact paths: either do not filter by model, or filter with `(embedding IS NULL OR content_model = $queryModel)` if the product explicitly wants to hide embedded wrong-model facts.
  - Drawer vector path: `embedding IS NOT NULL AND embedding_model = $queryModel`.
- Remove "majority model" unless that is the chosen policy.
- Add tests where `embedding IS NULL` rows have the default model but active provider is non-default.

### P0-8 - The error contract depends on status/hint behavior the existing server does not provide.

Spec evidence:
- §6.1 depends on `hint` for 409 disambiguation (`v3:327`).
- §14 defines statuses such as 401, 403, 409, 422, and a flat envelope with `hint` (`v3:731-754`).
- §5.2 specifically throws `ControlPlaneError('JOB_ALREADY_RUNNING')` (`v3:186`).

Code evidence:
- Global ControlPlaneError handler returns only `{ error, message }`, no `hint` (`packages/control-plane/src/api/server.ts:937-943`).
- `controlPlaneErrorToStatus()` maps only `*_NOT_FOUND` to 404, `*_UNAVAILABLE` / `*_OFFLINE` to 503, `INVALID_*` to 400, and everything else to 500 (`packages/control-plane/src/api/server.ts:1197-1207`).

Why this fails:
- Throwing `ControlPlaneError('JOB_ALREADY_RUNNING')`, `MODEL_MISMATCH`, `PROVIDER_HAS_ACTIVE_JOBS`, or `VALIDATION_ERROR` through the current handler returns 500, not the contract in §14.
- The web client can read `hint`, but the server does not emit it today.

Required fix:
- Add a memory-ops error responder or extend the global status map/envelope intentionally.
- Specify how `ControlPlaneError.context` maps to `hint` or a typed `details` field.
- Add API tests for every §14 status/code pair, including `hint` for duplicate-active and active-job conflicts.

### P0-9 - The capabilities endpoint is not canonical, and the UI gating rules contradict the server rules.

Spec evidence:
- Under `/api/memory/ops/jobs`, §6.2 lists `GET /capabilities` (`v3:379`), which implies `/api/memory/ops/jobs/capabilities`.
- The prose later names `GET /api/memory/ops/capabilities` (`v3:407`).
- §5.2 says JobCard disables on local enabled kinds and same local kind/scope (`v3:180`).
- §13.2 says JobCard disables when any job of that kind is running anywhere in the mesh and omits `enabledKinds` (`v3:685`).

Why this fails:
- The frontend and backend can implement different URLs.
- The "anywhere in mesh" rule contradicts the "local only, cross-peer informational" rule. It also ignores scope.
- The PR F gap v3 claims to fix can still ship if the UI does not consume `enabledKinds`.

Required fix:
- Choose one URL and repeat it identically in route inventory, prose, Appendix A, client module, and tests.
- Define a single disabled predicate that includes `MEMORY_OPS_ENABLED`, `enabledKinds`, provider requirement, ownership, and the chosen local-vs-fleet concurrency policy from P0-1.

### P0-10 - `drawer-backfill.sourceRoot` is an arbitrary local file exfiltration surface.

Spec evidence:
- The `drawer-backfill` schema accepts `sourceRoot` as merely "non-empty" (`v3:449`).
- SSRF/egress controls only discuss catalog base URLs and fact-content redaction truth (`v3:654-658`).

Why this fails:
- A direct API caller can request a drawer backfill over any readable local path unless the handler adds path policy that the spec never defines.
- Because drawer backfill sends content to an external embedding provider after a boolean egress ack, this is a local-file exfiltration primitive, not just a convenience import.

Required fix:
- Do not accept arbitrary raw `sourceRoot` in v1, or restrict it server-side to configured memory roots/workspace roots with `realpath`, symlink escape checks, file-type allowlists, max byte counts, and clear audit fields.
- Add tests for `../`, symlink escape, absolute paths outside allowed roots, oversized trees, and unsupported extensions.

### P0-11 - The Gemini PR A gate is self-contradictory and can make PR A unmergeable.

Spec evidence:
- §6.3 requires a failing-test-first network contract test "against the real Gemini endpoint with a fake key, asserting the 401 response shape" (`v3:435`).
- The same sentence says PR A must not merge until the test passes "with `output_dimensionality: 1536` returned at exactly 1536 dimensions" (`v3:435`).

Why this fails:
- A fake key can prove a URL resolves to an auth error. It cannot return embeddings or dimensions.
- A live dimension test needs a real Gemini key in CI or a recorded contract fixture. v3 does not specify either.

Required fix:
- Split the gate:
  1. No-secret URL smoke with fake key: endpoint resolves and returns expected auth error, not 404/path failure.
  2. Secret-gated live contract with `GEMINI_API_KEY`: verifies model, body, vector dimension, and response shape.
- State whether PR A can merge without the secret-gated live test in public CI. If not, add the required secret to rollout prerequisites.

### P0-12 - Rollback SQL omits the new `memory_ops_audit` table.

Spec evidence:
- §10 adds `memory_ops_audit` as statement group D in migration `0033_add_memory_ops.sql` (`v3:609-623`).
- §5.5 rollback drops `memory_ops_job_events`, `memory_ops_jobs`, two api account indexes, and the api account columns, but never drops `memory_ops_audit` (`v3:270-280`).

Why this fails:
- v3's own rollback leaves a new table and indexes behind.
- Appendix A and §16 present PR A+B as revertible through `0033_add_memory_ops.down.sql`; that is false while `memory_ops_audit` survives.

Required fix:
- Add `DROP TABLE IF EXISTS memory_ops_audit;` to the rollback, before or after job tables as appropriate.
- Add rollback verification that asserts all four PR A table artifacts are gone.

## P1 Major Issues

### P1-1 - Job routes use `PROVIDER_NOT_FOUND` for missing jobs.

Spec evidence:
- `GET /:id -> 200 | 404 PROVIDER_NOT_FOUND` (`v3:380`).
- Cancel also lists `404 PROVIDER_NOT_FOUND` (`v3:383`).

Fix:
- Add `JOB_NOT_FOUND` to §14 and route contracts. Keep `PROVIDER_NOT_FOUND` only for provider resources or provider references.

### P1-2 - Settings route acceptance uses the wrong method and path.

Spec evidence:
- §14 and §18 say `POST /api/settings default_account_id` (`v3:753`, `v3:836`).

Code evidence:
- Existing route is `PUT /api/settings/defaults` with `defaultAccountId` (`packages/control-plane/src/api/routes/settings.ts:54-113`).

Fix:
- Replace with `PUT /api/settings/defaults` and `defaultAccountId`.
- Add a separate required test for `PUT /api/settings/project-accounts` because §9 also requires `project_account_mappings` validation.

### P1-3 - Progress math is inconsistent and misses fields used later.

Spec evidence:
- `processed` is documented as "batches attempted" while `total` is "eligible work snapshot" rows (`v3:165-170`).
- §7.4 sets `progress.usageEstimated = true`, but `MemoryOpsProgress` has no `usageEstimated` field (`v3:544`, `v3:165-173`).
- Completion uses `failed / total < 0.05` (`v3:824`).

Fix:
- Make `processed` rows attempted, or add `batchesProcessed`.
- Add `usageEstimated?: boolean`.
- Define zero-total behavior explicitly: zero eligible rows should complete without division by zero.

### P1-4 - SSE notification and event retention prose does not match the event schema.

Spec evidence:
- §6.2 says the repo writer `pg_notify`s after every `memory_ops_jobs` write (`v3:416-419`).
- §5.3 says result overflow writes the full payload as an `event_type='log'` row (`v3:219`).
- Event schema has `message text` and `progress jsonb`; message is capped to 512 chars (`v3:194-203`, `v3:216-219`).

Why this matters:
- Log-only event inserts may not wake SSE clients if notifications only follow job writes.
- A 16 KB+ result cannot be stored as a "full payload" log row with a 512-char message and no payload column.

Fix:
- Notify after `memory_ops_job_events` inserts as well as job updates, preferably in the same transaction.
- Add a bounded `payload jsonb` column or delete the "full payload as log row" claim and keep only a summary.

### P1-5 - Test-before-save tokens are underspecified and PATCH key rotation discards the test result.

Spec evidence:
- `/test-ephemeral` returns a `signedToken` (`v3:295-300`).
- Create accepts `recentTestResult` (`v3:339-346`).
- PATCH `apiKey` resets `last_test_ok=null` and `last_test_error=null` (`v3:319`).
- UI says edit mode with changed API key uses `/test-ephemeral` (`v3:673-674`).

Fix:
- Define `recentTestResult` for PATCH-with-new-key.
- The signed payload must bind provider, model, API-key fingerprint/HMAC, dim, ok, testedAt, and actor. POST/PATCH must recompute the fingerprint against the submitted key.
- Otherwise a valid token from one key can be replayed with another key, or the UI tests a key and immediately saves it as untested.

### P1-6 - `/test-ephemeral` lacks concrete rate limiting and missing-secret behavior.

Spec evidence:
- `/:id/test` has 5/min per IP (`v3:312`).
- `/test-ephemeral` lists `429 RATE_LIMITED` but no limit (`v3:295-300`).
- PR B adds `MEMORY_OPS_SIGNING_SECRET`, but the runtime behavior when absent is unspecified (`v3:780`).

Fix:
- Define exact rate limits for `/test-ephemeral`.
- Define whether missing `MEMORY_OPS_SIGNING_SECRET` fails boot, disables test-before-save, or derives from `CREDENTIAL_ENCRYPTION_KEY`.

### P1-7 - Egress confirmation is still not bound to what the user confirmed.

Spec evidence:
- UI shows destination host, estimated rows, tokens, and cost (`v3:662`).
- POST only sends `egressConfirmed: true` (`v3:409-413`).

Fix:
- Server should compute and persist the egress snapshot used for the job: provider id, model, host, row count estimate, token estimate, cost estimate, and content class.
- If the provider or source changes between dialog and POST, the server must reject or require a fresh confirmation.

### P1-8 - Factory cache invalidation is underspecified for the `active` cache key.

Spec evidence:
- Cache key is `credentialId || 'active'` (`v3:504`).
- Bus payload is `{ credentialId?: string; deletedId?: string }`; factory clears matching entries, ambiguous events full clear (`v3:515`).

Why this matters:
- A provider update for a concrete credential can also change the default active provider result.

Fix:
- State that every provider write clears the `active` key. Simpler: full clear on every POST/PATCH/DELETE/test metadata write.
- Add a test where active provider switches and `resolveEmbeddingClient({ credentialId: undefined })` returns the new provider immediately.

### P1-9 - Manual `/:id/test` deactivation conflicts with active-job protection.

Spec evidence:
- `/:id/test` 401 deactivates the provider row (`v3:309-310`).
- PATCH `active=false`, key rotation, and delete are blocked by active jobs (`v3:301-308`, `v3:323`).

Fix:
- Decide whether a failed manual test may deactivate a provider with queued/running jobs.
- If yes, document why this bypass is safe. If no, manual test should mark metadata unhealthy and leave `is_active` unchanged until jobs finish.

### P1-10 - Provider routes need raw `pgPool`, not just `db + encryptionKey`.

Spec evidence:
- §6 says all routes are registered under `db + encryptionKey` guard (`v3:285`).
- §6.1 provider POST/PATCH must run `MODEL_MISMATCH` checks over `memory_facts.embedding` and `memory_drawers.embedding` (`v3:321-325`).

Code evidence:
- `memory_facts.embedding` is intentionally absent from Drizzle schema (`packages/control-plane/src/db/schema.ts:354-375`).

Fix:
- Provider routes must receive `pgPool` or a repository that can run raw SQL for model distribution.
- Add route-registration changes to Appendix A.

### P1-11 - Provider requirement for job kinds is ambiguous.

Spec evidence:
- `POST /jobs` lists `409 EMBEDDING_NO_PROVIDER` generically (`v3:375`).
- §7.4 says consolidation and synthesis have `costUsd=0` and no external API calls (`v3:535-540`).
- §5.2 says JobCard disables for kinds that require a provider (`v3:180`).

Fix:
- Add a per-kind `requiresProvider` matrix to §6.2/capabilities.
- Consolidation/synthesis should not fail with `EMBEDDING_NO_PROVIDER` unless the handler actually needs a provider for a specific mode.

### P1-12 - The P99 acceptance criterion does not measure the hot path it claims to protect.

Spec evidence:
- §7.3 warns that `MemoryStore.addFact` is the hot path (`v3:497`).
- §18 measures `MemoryStore.addFact` P99 "during a 19k-fact backfill" and says the baseline is in a repo-committed `coverage-baseline.md` (`v3:838`).

Why this fails:
- `embedding-backfill` uses batch UPDATE, not `MemoryStore.addFact`.
- A coverage baseline file is not a performance baseline.

Fix:
- Add a dedicated addFact benchmark with warm factory cache and a mock/stub provider.
- Add a separate API latency/backfill benchmark if needed.
- Rename the artifact to a performance baseline and specify the command, hardware/tier, sample size, and metric extraction.

### P1-13 - Required tests do not cover the new v3 failure modes.

Spec evidence:
- Required integration tests are listed in §15 (`v3:762-769`).

Missing tests:
- Omitted/blank/whitespace scope duplicate detection.
- Redis enqueue succeeds then DB transaction rolls back, and DB commit succeeds then Redis enqueue fails.
- Omitted `credentialId` materializes active provider id and egress snapshot.
- Drawer search resolves provider from the DB factory and filters by `embedding_model`.
- `MemoryStore.addFact` and `MemoryDrawerStore.writeSource` persist non-default provider model metadata.
- Every §14 error code returns the specified HTTP status and hint/details.
- Cross-peer concurrent backfill with different models is blocked.
- Remote synced job is never claimed by a non-executor peer.
- The stale v2-era "two CPs race same job and only one wins" test is either rewritten or removed, because v3 no longer allows any-peer claim.

Fix:
- Add these as explicit required tests before the plan is generated.

### P1-14 - Origin-only execution introduces an origin-offline stuck-job mode with no runbook.

Spec evidence:
- §5.2 says v1 jobs always run on their origin peer and peer UI is read-only (`v3:176-180`).
- §4 boot reconciliation only marks `running` jobs failed on the same executor when that CP boots (`v3:77`).
- Cross-peer takeover is v1.1 (`v3:179`).

Why this matters:
- If a job is queued on A and A goes offline before the worker starts, B can see the synced job but cannot cancel/run/take over.
- The runbook only covers manual force-fail for `status='running'` after stopping the worker (`v3:804`), not `queued` jobs whose origin is gone.

Fix:
- Add an explicit runbook for origin-offline queued jobs: how to identify them, who is allowed to mark them failed/cancelled, and how to re-post safely.
- Add UI copy for read-only remote jobs whose executor is offline.

### P1-15 - Invalidation bus subscription lifecycle is not specified.

Spec evidence:
- §7.3.1 defines an EventEmitter singleton and says the factory cache subscribes (`v3:513-515`).

Why this matters:
- If every factory call subscribes, the process leaks listeners and eventually emits MaxListeners warnings.
- If subscription is module-load side effect, tests and hot reload need deterministic cleanup/reset.

Fix:
- Specify that the cache module registers exactly one listener at module initialization, exports a test-only reset/clear helper, and never registers per request.
- Add a listener-count/cache-reset unit test.

## P2 Required Spec Corrections

### P2-1 - The `getMachineId()` citation points to the caller, not the helper.

Spec evidence:
- §4 says `getMachineId()` is from `packages/control-plane/src/index.ts:242-244` (`v3:79`).

Code evidence:
- `index.ts` imports it. The helper lives in `packages/control-plane/src/sync/machine-identity.ts:11`.

Fix:
- Cite `sync/machine-identity.ts:11` and list that import requirement for route/worker modules.

### P2-2 - `/test-ephemeral` says "No persistence" while §10 says it writes audit rows.

Spec evidence:
- `/test-ephemeral` says "No persistence" (`v3:299`).
- §10 says every write path, including `test-ephemeral`, calls the audit logger (`v3:652`).

Fix:
- Clarify "No provider credential or test-result persistence; audit row is still written and must not include plaintext key material."

### P2-3 - `hint = JSON.stringify(...)` is too weak for structured clients.

Spec evidence:
- §6.1 uses `hint` for constraint name vs `JSON.stringify({blockingJobIds})` (`v3:327`).

Fix:
- Prefer a typed `details` object, or formally define `hint` as machine-readable JSON for these codes. The current mix of human string and JSON string is brittle.

### P2-4 - Metadata casing is inconsistent.

Spec evidence:
- PATCH matrix uses `last_test_ok` / `last_test_error` (`v3:319`).
- Acceptance uses `lastTestOk` / `lastTestError` (`v3:827`).
- UI alert checks `metadata.last_test_ok` (`v3:693-696`).

Fix:
- Pick DB/internal snake_case vs API/UI camelCase and document the transform.

### P2-5 - `executor_machine_id` is nullable even though v1 requires same-peer execution.

Spec evidence:
- Schema allows null (`v3:132`).
- §5.2 says POST sets executor at insert and v1 has no cross-peer takeover (`v3:176-179`).

Fix:
- Either make it `NOT NULL` in v1 or document the only valid nullable state and add a DB/check/repository invariant. Leaving it nullable invites stuck jobs.

### P2-6 - Advisory lock hash collision risk is not acknowledged.

Spec evidence:
- Lock key uses `hashtext(...)::bigint` (`v3:186`).

Fix:
- Acknowledge the 32-bit `hashtext` collision tradeoff or use `hashtextextended` / two-int advisory lock keys. This is not the main duplicate invariant, but a false collision can still produce confusing 409s.

### P2-7 - `memory_ops_jobs.result` and `memory_ops_audit.context` need size/redaction rules.

Spec evidence:
- Result has a 16 KB soft cap (`v3:219`).
- Audit context is arbitrary JSON and "NEVER plaintext keys" (`v3:636`).

Fix:
- Define enforceable caps and redaction helper names for audit context.
- Add tests that API keys, bearer tokens, and long content are not stored in audit/context/result fields.

### P2-8 - Appendix C overclaims closure.

Spec evidence:
- Appendix C says every round-3 P0 is patched and no outstanding P1/P2 deferrals remain (`v3:896`, `v3:937`).

Fix:
- After addressing this review, keep Appendix C as a traceability table, but stop using it as proof of readiness. The section mappings are necessary, not sufficient.

## Required Disposition Before Plan Work

Minimum bar for v4:

1. Resolve the cross-peer shared-data concurrency policy.
2. Redesign job enqueue around a real DB/Redis consistency story.
3. Persist provider/egress snapshots at job creation.
4. Rewire drawer search and all embedding write paths, including model metadata writes.
5. Replace the mixed-model policy with one exact backend predicate set.
6. Define a real error responder/status map with hint/details support.
7. Lock down `sourceRoot`.
8. Fix the capabilities URL and UI disabled predicate.
9. Split Gemini fake-key vs live-dimension tests.
10. Fix rollback coverage for `memory_ops_audit`.
11. Expand tests to cover every P0 above.

Until those are in the spec, v3 is still not safe to hand to an implementation agent.
