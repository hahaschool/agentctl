# Memory Operations UI v4 Spec - Strict Critical Review

> Review date: 2026-04-25
> Target: `docs/superpowers/specs/2026-04-24-memory-operations-ui-design-v4.md` at branch `agent/claude-1/docs/memory-ops-ui-spec`, commit `b66d3def`, 965 lines.
> Verdict: **Reject as not implementation-ready.** v4 closes several v3 review items on paper, but it still contains data-corruption races, an invalid BullMQ enqueue contract, an impossible egress-confirmation flow, a rollout-breaking secret requirement, and multiple API/UI contracts that cannot be implemented from the spec without guessing. Do not dispatch an implementation plan from this draft.

## Review Method

- Read the full v4 spec with line-number evidence.
- Compared Appendix D against both requested v3 round-4 reviews.
- Spot-checked the requested facts file and local code anchors for BullMQ usage, error envelopes, API client behavior, sync config, route registration, settings/agents account paths, and memory sidebar paths.
- Checked current official Google AI documentation for the Gemini OpenAI-compatible embeddings endpoint and embedding dimension behavior:
  - <https://ai.google.dev/gemini-api/docs/openai>
  - <https://ai.google.dev/gemini-api/docs/embeddings>
- This is a single-pass strict review. No deferred findings are intentionally left for a later round.

Severity:
- **P0**: blocks implementation planning. The spec would corrupt shared data, break rollout, create an unbounded security/privacy surface, or define an impossible contract.
- **P1**: must be fixed before coding the relevant PR.
- **P2**: required spec hygiene before declaring the document locked.

## P0 Blockers

### P0-1 - The "fleet-wide exclusion" still does not protect mesh-synced embeddings.

Evidence:
- v4 correctly states that simultaneous peer backfills can corrupt `memory_facts.embedding` / `memory_drawers.embedding` when providers differ (`v4:189-191`).
- The proposed fix is a SELECT against the mesh-synced `memory_ops_jobs` table before insert (`v4:193-203`).
- The same paragraph admits a cross-machine race window and then claims the worst case is a redundant no-op because `WHERE f.embedding IS NULL` will skip already-embedded rows (`v4:203`).
- The risk table repeats that claim (`v4:843`).

Why this fails:
- The peer race is not a single shared-Postgres row-lock race. It is an asynchronous mesh race across local databases. If peer A and peer B both start before either job row syncs, both local `memory_facts` tables still have `embedding IS NULL`, both write vectors locally, and mesh conflict resolution later decides which writes survive. The `WHERE f.embedding IS NULL` guard only helps inside one database after one writer has already committed; it does not make two peers' local writes a no-op.
- This is exactly the data-corruption risk R1 P0-1 identified. v4 acknowledges it and then accepts it while still marking it fixed in Appendix D (`v4:912`).

Required fix:
- Use a real cross-peer exclusion primitive before any write-kind job starts. Acceptable options: Redis `SET NX PX` / BullMQ global job id on a shared Redis namespace per fleet, a single elected memory-ops owner, or making embedding columns local-only.
- If the team intentionally accepts the race, the spec must stop claiming R1 P0-1 is fixed and must not call the draft implementation-ready.
- Required test must simulate two peers whose job rows are not yet mesh-visible to each other; the current "shared jobs table" test at `v4:745` is too weak.

### P0-2 - BullMQ enqueue passes the DB id in the data payload, not as the BullMQ job id.

Evidence:
- v4 phase 2 says `await bullmqQueue.add(kind, { jobId: insertedId })` (`v4:221-223`).
- Boot recovery then polls BullMQ with `getJob(jobId)` using the DB job id (`v4:228`).
- Existing BullMQ usage in this codebase passes `jobId` as the third `opts` argument, not inside the data payload:
  - `packages/control-plane/src/scheduler/task-graph-executor.ts:48-50`
  - `packages/control-plane/src/scheduler/repeatable-jobs.ts:57-63`
  - `packages/control-plane/src/scheduler/knowledge-maintenance-job.ts:111-122`

