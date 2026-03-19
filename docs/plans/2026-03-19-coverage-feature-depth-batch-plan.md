# Coverage & Feature Depth Batch Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **Status update (2026-03-19):** Task 1-5 are now delivered on `main` via PRs #259, #256, #261, #258, and #257. Section 20.2 and 20.3 landed in parallel via PRs #266 and #265. The remaining section-20 follow-up is 20.4 Memory Dashboard route activation.

**Goal:** Land the highest-value backlog from roadmap section 20 without destabilizing `main`, starting with isolated control-plane route coverage that can run in parallel and merge cleanly.

**Architecture:** Split work by route file and keep each task self-contained in its own worktree, branch, and test file. Avoid shared helper churn unless a task is blocked; route tests should prefer file-local mocks so five subagents can work concurrently without merge conflicts.

**Tech Stack:** pnpm workspace, Vitest, Fastify, TypeScript, Git worktrees, GitHub Actions

---

## Batch Rules

- One worktree per task under `.trees/`.
- Run `pnpm coord status` before creating more worktrees and `pnpm coord claim --type worktree --purpose "..."` inside each new worktree.
- Do not modify `packages/control-plane/src/api/routes/test-helpers.ts` unless blocked; prefer file-local mocks/stubs.
- Verification should stay targeted. Run the new route test file plus package-level lint/build only if the task touches shared code.

### Task 1: `spaces.ts` Route Coverage

**Files:**
- Modify: `packages/control-plane/src/api/routes/spaces.ts`
- Create: `packages/control-plane/src/api/routes/spaces.test.ts`

**Step 1: Write the failing test**

Add route-level tests covering:

```ts
it('creates a space with trimmed name and defaults', async () => {});
it('returns 400 for invalid name / createdBy / type / visibility', async () => {});
it('returns 404 when a space or member target is missing', async () => {});
it('rolls back invalid DAG-like edge cases in thread/event membership flows only through route errors', async () => {});
```

Focus on CRUD, member add/remove, filter update, thread creation/listing, and event listing/posting paths that currently have zero coverage.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/spaces.test.ts
```

Expected: FAIL because the test file is new or mocks are incomplete.

**Step 3: Write minimal implementation**

- Keep production changes minimal.
- Only patch `spaces.ts` if tests reveal real route bugs or mismatched error handling.
- Use file-local `vi.fn()` mocks for `spaceStore`, `threadStore`, and `eventStore`.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/spaces.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/spaces.ts packages/control-plane/src/api/routes/spaces.test.ts
git commit -m "test(control-plane): cover spaces routes"
```

### Task 2: `task-graphs.ts` Route Coverage

**Files:**
- Modify: `packages/control-plane/src/api/routes/task-graphs.ts`
- Create: `packages/control-plane/src/api/routes/task-graphs.test.ts`

**Step 1: Write the failing test**

Add tests for:

```ts
it('creates and fetches a graph with definitions and edges', async () => {});
it('returns 400 for invalid graph names, node types, and edge types', async () => {});
it('rolls back an added edge when DAG validation fails', async () => {});
it('returns ready definitions from completed run state', async () => {});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/task-graphs.test.ts
```

Expected: FAIL until the mock store behavior is wired correctly.

**Step 3: Write minimal implementation**

- Prefer route-only tests with mocked `taskGraphStore` and `taskRunStore`.
- If a production bug appears, keep the fix inside `task-graphs.ts` and avoid unrelated refactors.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/task-graphs.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/task-graphs.ts packages/control-plane/src/api/routes/task-graphs.test.ts
git commit -m "test(control-plane): cover task graph routes"
```

### Task 3: `memory-reports.ts` Route Coverage

**Files:**
- Modify: `packages/control-plane/src/api/routes/memory-reports.ts`
- Create: `packages/control-plane/src/api/routes/memory-reports.test.ts`

**Step 1: Write the failing test**

Add tests for:

```ts
it('lists cached reports newest-first', async () => {});
it('generates project-progress / knowledge-health / activity-digest reports', async () => {});
it('returns 400 for invalid report type or time range', async () => {});
it('evicts oldest cached reports when the cache exceeds capacity', async () => {});
```

Mock `pool.query` results directly and reset the module cache using `resetReportCacheForTest()`.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/memory-reports.test.ts
```

Expected: FAIL until the report-cache and SQL mock expectations are correct.

**Step 3: Write minimal implementation**

- Keep fixes localized to `memory-reports.ts`.
- Preserve the current in-memory cache contract; do not redesign persistence in this batch.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/memory-reports.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/memory-reports.ts packages/control-plane/src/api/routes/memory-reports.test.ts
git commit -m "test(control-plane): cover memory reports routes"
```

### Task 4: `notification-preferences.ts` Route Coverage

**Files:**
- Modify: `packages/control-plane/src/api/routes/notification-preferences.ts`
- Create: `packages/control-plane/src/api/routes/notification-preferences.test.ts`

**Step 1: Write the failing test**

Add tests for:

```ts
it('lists and fetches user notification preferences', async () => {});
it('creates a preference with valid channels and quiet hours', async () => {});
it('returns 400 for invalid userId / priority / channels / quiet-hour format', async () => {});
it('maps store not-found and generic failures to 404/500 responses', async () => {});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/notification-preferences.test.ts
```

Expected: FAIL until the mock store and route wiring are in place.

**Step 3: Write minimal implementation**

- Use a file-local mock `notificationRouterStore`.
- Only change route code if validation or error mapping is actually wrong.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/notification-preferences.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/notification-preferences.ts packages/control-plane/src/api/routes/notification-preferences.test.ts
git commit -m "test(control-plane): cover notification preference routes"
```

### Task 5: `agent-profiles.ts` Route Coverage

**Files:**
- Modify: `packages/control-plane/src/api/routes/agent-profiles.ts`
- Create: `packages/control-plane/src/api/routes/agent-profiles.test.ts`

**Step 1: Write the failing test**

Add tests for:

```ts
it('creates, fetches, lists, and deletes profiles', async () => {});
it('validates runtimeType, modelId, providerId, and instance status', async () => {});
it('returns 404 for missing profiles and instances', async () => {});
it('creates, updates, lists, and deletes instances under a profile', async () => {});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/agent-profiles.test.ts
```

Expected: FAIL until the mock store behavior is fully specified.

**Step 3: Write minimal implementation**

- Keep route changes minimal and local.
- Use file-local mock store methods and explicit `ControlPlaneError` cases.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/agent-profiles.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/agent-profiles.ts packages/control-plane/src/api/routes/agent-profiles.test.ts
git commit -m "test(control-plane): cover agent profile routes"
```

### Task 6: Batch Verification And Docs Sync

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/plans/2026-03-19-coverage-feature-depth-batch-plan.md`

**Step 1: Run the focused batch verification**

Run:

```bash
pnpm --filter @agentctl/control-plane test -- \
  src/api/routes/spaces.test.ts \
  src/api/routes/task-graphs.test.ts \
  src/api/routes/memory-reports.test.ts \
  src/api/routes/notification-preferences.test.ts \
  src/api/routes/agent-profiles.test.ts
```

Expected: PASS.

**Step 2: Update roadmap status**

- Mark section 20.1 as delivered with the merged PR references.
- Note that section 20.2 and 20.3 landed in parallel via PRs #266 and #265.
- Keep section 20.4 open until `/memory/dashboard` stops using `MemoryPlaceholderView`.

**Step 3: Commit docs sync**

```bash
git add docs/ROADMAP.md docs/plans/2026-03-19-coverage-feature-depth-batch-plan.md
git commit -m "docs: sync coverage batch roadmap status"
```
