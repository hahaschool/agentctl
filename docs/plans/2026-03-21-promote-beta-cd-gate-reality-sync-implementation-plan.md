# Promote Beta CD Gate Reality-Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make section 12.6 honest by failing `promote-beta.yml` before approval unless a self-hosted beta runner is explicitly marked ready, and sync the roadmap/setup docs to that behavior.

**Architecture:** Keep the existing beta promotion shape, but split it into a no-side-effects readiness preflight plus self-hosted-only promote/rollback jobs. Update the roadmap and operator guide so the current supported path remains local `env-promote.sh` promotion until self-hosted runner infrastructure exists.

**Tech Stack:** GitHub Actions workflow YAML, shell preflight guards, Markdown docs

---

### Task 1: Gate the workflow on explicit self-hosted readiness

**Files:**
- Modify: `.github/workflows/promote-beta.yml`

**Step 1: Add the failing preflight guard**

Add a preflight job that:

- runs on `ubuntu-latest`
- validates `inputs.source_tier`
- checks `vars.BETA_SELF_HOSTED_RUNNER_READY == 'true'`
- checks the same zero-side-effect prerequisites that `env-promote.sh` enforces
  before touching beta: exact version-tagged `HEAD`, source/beta
  `DATABASE_URL`s, and required local binaries
- fails with actionable guidance when the runner is not ready

**Step 2: Move execution jobs onto self-hosted runners**

Update `promote` and `rollback` so they:

- depend on the preflight job
- use `runs-on: [self-hosted, agentctl-beta]`
- preserve the existing beta environment gate only after readiness passes

**Step 3: Keep failure messaging operator-focused**

Make sure the workflow summary or error text says:

- local/manual promote remains `./scripts/env-promote.sh --from dev-1|dev-2`
- the GitHub path becomes live only after the deployment target has a
  dedicated `agentctl-beta` self-hosted runner and the readiness variable is
  enabled

**Step 4: Verify the workflow diff**

Run: `rg -n 'BETA_SELF_HOSTED_RUNNER_READY|agentctl-beta|env-promote.sh --from|version-bump.sh|DATABASE_URL=.+' .github/workflows/promote-beta.yml`

Expected: Matches show the new readiness guard, self-hosted execution jobs, and
actionable operator guidance.

### Task 2: Sync roadmap and operator docs

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/USER-SETUP-CD-TIERS.md`

**Step 1: Update roadmap section 12.6**

Document that:

- `promote-beta.yml` exists
- GitHub-triggered beta promotion is still blocked on self-hosted runner bring-up
- the fail-fast preflight is intentional so beta is not disrupted by a
  misleading GitHub-hosted path

**Step 2: Update the user setup guide**

Document that:

- local `env-promote.sh` remains the current supported path
- operators must configure a self-hosted runner plus
  `BETA_SELF_HOSTED_RUNNER_READY=true` before using the GitHub workflow

**Step 3: Verify the docs**

Run: `rg -n 'self-hosted|BETA_SELF_HOSTED_RUNNER_READY|env-promote.sh --from dev-1|env-promote.sh --from dev-2|12.6' docs/ROADMAP.md docs/USER-SETUP-CD-TIERS.md`

Expected: Both docs describe the same staged rollout semantics.

### Task 3: Final hygiene

**Files:**
- Modify: `.github/workflows/promote-beta.yml`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/USER-SETUP-CD-TIERS.md`

**Step 1: Run focused diff checks**

Run: `git diff --check`

Expected: No whitespace or patch formatting errors.

**Step 2: Review final scope**

Confirm the branch only changes the workflow and the two docs above plus this
plan/design record.

**Step 3: Commit**

```bash
git add .github/workflows/promote-beta.yml docs/ROADMAP.md docs/USER-SETUP-CD-TIERS.md docs/plans/2026-03-21-promote-beta-cd-gate-reality-sync-design.md docs/plans/2026-03-21-promote-beta-cd-gate-reality-sync-implementation-plan.md
git commit -m "ci: reality-sync beta promotion gate"
```