Why this fails:
- In BullMQ, `Queue.add(name, data, opts)` treats `{ jobId: insertedId }` as ordinary job data when supplied as the second argument. The actual BullMQ id will be generated.
- `queue.getJob(insertedId)` will then return null, so the boot "missing job" scanner will keep thinking the durable DB job was never enqueued and can re-enqueue duplicates.

Required fix:
- Specify: `await bullmqQueue.add(kind, { dbJobId: insertedId }, { jobId: insertedId })`.
- Worker data shape must use `dbJobId`, not `jobId`, to avoid confusing BullMQ's id with the DB row id.
- Add a unit test that asserts `queue.add` receives the DB id in the third argument and that boot recovery's `getJob(insertedId)` finds the existing BullMQ job.

### P0-3 - Cancel semantics are impossible to implement durably.

Evidence:
- `memory_ops_jobs.status` allows only `queued`, `running`, `completed`, `failed`, `cancelled` (`v4:124-126`).
- Cancel route returns `{ status: 'cancelled'|'cancelling', job }` (`v4:404`, `v4:438`).
- Acceptance requires "Cancel mid-batch -> status='cancelled'; terminal invariant holds" (`v4:828`).
- There is no `cancelling` DB state, no `cancel_requested_at`, no cancellation token column, and no worker polling contract.

Why this fails:
- If a running job is mid-batch, the API cannot persist "cancel requested" anywhere. Returning `cancelling` is just a transient response value.
- The worker has no durable signal that it should stop after the current batch, and a natural handler return can still race into `completed`.
- The spec asks for a terminal-transition invariant but does not define the repository `WHERE status IN (...)` rules or the cancellation state the worker checks.

Required fix:
- Add either `status='cancelling'` to the DB enum/check and event type, or add `cancel_requested_at timestamptz` plus a repository method that atomically requests cancellation.
- Worker handlers must check the persisted cancellation signal between batches and transition only through a repository method that enforces legal state transitions.
- Add tests for queued cancel, running mid-batch cancel, double cancel, and complete-after-cancel races.

### P0-4 - The egress confirmation flow cannot show the server snapshot before the user confirms it.

Evidence:
- Server computes and persists `egress_snapshot` at job creation inside POST `/api/memory/ops/jobs` (`v4:434`).
- UI copy says that before the first backfill, the dialog shows row count, tokens, and cost "from `egress_snapshot` returned in POST 201 response", then the submit posts `egressConfirmed: true` (`v4:646`).
- Staleness rejection between dialog open and POST is explicitly deferred to v1.1 (`v4:434`).

Why this fails:
- The user cannot review a POST 201 response before making the POST that creates the job.
- The server snapshot is not bound to the operator's confirmation. The current flow is a boolean ack over a snapshot the user has not seen.
- Deferring staleness rejection means the provider/source/eligible-row count can change between whatever the UI estimated and what the server actually enqueues.

Required fix:
- Add a server-side prepare endpoint, for example `POST /api/memory/ops/jobs/preview`, that returns `{ snapshot, confirmationToken }`.
- The create endpoint must require the confirmation token or snapshot hash, recompute the snapshot in the same transaction, and reject with `EGRESS_SNAPSHOT_STALE` if anything material changed.
- Key the browser skip state by `{credentialId, providerModel, providerHost, kind, normalizedScope, sourceRootHash}` at minimum, not only by credential id.

### P0-5 - `drawer-backfill` egress estimates are computed from the wrong data source.

Evidence:
- v4 says all write kinds store a row count from `SELECT COUNT(*) FROM memory_facts WHERE embedding IS NULL` plus token/cost estimates (`v4:434`).
- `drawer-backfill` params are source-file based: `sourceType`, `sourceRoot`, `batchSize` (`v4:477`).
- `drawer-backfill` sends local source content to the embedding provider and is gated by egress confirmation (`v4:464-478`, `v4:646`).

Why this fails:
- `memory_facts` counts are irrelevant for `drawer-backfill`. A source tree can contain zero facts and thousands of drawer chunks, or vice versa.
- The user can be shown a fact-row estimate while confirming exfiltration of unrelated files under `sourceRoot`.

