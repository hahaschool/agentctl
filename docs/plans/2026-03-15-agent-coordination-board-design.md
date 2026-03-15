# Agent Coordination Board Design

**Date**: 2026-03-15
**Status**: Approved by maintainer direction ("you decide", keep it lightweight and internal)
**Scope**: Local multi-agent coordination across Claude Code, Codex, and future internal agents sharing one Git repository

## Problem

Multiple agents are now working in parallel in this repository. They can interfere with each other in two ways:

1. An active worktree can be mistaken for a stale worktree and removed while still in use.
2. Coordination needs extend beyond worktrees: agents may need to post handoff notes, warnings, ownership notices, or cleanup state for other in-flight work.

The solution needs to stay lightweight because this is an internal workflow, but it must be robust enough that every agent can use the same mechanism.

## Options Considered

### Option A: Worktree-only registry file in the repository

- **Pros**: very small, easy to inspect
- **Cons**: only solves one resource type, causes merge noise if committed, and is awkward when multiple worktrees need to share one file

### Option B: Shared coordination board in Git common dir with claims + announcements

- **Pros**: one shared location for all worktrees, no merge conflicts, covers worktrees and future coordination needs, easy to script
- **Cons**: requires a small helper CLI and file-locking logic

### Option C: Control-plane-backed coordination service

- **Pros**: strongest long-term architecture, remote visibility, richer policy possible
- **Cons**: overkill for the immediate problem and too slow for this security-fix cycle

## Decision

Choose **Option B**.

The first implementation will create a small coordination subsystem stored under the repository's **Git common dir**, not under an individual worktree. This gives every worktree the same shared state without requiring a backend service.

## Goals

- Prevent active worktrees from being deleted accidentally during local cleanup.
- Give every agent one shared "bulletin board" for warnings, handoffs, and operational notes.
- Support future resource claims beyond worktrees without changing the basic shape.
- Keep the runtime local-file-based, inspectable, and easy to replace later with a control-plane lease service.

## Non-Goals

- Real-time messaging or push notifications
- Remote synchronization across machines
- Full task orchestration or scheduling
- Automatic force-deletion of worktrees
- Rewiring every existing runtime cleanup path in the same change

## Architecture

### Shared State Root

All shared state lives under:

```text
$(git rev-parse --git-common-dir)/agentctl/coordination/
```

This location is shared by all worktrees in the same repository clone and is naturally excluded from git history.

### Files

#### `claims.json`

Current active or recently released resource claims.

Each claim contains:

- `resourceId`: stable key such as `worktree:/abs/path` or `task:security-batch`
- `resourceType`: `worktree`, `task`, `pr`, or `note-scope`
- `owner`: agent identifier, e.g. `claude-21`, `codex-64`, or fallback to `$USER`
- `purpose`: short human-readable reason
- `status`: `active`, `released`, or `stale`
- `claimedAt`
- `heartbeatAt`
- `releasedAt`
- `metadata`: branch, path, PR number, or free-form extra details

#### `board.ndjson`

Append-only announcement stream for cross-agent communication.

Each line contains:

- `id`
- `createdAt`
- `author`
- `kind`: `note`, `warning`, `handoff`, `cleanup`, `blocked`
- `message`
- `resourceId` (optional)
- `metadata` (optional)

### Helper CLI

Add a lightweight script:

```text
scripts/agent-coord.ts
```

Supported commands:

- `status`
  - Show active claims and recent board posts
- `claim`
  - Claim a resource; for worktrees, auto-detect current worktree if omitted
- `release`
  - Mark a claim released; for worktrees, unlock the git worktree
- `post`
  - Append a board message without creating a claim
- `heartbeat`
  - Secondary maintenance command for long-lived claims
- `prune`
  - Admin-style cleanup command that marks expired claims stale and removes released-or-missing claims from `claims.json`

### Worktree-Specific Safety

When `claim` targets a worktree:

1. Resolve the current worktree path.
2. Write or update the claim in `claims.json`.
3. Run `git worktree lock` with a reason including owner and purpose.

When `release` targets a worktree:

1. Mark the claim as `released`.
2. Run `git worktree unlock`.
3. Do **not** delete the worktree automatically.

Default ownership rules:

- Active claims are exclusive by `resourceId`.
- Only the owner may `heartbeat` or `release` a claim.
- Explicit override flags are required for takeover or forced release.

### Cleanup Policy

`prune` stays conservative:

- It may remove registry entries for released claims or missing paths.
- It may mark long-idle active claims as `stale`.
- It does **not** force-remove active worktrees.
- Worktree deletion remains an explicit human or agent action after reviewing `status`.

This is deliberate. The immediate problem was accidental deletion, so the first version biases toward preserving state, not reclaiming it aggressively.

## Concurrency Model

Because multiple agents may update the board at once, writes need a local lock.

Implementation approach:

- Create a lock directory like `coordination/.lock`
- Retry briefly with backoff until the lock is acquired
- Write JSON updates through a temp file + atomic rename
- Always clean up the lock in a `finally` block

This is sufficient for same-machine internal concurrency without adding a database.

## Adoption Plan

To ensure every agent actually uses the mechanism:

1. Add a repository `AGENTS.md` section that instructs agents to run `status` before work and `claim` before creating or reusing a worktree.
2. Document the workflow in a short `docs/agent-coordination.md`.
3. Keep the CLI dependency-free beyond the existing repo TypeScript/tsx tooling so Claude Code and Codex can both run it immediately.

## Future Evolution

This design leaves a clean migration path:

- `claims.json` can map to a DB-backed lease table later
- `board.ndjson` can map to space events or a control-plane message stream
- `scripts/agent-coord.ts` can become a thin client over the future multi-agent collaboration platform

The file-based version is intentionally shaped like a small local prototype of the later control-plane concept.

## Known Limitation

This v1 primarily protects local human-and-agent workflows that adopt the coordination protocol (`status`, `claim`, `post`, `release`). Existing background runtime cleanup paths are not yet wired into the board, so the initial rollout should be understood as a coordination layer first, not universal enforcement.
