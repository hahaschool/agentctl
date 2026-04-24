# Memory Operations UI Spec + Plan Strict Review

Reviewed:
- Spec: `docs/superpowers/specs/2026-04-24-memory-operations-ui-design.md` at commit `779d7e34`
- Plan: `docs/superpowers/plans/2026-04-24-memory-operations-ui-plan.md` at commit `815f1c2c`
- Local code reality: `/Users/hahaschool/agentctl/.trees/memory-ops-spec`

Verdict: **do not implement this plan as written.** The direction is useful, but the spec and plan contain multiple P0 contradictions against the existing codebase. Several proposed snippets would not compile, several acceptance criteria cannot be met by the planned architecture, and several security/sync statements are factually false.

## P0 - Must Fix Before PR A

### 1. The credential mesh-sync premise is false and unsafe

The spec claims `api_accounts` mesh sync "inherits automatically" because `sync_capture_change()` serializes the full row (`spec:110`). That is false in the current codebase:

- `packages/control-plane/drizzle/0021_mesh_change_log.sql:130` explicitly says `api_accounts` is excluded: "no api_accounts - local-only".
- `packages/shared/src/types/sync.ts:181-182` classifies `api_accounts` as `local-only` because encrypted credentials must not auto-replicate.
- The plan never adds a trigger to `api_accounts`, never updates `TABLE_SYNC_CONFIG`, and never defines a re-encryption/key-wrap protocol.

This is not a documentation nit. The spec acceptance criterion "Mesh peers see the same provider list" (`spec:395`) is impossible under the current sync model. If the plan tries to make it true by adding `api_accounts` sync, it creates a credential replication design that contradicts existing mesh security decisions.

Required correction: choose one model:
- **Local-only providers per peer**, matching current security posture. Then remove all claims that provider lists replicate.
- **Explicit credential sharing**, with per-peer re-encryption, opt-in UX, audit, revocation, and sync config changes. That is a separate feature, not a small v1 inheritance.

### 2. Reusing `api_accounts` without updating existing runtime-account paths will corrupt runtime credential behavior

The spec says existing runtime auth behavior is unchanged (`spec:105`). The plan only adds `credential_kind` and new provider routes. It does not update existing account/session/scheduler code to filter `credential_kind='runtime'`.

Concrete breakage:

- `packages/control-plane/src/api/routes/accounts.ts:92` lists all `api_accounts` rows. Embedding providers will appear in "Managed Credentials" unless every existing account route is filtered.
- `packages/control-plane/src/api/routes/sessions.ts:1597-1601` failover selects all active `api_accounts`. An active embedding provider can become the next Claude/Codex runtime credential.
- `packages/control-plane/src/scheduler/task-worker.ts:301-312` decrypts whatever `api_accounts` row is resolved and uses `account.provider` for dispatch. There is no `credential_kind` guard.
- Existing account create/update/delete/test routes can mutate embedding rows because they do not know the new column exists.

Required correction: PR A or B must include a compatibility slice that:
- filters all runtime account reads/writes to `credential_kind='runtime'`;
- prevents `/api/settings/accounts` from touching `embedding` rows;
- updates failover and account resolution tests;
- updates any project-account mapping expectations if embedding rows live in the same table.

Without this, the feature can break normal agent execution as soon as an embedding provider is created.

### 3. `memory_ops_jobs` mesh sync is also incomplete

The spec creates a sync trigger on `memory_ops_jobs` (`spec:138-144`) and claims this prevents accidental double-runs across peers (`spec:383`). The plan repeats the trigger (`plan:165-167`) but never updates the shared sync table registry.

Current apply code ignores unknown or local-only tables via `TABLE_SYNC_CONFIG` (`packages/shared/src/types/sync.ts:162-187`). A trigger alone may produce local change-log rows, but remote apply will skip the table because `memory_ops_jobs` is not listed.