Required fix:
- Define per-kind snapshot builders.
- `embedding-backfill`: eligible facts, fact content chars/tokens, active provider price.
- `drawer-backfill`: resolved source root, file count, total bytes, chunk count estimate, token estimate from file contents, skipped file counts by reason, provider destination.
- Tests must assert `drawer-backfill` never uses `memory_facts` counts for its egress snapshot.

### P0-6 - `sourceRoot` restriction is still bypassable by path-prefix confusion.

Evidence:
- v4 validation says `realpath(sourceRoot)` must start with one configured root from `MEMORY_OPS_DRAWER_SOURCE_ROOTS` (`v4:464-470`).

Why this fails:
- Prefix checks are not path containment checks. `/allowed-evil` starts with `/allowed`.
- The spec does not require `realpath()` on each configured root, so an allowed root that is itself a symlink can make the policy ambiguous.
- The file-type allowlist is not stated as recursive over every discovered file after symlink resolution.

Required fix:
- Canonicalize every configured root with `realpath` at boot.
- Use `path.relative(root, resolvedPath)` and require it to be `''` or a non-absolute path that does not start with `..`.
- During traversal, `lstat` and `realpath` each candidate file, reject symlink escapes, enforce extension allowlist per file, and count bytes before reading content.
- Add explicit tests for `/allowed` vs `/allowed-evil`, allowed-root symlink escape, nested symlink escape, and mixed allowed/disallowed trees.

### P0-7 - `MEMORY_OPS_SIGNING_SECRET` as a boot-fatal requirement is a rollout breaker.

Evidence:
- v4 requires `MEMORY_OPS_SIGNING_SECRET`; if absent at boot, CP logs fatal and exits (`v4:354`).
- PR B is a patch release on the critical path and only adds the env var to `.env.example` (`v4:774-775`).
- Existing account-route registration does not crash the process when `CREDENTIAL_ENCRYPTION_KEY` is missing; it logs a warning and disables account management routes (`packages/control-plane/src/api/server.ts:828-847`).

Why this fails:
- A patch PR would make existing deployments fail to boot unless every environment pre-provisions a new secret before deploy.
- This contradicts the existing defensive pattern for credential-related route enablement.
- The feature flag controls job POSTs, not provider-route registration, so `MEMORY_OPS_ENABLED=false` does not save the process from the new boot-fatal path.

Required fix:
- Do not make PR B fatal on a newly introduced optional UI secret.
- Either disable `/test-ephemeral` and provider save-with-token routes with a clear `SIGNING_SECRET_MISSING` error, or generate/persist a local signing secret in the settings table with an explicit migration.
- Add rollout acceptance that CP boots cleanly with old env files after PR B.

### P0-8 - The `LITELLM_URL` fallback violates the v4 goal and bypasses provider audit/egress controls.

Evidence:
- Goal: all memory read/write paths resolve the active embedding provider from DB, not `LITELLM_URL` env (`v4:19`).
- Factory resolution step 3 falls back to `process.env.LITELLM_URL` when no DB provider exists (`v4:512-516`).
- Section 7.3.2 says all memory runtime surfaces switch off boot-time `LITELLM_URL` injection and drop the `if (LITELLM_URL)` block (`v4:537-548`).

Why this fails:
- The env fallback still allows memory writes/search query embeddings to leave the machine without an `api_accounts` provider row, without provider audit records, and without the Settings UI's health/egress story.
- `<MissingEmbeddingAlert />` can say no provider is configured while runtime paths still call an env-sourced external embedding service.
- This is not just a deprecation detail; it contradicts the central product and security premise of the spec.

Required fix:
- Remove `LITELLM_URL` fallback from all UI-backed memory runtime paths, or put it behind an explicit legacy mode that is disabled by default and clearly outside Memory Operations UI.
- If legacy fallback remains for non-UI compatibility, it must emit audit records, be visible in capabilities, and never satisfy provider-required job creation silently.

### P0-9 - The new `details` error contract is not consumable by the web client.

