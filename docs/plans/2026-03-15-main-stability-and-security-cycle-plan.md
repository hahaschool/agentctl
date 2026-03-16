# Main Stability And Security Cycle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore `main` CI health, remove the highest-value open security regressions, and then update roadmap/plan documents to match the codebase state.

**Architecture:** Keep this cycle narrow and evidence-driven. First reproduce the current control-plane failures locally and fix only the root causes. Then address the actionable open CodeQL alerts in small, isolated batches so parallel work can land without overlapping files.

**Tech Stack:** pnpm workspace, Vitest, Fastify, Next.js, TypeScript, GitHub Actions, CodeQL

> Status note (2026-03-16): this stabilization/security wave is now complete on `main` for the CI + CodeQL + Dependabot + DAST backlog through PR #230. Earlier fixes (#167, #169-#201) restored the reproduced CI regressions, hardened the path/discovery/worktree surfaces, landed the coordination board, and added the modeled Fastify follow-ups that still left CodeQL blind to Fastify-specific rate limiting. The later batch then fixed the agent-worker fd-write test regressions (PR #206), landed the control-plane and agent-worker modeled Fastify route updates on `main` (PRs #207-#208), resolved the remaining `path-security.ts` file-write findings (PR #209), enabled the skipped Playwright coverage batch (PR #210), hardened the instructions-strategy/config-preview instruction-read surfaces (PRs #217 and #219), added targeted web regression coverage for the CLAUDE.md strategy settings flow (PR #220), bundled control-plane drizzle migrations during build for the scheduled DAST bootstrap path (PR #222), aligned the DAST/bootstrap PostgreSQL images with `pgvector` (PR #223), moved the generated OpenAPI target into the ZAP-mounted workspace (PR #226), moved local DAST bootstrap onto the same runners that execute the scans (PR #227), and then fixed the follow-on config-preview build/test regression while surfacing dev-tier health/PM2 deployment metrics in PR #230. The post-merge DAST rerun `23131047045` succeeded. After the latest green Security Audit/CodeQL pass, the lingering Fastify rate-limit findings remain dismissed as CodeQL modeling false positives and the stale old-Alpine Grype findings remain dismissed because current `main` uses `bookworm-slim` images. There are currently no open PRs, CodeQL alerts, or Dependabot alerts on `main`.

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
- There is no remaining open PR, CodeQL, or Dependabot backlog from this cycle on `main`.
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
