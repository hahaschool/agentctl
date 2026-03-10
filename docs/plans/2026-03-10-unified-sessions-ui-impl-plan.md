# Unified Sessions UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Consolidate `/sessions` and `/runtime-sessions` into a single web session browser that defaults to `All`, while preserving separate backend session models and existing agent-session workflows.

**Architecture:** Reuse the existing `SessionsPage` as the canonical shell, introduce a unified frontend row model that combines agent sessions and runtime sessions, and render type-specific detail/actions inside the same page. Keep runtime APIs intact and retire `/runtime-sessions` by redirecting it to `/sessions?type=runtime`.

**Tech Stack:** TypeScript, React, Next.js App Router, TanStack Query, Vitest, Testing Library

---

### Task 1: Document the unified session row contract

**Files:**
- Create: `packages/web/src/views/unified-session-model.ts`
- Create: `packages/web/src/views/unified-session-model.test.ts`
- Reference: `packages/web/src/lib/api.ts`

**Step 1: Write the failing test**

Add tests for:
- mapping `Session` to `{ kind: 'agent' }`
- mapping `RuntimeSession` to `{ kind: 'runtime' }`
- shared `activityAt` derivation
- unified search terms including runtime-specific metadata

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/unified-session-model.test.ts
```

Expected: FAIL because the mapper module does not exist.

**Step 3: Write minimal implementation**

Create a normalized row model for shared list rendering and filtering.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/unified-session-model.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/web/src/views/unified-session-model.ts packages/web/src/views/unified-session-model.test.ts
git commit -m "refactor(web): add unified session row model"
```

### Task 2: Add session type filtering to SessionsPage

**Files:**
- Modify: `packages/web/src/views/SessionsPage.tsx`
- Modify: `packages/web/src/views/SessionsPage.test.tsx`

**Step 1: Write the failing test**

Cover:
- `Type` filter renders with `All`, `Agent`, `Runtime`
- default selection is `All`
- runtime rows appear when mixed data is present
- `Agent` filter hides runtime rows
- `Runtime` filter hides agent rows

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/SessionsPage.test.tsx
```

Expected: FAIL because the unified filter and mixed rendering do not exist.

**Step 3: Write minimal implementation**

Load runtime sessions alongside agent sessions and introduce top-level type filtering.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/SessionsPage.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/web/src/views/SessionsPage.tsx packages/web/src/views/SessionsPage.test.tsx
git commit -m "feat(web): add unified session type filtering"
```

### Task 3: Rehome runtime detail and handoff UI into SessionsPage

**Files:**
- Modify: `packages/web/src/views/SessionsPage.tsx`
- Modify: `packages/web/src/views/RuntimeSessionsPage.tsx`
- Modify: `packages/web/src/views/RuntimeSessionsPage.test.tsx`
- Possibly create: `packages/web/src/views/RuntimeSessionPanel.tsx`
- Possibly create: `packages/web/src/views/RuntimeSessionPanel.test.tsx`

**Step 1: Write the failing test**

Cover:
- selecting a runtime row in `/sessions` shows runtime-specific actions
- handoff preflight and handoff history still render
- runtime analytics and failure filters remain accessible inside the unified page

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/SessionsPage.test.tsx src/views/RuntimeSessionsPage.test.tsx
```

Expected: FAIL because runtime-specific detail UI is still isolated in `RuntimeSessionsPage`.

**Step 3: Write minimal implementation**

Extract runtime-specific detail/actions into a reusable panel and mount it from `SessionsPage` when a runtime row is selected.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/SessionsPage.test.tsx src/views/RuntimeSessionsPage.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/web/src/views/SessionsPage.tsx packages/web/src/views/RuntimeSessionsPage.tsx packages/web/src/views/RuntimeSessionsPage.test.tsx packages/web/src/views/RuntimeSessionPanel.tsx packages/web/src/views/RuntimeSessionPanel.test.tsx
git commit -m "feat(web): embed runtime session actions in sessions page"
```

### Task 4: Convert /runtime-sessions into a compatibility redirect

**Files:**
- Modify: `packages/web/src/app/runtime-sessions/page.tsx`
- Add or modify tests under `packages/web/src/app/runtime-sessions/`
- Modify: `packages/web/src/views/DashboardPage.tsx`
- Modify: `packages/web/src/views/DashboardPage.test.tsx`
- Modify: `packages/web/src/components/Sidebar.tsx`
- Modify tests as needed

**Step 1: Write the failing test**

Cover:
- `/runtime-sessions` redirects to `/sessions?type=runtime`
- dashboard and navigation routes point users at `/sessions` or `/sessions?type=runtime`

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/DashboardPage.test.tsx src/components/Sidebar.test.tsx
```

Expected: FAIL because links still point at `/runtime-sessions`.

**Step 3: Write minimal implementation**

Convert the route into a redirect and update navigation entry points.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/DashboardPage.test.tsx src/components/Sidebar.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/web/src/app/runtime-sessions/page.tsx packages/web/src/views/DashboardPage.tsx packages/web/src/views/DashboardPage.test.tsx packages/web/src/components/Sidebar.tsx packages/web/src/components/Sidebar.test.tsx
git commit -m "refactor(web): retire runtime sessions route"
```

### Task 5: Verify the unified browser end-to-end

**Files:**
- Modify only if verification exposes issues

**Step 1: Run focused tests**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/unified-session-model.test.ts src/views/SessionsPage.test.tsx src/views/RuntimeSessionsPage.test.tsx src/views/DashboardPage.test.tsx src/components/Sidebar.test.tsx
```

Expected: PASS.

**Step 2: Run broader web verification**

Run:
```bash
pnpm --filter @agentctl/web build
```

Expected: PASS.

**Step 3: Manual QA**

Verify:
- `/sessions` defaults to `All`
- runtime rows are discoverable without leaving the page
- agent workflows still behave as before
- `/runtime-sessions` lands on the runtime-filtered unified view

**Step 4: Commit**

```bash
git add packages/web/src/views packages/web/src/app/runtime-sessions packages/web/src/components docs/plans/2026-03-10-unified-sessions-ui-design.md docs/plans/2026-03-10-unified-sessions-ui-impl-plan.md docs/ROADMAP.md
git commit -m "docs: plan unified sessions ui"
```
