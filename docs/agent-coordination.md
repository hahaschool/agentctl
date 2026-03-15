# Agent Coordination Board

The coordination board is a lightweight local mechanism for multiple agents sharing one repository clone.

## Why It Exists

- prevent active worktrees from being deleted as "stale"
- provide one shared bulletin board for handoffs and warnings
- keep coordination local and inspectable until the future multi-agent platform replaces it

## Shared State Location

The board lives under:

```text
$(git rev-parse --git-common-dir)/agentctl/coordination/
```

That means every worktree in the same repository clone sees the same `claims.json` and `board.ndjson`.

Each claimed worktree also gets a visible lease file at:

```text
<worktree>/.agentcoord.json
```

The common-dir board is the shared bulletin board; the per-worktree lease file is the "do not delete me" marker for humans and cleanup scripts scanning directories directly.

## Commands

```bash
pnpm coord status
pnpm coord claim --type worktree --purpose "fix PR 190 follow-up"
pnpm coord heartbeat --type worktree
pnpm coord post --kind handoff --message "PR 190 waiting on Security Audit" --resource-id pr:190
pnpm coord release --type worktree
pnpm coord prune
```

## Recommended Usage

### Start work in a worktree

```bash
pnpm coord status
pnpm coord claim --type worktree --purpose "review PR 191"
```

### Leave a note for another agent

```bash
pnpm coord post --kind handoff --message "roadmap sync should wait for PR 192 merge"
```

### Finish and release

```bash
pnpm coord release --type worktree
```

### Take over a stale claim intentionally

```bash
pnpm coord claim --type worktree --purpose "resume abandoned work" --steal
pnpm coord release --type task --id task:blocked-cleanup --force
```

## Cleanup Model

- `claim` locks the worktree with `git worktree lock`
- `claim` also writes `.agentcoord.json` into the claimed worktree root with owner, purpose, branch, and heartbeat metadata
- `release` unlocks it and marks the claim released
- `heartbeat` refreshes both the central claim and the visible worktree lease file
- `heartbeat` and `prune` are secondary maintenance commands; the core workflow is `status`, `claim`, `post`, and `release`
- `prune` cleans released or missing claims and marks old active claims stale
- `prune` does not force-delete worktrees

## Current Limit

This first version governs local agent and human worktree habits. Existing background worker cleanup code in the runtime does not yet consult the board, so the board should currently be treated as the shared protocol for Claude/Codex/manual workflows, not as a universal enforcement layer.