Evidence:
- v4 says the envelope is `{ error, message, details }` and that `hint` is dropped (`v4:696-704`).
- Existing `ApiError` only has `hint?: string` and `request()` reads `body.hint`, not `body.details` (`packages/web/src/lib/api/core.ts:7-40`).
- Appendix A does not list `packages/web/src/lib/api/core.ts` as a required change for PR B, C, or F (`v4:866-884`).
- UI acceptance depends on `details.blockingJobIds` (`v4:824`), and section 14 has multiple structured `details` shapes (`v4:706-727`).

Why this fails:
- Server can emit `details`, but the frontend error object will discard it.
- New provider/job UI code will either branch on unavailable data or invent a second parsing path outside the core API helper.

Required fix:
- Change `ApiError` to include `details?: unknown`, parse `body.details`, and update all affected tests.
- Appendix A must list `packages/web/src/lib/api/core.ts` in the PR that changes the envelope.
- Add a web-client unit test proving `details.blockingJobIds` survives through `request()`.

### P0-10 - Gemini support is still allowed to ship from an unverified catalog entry.

Evidence:
- Catalog entry uses `gemini-embedding-001` on the OpenAI-compatible endpoint with `output_dimensionality: 1536` (`v4:444-449`).
- Gate 1 only sends a fake key to the URL and checks for 401, which does not validate the model or dimension behavior (`v4:451-454`).
- Gate 2 is optional for PR A merge and only required before PR G (`v4:455`).
- Current official Gemini OpenAI compatibility docs show embeddings through the OpenAI-compatible endpoint using `gemini-embedding-2-preview`, while the native embeddings docs state that Gemini embeddings default to 3072 dimensions and require an output dimensionality parameter to truncate.

Why this fails:
- PR A can merge a Gemini catalog row that has never successfully embedded one string through the exact compatibility endpoint/model/body the product will expose.
- Settings UI can offer Gemini before the live model/dimension contract has been proven.
- If the model path or body field is wrong, the implementation "passes" the PR A fake-key gate and fails only when an operator uses the feature.

Required fix:
- Make the live model/dimension contract a gate before exposing Gemini in the catalog/UI, or mark Gemini disabled until that gate passes.
- The contract test must assert endpoint, auth header, model id, request body, response model, vector length, and usage fields.
- Record the verified model id in the spec. Do not make `gemini-embedding-001` vs `gemini-embedding-2-preview` a plan-writer guess.

## P1 Major Issues

### P1-1 - PATCH key rotation still contradicts the `recentTestResult` flow.

Evidence:
- v4 says POST and PATCH both accept `recentTestResult` and bind it to the submitted API key fingerprint (`v4:356`).
- The PATCH field matrix still says `apiKey` resets `metadata.lastTestOk=null` and `lastTestError=null` (`v4:362`).
- `<MissingEmbeddingAlert />` renders when `lastTestOk === null` (`v4:669`).

Fix:
- Split the PATCH matrix into `apiKey` without valid recent test and `apiKey + recentTestResult` with valid recent test.
- On valid token, persist the successful test metadata rather than resetting to null.
- Define the invalid/expired token response; recommended: 422 `VALIDATION_ERROR` with structured details.

### P1-2 - Invalid or expired `recentTestResult` behavior is still unspecified.

Evidence:
- Tokens expire in 5 minutes (`v4:354`) and are accepted by POST/PATCH (`v4:356`), but no route behavior is defined for expired, malformed, wrong-provider, wrong-model, or wrong-key-fingerprint tokens.

Fix:
- Define exact status/code/details for token failures.
- Add UI behavior: if the token is expired client-side, force re-test before Save.

### P1-3 - Capability data is by kind, but the backend exclusion key is by kind plus scope.

Evidence:
- Backend fleet check is `(kind, normalizedScope, status)` (`v4:195-200`, `v4:207`).
- Capabilities return only `fleetJobsByKind` counts (`v4:379-389`).
- JobCard disables all write jobs of a kind when any fleet job of that kind is queued/running (`v4:425-432`).

Why this matters:
- Either scope is a real concurrency dimension or it is not. v4 uses it in the server invariant and drops it in UI/capabilities.
- A scoped backfill for `scope=A` can block an unrelated scoped backfill for `scope=B` in the UI while the server would allow it.

