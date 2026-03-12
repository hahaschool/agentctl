# Git Discipline Rules (MANDATORY — All Agents)

These rules are always active. Every AI agent operating in this repository MUST follow them.

## The Cardinal Rule

**NEVER commit directly to main.** All write work happens in a worktree on a feature branch. Code reaches main ONLY through a merged Pull Request.

If you are on main and about to make changes, STOP. Create a worktree first:
```bash
git worktree add .trees/<name> -b agent/<id>/<type>/<topic>
cd .trees/<name>
```

## Before Any Write Operation

1. Verify you are NOT on main: `git branch --show-current` must NOT return `main`
2. If on main, create a branch immediately
3. If dispatched as a subagent, use `isolation: worktree` or create a worktree manually

## Branch Naming

```
agent/<agent-id>/<type>/<topic>
```

Always branch from main. Never branch from another agent's branch.

## Merge Protocol

- Only one agent merges at a time (merge serialization)
- Squash merge via PR: `gh pr merge --squash --delete-branch`
- Rebase feature branch onto latest main before opening PR
- CI (build + lint + tests) must pass before merge

## Commit Hygiene

Every commit must:
- Leave `pnpm build` passing
- Leave `pnpm lint` passing
- Not break existing tests
- Be pushed to remote immediately after

## Conflict Prevention

- `packages/shared/` changes go first — merge to main before downstream work starts
- Never dispatch parallel agents to the same files
- Rebase every 30-60 minutes on long sessions
