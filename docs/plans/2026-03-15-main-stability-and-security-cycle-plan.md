# Main Stability And Security Cycle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore `main` CI health, remove the highest-value open security regressions, and then update roadmap/plan documents to match the codebase state.

**Architecture:** Keep this cycle narrow and evidence-driven. First reproduce the current control-plane failures locally and fix only the root causes. Then address the actionable open CodeQL alerts in small, isolated batches so parallel work can land without overlapping files.

**Tech Stack:** pnpm workspace, Vitest, Fastify, Next.js, TypeScript, GitHub Actions, CodeQL

> Status note (2026-04-13): this stabilization/security wave remains complete on `main` for the historical CI + CodeQL + Dependabot + DAST backlog through PR #230. The later 2026-04-01 and 2026-04-13 loops re-closed current CI, CodeQL, Dependabot, DAST, web test infrastructure, rate-limiting, and e2e coverage follow-ups; the roadmap now carries the detailed merged-PR ledger.

> Follow-up sync (2026-04-14): PR #436 extended `/security-findings` browser coverage, PR #438 shipped the `/webhooks` management page, PR #439 closed the remaining route-rate-limit audit, PR #440 cleaned up CI/security scan annotations by fixing Biome security lint syntax and gating empty Grype SARIF uploads, PR #442 landed the SessionHeader/GitStatusBadge accessibility follow-up, PR #443 introduced Zod input validation and bounded strings on three write surfaces, PR #444 added focused `/webhooks` Playwright coverage, PR #445 moved the backend-independent webhooks Playwright slice into CI, PR #447 added mobile-push validation negative coverage, PR #448 tightened batch-2 input validation across six control-plane surfaces, PR #452 hardened sync-peer registration/ping validation against unsafe peer URLs and metadata/local SSRF targets, PR #454 added `/logs` Security Findings Playwright coverage, and PR #455 added `/memory/browser` facts-flow Playwright coverage. At that sync checkpoint, the post-merge `main` head was `74a5bc44`.
>
> Follow-up sync (2026-04-14): PRs #457-#459 extended backend-independent browser coverage for `/memory/import`, `/settings`, and `/discover`; PR #461 added `/memory` index redirect/sidebar coverage; PR #462 added `/memory/consolidation` queue/action coverage; PR #465 and PR #466 added broader `/memory/scopes` and `/memory/graph` coverage; PR #467 added a webhook delivery-history viewer with unit coverage; and PR #468 added dynamic `/spaces/[id]` + `/tasks/[id]` detail-route coverage. At that sync checkpoint, the post-merge `main` head was `4291f520`.
>
> Follow-up sync (2026-04-14): PR #470-#474 shipped the memory synthesis page, push-device settings UI, memory fact feedback, memory maintenance page, and tasks auto-decompose action; PR #475 added browser coverage for memory synthesis, webhook deliveries, and push-device registration/revoke; PR #476 added the shared ConfirmDialog primitive plus memory dashboard first-load/error states; PR #478 added memory-maintenance and auto-decompose browser coverage; and PR #479 removed stale agent-worker discovery type stubs. At that sync checkpoint, the post-merge `main` head was `9f984523`.

> Follow-up sync (2026-04-14): PR #486 added `/memory/browser` provenance filters, PR #487 added task auto-decompose apply-failure browser coverage, PR #488 added webhook delivery-list retry coverage, and PRs #489/#490 synced roadmap status through `main@d868742b`. GitHub reported 0 open code-scanning alerts, 0 open Dependabot alerts, and 0 open secret-scanning alerts at that checkpoint.

> Follow-up sync (2026-04-14): after PR #504 landed on `main@8a9cda1b`, Build & Publish Docker Images run `24403340306` first failed twice in `Build control-plane` setup because GitHub returned 429 while downloading `github/codeql-action/upload-sarif`; later reruns restored the latest main checks to green. The follow-up CI hotfix was scoped to remove duplicate Security-tab SARIF uploads from `build-images.yml`, keep Trivy/Grype/SBOM outputs as artifacts, leave Security Audit as the single workflow responsible for Security-tab SARIF uploads, and cap Security Audit's container-scan matrix at one concurrent image to reduce repeated `codeql-action` setup downloads during busy merge windows.

