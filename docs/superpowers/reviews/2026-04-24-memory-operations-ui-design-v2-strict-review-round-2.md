# Memory Operations UI v2 Spec — Strict Review, Round 2

> **Target:** `docs/superpowers/specs/2026-04-24-memory-operations-ui-design-v2.md` @ commit `7eaab6b0`, branch `agent/claude-1/docs/memory-ops-ui-spec`, 796 lines.
> **Companions reviewed:**
> - `docs/superpowers/reviews/2026-04-24-memory-operations-ui-v2-reviewer-checklist.md` (74-item disposition)
> - `docs/superpowers/reviews/2026-04-24-memory-operations-ui-v2-verified-facts.md` (38-item codebase scan)
> - `docs/superpowers/reviews/2026-04-24-memory-operations-ui-design-v2-strict-review.md` (prior round-1 reviewer, 403 lines)
> **Anchor set:** fresh grep against `/Users/hahaschool/agentctl/.trees/memory-ops-spec` on 2026-04-24.
> **Mode:** adversarial, single pass, no tail, no mercy.

## Verdict

**Close — but not yet.** v2 is the first draft where the spine is defensible: `api_accounts` stays local-only (§3); `memory_ops_job_events` is local-only and SSE is same-peer (§5.3); mesh ownership runs through `origin_machine_id` + `executor_machine_id` + a conditional-claim UPDATE (§5.2); `resolveEmbeddingClient` actually replaces the `LITELLM_URL` boot path for every memory runtime surface (§7.3); cost accounting really plumbs to all four kinds via a decorator (§7.4); the `content_model`/`embedding_model` lock gates on rows that actually have embeddings (§8); PR C + PR F are `minor`; egress ack is server-enforced (§6.2); Playwright paths are right; `ConsolidationBoardView.tsx` is mounted (§13.4). The 74-item checklist was worked rigorously — I tried to find a skipped P0 and could not.

What keeps v2 out of "locked" is **six P0 bugs introduced by the v2 rewrite itself**, **four unresolved internal contradictions** between §6.1 / §6.2 / §8 / §14, and **one factually-wrong entry in the companion verified-facts doc** (item 37 contradicts live code at `settings.ts:82`). Fix those and the spec is ready for the plan writer. Ship as-is and the plan writer will either silently invent glue (advisory lock, invalidation bus, `agent_actions` writer path) or copy the bugs forward.

Everything below is single-pass, bucketed P0/P1/P2, each item with a concrete fix. Items already resolved are acknowledged in §A and not reopened.

---

## §A — What v2 Got Right (keep these)

1. **Mesh ownership.** `origin_machine_id NOT NULL` + `executor_machine_id text` + conditional-claim UPDATE (§5.2) is the right answer for "one peer creates, any peer can claim". Closes R1b P0#7.
2. **Events local-only (§5.3).** Dropping mesh-sync on `memory_ops_job_events` kills the bigserial cross-peer replay incoherence from the v1 review with zero downside; single CP per machine is the actual operational shape.
3. **Advisory lock now cites the `::bigint`-cast precedent** from `apply-change.ts:180`. See **P0-1** — the *surrounding code* still needs work.
4. **Provider config wired to memory runtime (§7.3).** The single biggest v1 gap: `MemorySearch`, `MemoryStore.addFact`, `memory-drawer-store` all move off `LITELLM_URL`. This is the feature.
5. **`content_model` lock predicated on actual embedded rows (§8).** Empty DB allows any provider; mixed-model state gets a banner + filter-by-majority. Addresses R1b P0#4 and R2b P2-46.
6. **Drawer `embedding_model` covered (§8).** Not the same column as `memory_facts.content_model`; v2 acknowledges both.
7. **`memory_facts.id text` fix.** `AS x(id text, embedding text)` matches the verified `memory-store.ts:103-109` id-generation pattern.
8. **Egress server-enforced (§6.2).** `egressConfirmed: true` + `egress_confirmed_at` makes curl-bypass impossible.
9. **Error envelope flat (§14).** Matches `server.ts:937-962` + `web/src/lib/api/core.ts:21-44`. Zero frontend migration.
10. **`MEMORY_OPS_ENABLED` feature flag (§6.2).** Route-level gate on POST only; reads stay open.
11. **Migration 0033 is one file + rollback script.** Closes R2b P0-2 / P1-31.
12. **Column-scoped trigger** on `UPDATE OF status, result, finished_at, error, error_code` stops the 192×-per-backfill mesh spam.
13. **Runbook `pm2 stop`** replaces the invented `pnpm queue:pause`.
14. **`sessionStorage` egress-ack key format** specified (§13.1 / §6.2).
15. **Deferrals named** (§3): hash-chain audit, crash-resumable workers, facts-content sanitization, prefix scope matching. Honest.
16. **All 10 Memory views enumerated in §13.4.** `ConsolidationBoardView.tsx` is there.

The rest is cost.

---

## §B — P0 Blockers (fix before the plan writer touches this)

### P0-1 — The advisory-lock snippet in §5.2 / §6.2 is not inside a transaction, so the lock releases immediately.

