# Combined Reviewer Checklist — v2 Spec Rewrite Target

Source:
- **R1a** = Reviewer 1, round 1 on v0 (`2026-04-24-memory-operations-ui-spec-plan-strict-review.md`)
- **R2a** = Reviewer 2, round 1 on v0 (`2026-04-24-memory-operations-ui-review.md`)
- **R1b** = Reviewer 1, round 2 on v1 (`2026-04-24-memory-operations-ui-design-v1-strict-review.md`)
- **R2b** = Reviewer 2, round 2 on v1 (`2026-04-24-memory-operations-ui-design-v1-strict-review-round-2.md`)

Only R1b + R2b items are open; R1a + R2a items are superseded by v1 and are either "still broken" (re-raised in R1b/R2b) or "landed clean" (skip).

Every item below gets a **v2 disposition**: (F) fix in spec, (D) defer to v2.1, (A) already addressed by decomposition, (N) disagree with reviewer + justify.

---

## P0 (BLOCKERS — all must be F in v2)

### Schema + migration
1. **R1b P0#2 / R2b P0-1**: PR 0 references `credential_kind` but column is added in PR A. **F** — move 0033a (`credential_kind` + `credential_last4` + partial unique index) into PR 0.
2. **R2b P0-2**: Spec says migration 0033a/b/c while Appendix says single `0033_add_memory_ops.sql`. **F** — pick one notation; I'll go with ONE file `0033_add_memory_ops.sql` split into three statement groups, since Drizzle journal is one entry per file.
3. **R1b P0#3**: Batch UPDATE uses `uuid` but `memory_facts.id` is `text`. **F** — change `jsonb_to_recordset AS x(id uuid, ...)` to `AS x(id text, ...)`.
4. **R1b P1#19 / R2b §A ok**: `memory_facts.embedding` is NOT in Drizzle schema. **F** — state that all embedding-column reads/writes in v2 use raw SQL; don't assume Drizzle surfaces the column. Add a test note.
5. **R2b P0-6**: `memory_ops_job_events.event_id bigserial` mesh-PK collision. **F** — decision: **make events LOCAL-ONLY, not mesh-synced**. Drop `sync_id`, drop the trigger, keep `bigserial`. SSE is same-peer by design (single CP per machine anyway). Update §5.3.

### Runtime + wiring
6. **R1b P0#1**: Provider config is not wired into `MemorySearch` / `MemoryStore` / drawer search — they still use boot-time `LITELLM_URL`. **F** — replace `LITELLM_URL`-gated construction with a DB-backed `resolveEmbeddingClient` that ALL memory paths use (search, store.addFact, drawer-store, backfill). Document in §7.
7. **R1b P0#7**: Mesh job ownership undefined. **F** — add `origin_machine_id text NOT NULL` and `executor_machine_id text` columns on `memory_ops_jobs`. Workers only claim rows where `executor_machine_id = LOCAL_MACHINE_ID` (or NULL and they self-assign by winning a conditional UPDATE). Peer UI shows remote-owned jobs as read-only.
8. **R1b P0#8 / R2b P0-3**: Advisory lock SQL flawed. **F** — use `pg_advisory_xact_lock(hashtext($key)::bigint)` per the `apply-change.ts:180` precedent. Add cast + cite precedent.
9. **R2b P0-4**: `scope_normalized` undefined. **F** — define `scopeNormalize(s) = lower(trim(coalesce(s, '')))` once; use it at lock-key, duplicate-detect query, and Zod schema.
10. **R2b P0-17**: Worker crash recovery missing. **F** — on CP boot, `UPDATE memory_ops_jobs SET status='failed', error='CP_RESTART_DURING_RUN', finished_at=now() WHERE status='running' AND executor_machine_id=LOCAL`. Acknowledge re-enqueue is v2.1.

### content_model + mixed-model
11. **R1b P0#4**: content_model lock locks on `DEFAULT 'text-embedding-3-small'` even for NULL-embedding rows. **F** — lock condition is `COUNT(*) WHERE embedding IS NOT NULL GROUP BY content_model`; if only one model exists AND has ≥1 row, the lock holds. Empty state (all NULL) allows any provider.
12. **R1b P0#5**: Mixed-model protection is UI-only. **F** — backend `memory_search` must fail closed with `MIXED_MODEL_SEARCH` error when query-embed-model != most-common content_model; or filter by query model. Lock to filter-by-model for v1.
13. **R2b P0-14**: `memory_drawers.embedding_model` lock missing. **F** — extend §8 to cover both `memory_facts.content_model` AND `memory_drawers.embedding_model`. drawer-backfill handler writes both.