Required correction:
- decide whether job rows are `mutable` sync state or local-only operational state;
- update `TABLE_SYNC_CONFIG`, `SYNCED_TABLES`, `TABLE_PK_COLUMN` if synced;
- add two-node replication tests for `memory_ops_jobs`;
- define conflict semantics for progress updates from different peers.

The current plan's "mesh exposes running job to both UIs" claim is unsupported.

### 4. The plan has no real cross-peer duplicate-run prevention

Even if `memory_ops_jobs` sync is fixed, the planned BullMQ `concurrency=1` (`spec:261`, `plan:2893`) only limits one worker process against one Redis queue. It does not prevent:

- peer A and peer B using different Redis instances;
- two UIs creating two queued rows before sync catches up;
- one peer operating while another is offline;
- simultaneous jobs with the same kind/scope but different IDs.

Required correction: add a DB-level invariant. For example, a partial unique index or advisory lock on `(kind, normalized_scope)` for active statuses, plus route-level conflict responses. Mesh visibility is not a lock.

### 5. The role/approval/security model is asserted but not designed

The spec says job creation requires an "operator role" and reads are viewer-level (`spec:319`). The current Fastify server does not have a role model in these route plugins. The plan does not add one.

The spec also promises hash-chained audit entries for provider and job mutations (`spec:320`). The plan does not identify an `audit-logger.ts` API, does not add tests, and does not wire create/update/delete/cancel events.

Required correction:
- identify the actual auth/approval mechanism that exists in this repo;
- add route preHandlers or explicitly state this is local-control-plane trusted UI only;
- add audit implementation and tests before any credential/job write route ships.

Right now the security section is aspirational text, not an implementation plan.

### 6. Provider `baseUrl` is an SSRF/exfiltration surface

The plan lets users enter arbitrary `baseUrl` values (`spec:168`, `plan:441`, `plan:1333`, `plan:3090`). Provider testing and embedding jobs then send an Authorization bearer token and memory content to that URL.

That creates two risks:

- SSRF against local/internal services from the control-plane process.
- Accidental or malicious exfiltration of memory facts and API keys to a non-provider endpoint.

Required correction:
- restrict `baseUrl` to vetted provider defaults in v1, or use existing URL guard patterns with strict scheme/host allowlists;
- do not send provider credentials to arbitrary URLs;
- make "custom base URL" a separate advanced feature with explicit security tests.

### 7. External data egress is not treated as a product/security requirement

Embedding backfill sends `memory_facts.content` to OpenAI/Gemini (`plan:2788-2790`). The spec does not require a data-egress warning, preview, confirmation, redaction policy, or scope dry-run before sending 19,226 facts to an external provider.

This is a serious omission. Memory content may contain code, incident details, credentials that escaped earlier sanitizers, or private user context.

Required correction:
- add explicit UI copy and confirmation before first external-provider backfill;
- add a dry-run count and estimated token/cost/data volume;
- document what content leaves the machine;
- add tests that dangerous source content is either redacted or explicitly shown as leaving the system.

### 8. The API contract and error shape are inconsistent

The spec requires structured `ControlPlaneError` codes (`spec:238`, `spec:313`). The plan implements several incompatible shapes:

- provider route error handler returns `{ error: err.code, message }` (`plan:1156-1163`), not a stable nested error object;
- Zod validation is expected to bubble as HTTP 500 in a test (`plan:1461`), which contradicts the API design requirement for validation errors;
- `POST /providers/:id/test` spec says `401/422` with structured errors (`spec:157-158`), but the plan does not classify provider 401s from `EmbeddingClient` into HTTP 401;
- `EMBEDDING_CREDENTIAL_DECRYPT_FAILED` has no HTTP mapping.

Required correction: define one error envelope and enforce it in route tests. Zod errors should be 400 or 422, not 500.

### 9. Several snippets will not compile against the current codebase

Examples:

