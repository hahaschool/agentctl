# Runtime-centric Settings Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the provider-centric settings page with a runtime-centric control plane that supports `claude-code` and `codex`, multi-machine visibility, runtime-aware defaults, and mixed managed/local access states.

**Architecture:** Introduce a runtime-centric settings view model and section layout in the web app first, then adapt shared model metadata and tests so the UI can express runtime profiles, worker/runtime inventory, and runtime switching policies without requiring a full backend migration in one diff.

**Tech Stack:** Next.js App Router, React, TypeScript, TanStack Query, shared TypeScript types, Vitest, Playwright.

---

### Task 1: Define runtime-centric settings view model

**Files:**
- Modify: `packages/web/src/lib/model-options.ts`
- Modify: `packages/shared/src/types/account.ts`
- Create: `packages/web/src/views/settings/types.ts`
- Test: `packages/web/src/lib/model-options.test.ts`

**Step 1: Write the failing test**

Add coverage that:

- runtime-specific model groups exist for `claude-code` and `codex`
- account source/custody metadata can represent `managed` and `discovered-local`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- model-options.test.ts`
Expected: FAIL because runtime-specific settings metadata does not exist yet.

**Step 3: Write minimal implementation**

Add:

- runtime-specific model groups and defaults in `model-options.ts`
- source/custody/status types in `packages/shared/src/types/account.ts`
- a small runtime-centric UI view-model module in `packages/web/src/views/settings/types.ts`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- model-options.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/lib/model-options.ts packages/shared/src/types/account.ts packages/web/src/views/settings/types.ts packages/web/src/lib/model-options.test.ts
git commit -m "feat: add runtime-centric settings view model"
```

### Task 2: Replace the settings page IA

**Files:**
- Modify: `packages/web/src/views/SettingsView.tsx`
- Create: `packages/web/src/views/settings/SettingsShell.tsx`
- Create: `packages/web/src/views/settings/SettingsOverviewSection.tsx`
- Create: `packages/web/src/views/settings/RuntimeProfilesSection.tsx`
- Create: `packages/web/src/views/settings/CredentialsAccessSection.tsx`
- Create: `packages/web/src/views/settings/WorkersSyncSection.tsx`
- Create: `packages/web/src/views/settings/RoutingAutonomySection.tsx`
- Test: `packages/web/src/views/SettingsView.test.tsx`

**Step 1: Write the failing test**

Update settings view tests to expect:

- left-side runtime-centric navigation
- sections named `Overview`, `Runtime Profiles`, `Credentials & Access`, `Workers & Sync`, `Routing & Autonomy`
- absence of the old `API Accounts` top-level group heading

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- SettingsView.test.tsx`
Expected: FAIL because the old sections still render.

**Step 3: Write minimal implementation**

Create the new settings shell and section components, wire them into `SettingsView`, and reuse existing data sources where possible.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- SettingsView.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/views/SettingsView.tsx packages/web/src/views/settings packages/web/src/views/SettingsView.test.tsx
git commit -m "feat: redesign settings information architecture"
```

### Task 3: Make runtime profiles first-class

**Files:**
- Modify: `packages/web/src/views/PreferencesSection.tsx`
- Modify: `packages/web/src/views/FailoverSection.tsx`
- Create: `packages/web/src/views/settings/RuntimeProfileCard.tsx`
- Test: `packages/web/src/views/PreferencesSection.test.tsx`
- Test: `packages/web/src/views/FailoverSection.test.tsx`

**Step 1: Write the failing test**

Add coverage that:

- settings show separate default models for `claude-code` and `codex`
- switching policy exposes `Locked`, `Failover only`, and `Optimization enabled`
- failover default is `Failover only`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- PreferencesSection.test.tsx FailoverSection.test.tsx`
Expected: FAIL because the UI still exposes a single global default model and old account failover wording.

**Step 3: Write minimal implementation**

Refactor preferences/failover concepts into runtime profile cards, with runtime-specific defaults and switching controls.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- PreferencesSection.test.tsx FailoverSection.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/views/PreferencesSection.tsx packages/web/src/views/FailoverSection.tsx packages/web/src/views/settings/RuntimeProfileCard.tsx packages/web/src/views/PreferencesSection.test.tsx packages/web/src/views/FailoverSection.test.tsx
git commit -m "feat: add runtime profile settings"
```

### Task 4: Surface mixed managed/local access states