> Follow-up sync (2026-04-14): PR #508 delivered that Docker publish SARIF artifact-only hotfix, PR #509 registered the missing audit-trail page plan, and post-merge `main@b0464f2c` checks passed: CI `24405567418`, Security Audit `24405567419`, and Build & Publish Docker Images `24405567447`. The remaining CI annotation on that Docker publish run was GitHub Actions' Node.js 20 JavaScript action deprecation warning for Docker/artifact/cache actions; PR #510 opted `build-images.yml` and `security-audit.yml` into `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` so the repo exercises the upcoming runtime before GitHub flips the default.

> Follow-up sync (2026-04-14): after PR #510 landed, CI run `24406293113` exposed a Node 20 compat TypeScript error in `packages/control-plane/src/api/routes/agents.ts` (`AGENT_RUNTIMES.map` callback parameter inferred as `any`). PR #512 fixed the runtime mapping type, and post-merge `main@62a06878` checks passed: CI `24406979775`, Security Audit `24406979789`, and Build & Publish Docker Images `24406979766`. GitHub reports 0 open code-scanning, 0 open Dependabot, and 0 open secret-scanning alerts at this checkpoint.

> Follow-up sync (2026-04-14): PR #513 added backend-independent `/audit` Playwright coverage and included it in the focused web e2e CI allowlist. Post-merge `main@5eb844ff` checks passed: CI `24407474324`, Security Audit `24407474322`, and Build & Publish Docker Images `24407474278`. Security Audit still emits GitHub's Node.js 20 deprecation annotation for Docker/cache/artifact actions running under the forced Node 24 runtime; the annotation is informational and the workflow passed.

> Follow-up sync (2026-04-15): PR #514 exposed a global Security Audit dependency-audit failure after npm retired the legacy audit endpoints used by `pnpm audit` (`/-/npm/v1/security/audits` and `/audits/quick`). PR #515 replaces those workflow calls with `pnpm audit:deps --audit-level=high`, a repository script that reads `pnpm-lock.yaml`, calls npm's supported bulk advisory endpoint, and keeps high/critical advisories blocking while avoiding lockfile or package-manager churn. Follow-up: PR #550-#552 delivered mesh peer ping/edit/registration groundwork, PR #554-#556 added machine provenance and version metadata, PR #557 delivered mesh envelope compat gates/docs, and the post-#557 checkpoint is `main@7c0f0fa3` with CI `24444895702`, Security Audit `24444895704`, and Build & Publish Docker Images `24444895701` green. PR #558 added mesh version UI and the lazy sidebar peer-version tooltip; post-#558 checks are tracked from `main@2bdd54f2` as CI `24445468284`, Security Audit `24445468249`, and Build & Publish Docker Images `24445468269`.

> Follow-up sync (2026-04-15): PR #516 and PR #518 moved the backend-independent `/machines` and `/agents` list browser slices into the focused Web E2E CI lane, with `@agentctl/shared` built before Playwright so cold CI checkouts can compile shared-contract imports. PR #520 modernized Docker publish Grype output with `anchore/scan-action@v7.4.0` and explicit per-image SARIF validation, PR #522 scoped explicit CI `node_modules` cache keys by run/attempt to remove duplicate immutable cache-save annotations, and PR #523 moved Docker publish, Security Audit container scans, and local-mode DAST Docker builds onto Node24 action majors while disabling Buildx binary caching and Trivy's internal action cache. At the post-#523 checkpoint, `main@1d77f4e9` had green CI `24436282633`, Security Audit `24436282625`, and Build & Publish Docker Images `24436282616`, with 0 open code-scanning, Dependabot, or secret-scanning alerts. Follow-up: PR #550-#552 delivered mesh peer ping/edit/registration groundwork, PR #554-#556 added machine provenance and version metadata, PR #557 delivered mesh envelope compat gates/docs, and the post-#557 checkpoint is `main@7c0f0fa3` with CI `24444895702`, Security Audit `24444895704`, and Build & Publish Docker Images `24444895701` green. PR #558 added mesh version UI and the lazy sidebar peer-version tooltip; post-#558 checks are tracked from `main@2bdd54f2` as CI `24445468284`, Security Audit `24445468249`, and Build & Publish Docker Images `24445468269`.

