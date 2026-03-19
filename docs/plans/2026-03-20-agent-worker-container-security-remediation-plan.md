# Agent Worker Container Security Remediation Plan

> Goal: close the newly surfaced `agentctl-agent-worker` container vulnerability backlog on `main` with the smallest defensible runtime-image change, while keeping the worker on a glibc-based slim image and avoiding a blind regression back to Alpine/musl.
>
> Status note: this follow-up opened after a fresh 2026-03-20 `main` scan surfaced 100 open GitHub code-scanning findings for the worker image. Dependabot and secret scanning remained at zero open alerts.

## Current Alert Picture

The current `main` backlog is concentrated in the worker container image:

- 100 open code-scanning findings attached to `agentctl-agent-worker`
- Severity mix: 1 critical, 2 high, 16 medium, 80 low, 1 unknown
- Highest-signal packages in the current scan:
  - `zlib1g` (critical + medium)
  - `libexpat1` (1 high + 5 medium + low follow-ons)
  - `libldap-2.5-0` (1 high + low follow-ons)
  - PAM / systemd / ncurses packages carrying additional medium findings

The control-plane image is not currently carrying the same open backlog, so the first pass should stay worker-scoped unless validation shows the base-image move should be mirrored for parity.

## Remediation Direction

The initial remediation direction is intentionally conservative:

- keep the worker on a Debian/glibc slim image to avoid reintroducing Alpine/musl compatibility risk
- prefer a runtime-image refresh over broader app-layer churn
- keep the code change as close to the Docker base selection as possible unless the scan proves a package-level reduction is still required

The current candidate is a worker-only base-image refresh from `22.22.1-bookworm-slim` to the official `22.22.1-trixie-slim` tag so the worker picks up a newer Debian package set without changing the Node major/minor line.

## Verification Expectations

Because local Docker access may not be available in every agent environment, verification should stay focused and honest:

- `git diff --check`
- review the worker Dockerfile diff for scope control
- rely on PR CI to run the container build and Trivy-backed security audit
- if GitHub exposes branch-level code-scanning results for the PR ref, compare them against the current `main` alert count before merge

## Deferred / Out of Scope

- broad control-plane container refactors unless the worker-only refresh proves insufficient
- Alpine/musl migration without explicit compatibility evidence
- unrelated dependency-audit, secret-scanning, or web-hardening work
