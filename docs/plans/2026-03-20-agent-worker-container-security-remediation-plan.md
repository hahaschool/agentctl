# Agent Worker Container Security Remediation Plan

> Goal: close the newly surfaced `agentctl-agent-worker` container vulnerability backlog on `main` with the smallest defensible runtime-image change, while keeping the worker on a glibc-based slim image and avoiding a blind regression back to Alpine/musl.
>
> Status note: this follow-up opened after a fresh 2026-03-20 `main` scan surfaced 100 open GitHub code-scanning findings for the worker image. PR #307 merged the worker-only runtime refresh plus the `python3-setuptools` compatibility follow-up for node-gyp on Debian trixie, and PR #314 then refreshed the `git` runtime library closure, but the plan remains active until the post-merge `main` scan output converges and the open-alert count settles.

## Current Alert Picture

The current `main` backlog is concentrated in the worker container image:

- 100 open code-scanning findings are still reported immediately after PR #314 merged, and all 100 findings are attached to `library/agentctl-agent-worker`
- Current GitHub code-scanning severity buckets for that backlog are 1 `error`, 14 `warning`, and 85 `note`
- Highest-signal package families before the PR #314 follow-up clustered around:
  - `zlib1g`
  - `libexpat1`
  - `libldap-2.5-0`
  - `git`-linked curl/TLS/runtime libraries such as `libcurl3t64-gnutls`, `libnghttp2-14`, `libnghttp3-9`, `libngtcp2-16`, and `libtasn1-6`

The control-plane image is not currently carrying the same open backlog, so the first pass stays worker-scoped unless validation shows the base-image move should be mirrored for parity.

## Remediation Direction

The initial remediation direction is intentionally conservative:

- keep the worker on a Debian/glibc slim image to avoid reintroducing Alpine/musl compatibility risk
- prefer a runtime-image refresh over broader app-layer churn
- keep the code change as close to the Docker base selection as possible unless the scan proves a package-level reduction is still required

That worker-only base-image refresh is now on `main` via PR #307:

- `infra/docker/Dockerfile.agent-worker` now uses `node:22.22.1-trixie-slim`
- the build/deps stages also install `python3-setuptools` because Debian trixie no longer bundles the `distutils` shim node-gyp still expects during `node-pty` compilation

The second, package-level follow-up is now also on `main` via PR #314:

- `infra/docker/Dockerfile.agent-worker` keeps `git` installed, but temporarily adds a Debian `forky` source and pin file so the worker can refresh the `git` runtime library closure without broad application-level churn
- the follow-up upgrades `libcurl3t64-gnutls`, `libexpat1`, `libnghttp2-14`, `libnghttp3-9`, `libngtcp2-16`, `libtasn1-6`, and `zlib1g`, then removes the temporary repo metadata in the same layer
- the rationale is repo-specific: the worker image intentionally adds `git`, and Debian package metadata showed `git` was the common root pulling the remaining expat/curl library family into the runtime image

## Verification Expectations

Because local Docker access may not be available in every agent environment, verification should stay focused and honest:

- `git diff --check`
- review the worker Dockerfile diff for scope control
- rely on PR CI to run the container build and Trivy-backed security audit
- confirm the PR CI/security stack passes before merge; PR #314 cleared CI, Security Audit, CodeQL, container scanning, dependency audit, secret scanning, and Semgrep before merge
- compare the post-merge `main` code-scanning alert count against the pre-fix baseline before closing the roadmap item

## Deferred / Out of Scope

- broad control-plane container refactors unless the worker-only refresh plus `git` closure update still proves insufficient
- Alpine/musl migration without explicit compatibility evidence
- unrelated dependency-audit, secret-scanning, or web-hardening work
