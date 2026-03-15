# Agent Coordination Board Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a lightweight shared coordination board so multiple local agents can safely claim worktrees, post handoffs, and avoid deleting active work.

**Architecture:** Store shared state under the Git common dir so every worktree sees one board. Use a small TypeScript CLI plus atomic file updates and a local lock directory. Worktree claims also lock/unlock the underlying git worktree.

**Tech Stack:** TypeScript, Node.js fs/path APIs, `tsx`, `vitest`, git CLI

---

### Task 1: Add the coordination design docs

**Files:**
- Create: `docs/plans/2026-03-15-agent-coordination-board-design.md`
- Create: `docs/plans/2026-03-15-agent-coordination-board-impl-plan.md`

**Step 1: Verify both docs describe the chosen lightweight design**

Run: `sed -n '1,220p' docs/plans/2026-03-15-agent-coordination-board-design.md`
Expected: shared Git common-dir board, claims, announcements, and lock/unlock workflow are all documented

**Step 2: Commit once implementation is complete**

```bash
git add docs/plans/2026-03-15-agent-coordination-board-design.md docs/plans/2026-03-15-agent-coordination-board-impl-plan.md
git commit -m "docs: add agent coordination board design"
```

### Task 2: Build coordination storage helpers

**Files:**
- Create: `scripts/agent-coord.ts`
- Test: `scripts/agent-coord.test.ts`

**Step 1: Write failing tests for path resolution and file locking helpers**

Cover:
- resolving `git common dir`
- initializing `agentctl/coordination/`
- atomic load/save of `claims.json`
- appending to `board.ndjson`

**Step 2: Run the targeted test file and verify it fails**

Run: `cd scripts && npx vitest run agent-coord.test.ts`
Expected: FAIL because helper functions do not exist yet

**Step 3: Implement the helper layer**

Add:
- shared-state root resolution
- lock-directory acquisition with retry
- atomic JSON write helper
- NDJSON append helper

**Step 4: Re-run the targeted test**

Run: `cd scripts && npx vitest run agent-coord.test.ts`
Expected: helper tests PASS

### Task 3: Implement the CLI commands

**Files:**
- Modify: `scripts/agent-coord.ts`
- Test: `scripts/agent-coord.test.ts`

**Step 1: Add failing tests for command behaviors**

Cover:
- `claim` writes an active claim
- `heartbeat` updates `heartbeatAt`
- `release` marks claim released
- owner mismatch blocks release unless forced
- `post` appends a board item
- `status` returns both claims and recent board items
- `prune` marks long-idle claims stale and drops released-or-missing entries

**Step 2: Run the targeted test file and verify failures**

Run: `cd scripts && npx vitest run agent-coord.test.ts`
Expected: FAIL on unimplemented command behavior

**Step 3: Implement the command layer**

Requirements:
- default owner from env or current user
- worktree resource auto-detection
- JSON output mode for future automation
- human-readable text output for direct terminal use

**Step 4: Re-run the targeted test**

Run: `cd scripts && npx vitest run agent-coord.test.ts`
Expected: PASS

### Task 4: Add git worktree safety integration

**Files:**
- Modify: `scripts/agent-coord.ts`
- Test: `scripts/agent-coord.test.ts`

**Step 1: Add failing tests for worktree claim/release**

Cover:
- `claim` invokes `git worktree lock`
- `release` invokes `git worktree unlock`
- worktree metadata stores path and branch
- prune never force-removes a worktree

**Step 2: Run the targeted test**

Run: `cd scripts && npx vitest run agent-coord.test.ts`
Expected: FAIL until the git command integration exists

**Step 3: Implement minimal git worktree integration**

Requirements:
- shell out via `execFile`
- include owner/purpose in the lock reason
- gracefully handle already-locked or already-unlocked states

**Step 4: Re-run the targeted test**

Run: `cd scripts && npx vitest run agent-coord.test.ts`
Expected: PASS

### Task 5: Make the mechanism discoverable by all agents

**Files:**
- Create: `AGENTS.md`
- Create: `docs/agent-coordination.md`
- Modify: `package.json`

**Step 1: Document the required workflow**

Document:
- run `status` before starting parallel work
- run `claim` before using or creating a worktree
- post a handoff or warning when blocking others
- run `release` when done

**Step 2: Add a package script alias**

Example:

```json
"coord": "tsx scripts/agent-coord.ts"
```

**Step 3: Run a focused docs and script sanity check**

Run: `node -p "require('./package.json').scripts.coord"`
Expected: prints the new script entry

### Task 6: Verify the end-to-end workflow

**Files:**
- Modify: `scripts/agent-coord.ts`
- Modify: `scripts/agent-coord.test.ts`
- Modify: `AGENTS.md`
- Modify: `docs/agent-coordination.md`

**Step 1: Run formatting and tests**

Run:

```bash
pnpm exec biome check scripts/agent-coord.ts scripts/agent-coord.test.ts AGENTS.md docs/agent-coordination.md docs/plans/2026-03-15-agent-coordination-board-design.md docs/plans/2026-03-15-agent-coordination-board-impl-plan.md
cd scripts && npx vitest run agent-coord.test.ts
```

Expected: all checks PASS

**Step 2: Dry-run the CLI locally**

Run:

```bash
pnpm tsx scripts/agent-coord.ts status --json
pnpm tsx scripts/agent-coord.ts post --kind note --message "coordination board initialized"
```

Expected: status returns valid JSON and the post command appends one board entry

**Step 3: Commit**

```bash
git add AGENTS.md docs/agent-coordination.md docs/plans/2026-03-15-agent-coordination-board-design.md docs/plans/2026-03-15-agent-coordination-board-impl-plan.md package.json scripts/agent-coord.ts scripts/agent-coord.test.ts
git commit -m "feat: add agent coordination board"
```
