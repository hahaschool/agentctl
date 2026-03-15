# Main Stability And Security Cycle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore `main` CI health, remove the highest-value open security regressions, and then update roadmap/plan documents to match the codebase state.

**Architecture:** Keep this cycle narrow and evidence-driven. First reproduce the current control-plane failures locally and fix only the root causes. Then address the actionable open CodeQL alerts in small, isolated batches so parallel work can land without overlapping files.

**Tech Stack:** pnpm workspace, Vitest, Fastify, Next.js, TypeScript, GitHub Actions, CodeQL

> Status note (2026-03-15): the current stabilization/security wave is already on `main` through PR #193. Earlier fixes (#167, #169-#181) restored the reproduced control-plane regressions, Discover sanitization, and discovery/worktree hardening; the follow-up batch then landed `path-security.ts` wrappers (#182), `git.ts` hardening (#183), control-plane memory-route limiters (#184), and the loop-controller hard cap (#185). The residual cleanup batch then landed explicit `path-security.ts` wrapper guards plus `skill-discovery.ts` safe async reads (#187) and CLI session cwd sanitization (#188). A first residual follow-up then landed the agent-start route update (#190), the control-plane memory-route follow-up (#191), the loop timer follow-up (#192), and the shared agent coordination board (#193). `skill-discovery.ts` is out of the open-alert list, but `cli-session-manager.ts` still needs follow-up, and GitHub still reports the agent-start / control-plane rate-limit findings plus the loop-controller timer finding after PRs #190-#192. The remaining backlog is the still-open `path-security.ts` file-write findings, `cli-session-manager.ts`, modeled rate-limit follow-ups, the loop-controller timer finding, and dependency/base-image triage.

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

### Task 3: Triage Remaining High-Severity Alerts, Queue Follow-up Branches, And Update Docs

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/plans/2026-03-15-main-stability-and-security-cycle-plan.md`
- Review: `docs/plans/*.md`
- Modify: `packages/agent-worker/src/api/routes/agents.ts`
- Modify: `packages/agent-worker/src/api/routes/agents.test.ts`
- Review: `packages/agent-worker/src/runtime/cli-session-manager.ts`
- Review: `packages/agent-worker/src/runtime/discovery/*.ts`
- Review: `packages/agent-worker/src/api/routes/*.ts`

**Step 1: Summarize the remaining open alerts by type**

Run:

```bash
gh api 'repos/hahaschool/agentctl/code-scanning/alerts?state=open&per_page=100' \
  --jq '.[] | [.number, .rule.id, .most_recent_instance.location.path] | @tsv'
```

Expected: group alerts into actionable code fixes vs dependency/base-image findings vs likely false positives already using `sanitizePath`.

Current grouping after PR #193:
- Discovery path alerts (`skill-discovery.ts`, `codex-mcp-discovery.ts`) are delivered on `main` via PR #176.
- Worktree-manager path alerts are delivered on `main` via PR #177.
- Agent-start rate limiting is delivered on `main` via PR #179.
- MCP discover file-read hardening is delivered on `main` via PR #180.
- The follow-up hardening batch is delivered on `main` via PRs #182-#185 (`path-security.ts`, `git.ts`, control-plane memory routes, and `loop-controller.ts`).
- The residual `path-security.ts` wrapper cleanup and the still-open `skill-discovery.ts` / `cli-session-manager.ts` path findings are delivered on `main` via PRs #187-#188.
- The first follow-up for the still-open `agents.ts`, control-plane memory-route, and `loop-controller.ts` findings landed via PRs #190-#192, but GitHub still reports those alerts on `main`.
- The shared local coordination board for multi-agent worktree claims and handoffs landed via PR #193.
- The expected remaining backlog is the still-open `path-security.ts`, `cli-session-manager.ts`, `agents.ts`, control-plane memory-route, and `loop-controller.ts` findings plus BusyBox CVEs and the `pm2` advisory.

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
