# Memory Operations UI v3 Spec — Strict Review, Round 2

> **Target:** `docs/superpowers/specs/2026-04-24-memory-operations-ui-design-v3.md` @ commit `3a80223e`, branch `agent/claude-1/docs/memory-ops-ui-spec`, 937 lines.
> **Companions:**
> - Reviewer checklist (v2-era, 74 items): `docs/superpowers/reviews/2026-04-24-memory-operations-ui-v2-reviewer-checklist.md`
> - Verified facts (item 37 corrected in-place): `docs/superpowers/reviews/2026-04-24-memory-operations-ui-v2-verified-facts.md`
> - Prior round-3 v3 review (from Reviewer 1, 403 lines): `docs/superpowers/reviews/2026-04-24-memory-operations-ui-design-v2-strict-review.md` — **note:** this file is a review of v2, not v3. The author's description that Appendix C "maps round-3 P0s" is the v3 author's self-disposition.
> - My own prior round-3 review of v2 (454 lines): `docs/superpowers/reviews/2026-04-24-memory-operations-ui-design-v2-strict-review-round-2.md`
> **Anchor set:** fresh grep at `/Users/hahaschool/agentctl/.trees/memory-ops-spec` on 2026-04-24.
> **Mode:** adversarial, single pass, no sequels.

## Verdict

**Nearly there.** v3 is a surgical patch on v2 and it works: the advisory lock now commits to a real transaction with `pg_try_advisory_xact_lock` (§5.2); the audit logger moves to a dedicated local-only `memory_ops_audit` table instead of wedging into mesh-synced `agent_actions` (§10); the factory now returns `{client, model, dim}` and the invalidation bus has a named module (§7.3 / §7.3.1); mesh ownership switches to "every job runs on its origin peer" with `executor = origin` at insert (§5.2); `MODEL_MISMATCH` is server-enforced (§6.1 PATCH matrix); `CANCEL_ACCEPTED` is moved off the error envelope (§6.2 always 200 with `{status}`); `agents.ts` is added to the kind-filter list (§9); PR E's critical-path wording is corrected ("available via API with operator-set flag"); `tiktoken` math is un-inverted (§7.4); consolidation/synthesis `costUsd=0` is grounded in the real API (§7.4); `REMOTE_PEER_JOB`, `MODEL_MISMATCH`, `MIXED_MODEL_BLOCKED`, `INVALID_ACCOUNT_KIND`, `JOB_KIND_NOT_ENABLED` all land in §14; Appendix C maps every P0 from both round-3 reviewers to a § anchor. This is real work and the spine is now solid.