- §5.2 code block:
  ```typescript
  await pool.query(
    `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
    [lockKey],
  );
  ```
- `pg_advisory_xact_lock` is released **when the current transaction ends**. A bare `pool.query(...)` runs in implicit autocommit — the transaction ends the instant the statement returns, so the lock is released before the next SQL statement (the INSERT into `memory_ops_jobs`) runs. The guarantee "prevents same-instant duplicate enqueues" is false with this code.
- The precedent cited (verified `packages/control-plane/src/sync/apply-change.ts:180`) is `await tx.execute(sql\`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)\`)` — **inside** a Drizzle `db.transaction(...)` block. Spec copied the SQL but not the transactional context.
- **Fix:** Wrap with an explicit transaction:
  ```typescript
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);
    // existence-check + insert within same tx
  });
  ```
  Update §5.2 snippet and §6.2 "Advisory lock at enqueue" paragraph. Cite `apply-change.ts:180` as the correct *surrounding* idiom, not just the SQL line.

### P0-2 — §14 lists `202 CANCEL_ACCEPTED` as an error-code row, but the envelope is for errors and 202 is a success status.

- §6.2: `POST /:id/cancel -> 200 { job } | 202 CANCEL_ACCEPTED | 409 JOB_NOT_CANCELLABLE`.
- §14 table: `Cancel already in progress | 202 | CANCEL_ACCEPTED`.
- §14's envelope is `{ "error": "STABLE_CODE", "message": "...", "hint": "..." }` — an *error* shape. Applied to a 202, the body ships `error: "CANCEL_ACCEPTED"` on a success — the web client `ApiError` throws on `!res.ok` but `res.ok` is true for 202, so the JSON body is parsed as success yet contains an `error` field. Ambiguous and at odds with `core.ts:7-19`.
- **Fix:** Either drop `CANCEL_ACCEPTED` from §14 and define the 202 response as `{ status: 'cancelling', job }`, or change §6.2 cancel to always return 200 with `status: 'cancelling'` when an in-flight cancel is already running. Pick one shape. Do not emit `{error}` on 2xx.

### P0-3 — §14 lists `MODEL_MISMATCH` (409) and `REMOTE_PEER_JOB` (403), but neither appears in the §6.1 / §6.2 route contracts.

- §14:
  - `New provider model != existing content_model | 409 | MODEL_MISMATCH`
  - `Job exists but originates from another peer | 403 | REMOTE_PEER_JOB (for cancel attempts)`
- §6.1 POST / and PATCH `/:id` list 201 / 200 / 422 / 409 `DUPLICATE_ACTIVE_EMBEDDING` / 409 `PROVIDER_HAS_ACTIVE_JOBS`. **No `MODEL_MISMATCH`** — yet §8 says "new provider must have `model = X`, else UI blocks save with `MODEL_MISMATCH` error". The server must be the enforcer (UI is bypassable via curl).
- §6.2 cancel route lists 200 / 202 / 409. **No 403 `REMOTE_PEER_JOB`** — when does it fire?
- **Fix:** Add the missing responses to §6.1 POST / PATCH (`MODEL_MISMATCH` for model-change-while-embedded) and §6.2 cancel (`REMOTE_PEER_JOB` when `executor_machine_id != local`). Error table and route contracts must agree. Also: POST `/test-ephemeral` and POST `/providers` need a content-model precheck, not just the UI check.

### P0-4 — §10 says audit-logger "writes to the existing `agent_actions` table" but never reconciles three constraints: `run_id` FK nullability, mesh sync of `agent_actions`, and the public write helper's signature.

- Live schema at `packages/control-plane/src/db/schema.ts:425-441`:
  ```typescript
  runId: uuid('run_id').references(() => agentRuns.id),
  actionType: text('action_type').notNull(),
  toolName: text('tool_name'),
  toolInput: jsonb('tool_input'),
  syncId: uuid('sync_id').defaultRandom(),
  ```
  `runId` is nullable (no `.notNull()`), so NULL is legal.
- But `agent_actions` is mesh-synced (`sync.ts:164` — `agent_actions: 'append-only'` with `sync_id` PK). Every `memory-ops` audit row propagates to every peer. `actor=local:hostname` traverses the fleet.
- And the existing public writer is `POST /api/audit/actions` → `dbRegistry.insertActions(runId: string, actions)` (verified-facts doc item 24) — `runId` typed as `string`, not `string | null`. Can't use the existing helper for provider-CRUD events.
- v2 §10 says `action_type=entry.action, tool_name='memory-ops', tool_input={ target, context, actor }` but doesn't choose (a) direct Drizzle insert with `runId=NULL`, (b) synthetic runId, or (c) dedicated `memory_ops_audit` table.
- **Fix:** Pick one:
  1. Direct Drizzle insert into `agent_actions` with `runId: null`. Add a test asserting the insert succeeds; acknowledge in §3 Non-Goals / §10 that audit mesh-syncs.
  2. Add a `memory_ops_audit` table in PR A (one more statement group in 0033, simpler semantics, avoids cross-contamination with agent-run audit).
  3. Extend `agent_actions` schema with a `category` column (migration change; bigger blast radius).

### P0-5 — §7.3 introduces an "in-memory invalidation bus" but never names a module, never lists a file in Appendix A, and never specifies the publish/subscribe surface.

- §7.3 paragraph: "Cache at request/job level; re-resolve on `api_accounts` change notification (via an **in-memory invalidation bus** emitted on provider CRUD)."
- Appendix A PR B lists: `embedding-client-factory.ts`, `memory-providers.ts`, `audit-logger.ts`, + edits to memory-search / store / drawer-store / server / index. **Zero invalidation-bus module.**
- Unanswered:
  1. Where does the bus live (e.g., `memory/provider-invalidation-bus.ts`)?
  2. What events and payloads?
  3. How does long-lived state (`MemorySearch` constructed once at boot per `index.ts:391-396`) subscribe?
- Without this, "every consumer calls the lazy accessor" is magic.
- **Fix:** Add §7.3.1: an `EventEmitter` singleton in `memory/provider-invalidation-bus.ts` with event `provider.changed` (payload: `{ credentialId?, deletedId? }`). `memoryProvidersRoutes` emits after every successful write. The factory's in-memory cache subscribes and invalidates keyed entries. Subscribers of long-lived state either hold the factory (not a client) or re-read on each request. List the new file in PR B's Appendix A.

### P0-6 — §7.3 makes `MemoryStore.addFact` resolve the provider per write. Every fact write now costs a DB roundtrip + AES-GCM decrypt. The cost is never acknowledged.

- Current code (verified `memory-store.ts:204-227`): `addFact` uses the injected `embeddingClient` or falls back. The client is injected once at CP boot (`index.ts:385-389`).
- §7.3: "replace the injected `embeddingClient` with a `() => resolveEmbeddingClient(...)` getter". `resolveEmbeddingClient` hits the DB (SELECT from `api_accounts` filtered by `credential_kind='embedding' AND is_active=true`) and runs `decryptCredential` (aes-256-gcm).
- A P50 fact write today embeds inline; sessions write thousands of facts per agent lifetime. Adding a SELECT + AES-GCM decrypt per `addFact` call is a real perf change on the hottest path.
- "Cache at request/job level" is the right idea but not specified. Request-level means Fastify request-scope — doable but not described. Job-level applies to backfill only. `MemoryStore.addFact` is neither — it's called from `sessions.ts`, `task-worker.ts`, `memory-eval.ts`, `memory-injector.ts`.
- **Fix:** Specify the cache explicitly. Module-level `Map<credentialId, { client, expiresAt }>` with 60s TTL, invalidated by the bus from P0-5. Document: cold read ≈ 1 DB query + ~200µs decrypt; warm read is in-process. Add an acceptance bullet: "`addFact` P99 under 19k-fact backfill does not regress > 15% vs baseline."

### P0-7 — `settings.ts` kind-filter listed in §9 is needed — but the companion verified-facts doc says it isn't. One of them is wrong, and the plan writer will follow whichever is closer at hand.

- Spec §9 lists: `packages/control-plane/src/api/routes/settings.ts:79-88 (validates default_account_id — must fail 422 if target row is credential_kind='embedding').`
- Live grep: `settings.ts:5` imports `apiAccounts`; `settings.ts:81-83`:
  ```typescript
  const [account] = await db
    .select({ id: apiAccounts.id })
    .from(apiAccounts)
    .where(eq(apiAccounts.id, defaultAccountId));
  ```
  No `credential_kind` filter. A user could bind an embedding row as their *runtime* `default_account_id`, which cascades to `task-worker.ts` and `sessions.ts` runtime dispatch. Exactly the contamination R1b P0#2 warned about.
- But `2026-04-24-memory-operations-ui-v2-verified-facts.md` item 37 says:
  > **settings.ts & api_accounts Reading — NOT FOUND. No explicit api_accounts reads found. Caller must verify manually.**
- **The verified-facts doc is factually wrong on item 37.** A plan writer trusting it will skip the filter in settings.ts, and runtime contamination ships in PR A.
- **Fix:** Correct item 37 in the facts doc to reflect reality. Add an acceptance test asserting `POST /api/settings` with `default_account_id` pointing at an embedding row returns 422. Add `INVALID_ACCOUNT_KIND` to §14 if distinct from generic `VALIDATION_ERROR`.

---

## §C — P1: Major gaps that will bite the plan writer

### P1-8 — `tiktoken` heuristic math is backwards in §7.4.

- §7.4: "fall back to a tiktoken estimate (**4 tokens per char** heuristic)".
- Standard heuristic: **4 characters per token** (OpenAI's own rule). `tokens ≈ chars / 4`, not `chars * 4`. Inverted math overstates cost 16×.
- Also: spec says "tiktoken estimate" but neither `tiktoken` nor `js-tiktoken` is in Appendix A dependencies. If we're using a character heuristic, don't invoke the package name.
- **Fix:** "≈ 4 characters per token; `estimatedTokens = Math.ceil(textLength / 4)`. No runtime tiktoken dependency in v1; plan to add for accuracy in v1.1."

### P1-9 — `409 DUPLICATE_ACTIVE_EMBEDDING` and `409 PROVIDER_HAS_ACTIVE_JOBS` share a status but have different payloads.

- Per §14 both are 409; §6.1 POST / emits the former (on SQLSTATE 23505), PATCH emits either. Flat envelope's `hint` is the only disambiguator.
- **Fix:** Specify in §6.1: "Both 409 codes ship distinct `hint` payloads: `hint=<constraint_name>` for `DUPLICATE_ACTIVE_EMBEDDING`; `hint=JSON.stringify({blockingJobIds})` for `PROVIDER_HAS_ACTIVE_JOBS`." Add acceptance tests differentiating.

### P1-10 — §18 acceptance "Migration 0033 on a populated `api_accounts` (19k facts pre-existing)" conflates two tables.

- The 19,226 count is `memory_facts.embedding IS NULL` (§1). `api_accounts` is the small credentials table.
- **Fix:** Rewrite: "Migration 0033 on an `api_accounts` table with existing runtime rows completes; every row ends `credential_kind='runtime'`; partial unique index does not fire on runtime rows." Add a second bullet: "Migration 0033 on a populated `memory_facts` (19k rows with NULL embeddings) does not touch that table."

### P1-11 — §8 "MIXED_MODEL_SEARCH fail-closed filter" has no error code in §14, no implementation anchor, no tie-break rule.

- §8: "Search still functions but with a `mixed-models` fail-closed filter that restricts results to the majority model."
- Unanswered:
  1. Server-side change in `MemorySearch`? Which file? Not in Appendix A.
  2. Define "majority" on a 10,000 / 9,226 split with the active provider set to the minority's model. Filter to the active provider (user intent) or DB majority (ignore user)?
  3. Where is the UI banner? `<MissingEmbeddingAlert />` fires on no-provider or last-test-failed, not on mixed-models.
- **Fix:** Either (a) add `MixedModelsBanner` + `useQuery(memoryModelDistributionQuery())` to §13, mount alongside `<MissingEmbeddingAlert />` on the 8 views; or (b) drop "still functions" and say "mixed-model state emits `MIXED_MODEL_BLOCKED` on search until v1.1 re-embed-all". Pick one semantic.

### P1-12 — §16 rollout says PR E "unblocks 19k backfill via API" but simultaneously defaults `MEMORY_OPS_ENABLED=false`.

- With the flag off, `POST /api/memory/ops/jobs` returns 400 `FEATURE_DISABLED`. Nothing unblocks until an operator flips the flag.
- **Fix:** PR E row: "19k backfill **available** via API with operator-set `MEMORY_OPS_ENABLED=true`". PR F flips default to `true`.

### P1-13 — §17 runbook "set `MEMORY_OPS_ENABLED=false` and restart" is redundant with `pm2 stop`.

- Restart picks up the env var. Restart kills the in-process worker (same effect as `pm2 stop`). The env var blocks new enqueues **after** restart but mid-flight jobs still die.
- **Fix:** "To block new enqueues without stopping the API, set `MEMORY_OPS_ENABLED=false` (requires restart to take effect; mid-flight jobs are interrupted by the restart and marked `CP_RESTART_DURING_RUN` per §4 boot reconciliation)."

### P1-14 — §7.3 "retain `LITELLM_URL` as deprecated fallback only". Two code paths coexist at boot with no resolution order.

- Does the factory's cache fall back to `LITELLM_URL` when no provider row exists? Does the boot-time `embeddingClient` still exist? `index.ts` is listed as modified but the sequence is not described.
- **Fix:** Explicit resolution order: "If an active `credential_kind='embedding'` row exists, factory returns a decrypted client from that row; else if `LITELLM_URL` is set, returns a client pointing there (legacy); else throws `EMBEDDING_NO_PROVIDER`." Mark the fallback for removal in a later PR with a deprecation date.

### P1-15 — §6.1 PATCH field matrix: `model` change says "fails 409 if jobs running" but not `MODEL_MISMATCH` per §8.

- §8 lock must apply to PATCH model changes too, not just provider creation. Changing model on an active provider when embedded rows exist is semantically identical to configuring a new provider with a mismatched model.
- **Fix:** Extend the matrix row: "`model` → `MODEL_MISMATCH` if any `memory_facts.embedding IS NOT NULL` has a different `content_model`, else write + bump `updated_at`; `PROVIDER_HAS_ACTIVE_JOBS` if jobs running." Also: `model` field lives in `metadata.model` per §13.1, but §6.1 GET response shows `model` as top-level field. Pick one location; be consistent.

### P1-16 — §5.2 column-scoped trigger fires on `status, result, finished_at, error, error_code` only. `executor_machine_id` changes during claim, but the row's `status` also changes (queued→running), so the trigger still fires. v1 lifecycle OK.

But: a hypothetical retry-on-another-peer (`executor=A` → `executor=NULL`) with unchanged `status` wouldn't fire. v2 doesn't allow this, but the trigger's column list is under-documented.

- **Fix:** One-line comment in §5.2 after the trigger snippet: "Column list is sufficient because v1 always changes `executor_machine_id` alongside `status` (claim: queued→running; terminal: running→completed/failed/cancelled). Executor handoff on the same status is v1.1."

### P1-17 — §4 "beta=DB 0, dev-1=DB 1, dev-2=DB 2 per memory rule 9" cites the author's private memory. Not usable by the plan writer.

- "Memory rule 9" is a `~/.claude/.../memory/MEMORY.md` pointer; not a project fact. Live verification: `tier-config.ts:99` derives `redisDb` from the per-tier `REDIS_URL`.
- **Fix:** Rewrite: "BullMQ queue is namespaced per Redis DB. The per-tier `REDIS_URL` encodes the DB number (see `packages/control-plane/src/utils/tier-config.ts:99` `extractRedisDb` and `tier-config.test.ts:84,123,139`). Current layout: beta → DB 0, dev-1 → DB 1, dev-2 → DB 2, set via PM2 ecosystem configs."

### P1-18 — §18 "Configurable via env" for completion-threshold — no env var name given.

- Checklist item 72 says "configurable" but v2 spec body doesn't name the var.
- **Fix:** Add `MEMORY_OPS_MAX_FAIL_RATIO=0.05` default; list in PR E's `.env.example` addition (which PR E doesn't currently modify; add to Appendix A).

### P1-19 — §17 "Re-embed all with new model" workaround is fleet-wide dangerous.

- `UPDATE memory_facts SET embedding = NULL WHERE content_model = '<old>'` mesh-syncs (per `sync.ts:178 — memory_facts: 'mutable'`). Every peer's search goes dark during the re-embed window (minutes to hours).
- **Fix:** Add a warning block in §17: "This workaround takes memory search offline fleet-wide for the duration of the re-embed (minutes to hours). Do not run during active usage. Consider fleet-wide `pm2 stop` during the window."

### P1-20 — `recentTestResult.signedToken` HMAC secret is not specified.

- §6.1 `POST /test-ephemeral` returns `signedToken`. `POST /` validates it. What key signs?
  - `CREDENTIAL_ENCRYPTION_KEY`? Re-using the AES key for HMAC is an anti-pattern.
  - A new `MEMORY_OPS_SIGNING_SECRET`? Not in Appendix A.
  - Something derived via HKDF?
- **Fix:** Specify: "Signing secret = `process.env.MEMORY_OPS_SIGNING_SECRET` (falls back to a first-boot random key persisted to `settings.memory_ops_signing_secret`; 256-bit HMAC-SHA256, 5-min token TTL)." List the setting write in PR B and the env var in `.env.example`.

### P1-21 — §18 "SSE reconnect with `Last-Event-Id: N` on the same peer" — same-peer constraint is never enforced on the wire.

- Client stores `Last-Event-Id` in browser memory. If the user resumes on a different device (rare but possible), client reconnects to a different CP with a stale Last-Event-Id. Event_id sequences are local bigserials.
- **Fix:** Include a peer identity in the SSE initial event: `event: peer\ndata: {"machineId": "macmini", "eventSequenceStart": 1234}`. Client persists `(peerId, lastEventId)`; on mismatched peerId, resets Last-Event-Id to 0. Document in §6.2.

### P1-22 — `<MissingEmbeddingAlert />` + view-only mode on peers without providers.

- Per §13.2, JobCard disables when local lacks a provider. §13.3 alert fires on no-provider. Peer B without a provider, wanting to view jobs owned by peer A, sees "configure a provider" — wrong advice for passive browsing.
- **Fix:** Tweak alert copy: "Configure a provider to run memory maintenance on this machine. You can still view jobs running on other peers." Or: suppress the alert on `/memory/operations` when at least one remote job is visible.

### P1-23 — Invalid/expired `recentTestResult.signedToken` handling is unspecified.

- §13.1 says Save includes `recentTestResult`. §6.1 POST response shows success. On bad token, does the server ignore the field (write NULL metadata → alert fires) or reject (422)? Pick one.
- **Fix:** "Invalid or expired `recentTestResult.signedToken` → server ignores the payload, writes the provider row with `last_test_ok=null`, and returns 201 with `warnings: ['recent_test_result_unverified']`. Client dialog refuses to submit stale tokens (refresh test)." Alternatively: 422. Pick.

### P1-24 — `executor_machine_id` source: §5.2 says `process.env.MACHINE_ID`; live code uses `getMachineId()` helper.

- Verified: `packages/control-plane/src/index.ts:242-244` — `const machineId = getMachineId();`. Helper consults `MACHINE_ID` env + hostname fallback already.
- **Fix:** Use the existing helper: "origin_machine_id = `getMachineId()` (see `packages/control-plane/src/index.ts:242-244`)".

### P1-25 — `MemoryOpsAuditLogger` interface: §10 says single `write(entry)`; checklist #28 says `writeProviderEvent` + `writeJobEvent`.

- Two different designs. Spec and checklist disagree.
- **Fix:** Pick one. Single `write(entry)` with discriminated `action` enum is simpler; two-method is more type-safe. Either works — reconcile. Then define `MemoryOpsAuditEntry` shape explicitly: §10 says "{actor, action, target, context, timestamp}"; checklist says "{actor, action, target, timestamp}". Drop or keep `context`.

### P1-26 — `MEMORY_OPS_CATALOG_SMOKE=1` risk-register smoke test has no home.

- §19 Risks mentions it without a file, a PR, or a schedule.
- **Fix:** Assign to PR G as a CP boot-time optional probe (file: `packages/control-plane/src/memory/ops/catalog-smoke.ts`), or drop it.

### P1-27 — Gemini URL dispute. v2 picks `/v1beta/openai/embeddings`; verified-facts item 7 says "NOT FETCHED — Google docs not accessible via WebFetch".

- Neither spec nor facts verifies against Google's real endpoint. The correct URL for Gemini's OpenAI-compat embeddings as of late 2025 is `POST https://generativelanguage.googleapis.com/v1beta/openai/embeddings` — which matches v2. But don't merge PR A without proving it.
- **Fix:** PR A writes a failing test first: hit the real endpoint with a dummy key, expect a specific 401 shape. Cite a Google doc URL in §6.3 as a footnote. Don't merge PR A with an unverified URL.

---

## §D — P2: Smaller but concrete corrections

### P2-28 — §16 "PR A+A+B can be reverted via the 0033-down SQL" — typo.

- "PR A+A+B" has a duplicate A. Likely "PR A+B" or "PR A, B".
- **Fix:** Typo.

### P2-29 — `INVALID_ACCOUNT_KIND` missing from §14 (see P0-7).

- If the settings.ts filter is added, failure code should be distinct from generic `VALIDATION_ERROR` so the frontend can emit a specific message.
- **Fix:** `POST /api/settings with embedding kind default_account_id | 422 | INVALID_ACCOUNT_KIND`.

### P2-30 — JobCard "Run now" disabled while kind is running anywhere in the mesh — but progress is not mesh-synced (column-scoped trigger). UI on peer B sees 0% until completion.

- §18 "visible on B as read-only" is misleading without clarifying progress-is-not-synced.
- **Fix:** Add to §18: "Peer read-only view shows job `status` and final `progress` snapshot at completion; intermediate progress updates are NOT mesh-synced (local-only for SSE)." Acceptance stays honest.

### P2-31 — `memory_ops_jobs.error text` has no length cap.

- §5.3 `memory_ops_job_events.message` has a 512-char cap. `memory_ops_jobs.error` doesn't, and it mesh-syncs.
- **Fix:** 2 KB soft cap on `error`; overflow stored in events table.

### P2-32 — §6.1 `GET /` ordering diverges from existing `accountRoutes`.

- Existing orders by `priority` (verified: `accounts.ts:89`). v2 orders by `is_active DESC, priority ASC, created_at ASC`.
- **Fix:** Call out the divergence. Acceptable (embedding has at most one active row; priority is mostly-unused for this surface).

### P2-33 — §18 "Test shows `dim=1536, costUsd > 0, latencyMs > 0`" — costUsd precision unspecified.

- A single-string embed cost is ~`0.02 * (4/1e6) ≈ 8e-8`. UI rendering needs 8 decimal places or scientific notation.
- **Fix:** §13.1 specifies formatting: "Cost rendering: ≥ $0.01 → dollars; $0.0001..$0.01 → cents; else scientific notation (e.g., `2e-8`)."

### P2-34 — `validateCatalog()` failure behaviour unspecified.

- §6.3 says it "throws otherwise" — does it crash CP? Or warn and continue with safe default?
- **Fix:** "Fail-closed: thrown error crashes CP boot. Operators see a `CATALOG_INVALID` log. Fix by correcting the catalog constant and redeploying."

### P2-35 — `recentTestResult.signedToken` stored in dialog state; lost on dialog close.

- Mildly annoying UX; worth one line.
- **Fix:** "Token is dialog-scoped; closing + reopening the dialog requires re-testing."

### P2-36 — §17 "re-embed all" operator dance should be v1.1 automation.

- Three manual steps: flag-on, nullify embeddings, run backfill.
- **Fix:** Promote to §3 Non-Goals: "One-click re-embed-all — v1.1 adds a dedicated `re-embed-all` job kind."

### P2-37 — Appendix A PR A lists settings.ts as modified (consistent with §9). Verified-facts item 37 is the only thing wrong (see P0-7).

### P2-38 — §15 "Match or exceed each package's existing coverage baseline" with no recorded baseline number.

- Plan writer can't know the target.
- **Fix:** Run `pnpm test:coverage` at head; write `docs/superpowers/specs/2026-04-24-memory-operations-ui-v2-coverage-baseline.md` alongside the spec. Reference it.

### P2-39 — `metadata.last_test_model` and `last_test_cost_usd` never enumerated.

- §6.1 read-shape shows `lastTestAt`, `lastTestOk`, `lastTestError` only. But §13.3 relies on more metadata keys. Snake_case vs camelCase drift in transport JSON.
- **Fix:** Enumerate all metadata keys: `last_test_at`, `last_test_ok`, `last_test_error`, `last_test_model`, `last_test_cost_usd`, `last_test_dim`. Pick snake_case on the wire (match DB JSON); camelCase in TS types is fine.

### P2-40 — `MemoryOpsJob` shape never defined.

- §6.2 returns `job: MemoryOpsJob`. UI shows executor, origin, egress — these must come from the payload. §6.3 defines `MemoryOpsJobParams` but not `MemoryOpsJob`.
- **Fix:** Define `MemoryOpsJob` alongside `MemoryOpsJobParams` in §6.3. Include `originMachineId`, `executorMachineId`, `egressConfirmedAt`, `egressConfirmedBy`, `errorCode`, `error`.

### P2-41 — §5.1 up-migration `ADD COLUMN NOT NULL DEFAULT` on a populated `api_accounts` is fine for a laptop-scale table, but if rows were being inserted during the ALTER, there'd be a brief window with `credential_kind=NULL`.

- Minor at laptop scale. A safer 3-statement pattern (ADD nullable → UPDATE → ALTER SET NOT NULL) is overkill for v1.
- **Fix:** Acknowledge in §5.1 notes or ignore.

### P2-42 — §18 "Real number recorded in PR E by dev-1 verification" — PR E is `patch`. User-visible benchmark belongs in PR G.

- Minor.

### P2-43 — §13.5 "`queryOptions` helpers; call-site `useQuery`". Good — verified-facts item 11 confirms `useMutation` is imported. PR C must add `useQuery` at the view level, not to `queries.ts`.

- **Fix:** §13.5 already says this; emphasize: "`queries.ts` gets `queryOptions()` helpers; `useQuery` is imported per-view at the call site (e.g., `MemoryEmbeddingsSection.tsx`, `ProviderDialog.tsx`)."

### P2-44 — Appendix B traceability should explicitly note that v2 collapsed v1's PR 0 into PR A.

- R1b P0#2 was "PR 0 filter before migration ships". v2 collapses them. Appendix B maps R1b P0#2 → §5.1 but doesn't say "PR 0 collapsed into PR A".
- **Fix:** "v2 collapses v1's PR 0 into PR A (schema + filter + client-additive together) to avoid v1's ordering hazard."

### P2-45 — `origin_machine_id text NOT NULL` admits typos / config drift. Machine id spelling must be consistent across peers.

- `getMachineId()` handles it. OK.

### P2-46 — §17 "retry the job" has no endpoint.

- There's no `POST /:id/retry` in §6.2. "Retry" = "POST a new job with the same params", not a first-class action.
- **Fix:** Clarify: "retry = `POST /` with the same params". Drop the word "retry" or add the endpoint.

### P2-47 — §16 rollback text is backwards.

- "Reverting PR E without PR F is safe iff `MEMORY_OPS_ENABLED=false` is set first." With PR F not yet shipped, default is `false`, so no flag action is needed. The iff is meaningful only after PR F.
- **Fix:** "Reverting PR E **after PR F ships**: set `MEMORY_OPS_ENABLED=false` first; drain queue; revert. **Before PR F**: PR E is trivially revertable (queue default off)."

### P2-48 — `.env.example` modifications owned by the wrong PRs.

- PR F lists `.env.example` for `MEMORY_OPS_ENABLED=true`. PR B needs the HMAC secret (P1-20). PR E needs the `MEMORY_OPS_ENABLED=false` initial default.
- **Fix:** Move `.env.example` modifications: PR B adds `MEMORY_OPS_SIGNING_SECRET`; PR E adds `MEMORY_OPS_ENABLED=false`; PR F flips to `true`.

### P2-49 — `actor` from client-supplied `X-AgentCTL-Actor` header is trivially forgeable. Acceptable for v1 single-operator tool.

- **Fix:** Add §10 note: "v1 trusts the `X-AgentCTL-Actor` header (no auth layer today). v1.1 promotes actor to an authenticated identity."

### P2-50 — Progress-update cadence for long `consolidation`/`synthesis` runs undefined.

- A 10-minute consolidation with thousands of embed calls: what's the cadence of `jobsRepository.updateProgress(...)`? Per-call would thrash SSE; per-minute misses update fidelity. Local-only writes don't mesh-sync (trigger excludes progress), but SSE needs them.
- **Fix:** "Worker calls `updateProgress(jobId, progress)` after every 10 embed calls OR every 5 seconds, whichever first. Write is local (trigger excludes progress); SSE picks it up via pg_notify → event row."

### P2-51 — §4 "One CP per tier, `concurrency=1` per kind per CP" contradicts checklist #74 "kinds don't run concurrently".

- Per-kind concurrency=1 means 4 concurrent jobs possible (one per kind). Checklist says global concurrency=1.
- **Fix:** Pick one. Simplest: "All kinds share one BullMQ queue with worker `concurrency=1`; at most one job runs per CP at any time."

---

## §E — Consolidated Required Pre-Plan Edits (28 items)

Before the plan writer is dispatched, v2 MUST address:

1. **P0-1** Advisory-lock SQL inside an explicit transaction.
2. **P0-2** `CANCEL_ACCEPTED` off the error table OR 200 + `status:'cancelling'`.
3. **P0-3** Add `MODEL_MISMATCH` to §6.1 and `REMOTE_PEER_JOB` to §6.2. Contracts and error table must agree.
4. **P0-4** Decide `agent_actions` write strategy: direct Drizzle with `runId=null`, or dedicated `memory_ops_audit` table. Own the mesh-sync consequence.
5. **P0-5** Define the invalidation-bus module. List in PR B Appendix A.
6. **P0-6** Specify factory cache (shape + TTL + invalidation). Add an `addFact` P99 perf acceptance.
7. **P0-7** Correct verified-facts item 37. Add `INVALID_ACCOUNT_KIND` to §14.
8. **P1-8** Fix the tiktoken math: 4 chars per token.
9. **P1-9** Disambiguate the two 409s via `hint` payloads.
10. **P1-10** Remove the `api_accounts` / 19k facts conflation in §18.
11. **P1-11** Define `MIXED_MODEL` behaviour concretely: banner vs error code, + tie-break.
12. **P1-12** PR E description: "available via API with operator-set flag".
13. **P1-13** Rewrite §17 "restart" paragraph to stop promising finer control than exists.
14. **P1-14** Explicit factory resolution order with LITELLM_URL; mark for removal.
15. **P1-15** PATCH `model` change triggers `MODEL_MISMATCH` when embeddings exist.
16. **P1-16** Note that column-scoped trigger is sufficient for v1 lifecycle only.
17. **P1-17** Replace the "memory rule 9" citation with `tier-config.ts:99`.
18. **P1-18** Name `MEMORY_OPS_MAX_FAIL_RATIO` + add to PR E `.env.example`.
19. **P1-19** Warn in §17 that re-embed-all takes search offline fleet-wide.
20. **P1-20** Specify HMAC signing key for `recentTestResult.signedToken`.
21. **P1-21** Add SSE `peer` initial event for safe same-peer reconnection.
22. **P1-22** Tweak alert copy for view-only peers.
23. **P1-23** Specify server-side invalid-token handling.
24. **P1-24** Use `getMachineId()` helper, not raw env.
25. **P1-25** Reconcile `MemoryOpsAuditLogger` interface shape (spec vs checklist).
26. **P1-26** Assign `MEMORY_OPS_CATALOG_SMOKE` to a PR + file, or drop it.
27. **P1-27** Add a failing-test-first Gemini URL verification in PR A.
28. Plus the P2 items in §D, especially P2-29, P2-35, P2-39, P2-40, P2-46, P2-50, P2-51.

---

## §F — Bottom Line

v2 is dramatically better than v1. The checklist was real work; the architectural pivots land — local-only events, mesh ownership via executor column, factory-based runtime rewiring, cost-tracker decorator for all four handlers, server-enforced egress, flat error envelope, correct Playwright paths, `minor` bumps where they belong.

But:

- **The advisory lock still doesn't work** because the snippet is outside a transaction.
- **Error table and route contracts disagree** on four codes.
- **Audit-logger target table** has constraints the spec hasn't reconciled (nullability, mesh sync, helper signature).
- **Invalidation bus** is invoked by name but never implemented.
- **Factory is called per-`addFact`** with no cost model, no cache spec, no perf acceptance.
- **Companion verified-facts doc is factually wrong** on `settings.ts`, and v2 relies on that doc.
- **`tiktoken` math** is backwards.

These aren't "the plan writer will figure it out". They're "the plan writer will either invent glue that compiles but doesn't hold, ship a silently slower hot path, or miss a contamination filter". Close each before dispatch.

After §E, v2 is lock-ready. Direction is sound.

---

## Appendix — Live codebase anchors used beyond the companion facts doc

| Claim | File:line |
|---|---|
| `settings.ts` reads `apiAccounts` without kind filter (contradicts verified-facts item 37) | `packages/control-plane/src/api/routes/settings.ts:5,81-83` |
| `agent_actions` schema: nullable `runId`, mesh-synced via `sync_id` | `packages/control-plane/src/db/schema.ts:425-441`, `packages/shared/src/types/sync.ts:164` |
| `getMachineId()` canonical source | `packages/control-plane/src/index.ts:242-244` |
| `tier-config.extractRedisDb` derives per-tier DB | `packages/control-plane/src/utils/tier-config.ts:99`, `tier-config.test.ts:84,123,139` |
| Advisory-lock precedent (inside transaction + `::bigint`) | `packages/control-plane/src/sync/apply-change.ts:180` |
| `apiAccounts` columns pre-migration | `packages/control-plane/src/db/schema.ts:443-454` |
| Error envelope flat `{error,message}` | `packages/control-plane/src/api/server.ts:937-962` |
| `ApiError(status, code, message, hint?)` | `packages/web/src/lib/api/core.ts:7-44` |
| `queryOptions()` pattern + call-site `useQuery()` | `packages/web/src/lib/queries.ts:2,190+`, `MemoryBrowserView.tsx:166` |
| 10 Memory views in `packages/web/src/views/` | verified via `ls` |
| `memory_facts.id text` | `packages/control-plane/drizzle/0010_add_memory_layer.sql:19`, `schema.ts:357` |
| `memory_facts.content_model` default | `drizzle/0010_add_memory_layer.sql:24`, `schema.ts:360` |
| `memory_drawers.embedding_model` default | `drizzle/0030_add_memory_drawers.sql:22`, `schema.ts:311` |
| `EmbeddingClient` URL suffix today | `packages/control-plane/src/memory/embedding-client.ts:64` |
| `LITELLM_URL` gates boot client | `packages/control-plane/src/index.ts:377-378` |
| `MemorySearch`/`MemoryStore` boot construction | `packages/control-plane/src/index.ts:385-396` |
| `MemoryStore.addFact` embed path | `packages/control-plane/src/memory/memory-store.ts:204-227` |
| `redactMemoryWriteMetadata` covers drawer metadata only | `packages/shared/src/memory/audit.ts:77-81`, `memory-drawer-store.ts:117` |
| `SettingsSection` props | `packages/web/src/views/settings/SettingsShell.tsx:56-82` |
| `SettingsView` nav array line range | `packages/web/src/views/SettingsView.tsx:26-67` |
| `sync_capture_change(pk_col)` trigger | `packages/control-plane/drizzle/0021_mesh_change_log.sql:70-100` |
| `TABLE_SYNC_CONFIG`/`TABLE_PK_COLUMN`/`SYNCED_TABLES` | `packages/shared/src/types/sync.ts:162-208` |
| `api_accounts` is local-only | `packages/shared/src/types/sync.ts:182` |
| `memory_facts: 'mutable'` (mesh-synced) | `packages/shared/src/types/sync.ts:178` |
| `bullmq` dependency | `packages/control-plane/package.json:24` |
| log-retention worker | `packages/control-plane/src/audit/log-retention.ts` |
| Playwright e2e dir | `packages/web/e2e/*.spec.ts` |