> Follow-up sync (2026-04-15): PR #524 synced the roadmap/main-stability checkpoint after the Docker-action cleanup, and PR #525 expanded sidebar keyboard access with `1-9,0` digit navigation plus `g`-prefix Go To chords for all sidebar destinations. The PR #525 review follow-up also made Settings render the grouped shortcut catalog and added regression coverage so modified second keys preserve browser/app shortcuts. At the post-#525 checkpoint, `main@0f49e772` has green CI `24437117041`, Security Audit `24437117038`, and Build & Publish Docker Images `24437117043`. Follow-up: PR #550-#552 delivered mesh peer ping/edit/registration groundwork, PR #554-#556 added machine provenance and version metadata, PR #557 delivered mesh envelope compat gates/docs, and the post-#557 checkpoint is `main@7c0f0fa3` with CI `24444895702`, Security Audit `24444895704`, and Build & Publish Docker Images `24444895701` green. PR #558 added mesh version UI and the lazy sidebar peer-version tooltip; post-#558 checks are tracked from `main@2bdd54f2` as CI `24445468284`, Security Audit `24445468249`, and Build & Publish Docker Images `24445468269`.

> Follow-up sync (2026-04-15): PR #526 landed the post-#525 roadmap/plan consistency sync on `main@56ae0b24`. Post-#526 main checks passed: CI `24437448007`, Security Audit `24437448002`, and Build & Publish Docker Images `24437448013`; at that historical checkpoint Docker publish still reported the known nonblocking Grype high-severity annotations, before PR #825 later narrowed Grype output to fixed-version vulnerabilities only. Follow-up: PR #550-#552 delivered mesh peer ping/edit/registration groundwork, PR #554-#556 added machine provenance and version metadata, PR #557 delivered mesh envelope compat gates/docs, and the post-#557 checkpoint is `main@7c0f0fa3` with CI `24444895702`, Security Audit `24444895704`, and Build & Publish Docker Images `24444895701` green. PR #558 added mesh version UI and the lazy sidebar peer-version tooltip; post-#558 checks are tracked from `main@2bdd54f2` as CI `24445468284`, Security Audit `24445468249`, and Build & Publish Docker Images `24445468269`.

> Follow-up sync (2026-04-15): PR #527 completed the post-#526 checkpoint sync, PR #529 added backend-independent `/sessions/[id]` route smoke coverage for the ended-session detail shell and Memory tab session-scoped fact lookup, PR #528 added backend-independent `/memory/dashboard` route smoke coverage for sidebar/dashboard/KPI/recent-activity/decay-card composition, and PR #530 synced the row-level roadmap ledger after those E2E landings. At the post-#530 checkpoint, `main@536480ae` had green CI `24438180676`, Security Audit `24438180686`, and Build & Publish Docker Images `24438180685`; dev-1/dev-2, production deploy, and beta promotion workflows were untouched. Follow-up: PR #550-#552 delivered mesh peer ping/edit/registration groundwork, PR #554-#556 added machine provenance and version metadata, PR #557 delivered mesh envelope compat gates/docs, and the post-#557 checkpoint is `main@7c0f0fa3` with CI `24444895702`, Security Audit `24444895704`, and Build & Publish Docker Images `24444895701` green. PR #558 added mesh version UI and the lazy sidebar peer-version tooltip; post-#558 checks are tracked from `main@2bdd54f2` as CI `24445468284`, Security Audit `24445468249`, and Build & Publish Docker Images `24445468269`.

