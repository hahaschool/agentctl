# Agent Worker Container Security Remediation Plan

> Goal: close the newly surfaced `agentctl-agent-worker` container vulnerability backlog on `main` with the smallest defensible runtime-image change, while keeping the worker on a glibc-based slim image and avoiding a blind regression back to Alpine/musl.
>
> Status note: this follow-up opened after a fresh 2026-03-20 `main` scan surfaced 100 open GitHub code-scanning findings for the worker image. PR #307 merged the worker-only runtime refresh plus the `python3-setuptools` compatibility follow-up for node-gyp on Debian trixie, PR #314 refreshed the `git` runtime library closure, PR #322 then hardened runtime `git` capability handling while explicitly keeping `git` in the standard worker image, and PR #326 aligned the `security-audit` Trivy worker policy with the `build-images` upload path. The plan is now closed: as of 2026-03-20 GitHub code scanning reports `0` open alerts on `main`, and both worker Trivy categories report `0` results on recent `main` commits `cdd63b8`, `3e38d87`, and `4c82efb`.

## Closure Snapshot

Historical baseline before the final convergence:

- 100 open code-scanning findings were reported on `main`, and all 100 findings were attached to `library/agentctl-agent-worker`
- the highest-signal package families in that earlier backlog clustered around `zlib1g`, `libexpat1`, `libldap-2.5-0`, and the `git`-linked curl/TLS/runtime libraries refreshed in PR #314

Current closure evidence on 2026-03-20:

- `gh api 'repos/hahaschool/agentctl/code-scanning/alerts?state=open&per_page=100' --jq 'length'` returns `0`
- both worker Trivy categories now converge on `0`-result `main` uploads: `trivy-agent-worker` and `trivy-agentctl-agent-worker` each report `0` results on commits `cdd63b8`, `3e38d87`, and `4c82efb`
- PR #326 removed the last known workflow-policy mismatch by aligning the `security-audit` worker SARIF upload with the `build-images` worker Trivy settings

The control-plane image never carried the same open backlog, and the closing evidence did not require widening this plan beyond the worker image and worker-scan workflow alignment.

## Remediation Direction

The remediation direction stayed intentionally conservative:

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

The next, runtime-level follow-up is now also on `main` via PR #322:

- `packages/agent-worker/src/api/routes/git.ts` now preserves typed `GIT_UNAVAILABLE` failures even when the binary disappears after the initial repo probe
- `packages/agent-worker/src/runtime/workdir-safety.ts` now blocks unavailable workdirs explicitly instead of misclassifying them as missing-`git` cases, and it sanitizes those path checks through the existing path-security helpers
- the standard worker image still keeps `git` installed; the repo chose capability hardening first after independent review showed that immediate final-image `git` removal would regress normal repo-aware container behavior

The final workflow-alignment follow-up is now also on `main` via PR #326:

- `.github/workflows/security-audit.yml` now uses the same worker Trivy policy shape already used by `build-images`, including the same `ignore-unfixed=true` and `vuln-type=os,library` settings for the worker container SARIF upload
- after that alignment, the duplicate worker Trivy categories converge on `0`-result uploads on recent `main` commits, so no further worker-image or package-override follow-up is currently queued

## Closure Verification

The closing checks for this plan are now straightforward:

- `git diff --check`
- `gh api 'repos/hahaschool/agentctl/code-scanning/alerts?state=open&per_page=100' --jq 'length'`
- `gh api 'repos/hahaschool/agentctl/code-scanning/analyses?ref=refs/heads/main&per_page=20' --jq 'map(select(.category == "trivy-agent-worker" or .category == "trivy-agentctl-agent-worker")) | map({category: .category, commit: .commit_sha[0:7], results_count})'`
- confirm the `main` worker scan evidence stays at `0` open alerts and `0` results for both worker Trivy categories before reopening any worker-image follow-up

## Deferred / Out of Scope

- broad control-plane container refactors unless a future worker-specific backlog proves the scope needs to widen
- removing `git` from the worker image unless fresh post-closure evidence proves that doing so is both safe for normal worker deployments and materially helpful for a reopened worker backlog
- Alpine/musl migration without explicit compatibility evidence
- unrelated dependency-audit, secret-scanning, or web-hardening work