- `plan:1426` uses `opts.encryptionKey` when registering `memoryProvidersRoutes`. `CreateServerOptions` has no `encryptionKey`; existing account routes read `process.env.CREDENTIAL_ENCRYPTION_KEY` inside `server.ts` (`packages/control-plane/src/api/server.ts:828-847`).
- `plan:1627` imports `apiFetch` from `./core`, but the actual API helper is `request` (`packages/web/src/lib/api/core.ts:21`).
- `plan:1695-1699` says append to `packages/web/src/lib/api/index.ts`, but the barrel is `packages/web/src/lib/api.ts` (`packages/web/src/lib/api.ts:112-126`).
- `plan:1722-1730` says append new `import` statements to `queries.ts`; imports cannot be appended after executable declarations. The existing file imports `queryOptions`, `useMutation`, and `useQueryClient` but not `useQuery` (`packages/web/src/lib/queries.ts:1-2`).
- `plan:71`, `plan:3048-3049` mention `MemoryGraphPage.tsx` and `MemoryConsolidationView.tsx`; actual views are `KnowledgeGraphView.tsx` and `ConsolidationBoardView.tsx`.
- `plan:3070` references `knowledge-maintenance.ts::runConsolidation`, but the current code exposes `KnowledgeMaintenance.run`, not `runConsolidation`.

Required correction: run a path/API reality pass before writing implementation snippets. The current plan is not executable by a worker without improvising.

### 10. The `EmbeddingClient` URL change is a breaking change hidden inside provider support

Current behavior appends `/v1/embeddings` (`packages/control-plane/src/memory/embedding-client.ts:64`) and current tests assert that (`packages/control-plane/src/memory/embedding-client.test.ts:47`). The plan changes this to append `/embeddings` (`plan:801-807`) and admits existing `LITELLM_URL` callers conventionally omit `/v1` (`plan:809`).

That means existing LiteLLM embeddings can silently break from `/v1/embeddings` to `/embeddings`. A PR body "migration note" is not enough.

Required correction:
- preserve backward compatibility by introducing an explicit `embeddingsPath` option or normalizing per provider;
- keep existing tests for LiteLLM behavior;
- add provider-specific tests for OpenAI and Gemini URL construction.

### 11. The create-provider UX contradicts the spec and acceptance criteria

The spec requires the Add/Edit dialog Test button to run a live embed before save (`spec:272`) and acceptance says the user can add OpenAI, test it, see dim/cost, then save (`spec:389`). The plan's `ProviderDialog` disables Test in create mode and says "Save the provider first, then click Test" (`plan:1877-1884`, `plan:1959`).

This is not a small UX change. It means the UI can persist an invalid key, hide the missing-provider alert, and only discover failure later.

Required correction:
- add a create-time test endpoint that accepts a write-only payload without persisting, or make create save-and-test transactional with rollback on failure;
- align acceptance criteria and tests with the chosen behavior.

### 12. Provider deletion safety is deferred past the point where it becomes unsafe

The spec requires deleting a provider with running jobs to return 409 (`spec:309`, `spec:392`). The plan implements unconditional delete in PR B and comments that PR D will extend it later (`plan:1354-1359`), but PR D route tasks do not actually modify provider deletion.

Once PR D/E exist, this becomes a real data integrity bug: a running job can lose its credential row mid-run.

Required correction: implement the 409 check in the same PR that introduces `memory_ops_jobs`, and add a regression test. Do not leave it as a comment.

### 13. SSE replay and log tail are impossible with the proposed storage model

The spec promises:

- SSE `Last-Event-Id` reconnect replay (`spec:308`, `spec:336`);
- event type `log` with worker output (`spec:216`);
- a detail drawer with last 200 log lines (`spec:282`).

The data model has no `memory_ops_job_events` table, no log table, no monotonically increasing event ID, and no persistent log field. The plan's SSE task listens to `pg_notify` and fetches the current row (`plan:2573-2581`). That cannot replay missed events and cannot render a historical 200-line log tail.

Required correction: either remove replay/log-tail requirements or add persisted job events/logs with sequence IDs.

### 14. Job lifecycle can overwrite cancellation