> Follow-up sync (2026-04-15): PR #532 added client-side URL-length validation with inline feedback to the webhooks and sync-peers create dialogs, PR #533 added backend-independent `/scheduler` Playwright coverage and moved it into the focused Web E2E CI lane, PR #536 removed the non-functional Edit action from Consolidation Board cards, PR #537 fixed agent-worker discovery of in-flight Codex sessions under `~/.codex/sessions/YYYY/MM/DD`, PR #538 added `aria-expanded` and action labels to approvals session expanders, PR #539 and PR #541 recorded roadmap/plan syncs for that landing set, PR #540 wrapped `/logs` plus `/settings` with the shared ErrorBoundary, PR #542 added an inline Accounts empty-state credential CTA plus `aria-describedby`/`aria-invalid`/`role="alert"` validation wiring, PR #543 synced the roadmap checkpoint after PR #541/#542, PR #544 reconciled the plan-directory status after PR #542, `main@a772d183` bumped the repository version to v0.4.0, and `main@431586df` fixed SIGPIPE handling in the version-bump commit-log walk. PR #546 moved the already-backend-independent `/settings` Playwright suite into the focused Web E2E CI gate. PR #547 registered the 33.7 mesh peer UX and 33.8 bidirectional-registration plans after the 2026-04-15 beta mesh incident, and PR #548 added concrete plan files plus roadmap/plan registry reconciliation. This follow-up fixes the 33.8 first-registration trust-model wording, clarifies that 33.8 should not block on the full 33.7 UX overhaul, and narrows 33.7 probe/cursor claims to match current code. At the post-#548 checkpoint, `main@33c53dc2` had green CI `24442215184`, Security Audit `24442215189`, and Build & Publish Docker Images `24442215191`; dev-1/dev-2, production deploy, and beta promotion workflows were untouched. Follow-up: PR #550-#552 delivered mesh peer ping/edit/registration groundwork, PR #554-#556 added machine provenance and version metadata, PR #557 delivered mesh envelope compat gates/docs, and the post-#557 checkpoint is `main@7c0f0fa3` with CI `24444895702`, Security Audit `24444895704`, and Build & Publish Docker Images `24444895701` green. PR #558 added mesh version UI and the lazy sidebar peer-version tooltip; post-#558 checks are tracked from `main@2bdd54f2` as CI `24445468284`, Security Audit `24445468249`, and Build & Publish Docker Images `24445468269`.

> Follow-up sync (2026-04-20): PR #649 repaired the scheduled Cleanup Old Docker Images workflow so missing GHCR packages are treated as a no-op instead of failing the run, and moved `actions/github-script` to v8. PR #650 pinned patched `@fastify/static` 9.1.1 through the root pnpm override, clearing Dependabot alerts #33/#34. PR #651 silenced expected `tailscale` CLI stderr in worker health reporting on hosts without the binary. At this checkpoint `main@4ecb7f54` reports 0 open code-scanning, Dependabot, and secret-scanning alerts; beta/dev CD workflows were not changed.

> Follow-up sync (2026-04-20): PR #662 added the already mock-based
> `session-config.spec.ts` slice to the focused Web E2E CI lane. The PR
> checks passed before merge, including Web E2E at 20 specs / 68 tests, CI,
> and Security Audit. PR #663 synced the post-#662 roadmap checkpoint, and
> post-#663 main CI, Security Audit, and Build & Publish passed. Beta/dev CD
> workflows were not changed.