What keeps v3 out of `locked` is **four P0 bugs freshly introduced by v3** (rollback SQL misses `memory_ops_audit`; two sites return `PROVIDER_NOT_FOUND` on job 404; §13.2 JobCard disabled-logic contradicts §5.2's "each peer can run"; §15 integration test "ownership claim race" is stale against the new origin-only model), **four under-specified surfaces carried over from v2** (HMAC secret unset behaviour, PATCH doesn't accept `recentTestResult`, coverage-baseline is overloaded with perf numbers, invalidation bus subscription lifecycle), and **three documentation drifts** (Appendix C only traces P0s, "v1.2 removal" references a non-existent roadmap, the §19 risks table doesn't mention the new "origin offline → job stuck forever" failure mode the v3 ownership model introduces).

Fix the four P0s and I'd ship it. P1s can land with the plan if they're scheduled explicitly.

Everything below is in one pass, bucketed P0/P1/P2 with concrete fixes.

---

## §A — What v3 Got Right (keep these, they're real)

1. **Advisory lock actually works.** `pg_try_advisory_xact_lock(hashtext($lockKey)::bigint)` with explicit "all four steps in one Drizzle transaction" + `db.transaction()` precedent cite to `apply-change.ts:180`. Return-false → 409. This was the headline v2 bug; it is closed.
2. **Mesh ownership simplification** (§5.2): `executor_machine_id` set to `getMachineId()` at insert time; "every job runs on its origin peer" for v1. Claim UPDATE requires `executor_machine_id = $machineId` — losers abort. Clean. Avoids the cross-peer takeover races.
3. **Dedicated `memory_ops_audit` table** (§10) — local-only. Resolves my round-3 P0-4 (agent_actions constraints). PR A includes the migration + interface; PR B/D wire implementations. The interface settled on single `write(entry)` method; `test-succeeded` and `test-failed` are distinct actions.
4. **`memory_ops_jobs.sync_capture` trigger is column-scoped** (`AFTER INSERT OR UPDATE OF status, result, finished_at, error, error_code OR DELETE`). Progress updates stay local; 192×-per-backfill mesh spam is gone.
5. **Factory returns `{client, model, dim}`** (§7.3) — enables server-side `content_model = $queryModel` filter in `MemorySearch.vectorSearch` (§7.3.2). Mixed-model filter is the server's job now, not UI's.
6. **Invalidation bus has a real module** — `packages/control-plane/src/memory/provider-invalidation-bus.ts` (§7.3.1), single `provider.changed` event, listed in PR B Appendix A. No more magic.
7. **Factory cache + P99 acceptance** (§7.3 + §18) — module-level `Map<string, {resolved, expiresAt}>` with 60s TTL; invalidated on bus; P99 regression gate at 15% written into §18. The hot-path concern is acknowledged and bounded.
8. **Cost accounting matches real APIs** (§7.4) — `KnowledgeMaintenance.run` and `KnowledgeSynthesis.runSynthesis` don't accept an `EmbeddingClient` constructor arg, so `costUsd=0` for `consolidation`/`synthesis` in v1. Honest.
9. **`tiktoken` math corrected** — `Math.ceil(textLength / 4)`, not `* 4`.
10. **`agents.ts` kind-filter added** (§9) — the PATCH path at lines ~333-419 (verified: lines 331+ define `app.patch<{Params:{agentId:string}}; Body:{accountId?...}>`). Plus settings.ts, enumerated sessions.ts sites, oauth.ts, task-worker.ts, project_account_mappings.
11. **`/capabilities` endpoint + `ENABLED_JOB_KINDS`** (§6.2) — PR D ships empty, PR E expands to 2, PR G adds 2 more. Solves the "PR F renders Run buttons for kinds with no handler" gap.
12. **Error envelope consistent** (§14) — `CANCEL_ACCEPTED` removed; `MODEL_MISMATCH`, `REMOTE_PEER_JOB`, `MIXED_MODEL_BLOCKED`, `INVALID_ACCOUNT_KIND`, `JOB_KIND_NOT_ENABLED` added. 18 rows, all route-spec-aligned (except see P0-3 below).
13. **Migration 0033 single file; `memory_ops_audit` as 4th statement group** (§5.1/5.2/5.3/§10).
14. **PR C + PR F `minor` bumps; PR E `patch` with operator-set flag**; `MEMORY_OPS_ENABLED` defaults off until PR F flips. Rollout is honest.
15. **§9 runtime-filter sites enumerated with line numbers** that the plan writer can grep.
16. **Runbook uses real PM2 process names** (`agentctl-cp-beta`, `agentctl-cp-dev1`, `agentctl-cp-dev2` — all verified against `infra/pm2/ecosystem.*.config.cjs:8,37` etc.).
17. **`getMachineId()` helper cited explicitly** (§4): "Never read `process.env.MACHINE_ID` directly".
18. **`content_model` vs `embedding_model` both covered** in §8 including server-side enforcement on POST/PATCH.
19. **§17 re-embed-all warning**: "takes memory search offline FLEET-WIDE for minutes-to-hours" — explicit, correctly acknowledges mesh sync of `memory_facts`.
20. **Facts doc item 37 corrected in-place** (acknowledged at §9 footnote). No stale pointer to `/tmp/...`.

The rest is cost.

---

## §B — P0 Blockers (fix before the plan writer is dispatched)

### P0-1 — §5.5 migration rollback SQL is missing `DROP TABLE IF EXISTS memory_ops_audit`. The up migration adds four statement groups; the down migration drops three.

- §5.2/§5.3/§10 body: four statement groups in `0033_add_memory_ops.sql` (A: api_accounts ext; B: memory_ops_jobs; C: memory_ops_job_events; **D: memory_ops_audit** — new in v3 per §10).
- §5.5 rollback SQL, verbatim:
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
- No `DROP TABLE IF EXISTS memory_ops_audit`. No `DROP INDEX idx_memory_ops_audit_*`.
- v2 had no audit table; §5.5 was carried over unchanged when v3 added the audit table. Classic integration miss.
- Consequence: running the rollback SQL on a v3-migrated DB leaves a dangling `memory_ops_audit` table + its indexes. The next PR-A re-apply hits "table already exists" and fails.
- **Fix:** Prepend two lines:
  ```sql
  DROP INDEX IF EXISTS idx_memory_ops_audit_action_ts;
  DROP INDEX IF EXISTS idx_memory_ops_audit_target;
  DROP TABLE IF EXISTS memory_ops_audit;
  ```

### P0-2 — §6.2 job routes return `404 PROVIDER_NOT_FOUND` on missing job IDs. `PROVIDER_NOT_FOUND` is the wrong code; §14 has no `JOB_NOT_FOUND` entry.

- §6.2:
  ```
  GET    /:id                -> 200 | 404 PROVIDER_NOT_FOUND
  POST   /:id/cancel         -> ... 404 PROVIDER_NOT_FOUND
  ```
- These routes live at `/api/memory/ops/jobs/:id` — `/:id` is a job id, not a provider id. Using `PROVIDER_NOT_FOUND` is a straight copy-paste from §6.1 (`/api/memory/providers/:id`). The 404 body's `error` code must be `JOB_NOT_FOUND`.
- §14 error table has **`PROVIDER_NOT_FOUND | 404`** but no `JOB_NOT_FOUND`.
- Consequence: the web client's error-handling branches on `error` code. A user who clicks Cancel on a freshly-deleted job sees "provider not found" — misleading; a plan writer who implements §14 literally emits `PROVIDER_NOT_FOUND` on a job-level 404.
- **Fix:** Change both §6.2 lines to `404 JOB_NOT_FOUND`. Add `Job not found | 404 | JOB_NOT_FOUND` to §14.

### P0-3 — §13.2 JobCard disabled-logic contradicts §5.2's cross-peer semantics.

- §5.2 (authoritative v3 decision): "Cross-peer 'running' visibility is informational only — **a second peer CAN run a job of the same kind/scope** since each peer has its own queue and provider." And: "JobCard disables Run now when ... (c) a job of the same kind/scope is already running **locally**."
- §13.2 (carried from v2, contradicts §5.2): "Run now button disabled when: (a) **any job of that kind is running anywhere in the mesh** …"
- Two sources of truth on the exact same UX decision. §13.2 says "anywhere in the mesh"; §5.2 says "locally". The plan writer will have to guess, and §13.2 is in the UI section — that's the section closer to the component author.
- **Fix:** Change §13.2 bullet (a) to "any job of the same kind/scope is running **locally** on this machine (a second peer can still run its own)." Also update §18 acceptance to match if needed.

### P0-4 — §15 integration test "Ownership claim races: two CPs with different `MACHINE_ID` — only one wins" is invalid under v3's origin-only model.

- §5.2: "POST /jobs sets BOTH `origin_machine_id = getMachineId()` AND `executor_machine_id = getMachineId()` at insert time." Two CPs POST-ing for the same kind at the same instant each insert **their own row** with their own executor. Both succeed (advisory lock is per-CP, scoped to that CP's transaction). Neither "wins" — because there's no shared claim to win.
- §15 still lists: "Ownership claim races: two CPs with different `MACHINE_ID` — only one wins."
- That test passes only under v2's semantics (any peer can claim). Under v3, the test contradicts the spec — either the test is stale (should be removed) or §5.2 has quietly walked back from the "each peer can run" claim.
- **Fix:** Remove the test line OR rewrite to the actual v3 invariant: "Two CPs with different `MACHINE_ID` each POST a same-kind embedding-backfill; both succeed (each on its own origin); each runs on its local provider; a third CP without a provider returns `EMBEDDING_NO_PROVIDER`." Pick one and state it — the current line is self-contradicting with §5.2.

---

## §C — P1 Major Gaps

### P1-5 — PATCH `/:id` (rotate-key path) does not accept `recentTestResult`. After "edit + apiKey change + /test-ephemeral + Save", `metadata.last_test_ok` stays NULL → `<MissingEmbeddingAlert />` fires on the freshly-saved row.

- §13.1 explicit flow: "Edit mode + apiKey changed → Test calls `/test-ephemeral`." Save-after-test-ephemeral is a PATCH (not POST — the row already exists).
- §6.1 POST `/` request payload accepts `recentTestResult: {ok, dim, model, costUsd, signedToken, testedAt}` and merges into metadata.
- §6.1 PATCH `/:id` payload does NOT list `recentTestResult` as acceptable. PATCH field matrix only lists `apiKey`, `name`, `model`, `active=true`, `active=false`.
- Consequence: rotating a key via the dialog's test-ephemeral path writes new credential + resets metadata.last_test_ok to NULL. §13.3 alert fires on `last_test_ok === null`. User just tested successfully 3 seconds ago; alert still fires. Confusing.
- **Fix:** Add a 5th row to §6.1 PATCH field matrix: "`recentTestResult` | verify signedToken, merge into `metadata.last_test_{at,ok,error,model,cost_usd,dim}` same as POST /, set `updated_at=now()`; invalid/expired token → 422 `VALIDATION_ERROR` (preferred) OR ignore + return 200 with `warnings:['recent_test_result_unverified']` in body (pick one and state it)."

### P1-6 — `MEMORY_OPS_SIGNING_SECRET` env var is specified in Appendix A PR B, but the spec never states the unset-env fallback.

- §6.1 POST `/test-ephemeral`: "`signedToken = HMAC(secret, payloadHash)`". §6.1 POST `/` verifies. Appendix A PR B: ".env.example += `MEMORY_OPS_SIGNING_SECRET`".
- Unanswered: what happens if the env var is unset? Three plausible options:
  1. Boot fails — fail-closed, operator must set it before the `/test-ephemeral` route is registered.
  2. Generate at first boot, persist to `settings.memory_ops_signing_secret` jsonb value.
  3. Route returns 500 `SIGNING_SECRET_MISSING` on first `/test-ephemeral` call.
- My round-3 review P1-20 suggested option 2 with HMAC-SHA256 / 5-min TTL. v3 ignored the recommendation and didn't pick any.
- **Fix:** Pick option and state it in §6.1. If option 2, add the `settings` table write to Appendix A PR B. If option 1, add a boot-time check to `server.ts` and a §16 Rollout note.

### P1-7 — `docs/superpowers/specs/2026-04-24-memory-operations-ui-coverage-baseline.md` in §18 is overloaded to carry both test-coverage numbers and runtime P99 baselines.

- §18 acceptance: "Measurement recorded in PR E with the real baseline from a repo-committed `coverage-baseline.md` (PR B creates it)."
- §15 coverage goal: "match or exceed each package's existing coverage baseline".
- Two different baselines (unit-test coverage %, runtime P99 latency for `MemoryStore.addFact`) cannot both live in one document and stay useful. A coverage-baseline file is updated as tests change; a perf-baseline file is updated as hardware/load changes.
- **Fix:** Split the doc. `docs/superpowers/specs/2026-04-24-memory-operations-ui-coverage-baseline.md` holds coverage numbers; `docs/superpowers/specs/2026-04-24-memory-operations-ui-perf-baseline.md` holds the `addFact` P99 baseline + measurement methodology. List both in Appendix A PR B.

### P1-8 — §4 + §5.2 + §13.2 triangulate to disagreement on "can a second peer run the same kind concurrently?"

- §4: "all four job kinds share a single queue; at most one job runs **per CP** at any time."
- §5.2: "a second peer CAN run a job of the same kind/scope since **each peer has its own queue and provider**."
- §13.2 (the UI) disables Run when "any job of that kind is running **anywhere in the mesh**" (see P0-3).
- §4 + §5.2 agree: one CP has concurrency=1; different peers can run same-kind concurrently. §13.2 disagrees.
- P0-3 covers the §13.2 bug. P1-8 asks that §4 and §5.2 be harmonized once — say once: "Worker concurrency: each CP runs at most one memory-ops job at a time (global BullMQ `concurrency=1`). Different peers run independently; same-kind concurrent across peers is allowed."
- **Fix:** Pick one canonical paragraph (in §4) and link §5.2 / §13.2 back to it instead of restating.

### P1-9 — §7.3.2 mixed-model filter uses `content_model = $queryModel OR content_model IS NULL`, but `content_model` is `NOT NULL DEFAULT 'text-embedding-3-small'` (verified `drizzle/0010_add_memory_layer.sql:24`).

- The `IS NULL` branch is dead. Rows with `embedding IS NULL` still have a non-null `content_model` (the default).
- Consequence: the filter `content_model = $queryModel OR content_model IS NULL` is equivalent to `content_model = $queryModel`. The disjunction is confusing: a reader might think "the IS NULL case protects rows without embeddings"; it doesn't — those rows never match `content_model = X` either because their embedding column is NULL (vector similarity filters them out upstream).
- **Fix:** Drop the `OR content_model IS NULL` clause and clarify: "vectorSearch filters to `content_model = $queryModel`. `bm25Search` / `graphSearch` also filter to `content_model = $queryModel` when acting on rows that have an embedding; rows with `embedding IS NULL` are included regardless because model-equality is undefined there."

### P1-10 — §19 Risks table doesn't list the "origin peer offline → job stuck forever" failure mode v3 introduced.

- v3 §5.2 decision: every job runs on its origin peer. Cross-peer takeover is v1.1.
- Implication: if the origin peer (e.g., a laptop) is offline for an extended period with a job in `status='running'`, peer UIs see a stuck job. Operator has two options: wait for origin to boot (boot-reconciliation marks failed — §4), or manually SQL-UPDATE to failed.
- §17 Runbook has "Force-fail stuck running jobs" which requires stopping the worker first — but the worker is on the offline origin. Not reachable. Operator has to SQL-UPDATE directly from a peer while origin is offline.
- §19 Risks mentions "Worker crash during long backfill" (boot reconciliation) but not the "origin offline" scenario.
- **Fix:** Add a row to §19: `Origin peer offline for extended window → job stuck in running | Operator SQL: UPDATE memory_ops_jobs SET status='failed' WHERE executor_machine_id=$offlinePeer. Cross-peer takeover deferred to v1.1. Document in §17.` And add the corresponding runbook SQL.

### P1-11 — Intermediate `progress` updates for consolidation/synthesis don't reach peers; §18 acceptance silently assumes SSE is local-only.

- §5.2 column-scoped trigger excludes `progress`. §18 acceptance: "reports progress.embedded, progress.processed, progress.costUsd monotonically increasing". This is true locally (SSE on origin peer), but peer B's view of this mesh-synced row freezes at enqueue-time progress (all zeros) and only updates on terminal transition.
- §18 promises: "Peer mesh: provider created on A not visible on B (expected, documented). Job created on A → executor_machine_id=A; visible on B as read-only."
- "Visible as read-only" is misleading — peer B sees static 0-progress until completion. A user on B can't monitor a running job; they can only see that it's running.
- **Fix:** Add an explicit acceptance bullet: "Peer B read-only view shows `status`, `kind`, `executor_machine_id`, and the **final** `progress` snapshot at completion (not intermediate). SSE progress streaming is same-peer only."

### P1-12 — `<MissingEmbeddingAlert />` copy is unchanged for peer view-only use (my round-3 P1-22 not addressed).

- §13.3: "Renders when: `useQuery(memoryProvidersQuery())` returns empty…". Non-dismissible. Links to `/settings#memory-embeddings`.
- On peer B (which doesn't have a provider and doesn't need one because it's passively viewing origin A's jobs), the alert fires with "configure a provider" — wrong advice for passive browsing.
- §13.2 JobCard correctly shows read-only for peer-owned jobs; the alert doesn't. Message mismatch.
- **Fix:** Tweak copy: "No embedding provider configured on this machine. Configure one to run memory maintenance locally; you can still view jobs running on other peers." Or: suppress the alert on `/memory/operations` when at least one remote job is visible in the RecentJobsTable.

### P1-13 — `/test-ephemeral` invalid/expired `signedToken` behavior is still unspecified (my round-3 P1-23 not addressed).

- §6.1 POST `/`: "`recentTestResult: { ..., signedToken: ... }` … POST / can accept it to carry test result."
- What the server does when the token is invalid/expired is not defined. My round-3 review proposed two paths (ignore+warning vs 422); v3 picked neither.
- Consequence: the plan writer will invent one. If they pick "ignore silently", users who tested 10 minutes ago will save and have their last_test_ok stuck at NULL — right after a successful visible test.
- **Fix:** Pick. Recommended: 422 `VALIDATION_ERROR` with `hint='recent_test_result_invalid_or_expired'`. The dialog should detect TTL client-side and refresh the test before Save. State this flow in §13.1.

### P1-14 — Appendix C only traces P0s. Round-3 P1/P2 items are "absorbed in-prose; no outstanding deferrals", not auditable.

- Round-3 review (mine) had ~20 P1 items and 24 P2 items. Appendix C lists ~14 "highlights". The others are silent.
- A plan writer dispatched with "Appendix C = round-3 disposition log" has no way to verify whether my P1-22 / P1-23 / P1-26 (catalog-smoke ownership) were addressed. Two of them (P1-22 alert copy, P1-23 token invalidation) aren't addressed (see P1-12, P1-13 above).
- **Fix:** Expand Appendix C into two tables: P0 traceability (there today) and P1/P2 traceability (each item → §anchor or "deferred to v1.1" explicit). Not a content change — a visibility change so nothing slips silently.

### P1-15 — "scheduled for removal in v1.2" references a roadmap that doesn't exist in this spec.

- §7.3 resolution step 3: "LITELLM_URL fallback — legacy fallback, **scheduled for removal in v1.2**. A boot-time warning logs the deprecation."
- §3 Non-Goals references v1.1 for deferred features (crash-resume, prefix-scope, hash-chain audit). No v1.2 timeline exists.
- **Fix:** Either commit to a v1.2 roadmap item (state "v1.2 drops `LITELLM_URL` fallback entirely; tracked as …") or change to "deprecated, removal TBD in a future major bump".

### P1-16 — `sessions.ts:1597-1601` failover selection retains no `credential_kind` filter anywhere downstream; adding the filter changes failover semantics.

- Verified: `sessions.ts:1599-1601`:
  ```typescript
  .from(apiAccounts)
  .where(eq(apiAccounts.isActive, true))
  .orderBy(apiAccounts.priority);
  ```
- §9 says add `credential_kind='runtime'` filter. Good. But failover logic at lines 1604-1649 assumes **all returned rows are interchangeable** (round-robin, priority-based). Once embedding rows are excluded, nothing else changes — failover works correctly.
- However: `project_account_mappings` (listed in §9) might bind a specific `api_account` id. If that binding ever targeted an embedding row, the filter now blocks lookup with 422. Spec's data-migration acceptance bullet only says "surfaced in a diagnostic log line" — doesn't auto-unbind. Operator might not notice until a session fails to dispatch.
- **Fix:** Add a §9 sub-bullet explicit: "If any existing `agents.account_id` or `project_account_mappings.account_id` points at a row that would now be `credential_kind='embedding'` (shouldn't happen today — no embedding rows exist pre-PR-A — but defensive), the migration's post-check logs a WARN line with the offending IDs. Add a Playwright smoke test for the operator flow to fix the binding via `/settings`."

---

## §D — P2 Corrections

### P2-17 — §6.3 catalog Gemini row still shows `gemini-embedding-001` despite §6.3's own caveat that Google's OpenAI-compat example uses `gemini-embedding-2-preview`.

- §6.3 caveat: "Google's OpenAI-compat page example uses `gemini-embedding-2-preview`, not `gemini-embedding-001`."
- §6.3 catalog table uses `gemini-embedding-001`.
- Caveat then: "Must not merge PR A until this test passes against the live `gemini-embedding-001` endpoint." So the spec is betting the contract test will prove `gemini-embedding-001` works. If it fails, spec says fallback to `gemini-embedding-2-preview`. Reasonable.
- **Fix:** Add a PR A Acceptance note: "If `gemini-embedding-001` returns 3072-dim vectors or 404s through the `/v1beta/openai/embeddings` path, the catalog switches to `gemini-embedding-2-preview`. Record the live verification result in the PR A test file; do not merge with a stubbed assertion."

### P2-18 — §14 error table missing `JOB_NOT_FOUND` (see P0-2), `CATALOG_INVALID` (boot failure per §6.3), `INTERNAL_ERROR` (generic 500 — project-wide default).

- §14 is advertised as the canonical error map. Three codes are implicit but not listed.
- **Fix:** Add rows. `Job not found | 404 | JOB_NOT_FOUND`; `Catalog validator failure at boot | boot-fail | CATALOG_INVALID (not an HTTP response — crashes CP)`; `Generic unhandled error | 500 | INTERNAL_ERROR`.

### P2-19 — §10 `memory_ops_audit` has no `ip_address` or `user_agent`. For a single-operator local tool, fine; for any future fleet of operators, weak.

- **Fix:** Not required for v1. Add a §10 note: "v1.1 may extend with `ip` / `user_agent` when multi-operator auth lands."

### P2-20 — §14 `MIXED_MODEL_BLOCKED | 503`. 503 connotes "service unavailable"; this is more of a 409 "conflict with current data state" or 422 "semantic validation failure".

- 503 triggers browser-level retry semantics (Retry-After header, etc.). A mixed-model state persists until `re-embed-all` runs — not retriable in seconds. 503 is the wrong status.
- **Fix:** Change to 409 `MIXED_MODEL_BLOCKED` with `hint = JSON.stringify({majorityModel, minorityModel, majorityCount, minorityCount})`. Consistent with other "data-state conflict" 409s in the table.

### P2-21 — §15 integration test list includes "`memory_facts.embedding` ADD-equivalent lock check: no-embeddings state allows any provider." This test name is opaque.

- The test is for §8 lock behaviour. "ADD-equivalent" seems to refer to the batch UPDATE path.
- **Fix:** Rename: "`§8 lock empty-state bypass: with zero rows having `embedding IS NOT NULL`, POST /providers {active:true} with any catalog model succeeds (no MODEL_MISMATCH)."

### P2-22 — §17 "Orphan `credential_id` on peer" recovery instructions don't match v3 §5.2 (origin-only execution).

- §17: "UI labels it 'provider: not visible on this machine'; recovery: create a provider locally and POST a new job."
- Under v3 §5.2, "POST a new job" creates a new row with `origin_machine_id = localPeer` and `executor_machine_id = localPeer`. It does NOT "retry" the old orphan row — that row still exists, stuck in whatever status it had.
- The orphan row's `executor_machine_id` is the origin peer (that lost its provider). That peer can't run it either (provider gone). Row is zombified.
- **Fix:** Rewrite: "Recovery: (1) on the origin peer, create a new provider with the same catalog model and activate it; the stuck job's boot-reconciliation on next CP restart marks it failed. (2) If the origin peer is gone permanently, SQL-DELETE the orphan row. POST a new job on whichever peer will own it."

### P2-23 — `memory_ops_audit` retention is 90 days; `memory_ops_job_events` is 14 days. The disparity deserves a note.

- §10 says 90 days for audit; §5.3 says 14 days for events.
- **Fix:** Add a one-liner to §10 or §17: "Rationale: job events are verbose operational logs with known short usefulness; audit entries are compliance-relevant (provider rotation, job creation/cancel)."

### P2-24 — `metadata.last_test_model`, `last_test_cost_usd`, `last_test_dim` (referenced by Test button UX) never enumerated.

- §6.1 read shape shows `lastTestAt`, `lastTestOk`, `lastTestError`. §18 Acceptance uses `dim=1536, costUsd > 0, latencyMs > 0` for the Test response — those are response fields, not metadata. But persisted metadata should carry them (for `<MissingEmbeddingAlert />` state evaluation and UI display).
- My round-3 review P2-39 raised this. v3 ignored.
- **Fix:** Add to §6.1 read shape: `lastTestModel`, `lastTestCostUsd`, `lastTestDim`, `lastTestLatencyMs`.

### P2-25 — `MemoryOpsJob` TypeScript shape never defined in §6.3 (while `MemoryOpsJobParams` is).

- §6.2 POST returns `{job: MemoryOpsJob}`. §18 acceptance uses fields `executor_machine_id`, `origin_machine_id`, `egress_confirmed_at`, `error_code`. These must be in the `MemoryOpsJob` type.
- My round-3 review P2-40 raised this. v3 ignored.
- **Fix:** Add `MemoryOpsJob` shape to §6.3 with all DB-columns-as-camelCase fields.

### P2-26 — `concurrency=1` is declared (§4) but no BullMQ config snippet in spec or Appendix A.

- "At most one job per CP" depends on BullMQ worker config. Plan writer needs to know the setting: `new Worker(queueName, handler, { concurrency: 1 })`. Not shown.
- **Fix:** One-line snippet in §4 or PR E.

### P2-27 — §18 acceptance doesn't cover `JOB_KIND_NOT_ENABLED`.

- §14 adds the error code. §6.2 returns 400 for POST. PR D ships empty `ENABLED_JOB_KINDS`. No acceptance bullet asserts this.
- **Fix:** "POST /jobs with `kind='consolidation'` between PR E merge and PR G merge → 400 `JOB_KIND_NOT_ENABLED`."

### P2-28 — `MEMORY_OPS_MAX_FAIL_RATIO=0.05` in `.env.example` but no validation at boot (negative values? > 1?).

- §18 "ends `status='completed'` when `failed / total < 0.05`; else `status='failed'`". Env override to -1 silently makes every job pass.
- **Fix:** PR E adds a `validateFailRatioEnv()` helper; invalid → boot fails or defaults to 0.05 with WARN.

### P2-29 — `memory_ops_jobs.credential_id` is a `uuid` with no FK (because `api_accounts` is local-only). Orphan handling lives in §17 runbook; no DB check at query time.

- A worker that tries to resolve the credential may hit the factory's fallback to `LITELLM_URL` or throw `EMBEDDING_NO_PROVIDER`. Spec doesn't say which path runs when the job row has a specific `credential_id` that doesn't exist locally.
- **Fix:** §7.3 resolution order: "If `credentialId` provided but no matching row exists on this peer → throw `EMBEDDING_CREDENTIAL_NOT_FOUND`. Do NOT fall back to default row or LITELLM_URL — the operator explicitly bound this job to a specific credential."

### P2-30 — §13.4 mount table has Memory Dashboard = "Yes" but Dashboard is the overview/stats page. Whether a "no provider configured" alert is useful there is debatable.

- Debate is minor; spec made a call.
- **Fix:** Accept as-is, or add §13.4 justification line: "Dashboard shows fact counts by status; `<MissingEmbeddingAlert />` provides the 'why are my counts static' context."

### P2-31 — `sessionStorage['memory-ops-egress-ack:<credentialId>']` format specified (§6.2) but TTL undefined. If `sessionStorage` is used, it clears on tab close; "session" is naturally scoped. OK.

- **Fix:** Add a one-liner: "TTL = browser tab lifetime; `sessionStorage` does not persist past tab close. Server-side `egress_confirmed_at` is the durable record."

### P2-32 — `validateCatalog()` failure (§6.3) still unspecified (crash vs warn).

- My round-3 P2-34 raised this. v3 didn't address.
- **Fix:** "Fail-closed: thrown error crashes CP boot. Operators see a `CATALOG_INVALID` log. Fix by correcting the catalog constant and redeploying."

### P2-33 — `priority` column on `api_accounts` is used for runtime failover (§6.1 GET `/` orders by `is_active DESC, priority ASC, created_at ASC`) but embedding rows only have one active row — `priority` is essentially unused for memory-providers.

- Cosmetic.
- **Fix:** §6.1 note: "`priority` is retained on the embedding-kind row for schema uniformity; v1 only permits one active row so priority is unused for memory-providers selection."

### P2-34 — §17 runbook's "For finer control" env-flag paragraph: "Restart is required for env vars to take effect; mid-flight jobs are interrupted and marked `CP_RESTART_DURING_RUN`".

- This is exactly equivalent to `pm2 stop`. My round-3 P1-13 pointed out the redundancy. v3 kept both as-is.
- **Fix:** Acceptable — the flag "pause new enqueues" semantic is still useful IF the worker finishes current job before restart. But that's not the case (restart interrupts). Either (a) merge the two paragraphs: "Both commands have identical effect; use whichever is more convenient.", or (b) add graceful-shutdown behavior where the worker finishes the current batch before exit (v1.1).

### P2-35 — Appendix A PR B adds `.env.example += MEMORY_OPS_SIGNING_SECRET`. Unless the fallback-on-unset is specified (P1-6), this is user-configurable but the required value generation is opaque.

- **Fix:** Add to `.env.example` with a comment showing how to generate: `MEMORY_OPS_SIGNING_SECRET=  # 256-bit random hex, generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — same pattern as existing `CREDENTIAL_ENCRYPTION_KEY` (verified `server.ts:836-842`).

### P2-36 — Gemini `output_dimensionality` unverified; §6.3 caveats it then enforces in catalog. Acceptable per PR A contract test.

- **Fix:** None beyond what's in §6.3. Ensure the PR A contract test's expected body includes the field.

### P2-37 — `eventId` bigserial and `jobs.id` uuid types mixed — OK per Drizzle but UI display of event_id may surprise users.

- Cosmetic.

### P2-38 — `memory_ops_audit` has no `deleted_provider_id` or similar for DELETE events. After a provider is DELETEd, the audit entry's `target` is the provider_id but the row no longer exists. Cross-referencing to a nonexistent provider UUID is the intended "trail". OK.

### P2-39 — Round-3 Appendix C "R2 round-3 P0 #7 settings.ts kind filter + facts doc item 37 wrong" — v3 §9 footnote says "facts doc item 37 was wrong and is now corrected in the reviews directory". **Not verified by reading the facts doc.**

- My round-3 review cited line `settings.ts:82` as selecting from apiAccounts; live grep in this review re-verifies `settings.ts:81-83`.
- Whether the verified-facts doc was actually edited: not checked in this review. If the facts doc still says "NOT FOUND", downstream consumers get the wrong impression.
- **Fix:** Verify the facts doc in `docs/superpowers/reviews/` was in fact updated; spot-check item 37.

### P2-40 — Appendix A PR A lists `Gemini URL contract test must pass before merge`. This is a gate that PR-A-reviewer must enforce. Put it in §16 rollout column too for visibility.

- **Fix:** §16 PR A row's "Bump" column shouldn't hide the gate. Add a column or a footnote: "PR A cannot merge until `gemini-embeddings.contract.test.ts` passes."

### P2-41 — §15 integration tests: "Ownership claim races" (P0-4) + "Partial unique index fires under concurrent active-inserts" — the former is wrong (see P0-4); the latter is right. Just listing to reinforce.

### P2-42 — `memory_ops_jobs.created_by` was in v2, removed from v3 in favor of `egress_confirmed_by`. Confusingly, `egress_confirmed_by` is populated ONLY on egressing kinds (embedding-backfill, drawer-backfill). For `consolidation` / `synthesis`, `egress_confirmed_by` stays NULL. UI audit trail for "who ran this consolidation" relies on `memory_ops_audit` instead. OK but worth noting.

- **Fix:** One-line note in §5.2: "`egress_confirmed_by` is populated only for egressing kinds. For consolidation/synthesis provenance, query `memory_ops_audit` where `action='job.create' AND target=<job_id>`."

### P2-43 — §13.2 "Peer-owned jobs render read-only (no Cancel)" — but §6.2 spec 403 `REMOTE_PEER_JOB` for direct API cancel on remote jobs. UI behavior matches. ✓ Just confirming alignment.

### P2-44 — §15 required e2e #2 Gemini journey: "stubbed at `https://generativelanguage.googleapis.com/v1beta/openai/embeddings`. Asserts `output_dimensionality:1536` in body." — BUT §6.3 catalog `embeddingsPath='/embeddings'` and `baseUrl='https://generativelanguage.googleapis.com/v1beta/openai'` — the final URL is `/v1beta/openai/embeddings` (no `/v1`). e2e asserts the right URL. ✓ Consistent.

### P2-45 — `provider-invalidation-bus.ts` uses Node's EventEmitter singleton. If CP process restarts (crashes), all in-flight factory caches are lost — OK since the cache is also lost. But long-held SSE clients that were subscribed to memory-ops events via the bus (if any) would also be disconnected. Spec doesn't subscribe SSE to the bus (it uses pg_notify), so this is moot.

- No fix needed; noting for the plan writer.

### P2-46 — `MEMORY_OPS_CATALOG_SMOKE=1` smoke probe (§19) has an owner now (PR G, per §16 rollout). Verified ✓.

---

## §E — Consolidated Pre-Plan Edits (24 items)

Before the plan writer is dispatched, v3 MUST address:

1. **P0-1** — Add `DROP TABLE IF EXISTS memory_ops_audit` (+ indexes) to §5.5 rollback SQL.
2. **P0-2** — Change §6.2 `404 PROVIDER_NOT_FOUND` → `404 JOB_NOT_FOUND`; add the code to §14.
3. **P0-3** — Rewrite §13.2 JobCard disabled bullet (a) to match §5.2 ("running locally", not "anywhere in the mesh").
4. **P0-4** — Remove or rewrite §15 "Ownership claim races" integration test; the v2 semantics it assumes were invalidated by v3's origin-only model.
5. **P1-5** — Extend §6.1 PATCH field matrix to accept `recentTestResult` so rotate-key flow can persist last-test metadata.
6. **P1-6** — Specify `MEMORY_OPS_SIGNING_SECRET` unset-env fallback.
7. **P1-7** — Split `coverage-baseline.md` and `perf-baseline.md`; list both in Appendix A PR B.
8. **P1-8** — Harmonize §4 / §5.2 / §13.2 on concurrency semantics (authoritative paragraph + cross-refs).
9. **P1-9** — Simplify the mixed-model filter to `content_model = $queryModel` only; drop dead `IS NULL` branch.
10. **P1-10** — Add "origin peer offline → job stuck" risk to §19 + SQL recovery in §17.
11. **P1-11** — Add acceptance bullet acknowledging peer progress is NOT streamed (only terminal status).
12. **P1-12** — Tweak `<MissingEmbeddingAlert />` copy for peer view-only use case.
13. **P1-13** — Specify `/test-ephemeral` invalid/expired signedToken server behavior (422 or ignore+warning).
14. **P1-14** — Expand Appendix C to include P1/P2 traceability, not only P0.
15. **P1-15** — Replace "scheduled for removal in v1.2" with either a real roadmap item or "TBD in a future major bump".
16. **P1-16** — Add §9 sub-bullet for data-migration warning on existing `agents.account_id` / `project_account_mappings.account_id` that would be affected by the kind filter.
17. **P2-17** — State the catalog fallback plan if the PR A Gemini contract test fails.
18. **P2-18** — Add `JOB_NOT_FOUND`, `CATALOG_INVALID`, `INTERNAL_ERROR` to §14.
19. **P2-20** — Change `MIXED_MODEL_BLOCKED` from 503 to 409.
20. **P2-21** — Rename the opaque §15 integration test to something descriptive.
21. **P2-22** — Rewrite §17 "Orphan credential_id" recovery to match v3's origin-only execution model.
22. **P2-24** — Enumerate `lastTestModel` / `lastTestCostUsd` / `lastTestDim` / `lastTestLatencyMs` in §6.1 read shape.
23. **P2-25** — Add `MemoryOpsJob` TypeScript shape to §6.3.
24. **P2-27 + P2-28 + P2-32 + P2-35 + P2-42** — Small acceptance bullets and `.env.example` comments; listed in §D.

---

## §F — Bottom Line

v3 is the best draft of this spec I've seen. The spine — advisory lock inside a real transaction, dedicated audit table, factory with a named invalidation bus, content_model filter pushed to the SQL layer, ENABLED_JOB_KINDS gate, runtime-kind filter expanded to every site that reads `api_accounts` including the previously-missed `agents.ts`, `minor` version bumps for user-visible PRs, tiktoken math un-inverted — is defensible. The surgical posture paid off; there's no v2-scale architectural risk left here.

But v3 shipped:
- a rollback script missing one DROP (P0-1);
- two 404 route responses citing the wrong code (P0-2);
- a UI section (§13.2) that says the opposite of the data-model section (§5.2) on a user-visible interaction (P0-3);
- an integration test whose premise contradicts v3's own ownership decision (P0-4).

These are four copy-paste / carry-over mistakes from v2 that weren't cleaned up. They're easy to fix — five line edits total. But they will each break something specific when the plan writer tries to execute:

- P0-1 → rollback fails on second invocation; dev-1 cleanup breaks.
- P0-2 → user-facing error shows the wrong semantic label.
- P0-3 → multi-peer testers see "my peer can't run what it's supposed to be able to run."
- P0-4 → PR A integration test fails; plan writer has to invent a passing test.

Close the four P0s and the P1 open-ended decisions (HMAC fallback, PATCH + recentTestResult, alert copy, token invalidation, coverage-vs-perf file split) and v3 is lock-ready. After that, the plan writer can execute without improvising.

---

## Appendix — Live codebase anchors used

| Claim | File:line |
|---|---|
| `agents.ts` PATCH accepts arbitrary `accountId` with no kind check | `packages/control-plane/src/api/routes/agents.ts:331+` |
| `sessions.ts` account-id sites (v3 §9) all verified | `packages/control-plane/src/api/routes/sessions.ts:597-598, 778-779, 991-992, 1168-1169, 1597-1601` |
| `settings.ts` selects from apiAccounts without kind filter | `packages/control-plane/src/api/routes/settings.ts:81-83` |
| PM2 process names in beta/dev1 configs | `infra/pm2/ecosystem.beta.config.cjs:37` (`agentctl-cp-beta`), `ecosystem.dev1.config.cjs:8` (`agentctl-cp-dev1`) |
| `SettingsSection` renders id as DOM id | `packages/web/src/views/settings/SettingsShell.tsx:69` — `id={id}` |
| `memory_facts.content_model` NOT NULL DEFAULT | `packages/control-plane/drizzle/0010_add_memory_layer.sql:24` |
| `memory_drawers.embedding_model` NOT NULL DEFAULT | `packages/control-plane/drizzle/0030_add_memory_drawers.sql:22` |
| `memory-search.ts` does not filter by content_model today | `packages/control-plane/src/memory/memory-search.ts:249, 293, 373` (SELECTs but no WHERE on content_model) |
| `agent_actions` is mesh-synced | `packages/shared/src/types/sync.ts:164` |
| `api_accounts` is local-only | `packages/shared/src/types/sync.ts:182` |
| Advisory-lock precedent inside transaction with `::bigint` | `packages/control-plane/src/sync/apply-change.ts:180` |
| `getMachineId()` canonical helper | `packages/control-plane/src/index.ts:242-244` |
| `tier-config.extractRedisDb` + test fixtures | `packages/control-plane/src/utils/tier-config.ts:99`; `tier-config.test.ts:84,123,139` |
| `CREDENTIAL_ENCRYPTION_KEY` guard pattern + generation hint | `packages/control-plane/src/api/server.ts:828-847` |
| Error envelope `{error, message}` in server.ts | `packages/control-plane/src/api/server.ts:937-962` |
| `ApiError(status, code, message, hint?)` | `packages/web/src/lib/api/core.ts:7-19, 21-44` |
| `queryOptions()` + call-site `useQuery()` pattern | `packages/web/src/lib/queries.ts:2, 190+`; `MemoryBrowserView.tsx:166` |
| 10 Memory views present | `ls packages/web/src/views/Memory*.tsx + ConsolidationBoardView.tsx + KnowledgeGraphView.tsx` |
| `MemorySidebar.tsx` with `MEMORY_NAV_ITEMS` (10 items) | `packages/web/src/components/memory/MemorySidebar.tsx:13-40` |
| `log-retention.ts` existing worker | `packages/control-plane/src/audit/log-retention.ts` |
| Playwright e2e dir | `packages/web/e2e/*.spec.ts` |
| `bullmq` dependency | `packages/control-plane/package.json:24` |
| `apiAccounts` table definition + existing columns | `packages/control-plane/src/db/schema.ts:443-454` |
| `agent_actions` schema (runId nullable) | `packages/control-plane/src/db/schema.ts:425-441` |
