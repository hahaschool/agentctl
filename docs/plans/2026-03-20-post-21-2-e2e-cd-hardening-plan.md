# Post-21.2 E2E + CD Hardening Plan

> Goal: turn the post-21.2 backlog into three isolated follow-up slices that can run in parallel without touching the beta stage.

## Why This Batch

Roadmap 21.2 is now fully delivered on `main`, but two recently expanded user-facing surfaces still lack targeted browser coverage:

- `/approvals`, which is the operator path for reviewing approval gates
- `/deployment`, which is the control surface for dev-tier promotion into beta

Separately, the current promotion docs/workflow still contain avoidable footguns:

- `docs/USER-SETUP-CD-TIERS.md` shows an outdated `env-promote.sh` invocation that does not match the current CLI
- `.github/workflows/promote-beta.yml` defaults the manual source-tier input to `beta`, which is confusing for a workflow whose purpose is promoting a dev tier into beta

## Parallel Workstreams

### Workstream A — `/approvals` Playwright coverage

**Goal**

Add a focused browser test that proves the approvals page can load a thread, render pending gates, and surface approve/deny feedback without regressions.

**Likely files**

- `packages/web/e2e/*.spec.ts`
- `packages/web/src/app/approvals/page.tsx`

**Verification**

- Targeted Playwright run for the new approvals spec

### Workstream B — `/deployment` Playwright coverage

**Goal**

Add a focused browser test for the deployment page that covers tier-card rendering, source-tier selection, and visible preflight state for the promote gate.

**Likely files**

- `packages/web/e2e/*.spec.ts`
- `packages/web/src/views/DeploymentView.tsx`
- `packages/web/src/components/deployment/PromoteGate.tsx`

**Verification**

- Targeted Playwright run for the new deployment spec

### Workstream C — dev/beta promotion guardrails + docs consistency

**Goal**

Make the promotion workflow and tier docs unambiguous so future agent work stays on `dev-1` / `dev-2` and beta remains a manually gated target.

**Likely files**

- `.github/workflows/promote-beta.yml`
- `docs/USER-SETUP-CD-TIERS.md`
- `scripts/env-promote.sh` (reference only unless behavior change is required)

**Verification**

- `git diff --check`
- Any targeted workflow/doc linting that is already cheap in-repo

## Coordination Notes

- Run each workstream in its own worktree and coordination-board claim.
- Prefer Codex for at least one of the isolated workstreams while quota is available.
- Keep verification focused; do not rerun the full repo test matrix for doc-only or single-surface Playwright changes.