Fix:
- Either remove `scope` from v1 job params, or return per-scope fleet status from capabilities and make JobCard evaluate the selected normalized scope.

### P1-4 - `GET /jobs` cannot express the local-only predicate used by SQL-only JobCards.

Evidence:
- SQL-only JobCards are disabled by "local non-terminal job" read from `GET /jobs?kind=X&status=queued,running&limit=1` (`v4:429-430`).
- `GET /api/memory/ops/jobs` only says filters are `kind`, `status`, `limit<=200` (`v4:399`).
- It does not state whether the endpoint returns local jobs, mesh-visible jobs, or supports `executorMachineId=local`.

Fix:
- Define `status` as either repeated parameters or comma-separated list, not both by implication.
- Add `localOnly=true` or `executorMachineId` filtering, and specify the default list semantics.

### P1-5 - `details` and `context` are still mixed in the validation contract.

Evidence:
- Section 14 standardizes on `details` (`v4:699-727`).
- SourceRoot validation says failures return `context.sourceRootViolation` (`v4:470`).
- Required test repeats `context.sourceRootViolation` (`v4:761`).

Fix:
- Replace every client-visible `context.*` reference with `details.*`.
- Reserve `ControlPlaneError.context` for server internals only, mapped into response `details`.

### P1-6 - `resolveEmbeddingClient({ credentialId })` does not define missing-credential behavior.

Evidence:
- Resolution step 1 says fetch the credential id and require `credential_kind='embedding'` (`v4:512-514`).
- It does not say what happens if the id is absent on this peer.
- Step 3 has a `LITELLM_URL` fallback (`v4:515`).

Fix:
- If a concrete `credentialId` is supplied and no matching local embedding credential exists, throw `EMBEDDING_CREDENTIAL_NOT_FOUND` or `EMBEDDING_CREDENTIAL_DECRYPT_FAILED` as appropriate. Do not fall back to active provider or `LITELLM_URL`.
- Add the error code to section 14 and tests.

### P1-7 - Model-lock behavior across facts and drawers is underdefined.

Evidence:
- Facts lock query is shown (`v4:565-572`).
- Then v4 says "Same rule for `memory_drawers.embedding_model`" (`v4:578`).
- `MODEL_MISMATCH` details have only `{ existingModel, incomingModel }` (`v4:724`).

Why this matters:
- If embedded facts are model X and embedded drawers are model Y, the spec does not define whether activation is blocked with two existing models, which table is reported, or what the user sees.

Fix:
- Define one combined distribution query across both tables with table labels.
- Expand details to include `existingModels: Array<{ table, model, count }>` or equivalent.

### P1-8 - `MIXED_MODEL_BLOCKED` is fact-only and uses the wrong HTTP status.

Evidence:
- Vector predicate applies to facts and drawers (`v4:582`).
- `MIXED_MODEL_BLOCKED` condition only references `memory_facts.content_model` (`v4:584`).
- Section 14 maps it to 503 (`v4:725`).

Fix:
- Define drawer-specific blocked behavior.
- Use 409, not 503. Mixed-model state is a durable data conflict, not a transient service outage.

### P1-9 - Provider activation semantics are not implementable from the PATCH matrix.

Evidence:
- `active=true` says "flip target row active" and also says the partial unique index blocks conflicts (`v4:365`).
- Only one active embedding row is allowed (`v4:103-105`).

Why this matters:
- There is no defined "switch active provider" operation. If another row is currently active, setting target active will 409 unless the route deactivates the old row in the same transaction.

Fix:
- Decide explicitly:
  - strict mode: operator must deactivate old provider first; or
  - switch mode: PATCH active=true atomically deactivates all other embedding rows after model-lock checks.
- Add concurrent activation tests for the chosen behavior.

### P1-10 - Test-before-save is a UI convention, not a server invariant.

Evidence:
- POST `/api/memory/providers` accepts `recentTestResult?`, optional (`v4:459-463`).
- Missing alert warns on `lastTestOk === null` (`v4:669`), but job creation uses active provider presence, not last-test health (`v4:423`, `v4:429`).

