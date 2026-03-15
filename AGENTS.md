# Agent Coordination Protocol

All local agents working in this repository should use the shared coordination board before starting or cleaning up parallel work.

## Required Workflow

1. Run `pnpm coord status` before creating, reusing, or deleting a worktree.
2. Run `pnpm coord claim --type worktree --purpose "<what you are doing>"` when you start using a worktree.
3. Use `pnpm coord post --kind handoff|warning|blocked|cleanup --message "<note>"` for cross-agent communication that should outlive chat context.
4. Run `pnpm coord heartbeat --type worktree` only if a long-lived claim needs to stay visibly active.
5. Run `pnpm coord release --type worktree` when you are done with the worktree.

## Safety Rules

- Do not delete a worktree without checking `pnpm coord status`.
- Do not assume an inactive-looking worktree is stale unless it is released or clearly abandoned in the coordination board.
- Do not release or unlock another agent's claim unless you are intentionally taking over with an explicit override.
- Treat the coordination board as the shared source of truth for local multi-agent work.

## Notes

- Shared state is stored under the Git common dir, so all worktrees in this clone see the same board.
- Worktree claims also lock the git worktree to reduce accidental removal.