### API contract
14. **R1b P0#6 / R2b §E #16 (implicit)**: Gemini endpoint wrong. **F** — verify against Google official docs via WebFetch/grep, fix catalog URL.
15. **R2b P0-7**: `/test-ephemeral` in UI but absent from §6.1 route inventory. **F** — add full contract: payload, response, rate limit, fail modes.
16. **R2b P0-8**: `DUPLICATE_ACTIVE_EMBEDDING` in acceptance but missing from §14. **F** — add to error table + Postgres 23505 translation rule.
17. **R2b P0-9**: `BASEURL_NOT_ALLOWED` is dead code. **F** — drop from §14; Zod schema uses `.strict()` to reject unknown fields (surfaces as `VALIDATION_ERROR`).
18. **R2b P0-10**: `UNSUPPORTED_MODEL` vs `VALIDATION_ERROR` overlap. **F** — keep `VALIDATION_ERROR` only; catalog-miss issue message is "model not in catalog". Drop UNSUPPORTED_MODEL.
19. **R1b P0#12**: Error envelope `{error: {code, message, context}}` contradicts existing flat `{error, message}`. **F** — adopt the current flat shape: `{ error: 'CODE', message: '...', context?: {} }`. Requires no frontend migration. Document that `context` is optional.

### Egress / redaction
20. **R1b P0#9**: Egress confirmation UI-only, API-bypassable. **F** — require `egressConfirmed: boolean` in POST /jobs payload; server persists `egressConfirmedAt` + `egressConfirmedBy` in params. Route rejects 400 `EGRESS_NOT_CONFIRMED` for kinds that leave the machine.
21. **R1b P0#10**: Redaction claim false for existing `memory_facts.content`. **F** — state plainly in §12: "existing facts are sent as-is to the provider after operator confirms egress"; do NOT claim redaction unless we add a facts-sanitize pass (deferred).

### UI + platform
22. **R2b P0-5**: `ConsolidationBoardView.tsx` missing from alert mount list. **F** — add; 8 mounts total now (10 views - 2 exempt).
23. **R2b P0-11**: `queue:pause` runbook command doesn't exist. **F** — replace runbook line with real instructions: `pm2 stop agentctl-cp-<tier>; redis-cli -n <db> del $(redis-cli -n <db> keys "bull:memory-ops:wait:*")`.
24. **R2b P0-12**: Playwright path wrong — use `packages/web/e2e/`, not `packages/web/tests/e2e/`. **F** — fix in Appendix A.
25. **R2b P0-13**: PR C + PR F are UI feature PRs, must be `minor` bump not `patch`. **F** — revise §16 version table: PR 0/A/B/D/E = patch, PR C = minor (first user-visible), PR F = minor, PR G = patch (e2e/docs).
26. **R2b P0-15**: Cost tracking only for embedding-backfill. **F** — extend: `consolidation` and `synthesis` call embed internally via the same `EmbeddingClient`; they'll get `usage` through `embedBatchWithUsage`. drawer-backfill also embeds. All four kinds accumulate into `progress.costUsd`. Document plumbing in §7.4.
27. **R2b P0-16**: `useQuery` not imported in `queries.ts`. **F** — v2 spec says PR C adds `useQuery` to the existing import. State that the convention is `queryOptions(...)` helpers + `useQuery(memoryProvidersQuery())` at the call site, matching the existing pattern.
28. **R2b P0-18**: `MemoryOpsAuditLogger` undefined. **F** — define interface in §11: `writeProviderEvent(input)` + `writeJobEvent(input)`, with input shape enumerating `actor`, `action`, `target`, `timestamp`. `actor` derives from `X-AgentCTL-Actor` header, defaulting to `local:${hostname}`. Drop `hashChain` from v1 (defer to v2.1); existing CP has no hash-chain audit infrastructure (verified via grep).

---

## P1 (major gaps — all F unless noted)