`JobsRepository.complete` updates by ID only (`plan:2376-2379`). `JobsRepository.fail` also updates by ID only (`plan:2384-2387`). `runJobWithLifecycle` completes the job whenever the handler returns (`plan:2548-2555`).

If a job is cancelled while a batch is running, the handler can return `{ cancelled: true }`, and the runtime still marks the row `completed`. If a cancel lands after the handler's final cancel check but before `complete`, `complete` overwrites `cancelled`.

Required correction:
- make terminal transitions conditional on current status;
- teach the handler/runtime to return a cancellation outcome that calls `cancel` or leaves the row cancelled;
- add race tests for cancel-vs-complete and cancel-vs-fail.

### 15. `embedding-backfill` SQL is broken for scoped runs

The planned handler builds `scopeFilter = 'AND scope = $2'` (`plan:2763`). In the count query it passes only `[params.scope]` (`plan:2765-2766`), so `$2` is undefined. In the page query, the same `$2` placeholder is used for both scope and limit (`plan:2780-2783`).

The tests do not cover scoped backfill. This will fail as soon as the optional `scope` parameter is used.

Required correction: build SQL placeholders from the params array, and add tests for scoped and unscoped runs.

### 16. `embedding-backfill` vector writes are likely invalid

Existing memory-store writes cast vector literals with `::vector` (`packages/control-plane/src/memory/memory-store.ts:227-238`, `packages/control-plane/src/memory/memory-store.ts:605-606`). The plan writes:

```sql
UPDATE memory_facts SET embedding = $1 WHERE id = $2 AND embedding IS NULL
```

with a string literal value (`plan:2793-2796`). That is inconsistent with current write paths and likely fails or depends on implicit casts.

Required correction: use `$1::vector`, validate vector length before writing, and update `content_model` or equivalent model metadata when using Gemini/OpenAI provider-specific models.

### 17. Cost accounting is specified but not implemented

The spec says jobs record cost and the UI aggregates monthly totals (`spec:321`, `spec:391`). The planned provider test returns `costUsd: 0` (`plan:1391-1393`), and the backfill handler reports `costUsd: 0` for every batch (`plan:2810`). Yet PR E acceptance expects `progress.costUsd ≈ 0.08` (`plan:2930`).

Required correction:
- define token counting and provider pricing source;
- persist per-job and aggregate cost;
- test that cost is nonzero for seeded content when a priced provider is used;
- do not claim monthly totals until there is an endpoint/query for them.

### 18. Auth failure and rate-limit semantics are not implementable from the planned error handling

The spec requires:

- provider auth failure deactivates the provider and fails the job with `PROVIDER_AUTH_FAILED` (`spec:258`, `spec:307`);
- 429s use backoff and can skip bad batches (`spec:257`, `spec:306`).

The current `EmbeddingClient` throws `ControlPlaneError('EMBEDDING_API_ERROR', ...)` with status in context (`packages/control-plane/src/memory/embedding-client.ts:111-115`). The planned handler detects 401 by string matching `err.message.includes('401')` (`plan:2803-2805`), never deactivates the provider, and has no way to append structured batch logs.

Required correction: expose provider HTTP status/code in typed errors, classify 401/429 centrally, and add tests for provider deactivation and retry/skip behavior.

### 19. PR D depends on PR B in practice but the plan says it only depends on PR A

PR D creates job routes that must validate or resolve providers (`plan:2598-2600`) and PR E worker calls `resolveEmbeddingClient` (`plan:2854`, `plan:2871-2876`). The plan states PR D depends only on PR A (`plan:2170`). That lets workers start from a branch without the provider backend.

Required correction: make PR D depend on PR B, or split provider-free job plumbing from provider-aware create semantics very explicitly.

### 20. Worker boot uses an empty encryption key instead of failing closed

The worker wiring passes `process.env.CREDENTIAL_ENCRYPTION_KEY ?? ''` (`plan:2901-2905`). Existing account routes disable credential management when the key is missing (`packages/control-plane/src/api/server.ts:828-847`). The new worker should not boot and then fail decrypts at runtime with an empty key.

