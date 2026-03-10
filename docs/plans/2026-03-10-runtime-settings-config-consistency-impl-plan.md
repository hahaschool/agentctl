# Runtime Settings and Config Consistency UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose machine-local Claude Code / Codex access and managed config consistency in the web settings UI so users can see runtime login state, open machine terminals, edit managed defaults, and sync drifted machines.

**Architecture:** Extend the existing settings page with a new `Claude & Codex` group composed of a machine-centric runtime access section and a config-centric consistency section. Reuse existing control-plane runtime-config routes and machine inventory APIs through new web API/query bindings rather than inventing new backend behavior.

**Tech Stack:** TypeScript, React, Next.js App Router, TanStack Query, Vitest, Testing Library

---

### Task 1: Add web runtime-config API bindings

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/api.test.ts`
- Modify: `packages/web/src/lib/queries.ts`
- Modify: `packages/web/src/lib/queries.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- `GET /api/runtime-config/defaults`
- `PUT /api/runtime-config/defaults`
- `GET /api/runtime-config/drift`
- `POST /api/runtime-config/sync`
- new query keys and query options

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/web test -- src/lib/api.test.ts src/lib/queries.test.ts
```

Expected: FAIL because runtime-config client methods and query helpers do not exist.

**Step 3: Write minimal implementation**

Add typed API methods and React Query helpers for runtime defaults, drift, and sync.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/web test -- src/lib/api.test.ts src/lib/queries.test.ts
```

Expected: PASS.

### Task 2: Add RuntimeAccessSection

**Files:**
- Create: `packages/web/src/views/RuntimeAccessSection.tsx`
- Create: `packages/web/src/views/RuntimeAccessSection.test.tsx`

**Step 1: Write the failing test**

Cover:
- machine cards render hostname and runtime status
- Claude/Codex actions are visible
- `Sync Config` calls the sync mutation with the active defaults version
- terminal/login links render correctly

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/RuntimeAccessSection.test.tsx
```

Expected: FAIL because the section does not exist.

**Step 3: Write minimal implementation**

Build a section that joins `machines` with `runtime-config/drift`, renders per-machine Claude/Codex cards, and provides:
- terminal deep-link
- Claude login command hint
- Codex login command hint
- refresh
- per-machine sync

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/RuntimeAccessSection.test.tsx
```

Expected: PASS.

### Task 3: Add RuntimeConsistencySection

**Files:**
- Create: `packages/web/src/views/RuntimeConsistencySection.tsx`
- Create: `packages/web/src/views/RuntimeConsistencySection.test.tsx`

**Step 1: Write the failing test**

Cover:
- defaults form loads current values
- save calls update defaults mutation
- drift table renders runtime rows
- sync drifted machines only sends unique drifted machine IDs

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/RuntimeConsistencySection.test.tsx
```

Expected: FAIL because the section does not exist.

**Step 3: Write minimal implementation**

Add a constrained defaults editor for:
- `instructions.userGlobal`
- `instructions.projectTemplate`
- `sandbox`
- `approvalPolicy`
- `environmentPolicy.inherit`
- `environmentPolicy.set`

Render drift rows beneath it with bulk sync action.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/RuntimeConsistencySection.test.tsx
```

Expected: PASS.

### Task 4: Integrate new sections into SettingsView

**Files:**
- Modify: `packages/web/src/views/SettingsView.tsx`
- Modify: `packages/web/src/views/SettingsView.test.tsx`

**Step 1: Write the failing test**

Cover:
- existing accounts group renamed to `Cloud API Accounts`
- new `Claude & Codex` group appears
- `RuntimeAccessSection` and `RuntimeConsistencySection` are mounted

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/SettingsView.test.tsx
```

Expected: FAIL because the new group and child sections are not present.

**Step 3: Write minimal implementation**

Update the settings layout and copy so cloud accounts and local runtimes are clearly separated.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/web test -- src/views/SettingsView.test.tsx
```

Expected: PASS.

### Task 5: Verify and clean up

**Files:**
- Modify only if verification reveals issues

**Step 1: Run focused tests**

Run:
```bash
pnpm --filter @agentctl/web test -- src/lib/api.test.ts src/lib/queries.test.ts src/views/RuntimeAccessSection.test.tsx src/views/RuntimeConsistencySection.test.tsx src/views/SettingsView.test.tsx
```

Expected: PASS.

**Step 2: Run build**

Run:
```bash
pnpm --filter @agentctl/web build
```

Expected: PASS.

**Step 3: Review UI copy and linking**

Manually verify:
- settings labels do not conflate API accounts and CLI runtime access
- terminal/login affordances are obvious
- drift statuses are legible

**Step 4: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/api.test.ts packages/web/src/lib/queries.ts packages/web/src/lib/queries.test.ts packages/web/src/views/RuntimeAccessSection.tsx packages/web/src/views/RuntimeAccessSection.test.tsx packages/web/src/views/RuntimeConsistencySection.tsx packages/web/src/views/RuntimeConsistencySection.test.tsx packages/web/src/views/SettingsView.tsx packages/web/src/views/SettingsView.test.tsx docs/plans/2026-03-10-runtime-settings-config-consistency-design.md docs/plans/2026-03-10-runtime-settings-config-consistency-impl-plan.md
git commit -m "feat(web): add runtime settings and config consistency UI"
```