29. **R1b P1#13 / R2b P1-20**: Provider test lifecycle — `lastTestOk` transitions after save unclear. **F** — POST /providers accepts `recentTestResult: { ok, model, costUsd, signedToken }` from preceding `/test-ephemeral`; server merges into metadata. Signed token = HMAC over payload hash, 5-min TTL.
30. **R1b P1#14**: `/test-ephemeral` missing from §6.1. **F** — see #15 above (merged).
31. **R1b P1#15**: DUPLICATE_ACTIVE_EMBEDDING mapping undocumented. **F** — see #16 (merged).
32. **R1b P1#16**: `MemoryOpsJob.error` string format vs acceptance structured code. **F** — add `error_code text` column alongside `error text`. Acceptance tests use `error_code === 'PROVIDER_AUTH_FAILED'`.
33. **R1b P1#17**: PR D/F exposes kinds before handlers exist. **F** — PR D router ONLY accepts kinds whose handler exists in the current deployment. Gate list: `ENABLED_JOB_KINDS = new Set([...])`. PR E adds `embedding-backfill` + `drawer-backfill`; PR G adds `consolidation` + `synthesis`.
34. **R1b P1#18**: Runtime filter scope incomplete — missing `settings.ts` + `project_account_mappings`. **F** — expand PR 0 filter list; add both.
35. **R2b P1-19**: `created_by` unspecified source. **F** — drop the column. Audit table carries provenance.
36. **R2b P1-21**: Log-event mesh-sync redaction. **A** — events are now local-only (item #5); no cross-peer leakage.
37. **R2b P1-22**: §17 runbook SQL vs cancellation invariant. **F** — runbook SQL pre-condition: `pm2 stop agentctl-memory-ops-worker-<tier>` first. Document ordering.
38. **R2b P1-23**: PATCH rules per field undocumented. **F** — §6.1 PATCH table: `apiKey → re-encrypt+recompute last4+reset lastTestOk+bump updatedAt`, `active flip → bump updatedAt`, other fields → bump updatedAt only, `credential_iv` untouched unless apiKey changes.
39. **R2b P1-24**: GET / ordering unspecified. **F** — `ORDER BY is_active DESC, priority ASC, created_at ASC`.
40. **R2b P1-25**: PATCH 409 semantics ambiguous. **F** — split into `PROVIDER_HAS_ACTIVE_JOBS` (apiKey rotate OR deactivate with active jobs) vs `VALIDATION_ERROR` (bad payload). Enumerate in §6.1.
41. **R2b P1-26**: Our own rate-limit 429 code missing from §14. **F** — add `RATE_LIMITED` (401 → ours) + keep `PROVIDER_RATE_LIMITED` (upstream).
42. **R2b P1-27**: `memory_ops_job_events.job_id` FK + mesh sync. **A** — events are local-only (#5); FK stays, mesh-ordering concern moot.
43. **R2b P1-28**: `pg-mem` for pgvector tests. **F** — Docker Postgres with pgvector only; drop pg-mem.
44. **R2b P1-29**: Worker crash + multi-CP concurrency. **F** — BullMQ queue namespaced per Redis DB (matches memory rule 9: beta=DB0, dev-1=DB1, dev-2=DB2). One CP per tier, `concurrency=1` per kind per CP. Document in §4.
45. **R2b P1-30**: `MemoryOpsJobParams` never written. **F** — full Zod discriminated union in §7, with per-kind schemas for all four kinds including `scope`, `scopeNormalize`, `dryRun`, `batchSize`, `egressConfirmed`.
46. **R2b P1-31**: Migration rollback missing. **F** — §5 adds a rollback SQL block (manual runbook, not auto-applied).
47. **R2b P1-32**: PR E ships queue before UI — CLI can enqueue money-burning jobs. **F** — add `MEMORY_OPS_ENABLED=true` env gate on job-CREATE route (not GET). PR E defaults it off; PR F default on.
48. **R2b P1-33**: `/:id/test` rate-limit key. **F** — change to ip-only 5/min on `/:id/test`; document that per-account is a v2.1 auth-layer task.
49. **R2b P1-34**: Session-scope egress confirmation undefined. **F** — `sessionStorage['memory-ops-egress-ack:<credentialId>']` = 'true'; cleared on tab close. Server-side acknowledgement (#20) is the durable record.
50. **R2b P1-35**: `sync/apply-change.ts` branching for new `TABLE_PK_COLUMN`. **F** — list file as modified in PR A (test only — `apply-change` already reads `TABLE_PK_COLUMN`). But we made events local-only (#5), so it's not needed after all. **Update: drop from Appendix A.**
51. **R2b P1-36**: Catalog price drift. **F** — §19 Risks notes "review cadence: quarterly; catalog audit PR in plan's risk register".

---

## P2 (required before plan)

52. **R1b P0#11 / R2b §B**: `memory_ops_job_events` PK issue. **A** — local-only (item #5) resolves.
53. **R2b P2-37**: `AFTER UPDATE` trigger fires on every progress update → mesh spam. **A** — events local-only + jobs still mesh-synced but trigger scoped: `AFTER UPDATE OF status, result, finished_at` (column-level). Progress updates don't fire the trigger. §5.2 update.
54. **R2b P2-38**: Column comment style drift. **F** — add comments consistently.
55. **R2b P2-39**: Catalog dim assertion. **F** — boot-time validator: `for (entry of CATALOG) assert(entry.dim === 1536)`; error out if mismatch.
56. **R2b P2-40**: `result jsonb` size cap. **F** — document 16 KB soft cap, overflow → summary + link to events table.
57. **R2b P2-41**: log-retention worker entry. **F** — PR D modifies `packages/control-plane/src/audit/log-retention.ts` to add `memory_ops_job_events` retention (14 days default).
58. **R2b P2-42**: Drizzle `default({})` concern. **F** — use `sql\`'{}'::jsonb\`` per Drizzle best practice.
59. **R2b P2-43**: `/stream` LISTEN/NOTIFY plumbing implicit. **F** — §6.2 specifies one dedicated `pg.Client` on CP boot, `LISTEN memory_ops_job_channel`, fans out to SSE clients keyed by `job_id`. Payload = job_id only.
60. **R2b P2-44**: Testing rule file reference. **F** — drop specific 80% number; say "match or exceed package-level coverage".
61. **R2b P2-45**: MemorySidebar path. **F** — use real path `packages/web/src/components/memory/MemorySidebar.tsx`.
62. **R2b P2-46**: "disable search until reconciled" is nuclear. **F** — downgrade to banner + "Re-embed all" CTA (link to v2.1 task).
63. **R2b P2-47**: Verify no other layout imports MEMORY_NAV_ITEMS. **F** — grep task for plan.
64. **R2b P2-48**: Catalog drift risk phrasing. **F** — rephrase as risk + mitigation.
65. **R2b P2-49**: JobCard disabled on peer without provider. **F** — §13.2 adds disabled state + tooltip.
66. **R2b P2-50**: `resolveEmbeddingClient` signature (Pool vs Drizzle). **F** — use Drizzle for lookup, inside raw-pool for the decrypt path if needed (matches existing accounts.ts idiom).
67. **R2b P2-51**: 404 for provider ID not found. **F** — add `PROVIDER_NOT_FOUND` to §14.
68. **R2b P2-52**: ADD COLUMN ... NOT NULL DEFAULT on populated table. **F** — acceptance test that 0033a rewrites rows correctly.
69. **R2b P2-53**: `/test-ephemeral` vs `/:id/test` on edit mode. **F** — spec: edit mode with apiKey unchanged → `/:id/test`; edit mode with apiKey changed → `/test-ephemeral`.
70. **R2b P2-54**: `provider-test-failed` audit action. **F** — add to audit enumeration.
71. **R2b P2-55**: Partial rollback order between PRs. **F** — add to §16.
72. **R2b P2-56**: Completion with partial failure threshold. **F** — `status='completed'` if `failed / total < 0.05`; else `status='failed'`. Configurable via env.
73. **R2b P2-57**: `CANCEL_ACCEPTED` 202 code. **F** — add to §14.
74. **R2b P2-58**: Cross-kind concurrency policy. **F** — §13.2: declare `concurrency=1` globally (BullMQ-level); kinds don't run concurrently.

---

## Disposition totals

- **F** (fix in v2): ~65 items
- **A** (addressed by upstream decision): ~5 items
- **D/N**: 0 — no deferrals or disagreements in v2

Target v2 spec length: **≤ 800 lines** despite added detail. Techniques:
- Combine error table items.
- Trim non-essential prose.
- Move large examples to Appendix.
- Use tables over lists where dense.

If >800 lines, start decomposition (per memory rule 15).