> Follow-up sync (2026-04-23): after PR #738 landed on `main@9013a908`, CI
> `24826875928`, Security Audit `24826875919`, and Build & Publish Docker
> Images `24826875913` all passed, with 0 open code-scanning, Dependabot, or
> secret-scanning alerts. Docker publish still emitted a nonblocking Node.js 20
> deprecation annotation from `actions/attest-build-provenance@v2`; this
> follow-up upgrades the attestation action to the Node 24-backed `v4.1.0`
> without changing GHCR image tags, scanner behavior, or deploy-fleet
> verification semantics.
>
> Follow-up sync (2026-04-25): after PR #792 landed on `main@e2fd1b29`, the
> latest PR/CI/security sweep found 0 open code-scanning, Dependabot, and
> secret-scanning alerts. The focused Web E2E CI lane now runs 32 spec files /
> 118 executed tests after PR #762, PRs #765-#769, and PR #771 gated
> spaces/tasks detail, agent detail, emergency stop, tasks/spaces, task
> auto-decompose, machine terminal, memory import, and memory scopes coverage.
> Beta/dev CD workflows were not changed by this sync.
>
> Follow-up sync (2026-04-25): after PR #825 landed on `main@b36171aa`, the
> post-#825 main checks passed: CI `24920301524`, Security Audit
> `24920301538`, and Build & Publish Docker Images `24920301534`. PR #822
> refreshed production Docker apt layers plus the agent-worker libngtcp2
> runtime package/cache-bust path after post-#821 container scans emitted high
> vulnerability annotations, PR #823 pinned the production control-plane and
> agent-worker Node runtime images to 22.22.2 after the remaining Node 22.22.1
> Grype finding, and PR #825 made Docker publish Grype results report only
> vulnerabilities with fixed versions to match Trivy's ignore-unfixed policy.
> Open code-scanning, Dependabot, and secret-scanning alert feeds all report 0
> items. Dev-1/dev-2, production deploy, and beta promotion workflows were not
> changed.
>
> Follow-up sync (2026-04-25): after PR #827 and PR #828 landed on
> `main@751fb236`, the post-#828 main checks passed: CI `24921047042`,
> Security Audit `24921047049`, and Build & Publish Docker Images
> `24921047038`. PR #827 delivered the Memory Operations PR G
> consolidation/synthesis workers and coverage, and PR #828 delivered the
> MemoryInjector `full-drawer` mode. GitHub reported no open PRs during this
> sync, and code-scanning, Dependabot, and secret-scanning alert feeds all
> report 0 open alerts. Docker publish emitted only the known Grype DB cache
> reservation annotation. Dev-1/dev-2, production deploy, and beta promotion
> workflows were not changed.
>
> Follow-up sync (2026-04-25): after PR #830 landed on `main@d9f49985`, the
> post-#830 main checks passed: CI `24921680418`, Security Audit `24921680421`,
> and Build & Publish Docker Images `24921680432`. PR #830 delivered
> MemoryInjector additive evidence budget accounting for `fact-plus-snippet`
> and `full-drawer`. GitHub reported no open PRs during this sync, and
> code-scanning, Dependabot, and secret-scanning alert feeds all report 0 open
> alerts. Docker publish emitted only the known Grype DB cache reservation
> annotation. Dev-1/dev-2, production deploy, and beta promotion workflows were
> not changed.
>
> Follow-up sync (2026-04-25): after PR #832, PR #833, and PR #834 landed,
> `main@04158328` passed CI `24922781723`, Security Audit `24922781720`, and
> Build & Publish Docker Images `24922781722`. PR #832 delivered the Surface A
> `MEMORY.md` approval-token/durable-gate write path, PR #833 delivered private
> memory-eval changelog discipline, and PR #834 reconciled the roadmap/plan
> records after those landings. GitHub reported no open PRs during this sync,
> and code-scanning, Dependabot, and secret-scanning alert feeds all report 0
> open alerts. Docker publish emitted only the known Grype DB cache reservation
> annotation. Dev-1/dev-2, production deploy, and beta promotion
> workflows were not changed.
>
> Follow-up sync (2026-04-25): after PR #834 landed, `main@04158328` passed CI
> `24922781723`, Security Audit `24922781720`, and Build & Publish Docker
> Images `24922781722`. PR #834 synced roadmap and plan docs after PR
> #832/#833. GitHub reported no open PRs during this sync, and code-scanning,
> Dependabot, and secret-scanning alert feeds all report 0 open alerts.
> Dev-1/dev-2, production deploy, and beta promotion workflows were not
> changed.

---

### Task 1: Reproduce Current Control-Plane CI Failures — Completed on `main`

**Files:**
- Modify: `packages/control-plane/src/integration/dispatch-lifecycle.test.ts`
- Modify: `packages/control-plane/src/registry/db-registry.test.ts`
- Verify: `packages/control-plane/src/scheduler/task-worker.ts`

**Step 1: Run the smallest failing reproduction**

Run:

```bash
pnpm --filter @agentctl/control-plane vitest run \
  src/integration/dispatch-lifecycle.test.ts \
  src/registry/db-registry.test.ts
```