Why this matters:
- A direct API caller can create and activate an untested provider, then run a backfill. The UI may show an alert, but the server still allows egressing jobs.

Fix:
- Decide whether active provider creation requires a recent successful test. If yes, enforce it server-side. If no, stop presenting "Test-before-save" as a safety property and make job creation check provider health explicitly.

### P1-11 - Provider price used for job cost is not snapshotted.

Evidence:
- R1 P0-4 required persisting the price used for egress/cost attribution.
- v4 stores provider id/kind/model/host and an egress snapshot with estimated cost (`v4:187`, `v4:434`), but no unit price or catalog version.
- Risk table says cost is historical and captured at job time (`v4:845`).

Fix:
- Store `price_usd_per_mtoken` and catalog version in `egress_snapshot` or dedicated provider snapshot columns.
- Worker cost accumulation must use the job snapshot price, not a mutable in-process catalog lookup.

### P1-12 - Drizzle schema section is incomplete and contradicts the SQL migration.

Evidence:
- SQL migration creates `memory_ops_job_events`, `memory_ops_audit`, and `idx_memory_ops_jobs_kind_scope_status` (`v4:152-160`, `v4:232-250`, `v4:616-630`).
- Section 5.4 Drizzle additions only shows `apiAccounts` and `memoryOpsJobs`, and its indexes omit `idx_memory_ops_jobs_kind_scope_status` (`v4:259-301`).
- Appendix A claims `schema.ts` includes all three new tables (`v4:859`).

Fix:
- Add Drizzle schema definitions for `memoryOpsJobEvents` and `memoryOpsAudit`.
- Include the scope/status expression index or state that it is raw-SQL-only and must be preserved in the hand-written migration.

### P1-13 - Shared API response types are missing.

Evidence:
- Routes return `EmbeddingProvider`, `MemoryOpsJob`, `MemoryOpsJobKind`, capabilities response, and provider metadata (`v4:329-349`, `v4:379-412`).
- Section 6.3 defines provider kind/catalog and job params, but not these response types (`v4:442-481`).
- Metadata casing is discussed, but the metadata shape is not enumerated (`v4:671`).

Fix:
- Add `EmbeddingProvider`, `EmbeddingProviderMetadata`, `MemoryOpsJob`, `MemoryOpsJobStatus`, `MemoryOpsCapabilitiesResponse`, and event SSE payload types with camelCase API field names.

### P1-14 - Peer read-only progress is still overclaimed.

Evidence:
- Job events are local-only and SSE is same-peer (`v4:232-255`, `v4:409-411`).
- The sync trigger excludes progress-only updates (`v4:155-159`).
- Acceptance says a job on A is visible on B as read-only (`v4:830`) without stating that intermediate progress is not visible.

Fix:
- Add acceptance: remote peers see status and final synced progress only; live progress/log streaming is available on the executor peer only.

### P1-15 - Origin-offline recovery is still not in the risk table and lacks fencing.

Evidence:
- Runbook covers offline origin jobs (`v4:792-798`).
- Section 19 risks do not list "origin peer offline" (`v4:839-848`).
- The runbook tells another peer to force-fail a running job (`v4:796`) but does not define fencing if the origin peer comes back while the manual update is being made.

Fix:
- Add a section 19 risk row.
- Force-fail SQL must include status, executor, and an operator-confirmed timestamp/heartbeat condition, or require stopping the origin CP before mutation if reachable.

### P1-16 - `<MissingEmbeddingAlert />` still gives wrong guidance for passive peer viewing.

Evidence:
- Alert renders whenever the local machine has no provider or unhealthy provider (`v4:667-671`).
- `/memory/operations` shows remote jobs read-only (`v4:665`).

Fix:
- Copy must say "Configure one to run jobs on this machine; remote jobs can still be viewed."
- Or suppress on `/memory/operations` when the user is only looking at remote jobs and no local run action is being offered.

### P1-17 - Audit actor identity is undefined.