**Files:**
- Modify: `packages/web/src/views/AccountsSection.tsx`
- Modify: `packages/web/src/views/ProjectAccountsSection.tsx`
- Create: `packages/web/src/views/settings/AccessStateBadge.tsx`
- Test: `packages/web/src/views/AccountsSection.test.tsx`
- Test: `packages/web/src/views/ProjectAccountsSection.test.tsx`

**Step 1: Write the failing test**

Add coverage that:

- credentials render with `managed`, `discovered-local`, or `takeover-pending` labels
- actions exist for `Add managed credential`, `Adopt discovered credential`, and `Reference local credential`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- AccountsSection.test.tsx ProjectAccountsSection.test.tsx`
Expected: FAIL because the old account list and dialog still render.

**Step 3: Write minimal implementation**

Refactor access UI to show source/custody state and split creation/adoption/reference flows in the presentation layer.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- AccountsSection.test.tsx ProjectAccountsSection.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/views/AccountsSection.tsx packages/web/src/views/ProjectAccountsSection.tsx packages/web/src/views/settings/AccessStateBadge.tsx packages/web/src/views/AccountsSection.test.tsx packages/web/src/views/ProjectAccountsSection.test.tsx
git commit -m "feat: expose managed and local runtime access states"
```

### Task 5: Add worker/runtime inventory presentation

**Files:**
- Create: `packages/web/src/views/settings/WorkerRuntimePanel.tsx`
- Modify: `packages/web/src/views/settings/WorkersSyncSection.tsx`
- Modify: `packages/web/src/lib/queries.ts`
- Test: `packages/web/src/views/settings/WorkersSyncSection.test.tsx`

**Step 1: Write the failing test**

Add coverage that:

- workers render runtime rows for `claude-code` and `codex`
- each row can show installed/authenticated/drift state
- action affordances for `Sync now` and `Inspect local access` exist

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- WorkersSyncSection.test.tsx`
Expected: FAIL because the workers sync section does not exist yet.

**Step 3: Write minimal implementation**

Create a worker/runtime inventory section fed by existing health/runtime-config data, with mocked placeholder state where the API does not yet provide a richer shape.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- WorkersSyncSection.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/src/views/settings/WorkerRuntimePanel.tsx packages/web/src/views/settings/WorkersSyncSection.tsx packages/web/src/lib/queries.ts packages/web/src/views/settings/WorkersSyncSection.test.tsx
git commit -m "feat: add worker runtime inventory to settings"
```

### Task 6: Verify and polish the redesign

**Files:**
- Modify: `packages/web/e2e/critical-flows.spec.ts`
- Modify: `packages/web/e2e/smoke.spec.ts`
- Modify: `packages/web/e2e/pages-load.spec.ts`

**Step 1: Write the failing test**

Update E2E assertions to expect the new runtime-centric sections and actions.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter web test:e2e --grep "Settings"`
Expected: FAIL because the page no longer matches the old structure.

**Step 3: Write minimal implementation**

Adjust selectors and copy-sensitive assertions to the new layout.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter web test:e2e --grep "Settings"`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/web/e2e/critical-flows.spec.ts packages/web/e2e/smoke.spec.ts packages/web/e2e/pages-load.spec.ts
git commit -m "test: update settings coverage for runtime-centric redesign"
```

### Task 7: Final verification and PR preparation

**Files:**
- Modify: `README.md` only if screenshots or settings copy references need updating

**Step 1: Run focused unit tests**

Run:

```bash
pnpm --filter web test -- SettingsView.test.tsx PreferencesSection.test.tsx FailoverSection.test.tsx AccountsSection.test.tsx ProjectAccountsSection.test.tsx
```

Expected: PASS

**Step 2: Run broader web verification**

Run:

```bash
pnpm --filter web test
pnpm --filter web lint
```

Expected: PASS

**Step 3: Run relevant E2E smoke coverage**

Run:

```bash
pnpm --filter web test:e2e --grep "Settings|page loads"
```

Expected: PASS

**Step 4: Review diff**

Run:

```bash
git diff --stat main...
git diff -- packages/web/src/views packages/web/src/lib packages/shared/src/types packages/web/e2e
```

Expected: focused runtime-centric settings redesign only.

**Step 5: Commit final polish**

```bash
git add -A
git commit -m "feat: redesign settings around managed runtimes"
```

**Step 6: Open PR**

Run:

```bash
gh pr create --fill --base main --head codex/settings-extension
```

Expected: PR URL returned.