Expected: failures mentioning `job.updateData is not a function` and a stale `getRecentRuns()` expectation around `retryOf` / `retryIndex`.

**Step 2: Inspect the current implementation and tests**

Read:

```bash
sed -n '320,390p' packages/control-plane/src/scheduler/task-worker.ts
sed -n '620,730p' packages/control-plane/src/registry/db-registry.test.ts
sed -n '120,220p' packages/control-plane/src/integration/dispatch-lifecycle.test.ts
sed -n '240,320p' packages/control-plane/src/integration/dispatch-lifecycle.test.ts
sed -n '500,560p' packages/control-plane/src/integration/dispatch-lifecycle.test.ts
```

Expected: identify whether the worker should guard `updateData` for test doubles or whether the test mocks are outdated.

**Step 3: Implement the minimal root-cause fix**

- Either make `task-worker.ts` tolerant of BullMQ job doubles without `updateData`, or update the integration-test mock so it matches the real job contract.
- Update `db-registry.test.ts` so the asserted mapped run includes `retryOf` and `retryIndex`.

**Step 4: Verify the targeted tests**

Run:

```bash
pnpm --filter @agentctl/control-plane vitest run \
  src/integration/dispatch-lifecycle.test.ts \
  src/registry/db-registry.test.ts
```

Expected: PASS.

Delivered follow-through: merged on `main` as PR #167, with later route hardening follow-ups in PRs #170-#171 and loop-bound hardening in PR #173.

### Task 2: Fix Discover Sanitization CodeQL Alerts — Completed on `main`

**Files:**
- Modify: `packages/web/src/views/DiscoverPage.tsx`
- Modify: `packages/web/src/components/DiscoverSessionRow.tsx`
- Test: `packages/web/src/views/DiscoverPage.test.tsx`
- Test: `packages/web/src/components/DiscoverSessionRow.test.tsx`

**Step 1: Reproduce the existing sanitization behavior**

Run:

```bash
pnpm --filter @agentctl/web vitest run \
  src/views/DiscoverPage.test.tsx \
  src/components/DiscoverSessionRow.test.tsx
```

Expected: current tests pass but do not fully cover nested / reintroduced tag payloads reported by CodeQL.

**Step 2: Add focused failing tests for hostile summary strings**

Add cases covering strings like:

```ts
'<scr<script>ipt>alert(1)</scr<script>ipt>'
'<<script>bad</script>>'
```

Expected: sanitized display text contains no `<` or `>` remnants and still falls back to `Untitled` when empty.

**Step 3: Implement a stronger summary sanitizer**

- Replace the current one-pass tag-strip regex with a sanitizer that removes angle brackets or repeatedly strips tags until stable.
- Reuse the same helper where possible to keep Discover search, sort, and row display consistent.

**Step 4: Verify the targeted tests**

Run:

```bash
pnpm --filter @agentctl/web vitest run \
  src/views/DiscoverPage.test.tsx \
  src/components/DiscoverSessionRow.test.tsx
```

Expected: PASS.

Delivered follow-through: merged on `main` as PR #169. The security bug is fixed; remaining Discover work is now UX-level summary selection, not sanitization.