Evidence:
- `memory_ops_audit.actor` and `egress_confirmed_by` are text columns (`v4:143-144`, `v4:620-627`).
- No auth/session/user source is defined for these values.

Fix:
- Define actor source for local web calls, CLI/direct API calls, and background worker events. If there is no auth, use a deterministic machine/operator identity and say so.

### P1-18 - `EmbeddingClient` auth and request-body extension are underspecified.

Evidence:
- PR A adds `apiKey`, `extraBody`, `embeddingsPath` (`v4:489-492`).
- Existing client has no Authorization header and hardcodes body `{ model, input }` (`packages/control-plane/src/memory/embedding-client.ts:72-81`).

Fix:
- Specify `Authorization: Bearer ${apiKey}` for catalog providers.
- Specify merge order for `extraBody` and whether catalog fields can override `model` or `input`.
- Add OpenAI and Gemini request-shape tests.

### P1-19 - `sessionStorage` egress ack is too broad.

Evidence:
- The skip key is only `memory-ops-egress-ack:<credentialId>` (`v4:646`).

Why this matters:
- A same-tab confirmation for one provider can skip the dialog for a different kind, scope, or `sourceRoot` using the same credential.

Fix:
- Key by at least credential id, provider model, provider host, job kind, normalized scope, and source root hash.
- The server token from P0-4 should be the durable confirmation, not browser storage.

### P1-20 - Appendix C/D traceability still overclaims closure.

Evidence:
- Header says v4 addresses all P0s and P1s (`v4:4`).
- Appendix D says all R1 P1s are fixed (`v4:925-943`).
- Multiple R2 P1/P2 items remain open in this review: token failure behavior, coverage/perf split, peer progress limits, alert copy, Appendix traceability, origin-offline risk, and response type definitions.

Fix:
- Replace "all fixed" language with a traceability table that includes every R1 and R2 P1/P2 item and a real disposition: fixed, deferred with reason, or still open.

## P2 Required Corrections

### P2-1 - `coverage-baseline.md` is still used for a performance baseline.

Evidence:
- v4 says the addFact P99 baseline is committed in `2026-04-24-memory-operations-ui-coverage-baseline.md` (`v4:836`).

Fix:
- Split coverage and performance artifacts:
  - `...-coverage-baseline.md`
  - `...-perf-baseline.md`

### P2-2 - Section 14 is missing required implicit error codes.

Missing or underdefined:
- `EMBEDDING_CREDENTIAL_NOT_FOUND`
- `CATALOG_INVALID` or boot-fail log code for catalog validation
- `SIGNING_SECRET_MISSING` if P0-7 is fixed by disabling routes
- `INTERNAL_ERROR` as the generic server fallback
- `EGRESS_SNAPSHOT_STALE` if P0-4 is fixed properly

### P2-3 - Provider metadata fields are not enumerated.

Evidence:
- v4 mentions `lastTestOk` and `lastTestError` (`v4:362`, `v4:671`) but omits persisted/display fields such as model, dim, latency, cost, and testedAt.

Fix:
- Define the metadata shape and the DB snake_case to API camelCase transform for every field.

### P2-4 - `MEMORY_OPS_MAX_FAIL_RATIO` validation is missing.

Evidence:
- `.env.example` adds `MEMORY_OPS_MAX_FAIL_RATIO=0.05` (`v4:777`, `v4:882`).
- Acceptance hardcodes the 0.05 threshold (`v4:823`).

Fix:
- Define boot validation for missing, negative, NaN, zero, and >1 values.

### P2-5 - `validateCatalog()` failure behavior is incomplete.

Evidence:
- v4 says `validateCatalog()` throws when dimensions are not 1536 (`v4:457`).

Fix:
- State whether this crashes CP boot, disables memory provider routes, or fails only memory ops initialization. Include the log code.

### P2-6 - `MIXED_MODEL_BLOCKED` banner copy references "re-embed everything" before that feature exists.

Evidence:
- Banner says "Use /memory/operations to re-embed everything under one provider" (`v4:585`).
- Re-embed-all is v1.1/manual workaround only (`v4:799-806`).

