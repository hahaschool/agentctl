# Promote Beta CD Gate Reality-Sync Design

## Context

Section 12.6 is only partially delivered. The repository already has
`.github/workflows/promote-beta.yml`, but the workflow still runs on
`ubuntu-latest` while invoking `./scripts/env-promote.sh`, which is a local
PM2-based promotion script designed to run on the deployment host with access
to tier-local `.env.beta`, the PM2 ecosystem file, and the built checkout.

That creates a gap between the repository's documented intent and the actual
execution path:

- the workflow can verify SSH connectivity to the beta machine, but it does not
  execute `env-promote.sh` on that machine
- the script it invokes is not GitHub-hosted-runner-safe
- beta promotion must remain non-disruptive while `dev-1` / `dev-2` keep being
  the active agent-development tiers

## Constraints

- Do not interrupt the beta stage just to make workflow semantics cleaner.
- Keep the GitHub environment gate concept, because it is still the desired
  future control point.
- Make the current repository behavior honest for operators and roadmap readers.
- Avoid overlap with the currently active coordination claims
  `codex-321` through `codex-324`.

## Approaches Considered

### Approach A: Fully remote promotion over SSH from GitHub-hosted runners

Teach the workflow to push or sync the repository state to the beta machine and
execute the promotion script remotely.

Pros:

- preserves GitHub-hosted runners
- makes the workflow operational immediately

Cons:

- materially changes beta deployment behavior
- expands the trusted CI surface and rollback path in one step
- too risky for a cleanup loop whose main goal is to avoid disrupting beta

### Approach B: Reality-sync plus fail-fast until self-hosted runner exists

Keep the workflow file, but make it explicitly contingent on a self-hosted
runner readiness flag. If the flag is not enabled, fail before the environment
approval gate with actionable guidance to use the existing local
`./scripts/env-promote.sh --from dev-N` flow.

Pros:

- zero surprise for beta operators
- preserves the future GitHub-environment gate shape
- prevents a misleading promotion path from appearing "ready"

Cons:

- does not deliver remote GitHub-triggered promotion yet
- requires roadmap and setup docs to say "partial" clearly

### Approach C: Remove the workflow until infra exists

Delete or hard-disable `promote-beta.yml`.

Pros:

- safest technically

Cons:

- throws away the existing gate skeleton
- makes the roadmap look like regression rather than clarified staging

## Recommended Design

Use Approach B.

### Workflow Semantics

- Add a preflight job that runs on `ubuntu-latest` without touching the `beta`
  environment gate.
- The preflight job checks an explicit repo variable such as
  `BETA_SELF_HOSTED_RUNNER_READY`.
- If that variable is not `true`, the workflow fails immediately with a message
  that the repository still expects local/manual beta promotion via
  `./scripts/env-promote.sh --from dev-1|dev-2`.
- Add a zero-side-effect host-verification job on a dedicated `agentctl-beta`
  self-hosted runner before the approval gate so GitHub approvals are not
  consumed on missing local prerequisites.
- Move the actual `promote` job onto the same dedicated `agentctl-beta`
  self-hosted runner so the YAML encodes the beta-host requirement instead of
  relying on prose alone.
- Mirror `env-promote.sh`'s preconditions in the workflow before execution:
  exact version-tagged `HEAD`, non-empty `DATABASE_URL` entries in the source
  and beta env files, and required local binaries including `python3` and
  `psql`.
- Do not add a second workflow-level rollback job. `env-promote.sh` already owns
  local rollback when it reaches a state-changing phase; adding another GitHub
  Actions PM2 restart path creates unnecessary beta restarts on setup failures.

### Documentation Semantics

- Update `docs/ROADMAP.md` section 12.6 to say the gate scaffold exists, but a
  dedicated `agentctl-beta` self-hosted runner plus readiness-variable bring-up
  are still the blocking prerequisites for live GitHub-triggered beta
  promotion.
- Update `docs/USER-SETUP-CD-TIERS.md` to say the current production-safe path
  is still local/manual promotion, and that the GitHub workflow only becomes
  live after the self-hosted runner plus readiness variable are configured.

### Verification

- Validate the workflow diff structurally with targeted grep/sanity checks.
- Run `git diff --check`.
- Avoid broad test suites, because this slice is YAML/docs-only.

## Expected Outcome

After this change:

- operators no longer get a misleading GitHub-hosted beta promotion path
- roadmap and setup docs describe the same truth
- the future self-hosted runner path remains ready to activate without another
  large workflow rewrite