### Task 3: Historical Alert Triage Log, Follow-up Branch Queue, And Docs Sync — Completed on `main`

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/plans/2026-03-15-main-stability-and-security-cycle-plan.md`
- Review: `docs/plans/*.md`
- Modify: `packages/agent-worker/src/api/routes/agents.ts`
- Modify: `packages/agent-worker/src/api/routes/agents.test.ts`
- Review: `packages/agent-worker/src/runtime/cli-session-manager.ts`
- Review: `packages/agent-worker/src/runtime/discovery/*.ts`
- Review: `packages/agent-worker/src/api/routes/*.ts`

**Step 1: Capture the historical open-alert summary by type**

Run:

```bash
gh api 'repos/hahaschool/agentctl/code-scanning/alerts?state=open&per_page=100' \
  --jq '.[] | [.number, .rule.id, .most_recent_instance.location.path] | @tsv'
```

Expected: group alerts into actionable code fixes vs dependency/base-image findings vs likely false positives already using `sanitizePath`.

Current final state after PR #227 merged and DAST rerun `23131047045` succeeded:
- Discovery path alerts (`skill-discovery.ts`, `codex-mcp-discovery.ts`) are delivered on `main` via PR #176.
- Worktree-manager path alerts are delivered on `main` via PR #177.
- Agent-start rate limiting is delivered on `main` via PR #179.
- MCP discover file-read hardening is delivered on `main` via PR #180.
- The follow-up hardening batch is delivered on `main` via PRs #182-#185 (`path-security.ts`, `git.ts`, control-plane memory routes, and `loop-controller.ts`).
- The residual `path-security.ts` wrapper cleanup and the still-open `skill-discovery.ts` / `cli-session-manager.ts` path findings are delivered on `main` via PRs #187-#188.
- The first follow-up for the still-open `agents.ts`, control-plane memory-route, and `loop-controller.ts` findings landed via PRs #190-#192.
- The custom MCP preview source regression is delivered on `main` via PR #199.
- The modeled Fastify rate-limit follow-up is delivered on `main` via PR #200.
- Coordination-board visible worktree leases and claimed-branch metadata are delivered on `main` via PR #201.
- The shared local coordination board for multi-agent worktree claims and handoffs landed via PR #193.
- The agent-worker fd-write mock regression is fixed on `main` via PR #206.
- The control-plane and agent-worker modeled Fastify config follow-ups landed via PRs #207-#208.
- The remaining `path-security.ts` file-write findings are fixed on `main` via PR #209.
- The skipped Playwright coverage batch is enabled on `main` via PR #210.
- The instructions-strategy file-read follow-up is fixed on `main` via PR #217.
- The project-instructions preview bugfix landed on `main` via PR #218.
- The remaining `config-preview.ts` path-injection finding is fixed on `main` via PR #219.
- The targeted web regression coverage for `SkillsTab` / `ModelPromptsTab` landed on `main` via PR #220.
- The lingering Fastify rate-limit alerts were dismissed as CodeQL modeling false positives after the latest green `main` Security Audit.
- The stale BusyBox/ssl_client Grype findings were dismissed after PR #205 moved current runtime images to `bookworm-slim`.
- PR #373 restored the 2026-04-01 Security Audit/nightly gitleaks + remote-error-sanitization follow-up on the latest `main` base.
- PR #380 landed the remaining targeted `brace-expansion` overrides, historical gitleaks fingerprint ignores, and latest-main `scripts/agentctl.ts` alert closure on `main`.
- PR #385 upgraded the remaining `pnpm/action-setup` workflow uses to `v5`, clearing the final Node20 deprecation warnings in the CI/security/promote-beta workflow set.
- PR #386 landed the explicit sync pull/ack rate limiting that closed CodeQL alert `#560` on current `main`.
- PR #388 closed the final reopened `scripts/agentctl.ts` log-injection alert after PR #387's intermediate follow-up on the same latest-main security loop.
- PR #389 added focused Playwright coverage for the already-delivered `/conflicts` page and session `Config` tab on top of the now-green security baseline.
- PR #390 synced `docs/ROADMAP.md` and this plan to the post-#389 green baseline.
- PRs #410/#413 plus formal GitHub dismissal closed the manual-takeover GET route CodeQL `#579` false positive with a narrow suppression marker and source-shape coverage, keeping the real `@fastify/rate-limit` preHandler before authorization while using CodeQL's standalone source-suppression format.
- PRs #411/#414 repaired the pre-existing AgentsPage/AgentDetailPage targeted failures and the remaining web test setup/query mock drift.
- PR #415 added focused `/memory/reports` Playwright coverage for generation success/failure flows.
- PR #416 surfaced existing backend security findings in the Logs UI with API/query/view coverage.
- PR #417 improved StatusBadge tooltips, labels, and screen-reader descriptions for known lifecycle/status values.
- PR #418 added focused NotificationBell pending-approvals Playwright coverage for allow-once, allow-for-session, deny, and empty states.
- PR #419 reconciled stale plan status banners and indexed the orphan promote-beta CD gate reality-sync plans.
- PR #420 cleared the residual @agentctl/web unit failures and restored the full web Vitest suite on current `main`.
- PR #422 aligned the NotificationBell pending-approvals e2e assertions with the more descriptive aria labels introduced during the web unit cleanup.
- PR #423 added explicit `@fastify/rate-limit` coverage to the OAuth PKCE initiate/callback/refresh routes, closing the unauthenticated memory-flow allocation, redirect probing, and outbound token-refresh amplification gap.
- PR #426 tightened SessionHeader and DashboardQuickActions accessibility labels/titles without changing runtime behavior.
- PR #427 added explicit `@fastify/rate-limit` coverage to the accounts credential-listing and create/update/delete routes, closing the local encrypted credential store abuse gap with `ACCOUNTS_RATE_LIMIT_*` overrides.
- PR #429 added explicit `@fastify/rate-limit` coverage to the account verification test route, preventing repeated credential decrypt and outbound provider probes before `POST /api/settings/accounts/:id/test` enters provider-specific logic.
- PR #431 added focused Playwright coverage for the `/mesh-peers` page render, empty, ping-success, and ping-failure states.
- PR #445 moved the backend-independent `/webhooks` Playwright slice into CI so browser coverage now gates pull requests instead of remaining only a local/manual check.
- PR #447 added mobile-push device validation negative tests for invalid methods, malformed JSON, invalid tokens/platforms, oversized route params, and deactivate error paths.
- PR #448 tightened batch-2 input validation across `webhooks`, `permission-requests`, `approvals`, `handoffs`, `sync-conflicts`, and `memory-facts`, including enum checks, pagination bounds, source-size limits, and focused 400-path coverage.
- PRs #461/#462/#465/#466 extended backend-independent memory browser coverage across the `/memory` index, consolidation board, scopes manager, and knowledge graph.
- PR #467 added the webhook delivery-history viewer over the existing delivery-list route with focused WebhookDeliveriesPanel unit coverage.
- PR #468 added backend-independent browser coverage for dynamic `/spaces/[id]` and `/tasks/[id]` detail routes.
- PR #529 added backend-independent browser route-smoke coverage for `/sessions/[id]`, covering the ended-session detail shell, message render, and Memory tab session-scoped fact query.
- PR #528 added backend-independent browser route-smoke coverage for `/memory/dashboard`, covering the MemorySidebar active state, dashboard KPI cards, recent activity, and MemoryDecayCard composition.
- PR #391 added direct control-plane route coverage for the session `dispatch-config` endpoint and `sync-conflicts` list/detail/resolve/count handlers on current `main`.
- The direct `72c618c6` follow-up added `docs/QUICKSTART-MESH.md` for the already-delivered mesh bootstrap flow.
- PRs #398/#400/#401/#402 cleared the 2026-04-13 dependency-audit and DAST WebSocket fuzz follow-ups, and PR #404 synced this status back into roadmap/plans.
- PR #222 landed on `main` to address the scheduled DAST target bootstrap failure by bundling control-plane drizzle migrations during build.
- PR #223 landed on `main` to align the workflow/local PostgreSQL images with `pgvector`.
- PR #226 landed on `main` to move the generated OpenAPI target into the ZAP-mounted workspace path.
- PR #227 landed on `main` to make each local-mode scan job bootstrap the control-plane on the same runner that performs the scan.
- PR #230 landed on `main` to surface dev-tier health/PM2 deployment metrics and to restore the config-preview build/test semantics after the workspace-scope MCP source change.
- The post-merge DAST rerun `23131047045` completed successfully; treat DAST recovery as complete for this cycle.

**Step 2: Update roadmap status to match this cycle**

- Record the current `main` CI issue and its fix status only after verification.
- Align roadmap text with any newly delivered security or stability work.
- Check whether any recent delivered items are still listed as open.

**Step 3: Verify plan/roadmap consistency**

Run:

```bash
rg -n "Status note|PR #" docs/ROADMAP.md
find docs/plans -maxdepth 1 -type f | sort
```

Expected: no obvious mismatch between delivered features, open items, and plan artifacts created in this cycle.