Fix:
- Copy must say the UI cannot do this yet, or add a real re-embed-all job to v1.

### P2-7 - `memory_ops_job_events.payload` "full payload" conflicts with the 64 KB cap.

Evidence:
- v4 says overflow writes the full payload to `payload`, but `payload` is bounded to 64 KB (`v4:245`, `v4:253`).

Fix:
- Say "larger truncated payload" or add external artifact storage. Do not call it full if it is capped.

### P2-8 - `progress.processed` semantics are not defined per job kind.

Evidence:
- `processed` is "rows attempted" (`v4:174`).
- `drawer-backfill` processes files/chunks, while consolidation/synthesis are SQL-only operations (`v4:414-421`, `v4:472-480`).

Fix:
- Define progress units per kind: facts, drawer chunks, consolidation candidates, synthesis groups, or rename to a generic `unitsProcessed`.

### P2-9 - `memory_ops_audit` retention rationale is absent.

Evidence:
- Events are retained 14 days and audit 90 days (`v4:257`).

Fix:
- Add a short rationale so retention changes are not cargo-culted into future logs.

### P2-10 - `MEMORY_OPS_SIGNING_SECRET` generation guidance is missing.

Evidence:
- v4 only says `.env.example` gains the variable (`v4:875`).

Fix:
- Add a generation command and expected entropy/encoding, consistent with the existing `CREDENTIAL_ENCRYPTION_KEY` hint.

### P2-11 - `JOB_KIND_NOT_ENABLED` lacks a dedicated acceptance case.

Evidence:
- Route contract lists it (`v4:394`), but acceptance only checks `MEMORY_OPS_ENABLED=false` (`v4:832`).

Fix:
- Add: with `MEMORY_OPS_ENABLED=true` but kind not in `ENABLED_JOB_KINDS`, POST returns 400 `JOB_KIND_NOT_ENABLED` with `details.enabledKinds`.

### P2-12 - `egress_confirmed_by` is undefined for SQL-only jobs.

Evidence:
- The column exists on all jobs (`v4:143-144`) but egress is required only for backfill kinds (`v4:472-480`).

Fix:
- State that `egress_confirmed_by` is null for consolidation/synthesis and that provenance for all job creation lives in `memory_ops_audit`.

### P2-13 - The rollback verification wording is narrower than the migration.

Evidence:
- Rollback test asserts "all four table artifacts gone" (`v4:320`), but Group A also adds columns, constraints, and indexes (`v4:95-108`).

Fix:
- Rollback verification must assert tables, indexes, constraints, and columns are removed, and existing `api_accounts` rows survive.

### P2-14 - The PM2/Redis mapping was weakened from v3 and no longer cites the actual tier DB extraction.

Evidence:
- v4 says queues are namespaced per Redis DB (`v4:79`) and lists PM2 process names (`v4:808-815`), but drops the v3 code anchor for Redis DB extraction.

Fix:
- Re-add the `tier-config.extractRedisDb` citation or move queue namespace details out of the spec.

## Required Disposition Before Plan Work

Minimum bar for v5:

1. Replace the mesh-visible SELECT "fleet lock" with a real cross-peer exclusion primitive, or explicitly remove fleet-wide safety claims.
2. Correct BullMQ enqueue and boot recovery around a real BullMQ job id.
3. Add durable cancellation state and repository-enforced terminal transitions.
4. Redesign egress confirmation as a server preflight + token/hash flow.
5. Make `drawer-backfill` estimates source-root based, not `memory_facts` based.
6. Fix `sourceRoot` containment checks with realpath roots and path-relative boundaries.
7. Remove boot-fatal rollout behavior for `MEMORY_OPS_SIGNING_SECRET`.
8. Remove or quarantine the `LITELLM_URL` fallback from UI-backed memory operations.
9. Update the web API core to preserve `details`.
10. Make Gemini catalog exposure contingent on a live model/dimension contract, or disable Gemini until verified.
11. Resolve the remaining P1/P2 contract gaps above before regenerating an implementation plan.

Until those are in the spec, v4 is still a candidate draft, not an implementation-ready design.
