# Mesh / Runtime E2E Follow-up Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add targeted Playwright coverage for the already-delivered `/conflicts` resolution flows and session `Config` tab detail states so the recent mesh/runtime visibility surfaces have real end-to-end protection beyond shell and empty-state checks.

**Architecture:** Keep the scope on browser coverage for existing web surfaces. Extend `packages/web/e2e/conflicts.spec.ts` to exercise populated conflict rows, detail rendering, and resolution actions with deterministic mocked API responses. Extend `packages/web/e2e/session-config.spec.ts` to assert exact rendered config details, multi-run messaging, and redacted MCP metadata. Only harden the existing web page/component seams if the new specs expose a real deterministic gap; do not widen this follow-up into backend or product-scope changes.

**Tech Stack:** Playwright, Next.js App Router, React Query, existing `packages/web/e2e` request interception harness, Vitest only if page/component hardening becomes necessary.

---

## Scope Guardrails

- Cover the existing `/conflicts` and session-detail `Config` tab surfaces only.
- Reuse the current `packages/web/e2e` request mocking pattern before adding any new test harness plumbing.
- Do not expand this slice into new mesh APIs, backend route changes, or new runtime-config product behavior.
- If the browser coverage exposes a real UI seam, keep any hardening inside the existing web page/component files for that surface.

## Task 1: Add populated `/conflicts` resolution-flow coverage

**Files:**
- Modify: `packages/web/e2e/conflicts.spec.ts`
- Reference: `packages/web/src/views/ConflictsPage.tsx`
- Reference: `packages/web/src/components/ConflictDiffView.tsx`

**Step 1: Write the failing browser scenarios**

- Extend the conflicts spec so it no longer stops at page shell / empty state / filter visibility.
- Cover:
  - one populated response that renders the conflict list and detail pane after selection
  - one resolution action flow that issues the expected `PUT /api/sync/conflicts/:id/resolve` request
  - one merge-editor path that shows JSON validation feedback before a successful merge submission

**Step 2: Run the targeted e2e command and confirm it fails**

Run:

```bash
pnpm --filter @agentctl/web exec playwright test e2e/conflicts.spec.ts
```

Expected: FAIL on the new populated/detail/resolve assertions until the richer mocks and any minimal hardening are in place.

**Step 3: Implement the minimal test support**

- Add only the deterministic request interception and assertions needed for the populated conflict and resolve flows.
- If needed, add the smallest possible web-surface hardening inside `ConflictsPage.tsx` or `ConflictDiffView.tsx`.
- Do not change sync backend semantics or widen this slice into general conflict-management refactors.

**Step 4: Re-run the targeted e2e command**

Run:

```bash
pnpm --filter @agentctl/web exec playwright test e2e/conflicts.spec.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/e2e/conflicts.spec.ts \
  packages/web/src/views/ConflictsPage.tsx \
  packages/web/src/components/ConflictDiffView.tsx
git commit -m "test(web): deepen conflicts e2e coverage"
```

## Task 2: Add session `Config` tab detail-state coverage

**Files:**
- Modify: `packages/web/e2e/session-config.spec.ts`
- Reference: `packages/web/src/components/SessionConfigTab.tsx`
- Reference: `packages/web/src/views/SessionDetailView.tsx`

**Step 1: Write the failing browser scenarios**

- Extend the existing Config-tab spec so it asserts exact user-visible states instead of only tab visibility plus a broad loaded/empty fallback.
- Cover:
  - explicit no-run and pre-feature empty states
  - a populated config snapshot with model, permission, provider, strategy, tool restrictions, prompts, and MCP server metadata
  - the multi-run banner for sessions whose latest dispatch is one of several runs

**Step 2: Run the targeted e2e command and confirm it fails**

Run:

```bash
pnpm --filter @agentctl/web exec playwright test e2e/session-config.spec.ts
```

Expected: FAIL on the new exact-state assertions until the richer mocked responses and any minimal UI hardening are in place.

**Step 3: Implement the minimal test support**

- Add the smallest possible mocked dispatch-config payloads needed to cover the exact detail states.
- Keep the scope on the existing Config-tab rendering path.
- Only change `SessionConfigTab.tsx` or the session-detail view if the new browser coverage exposes a real deterministic gap.

**Step 4: Re-run the targeted e2e command**

Run:

```bash
pnpm --filter @agentctl/web exec playwright test e2e/session-config.spec.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/e2e/session-config.spec.ts \
  packages/web/src/components/SessionConfigTab.tsx \
  packages/web/src/views/SessionDetailView.tsx
git commit -m "test(web): deepen session config e2e coverage"
```

## Task 3: Sync roadmap and plan status after the e2e slice lands

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/plans/2026-04-01-mesh-runtime-e2e-follow-up-plan.md`

**Step 1: Verify scope stayed isolated**

- Confirm the implementation touched only the targeted web e2e specs and any minimal page/component hardening needed to stabilize them.
- Confirm it did not widen into mesh backend routes, runtime-config persistence, or unrelated browser suites.

**Step 2: Update roadmap + plan status**

- Mark the active priority and plan entry as delivered once both targeted specs land.
- Preserve the existing “delivered” status of sections 31.3 and 33.3 while noting that this follow-up added deeper browser coverage for the already-shipped surfaces.

**Step 3: Run lightweight doc verification**

Run:

```bash
git diff --check
rg -n "Mesh / Runtime E2E Follow-up|session Config tab detail states|resolution flows" \
  docs/ROADMAP.md docs/plans/2026-04-01-mesh-runtime-e2e-follow-up-plan.md
```

Expected: clean diff and matching roadmap/plan references.

**Step 4: Commit**

```bash
git add docs/ROADMAP.md docs/plans/2026-04-01-mesh-runtime-e2e-follow-up-plan.md
git commit -m "docs: register mesh runtime e2e follow-up"
```