Required correction: use the same fail-closed behavior as account routes. No provider CRUD or provider-backed worker should be registered without a valid encryption key.

### 21. PR F and PR G are not real implementation plans

The plan advertises TDD and "every task writes a failing test first" (`plan:78`). PR F and PR G mostly contain component names and prose:

- F1-F2 have no failing tests, code, or verification commands (`plan:2944-2960`).
- F4-F10 are skeletal (`plan:3001-3060`).
- G1-G8 are skeletal and reference nonexistent APIs (`plan:3068-3109`).

This violates the plan's own ground rules and the writing-plans standard. A worker cannot execute these sections without designing the feature from scratch.

Required correction: rewrite PR F/G with the same concrete test/code/command granularity expected from PR A/B.

### 22. The self-review checklist is overclaimed

The checklist says mesh sync for credentials and jobs is covered by PR A (`plan:3123`). It is not. It says type consistency is achieved (`plan:3130`), but the plan mixes `prov_01J...` examples (`spec:177`, `spec:211`) with UUID schemas and DB FKs (`plan:532`, `plan:154`). It says missing alert on 6 pages is covered (`plan:3122`), but F8 says "5 existing pages" while listing 6 candidates (`plan:3040-3049`).

Required correction: remove checklist claims until there are concrete tasks and tests proving them.

## P1 - Major Design And Implementation Problems

### 23. The provider ID contract is inconsistent

The spec response examples use `prov_01J...` (`spec:177`, `spec:211`), while the DB schema uses `uuid REFERENCES api_accounts(id)` (`spec:127`) and shared params require `z.string().uuid()` (`plan:532`, `plan:541`, `plan:547`, `plan:552`). The plan implementation uses `randomUUID()` (`plan:1191`).

Required correction: standardize on UUIDs, or introduce a public ID layer. Do not document prefixed IDs unless they exist.

### 24. Single-active provider is not transactionally safe

Provider create/patch deactivates other providers and then inserts/updates the selected provider in separate DB operations (`plan:1181-1215`, `plan:1337-1349`). There is no transaction and no partial unique index. Two concurrent requests can create two active embedding rows.

Required correction: use a transaction plus a DB invariant, for example a partial unique index on active embedding providers if the product truly allows only one.

### 25. Provider testing leaks implementation placeholders into API response

`POST /:id/test` returns `model: 'from-provider-metadata'` (`plan:1387-1393`) and cost `0`. That is not production API behavior, and it contradicts the spec's `{ ok, dim, model, costUsd }` contract (`spec:157`).

Required correction: return actual provider metadata and actual/estimated cost, or remove those fields.

### 26. Route tests are too mocked to prove the routes work

The provider route tests mock Drizzle chains by shape (`plan:1033-1043`, `plan:1257-1265`) and even leave `/:id/test` tests as comments (`plan:1286-1294`). This will miss real Drizzle usage errors, route registration errors, transaction mistakes, and schema incompatibilities.

Required correction: add Fastify `inject()` tests with realistic route dependencies and at least one integration test against a real or test Postgres for provider CRUD.

### 27. The backend route registration plan ignores existing route gating

Current account routes are only registered if `db` exists and `CREDENTIAL_ENCRYPTION_KEY` is set (`packages/control-plane/src/api/server.ts:828-847`). The provider route plan does not say where it lives relative to this guard, and B5 uses a nonexistent `opts.encryptionKey`.

Required correction: register provider routes under the same guard as account routes, and add a server-level route registration test for key-present and key-missing modes.

### 28. The missing-provider alert suppresses the untested-provider state

The planned alert treats `lastTestOk === null` as healthy because it only warns when `lastTestOk !== false` is false (`plan:2978-2980`). Combined with create-mode "save before test", the UI can hide the alert for a never-tested provider.

Required correction: model provider health as `missing`, `untested`, `failed`, `healthy`; warn on missing/untested/failed unless the product deliberately accepts untested providers.

