# Worker Git Capability Hardening / Runtime Surface Reduction Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the worker's `git`-dependent runtime surfaces after PRs #307 and #314 so missing `git` fails honestly where it is unsupported, while deferring any default-image `git` removal until post-merge evidence proves that it is both safe and worth pursuing.

**Architecture:** Treat runtime `git` as an optional capability rather than an unconditional dependency. First harden the worker's existing `git`-dependent subsystems so missing `git` produces explicit, typed degradation instead of accidental 500s or hidden crashes. Keep `git` installed in the standard worker image while those hardening changes land, then revisit image-level removal only if the post-merge security evidence still points there.

**Tech Stack:** TypeScript, Fastify, Node `child_process`, Vitest, Docker, GitHub Actions / Trivy

> Status note: PR #322 merged the capability-hardening slice on 2026-03-20. The worker now has a shared `git`-runtime helper, `/api/git/status` preserves late `GIT_UNAVAILABLE` failures, and workdir safety blocks unavailable paths explicitly, but the standard worker image still keeps `git` installed because immediate runtime-git removal was not safe for normal repo-aware container deployments.

---

### Task 1: Lock the missing-`git` behavior with focused regression tests

**Files:**
- Modify: `packages/agent-worker/src/api/routes/git.test.ts`
- Modify: `packages/agent-worker/src/runtime/workdir-safety.test.ts`
- Modify: `packages/agent-worker/src/runtime/agent-pool.test.ts`
- Modify: `packages/agent-worker/src/worktree/worktree-manager.test.ts`
- Modify: `packages/agent-worker/src/runtime/handoff-controller.test.ts`

**Step 1: Write the failing tests**

Add or tighten tests that encode the first-slice contract:

