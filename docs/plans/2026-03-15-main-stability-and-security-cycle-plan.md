# Main Stability And Security Cycle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore `main` CI health, remove the highest-value open security regressions, and then update roadmap/plan documents to match the codebase state.

**Architecture:** Keep this cycle narrow and evidence-driven. First reproduce the current control-plane failures locally and fix only the root causes. Then address the actionable open CodeQL alerts in small, isolated batches so parallel work can land without overlapping files.

**Tech Stack:** pnpm workspace, Vitest, Fastify, Next.js, TypeScript, GitHub Actions, CodeQL

> Status note (2026-04-13): this stabilization/security wave remains complete on `main` for the historical CI + CodeQL + Dependabot + DAST backlog through PR #230, with follow-on docs sync/consistency landed in PRs #232-#233. Earlier fixes (#167, #169-#201) restored the reproduced CI regressions, hardened the path/discovery/worktree surfaces, landed the coordination board, and added the modeled Fastify follow-ups that still left CodeQL blind to Fastify-specific rate limiting. The later batch then fixed the agent-worker fd-write test regressions (PR #206), landed the control-plane and agent-worker modeled Fastify route updates on `main` (PRs #207-#208), resolved the remaining `path-security.ts` file-write findings (PR #209), enabled the skipped Playwright coverage batch (PR #210), hardened the instructions-strategy/config-preview instruction-read surfaces (PRs #217 and #219), added targeted web regression coverage for the CLAUDE.md strategy settings flow (PR #220), bundled control-plane drizzle migrations during build for the scheduled DAST bootstrap path (PR #222), aligned the DAST/bootstrap PostgreSQL images with `pgvector` (PR #223), moved the generated OpenAPI target into the ZAP-mounted workspace (PR #226), moved local DAST bootstrap onto the same runners that execute the scans (PR #227), and then fixed the follow-on config-preview build/test regression while surfacing dev-tier health/PM2 deployment metrics in PR #230. The post-merge DAST rerun `23131047045` succeeded. The 2026-04-01 follow-up wave then re-closed the latest security regressions on the mesh-era `main` base through PRs #373, #380, and #385-#388. The 2026-04-13 loop cleared the drizzle, Vite, Next, and Anthropic SDK dependency-audit findings through PRs #398, #401, and #402, with local verification at `pnpm audit --audit-level=moderate` returning no known vulnerabilities; PR #400 fixed the DAST WebSocket fuzz job's missing pnpm setup so the ws-fuzz artifact path can run again; PR #404 reconciled the roadmap and plan after those fixes merged; PR #410 added the first manual-takeover GET route CodeQL `#579` false-positive suppression after PR #405 landed real route-local `@fastify/rate-limit` coverage before authorization; PR #411 repaired the pre-existing AgentsPage and AgentDetailPage targeted web test failures; PR #413 tightened the `#579` marker into CodeQL's documented standalone source-suppression format; PR #414 repaired the remaining web test setup/query mock drift; PR #415 added focused `/memory/reports` Playwright generation coverage; PR #416 exposed existing security findings in the Logs UI; PR #417 improved StatusBadge accessibility descriptions; PR #418 added focused NotificationBell pending-approvals Playwright coverage; PR #419 reconciled plan status drift; PR #420 cleared the residual web unit failures; PR #422 aligned the NotificationBell e2e assertions with #420's more descriptive pending-approval labels; PR #423 added explicit OAuth PKCE route rate limiting; PR #426 tightened SessionHeader and DashboardQuickActions accessibility labels/titles; PR #427 added explicit accounts route rate limiting for credential listing plus account create/update/delete write paths; and PR #429 added the missing account verification route-local limiter before credential decrypt/outbound provider checks. CodeQL `#579` was formally dismissed as a false positive after fresh `main` analysis still flagged the route-local `@fastify/rate-limit` shape. Before opening this docs-sync PR, GitHub reported 0 open PRs plus 0 open code-scanning, Dependabot, and secret-scanning alerts; latest feature-bearing `main` before this docs sync (`c2d2d9c0`) has successful CI, Security Audit, and Docker build workflows.

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