### 29. The UI design is under-specified and generic

The spec's frontend description is mostly component inventory (`spec:265-298`). The plan's components are basic card/table/dialog fragments. It does not define:

- information density for a repeated operator workflow;
- disabled states while jobs are queued/running;
- confirmation for paid external backfill;
- empty/error/loading states beyond a few strings;
- mobile layout;
- accessibility behavior for progress, logs, EventSource errors, and destructive delete;
- how "Retry" reconstructs params from failed jobs.

Required correction: add a concrete UX spec for the operator workflow, especially the first-run path and running-job supervision path.

### 30. The rollout order ships inconsistent user states

The spec says two PRs should unblock immediate pain (`spec:24`), but the rollout says critical path is A-E (`spec:374`). PR C lets users configure keys, PR D lets them enqueue jobs that cannot run, PR E lets them use curl/API but there is still no operations UI until PR F.

Required correction: either:
- change the "two PRs" claim; or
- collapse provider CRUD + settings + minimal embedding-backfill trigger/progress into a smaller first release.

### 31. Dev/beta/release instructions are mechanically repeated but not validated

The plan instructs every PR to version bump, promote beta, and release (`plan:81`, repeated in PR wraps). For a seven-PR sequential feature, this is operationally heavy and increases deployment risk. It also produces public releases where the user-visible feature is half present.

Required correction: define which PRs are internal-only and which deserve promotion. At minimum, PR D should not promote a UI-visible queued-job API without workers unless there is a reason.

### 32. Backfill progress can lie

The backfill handler counts total once (`plan:2764-2767`), then processes rows selected by `embedding IS NULL`. If rows disappear due to concurrent work, total stays stale. On batch error it increments `done` without writing embeddings (`plan:2800-2808`). On dry-run it also increments `done` while repeatedly selecting the same first page.

Required correction: distinguish `processed`, `embedded`, `skipped`, `failed`, and `remaining`. Do not overload `done`.

### 33. No timeout, cancellation, or shutdown semantics for provider HTTP calls are specified beyond the existing client

The spec says cancel waits for in-flight HTTP to complete (`spec:311`), but the plan does not define how long a batch can hang, how `AbortSignal.timeout` interacts with worker shutdown, or how graceful shutdown records partial progress.

Required correction: define max batch duration, shutdown behavior, and stuck-job recovery.

### 34. Drawer backfill is hand-waved despite being complex

E2 says "factor the existing script into a library function" (`plan:2826-2836`). The existing `scripts/backfill-memory-drawers.ts` is a large CLI with parsing, source cursors, state store, drawer writes, fact writes, sanitization, and estimates. This cannot be safely wrapped with four bullets.

Required correction: split drawer backfill into its own detailed plan with tests for resume cursor, dry-run, source validation, sanitized content, fact-source span preservation, and progress mapping.

### 35. Consolidation and synthesis handlers are hand-waved and misnamed

The spec says consolidation calls `knowledge-maintenance.ts::runConsolidation` (`spec:250`), and the plan repeats that (`plan:3070`). The current service is `KnowledgeMaintenance.run`. Synthesis is `KnowledgeSynthesis.runSynthesis`, but the plan does not define dependencies like `MemoryStore` for maintenance.

Required correction: inspect the actual services and design worker adapters from their real constructors and return shapes.

### 36. The plan does not update OpenAPI/API docs

The repo has API docs and Swagger schemas. The spec adds two route groups, but the plan does not add schema metadata, OpenAPI docs, or docs/API updates.

Required correction: document new endpoints and error codes, or explicitly state they are internal and omitted.

### 37. `memory_facts.embedding` is not represented in the current Drizzle schema

The raw DB has `memory_facts.embedding`, and memory-store uses raw SQL to write it. The current Drizzle `memoryFacts` table in `schema.ts` does not expose an `embedding` column (`packages/control-plane/src/db/schema.ts:354-374`). The plan relies on raw SQL for backfill, so tests around Drizzle schema will not protect embedding operations.