- the worker git-status route returns a typed “git unavailable” error instead of a generic 500 when `execFile('git', ...)` fails with `ENOENT`
- `checkWorkdirSafety()` never classifies a directory as `safe` when `git` is missing
- `AgentPool.createAgent()` keeps falling back to the original `projectPath` when worktree creation fails because `git` is unavailable
- `inspectGitWorkspace()` keeps returning `null` git metadata instead of throwing
- `WorktreeManager` surfaces deterministic `git unavailable` failures that callers can handle, rather than opaque `spawn ENOENT`

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @agentctl/agent-worker test -- src/api/routes/git.test.ts src/runtime/workdir-safety.test.ts src/runtime/agent-pool.test.ts src/worktree/worktree-manager.test.ts src/runtime/handoff-controller.test.ts
```

Expected: FAIL in the new missing-`git` cases because the current worker still assumes the runtime binary exists in at least the git-status and worktree-manager paths.

**Step 3: Write the minimal implementation**

Add only the test fixtures and assertions for now. Do not touch production code until the failure modes are explicit and reproducible.

**Step 4: Re-run the tests to confirm the failures are the intended ones**

Run the same command and verify the failures point to the new missing-`git` cases rather than unrelated flakes.

**Step 5: Commit**

```bash
git add packages/agent-worker/src/api/routes/git.test.ts packages/agent-worker/src/runtime/workdir-safety.test.ts packages/agent-worker/src/runtime/agent-pool.test.ts packages/agent-worker/src/worktree/worktree-manager.test.ts packages/agent-worker/src/runtime/handoff-controller.test.ts
git commit -m "test(worker): lock missing git degradation behavior"
```

### Task 2: Centralize runtime `git` capability detection and typed errors

**Files:**
- Create: `packages/agent-worker/src/runtime/git-runtime.ts`
- Modify: `packages/agent-worker/src/api/routes/git.ts`
- Modify: `packages/agent-worker/src/runtime/workdir-safety.ts`
- Modify: `packages/agent-worker/src/runtime/handoff-controller.ts`
- Modify: `packages/agent-worker/src/worktree/worktree-manager.ts`

**Step 1: Write the failing test**

Extend the Task 1 tests so they now expect shared behavior from a central helper:

```ts
expect(isGitUnavailableError(makeSpawnEnoent())).toBe(true);
await expect(execGitOrThrow(['status'], '/repo')).rejects.toMatchObject({
  code: 'GIT_UNAVAILABLE',
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @agentctl/agent-worker test -- src/api/routes/git.test.ts src/runtime/workdir-safety.test.ts src/worktree/worktree-manager.test.ts src/runtime/handoff-controller.test.ts
```

Expected: FAIL because the shared helper and typed error path do not exist yet.

**Step 3: Write the minimal implementation**

Create a small helper that:

- detects `ENOENT` / missing-binary errors consistently
- exposes a shared `isGitUnavailableError()` check
- wraps `execFile('git', ...)` calls where a typed `GIT_UNAVAILABLE` error is better than a generic failure

Keep `handoff-controller.ts` permissive: it should continue returning `null` git metadata rather than hard-failing a handoff summary when `git` is absent.

**Step 4: Run tests to verify they pass**

Run the same command and verify the missing-`git` cases now pass with the new typed behavior.

**Step 5: Commit**

```bash
git add packages/agent-worker/src/runtime/git-runtime.ts packages/agent-worker/src/api/routes/git.ts packages/agent-worker/src/runtime/workdir-safety.ts packages/agent-worker/src/runtime/handoff-controller.ts packages/agent-worker/src/worktree/worktree-manager.ts
git commit -m "refactor(worker): centralize runtime git capability checks"
```

### Task 3: Make worktree isolation degrade cleanly when runtime `git` is absent

**Files:**
- Modify: `packages/agent-worker/src/index.ts`
- Modify: `packages/agent-worker/src/runtime/agent-pool.ts`
- Modify: `packages/agent-worker/src/worktree/worktree-manager.ts`
- Modify: `packages/agent-worker/src/runtime/agent-pool.test.ts`
- Modify: `packages/agent-worker/src/worktree/worktree-manager.test.ts`

**Step 1: Write the failing test**

Add tests for the worker lifecycle behaviors that matter once `git` leaves the final image:

- startup orphan-worktree cleanup logs and skips when `git` is unavailable
- agent creation still succeeds without a worktree and keeps the original `projectPath`
- removal / emergency-stop paths do not mask the primary stop result just because worktree cleanup is unavailable

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/agent-pool.test.ts src/worktree/worktree-manager.test.ts
```

Expected: FAIL because the worker does not yet distinguish “git is unavailable” from other worktree failures in a structured way.

**Step 3: Write the minimal implementation**

Keep the current fallback architecture, but make it explicit:

- startup cleanup should log a narrow `git unavailable; skipping orphan cleanup` warning
- `AgentPool` should keep succeeding without a worktree when the failure is capability-related
- `WorktreeManager` should throw typed capability errors so callers can decide whether to degrade or fail

**Step 4: Run tests to verify they pass**

Run the same command and confirm the worker remains operational without runtime worktree support.

**Step 5: Commit**

```bash
git add packages/agent-worker/src/index.ts packages/agent-worker/src/runtime/agent-pool.ts packages/agent-worker/src/worktree/worktree-manager.ts packages/agent-worker/src/runtime/agent-pool.test.ts packages/agent-worker/src/worktree/worktree-manager.test.ts
git commit -m "refactor(worker): degrade worktree isolation without git"
```

### Task 4: Re-evaluate steady-state `git` removal only if the evidence still points there

**Files:**
- Modify: `infra/docker/Dockerfile.agent-worker`

**Step 1: Write the failing test**

Use the new focused unit coverage from Tasks 1-3 as the regression net, then only prepare a Docker diff that removes final-image `git` if the post-merge `main` evidence still says the worker backlog is meaningfully `git`-driven.

**Step 2: Run tests to establish the pre-change baseline**

Run:

```bash
pnpm --filter @agentctl/agent-worker test -- src/api/routes/git.test.ts src/runtime/workdir-safety.test.ts src/runtime/agent-pool.test.ts src/worktree/worktree-manager.test.ts src/runtime/handoff-controller.test.ts
git diff --check
```

Expected: PASS.

**Step 3: Write the minimal implementation**

Only if the evidence remains strong, update the production stage so it no longer installs `git`. Keep the image comments honest about what functionality is now optional or degraded at runtime.

**Step 4: Run local verification**

Run:

```bash
git diff --check
```

Expected: PASS.

Note: local Docker/Trivy may still be unavailable; rely on PR CI for container build + security validation.

**Step 5: Commit**

```bash
git add infra/docker/Dockerfile.agent-worker
git commit -m "refactor(worker): re-evaluate runtime git removal"
```

### Task 5: Validate the security hypothesis and stop if the evidence is weak

**Files:**
- Inspect only: `.github/workflows/security-audit.yml`
- Inspect only: `infra/docker/Dockerfile.agent-worker`
- Inspect only: GitHub code-scanning analyses and alert instances for `library/agentctl-agent-worker`

**Step 1: Run focused verification**

Run:

```bash
pnpm --filter @agentctl/agent-worker test -- src/api/routes/git.test.ts src/runtime/workdir-safety.test.ts src/runtime/agent-pool.test.ts src/worktree/worktree-manager.test.ts src/runtime/handoff-controller.test.ts
git diff --check
gh pr checks <new-pr-number>
gh api 'repos/hahaschool/agentctl/code-scanning/analyses?ref=refs/pull/<new-pr-number>/merge&per_page=20'
```

Expected:

- targeted worker tests pass
- PR CI / Security Audit are green
- the new worker evidence either shows a smaller result set than the current `121`-result `security-audit` upload, or it proves the runtime-`git` removal hypothesis was wrong

**Step 2: Make the decision explicit**

If the worker Trivy signal does **not** improve, stop the remediation chain there and document that runtime-`git` removal is not the right next move. Do **not** stack another blind apt-pin/library override on top of it without new evidence.

**Step 3: Commit any final documentation-only adjustments**

```bash
git add docs/ROADMAP.md docs/plans/2026-03-20-agent-worker-container-security-remediation-plan.md
git commit -m "docs(roadmap): record worker surface-reduction outcome"
```

### Task 6: Update roadmap + plans after the experiment lands

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/plans/2026-03-20-agent-worker-container-security-remediation-plan.md`
- Modify: `docs/plans/2026-03-20-worker-runtime-surface-reduction-plan.md`

**Step 1: Write the follow-up docs change**

Record:

- whether the runtime-`git` removal actually reduced Trivy results
- whether section `26.1` can close or needs another clearly named follow-up
- whether `26.2` is now delivered, blocked, or superseded

**Step 2: Verify the docs diff**

Run:

```bash
git diff --check
rg -n "26\\.1|26\\.2|runtime surface reduction|Trivy|results_count" docs/ROADMAP.md docs/plans/2026-03-20-agent-worker-container-security-remediation-plan.md docs/plans/2026-03-20-worker-runtime-surface-reduction-plan.md
```

Expected: PASS.

**Step 3: Commit**

```bash
git add docs/ROADMAP.md docs/plans/2026-03-20-agent-worker-container-security-remediation-plan.md docs/plans/2026-03-20-worker-runtime-surface-reduction-plan.md
git commit -m "docs(roadmap): reconcile worker surface-reduction results"
```
