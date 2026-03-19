# Post-21.2 E2E + CD Hardening Plan

> Goal: turn the post-21.2 backlog into four isolated follow-up slices that can run in parallel without touching the beta stage.
>
> Status note: Workstreams A-C are now on `main` via PRs #299, #297, and #298. Release workflow `23307749638` then exposed one more CD hardening gap, so Workstream D now tracks the remaining production-deploy guardrail follow-up.

## Why This Batch

Roadmap 21.2 is now fully delivered on `main`. The original post-21.2 batch covered two recently expanded user-facing surfaces plus one workflow/docs cleanup slice:

- `/approvals`, which is the operator path for reviewing approval gates
- `/deployment`, which is the control surface for dev-tier promotion into beta

Separately, the promotion docs/workflow contained avoidable footguns:

- `docs/USER-SETUP-CD-TIERS.md` shows an outdated `env-promote.sh` invocation that does not match the current CLI
- `.github/workflows/promote-beta.yml` defaulted the manual source-tier input to `beta`, which was confusing for a workflow whose purpose is promoting a dev tier into beta

After those three slices landed, release workflow `23307749638` exposed one more operational gap:

- `.github/workflows/deploy-prod.yml` failed during `Connect to Tailscale` because the required production deploy secrets were not configured, and the rollback step still tried to SSH into `prod-target` afterward

## Parallel Workstreams

### Workstream A — `/approvals` Playwright coverage ✅

**Goal**

Add a focused browser test that proves the approvals page can load a thread, render pending gates, and surface approve/deny feedback without regressions.

Delivered in PR #299.

**Likely files**

- `packages/web/e2e/*.spec.ts`
- `packages/web/src/app/approvals/page.tsx`

**Verification**

- Targeted Playwright run for the new approvals spec

### Workstream B — `/deployment` Playwright coverage ✅

**Goal**

Add a focused browser test for the deployment page that covers tier-card rendering, source-tier selection, and visible preflight state for the promote gate.

Delivered in PR #297.

**Likely files**

- `packages/web/e2e/*.spec.ts`
- `packages/web/src/views/DeploymentView.tsx`
- `packages/web/src/components/deployment/PromoteGate.tsx`

**Verification**

- Targeted Playwright run for the new deployment spec

### Workstream C — dev/beta promotion guardrails + docs consistency ✅

**Goal**

Make the promotion workflow and tier docs unambiguous so future agent work stays on `dev-1` / `dev-2` and beta remains a manually gated target.

Delivered in PR #298.

**Likely files**

- `.github/workflows/promote-beta.yml`
- `docs/USER-SETUP-CD-TIERS.md`
- `scripts/env-promote.sh` (reference only unless behavior change is required)

**Verification**

- `git diff --check`
- Any targeted workflow/doc linting that is already cheap in-repo

### Workstream D — production deploy guardrails for missing secrets

**Goal**

Keep release-triggered production deploys quiet until production secrets exist, while still making manual `workflow_dispatch` deploys fail fast with actionable setup guidance and preventing rollback from running after an early setup failure.

**Likely files**

- `.github/workflows/deploy-prod.yml`
- `docs/USER-SETUP-CD-TIERS.md`

**Verification**

- YAML parse for `deploy-prod.yml`
- `git diff --check`
- Any cheap grep/assertions needed to confirm the new guardrail branches are present

## Coordination Notes

- Run each workstream in its own worktree and coordination-board claim.
- Prefer Codex for at least one of the isolated workstreams while quota is available.
- Keep verification focused; do not rerun the full repo test matrix for doc-only or single-surface Playwright changes.