Required correction: either add the missing schema column intentionally, or document that embedding remains raw-SQL-only and add integration tests.

## P2 - Smaller But Still Required Corrections

### 38. Migration robustness is weak

Migration 0033 uses plain `ALTER TABLE ... ADD COLUMN` and `CREATE INDEX` (`plan:135-167`). Drizzle may run it once, but local/beta recovery often involves partially applied migrations. Existing migrations use some `IF NOT EXISTS` patterns. Consider idempotency where practical, especially for indexes/triggers.

### 39. `updated_at` is not maintained consistently

Provider PATCH updates `metadata`, key, and active status but does not set `updatedAt` (`plan:1320-1349`). If the UI sorts or displays update times, it will lie.

### 40. `lastTestOk` is both "derived" and stored

The spec says `lastTestOk` is a derived UI field recomputed from the latest test result stored in metadata (`spec:258`). The plan stores `last_test_ok` directly in metadata (`plan:1207-1209`, `plan:1373-1385`). That is not derived; it is denormalized state. Pick one and name it honestly.

### 41. Rate limiting is underspecified

The spec says provider test is 5 req/min/account (`spec:318`). The plan uses IP as key (`plan:1151-1154`). In local/proxied deployments, IP is not account identity. If auth is added later, use auth identity; otherwise document that this is per client IP.

### 42. The plan's test commands hide failures

Many commands pipe to `tail` (`plan:110`, `plan:611`, `plan:616`, `plan:621`, `plan:1484-1486`). Tail is acceptable for display, but the plan should make exit-code preservation explicit. Workers often misread tailed output as the full result.

### 43. E2E labels are inconsistent

The spec says "Two full-journey specs" then lists three (`spec:345-350`). The plan later lists three Playwright specs (`plan:60`, `plan:3082-3101`). Fix the count.

### 44. The acceptance target is too environment-specific

The spec and plan repeatedly hardcode the user's current 19,226 facts (`spec:17`, `spec:391`, `plan:5`, `plan:2928-2930`). That is useful as a manual validation note, but it should not be the only acceptance criterion. The product acceptance should be data-size invariant, with 19,226 as one manual benchmark.

### 45. PR descriptions are allowed to claim unchecked boxes

Several PR templates include unchecked "Verify in dev-1" items inside generated PR bodies before the verification happens (`plan:637-641`, `plan:1508-1511`). That is okay only if the PR is opened before dev verification by design. The plan should state when those boxes are checked and by whom.

## Required Rewrite Checklist

Before opening a PR, rewrite the spec and plan until the following are true:

- `api_accounts` local-only vs synced-provider behavior is resolved explicitly.
- All runtime account paths filter out embedding rows.
- `memory_ops_jobs` sync behavior is either fully implemented or removed from claims.
- Provider CRUD is registered only when DB and encryption key are valid.
- Provider `baseUrl` is constrained or security-reviewed with tests.
- Provider create/test/save flow matches the acceptance criteria.
- Error responses use one documented envelope and Zod errors are not 500.
- SSE replay/log tail requirements have storage support or are removed.
- Backfill SQL is corrected and covered for scoped runs.
- Vector writes use the same cast/validation pattern as existing memory-store.
- Cost accounting is either implemented or removed from v1 acceptance.
- Cancellation races cannot produce false `completed` jobs.
- PR F/G are rewritten as executable TDD plans with code and verification commands.
- External data-egress warning and confirmation are added to the UX.
- The final checklist only claims items backed by concrete tasks and tests.

## Bottom Line

The high-level product need is real: the memory subsystem needs an operator surface for embedding providers and long-running maintenance. But this spec/plan currently mixes correct intent with false assumptions about mesh sync, auth, credential storage, existing API clients, and job execution. Implementing it as written would likely break runtime credential selection, fail to compile in web/control-plane slices, and ship a UI that claims progress/logging/security guarantees it cannot deliver.
