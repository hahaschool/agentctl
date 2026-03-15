# Development Flow Rules (MANDATORY — All Agents)

These rules govern how code flows from development to production. Every AI agent MUST follow them.

## The Flow: Dev → Main → Dev Verify → Promote → Beta

```
Agent worktree → PR → merge to main → build in dev tier → verify → promote to beta
                                       ↑ NEVER skip this
```

### Step 1: Develop in Worktree (existing rule)

All write work happens in a git worktree on a feature branch. Code reaches main through a PR.

### Step 2: After PR Merges to Main — Build in Dev Tier

**NEVER rebuild beta directly from main.** After merging PRs to main:

```bash
# Switch to a dev environment (dev-1 or dev-2)
source .env.dev-1   # or .env.dev-2
./scripts/env-up.sh dev-1

# Build and run in dev tier
pnpm build
# Dev services start on dev-tier ports (not beta ports)
```

### Step 3: Verify in Dev Tier

Before promoting to beta, verify the changes work:

```bash
# Smoke test: API health
curl http://localhost:${DEV_CP_PORT}/health
curl http://localhost:${DEV_WORKER_PORT}/health

# Open dev frontend in browser and visually verify
# Run Playwright against dev tier if needed
```

### Step 4: Promote to Beta

Only after dev verification passes:

```bash
# Bump version + generate changelog
./scripts/version-bump.sh patch   # or minor / major

# Promote to beta
./scripts/env-promote.sh --from dev-1
```

### Step 5: Verify Beta

```bash
# Check beta is healthy
pm2 list
curl http://localhost:8080/health
```

## What Agents MUST NOT Do

| Action | Allowed? |
|--------|----------|
| `pnpm build` on main and `pm2 restart` beta | **NO — NEVER** |
| Push to main then immediately rebuild beta | **NO — NEVER** |
| Test changes by restarting beta services | **NO — use dev tier** |
| Skip dev verification before promoting | **NO — NEVER** |
| Commit directly to main (docs excluded) | **NO — use PR** |

## What Agents MAY Do

| Action | Allowed? |
|--------|----------|
| Push docs-only changes to main | Yes (no code, no build needed) |
| Run `env-up.sh dev-1` to test changes | Yes (preferred) |
| Run Playwright against dev tier | Yes |
| Promote after dev verification | Yes |

## Version Bumping

Every promotion to beta MUST include a version bump:

```bash
./scripts/version-bump.sh <patch|minor|major> "Brief description of changes"
```

This:
1. Bumps version in all `package.json` files
2. Appends entry to `CHANGELOG.md`
3. Creates a git tag `v<version>`
4. Commits the version bump

### When to Use Which Bump

| Change Type | Bump | Example |
|------------|------|---------|
| Bug fixes, minor adjustments | `patch` | 0.2.1 → 0.2.2 |
| New features, UI changes | `minor` | 0.2.2 → 0.3.0 |
| Breaking changes, major refactors | `major` | 0.3.0 → 1.0.0 |

## Beta Stability Contract

Beta is the developer's daily-use environment. It must be:
- **Always running** — `pm2 list` shows all 3 services online
- **Always buildable** — whatever is in beta builds and passes lint
- **Never broken by agent work** — agents use dev tiers, not beta
- **Versioned** — every beta deployment has a version number and changelog entry
