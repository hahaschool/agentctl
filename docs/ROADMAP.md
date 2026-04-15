# Project Roadmap

> Last updated: 2026-04-15 (post-#542 sync). The latest landing set now includes PR #495 (backend-independent `/agents/[id]/settings` coverage), PR #496 (portable dev-tier `env-up` locking and `WEB_PORT`-safe Next startup), PR #497 (routing API payload bounds hardening), PR #499 (backend-independent `/machines` list/detail coverage), PR #498 (`/agent-profiles` CRUD page with create/delete UI and API-client wiring), PR #500 (`env-up.sh --dry-run` preflight with redacted DB/Redis output), PR #501 (agent-profiles plan record plus Web E2E timeout headroom), PR #503/#504 (roadmap-only cleanup and checkpoint sync), PR #505 (backend-independent `/agent-profiles` browser coverage), PR #506 (`/agent-profiles` PATCH endpoint and Edit dialog), PR #507 (`/audit` trail page with sidebar wiring and focused unit coverage), PR #508 (Docker publish SARIF artifact-only hotfix), PR #509 (audit trail page plan registration), PR #510 (Docker/Security Audit Node 24 JavaScript action runtime opt-in), PR #512 (Node 20 compat type fix for the agent runtime mapping), PR #513 (backend-independent `/audit` Playwright coverage), PR #511 (roadmap/plan consistency sync through the audit E2E landing), PR #515 (Security Audit dependency-audit migration to npm's bulk advisory endpoint), PR #516 (`/machines` Playwright coverage added to the focused web e2e CI lane), PR #517 (`/scheduler` jobs page with sidebar/API-client wiring and scheduler-not-configured handling), PR #518 (`/agents` list Playwright coverage added to the focused web e2e CI lane, with shared-package build preflight for cold CI checkouts), PR #520 (Docker publish Grype scan modernization to Node 24-compatible `anchore/scan-action@v7.4.0` with explicit per-image SARIF paths), PR #522 (CI `node_modules` cache keys scoped per run/attempt to avoid duplicate immutable cache-save annotations), PR #523 (Docker publish, Security Audit container scan, and local-mode DAST Docker actions moved to Node 24 majors with Buildx/Trivy nested cache annotations disabled), PR #524 (roadmap/main-stability checkpoint sync after the Docker-action cleanup), PR #525 (sidebar digit navigation plus `g`-prefix Go To chords, Settings shortcut grouping, and modified-key regression coverage), PR #526/#527 (roadmap/plan consistency sync for the keyboard-accessibility landing and follow-up checkpoint), PR #529 (backend-independent `/sessions/[id]` detail route smoke covering Session and Memory tabs), PR #528 (backend-independent `/memory/dashboard` route smoke covering sidebar/dashboard/KPI/recent activity/decay-card composition), PR #530 (row-level roadmap ledger sync after the two route-smoke landings), PR #540 (wraps `/logs` and `/settings` route pages in `ErrorBoundary` to match `/audit`, `/memory/*`, `/sessions`, and other shells so render-time errors no longer fall through to the root Next.js error page), PR #541 (roadmap/plan consistency sync after the ErrorBoundary landing), and PR #542 (Settings > Accounts gains an inline "Add managed credential" CTA in the empty state and the credential `<Input>` is wired via `aria-describedby`/`aria-invalid` to its hint and warning text, with the warning marked `role="alert"`). Earlier 2026-04-13/14 memory, webhook, settings, discovery, mesh, and agent browser coverage follow-ups remain represented below. CodeQL `#579` remains formally dismissed as a false positive after fresh `main` analysis still flagged the real `@fastify/rate-limit` route shape; local source-shape coverage keeps the limiter before `authorizeManualTakeover`.
>
> Current checkpoint: PR #470 through PR #542 are represented on `main@ed9ee0ee`. GitHub reports 0 open code-scanning, 0 open Dependabot, and 0 open secret-scanning alerts. Post-#517 main checks passed: CI `24434540379`, Security Audit `24434540412`, and Build & Publish Docker Images `24434540403`. Post-#518 main checks passed: CI `24434858012`, Security Audit `24434857991`, and Build & Publish Docker Images `24434858005`. Post-#520 main checks passed: CI `24435189789`, Security Audit `24435189784`, and Build & Publish Docker Images `24435189793`. Post-#521 main checks passed: CI `24435407485`, Security Audit `24435407466`, and Build & Publish Docker Images `24435407472`. Post-#522 main checks passed: CI `24435798278`, Security Audit `24435798276`, and Build & Publish Docker Images `24435798257`. Post-#523 main checks passed: CI `24436282633`, Security Audit `24436282625`, and Build & Publish Docker Images `24436282616`. Post-#524 main checks passed: CI `24436731803`, Security Audit `24436731809`, and Build & Publish Docker Images `24436731805`. Post-#525 main checks passed: CI `24437117041`, Security Audit `24437117038`, and Build & Publish Docker Images `24437117043`. Post-#526 main checks passed: CI `24437448007`, Security Audit `24437448002`, and Build & Publish Docker Images `24437448013`. Post-#530 main checks passed: CI `24438180676`, Security Audit `24438180686`, and Build & Publish Docker Images `24438180685`. Post-#541 main checks passed: CI `24439950859`, Security Audit `24439950880`, and Build & Publish Docker Images `24439950854`. Post-#542 main checks passed: CI `24440161677`, Security Audit `24440161696`, and Build & Publish Docker Images `24440161680`.
>
> Post-#520 work note: PR #508 removed the nonblocking SARIF-upload dependency from the Docker publish workflow after `github/codeql-action/upload-sarif` download 429s, kept scanner reports as artifacts, left Security Audit responsible for Security-tab uploads, and serialized Security Audit's container-scan matrix. PR #509 added the missing audit-trail page plan and roadmap links. PR #510 opted `build-images.yml` and `security-audit.yml` into GitHub Actions' Node 24 JavaScript action runtime after Build & Publish Docker Images run `24405567447` passed but still emitted Node.js 20 deprecation annotations for Docker/artifact/cache actions. PR #512 fixed the subsequent Node 20 compat TypeScript failure in the control-plane agent runtime mapping. PR #513 added backend-independent `/audit` Playwright coverage. PR #515 migrates the blocking Security Audit job away from `pnpm audit` after npm retired its legacy audit endpoints and onto npm's bulk advisory endpoint while keeping high/critical advisories blocking. PR #516 adds the already-backend-independent `/machines` spec to the focused web e2e CI lane. PR #517 exposes scheduler job management in the web app over the existing scheduler API and adds unit coverage for the not-configured/create/delete paths. PR #518 adds the already-backend-independent `/agents` spec to the focused web e2e CI lane and builds `@agentctl/shared` first so cold CI checkouts can compile routes that import shared contracts. PR #520 upgrades the Docker publish Grype scanner to `anchore/scan-action@v7.4.0`, pins Grype `v0.111.0`, caches the DB, and validates/upload artifacts from explicit `grype-${{ matrix.package }}.sarif` paths. PR #522 scopes the explicit CI `node_modules` cache keys by run/attempt so parallel PR/main runs no longer compete for the same immutable cache-save key. PR #523 moves Docker publish, Security Audit container scans, and local-mode DAST Docker builds onto Node 24 action majors, disables Buildx binary caching, disables Trivy's internal action cache so nested Node20 `actions/cache` downloads no longer produce job-level Node20 deprecation annotations, and removes the temporary forced Node 24 runtime env from the publish/audit workflows; post-#523 Docker logs still show setup-trivy downloading its composite `actions/cache` metadata and Grype's nonblocking high-severity scanner warning under `fail-build: false`, but the workflows no longer emit Node20 or immutable cache-save annotations. PR #524 synced the roadmap/main-stability checkpoint after those workflow landings. PR #525 extends sidebar keyboard navigation with `1-9,0` digit shortcuts plus `g`-prefix Go To chords for every sidebar destination, renders the grouped shortcut catalog in Settings, and adds a regression so modified second keys such as `g` then `Ctrl+S` preserve browser/app shortcuts instead of navigating. PR #526/#527 synced the roadmap and related plan histories after that keyboard-accessibility landing. PR #529 and PR #528 added thin backend-independent route-smoke coverage for `/sessions/[id]` and `/memory/dashboard`, PR #530 recorded the row-level roadmap ledger after those landings, PR #532 added client-side URL-length validation to webhooks and sync peers, PR #533 added backend-independent `/scheduler` browser coverage, PR #536 removed the non-functional Consolidation Board Edit action, PR #537 fixed discovery of current Codex session files, PR #538 added approvals expander accessibility semantics, PR #539 and PR #541 recorded roadmap syncs for that landing set, PR #540 wrapped `/logs` plus `/settings` with the shared ErrorBoundary, and PR #542 added an inline Accounts empty-state credential CTA plus screen-reader-visible credential validation wiring. Dev-1/dev-2, production deploy, and beta promotion workflows stay untouched.
>
> Coordination note: PR #461 merged as `e6fd4c2e`, PR #462 as `193e6b02`, PR #465 as `2b950c96`, PR #466 as `9fbc2fe9`, PR #467 as `620de798`, PR #468 as `4291f520`, PR #470 as `5a480a23`, PR #471 as `2d61cb8a`, PR #472 as `7b2f9b8c`, PR #473 as `22fbe6ae`, PR #474 as `a8189309`, PR #475 as `1f4007c1`, PR #476 as `fa632acd`, PR #477 as `be1765d3`, PR #478 as `082deedb`, PR #479 as `9f984523`, PR #480 as `0f9fb538`, PR #481 as `0668db95`, PR #482 as `04e1e80d`, PR #483 as `88ccf816`, PR #485 as `071b7e3d`, PR #486 as `bfd9e74f`, PR #487 as `f28a2a85`, PR #488 as `eb9ae933`, PR #489 as `c01300b2`, PR #490 as `d868742b`, PR #491 as `f3ad66dc`, PR #492 as `8b716d6f`, PR #493 as `808556b0`, PR #494 as `95e7c8a2`, PR #495 as `5635abdf`, PR #496 as `64de9152`, PR #497 as `1b95f9f8`, PR #499 as `05972feb`, PR #498 as `3eebce46`, PR #500 as `e20e5682`, PR #501 as `d1c9635c`, PR #503 as `3b3ecf3f`, PR #504 as `8a9cda1b`, PR #505 as `bde0f343`, PR #506 as `caf3038f`, PR #507 as `d3fb1a0b`, PR #508 as `547fe24b`, PR #509 as `b0464f2c`, PR #510 as `3c694d79`, PR #512 as `62a06878`, PR #513 as `5eb844ff`, PR #511 as `52dccc06`, PR #515 as `22767f6d`, PR #516 as `4a0d67e4`, PR #517 as `2c31bcd6`, PR #518 as `00b25acf`, PR #520 as `8d6051a7`, PR #521 as `0a55bcc1`, PR #522 as `d48b0954`, PR #523 as `1d77f4e9`, PR #524 as `cbf75017`, PR #525 as `0f49e772`, PR #526 as `56ae0b24`, PR #527 as `25eac47e`, PR #529 as `1f70727e`, PR #528 as `089d6739`, PR #530 as `536480ae`, PR #536 as `aff8a80f`, PR #537 as `8150750e`, PR #538 as `7f629f57`, PR #539 as `d3a75dca`, PR #540 as `64e3668a`, PR #541 as `772fb22c`, and PR #542 as `ed9ee0ee`; duplicate PRs #463, #464, and #519 were closed after their stronger sibling branches merged.
>
> Current follow-up note: this pass records the audit browser-depth follow-up, the dependency-audit endpoint remediation needed after PR #514 exposed npm's retired legacy audit endpoint, the `/machines` plus `/agents` list CI-gating follow-ups, the scheduler jobs page follow-up that made scheduled jobs directly reachable from the web sidebar, the Docker publish Grype SARIF output follow-up, the merged CI cache-save key scoping follow-up, the Docker-action Node 24 major follow-up for the remaining Docker/artifact/Trivy-cache annotations, the sidebar keyboard-accessibility follow-up that added grouped Settings shortcut docs plus conflict-safe `g`-prefix navigation, the route-integration smoke follow-up for `/sessions/[id]` plus `/memory/dashboard`, and the #536-#542 consolidation/Codex-discovery/a11y/ErrorBoundary/Accounts/roadmap landing set, with post-#542 green main checks on `ed9ee0ee`.

## Current State

AgentCTL is a multi-machine AI agent orchestration platform with:

- **Web App**: Next.js 15 (App Router) + React Query + Tailwind CSS + shadcn/ui; the API client is split into domain modules under `packages/web/src/lib/api/` with `api.ts` kept as the public barrel (PR #481)
- **Control Plane**: Fastify + PostgreSQL + BullMQ + Drizzle ORM
- **Agent Worker**: Claude Agent SDK + node-pty + PM2
- **Mobile**: React Native (Expo) — early stage, but already ships unified session browsing/filtering, managed runtime session controls, handoff history, and agent detail streaming
- **CI/CD**: 11 GitHub Actions workflows (build, test, deploy, promotion, cleanup, security, DAST, fleet)
- **Security**: OWASP Agentic Top 10 compliance, CodeQL + Semgrep + Trivy + ZAP

**7,260+ unit tests** across 111+ files + **220+ Playwright e2e checks**, with the backend-independent webhooks, agent-profiles, audit, machines, and agents list slices now gated in CI. The `/sessions/[id]` and `/memory/dashboard` route-smoke specs add thin browser coverage for detail/dashboard composition without widening the CI allowlist yet. The scheduler jobs page is reachable from the web sidebar and covered by focused mocked-query unit tests. All packages build and lint cleanly (TypeScript 0 errors, Biome 0 errors).

---

## 1. Infrastructure

> CI/CD pipeline, deployment, fleet management, database migrations.

<details>
<summary>✅ All complete — 11 workflows, full deploy/promotion chain, fleet rollout</summary>

### 1.1 CI Hardening

> Status note: PR #333 modernized the core `ci.yml`, `security-audit.yml`, and
> `build-images.yml` workflows off the old Node20-based `actions/checkout`,
> `actions/setup-node`, and `github/codeql-action` majors, while moving the
> repo gitleaks runs onto the official CLI path. PR #334 finished the node24
> follow-through by replacing `ci.yml`'s `dorny/paths-filter` step with a
> GitHub API changed-files detector and bumping the remaining deploy-adjacent
> `actions/checkout` / `actions/setup-node` refs to `v5`. PR #336 then aligned
> the stale `DbAgentRegistry.updateRunPhase()` missing-run expectation with the
> intentional no-op/logged skip semantics introduced by `1ead1a7`. PR #338
> then upgraded the remaining safe `actions/cache`, `actions/upload-artifact`,
> and `actions/download-artifact` refs in `ci.yml`, `deploy-prod.yml`, and
> `dast-zap.yml` to the current Node24 majors while leaving
> `build-images.yml` / `security-audit.yml` alone to avoid overlap with an
> already-active Trivy remediation branch. PR #352 then re-stabilized the
> control-plane dispatch test suite after the MCP discovery preflight landed,
> and PR #353 then ignored the historical gitleaks fingerprints that only
> resurfaced on scheduled full-history security scans. PR #359 then finished
> the last leftover `ci.yml` Node24 cache-action follow-through by bumping the
> install job's `actions/cache/save` step from `v4` to `v5`. PR #385 then
> upgraded the remaining `pnpm/action-setup` uses in `ci.yml`,
> `security-audit.yml`, and `promote-beta.yml` to `v5`, clearing the final
> Node20 deprecation warnings without changing workflow logic. PR #445 then
> added a backend-independent web Playwright CI lane for the webhooks slice,
> using `WEB_PORT`-aware web scripts so browser coverage can run without
> disturbing dev-1/dev-2 or beta promotion state. PR #501 raised the Web E2E
> job timeout from 10 to 20 minutes after a main push exhausted the old limit
> during Playwright Chromium installation before tests started. PR #505 then
> added the backend-independent `/agent-profiles` Playwright spec to the same
> CI lane. PR #508 removes duplicate Security-tab SARIF uploads from
> `build-images.yml` so image publication no longer depends on
> `github/codeql-action` setup availability; scanner reports remain attached as
> artifacts, Security Audit keeps the Security-tab upload responsibility, and
> the Security Audit container-scan matrix is capped at one concurrent image to
> avoid duplicate `codeql-action` setup downloads during busy merge windows.
> PR #510 opted `build-images.yml` and `security-audit.yml` into
> `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` after the post-#509 Docker publish run
> still emitted Node.js 20 deprecation annotations for Docker/artifact/cache
> actions despite passing. PR #512 then fixed the follow-on Node 20 compat
> TypeScript failure in the control-plane agent runtime mapping. PR #513 added
> backend-independent `/audit` Playwright coverage to the same web e2e CI lane.
> The follow-up dependency-audit hotfix replaces `pnpm audit` with the repo's
> `audit:deps` script, which reads `pnpm-lock.yaml` and calls npm's bulk
> advisory endpoint so high/critical dependency findings remain blocking after
> npm retired the legacy audit endpoints used by pnpm. PR #516 then added the
> already-backend-independent `/machines` Playwright spec to this focused web
> e2e CI lane. PR #518 then added the already-backend-independent `/agents`
> list spec to the same focused web e2e CI lane and made `test:e2e:ci` build
> `@agentctl/shared` first so cold GitHub Actions checkouts can compile routes
> that import shared contracts. The current Docker-action runtime follow-up
> upgrades Docker publish, Security Audit container scan, and local-mode DAST
> Docker action refs to their Node 24 majors, disables Buildx binary caching,
> disables Trivy's internal action cache to avoid nested Node 20 `actions/cache`
> steps, and removes the temporary forced Node 24 runtime env from publish/audit
> workflows without changing deploy-dev, promote-beta, deploy-prod, or the dev-1/dev-2 runtime
> configuration.

- [x] GitHub API changed-files detection for monorepo-aware conditional builds
- [x] pnpm store caching + TypeScript build cache
- [x] Security scanning: npm bulk advisory dependency audit, `gitleaks`, Biome security lint
- [x] Backend-independent web Playwright CI gating for `/webhooks`, `/agent-profiles`, `/audit`, `/machines`, and `/agents` list using `WEB_PORT`-aware web scripts and a shared-package build preflight *(PRs #445, #505, #513, #516, #518)*

### 1.2 Docker Build & Registry

- [x] Multi-stage Docker build (`node:22-alpine`, non-root uid 1001)
- [x] Image tagging: `sha-<commit>`, `main-latest`/`dev-latest`, semver `v*.*.*`
- [x] Trivy + Grype container scanning, SBOM generation
- [x] Docker publish scanner artifacts kept independent from CodeQL SARIF upload setup *(PR #508)*
- [x] Docker publish Grype scan uses Node 24-compatible `anchore/scan-action@v7.4.0` with explicit per-image SARIF output validation/artifacts *(PR #520)*
- [x] Docker publish, Security Audit container scan, and local-mode DAST Docker action refs upgraded to Node 24 majors; Buildx binary caching and Trivy's internal action cache disabled to avoid nested Node 20 cache steps; dev and beta deployment workflows intentionally unchanged in this lane

### 1.3 Deployment Pipeline

- [x] Dev auto-deploy via Tailscale SSH on push to `dev`
- [x] Production deploy with GitHub Environment approval gate + blue-green
- [x] Rollback workflow (`workflow_dispatch` with tag selector)
- [x] Fleet deploy: canary → verify → matrix deploy remaining machines

### 1.4 Database Migration Safety

- [x] PR validation: throwaway PostgreSQL + `drizzle-kit generate`
- [x] Deploy-time: migration in transaction, `pg_dump` backup, destructive ops need approval

### 1.5 Observability & Notifications

- [x] Slack/Discord webhooks on deploy success/failure
- [x] Vector → ClickHouse structured logging pipeline
- [x] Prometheus-compatible `/metrics` endpoint

**Workflows**: `ci.yml`, `build-images.yml`, `cleanup-images.yml`, `dast-zap.yml`, `deploy-dev.yml`, `deploy-fleet.yml`, `deploy-prod.yml`, `migration-check.yml`, `promote-beta.yml`, `rollback.yml`, `security-audit.yml`

</details>

---

## 2. Runtime Engine

> Agent lifecycle, scheduling, session control, execution safety.

<details>
<summary>✅ Scheduling, loop controller, session control — all delivered</summary>

### 2.1 Scheduled Sessions

- [x] `ScheduleConfig` type with `sessionMode: 'fresh' | 'resume'`
- [x] Prompt template variables: `{{date}}`, `{{iteration}}`, `{{lastResult}}`
- [x] DB: `schedule_config` JSONB column, cron API endpoints
- [x] Web `/scheduler` jobs page with sidebar entry, list/empty/error/not-configured states, heartbeat job creation, delete confirmation, API-client wiring, and focused unit coverage *(PR #517; see [plans/2026-04-15-scheduler-jobs-page-plan.md](plans/2026-04-15-scheduler-jobs-page-plan.md))*

> Design doc: [plans/2026-03-02-scheduled-sessions-and-loop-design.md](plans/2026-03-02-scheduled-sessions-and-loop-design.md) (archived)

### 2.2 Continuous Loop (Ralph Loop)

- [x] `LoopController` with 3 modes: `result-feedback`, `fixed-prompt`, `callback`
- [x] Limits: `maxIterations`, `costLimitUsd`, `maxDurationMs`
- [x] Safety: dead-loop detection, cost alerts at 80%, auto-pause on checkpoint failure
- [x] SSE events: `loop_iteration`, `loop_checkpoint`, `loop_complete`

### 2.3 Session Control Architecture (3-Layer)

- [x] **Layer 1**: Claude Code CLI `-p` mode (primary — subprocess with structured I/O)
- [x] **Layer 2**: Agent SDK wrapper (hooks, tool gating, output streaming)
- [x] **Layer 3**: tmux fallback (attach to existing sessions)

> Design doc: [plans/2026-03-03-session-takeover-design.md](plans/2026-03-03-session-takeover-design.md) (archived)

</details>

### 2.4 Remote Control Integration (Relay Decision + Manual Takeover) — P2 ✅

> Claude Code Remote Control is an outbound relay to `claude.ai/code`.
> Current Anthropic docs no longer frame it as Max-only, but AgentCTL's managed
> runtime still fits `claude -p` better because `stream-json`, worker-side
> events, hooks, loops, and scheduled sessions already depend on local
> structured control.
> See [2026-03-10-remote-control-relay-decision.md](plans/2026-03-10-remote-control-relay-decision.md)
> for the spike decision memo.
>
> Status note: The relay decision is complete, and a narrow manual takeover flow
> is already on `main` for Claude managed sessions via shared contracts,
> worker/control-plane lifecycle routes, `RcSessionManager`, and runtime-session
> web controls. Direct `main` follow-through in `58d8b840`, `e5f07913`, and
> `73145841` tightened stale-session reaping, early `rc_session` creation, and
> the existing takeover/release POST semantics without expanding this slice's
> scope. The reconciliation hollow-flip gap closed in PR #405: the GET
> `manual-takeover` route now re-verifies a missing relay response with a
> second worker poll before flipping a previously-online takeover to `stopped`.
> A confirmed second miss yields `stopped`; a transient unreachable second
> response yields the non-terminal `reconnecting` state with a structured
> `relayCheck` log line so the failure stays observable. PR #410 added the
> narrow CodeQL `#579` suppression marker on the GET handler after confirming
> `@fastify/rate-limit` runs before `authorizeManualTakeover`, while current
> CodeQL only models the legacy `fastify-rate-limit` package for this query.
> PR #413 tightened the marker into CodeQL's standalone source-suppression
> format. Fresh `main` analysis still flagged the route on `900acf20`, so
> CodeQL `#579` was formally dismissed as a false positive because the real
> limiter remains before `authorizeManualTakeover` and CodeQL does not model
> this `@fastify/rate-limit` shape.

- [x] Spike: evaluate Remote Control relay vs current CLI `-p`
- [x] Decision: keep `claude -p` as the primary managed-session path for now
- [x] Narrow manual takeover flow for Claude managed sessions (`RcSessionManager`, worker/control-plane routes, runtime-session web controls)
- [x] Re-verify relay state in `reconcileMissingManualTakeover` before transitioning to `stopped` *(PR #405)*
- [x] Close the manual-takeover GET route CodeQL `js/missing-rate-limiting` false positive while preserving route-local Fastify rate-limit coverage *(PRs #410, #413; alert #579 dismissed after fresh `900acf20` analysis)*
- [ ] Re-evaluate only if Anthropic exposes programmatic relay events/session APIs

> Manual takeover design: [plans/2026-03-11-manual-remote-takeover-design.md](plans/2026-03-11-manual-remote-takeover-design.md)
> Impl plan: [plans/2026-03-11-manual-remote-takeover-impl-plan.md](plans/2026-03-11-manual-remote-takeover-impl-plan.md)

### 2.5 Structured Execution Summary — P1 ✅

> Design doc: [plans/2026-03-10-astro-agent-patterns-design.md](plans/2026-03-10-astro-agent-patterns-design.md) §11.1
>
> Status note: Fully delivered on `main` via PRs #32 (generation + types) and
> #39 (live SSE streaming + web/mobile rendering). The worker generates
> summaries on completion, streams them via `execution_summary` SSE events,
> and web/mobile render summary cards in session detail views.

Auto-generate structured summary at task completion via session resume.

- [x] Define `ExecutionSummary` type (status, workCompleted, executiveSummary, filesChanged, followUps, cost)
- [x] Implement summary generation in `AgentInstance.stop()`; post-hoc fallback already exists in the run summary route
- [x] DB migration: `agent_runs.result_summary` JSONB
- [x] SSE event: `execution_summary`
- [x] API: `GET /api/runs/:id/summary`
- [x] Summary card in web/mobile session view

### 2.6 Workdir Safety Tiers — P1 ✅

> Design doc: [plans/2026-03-10-astro-agent-patterns-design.md](plans/2026-03-10-astro-agent-patterns-design.md) §11.2

Pre-execution safety: safe (git clean) → guarded (dirty) → risky (non-git) → unsafe (parallel).

- [x] `checkWorkdirSafety()` in `agent-worker/src/runtime/workdir-safety.ts`
- [x] Gate in `AgentInstance.start()` before `attemptSdkRun()`
- [x] SSE events: `safety_warning`, `safety_approval_needed`, `safety_blocked`
- [x] Sandbox mode: copy-to-temp → execute → copy-back
- [x] API: `POST /api/agents/:id/safety-decision` (approve/reject/sandbox)

### 2.7 Dispatch Signature Verification — P1 ✅

> Design doc: [plans/2026-03-10-astro-agent-patterns-design.md](plans/2026-03-10-astro-agent-patterns-design.md) §11.3
>
> Status note: Delivered on `main` with follow-through fixes. PR #330 aligned the
> shared signing payload with the JSON wire format by omitting `undefined`
> fields from the signed object, and PR #332 replaced committed PM2
> dispatch-signing literals with stable per-tier Ed25519 key derivation plus
> environment overrides. Remaining work here is roadmap hygiene rather than
> missing runtime wiring.

Ed25519 signing of dispatch payloads for defense-in-depth.

- [x] Control plane: sign payloads with TweetNaCl Ed25519
- [x] Workers: verify signature before execution, reject invalid
- [x] Public key distributed during machine registration
- [x] Audit: log verification failures

### 2.8 Mid-Execution Steering — P2 ✅

> Status note: Delivered on `main` via PR #45. `AgentInstance.steer()` using SDK
> `streamInput()`, worker + CP routes, `steer_injected` SSE event, and web
> `SteerInput` component in session detail view. Full test coverage across
> all packages.

Inject guidance into running sessions via SDK `streamInput()`.

- [x] `steer(message)` on `AgentInstance`
- [x] Worker API: `POST /api/agents/:agentId/steer`
- [x] Control plane proxy → forward to worker
- [x] SSE events: `steer_injected`
- [x] Chat-like input in live session view (`SteerInput` component)

### 2.9 Execution Environment Registry — P3

> Design doc: [plans/2026-03-11-execution-environment-registry-design.md](plans/2026-03-11-execution-environment-registry-design.md)
> Impl plan: [plans/2026-03-11-execution-environment-registry-impl-plan.md](plans/2026-03-11-execution-environment-registry-impl-plan.md)
>
> Status note: Delivered on `main`. Shared execution-environment contracts,
> `ExecutionEnvironment` / `DirectEnvironment` / `DockerEnvironment`, worker
> capability reporting, and control-plane environment selection are all landed.

Orthogonal WHERE (local/Docker/SSH) vs WHAT (Claude/Codex) abstraction.

- [x] `ExecutionEnvironment` interface: detect, prepare, cleanup
- [x] `DirectEnvironment` (subprocess)
- [x] `DockerEnvironment` (gVisor) *(PR #69 — gVisor runtime, cap-drop, read-only FS, network=none)*
- [x] Auto-detect at startup, report in heartbeat
- [x] Dispatch routing considers environment requirements

---

## 3. Multi-Runtime & Handoff

> Codex integration, cross-agent switching, unified output streaming.

<details>
<summary>✅ Codex core integration + handoff protocol — delivered</summary>

### 3.1 Codex CLI Core Integration

- [x] `ManagedRuntime = 'claude-code' | 'codex'` in shared contracts
- [x] `CodexRuntimeAdapter` + `CodexSessionManager` (create, resume, fork)
- [x] Runtime-aware routes: `GET|POST /api/runtime-sessions`, resume, fork, handoff
- [x] Machine registry: Codex sessions use same resolution path as Claude

> Design doc: [plans/2026-03-09-codex-claude-runtime-unification-design.md](plans/2026-03-09-codex-claude-runtime-unification-design.md)

### 3.2 Session Handoff Protocol

> Status note: The native-import path remains experimental on `main`, but
> PR #126 already stabilized the worker integration test/log coverage around
> native-import preflight plus snapshot fallback. No broader native-import
> feature scope should be inferred from that merge.

- [x] `SessionHandoff` protocol: portable snapshot (worktree, branch, SHA, diff, conversation, MCP/skills)
- [x] `HandoffController`: export snapshot → hydrate target runtime → preserve worktree
- [x] Handoff reasons: `model-affinity`, `cost-optimization`, `rate-limit-failover`, `manual`
- [x] Experimental native import scaffolding with automatic snapshot fallback
- [x] Audit: every handoff + native import attempt logged

</details>

### 3.3 AgentOutputStream — Unified Output Streaming — P2 ✅

> Status note: Delivered on `main` via PR #29. Shared output contract,
> EventEmitter-backed stream, OutputBuffer, and runtime adapter integration
> are all landed.

Shared output contract between runtime adapters. Foundation for multi-runtime.

- [x] Define `AgentOutputStream` interface (text, thinking, toolUse, toolResult, fileChange, costUpdate, error)
- [x] Refactor `sdk-runner.ts` to emit through `AgentOutputStream`
- [x] `AgentInstance` stream impl backed by EventEmitter + OutputBuffer
- [x] Both `ClaudeRuntimeAdapter` and `CodexRuntimeAdapter` use same interface

### 3.4 Codex Operational Parity — P2

> Status note: Delivered on `main`. The worker renders managed Codex config,
> including sandbox, approval, provider, and shell-environment policy, detects
> Codex auth, runs under the shared PM2 worker process, and includes runtime
> sandbox/network enforcement evidence alongside LiteLLM routing/failover.

- [x] LiteLLM config: Codex model routing with OpenAI Direct → Azure OpenAI failover
- [x] PM2 ecosystem config for Codex-capable worker processes
- [x] Azure OpenAI credential detection for Codex authentication
- [x] Config renderer: `modelProvider`, `reasoningEffort`, and shell environment policy in Codex TOML
- [x] Sandbox constraints end-to-end: post-spawn verification (bubblewrap/Seatbelt/Codex), network enforcement, SSE `sandbox_verified` event *(PR #70)*

> Follow-through: the earlier Codex TOML MCP-discovery gap is addressed in §14,
> where runtime-aware discovery reads `.codex/config.toml` alongside Claude Code
> JSON configs.

### 3.5 Automatic Handoff Triggers — P2

> Design doc: [plans/2026-03-11-automatic-handoff-triggers-design.md](plans/2026-03-11-automatic-handoff-triggers-design.md)
> Impl plan: [plans/2026-03-11-automatic-handoff-triggers-impl-plan.md](plans/2026-03-11-automatic-handoff-triggers-impl-plan.md)
>
> Status note: Delivered on `main`. Shared auto-handoff contracts, decision
> persistence, policy evaluation, run handoff history, dispatch-time
> task-affinity dry-run suggestions, and live rate-limit/cost-threshold
> execution are all landed.

- [x] Rate limit hit → failover to other agent type *(PR #66 — LiveHandoffOrchestrator + AgentInstance integration)*
- [x] Cost threshold → switch to cheaper model/provider *(PR #66 — CostThresholdTrigger wired into AgentInstance)*
- [x] Task-type affinity rules (dispatch-time dry-run suggestions + decision logging)
- [x] Handoff history API: `GET /api/runs/:id/handoff-history`

### 3.6 Unified Memory Layer — P1

> Design doc: [plans/2026-03-10-unified-memory-layer-design.md](plans/2026-03-10-unified-memory-layer-design.md)
> Impl plan: [plans/2026-03-10-unified-memory-layer-impl-plan.md](plans/2026-03-10-unified-memory-layer-impl-plan.md)
>
> Status note: Delivered on `main` via PRs #30 (claude-mem migration tooling),
> #31 (memory cutover: dual-backend `MemoryInjector`, memory API routes, memory
> MCP server), #43 (3-tier context budget: pinned + on-demand + triggered
> injection with token/fact limits), and later knowledge-engineering follow-
> through PRs/direct commits captured below.

PostgreSQL-native hybrid memory replacing external Mem0 service. 4-scope isolation (global > project > agent > session), pgvector + tsvector + graph traversal fused via Reciprocal Rank Fusion.

**Core (MVP)**:
- [x] Shared types: `MemoryFact`, `MemoryEdge`, `MemoryScope`, `InjectionBudget`
- [x] SQL migration `0010`: pgvector extension, `memory_facts` (HNSW index), `memory_edges`, `memory_scopes`
- [x] Drizzle schema + embedding client (text-embedding-3-small via LiteLLM)
- [x] `MemoryStore`: CRUD with scope isolation, dedup, Ebbinghaus decay
- [x] `MemorySearch`: hybrid search (vector + BM25 + graph CTE + RRF fusion)
- [x] `MemoryInjector` refactor: dual-backend (Mem0 / PG) via `MEMORY_BACKEND` env var
- [x] Memory API routes: search, add, list, delete (with scope filtering)
- [x] Context budget: maxTokens 2400, maxFacts 20, 3-tier injection (pinned + on-demand + triggered)
- [x] Memory MCP server for runtime-side access
- [x] Migration path: dual-write → import → cutover
- [x] Claude-mem data migration: audit → import script (PG target) → API dual-read → UI migration → MCP transition → cleanup

> Migration plan: [plans/2026-03-11-claude-mem-migration-plan.md](plans/2026-03-11-claude-mem-migration-plan.md)
> Frontend UI: see §4.8 Unified Memory System UI for the full 8-page UI plan + integration points

**Knowledge Engineering** (inspired by [stonepage's Agent 知识工程实践](https://zhuanlan.zhihu.com/p/1898602837)):
- [x] Expanded EntityType: +`skill`, +`experience`, +`principle`, +`question` (11 total)
- [x] Expanded RelationType: +`derived_from`, +`validates`, +`contradicts` (10 total)
- [x] Pinned facts: always-injected guardrails, no decay, hard cap per scope
- [x] Trigger-based injection: `TriggerSpec` (tool/file_pattern/keyword) integrated with PreToolUse hooks
- [x] Role-aware search: `tags[]` field + `roleAffinity` boost in RRF reranking *(PR #55, direct commits)*
- [x] Meta-cognition: extraction quality rules embedded in extraction LLM prompt *(direct commit)*
- [x] `memory_feedback` MCP tool: `used` / `irrelevant` / `outdated` signals *(PR #58)*
- [x] Knowledge synthesis: weekly cron Phase 1 (lint) + Phase 2 (LLM-proposed principles, human review) *(direct commit)*
- [x] Contradiction detection: `contradicts` edges trigger human review flags *(direct commit)*

---

## 4. Frontend — Web

> Next.js web application, settings, sessions, fork system.

<details>
<summary>✅ Next.js migration, multi-account, fork, settings redesign — all delivered</summary>

### 4.1 Next.js Migration

- [x] Migrated from Vite SPA to Next.js 15 App Router
- [x] React Query for server state, Tailwind CSS + shadcn/ui
- [x] xterm.js remote terminal, command palette with fuzzy search

> Design docs: [plans/2026-03-03-frontend-framework-survey.md](plans/2026-03-03-frontend-framework-survey.md) (archived), [plans/2026-03-03-nextjs-migration-design.md](plans/2026-03-03-nextjs-migration-design.md) (archived)

### 4.2 Multi-Account System

- [x] API account management with AES-256-GCM encrypted credentials
- [x] Cascade resolution: project → agent → global default
- [x] OAuth PKCE + failover policies
- [x] Per-project account assignment
- [x] Settings Accounts empty-state managed-credential CTA plus screen-reader-visible credential validation wiring *(PR #542)*

> Design doc: [plans/2026-03-04-multi-account-design.md](plans/2026-03-04-multi-account-design.md) (archived)

### 4.3 Advanced Fork / Context Picker

- [x] ContextPickerDialog: fork-here timeline, shift+click range selection
- [x] Fork strategies: resume (full history), JSONL truncation, context injection
- [x] Virtualized scroll (@tanstack/react-virtual), token estimation, compression toggles
- [x] Cross-machine fork with machine selector

> Design docs: [plans/2026-03-08-advanced-fork-design.md](plans/2026-03-08-advanced-fork-design.md) (archived), [plans/2026-03-06-cross-machine-session-transfer.md](plans/2026-03-06-cross-machine-session-transfer.md)

### 4.4 Claude Code-like Session Display

- [x] Thinking blocks, progress indicators, subagent nesting, todo tracking
- [x] Sessions page: grouping by agent, cost/duration sort, bulk actions
- [x] Component extractions (SessionDetailView, SessionsPage — major size reductions)

### 4.5 Runtime-Centric Settings Redesign

- [x] Replaced provider-centric settings with runtime-centric model
- [x] Runtime profiles, credential inventory, worker sync, routing policies
- [x] Config consistency UI: runtime access + config drift detection
- [x] Terminal command allowlist for URL-sourced `?command=` parameter

> Design docs: [plans/2026-03-10-runtime-centric-settings-redesign-design.md](plans/2026-03-10-runtime-centric-settings-redesign-design.md), [plans/2026-03-10-runtime-settings-config-consistency-design.md](plans/2026-03-10-runtime-settings-config-consistency-design.md) (subsumed by redesign)

</details>

### 4.6 Unified Session Browser — P0 ✅

> Design doc: [plans/2026-03-10-unified-sessions-ui-design.md](plans/2026-03-10-unified-sessions-ui-design.md)
>
> Status note: Delivered on `main`. `/sessions` now mixes discovered and runtime
> sessions, embeds runtime actions in the same page, and `/runtime-sessions`
> remains as a compatibility redirect.

Consolidate `/sessions` and `/runtime-sessions` into one canonical view.

- [x] Merge into single `/sessions` route with `Agent` / `Runtime` / `All` type filters
- [x] Reuse `SessionsPage` shell, embed runtime-specific actions as type-specific detail UI
- [x] Redirect `/runtime-sessions` → `/sessions?type=runtime`
- [x] Collapse dashboard/sidebar/command-palette session navigation

### 4.7 UI Quality & Accessibility — P1

> Based on comprehensive `/audit` scan (2026-03-11). See `docs/plans/2026-03-10-public-repo-prep-design.md` for public repo context.

#### 4.7.1 Critical Accessibility Fixes (Immediate) ✅

- [x] `CopyableText.tsx:77` — span mode: add `role="button"`, `tabIndex={0}`, `onKeyDown` for keyboard access (WCAG 2.1.1)
- [x] `Spinner.tsx:16` — replace `<output>` with `<div role="status">` (WCAG 1.3.1, 4.1.2)
- [x] `layout.tsx` — remove `userScalable: false` to allow pinch-zoom (WCAG 2.5.5)

#### 4.7.2 ARIA & Keyboard Hardening

- [x] `CommandPalette.tsx:469` — add `aria-activedescendant` management to listbox
- [x] `NotificationBell.tsx:90` — migrate manual dropdown to Radix `Popover` with focus trap
- [x] `ContextPickerDialog.tsx` — add `role="tablist"`/`role="tab"`/`role="tabpanel"` to tab interface *(PR #51, #54)*
- [x] `KeyboardHelpOverlay.tsx:32` — fix backdrop `aria-hidden` + `onClick` conflict
- [x] `CollapsibleSection.tsx:21` — add `aria-controls` pointing to content panel
- [x] `Sidebar.tsx` — add `aria-current="page"` to active navigation link *(PR #59)*
- [x] `SessionMessageList.tsx:25` — add `aria-pressed` to ViewModeToggle buttons *(PR #59)*
- [x] `ErrorBanner.tsx` — add `role="alert"` for screen reader announcement *(PR #59)*
- [x] Decorative Lucide icons — audit and add `aria-hidden="true"` where missing *(PR #59)*
- [x] `StatusBadge.tsx` — add native tooltip text, `aria-label`, decorative-dot hiding, and description lookup coverage for lifecycle/status values *(PR #417)*
- [x] Slash-search hotkey regression coverage for Agents, Machines, and Sessions, keeping page search focus behavior stable while the global shortcut catalog uses shared labels *(PR #446)*
- [x] Sessions page keyboard-help overlay and shortcut catalog sync landed with focused unit coverage *(PR #449)*
- [x] Resolve the remaining Sidebar/Sessions `?` event ownership conflict by centralizing overlay ownership in Sidebar and adding keydown propagation regression coverage *(PR #450)*
- [x] Sidebar digit shortcuts now cover `1-9,0`, every sidebar destination has a `g`-prefix Go To chord, Settings renders grouped shortcut docs, and modified second keys preserve browser/app shortcuts *(PR #525)*

#### 4.7.3 Theming Normalization (Kill AI Palette) ✅

- [x] `ProgressIndicator.tsx` — replace hard-coded `cyan-500/400/600` with `--color-primary` tokens
- [x] `SessionMessageList.tsx:299` — same cyan replacement
- [x] `SettingsView.tsx:260-289` — extract hard-coded hex colors into CSS variables
- [x] `DashboardPage.tsx:228` — replace inline `style={{ color: '#ffffff' }}` with token
- [x] `terminal-theme.ts` — migrate hard-coded xterm colors to CSS variable-backed config
- [x] Replace `rgba(0,0,0,...)` shadows (SettingsShell, SessionPreview, SessionsPage) with theme-aware values
- [x] `MemoryPanel.tsx:12` — fix gray-on-gray contrast
- [x] CSS custom properties in `globals.css` for semantic theming

#### 4.7.4 Responsive & Touch Target Hardening ✅

- [x] `ContextPickerDialog.tsx` — responsive right panel
- [x] `ForkConfigPanel.tsx` — responsive fix
- [x] `KeyboardHelpOverlay.tsx` — responsive breakpoints + touch-target close button
- [x] `ContextPickerToolbar.tsx` — increased touch target to min 44px
- [x] `DiscoverSessionRow.tsx` — touch-target buttons with min-h-[32px]
- [x] `Sidebar.tsx` — increased Plus icon button padding
- [x] `SessionsPage.tsx` — responsive list layout

#### 4.7.5 Performance Optimization ✅

- [x] `SessionsPage.tsx` — `React.memo()` for `RuntimeSessionListItem`
- [x] Focus ring contrast verification

**Deliverable**: Zero critical a11y violations, design token compliance, mobile-safe layouts, optimized list rendering

### 4.8 Unified Memory System UI — P1

> Design spec: [plans/2026-03-11-memory-ui-design.md](plans/2026-03-11-memory-ui-design.md)
> Impl plan: [plans/2026-03-11-memory-ui-implementation.md](plans/2026-03-11-memory-ui-implementation.md)
>
> Full-stack vertical implementation: each page ships API route → component → test.
> Top-level `/memory` route with left sidebar, the original 8 memory sub-pages plus the
> synthesis and maintenance follow-up pages, plus memory data
> surfaced contextually across existing agent/session/machine pages.

**Pages (priority order):**

- [x] Memory Browser (`/memory/browser`) — searchable, filterable data table of all facts; 3-column layout (filter sidebar, results list, detail panel); hybrid search (semantic + keyword); bulk actions; URL state via `nuqs`
- [x] Knowledge Graph (`/memory/graph`) — multi-view visualization (Graph/Table/Timeline/Clusters); react-force-graph-2d; click node → detail panel; focus mode, time-lapse animation *(PR #50)*
- [x] Memory Dashboard (`/memory/dashboard`) — original KPI/chart/activity implementation shipped in PR #52; current route re-activation is tracked separately in §20.4 after the memory shell foundation temporarily pointed the page at `MemoryPlaceholderView`
- [x] Consolidation Board (`/memory/consolidation`) — human-in-the-loop knowledge quality review; category cards (contradictions, near-duplicates, stale, orphans); severity-sorted priority queue; AI suggestions with accept/edit/skip/delete actions *(PR #53)*
- [x] Reports (`/memory/reports`) — 3 report types (Project Progress, Knowledge Health, Activity Digest); scope + time range selector; LLM-generated summaries; rendered markdown with download/copy; generation success/failure Playwright coverage *(PR #53, PR #415)*
- [x] Import Wizard (`/memory/import`) — 4-step claude-mem migration wizard (source detection → preview/mapping → progress → summary); dedup via embedding similarity; rollback support *(PR #55)*
- [x] Fact Editor (modal) — accessible from Browser/Graph/command palette; content, entity type, scope, confidence, pinned toggle, relationships editor *(PR #53)*
- [x] Scope Manager (`/memory/scopes`) — scope hierarchy tree with fact counts; promote, merge, rename, delete scope operations *(PR #55)*
- [x] Synthesis Page (`/memory/synthesis`) — structural-lint surface for near-duplicates, stale facts, orphan facts, and synthesis groups over `POST /api/memory/synthesis` *(PR #470)*
- [x] Maintenance Page (`/memory/maintenance`) — stale references, deleted-file references, synthesis clusters, and coverage gaps over `POST /api/memory/maintenance` *(PR #473)*
- [x] Memory Browser fact feedback buttons — thumbs-up / irrelevant / outdated signals on facts via `PATCH /api/memory/facts/:id/feedback` *(PR #472)*
- [x] Browser coverage for the new memory feature surfaces — `/memory/synthesis`, `/memory/maintenance`, fact feedback, and maintenance action flows now have backend-independent Playwright coverage where applicable *(PRs #475, #478)*
- [x] Memory Browser provenance filters — expose Session, Agent, and Machine filters in `/memory/browser` over the existing `GET /api/memory/facts?sessionId=&agentId=&machineId=` backend support, with URL-state and focused browser/unit coverage *(PR #486; [plans/2026-04-14-memory-browser-provenance-filters-plan.md](plans/2026-04-14-memory-browser-provenance-filters-plan.md))*

**Integration points (memory woven into existing pages):**

- [x] Session Detail: new "Memory" tab showing facts read/created/updated during session *(PR #55)*
- [x] Agent Detail: memory usage section with scope distribution + mini knowledge graph *(PR #55)*
- [x] Runtime Sessions: memory injection status with token budget usage *(direct commit)*
- [x] Machine Page: per-machine memory stats and cross-machine sync status *(direct commit)*
- [x] Main Dashboard: memory health card (total facts, growth trend, pending consolidation) *(PR #55)*
- [x] Context Picker: replace current claude-mem panel with unified memory search *(direct commit)*
- [x] Command Palette: `memory:search`, `memory:create`, `memory:graph` commands *(PR #55)*
- [x] Session Creation Form: scope selector + memory budget override *(direct commit)*

**Backend API (`/api/memory/*`):**

- [x] Facts CRUD: `GET/POST/PATCH/DELETE /api/memory/facts`
- [x] Edges CRUD: `GET/POST/DELETE /api/memory/edges`
- [x] Graph data: `GET /api/memory/graph` (nodes + edges for visualization)
- [x] Scopes: `GET/POST /api/memory/scopes`
- [x] Consolidation: `GET /api/memory/consolidation`, `POST .../action` *(direct commit 7ddf8c7)*
- [x] Reports: `POST /api/memory/reports/generate`, `GET /api/memory/reports` *(direct commit cd6bcd3)*
- [x] Decay: `POST /api/memory/decay/run`, `GET /api/memory/decay/stats` *(PR #76, merged c4b026d)*
- [x] Import: `POST /api/memory/import`, `GET /api/memory/import/status`
- [x] Stats: `GET /api/memory/stats` (dashboard metrics)
- [x] Cross-entity queries: `?sessionId=X`, `?agentId=X`, `?machineId=X` *(PR #63)*

**MCP tools (agent runtime access):**

- [x] `memory_search` — hybrid search (vector + BM25 + graph), ranked results *(PR #58)*
- [x] `memory_store` — store new fact with scope + entity_type *(PR #58)*
- [x] `memory_recall` — graph traversal (2-hop BFS) from entity *(PR #58)*
- [x] `memory_feedback` — signal relevance (used / irrelevant / outdated) *(PR #58)*
- [x] `memory_report` — generate scoped report *(PR #58)*
- [x] `memory_promote` — escalate fact to parent scope *(PR #58)*

**Shared components:**

- [x] `FactCard`, `EntityTypeBadge`, `ScopeBadge`, `ConfidenceBar`, `StrengthMeter` *(PRs #47, #53, #57)*
- [x] `MemorySidebar`, `ScopeSelector`, `FactDetailPanel` *(PRs #47, direct commits)*

**Tech stack:** react-force-graph-2d, @tanstack/react-table, recharts, @tanstack/react-virtual, nuqs, react-activity-calendar

### 4.9 Fork UX Extensions — P2

> Design doc: [plans/2026-03-09-fork-ux-overhaul.md](plans/2026-03-09-fork-ux-overhaul.md)
>
> Status note: Delivered on `main` through the unified `ContextPickerDialog`,
> memory search/timeline panel, smart selection helpers, prompt preview, and
> runtime-aware fork flows.

- [x] claude-mem memory integration in fork context selection
- [x] Smart selection helpers for key decisions/topics
- [x] Smart selection tools (auto-select related messages) *(PR #57 — verified wiring)*
- [x] Live prompt preview in fork dialog
- [x] Runtime dimension in create-agent flow from session context
- [x] Runtime dimension in direct session fork flow *(PR #57 — verified wiring)*

---

## 5. Frontend — Mobile

> React Native (Expo) iOS app — still early, but it already includes discovered
> session browsing, managed runtime session controls, handoff history, and agent
> detail streaming.

### 5.1 Mobile Session Browser — P3

> Status note: Delivered on `main`. The mobile app has a unified browser model
> and `SessionBrowserScreen` covering classic + managed sessions with
> type/runtime/machine/status filters, time-range filtering, and richer cards.

- [x] Discovered-session browser with status, message count, and last activity
- [x] Managed runtime session browser with runtime/status/machine metadata
- [x] Unified `SessionBrowser` screen filterable by session source, runtime, machine, and status
- [x] Add time-range filtering to the unified browser *(PR #67 — DateRangePicker with presets)*
- [x] Rich session cards across both surfaces: agent type badge, model, cost, duration, last tool call *(PR #67 — SessionCard component)*
- [x] Tap from the browser into live SSE stream or session replay *(PR #71 — SessionStreamScreen + SessionReplay components)*

### 5.2 Cross-Agent Run View — P3

- [x] Handoff history cards with strategy, reason, preflight summary, and analytics
- [x] Handoff timeline with richer visual markers and context-transfer summary *(PR #67 — HandoffTimeline component with reason-based icons)*
- [x] Expandable diff of each agent's contribution *(PR #67 — ExpandableDiff component)*

### 5.3 Mobile Session Actions — P3

- [x] Resume / fork / manual handoff from mobile managed-runtime screen
- [x] Stop / signal / live SSE stream from mobile agent detail screen
- [x] Pause / resume / stop runtime sessions from one unified action surface *(PR #67 — SessionActionBar component)*
- [x] Push notifications for handoff events *(PR #67 — handoff-notifications service with Expo Notifications)*

---

## 6. Security & Observability

> OWASP compliance, security pipeline, audit logging, threat model.

<details>
<summary>✅ Comprehensive security stack — OWASP Top 10 mapped, audit pipeline, runtime hardening</summary>

### 6.1 OWASP Agentic Top 10 Compliance

| Risk | Mitigation | Status |
|------|-----------|--------|
| ASI01 — Goal Hijack | PreToolUse hook + prompt injection detection | ✅ |
| ASI02 — Tool Misuse | allowedTools/disallowedTools allowlist | ✅ |
| ASI03 — Identity Abuse | Per-agent identity + short-lived tokens + Tailscale ACLs | ✅ |
| ASI04 — Supply Chain | npm bulk advisory audit + Trivy + Grype + SBOM + pinned deps | ✅ |
| ASI05 — Code Execution | Sandbox (bubblewrap/Seatbelt) + cap-drop + network=none | ✅ |
| ASI06 — Memory Poisoning | Mem0 validation + per-agent isolation + TTL | ✅ |
| ASI07 — Inter-Agent Comms | TweetNaCl E2E + Tailscale WireGuard | ✅ |
| ASI08 — Cascading Failures | Timeout + circuit breaker + BullMQ backoff + checkpoints | ✅ |
| ASI09 — Trust Exploitation | Approval gates + cost alerts + dead-loop detection | ✅ |
| ASI10 — Rogue Agents | SHA-256 audit log + anomaly detection + kill switch | ✅ |

### 6.2 Security Pipeline

- [x] SAST: CodeQL (`security-extended`) + Semgrep (`p/security-audit` + `p/secrets`)
- [x] SCA: npm bulk advisory dependency audit, license check (no GPL/AGPL), Trivy + Grype
- [x] Secret scanning: gitleaks + GitHub push protection
- [x] DAST: OWASP ZAP baseline scan + WebSocket fuzzing

### 6.3 Security Audit Agent

- [x] Read-only agent on nightly cron (BullMQ scheduled)
- [x] Structured JSON report → control plane → auto-create GitHub Issues for high-severity
- [x] Sandboxed: read-only FS, no network egress, restricted tools

### 6.4 Runtime Security Controls

- [x] Per-session short-lived tokens, network egress allowlist, FS isolation
- [x] Tool rate limiting, prompt injection defense (sanitize + flag + guardian agent)
- [x] Kill switch: `POST /api/agents/:id/emergency-stop`
- [x] Anomaly detection on tool-call patterns

### 6.5 Audit Logging & Forensics

- [x] NDJSON with SHA-256 hash chain (tamper detection)
- [x] Configurable retention + batch cleanup
- [x] Queryable API: `GET /api/audit?agentId=X&from=T1&to=T2&tool=Bash`
- [x] Dashboard: top tools, cost by agent, error rates, blocked calls, session replay
- [x] Web `/audit` trail page with filters, empty/error/loading states, focused unit coverage, and backend-independent Playwright coverage in the web e2e CI lane *(PRs #507, #513; see [plans/2026-04-14-audit-trail-page-plan.md](plans/2026-04-14-audit-trail-page-plan.md))*
- [x] Logs UI Security Findings tab over `GET /api/security/findings`, with focused API/query/view tests *(PR #416; Playwright coverage for happy-path rows/summary badges, empty state, severity filter, and error banner in PR #436)*

### 6.6 Threat Model & Compliance

- [x] AgentCTL threat model (multi-machine, multi-agent, mobile control surface)
- [x] Mapped to OWASP Agentic Top 10, NIST AI RMF, Anthropic safety guidelines
- [x] Security runbook: rogue agent, credential leak, prompt injection procedures
- [ ] Quarterly review cadence (ongoing)

</details>

---

## 7. Developer Knowledge Engineering

> Improvements to how agents learn and accumulate knowledge during AgentCTL development itself. Inspired by [stonepage's Agent 知识工程实践](https://zhuanlan.zhihu.com/p/1898602837).

### 7.1 Layered Knowledge Loading — P2

Restructure `.claude/rules/` to avoid always-loading all rules. Most rules should be on-demand with trigger-based loading.

- [x] Add front-matter `triggers:` to `.claude/rules/` files specifying when each ruleset should activate
- [x] Split always-on rules (critical guardrails) from on-demand rules (coding style, patterns)
- [x] Minimize MEMORY.md to only irreversible-damage rules; move everything else to topic-specific files
- [x] Audit existing rules for relevance and remove outdated entries

### 7.2 Knowledge Sedimentation Rules — P2

Meta-rules about when and how to add knowledge to the project's documentation and memory files.

- [x] Create `docs/KNOWLEDGE_SEDIMENTATION.md` defining:
  - When an observation becomes a lesson (requires 2+ occurrences or irreversible impact)
  - What makes a good principle (falsifiable, contextual, actionable)
  - When to promote from session notes → LESSONS_LEARNED → CLAUDE.md rules
  - How to format knowledge for AI agent consumption (atomic, standalone, outcome-included)
- [x] Reference sedimentation rules from CLAUDE.md

### 7.3 Automated Experience Extraction — P3

Post-session hooks that extract lessons from development sessions into appropriate knowledge files.

- [x] Claude Code Stop hook: summarize key decisions and lessons from session *(PR #64 — experience-extraction-hook.ts)*
- [x] Route extracted knowledge to correct file (LESSONS_LEARNED.md, debugging.md, or relevant topic file) *(PR #64 — entity_type routing: decision, pattern, error, experience)*
- [x] Dedup against existing entries before writing *(PR #64 — Jaccard similarity threshold 0.85)*
- [x] Human review flag for non-obvious extractions *(PR #64 — `needs-review` tag for confidence < 0.7)*

### 7.4 Knowledge Maintenance / Dreaming — P3

Periodic review of accumulated knowledge for staleness, contradictions, and synthesis opportunities.

- [x] Monthly lint of LESSONS_LEARNED.md, MEMORY.md, `.claude/rules/` for outdated entries *(PR #65 — stale-entry lint pass)*
- [x] Cross-reference lessons against codebase changes (lessons about deleted code should be archived) *(PR #65 — git log --diff-filter=D cross-reference)*
- [x] Synthesis pass: identify clusters of related lessons and propose higher-level principles *(PR #65 — 2-hop BFS clustering + principle generation)*
- [x] Track "knowledge coverage" — which areas of the codebase have lessons vs. knowledge gaps *(PR #65 — coverage report as knowledge-health MemoryReport)*

---

## 8. Deployment & Operations

> Production deployment tooling, CLI/TUI monitoring, and operational guides.

<details>
<summary>✅ All complete — Deploy CLI, TUI monitor, deployment guide (PRs #72-#73)</summary>

### 8.1 Deploy CLI — P1

Interactive deployment management via `agentctl deploy` subcommands (`scripts/deploy.ts`).

- [x] `agentctl deploy init` — interactive .env generation, dependency checks (Node 22+, pnpm, Docker, PG, Redis), auto pnpm install + build + DB migration
- [x] `agentctl deploy up [--prod]` — dev mode (tsx watch) or prod mode (Docker Compose); `--worker` flag for worker-only machines
- [x] `agentctl deploy down` — stop all services (PM2 or Docker)
- [x] `agentctl deploy status` — parallel health checks on all services, table output
- [x] `agentctl deploy logs <service>` — stream logs from CP/Worker/Web

### 8.2 TUI Monitoring Panel — P1

Full-screen real-time monitoring via `agentctl tui` (Ink 4.x, `scripts/tui.tsx` + `scripts/tui/`).

- [x] Layout: 3-panel (Services status, Agents list, Activity feed)
- [x] ServicePanel: 5s polling of /health endpoints, red/green status indicators
- [x] AgentPanel: live agent list with status/cost/duration, keyboard selection
- [x] ActivityFeed: SSE real-time event stream from control plane
- [x] LogViewer: drill-down log viewer for selected service
- [x] Keyboard shortcuts: q(quit), r(restart), s(stop), l(logs), Enter(detail)

### 8.3 Deployment Guide — P1

Step-by-step deployment documentation (`docs/DEPLOYMENT.md`).

- [x] Quick Start: single-machine dev setup (5 minutes)
- [x] Production: Docker Compose deployment with security hardening
- [x] Multi-Machine: Tailscale mesh + per-machine worker setup
- [x] Troubleshooting: common errors + solutions quick reference

</details>

---

## 9. Agent Execution Quality (UX Gaps)

> Critical functional gaps in agent execution identified during real-world usage. These prevent agents from being usable in real workflows.

### 9.1 CLAUDE.md / Project Instructions Discovery — P0 ✅

> Fixed in PR #78. Added `--cwd <projectPath>` to `buildCliArgs()` in `cli-session-manager.ts`
> so the CLI explicitly discovers `CLAUDE.md` and `.claude/rules/` from the correct project root.

- [x] Add `--cwd` flag to CLI args for explicit project root discovery *(PR #78)*
- [x] Test updated to verify `--cwd` is included in CLI args *(PR #78)*

### 9.2 MCP Server Configuration for Agents — P0 ✅

> Fixed in PR #80. Added `mcpServers` field to `AgentConfig` (shared types) and `.mcp.json` writing
> in `cli-session-manager.ts` before agent startup. MCP server config flows from agent config → CLI session → project dir.

- [x] Add `McpServerConfig` type and `mcpServers` field to `AgentConfig` *(PR #80)*
- [x] Write `.mcp.json` to project dir before CLI spawn *(PR #80)*
- [x] Store MCP server selection in agent config (`config.mcpServers`) *(PR #80)*
- [x] MCP server picker in agent creation/edit UI (web) *(PR #82)*
- [x] Control plane → worker config downlink: include MCP config in job payload *(PR #132)*

> **User feedback**: Manual MCP form is bad UX. Needs auto-detection and managed push-down. See §11.6 (delivered) and §14 (next evolution: runtime-aware + skill discovery + machine defaults).

### 9.3 Agent Config as Default Prompt — P1 ✅

> Fixed in PR #79. Added `defaultPrompt` to `AgentConfig`, made `prompt` optional in start endpoint
> with fallback to `config.defaultPrompt`. Cron/heartbeat agents no longer need explicit prompt.

- [x] Add `defaultPrompt` field to `AgentConfig` type (shared) *(PR #79)*
- [x] Make `prompt` optional in `StartAgentBody` — fall back to `config.defaultPrompt` *(PR #79)*
- [x] UI: show default prompt in agent edit form; allow override on manual start *(PR #82)*

### 9.4 Cost Tracking Display Fix — P1 ✅

> Fixed in PR #79. Two bugs found and fixed:
> 1. `sdk-runner.ts` only emitted cost events when `message.usage` present, but `result` messages carry `total_cost_usd` without a `usage` object
> 2. Frontend field name mismatch: backend sent `{turnCost, totalCost}` but frontend expected `{totalCostUsd, inputTokens, outputTokens}`

- [x] Fix sdk-runner to emit cost events from `result` messages with `total_cost_usd` *(PR #79)*
- [x] Fix frontend SSE field name mismatch (`totalCost` → `totalCostUsd`) *(PR #79)*

### 9.5 Cron UX Improvements — P1 ✅

> Fixed in PR #81. Visual cron builder with presets, human-readable description, and next 5 runs preview.

- [x] Cron expression builder widget: visual picker with presets and human-readable preview *(PR #81)*
- [x] Show next 5 scheduled run times when editing cron expression *(PR #81)*
- [x] Alerting: health endpoint + badge for consecutive cron failures *(PR #84)*

### 9.6 Agent Execution History Improvements — P2 ✅

> Fixed in PR #81. Grouped by date with collapsible headers, filters by status/trigger/date, and summary stats.

- [x] Group runs by day with collapsible headers *(PR #81)*
- [x] Summary stats per time period: total runs, success rate, total cost, avg duration *(PR #81)*
- [x] Quick filters: status, trigger type, date range *(PR #81)*
- [x] Run timeline visualization (horizontal bar chart with recharts) *(PR #83)*

---

## 10. Multi-Agent Collaboration

> Design doc: [plans/2026-03-12-multi-agent-collaboration-design.md](plans/2026-03-12-multi-agent-collaboration-design.md)
> Impl plan: [plans/2026-03-12-multi-agent-collaboration-phase1-impl-plan.md](plans/2026-03-12-multi-agent-collaboration-phase1-impl-plan.md)
>
> Human-agent collaborative workspaces with cross-space context mobility.
> Architecture: Hybrid Spaces + Task Graph (Option C from design evaluation).

### 10.1 Phase 1: Spaces + Threads + Messages — P1 ✅

> Delivered in PRs #91-92. Shared types, Drizzle schema + migration, CP stores/routes, web Spaces UI (list + detail + thread feed), and session-space bridge.

- [x] Shared types: Space, Thread, SpaceEvent, SpaceMember (collaboration.ts) *(committed to main)*
- [x] DB schema: spaces, threads, space_events, space_members, session_space_links + migration *(PR #91)*
- [x] CP stores: SpaceStore, ThreadStore, EventStore with atomic sequence *(PR #91)*
- [x] CP routes: `/api/spaces/*` CRUD + members + threads + events *(PR #91)*
- [x] Web: Spaces list page + Space detail with thread feed + EventComposer *(PR #92)*
- [x] Session bridge: SessionSpaceLink component for solo Space creation *(PR #92)*
- [x] Full build verification: shared + CP + web all pass *(PRs #91-92)*

### 10.2 Phase 2: Multi-Agent Communication — P2 ✅

> Delivered in PR #95. Outbox publisher, NATS JetStream transport, WebSocket event gateway, agent profiles/instances, approval gates, subscription filters.

- [x] Agent Bus: Postgres outbox + NATS JetStream (EventBus interface + MockEventBus for CI) *(PR #95)*
- [x] AgentMessage protocol: request/response/inform/delegate/escalate/ack with typed payloads *(PR #95)*
- [x] Agent identity: AgentProfile + AgentInstance with CRUD routes *(PR #95)*
- [x] Agent Profiles web UI: `/agent-profiles` CRUD page — list, create dialog, delete confirm, sidebar entry *(PR #498; frontend shipped on top of existing backend; see [plans/2026-04-14-agent-profiles-web-plan.md](plans/2026-04-14-agent-profiles-web-plan.md))*
- [x] Approval gates: multi-decision support + timeout policies *(PR #95)*
- [x] WebSocket event gateway with visibility filtering *(PR #95)*
- [x] Subscription filters on SpaceMember *(PR #95)*
- [x] DB migration 0003: subscription_filter column + approval_gates/decisions tables *(PR #95)*

### 10.3 Phase 3: Task Graph + Fleet — P2 ✅

> Delivered in PR #94. DAG validation, task graph CRUD, worker leases, BullMQ pluggable executor, fleet node management.

- [x] Task Graph engine: TaskDefinition/TaskEdge + DAG validation (cycle detection, topological sort) *(PR #94)*
- [x] Task runs: lifecycle management + status transitions + heartbeat *(PR #94)*
- [x] Worker leases: claim/renew/release/expire protocol *(PR #94)*
- [x] BullMQ TaskExecutor implementing pluggable TaskExecutor interface *(PR #94)*
- [x] Fleet overview: worker node CRUD + heartbeat + aggregate status *(PR #94)*
- [x] DB migration 0002: task_graphs, task_definitions, task_edges, task_runs, worker_leases, worker_nodes *(PR #94)*
- [ ] Temporal.io migration for durable multi-step workflows *(deferred — evaluate when approval waits become common)*

### 10.4 Phase 4: Context Bridge — P3 ✅

> Delivered in PRs #97, #131, #133. Shared types, Drizzle schema, ContextBridgeStore, REST API routes, cross_space_query MCP tool, and context budget management.

- [x] Reference mode: live pointer to source event/artifact in another Space *(PR #97)*
- [x] Copy mode: snapshot of context from another Space (frozen at point-in-time) *(PR #97)*
- [x] Subscription mode: cross-space subscriptions with filter criteria *(PR #97)*
- [x] Query mode: `cross_space_query` MCP tool for agent runtime *(PR #131)*
- [x] Context budget management across spaces *(PR #133)*

### 10.5 Phase 5: Intelligence Layer — P3 ✅

> Impl plan: [plans/2026-03-12-intelligence-layer-impl-plan.md](plans/2026-03-12-intelligence-layer-impl-plan.md)
>
> Four capabilities: smart routing (weighted scoring with historical performance), LLM-based task
> auto-decomposition, outcome learning (sliding-window feedback loop), and priority-based notification routing.

- [x] Smart Routing: capability match + load + cost + historical success scoring → ranked candidate selection (Phase 5a) — PR #113
- [x] Routing API input bounds hardening: rank/assign/outcome payloads validate bounded strings/arrays, capped rank limits, non-negative finite numeric fields, and breakdown object shape before engine/store calls *(PR #497)*.
- [x] Auto-Decompose: LLM-based natural-language task → TaskGraph with DAG validation (Phase 5b) — PR #111
- [x] Auto-Decompose web UI: **Auto-decompose** action on `/tasks/[id]` with two-step preview/apply dialog over `POST /api/decompose` + `/preview`, including subtask/dependency rendering, token/cost estimates, post-apply navigation to the new graph, fresh initial-description seeding, stale-preview protection when the source task text changes after preview, and browser coverage for apply failure keeping the preview available *(PRs #474, #478, #487)*
- [x] Outcome Learning: sliding-window stats from task completions → refine routing scores + approval timeouts (Phase 5c) — PR #113
- [x] Notification Routing: priority classification + per-user channel preferences + quiet hours (Phase 5d) — PR #112

---

## 11. Agent Detail Page UX Fixes

> Five user-reported issues on the agent detail page (`/agents/[id]`).

### 11.1 Start Button Ignores defaultPrompt — P0 ✅

> Fixed in PR #86. `handleStart()` now computes `effectivePrompt = prompt.trim() || agent.config.defaultPrompt || ''` and only blocks when empty. Placeholder shows "Using default prompt..." when defaultPrompt exists.

- [x] Pre-fill prompt input with defaultPrompt *(PR #86)*
- [x] Allow "Go" without text if defaultPrompt exists *(PR #86)*

**Fix:**
- Pre-fill prompt input with `agent.config.defaultPrompt` when available
- Allow "Go" without entering text if defaultPrompt exists
- Show placeholder like "Using default prompt: {truncated}" when pre-filled

### 11.2 Agent Header Overflow — P1 ✅

> Fixed in PR #86. Added `truncate min-w-0 max-w-[300px]` + `title` tooltip to agent name `h1` element. Header flex container uses `min-w-0`.

- [x] CSS truncation with tooltip on hover *(PR #86)*

### 11.3 Cost Display Still $0.00 — P1 ✅

> Fixed in PR #87. Root cause: agent GET endpoint returned static 0 values. Fix: CP now computes `lastCostUsd` from most recent run and `totalCostUsd` as sum of all runs via DB registry methods.

- [x] `getLastRunCost(agentId)` — fetches most recent run's cost_usd *(PR #87)*
- [x] `getTotalCost(agentId)` — sums all runs' cost_usd *(PR #87)*
- [x] Agent GET route returns computed costs *(PR #87)*

### 11.4 Run History Bar Too Thin — P1 ✅

> Fixed in PR #88. Replaced thin `RunHistoryBar` with recharts `BarChart` component (`RunHistoryChart.tsx`). Shows duration as bar height, colored by status, with hover tooltips showing date/duration/status/cost.

- [x] `RunHistoryChart` component with recharts BarChart *(PR #88)*
- [x] Status-based coloring + tooltips *(PR #88)*

### 11.5 Execution History ↔ Session Linkage — P1 ✅

> Fixed in PR #88. `GroupedRunHistory` now shows "View Session" link for runs with sessionId. Run type includes `sessionId` field. API response maps session associations.

- [x] `sessionId` on run entries with clickable session link *(PR #88)*
- [x] API returns sessionId on runs *(PR #88)*

### 11.6 MCP Server Auto-Detection & Managed Config — P0 ✅

> Fixed in PR #89. Three-layer MCP discovery: project files (`.mcp.json`, `.claude/settings.json`), machine-level, and managed templates. `McpServerPicker` replaces manual form with auto-detected + template cards.
>
> **Next evolution**: §14 extends this with runtime-aware discovery (Codex TOML support), skill auto-discovery, machine-level defaults with per-agent opt-out overrides, and unified picker in both create and edit flows.

- [x] Worker `GET /api/mcp/discover?projectPath=...` — scans project + global config *(PR #89)*
- [x] CP `GET /api/mcp/templates` — common MCP server templates *(PR #89)*
- [x] `McpServerPicker` component with source badges *(PR #89)*
- [x] `DiscoveredMcpServer` type with source tracking *(PR #89)*

### 11.7 Agent Settings Redesign — P0 ✅

> Fixed in PR #90. Full-page tabbed settings at `/agents/[id]/settings` with 5 tabs. `AgentFormDialog` simplified to quick-create mode (name, machine, type, model only).

- [x] `/agents/[id]/settings/page.tsx` — full-page settings with shadcn Tabs *(PR #90)*
- [x] `GeneralTab`, `ModelPromptsTab`, `PermissionsToolsTab`, `McpServersTab`, `MemoryTab` *(PR #90)*
- [x] Each tab saves independently via React Query mutations *(PR #90)*
- [x] "Settings" link on agent detail page *(PR #90)*
- [x] `AgentFormDialog` simplified for quick-create *(PR #90)*

---

## 12. Environment Isolation & Continuous Deployment

> Dev/beta tier separation so AI agent development never disrupts the developer's running services.
> Plan: [dev-environment-cd-strategy](plans/2026-03-12-dev-environment-cd-strategy.md) | User guide: [USER-SETUP-CD-TIERS.md](USER-SETUP-CD-TIERS.md)
>
> Status note: active development should stay on `dev-1` / `dev-2`. Beta promotion remains local/manual via `./scripts/env-promote.sh --from dev-1|dev-2` until the deployment target has a dedicated `agentctl-beta` self-hosted runner and the repository enables `BETA_SELF_HOSTED_RUNNER_READY`. Until then, `promote-beta.yml` is only a future gate scaffold and GitHub-hosted automation must not touch beta.

### 12.0 De-Hardcode Ports (Prerequisite) — ✅ Delivered (PRs #103, #445)

- [x] Make `next.config.ts` rewrites read from `NEXT_PUBLIC_API_URL` env var
- [x] Make `use-websocket.ts` + `InteractiveTerminal.tsx` read from `NEXT_PUBLIC_WS_URL`
- [x] `.env.template` committed with documented tier configuration
- [x] Make web `package.json` scripts read `WEB_PORT` env var *(PR #445)*
- [x] Repo-wide remaining hardcoded port audit *(PR #137)*

### 12.1 Environment Files — ✅ Delivered (PR #103)

- [x] Create `.env.template` (tracked in git)
- [x] `.env.beta`, `.env.dev-1`, `.env.dev-2` created locally (git-ignored, contain credentials)
- [x] `TIER` env var guardrail in `env-up.sh`
- [ ] Symlink `.env → .env.beta` (user manual step)

### 12.2 Database Isolation — Partial

- [x] Dry-run-first `scripts/db-provision-tier.ts` helper for dev-1/dev-2 databases and least-privilege app roles (PR #482)
- [ ] Run per-tier PG database/role provisioning locally with admin credentials — **user manual step** (see USER-SETUP-CD-TIERS.md)
- [x] `scripts/env-migrate.sh` with `--tier` flag and beta safety gate (PR #104)

### 12.3 PM2 Beta Process Management — ✅ Delivered (PR #104)

- [x] `infra/pm2/ecosystem.beta.config.cjs` running built artifacts
- [x] `max_memory_restart` safety cap (512M CP/Worker, 256M Web)
- [ ] `pm2 startup` integration — **user manual step**

### 12.4 Lifecycle Scripts — ✅ Delivered (PR #104)

- [x] `scripts/env-up.sh` — port check + flock + start services
- [x] `scripts/env-up.sh --dry-run` — preview env file, ports, redacted DB/Redis target, and port-conflict report without acquiring the flock or starting services *(PR #500)*
- [x] `scripts/env-down.sh` — graceful shutdown + lock release
- [x] `scripts/env-promote.sh` — build + schema parity + migrate + restart + rollback *(PR #130)*
- [x] Dev-tier startup portability follow-up: `env-up.sh` now has a macOS-safe lock fallback, starts Web through the `WEB_PORT`-aware package script without duplicate `--port` args, and starts control-plane with `SKIP_MIGRATIONS=true` after the explicit migration step so already-migrated dev databases do not fail on legacy non-idempotent migrations.

### 12.5 Agent Worktree Integration — ✅ Delivered

- [x] Tier assignment with flock-based locking *(PR #127)*
- [x] Auto-source `.env.dev-N` in agent worktree setup *(PR #127)*
- [x] Cleanup on PR completion *(PR #125)*

### 12.6 GitHub Actions CD Gate — Partial

> Design doc: [promote-beta-cd-gate-reality-sync-design](plans/2026-03-21-promote-beta-cd-gate-reality-sync-design.md)
> Impl plan: [promote-beta-cd-gate-reality-sync-implementation-plan](plans/2026-03-21-promote-beta-cd-gate-reality-sync-implementation-plan.md)

- [ ] Dedicated `agentctl-beta` self-hosted runner on the beta deployment target
- [ ] Repository variable `BETA_SELF_HOSTED_RUNNER_READY` enabled after the self-hosted runner is validated
- [x] `promote-beta.yml` workflow scaffold with environment protection rules and fail-fast reality-sync until the beta self-hosted runner exists *(PR #136, PR #355; still future-gated until the prerequisites above land)*
- [ ] Extend to prod tier on remote machines via Tailscale

### 12.7 Deployment Page UI — P1 ✅

> Design spec: [deployment-page-design](superpowers/specs/2026-03-13-deployment-page-design.md)
> Impl plan: [deployment-page](superpowers/plans/2026-03-13-deployment-page.md)
>
> Delivered in PR #144. Full deployment page with tier status, gated promotion, and history.
> Follow-up: the promote panel now mirrors §12.6 by making the GitHub-triggered beta gate explicit: beta promotion stays local/manual from `dev-1` / `dev-2` until the `agentctl-beta` self-hosted runner and `BETA_SELF_HOSTED_RUNNER_READY` are both live *(PR #453)*.

- [x] Tier status cards (dev-1, dev-2, beta, production) with health indicators *(PR #144)*
- [x] Dev-tier cards now surface health-derived MEM/UPTIME and prefer PM2 metrics when PM2 data is available *(PR #230)*
- [x] Gated promotion UI with preflight checks *(PR #144)*
- [x] Promotion history panel *(PR #144)*
- [x] SSE-powered progress streaming during promotions *(PR #144)*
- [x] Rollback controls *(PR #144)*

---

## 13. Open Source & Community

> Repository hygiene, license, contribution guidelines, security policy, GitHub templates.

> Design doc: [public-repo-prep-design](plans/2026-03-10-public-repo-prep-design.md)
> Impl plan: [public-repo-prep-impl-plan](plans/2026-03-10-public-repo-prep-impl-plan.md)

<details>
<summary>✅ All complete — BSL 1.1 license, contribution guidelines, security policy, GitHub templates</summary>

### 13.1 License & Legal

- [x] `LICENSE` — BSL 1.1 (source-available, converts to Apache 2.0 after 4 years)
- [x] Additional Use Grant: self-host permitted, competitive SaaS restricted
- [x] AGPL dependency note: `claude-mem` used as external service, not embedded

### 13.2 Contribution Guidelines

- [x] `CONTRIBUTING.md` — fork → branch → PR workflow, code style, DCO sign-off
- [x] `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1

### 13.3 Security Policy

- [x] `SECURITY.md` — GitHub Private Vulnerability Reporting, 48h ack SLA, 90-day fix target
- [x] Supported versions, scope definition, responsible disclosure credit

### 13.4 GitHub Templates

- [x] `.github/ISSUE_TEMPLATE/bug_report.yml` — YAML-based form (description, repro, environment)
- [x] `.github/ISSUE_TEMPLATE/feature_request.yml` — YAML-based form (problem, solution, alternatives)
- [x] `.github/PULL_REQUEST_TEMPLATE.md` — what/why, related issue, test checklist

### 13.5 README

- [x] License badge (BSL 1.1)
- [x] Contributing and Security sections with links
- [x] Removed "Private repository. All rights reserved." language

### 13.6 Cleanup

- [x] Deleted `AGENTS.md` (broken copy of CLAUDE.md with inaccurate info)

</details>

---

## 14. MCP & Skill Auto-Discovery

> Runtime-aware auto-discovery of MCP servers and skills from machine configs, with machine-level defaults and per-agent opt-out overrides.

> Design spec: [mcp-skill-discovery-design](superpowers/specs/2026-03-14-mcp-skill-discovery-design.md)
> Impl plan: [mcp-skill-discovery](superpowers/plans/2026-03-14-mcp-skill-discovery.md)

**Problem:** Creating or editing agents requires manually entering MCP server and skill configs every time. In a multi-agent, multi-machine environment this is O(n) repetitive work. Each machine already has MCP servers configured in Claude Code's `~/.claude.json` and Codex's `.codex/config.toml`, plus skills in `~/.claude/skills/` and `~/.agents/skills/`, but the platform doesn't auto-discover them.

### 14.1 Shared Types & Override Resolution — P0 ✅

> Delivered in PR #146. Foundation types for all layers.

- [x] Extend `MachineCapabilities` with discovery provenance fields (`mcpServerSources`, `skillSources`, `lastDiscoveredAt`) *(PR #146)*
- [x] Extend `ManagedSkill` with display metadata (`name`, `description`, `source`) *(PR #146)*
- [x] Add `DiscoveredSkill` type and `configFile` field on `DiscoveredMcpServer` *(PR #146)*
- [x] Remove the agent-worker-local `_type-stubs.ts` bridge and import canonical shared discovery types directly from `@agentctl/shared` *(PR #479)*
- [x] Add `CustomMcpServer`, `AgentMcpOverride`, `AgentSkillOverride` types on `AgentConfig` *(PR #146)*
- [x] Pure-function override resolution: `resolveEffectiveMcpServers()`, `resolveEffectiveSkills()` — opt-out model (defaults - excluded + custom) *(PR #146)*

### 14.2 Worker Discovery — P0 ✅

> Delivered in PR #147. Runtime-aware discovery scanning machine-local config files.

- [x] Codex TOML MCP parser (`smol-toml`) — scans `~/.codex/config.toml` and `<project>/.codex/config.toml` *(PR #147)*
- [x] Skill discovery for both runtimes — scans `~/.claude/skills/*/SKILL.md` (Claude Code) and `~/.agents/skills/*/SKILL.md` (Codex), parses YAML frontmatter *(PR #147)*
- [x] In-memory discovery cache (60s TTL) — avoids redundant filesystem scans *(PR #147)*
- [x] Extend existing `GET /api/mcp/discover` with `runtime` query param (claude-code | codex) *(PR #147)*
- [x] New `GET /api/skills/discover?runtime=...` endpoint *(PR #147)*
- [x] Replace `description: "From <path>"` pattern with structured `configFile` field *(PR #147)*

### 14.3 Control Plane Proxies & Sync — P0 ✅

> Delivered in PR #149.

- [x] Extend MCP discover proxy (`mcp-templates.ts`) to forward `runtime` param *(PR #149)*
- [x] New skill discover proxy (`skill-discover.ts`) *(PR #149)*
- [x] `POST /api/machines/:machineId/sync-capabilities` — calls both discovery endpoints, updates machine record with provenance *(PR #149)*

### 14.4 Frontend Picker UX — P0 ✅

> Delivered in PR #151.

- [x] Refactor `McpServerPicker` from flat `Record<string, McpServerConfig>` to override model (`AgentMcpOverride`) *(PR #151)*
- [x] Three visual states per item: inherited (machine default), excluded (user opted out), custom (manually added) *(PR #151)*
- [x] New `SkillPicker` component — mirrors McpServerPicker pattern with SKILL.md metadata display *(PR #151)*
- [x] Replace `McpServersTab` manual JSON form with `McpServerPicker` + `isManagedRuntime` guard *(PR #151)*
- [x] New `SkillsTab` in agent settings *(PR #151)*
- [x] Update `AgentFormDialog` state management to override model, add `SkillPicker` *(PR #151)*
- [x] Legacy migration: existing `mcpServers` flat records → `mcpOverride.custom` entries *(PR #151)*

### 14.5 Machine Capability Triggers — P1 ✅

> Delivered in PR #153.

- [x] Trigger `sync-capabilities` on machine online transition (offline → online state change) *(PR #153)*
- [x] Picker-triggered re-sync via refresh button calling sync-capabilities *(PR #153)*
- [x] Auto-clear overrides + user notification when agent switches runtime *(PR #153)*

### 14.6 E2E Testing — P0 ✅

> Delivered in PR #152 (test stubs, require running backend).

- [x] Playwright: create agent with discovered MCP servers, toggle overrides, save + verify *(PR #152)*
- [x] Playwright: edit agent MCP tab (picker replaces manual form), Skills tab (new) *(PR #152)*
- [x] Playwright: runtime switching refreshes picker with correct discovery results *(PR #152)*

---

## 15. Codex Runtime Parity

> Close the gap between backend Codex support and frontend exposure. Two sub-projects: (A) runtime selector penetration, (B) Codex config capabilities.

### 15.1 Runtime Selector Penetration — P0 (Sub-project A)

> Design spec: [runtime-selector-penetration-design](superpowers/specs/2026-03-14-runtime-selector-penetration-design.md)
> Impl plan: [runtime-selector-penetration](superpowers/plans/2026-03-14-runtime-selector-penetration.md)

Make all create/edit/filter flows runtime-aware with three shared components.

- [x] Consolidate `DiscoveredSession` type into shared package (3 independent definitions → 1) *(PR #148)*
- [x] Add runtime detection to worker session discovery (`.claude/` vs `.codex/` markers) *(PR #148)*
- [x] Add `runtime` parameter to session creation API *(PR #148)*
- [x] `RuntimeSelector` component (radio + dropdown variants) *(PR #148)*
- [x] `RuntimeAwareModelSelect` component (auto-switches model list, auto-resets invalid model) *(PR #148)*
- [x] `RuntimeAwareMachineSelect` component (filters by runtime installation via drift API) *(PR #148)*
- [x] Integrate into `AgentFormDialog`, `CreateSessionForm`, `DiscoverNewSessionForm` *(PR #150)*
- [x] Integrate into Agent Settings `GeneralTab` (with confirmation dialog on runtime change) *(PR #150)*
- [x] `DiscoverPage`: runtime badges + runtime filter *(PR #150)*
- [x] `SessionsPage`: runtime badge in session rows *(PR #150)*
- [x] `MachineDetailView`: "Available Runtimes" section *(PR #150)*

### 15.2 Codex Config Capabilities Exposure — P1 ✅ (Sub-project B)

> Design spec: [codex-config-capabilities-design](superpowers/specs/2026-03-14-codex-config-capabilities-design.md)
> Impl plan: [codex-config-capabilities](superpowers/plans/2026-03-14-codex-config-capabilities.md)
>
> Delivered in PR #156.

- [x] `AgentRuntimeConfigOverrides` type + per-agent override merge in config renderers *(PR #156)*
- [x] Sandbox level selector (`read-only` / `workspace-write` / `danger-full-access`) *(PR #156)*
- [x] Approval policy selector (`untrusted` / `on-failure` / `on-request` / `never`) *(PR #156)*
- [x] Reasoning effort selector (`low` / `medium` / `high`) — Codex-specific *(PR #156)*
- [x] Model provider selector (`openai` / `azure`) — Codex-specific *(PR #156)*
- [x] New "Runtime Config" tab in agent settings *(PR #156)*
- [x] Config preview UI (rendered `.claude.json` or `.codex/config.toml`) *(PR #156)*

---

## 16. Bug Fixes & Quality

### 16.1 Agent Run Quality — P0

- Stability/security cycle plan: [plans/2026-03-15-main-stability-and-security-cycle-plan.md](plans/2026-03-15-main-stability-and-security-cycle-plan.md) *(historical cycle delivered on `main`; the 2026-04-01 follow-up is now also closed via PR #385 plus PRs #386-#388, leaving GitHub with `0` open PR/dependency/secret/code-scanning items as of 2026-04-01)*
- Status note: The historical CI/CodeQL/Dependabot/DAST recovery through PR #227 remains delivered on `main`; the 2026-04-01 and 2026-04-13 follow-up loops are represented in the stability plan and current checklist below. Follow-up note (2026-04-14): PR #440 removed the red Biome security-lint annotation and skipped empty invalid Grype SARIF uploads, PR #442 landed the SessionHeader/GitStatusBadge accessibility follow-up, PR #443 introduced Zod validation and bounded strings on checkpoint/mobile-push/knowledge-maintenance write surfaces, PR #444 added focused `/webhooks` Playwright coverage, PR #445 moved the backend-independent webhooks Playwright slice into CI, PR #447 added mobile-push validation negative coverage, PR #448 tightened batch-2 input validation across six control-plane surfaces, PR #452 hardened sync-peer registration/ping validation against unsafe peer URLs and metadata/local SSRF targets, PR #454 added `/logs` Security Findings Playwright coverage, PR #455 added `/memory/browser` facts-flow Playwright coverage, PR #457 adds backend-independent `/memory/import` browser coverage for the import wizard's JSONL completion and cancellation paths, PR #458 makes the `/settings` Playwright slice fully backend-independent while covering add/remove notification preferences, and PR #459 adds backend-independent `/discover` browser coverage for grouped discovered sessions, filters, imports, and new-session request paths.
- Latest sync note (2026-04-14): PR #461 added backend-independent `/memory` index redirect/sidebar coverage, PR #462 added `/memory/consolidation` queue/action coverage, PR #465 added the broader `/memory/scopes` browser suite, PR #466 added the broader `/memory/graph` browser suite, and PR #467 added the webhook delivery-history viewer with unit coverage over loading/populated/empty/error/expanded-row states.
- Latest E2E note (2026-04-14): PR #468 added backend-independent dynamic detail-route coverage for `/spaces/[id]` and `/tasks/[id]`, covering detail render, not-found paths, space thread/event/member actions, task empty state, run start payloads, and back navigation.
- Latest memory/tasks sync note (2026-04-14/15): PR #470-#474 shipped the memory synthesis page, push-device settings surface, fact feedback buttons, memory maintenance page, and task auto-decompose web action; PR #475 then added browser coverage for memory synthesis, webhook delivery-history, and push-device registration/revoke flows; PR #476 added the shared ConfirmDialog primitive plus memory dashboard loading/error/retry states; PR #478 added browser coverage for memory maintenance and the auto-decompose stale-preview guard; PR #479 removed stale agent-worker discovery type stubs after shared types became canonical; PR #480 fixed follow-up review findings from the previous roadmap sync (checkpoint SHA, Unified Memory UI wording, approval push plan registry row); PR #481 split the 2174-line web `lib/api.ts` into 11 domain-scoped modules plus a thin barrel, preserving the public `@/lib/api` import surface with zero behavior changes; PR #482 added the dry-run-first `scripts/db-provision-tier.ts` helper (refuses beta/prod, requires explicit admin URL and role password env in execute mode); PR #483 closed the Add/Delete UI deferred item on `/mesh-peers` by wiring an Add peer dialog and per-row Delete confirmation to the existing registry APIs with self-peer delete disabled and create/validation/delete Playwright coverage; PR #486 added `/memory/browser` provenance filters over the existing memory facts API; PR #487 added the auto-decompose apply-failure browser regression so a failed apply preserves the preview and retry posture; PR #488 added webhook delivery-list retry coverage; PRs #489-#493 synced the earlier roadmap checkpoint and Agent Run Quality summary state; PR #492 added backend-independent `/agents/[id]` detail/start coverage; PR #494 added backend-independent `/agents` list/create/start coverage; PR #495 added backend-independent `/agents/[id]/settings` coverage; PR #496 hardened dev-tier startup scripts without touching beta; PR #497 bounded routing API payloads; PR #499 added backend-independent `/machines` list/detail coverage; PR #498 shipped the `/agent-profiles` CRUD page on top of the existing backend; PR #505 added backend-independent `/agent-profiles` Playwright coverage for render, create validation/payload normalization, delete success/failure, and list-error retry flows; PR #506 added the agent-profile PATCH endpoint plus Edit dialog; PR #507 exposed the `/audit` trail page in the web sidebar; PR #508-#512 closed the Docker SARIF/Node24/Node20-compat CI loop; PR #513 added backend-independent `/audit` Playwright coverage; PR #511 synced the roadmap/plan checkpoint after the audit E2E merge; PR #515 replaced the retired `pnpm audit` endpoint path with the repo npm bulk-advisory audit script; PR #516 moved `/machines` Playwright coverage into the focused web e2e CI lane; PR #517 shipped the `/scheduler` jobs page; PR #518 moved `/agents` list coverage into the focused web e2e CI lane with a shared-package build preflight; PR #520 modernized Docker publish Grype SARIF output; PR #522 removed duplicate immutable cache-save annotations from the CI install lane; PR #523 moved the remaining Docker-action publish/audit/DAST surface onto Node24 majors without touching dev or beta workflows; PR #524 synced the post-Docker-action cleanup checkpoint; PR #525 expanded sidebar keyboard navigation with conflict-safe `g`-prefix Go To chords plus grouped Settings shortcut docs; PR #526/#527 synced roadmap and affected plan records after the PR #525 keyboard-accessibility landing; PR #529 added backend-independent `/sessions/[id]` route smoke coverage for default Session tab render plus Memory tab session-scoped fact lookup; PR #528 added backend-independent `/memory/dashboard` route smoke coverage for sidebar active state, KPI cards, recent activity, and the memory-decay card; and PR #530 synced the row-level roadmap ledger after those route-smoke landings, PR #536 removed the non-functional Edit button from Consolidation Board cards and narrowed the ConsolidationAction type to accept/skip/delete, PR #537 fixed agent-worker discovery of in-flight Codex sessions, PR #538 added aria-expanded/aria-label to the approvals session group expander, PR #540 wrapped the `/logs` and `/settings` page shells in `ErrorBoundary` so render-time errors no longer cascade to the root Next.js error page, PR #541 synced the roadmap and plan records after the ErrorBoundary landing, and PR #542 added an inline "Add managed credential" CTA to the `/settings` Accounts empty state plus `aria-describedby`/`aria-invalid`/`role="alert"` wiring on the credential input and its warning text.

- [x] Add explicit rate limiting to the sync pull/ack routes newly flagged by CodeQL on current `main` (`#560`, `js/missing-rate-limiting`, `packages/control-plane/src/api/routes/sync.ts`) *(PR #386)*
- [x] Add explicit rate limiting to the OAuth PKCE initiate/callback/refresh routes, covering memory-flow allocation, public redirect probing, and outbound token-refresh amplification *(PR #423)*
- [x] Add explicit rate limiting to account credential listing plus create/update/delete write paths, covering encrypted credential decrypt/store churn with `ACCOUNTS_RATE_LIMIT_*` overrides *(PR #427)*
- [x] Add explicit rate limiting to account verification tests, preventing repeated credential decrypt and outbound provider probes before `POST /api/settings/accounts/:id/test` enters provider-specific logic *(PR #429)*
- [x] Complete the rate-limit coverage audit (started in PR #423) by hardening the final five control-plane write surfaces — `mobile-push-devices`, `notification-preferences`, `memory-synthesis`, `memory-consolidation`, and `knowledge-maintenance` — each with a shared `readRateLimitEnv` 20 req/min default, per-scope env overrides, and one 429 assertion test per file *(PR #439; audit CLOSED)*
- [x] Clean up CI/security scan annotations: restore Biome 2.4-compatible security linting and validate Grype SARIF before upload so empty scanner reports do not create invalid SARIF annotations *(PR #440)*
- [x] Add schema-based input validation and length bounds to checkpoint, mobile push device, and knowledge maintenance write surfaces using Zod *(PR #443)*
- [x] Run the backend-independent webhooks Playwright slice in CI so web e2e regressions are gated before merge *(PR #445)*
- [x] Run backend-independent `/agents` list Playwright coverage in the focused web e2e CI lane, with `@agentctl/shared` built before Playwright starts for cold checkouts *(PR #518)*
- [x] Add mobile-push device validation negative tests, including oversized `deviceId` route handling through the route-level schema response *(PR #447)*
- [x] Tighten batch-2 input validation across `webhooks`, `permission-requests`, `approvals`, `handoffs`, `sync-conflicts`, and `memory-facts`, including enum checks, pagination bounds, and serialized source-size limits *(PR #448)*
- [x] Harden sync-peer registration and ping validation so manual mesh peer URLs reject unsafe protocols, local/metadata targets, bad role/status enums, and out-of-range intervals before DB writes or outbound fetches *(PR #452)*
- [x] Add backend-independent `/memory/import` Playwright coverage for JSONL preview/import completion and running-job cancellation *(PR #457)*
- [x] Add backend-independent `/settings` notification preferences Playwright coverage for empty-channel validation, save payloads, quiet hours rendering, and deletion *(PR #458)*
- [x] Add backend-independent `/discover` Playwright coverage for grouped discovered sessions, search/runtime/machine filtering, single-session import, and new-session creation payloads *(PR #459)*
- [x] Add backend-independent `/memory` index coverage for redirect-to-browser behavior, memory sidebar links, and stats badges *(PR #461)*
- [x] Add backend-independent `/memory/consolidation` coverage for pending item rendering, tab filtering, accept/skip/delete actions, refresh, and empty states *(PR #462)*
- [x] Add backend-independent `/memory/scopes` coverage for render/create/rename/promote/merge/delete/error/empty flows *(PR #465; superseded narrower duplicate PR #463)*
- [x] Add backend-independent `/memory/graph` coverage for toolbar, rows, query params, SVG nodes, detail panel, and empty states *(PR #466; superseded duplicate PR #464)*
- [x] Add webhook delivery-history UI over `GET /api/webhooks/:id/deliveries`, with unit coverage for loading, populated, empty, error, and expanded-row states *(PR #467)*
- [x] Add backend-independent `/spaces/[id]` and `/tasks/[id]` detail-route coverage for render/not-found/action flows *(PR #468)*
- [x] Close the manual-takeover GET route CodeQL `#579` false positive after confirming route-local `@fastify/rate-limit` executes before authorization *(PRs #410, #413; GitHub alert dismissed after fresh `main` analysis)*
- [x] Runs with 0 cost/tokens marked `empty` not `success` *(PR #157)*
- [x] Retry runs show `retryOf` (original run ID) + `retryIndex` (attempt number) *(PR #157)*
- [x] Main CI regressions around dispatch lifecycle + registry expectations fixed *(PR #167)*
- [x] Frontend double-click prevention on Start button *(PR #165)*
- [x] MCP servers not loading in CLI `-p` mode — pass `--mcp-config` explicitly *(direct commit c9ebe4e)*
- [x] Codex worktree sessions grouped as separate projects — normalize paths *(direct commit e0ca99f)*
- [x] ModelPromptsTab hardcoded Claude models — use runtime-aware options *(direct commit 2c198f3)*
- [x] McpServersTab/SkillsTab showed "not available" for agents without runtime — default to claude-code *(direct commit 7b1388c)*
- [x] Config preview project strategy now shows the project's actual `CLAUDE.md` / `AGENTS.md` content *(PR #218)*
- [x] Discover summary sanitization hardened against nested / malformed tag payloads *(PR #169)*
- [x] Explicit rate limiting added for git + memory routes uncovered by CodeQL/CI follow-up *(PRs #170-#171)*
- [x] Loop max-iteration bounds hardened to stop runaway configuration values *(PR #173)*
- [x] Audit temp-file handling hardened *(PR #174)*
- [x] Worker path-security surface hardened for file route helpers + CodeQL-recognized guards *(PR #175)*
- [x] Discovery path reads hardened to remove unsafe directory/config access patterns *(PR #176)*
- [x] Worktree manager path writes now go through guarded mkdir/chmod helpers *(PR #177)*
- [x] Agent start route now enforces an explicit Fastify framework limiter in addition to the custom guard *(PR #179)*
- [x] MCP discover config reads now go through shared safe file-read guards *(PR #180)*
- [x] Tighten `path-security.ts` wrappers for the remaining CodeQL path/file alerts *(PRs #182, #187)*
- [x] Harden the worker git status route path handling + framework rate limiting *(PR #183)*
- [x] Add explicit Fastify limiters to control-plane memory routes while preserving custom 429 behavior *(PR #184; later superseded by PR #207 and dismissed as a Fastify-model false positive after the latest green audit)*
- [x] Enforce the loop-controller fallback 10k iteration hard cap even without an explicit `maxIterations` limit *(PR #185; timer-specific follow-up resolved in PR #198)*
- [x] Skill discovery now uses shared safe async file-read guards for SKILL.md enumeration *(PR #187)*
- [x] CLI session cwd is sanitized through shared path guards before reaching `spawn()` *(PR #188)*
- [x] Agent-start route residual follow-up landed *(PR #190; later superseded by PR #208 and dismissed as a Fastify-model false positive after the latest green audit)*
- [x] Control-plane memory-route residual follow-up landed *(PR #191; later superseded by PR #207 and dismissed as a Fastify-model false positive after the latest green audit)*
- [x] Loop delay validation/clamping residual follow-up landed *(PR #192; timer duration follow-up resolved in PR #198)*
- [x] Shared local agent coordination board for worktree claims + handoffs *(PR #193)*
- [x] Custom MCP preview now preserves `source: 'custom'` for user-defined servers *(PR #199)*
- [x] Modeled Fastify rate-limit follow-up landed *(PR #200; final alert disposition was dismissal after the latest green audit because CodeQL still does not model Fastify rate-limit)*
- [x] Coordination-board worktree claims now write visible `.agentcoord.json` leases and resolve branch metadata from the claimed worktree *(PR #201)*
- [x] Agent-worker fd-write mock regressions fixed after `safeWriteFileSync` landed on `main` *(PR #206)*
- [x] Control-plane memory-route modeled Fastify config follow-up landed on `main` *(PR #207; later dismissed as a Fastify-model false positive after the latest green audit)*
- [x] Agent-worker start-route modeled Fastify config follow-up landed on `main` *(PR #208; later dismissed as a Fastify-model false positive after the latest green audit)*
- [x] Remaining `path-security.ts` file-write CodeQL findings resolved with content validation + secure create/truncate fallback *(PR #209)*
- [x] Remaining skipped Playwright coverage implemented and enabled across runtime selector / MCP discovery / critical flows *(PR #210)*
- [x] Control-plane DAST bootstrap now bundles drizzle migrations during build *(PR #222)*
- [x] DAST/bootstrap PostgreSQL images now use `pgvector/pgvector:pg16` across workflow + compose docs *(PR #223)*
- [x] ZAP API scan now reads its generated OpenAPI target from the mounted workspace path *(PR #226)*
- [x] Local DAST scan jobs now self-bootstrap the control-plane on the same runners that execute the scans; post-merge rerun `23131047045` succeeded *(PR #227)*
- [x] Stale old-Alpine Grype findings dismissed after PR #205 moved current runtime images to `bookworm-slim` *(direct dismissal, 2026-03-15)*

### 16.2 Dev Environment Infrastructure — P0

- [x] Dev-1 PM2 config (`infra/pm2/ecosystem.dev1.config.cjs`) *(direct commits)*
- [x] Runtime API proxy via Next.js middleware — same build for all tiers *(direct commit 879f27f)*
- [x] Dev-1 database setup + migrations
- [x] Dev-2 PM2 config (`infra/pm2/ecosystem.dev2.config.cjs`) *(PR #166)*
- [x] `DISPATCH_SIGNING_SECRET_KEY` env var in dev PM2 configs for stable keys *(PR #166)*
- [x] Dashboard stale buttons removed (View Agents, Runtime Sessions) *(direct commit ff9ab3e)*
- [x] Version display updated to v0.2.0 *(direct commit ff9ab3e)*

### 16.3 Frontend UI Polish — P0

Systematic design critique (2026-03-15) identified these issues. Root cause: features stacked without holistic design review, violating CLAUDE.md design principles (Cyber · Geeky · Futuristic).

> Follow-up PRs #212-#213 (2026-03-16) closed the remaining Discover summary-selection bug for Codex sessions and replaced misleading zero-duration session copy with clearer "Running now"/"instant" states.

**P1 — Dashboard visual hierarchy:**
- [x] Reduce 8 metric cards to 3 prominent + inline secondary stats *(PR #158)*
- [x] Remove "Native Import" and "Total Cost" as standalone cards *(PR #158)*
- [x] Fix "New Session" button text visibility *(PR #158)*
- [x] Fix "Memory Health: Could not load memory stats" — either fix or hide
- [x] Sanitize session summaries *(PR #158)* (raw XML tags like `<local-command-caveat>` showing)
- [x] Filter out "Untitled session *(PR #158)* / 0 msgs" from discovered sessions list

**P2 — Agent Detail page restructure:**
- [x] Separate metadata *(PR #159)* (name/status/model) from actions (start/settings/refresh) into distinct rows
- [x] Move prompt input from inline *(PR #159)* to a Start dialog (triggered by Start button)
- [x] Remove or label icon buttons *(PR #159)* (download/copy) below agent name — add tooltips or remove
- [x] Go button color: *(PR #159)* use `primary` token consistently, not raw blue

**P3 — Run History redesign:**
- [x] Merge Run History strip *(PR #159)* + Run Timeline chart into single timeline view (same data shown twice)
- [x] Replace raw red/green *(PR #159)* with muted semantic colors (`emerald-500/20`, `red-500/20`, `neutral-500/20` for empty)
- [x] Add hover tooltips *(PR #159)* (time, cost, duration, trigger, session link)
- [x] Style as terminal-native timeline *(PR #159)*, not generic recharts BarChart

**P4 — Agent Cards (list page):**
- [x] Remove prompt input + Go from card *(PR #160)* body — cards show info only
- [x] Card actions: "Start" button *(PR #160)* (opens dialog) + "Settings" link only
- [x] Truncate project path *(PR #160)* with tooltip instead of wrapping
- [x] Display: name, status badge *(PR #160)*, machine, project (truncated), last run, cost

**P5 — Button consistency:**
- [x] Establish button hierarchy *(PRs #158-#160)*: primary (filled), secondary (outline), ghost (text only)
- [x] Each page has exactly one primary action button *(PRs #158-160, #246)*
- [x] Normalize all pages to use shadcn Button variants *(PRs #158-160, #246)*

**Sessions page:**
- [x] Session IDs as titles *(PR #161)* (f1220b44-584f...) — should show agent name or summary instead
- [x] "Duration: 0s" copy clarified *(PR #213)* — active zero-duration sessions render as "Running now" and completed zero-duration sessions render as "instant"
- [x] Multiple empty sessions *(PR #161)* (Duration: 0s) from failed starts clutter the list — filter or mark as "empty"
- [x] Right panel "Select a session *(PR #242)* to view details" is wasted space — could show summary stats

**Machines page:**
- [x] Machine metrics: Online prominent, rest inline *(PR #246)*
- [x] "GPU" / "Docker" capability badges use proper badges with icons *(PR #165)*
- [x] Machine card green left border *(PR #242)* is inconsistent with other cards

**Settings page (Runtime Control Center):**
- [x] Best designed page — good sidebar nav, clear hierarchy, informative right panel ✅
- [x] "WHY THIS CHANGED" callout box is a nice touch ✅
- [x] Dependency latency cards with color coding (green/yellow/red) *(PR #246)*

**Memory page:**
- [x] "0 facts" empty state guides users to import data *(PR #165)*
- [x] Entity type checkboxes *(PR #242)* not styled as badges/chips — looks like a raw HTML form
- [x] Min Confidence slider *(PR #242)* has no visual feedback

**Spaces page:**
- [x] Empty state is clean and actionable ✅ ("Create your first space" button)
- [x] Header "Spaces" deduplicated *(PR #165)*

**Discover page:**
- [x] Codex session discovery now prefers the first meaningful user task over AGENTS/system-prompt preamble *(PR #212)*
- [x] Session IDs now show 12 characters for better context *(PR #229)*
- [x] "3 already imported" link is nice ✅

**Deployment page:**
- [x] Best specialized page — tier cards with green border + RUNNING badge work well ✅
- [x] Dev tier cards now show real MEM/UPTIME values from health payloads, with PM2 metrics taking precedence when present *(PR #230)*
- [x] Empty promotion history now renders a subtle designed placeholder instead of a lonely text-only line *(PR #235)*

**General:**
- [x] Version in sidebar: auto-update from package.json (version-bump.sh updates `Sidebar.tsx`) *(PR #166)*
- [x] "New Session" button text visibility fixed *(PR #158)*
- [x] Dashboard stale "View Agents" and "Runtime Sessions" buttons removed *(direct commit ff9ab3e)*
- [x] Discover summary extraction no longer prefers system prompt text for Codex sessions *(PR #212)*
- [x] Execution history now shows retry badges, clearer empty-status labels, and collapsible retry groups *(PR #231)*

### 16.4 Agent Settings Config Preview Sidebar — P1

> Design spec: [config-preview-sidebar-design](superpowers/specs/2026-03-15-config-preview-sidebar-design.md)
> Impl plan: [config-preview-sidebar](superpowers/plans/2026-03-15-config-preview-sidebar.md)

Persistent two-column layout for agent settings: tabs + forms on left, live config preview on right.

- [x] Shared `ConfigPreviewFile` *(PR #163)* / `ConfigPreviewResponse` types
- [x] Worker config-preview endpoint *(PR #163)* returns per-file response with Managed/Merged status
- [x] `ConfigFileCard` component *(PR #163)* with status badges + override highlighting
- [x] `ConfigPreviewPanel` component *(PR #163)* with skeleton/error states
- [x] Settings page two-column layout *(PR #163)* (`max-w-[1400px]`, sticky sidebar)
- [x] Remove old `ConfigPreview.tsx` *(PR #163)* from RuntimeConfigTab
- [x] Mobile fallback: *(PR #163)* collapsible bottom panel

### 16.5 Config Preview Data Accuracy — P0 ✅

> Delivered in PRs #194-#196.

- [x] Skills included in preview — CP proxy passes discovered skills to worker *(PR #194)*
- [x] CLAUDE.md omitted when agent has no instructions *(PR #194)*
- [x] `.claude.json` and `.mcp.json` split by scope (global vs project) *(PR #194)*
- [x] Runtime Config options have descriptive tooltips + runtime applicability labels *(PR #196)*
- [x] Deployment "Run Preflight" button clickable on initial load *(PR #195)*

### 16.6 Security Hardening (Codex batch) — P0

> Delivered via PRs #167-#220 by Codex security agents.

- [x] Path security wrappers hardened across agent-worker *(PRs #167-#177, #182, #187)*
- [x] Rate limiting on CP memory-decay + agents routes *(PRs #184)*
- [x] Loop iteration cap to prevent unbounded resource usage *(PR #185)*
- [x] Git route hardening *(PR #183)*
- [x] CLI session cwd sanitization *(PR #188)*
- [x] Discovery path security *(PR #176)*
- [x] Worktree manager path writes hardened *(PR #177)*
- [x] Safe file write hardening *(PR #204)*
- [x] PM2 package dropped, images moved off alpine *(PR #205)*
- [x] Loop timer CodeQL alert resolved *(PR #198)*
- [x] Instructions-strategy file reads hardened through shared path-security wrappers *(PR #217)*
- [x] Config preview instruction reads hardened through shared path-security wrappers *(PR #219)*
- [x] Agent settings tests updated for managed-runtime fallback + instructions-strategy saves *(PR #220)*

## 17. Ongoing Quality & Testing

### 17.1 Resolved CodeQL Alert Cleanup — P0 ✅

- [x] `js/http-to-file-access` *(PR #209)* in `path-security.ts:133` — HTTP-sourced data written to files
- [x] `js/insecure-temporary-file` *(PR #209)* in `path-security.ts:133` — insecure temp file creation
- [x] `js/path-injection` *(PR #219)* in `config-preview.ts:212` — preview route project-instruction reads now use shared path-security wrappers

### 17.2 E2E Test Coverage — P1

- [x] Enable 17 skipped *(PR #210)* E2E tests across mcp-skill-discovery, runtime-selector, critical-flows, smoke specs
- [x] Write real Playwright *(PR #210)* implementations for stub tests (currently just comments)

### 17.3 CLAUDE.md Management Strategy — P0

> Delivered in PRs #215 and #218, with targeted web coverage in PR #220.

Agent settings should allow users to control how CLAUDE.md is handled at session start:

- [x] Add "Instructions Strategy" selector to Model & Prompts tab with 3 options *(PR #215)*:
  - **"Use project's CLAUDE.md"** (default) — AgentCTL does NOT write CLAUDE.md, Claude CLI reads the project's existing file
  - **"Managed by AgentCTL"** — AgentCTL writes a managed CLAUDE.md (current behavior, but only when user explicitly opts in)
  - **"Merge"** — AgentCTL reads the project's CLAUDE.md, appends the agent's System Prompt + custom instructions, writes the merged result
- [x] Store strategy in `AgentConfig.instructionsStrategy: 'project' | 'managed' | 'merge'` *(PR #215)* with `'project'` as the default
- [x] Config renderer: implement all 3 strategies in `ClaudeConfigRenderer` and `CodexConfigRenderer` *(PR #215)*
- [x] Config preview: show the effective CLAUDE.md based on selected strategy (project content, managed template, or merged) *(PR #215)*
- [x] Project strategy preview reads the actual project `CLAUDE.md` / `AGENTS.md` content instead of a managed placeholder *(PR #218)*
- [x] Default new agents to `'project'` — never override CLAUDE.md unless user chooses to *(PR #215)*
- [x] Web regression coverage for instructions-strategy saves + fallback behavior *(PR #220)*

### 17.4 Agent Permission Approval System — P0

Critical gap: when agent permission mode is NOT bypass, CLI outputs `permission_request` events but AgentCTL has no way for users to approve/deny. Agent hangs until timeout → killed.

**Architecture**: Use existing notification center (NotificationBell) + WebSocket infrastructure.

- [x] Worker captures `permission_request` *(PRs #238-240)* events from CLI stdout stream
- [x] Worker forwards permission requests *(PRs #238-240)* via SSE to control plane
- [x] CP stores pending approvals *(PRs #238-240)* in DB + pushes to frontend via WebSocket
- [x] Notification center shows pending *(PRs #238-240)* approval with: agent name, tool name, command preview, approve/deny buttons; global NotificationBell popover e2e coverage covers allow-once, allow-for-session, deny, and empty states *(PR #418)*
- [x] User clicks Approve/Deny *(PRs #238-240)* → frontend sends decision via WebSocket → CP → Worker
- [x] Worker writes approval via canUseTool hook *(PRs #238-240)* to CLI stdin (stream-json input)
- [x] Timeout handling: auto-deny *(PRs #238-240)* after configurable timeout (default 5 min)
- [x] Mobile (iOS): pending approvals inbox screen + API wrapper + polling *(PR #273)*
- [x] Fix: `bypassPermissions` now correctly uses `--dangerously-skip-permissions` *(direct commit 7c66ec2)*

> Design spec: [permission-approval-system-design v2](superpowers/specs/2026-03-16-permission-approval-system-design.md)
> Impl plan: [permission-approval-system](superpowers/plans/2026-03-18-permission-approval-system.md)
> Status: ✅ Core approval workflow delivered in PRs #238-240. Mobile approval inbox/operator surface is now tracked in §21.1; remaining follow-up is true iOS push notifications.

### 17.5 Agent Run State Machine Visibility — P1

Agent run lifecycle has hidden intermediate states users can't see:

- [x] Show dispatch states in UI *(PR #241)*: queued → dispatching → worker_contacted → cli_spawning → mcp_loading → running → completed
- [x] Retry runs visually grouped under original run (collapsible) *(PR #231)*
- [x] Empty runs shown with gray badge + clearer empty-status labeling *(PR #231)*
- [x] Run timeline shows state transitions *(PR #241)* with timestamps

## 18. UX Enhancements

### 18.1 Agent Templates — P1

- [x] Prebuilt agent configurations *(PR #253)* for common use cases (code reviewer, bug fixer, test writer, docs)
- [x] Template selection step *(PR #253)* in AgentFormDialog before manual config
- [x] Templates pre-fill form *(PR #253)* fields; "Start from scratch" to skip

### 18.2 Command Palette Enhancement — P1

- [x] Agent actions in search *(PR #254)* (Start, Settings, View for each agent)
- [x] Recent sessions in search *(PR #254)* results
- [x] Fuzzy search across *(PR #254)* agents, sessions, pages
- [x] Grouped results by *(PR #254)* category

### 18.3 Onboarding Empty States — P1

- [x] Dashboard welcome card *(PR #255)* for new users
- [x] Agents page shows templates *(PR #255)* when empty
- [x] Sessions/Memory pages guide *(PR #255)* users to first actions

### 18.4 Frontend Infrastructure — Delivered

- [x] Tasks page for task graph DAGs *(PR #247)*
- [x] Dark theme animations + hover effects *(PR #249)*
- [x] Enhanced keyboard shortcuts *(PR #250; slash-search focus regression coverage in PR #446; Sessions `?` help overlay in PR #449; shared Sidebar/Sessions `?` event ownership centralized in PR #450; sidebar `1-9,0` plus `g`-prefix Go To chords and Settings shortcut grouping in PR #525)*
- [x] Error boundaries for all pages *(PR #251)*
- [x] Machine metrics + button consistency + dependency colors *(PR #246)*

## 19. Quality & Depth

### 19.1 Permission System Test Coverage — Delivered

- [x] Comprehensive tests for `permission-requests.ts` CP route — 14 tests covering POST, GET, PATCH, validation *(direct commit dc0eb1c)*
- [x] Fix unhandled rejection from permission expiry interval in test suites *(direct commit e6d6607)*

### 19.2 WebSocket Permission Event Wiring — Delivered

- [x] Wire `permission_request_created` / `permission_request_resolved` WS events to `queryClient.invalidateQueries` in Sidebar.tsx *(direct commit 32908bb)*
- [x] Eliminate 5-second polling lag for permission notifications *(direct commit 32908bb)*

### 19.3 ToolUseBlock Session Display Component — Delivered

- [x] Create `ToolUseBlock.tsx` with tool icon mapping, collapsible sections, error styling *(direct commit c25058a)*
- [x] Integrate into SessionContent.tsx switch statement for `tool_use`/`tool_result` message types *(direct commit c25058a)*
- [x] Completes Task 4 of the session display plan

## 20. Coverage & Feature Depth (Batch)

> Plan: [plans/2026-03-19-coverage-feature-depth-batch-plan.md](plans/2026-03-19-coverage-feature-depth-batch-plan.md)

### 20.1 CP Route Test Coverage — Delivered

- [x] `spaces.ts` tests — 76 tests covering full endpoint coverage *(PR #259)*
- [x] `task-graphs.ts` tests — 35 tests covering all endpoints *(PR #256)*
- [x] `memory-reports.ts` tests *(PR #261)*
- [x] `notification-preferences.ts` tests *(PR #258)*
- [x] `agent-profiles.ts` tests — 33 tests covering CRUD + validation *(PR #257)*

### 20.2 Tasks Detail Page — Delivered

- [x] Create `/tasks/[id]` route with task graph detail view *(PR #266)*
- [x] Show graph nodes, dependencies, run history *(PR #266)*
- [x] Wire task-runs.ts API for triggering runs from UI *(PR #266)*

### 20.3 API Documentation — Delivered

- [x] Generate `docs/API.md` from CP route definitions *(PR #265)*
- [x] Cover all REST endpoints with request/response examples *(PR #265)*

### 20.4 Memory Dashboard — Delivered

- [x] Replace `MemoryPlaceholderView` with real dashboard *(PR #267)*
- [x] Show memory stats: fact count, entity distribution, decay health, recent activity *(PR #267)*

### 20.5 E2E Test Coverage — Delivered

- [x] Playwright specs for /tasks, /spaces, /deployment pages *(PR #268)*
- [x] CI executes the backend-independent `/webhooks` Playwright slice so web e2e coverage is no longer only a local/manual check *(PR #445)*
- [x] Add backend-independent Playwright coverage for the embedded `/logs` Security Findings tab, including summary cards, latest finding badges/location, empty state, and API error handling *(PR #454)*
- [x] Focused `/memory/browser` Playwright coverage for facts render, search/filter, detail edit/delete, and bulk delete flows *(PR #455)*
- [x] Backend-independent `/memory/import` Playwright coverage for source selection, JSONL field mapping, completed import summary, and running-job cancellation *(PR #457)*
- [x] Backend-independent `/settings` notification preference coverage for add/remove flow, empty-channel validation, quiet hours, and route interception so the spec no longer depends on a live control plane *(PR #458)*
- [x] Backend-independent `/discover` Playwright coverage for grouped discovery results, search/runtime/machine filters, import, and new-session affordances *(PR #459)*
- [x] Backend-independent `/memory` index coverage for redirect-to-browser behavior, memory sidebar links, and stats badge behavior *(PR #461)*
- [x] Backend-independent `/memory/consolidation` coverage for queue rendering, severity/category flows, actions, refresh, and empty states *(PR #462)*
- [x] Backend-independent `/memory/scopes` coverage for render/create/rename/promote/merge/delete/error/empty flows *(PR #465; superseded narrower duplicate PR #463)*
- [x] Backend-independent `/memory/graph` coverage for toolbar, table, filter query params, SVG nodes, detail panel, and empty states *(PR #466; superseded duplicate PR #464)*
- [x] Backend-independent `/spaces/[id]` and `/tasks/[id]` detail-route coverage for page render, 404 paths, space thread/event/member actions, task run start, and back navigation *(PR #468)*
- [x] Backend-independent `/memory/maintenance` and `/tasks/[id]` auto-decompose Playwright coverage, including scope-aware maintenance POST bodies, clean-memory copy, error retry, two-step preview/apply dialog flow, the stale-preview guard, and auto-decompose apply-failure retry posture *(PRs #478, #487)*
- [x] Backend-independent `/agents/[id]` detail-route coverage for agent metadata/config/cost/session/memory/run-history render plus `POST /api/agents/:id/start` prompt wiring *(PR #492; see [plans/2026-04-14-agent-detail-e2e-plan.md](plans/2026-04-14-agent-detail-e2e-plan.md))*
- [x] Backend-independent `/agents` index coverage for list render, machine-name mapping, search/status filters, `POST /api/agents/:id/start` prompt wiring, and create-from-scratch `POST /api/agents` payload capture; the spec also runs in the web E2E CI lane after the shared-package build preflight *(PRs #494, #518; see [plans/2026-04-14-agents-list-e2e-plan.md](plans/2026-04-14-agents-list-e2e-plan.md))*
- [x] Backend-independent `/agents/[id]/settings` coverage for the settings shell/config preview plus General, Model & Prompts, and Runtime Config save payloads *(PR #495; see [plans/2026-04-14-agent-settings-e2e-plan.md](plans/2026-04-14-agent-settings-e2e-plan.md))*
- [x] Backend-independent `/machines` list/detail coverage for fleet list render, stale/offline states, search/status filters, detail capability/runtime cards, memory stats, agent/session tables, and worker-node hostname/Tailscale-IP matching; the spec also runs in the web E2E CI lane *(PRs #499, #516; see [plans/2026-04-14-machines-e2e-plan.md](plans/2026-04-14-machines-e2e-plan.md))*
- [x] `/agent-profiles` CRUD page over the existing backend, including sidebar entry, list/error/empty states, create dialog payload wiring, and delete confirmation coverage *(PR #498; see [plans/2026-04-14-agent-profiles-web-plan.md](plans/2026-04-14-agent-profiles-web-plan.md))*
- [x] Backend-independent `/agent-profiles` Playwright coverage for table render, empty/create validation, sanitized create payloads, delete success and API-error handling, plus list-error retry recovery; the spec also runs in the web E2E CI lane *(PR #505; see [plans/2026-04-14-agent-profiles-web-plan.md](plans/2026-04-14-agent-profiles-web-plan.md))*
- [x] `/agent-profiles` edit workflow over the new PATCH route, including dialog submit/cancel behavior and backend route/store coverage *(PR #506; see [plans/2026-04-14-agent-profiles-web-plan.md](plans/2026-04-14-agent-profiles-web-plan.md))*
- [x] `/audit` page split from the Logs tab, including sidebar routing, summary cards, audit rows, filters, pagination controls, empty/error posture, and focused unit coverage over mocked audit queries *(PR #507; see [plans/2026-04-14-audit-trail-page-plan.md](plans/2026-04-14-audit-trail-page-plan.md))*
- [x] Backend-independent `/audit` Playwright coverage for summary cards, sorted breakdowns, row expansion, trimmed filter query params, and empty state; the spec runs in the web E2E CI lane *(PR #513; see [plans/2026-04-14-audit-trail-page-plan.md](plans/2026-04-14-audit-trail-page-plan.md))*
- [x] `/scheduler` jobs page over the existing scheduler API, including sidebar entry, not-configured handling, create/delete interactions, and focused unit coverage *(PR #517; see [plans/2026-04-15-scheduler-jobs-page-plan.md](plans/2026-04-15-scheduler-jobs-page-plan.md))*
- [x] Backend-independent `/sessions/[id]` route smoke coverage for the ended-session detail shell, message render, and Memory tab session-scoped fact query *(PR #529)*
- [x] Backend-independent `/memory/dashboard` route smoke coverage for MemorySidebar active state, dashboard KPI cards, recent activity, and MemoryDecayCard composition *(PR #528)*

### 20.6 React Performance — Delivered

- [x] React.memo on SessionContent, InlineMessage, ToolUseBlock, ThinkingBlock, SubagentBlock, TodoBlock, ProgressIndicator *(PR #269)*

### 20.7 Light Mode Semantic Tokens — Delivered

- [x] Replace hardcoded dark colors in 6 components with semantic tokens *(direct commit 44c4ccc)*

### 20.8 Notification Preferences UI — Delivered

- [x] Frontend settings panel for notification-preferences API *(PR #272)*
- [x] Channels, quiet hours, priority threshold configuration *(PR #272)*
- [x] **Registered Push Devices** section in Settings → Notifications, listing iOS push registrations and exposing revoke via confirm dialog over `GET /api/mobile-push-devices` + `POST /api/mobile-push-devices/:deviceId/deactivate` *(PR #471; relates to [plans/2026-03-19-approval-push-notifications-impl-plan.md](plans/2026-03-19-approval-push-notifications-impl-plan.md))*
- [x] Backend-independent browser coverage for registering, listing, and revoking push devices through the Settings notification surface *(PR #475)*

### 20.9 Webhooks Management Page — Delivered

- [x] Standalone `/webhooks` web page with sidebar entry, dense provider/URL/events/state/created/updated/actions table, and `#3b82f6` accent over the existing `/api/webhooks` backend *(PR #438)*
- [x] Add / Edit dialog (URL, provider dropdown, masked secret, event-type checkbox grid, active toggle) plus per-row Test + Delete-with-confirm actions, wired through `listWebhooks/createWebhook/updateWebhook/deleteWebhook/testWebhook` and React Query hooks *(PR #438)*
- [x] 15 Vitest + RTL tests covering table render, dialog form state, validation, and mutation flows *(PR #438)*
- [x] Playwright coverage for `/webhooks` row rendering, Add Webhook request payload/refresh, empty-URL validation, delete confirmation, and test success/failure toasts *(PR #444)*
- [x] Webhook edit/PATCH Playwright coverage, stricter unexpected `/api/**` mock handling, and CI execution for the backend-independent webhooks browser slice *(PR #445)*
- [x] Delivery history modal over `GET /api/webhooks/:id/deliveries`, with a reusable `WebhookDeliveriesPanel` and unit coverage for loading, populated, empty, error, and expanded-row states *(PR #467)*
- [x] Browser coverage for delivery-history loading, populated, empty/error, and expanded-row paths from the `/webhooks` surface *(PR #475)*
- [x] Browser coverage for delivery-list GET failure surfacing and manual **Retry** recovery after React Query's automatic retry budget is exhausted *(PR #488)*

## 21. Mobile Approval Follow-up

> Design: [plans/2026-03-19-mobile-approval-center-design.md](plans/2026-03-19-mobile-approval-center-design.md)
> Plan: [plans/2026-03-19-mobile-approval-center-impl-plan.md](plans/2026-03-19-mobile-approval-center-impl-plan.md)
>
> Status note: the control plane and web approval flow are shipped. `21.1` adds the mobile approval inbox/operator surface, and `21.2` is now delivered on `main` via Expo token bootstrap, the mobile push-device registry, control-plane Expo dispatch, and approval tap routing into the inbox.

### 21.1 Mobile Approval Inbox — Delivered

- [x] Mobile API wrapper for `permission-requests` list + resolve *(PR #273)*
- [x] Pending approvals screen with approve/deny actions *(PR #273)*
- [x] Runtime tab badge includes pending approvals *(PR #273)*
- [x] Dedicated mobile `Approvals` tab for the inbox *(PR #273)*
- [x] Mobile regression coverage for polling + resolve flow *(PR #273)*

### 21.2 iOS Push Notifications for Pending Approvals — Delivered

> Design: [plans/2026-03-19-approval-push-notifications-design.md](plans/2026-03-19-approval-push-notifications-design.md)
> Plan: [plans/2026-03-19-approval-push-notifications-impl-plan.md](plans/2026-03-19-approval-push-notifications-impl-plan.md)
>
> Status note: PR #291 landed the shared `approval.pending` contracts plus the control-plane mobile device registry, PR #290 landed Expo token bootstrap plus notification tap routing into `Approvals`, and PR #295 completed the remaining control-plane Expo push dispatch on permission-request create.

- [x] Expo/iOS device token registration from mobile app *(PR #290)*
- [x] Control-plane device registry for mobile push tokens *(PR #291)*
- [x] Expo push dispatch path for `approval.pending` *(PR #295)*
- [x] Notification tap path lands user on the approval inbox *(PR #290)*
- [x] Initial single-operator routing model documented until durable user ownership lands *(PR #285 + 21.2 docs)*
- [x] Device registry validation negative coverage for invalid methods, malformed JSON, invalid tokens/platforms, oversized route params, deactivate error paths, and Fastify `routerOptions.maxParamLength = 256` behavior *(PR #447)*
- [x] Operator-facing **Registered Push Devices** UI in Settings → Notifications for listing/revoking registrations over the existing `/api/mobile-push-devices` endpoints *(PR #471; tracked in §20.8)*
- [x] Settings push-device registration/revoke browser coverage over the shipped registry endpoints *(PR #475)*

## 22. Remaining Route Tests + Frontend Integration

### 22.1 CP Route Test Coverage (Final Batch) — Delivered

- [x] `context-bridge.ts` tests — 52 tests *(PR #277)*
- [x] `approvals.ts` tests *(PR #275)*
- [x] `task-runs.ts` tests *(PR #275)*
- [x] `memory-consolidation.ts` tests *(PR #274)*
- [x] `knowledge-maintenance.ts` tests *(PR #274)*

### 22.2 Frontend API Integration — Delivered

- [x] Add API client methods for approvals, context-bridge, run-summary endpoints *(PR #276)*
- [x] Wire query hooks for new API methods *(PR #276)*

## 23. UX & Feature Polish (Batch)

### 23.1 run-reaper Test Coverage — Delivered

- [x] Last untested CP route now covered *(PR #286)*

### 23.2 Knowledge Graph Visualization — Delivered

- [x] Replace GraphPlaceholder with SVG-based graph visualization *(PR #286)*

### 23.3 Approvals Page — Delivered

- [x] Dedicated /approvals page with thread-scoped gate loading *(PR #284)*
- [x] Approve/deny actions wired to API *(PR #284)*
- [x] Sidebar nav link added *(PR #284)*

### 23.4 Dashboard Enhancement — Delivered

- [x] System health summary widget *(PR #283)*
- [x] Quick action buttons (New Session, View Logs, Discover) *(PR #283)*
- [x] Service health cards *(PR #283)*

### 23.5 Agent Detail Page Polish — Delivered

- [x] Better loading skeletons *(PR #282)*
- [x] Helpful empty states with actions *(PR #282)*
- [x] Prominent status indicators *(PR #282)*

### 23.6 Mobile Approvals Hardening — Delivered

- [x] Harden pending approvals polling *(PR #281)*
- [x] Approval push notifications plan *(PR #285)*

### 23.7 Knowledge Maintenance Path Hardening — Delivered

- [x] Canonicalize and validate `projectRoot` against the current working tree *(PR #287)*
- [x] Reject symlink-based project-root escapes and ignore body `projectRoot` overrides *(PR #287)*

## 24. Post-21.2 Stability Follow-through

> Plan: [plans/2026-03-20-post-21-2-e2e-cd-hardening-plan.md](plans/2026-03-20-post-21-2-e2e-cd-hardening-plan.md)
>
> Status note: roadmap 21.2 is now delivered, and PRs #299, #297, #298, and #301 completed the full post-21.2 browser-coverage plus CD-hardening batch on `main`.

### 24.1 Approvals Page Playwright Coverage

- [x] Add a targeted Playwright flow for `/approvals` *(PR #299)*
- [x] Add targeted Playwright coverage for the global NotificationBell pending-approvals popover *(PR #418)*
- [x] Cover thread selection, pending gate rendering, and approve/deny action feedback *(PR #299)*

### 24.2 Deployment Page / Promote Gate Playwright Coverage

- [x] Add a targeted Playwright flow for `/deployment` *(PR #297)*
- [x] Cover tier-card rendering, source-tier selection, and promote preflight feedback *(PR #297)*

### 24.3 Dev/Beta Promotion Guardrails + Docs Consistency

- [x] Remove the unsafe/ambiguous default source-tier behavior from `promote-beta.yml` *(PR #298)*
- [x] Sync `docs/USER-SETUP-CD-TIERS.md` with the actual `scripts/env-promote.sh --from <tier>` CLI *(PR #298)*
- [x] Re-verify that agents work only in `dev-1` / `dev-2`, and that beta promotion stays an explicit/manual operator action until self-hosted GitHub execution is ready *(PR #298)*

### 24.4 Production Deploy Guardrails for Missing Secrets

- [x] Skip release-triggered `deploy-prod.yml` runs cleanly until the required production secrets exist *(PR #301)*
- [x] Fail manual `workflow_dispatch` production deploys early with actionable missing-secret output *(PR #301)*
- [x] Prevent automatic rollback from attempting SSH before remote deployment state has been recorded *(PR #301)*

## 25. Web Hardening Follow-through

> Plan: [plans/2026-03-20-web-hardening-follow-through-plan.md](plans/2026-03-20-web-hardening-follow-through-plan.md)
>
> Status note: section 25 is now delivered on `main` via PRs #305, #304, and #306. The remaining machines / terminal e2e work now lives in the dedicated follow-up plan at [plans/2026-03-21-machine-terminal-e2e-follow-up-plan.md](plans/2026-03-21-machine-terminal-e2e-follow-up-plan.md) so it can stay separate from both the lower-flake web regressions in this batch and the §27.3 live terminal-attach work.

### 25.1 Runtime Sessions Playwright Coverage

- [x] Add a targeted Playwright flow for the runtime-session surface on `/sessions?type=runtime` *(PR #306)*
- [x] Cover runtime list/detail rendering and one safe control path without depending on terminal/WebSocket streaming *(PR #306)*

### 25.2 Settings Control Center Playwright Coverage

- [x] Add targeted Playwright coverage for `/settings` *(PR #304)*
- [x] Cover the runtime control center shell, section navigation, and one representative settings interaction without broad settings-page churn *(PR #304)*

### 25.3 Web/Shared Permission-Request Contract Cleanup

- [x] Remove the remaining web-local permission-request type drift in favor of the shared contract *(PR #305)*
- [x] Keep the cleanup scoped to web/shared API-query-card boundaries without reopening the broader approvals architecture *(PR #305)*

## 26. Agent Worker Container Security Remediation — Delivered

> Plans: [plans/2026-03-20-agent-worker-container-security-remediation-plan.md](plans/2026-03-20-agent-worker-container-security-remediation-plan.md) · [plans/2026-03-20-worker-runtime-surface-reduction-plan.md](plans/2026-03-20-worker-runtime-surface-reduction-plan.md)
>
> Status note: this batch is now closed on `main`. PR #307 landed the worker-only runtime-image refresh plus the `python3-setuptools` node-gyp compatibility fix, PR #314 refreshed the `git` runtime-library closure, PR #322 hardened runtime `git` capability handling without removing `git` from the standard worker image, and PR #326 aligned the `security-audit` Trivy worker policy with the `build-images` upload path. As of 2026-03-20, GitHub's open code-scanning alert feed returns `0` items, and both worker Trivy categories (`trivy-agent-worker` and `trivy-agentctl-agent-worker`) report `0` results on recent `main` commits `cdd63b8`, `3e38d87`, and `4c82efb`.

### 26.1 Agent Worker Runtime Image Refresh — Delivered

- [x] Refresh the worker image to `node:22.22.1-trixie-slim` and restore `node-gyp` compatibility with `python3-setuptools` in the build/deps stages *(PR #307)*
- [x] Refresh the `git` runtime library closure with a temporary `forky` pin for `libcurl3t64-gnutls`, `libexpat1`, `libnghttp2-14`, `libnghttp3-9`, `libngtcp2-16`, `libtasn1-6`, and `zlib1g` *(PR #314)*
- [x] Keep the fix scoped to the worker container unless validation data shows the control-plane image must move in lockstep *(PRs #307, #314)*
- [x] Align the `security-audit` worker Trivy policy with the `build-images` worker upload semantics so the duplicate worker categories converge on the same scan outcome *(PR #326)*
- [x] Re-check the latest `main` backlog before closing the section; as of 2026-03-20 GitHub reports `0` open code-scanning alerts and both worker Trivy categories upload `0`-result analyses on recent `main` commits (`cdd63b8`, `3e38d87`, `4c82efb`)

### 26.2 Worker Git Capability Hardening — Delivered

- [x] Inventory the worker flows that still shell out to `git` at runtime (`worktree-manager`, git-status route, workdir safety, handoff workspace inspection) *(audit + PR #322 follow-up)*
- [x] Harden those flows so a missing runtime `git` binary degrades honestly instead of producing accidental 500s or hidden crashes, and block unavailable workdirs explicitly instead of misclassifying them as missing-`git` cases *(PR #322)*
- [x] Decide whether dropping steady-state `git` from the standard worker image is still warranted; the post-#326 scans converged without requiring image-level `git` removal, so `git` stays installed unless a future worker-specific backlog reopens the question

## 27. Session Lifecycle — Force Kill + Stall Detection

> Status note: the base force-kill and stall-detection slices are delivered, and
> direct `main` commit `58d8b840` tightened the related stale-session reaper so
> managed sessions with a `claudeSessionId` are only exempt while heartbeats are
> still fresh instead of remaining active forever after the CLI disappears.

### 27.1 Force Kill — Delivered

- [x] Worker: `POST /api/sessions/:id/kill` — SIGTERM then SIGKILL after 5s *(PR #310)*
- [x] CP: proxy kill route to worker and mark the session as ended on worker success *(PR #311)*
- [x] CP: failed worker kill attempts now preserve the existing session state instead of force-ending the run *(PR #313)*
- [x] Web: "Force Kill" button on session detail + sessions list (active/stalled only) *(PR #312)*

### 27.2 Stall Detection — Delivered

- [x] Worker heartbeat reports `stalled` when session has no output for 15+ minutes *(PR #310)*
- [x] CP accepts `stalled` as valid session status *(PR #311)*
- [x] Web: yellow warning banner on stalled sessions *(PR #312)*

## 28. UX Polish — Batch 2

### 28.1 Session Metrics Card — Delivered

- [x] Token usage (input/output), cost, model in compact grid on session detail *(PR #320)*

### 28.2 Sidebar Version Link — Delivered

- [x] Clickable version → GitHub releases page *(PR #317)*

### 28.3 Command Palette Session Search — Delivered

- [x] Search sessions by prompt content in command palette *(PR #319)*

### 28.4 Consistent Page Layout — Delivered

- [x] PageContainer component with default/wide/full width modes *(PR #318)*
- [x] Applied to approvals, tasks pages *(PR #318)*

### 27.3 Terminal Takeover — Delivered

> Status note: PRs #340, #341, #342, #343, #344, and #350 now ship the full
> live managed-session terminal attach feature on `main` across the control
> plane, worker, CLI, and web runtime session surfaces, including focused
> runtime-session attach Playwright coverage. Direct `main` commit `73145841`
> then restored the explicit empty JSON takeover/release POST bodies expected by
> the existing web client route helpers. The linked gap plan is now delivered as
> the implementation record for this slice, not an active follow-through
> tracker.

- [x] Machine-level PTY terminal APIs + xterm.js UI are on `main`
- [x] Runtime session panel already exposes Claude Remote Control manual takeover
- [x] Worker: keep running Claude managed sessions attachable via live PTY *(PR #341)*
- [x] Control plane: proxy runtime-session terminal attach/takeover by managed session id *(PR #340)*
- [x] Web: `Attach Terminal` surfaces on session detail and runtime session panel *(PRs #343, #344)*
- [x] CLI: `agentctl takeover <session-id>` for managed session terminals *(PR #342)*
- [x] User can type directly into the running CLI to unblock interactive waits *(PRs #341, #343, #344)*
- [x] Focused runtime-session attach/release e2e coverage landed in `runtime-sessions.spec.ts` *(PR #350)*

## 29. Machines / Terminal E2E Follow-up — Delivered

> Plan: [plans/2026-03-21-machine-terminal-e2e-follow-up-plan.md](plans/2026-03-21-machine-terminal-e2e-follow-up-plan.md)
>
> Status note: this follow-up was intentionally scoped to the existing machine terminal page regression surface only, and PR #346 delivered it on `main` with a dedicated Playwright spec for the existing page shell/connect/error paths. It stays separate from §27.3 live attach to the running managed Claude CLI, and no extra shared attach/transport hardening was needed to ship the machine-terminal coverage.

- [x] Add a dedicated Playwright path for the machine terminal page without pulling live managed-session attach into the same slice *(PR #346)*
- [x] Cover the terminal page shell, one stable terminal-connect/render path, and a minimal error-handling path for the existing machine terminal UI *(PR #346)*
- [x] Keep shared attach/transport changes out of this slice; the machine terminal page shipped without additional page-level hardening *(PR #346)*

## 30. Running Agent Observability

### 30.1 Real-time Cost + Token Reporting — Delivered

> Status note: direct `main` commit `d1b7a77` completed the remaining
> observability slice by forwarding periodic cost/token deltas through the
> control plane and surfacing token counts alongside cost in run history while
> runs are still active. Direct `main` commit `bf899eb0` then refreshed
> managed-session heartbeats during those live progress updates so the reaper
> does not kill active sessions, and PR #361 added focused control-plane
> regression coverage for that follow-through on `main`.

- [x] SDK runner reports cost/token increments during run via CP callback
- [x] Run history shows live-updating cost and token counts for running agents
- [x] Token display (input/output) added to run history rows alongside cost

### 30.2 Early Session ID Linking — Delivered

> Status note: direct `main` commit `7a2ae06` delivered the early session-link
> plumbing, and `e5f07913` then hardened the control-plane follow-through by
> auto-creating the backing `rc_session` row when the SDK runner reports a
> session ID during a live progress update.

- [x] SDK runner `onSessionIdResolved` callback fires immediately when session_id appears
- [x] Agent instance reports sessionId to CP within seconds of run starting
- [x] Running runs show "Live" indicator + Session link appears quickly

---

## 31. Runtime Config Visibility

> Persist dispatch config for every agent run and surface it on the session detail page for debugging and audit.

**Motivation:** When a session reports MCP tools aren't loaded or behaves unexpectedly, there's no way to see what config was actually dispatched. The config (MCP servers, permissions, model, tools) is assembled in task-worker.ts, sent to the worker, and never persisted.

**Spec:** `docs/superpowers/specs/2026-03-28-runtime-config-visibility-design.md`
**Plan:** `docs/superpowers/plans/2026-03-28-runtime-config-visibility.md`

### 31.1 Database + Shared Types — Delivered

- [x] Add `dispatch_config` JSONB column to `agent_runs` table (migration `0004_dispatch_config.sql`)
- [x] Add `DispatchConfigSnapshot` and `McpServerConfigRedacted` types in `packages/shared`
- [x] Add `redactMcpServers()` utility with MCP env/command/arg redaction (9 tests)
- [x] Add `updateRunDispatchConfig()`, `getRunDispatchConfig()`, `getLatestRunForSession()`, `countRunsForSession()` to DbRegistry
- [x] Exclude `dispatch_config` from all run list queries (`runColumnsSlim` getter)

### 31.2 Backend Persistence + API — Delivered

- [x] Persist redacted config snapshot in `task-worker.ts` after dispatch payload assembly
- [x] Add `GET /api/sessions/:sessionId/dispatch-config` endpoint returning `{ runId, runCount, config }`
- [x] 404 for nonexistent session, `{ runId: null, runCount: 0, config: null }` for sessions without runs
- [x] Direct route coverage for missing-session, no-run, and latest-config responses *(PR #391)*

### 31.3 Frontend — Config Tab — Delivered

- [x] Add `SessionConfigTab` component with General / MCP Servers / Tool Restrictions / Prompts sections (4 tests)
- [x] Add "Config" tab to `SessionDetailView` tab bar
- [x] Empty states: no runs, pre-feature data, multi-run indicator
- [x] API client method + React Query hook (`sessionDispatchConfigQuery`)
- [x] Focused Playwright coverage for Config-tab visibility plus empty/loaded states *(PR #389)*

> Follow-up note: [plans/2026-04-01-mesh-runtime-e2e-follow-up-plan.md](plans/2026-04-01-mesh-runtime-e2e-follow-up-plan.md)
> tracks deeper browser assertions for the already-delivered Config-tab detail
> states without reopening the feature scope.

---

## 32. Frontend Gaps & UX Polish

> Surface backend capabilities that lack frontend support and fix UX issues.

### 32.1 CodeQL Scripts Alerts — Delivered

> Status note: The scripts-specific CodeQL backlog is closed on current `main`; PR #371 landed the original hardening, PR #380 re-closed the earlier latest-base GitHub alert, and PRs #386-#388 closed the reopened 2026-04-01 GitHub findings with the final CodeQL-recognized remote-error sanitizer shape. GitHub currently reports `0` open code-scanning alerts on `main`.

- [x] Fix log injection in `scripts/agentctl.ts` — sanitize remote error text (PR #371; latest-base re-closures in PR #380 and PRs #386-#388)
- [x] Fix TOCTOU race conditions in `scripts/provision-target.ts` and `scripts/deploy.ts` (PR #371)
- [x] Fix insecure temp file creation via `mkdtemp()` in `scripts/provision-target.ts` (PR #371)

### 32.2 Machine ID → Hostname Resolution — Delivered

- [x] Replace raw machine UUID with hostname in `SessionsPage.tsx` (PR #370)
- [x] Replace raw machine UUID with hostname in `AgentsPage.tsx` (PR #370)
- [x] `RuntimeSessionPanel.tsx` already resolved hostnames correctly — no changes needed

### 32.3 CI Stability — Delivered

> Status note: The historical CI/dependency regression chain is again green on the latest `main`; PR #369 fixed the original `brace-expansion` CJS/ESM break, PR #373 restored the failing Security Audit/nightly gitleaks path on the current base, PR #380 merged the remaining targeted `brace-expansion` overrides plus historical fingerprint follow-up, and PR #385 upgraded the remaining `pnpm/action-setup` workflow uses to `v5` to clear the last Node20 deprecation warnings. There are no open Dependabot alerts on `main`.

- [x] Fix `brace-expansion` v5 ESM-only override breaking CJS `require()` in test runners (PR #369; latest-main follow-up merged in PR #380)

---

## 33. Mesh Architecture — Multi-Master Offline-First Sync

> Transform agentctl from hub-spoke to full mesh: every machine (EC2, Mac Mini, laptop) runs a complete CP + Worker with local PG + Redis, operates independently offline, and syncs via pull-based change tracking over Tailscale HTTP.

**Fleet:** EC2 (always-on), Mac Mini (always-on), Laptop (intermittent)
**Identity:** Unified `machineId` (same as worker registration — no separate nodeId)
**Sync model:** 4 append-only tables (auto-merge by PK dedup) + 11 mutable tables (vector clock conflict detection). `api_accounts` is local-only (encrypted credentials don't auto-replicate). Total: 15 synced tables.
**Transport:** Tailscale + HTTP API, pull-based, adaptive poll (30s for always-on, catch-up on reconnect)
**Auth:** Ed25519 signed request envelopes (reuses dispatch signing), nonce replay prevention
**Review:** All 6 specs (v3) + 6 plans passed Codex (GPT 5.4 xhigh) adversarial review (6 rounds)
**Status:** Initial mesh delivery is now on `main`: PR #374 (P1), PR #376 (P4), PR #377 (P2), PR #378 (P6), PR #379 (P5), and PR #381 (P3) delivered sections 33.1-33.6. Follow-up PRs #386/#388 closed the sync-route/security alert loop, PR #425 exposed the peer registry in a standalone web surface for read + health-probe operations, and PR #452 hardened peer registration/ping URL validation against unsafe protocols plus local/metadata SSRF targets.

### 33.1 Change Log + Vector Clock (P1) — Delivered

**Spec:** `docs/superpowers/specs/2026-03-30-mesh-p1-change-log-vector-clock-design.md` (v3)
**Plan:** `docs/superpowers/plans/2026-03-30-mesh-p1-change-log-vector-clock.md` (v4.2, 5 rounds review)

- [x] Machine identity via `getMachineId()` (uses `MACHINE_ID` env, same as worker registration)
- [x] `sync_change_log` table with JSONB vector clocks
- [x] `sync_conflicts` table for mutable-table conflicts
- [x] `sync_nodes` table (PK = machineId) for peer registry
- [x] Generic PG trigger `sync_capture_change()` with `TG_ARGV[0]` PK column on 15 synced tables
- [x] Advisory lock `pg_advisory_xact_lock(hashtext(table:row)::bigint)` for concurrent vclock safety
- [x] `agent_actions.sync_id` UUID column (bigserial PK is not globally unique)
- [x] `pool.on('connect')` sets `app.node_id` per physical connection (not per-request)
- [x] `withSyncApplyGuard()` transaction helper for P2 remote-apply path
- [x] `VectorClock` type + `vcDominates`/`vcMerge`/`vcCompare` utilities (12 unit tests)
- [x] Sync maintenance queue with daily cleanup job (30-day retention for synced entries)

### 33.2 Sync Protocol + API (P2) — Delivered

**Spec:** `docs/superpowers/specs/2026-03-31-mesh-p2-sync-protocol-api-design.md` (v3)
**Plan:** `docs/superpowers/plans/2026-03-31-mesh-p2-sync-protocol-api.md`
**Depends on:** P1 + P4

- [x] Sync auth middleware (`X-Sync-Auth` header, Ed25519 signed envelope with nonce replay LRU)
- [x] `GET /api/sync/changes?since=<cursor>&limit=500` — pull changes from a peer
- [x] `POST /api/sync/ack` — acknowledge cursor, update `sync_peer_cursors.acked_cursor`
- [x] Append-only apply: PK dedup check → INSERT via `withSyncApplyGuard`
- [x] Mutable apply: advisory lock inside transaction → `vcCompare(remote, local)` → apply/skip/conflict
- [x] DELETE handling for mutable tables (vclock comparison same as update)
- [x] Per-peer sync loop with cursor from `sync_peer_cursors.pulled_cursor`
- [x] Batch failure rule: cursor only advances to last successfully applied change
- [x] `markSyncedEntries()`: mark entries synced when ALL peers have ACKed past them
- [x] Catch-up on reconnect (immediate sync when peer transitions unreachable → reachable)
- [x] Verify `TABLE_SYNC_CONFIG` alignment (4 append-only + 11 mutable, api_accounts local-only)

### 33.3 Conflict Resolution UI (P3) — Delivered

**Spec:** `docs/superpowers/specs/2026-03-31-mesh-p3-conflict-resolution-ui-design.md` (v3)
**Plan:** `docs/superpowers/plans/2026-03-31-mesh-p3-conflict-resolution-ui.md`
**Depends on:** P2

- [x] Conflict resolution API: `GET /api/sync/conflicts` (filter by table/peer/status), `PUT /:id/resolve`
- [x] Convergence-safe resolve: every resolution writes merged vclock (`vcMerge`) to `sync_change_log`
- [x] Payload selection: `local` → localPayload, `remote` → remotePayload, `merged` → user body
- [x] DELETE conflicts: "Keep Deleted" / "Restore" actions when one payload is null
- [x] `/conflicts` page with list view showing both node IDs, table, row, timestamp
- [x] Side-by-side JSON diff with field-level highlighting (`ConflictDiffView` component)
- [x] Conflict count badge in sidebar navigation (polled every 60s)
- [x] Focused Playwright coverage for `/conflicts` page load, empty state, and filter dropdown flows *(PR #389)*
- [x] Direct control-plane route coverage for `sync-conflicts` list/detail/resolve/count handlers *(PR #391)*

> Follow-up note: [plans/2026-04-01-mesh-runtime-e2e-follow-up-plan.md](plans/2026-04-01-mesh-runtime-e2e-follow-up-plan.md)
> tracks deeper browser coverage for the already-delivered resolve / merge
> flows without reopening the mesh conflict feature slice.

### 33.4 Node Discovery + Peer Registry (P4) — Delivered

**Spec:** `docs/superpowers/specs/2026-03-31-mesh-p4-node-discovery-peer-registry-design.md` (v3)
**Plan:** `docs/superpowers/plans/2026-03-31-mesh-p4-node-discovery-peer-registry.md` (v2)
**Parallelizable with:** P1

- [x] Extend `sync_nodes` with `sync_url`, `sync_status`, `sync_interval_ms`, `is_self`, `public_key`
- [x] Add `sync_peer_cursors` table (bidirectional: `pulled_cursor` + `acked_cursor` per peer pair)
- [x] `/health` endpoint exposes `machineId` + `nodePublicKey` (threaded via `CreateServerOptions`)
- [x] Tailscale auto-discovery: `tailscale status --json` → `/health` to resolve hostname → machineId
- [x] Peer auth foundation: `peer-auth.ts` with Ed25519 signing/verification (reuses dispatch signing)
- [x] Per-peer health check with adaptive interval (30s default → 5min backoff on failure)
- [x] REST API: `GET/POST/DELETE /api/sync/peers`, `POST /:machineId/ping`
- [x] Standalone `/mesh-peers` web page with sidebar entry, peer status table, 30s polling, per-peer ping action, and Add/Delete peer UI over the existing registry APIs *(PR #425; render/empty/ping-success/ping-failure Playwright coverage in PR #431; sync peer URL/SSRF validation hardening in PR #452; Add peer dialog plus per-row Delete confirmation wired to `POST`/`DELETE /api/sync/peers`, with self-peer delete disabled and create/validation/delete Playwright coverage in PR #483)*

### 33.5 Unified CP + Worker per Machine (P5) — Delivered

**Spec:** `docs/superpowers/specs/2026-03-31-mesh-p5-unified-cp-worker-design.md` (v3)
**Plan:** `docs/superpowers/plans/2026-03-31-mesh-p5-unified-cp-worker.md`
**Depends on:** P4

- [x] Machine-scoped task worker: skip jobs for agents where `machineId !== localMachineId`
- [x] Machine-scoped run reaper: only reap runs for local agents (JOIN to agents.machine_id)
- [x] Machine-scoped repeatable jobs: `createRepeatableJobManager()` filters by machineId
- [x] Machine-scoped audit scheduler: filter audit jobs to local agents
- [x] Agent start route guard: reject remote starts with `AGENT_ON_DIFFERENT_NODE` error
- [x] Dispatch to localhost: force `127.0.0.1:${workerPort}` for local agent dispatch
- [x] `scripts/setup-mesh-node.sh` — bootstrap (PG + Redis + .env.mesh + first boot auto-migration)
- [x] `infra/pm2/ecosystem.mesh.config.cjs` — mesh node PM2 config (loads .env.mesh)
- [x] `.env.mesh.template` + `docs/QUICKSTART-MESH.md` *(direct `main` follow-up `72c618c6`)*

### 33.6 Tailscale ACL Update (P6) — Delivered

**Spec:** `docs/superpowers/specs/2026-03-31-mesh-p6-tailscale-acl-update-design.md` (v3)
**Plan:** `docs/superpowers/plans/2026-03-31-mesh-p6-tailscale-acl-update.md`
**Depends on:** P4

- [x] Add `tag:mesh-node` tag owner + peer-to-peer `:8080` ACL rule
- [x] Mesh nodes triple-tagged: `tag:mesh-node` + `tag:control` + `tag:worker`
- [x] ACL tests embedded in `acl-policy.json` (5 test cases per repo convention)
- [x] Document mesh tagging procedure in `infra/tailscale/README.md`

### 33.7 Mesh Peer UX Overhaul (P1) — Planned

**Motivation:** Operating the mesh today is painful. Two concrete failures surfaced on beta 2026-04-15:

1. A newly added peer sat in `UNREACHABLE` because its `syncUrl` was typed as `https://…:8080`, but the remote CP only speaks plain HTTP behind Tailscale (WireGuard already encrypts). The ping just reported `unreachable` with no reason, so the operator could not tell scheme from firewall from down. Root cause: `pingPeer()` in `api/routes/sync-peers.ts` swallows the `fetch` error and the UI's toast is a generic "peer unreachable".
2. Once a peer row exists, the UI offers only Ping and Delete — there is no Edit. Fixing the scheme above required a direct `POST /api/sync/peers` upsert from the CLI, because deleting and re-adding would have lost `lastSeen`, `syncIntervalMs`, and any cursors.
3. Adding a peer is a 6-field form (`machineId`, `hostname`, `tailscaleIp`, `syncUrl`, `syncInterval`, `publicKey`). Every one of these can be derived from Tailscale + a single `/health` probe — the operator should only need to pick a peer.

**Scope:**

- [ ] **Surface ping failure reason in the API and UI.** Thread the fetch error (category: `dns`, `connect_refused`, `tls_handshake`, `timeout`, `http_status`, `other`) + last-seen status code through `POST /api/sync/peers/:machineId/ping` response, persist as `last_ping_error` on `sync_nodes`, render next to the STATUS pill on `/mesh-peers`, and include in the toast.
- [ ] **Edit existing peer.** Add a per-row Edit action that opens the Add dialog pre-populated. Backend is already idempotent on `POST /api/sync/peers`; UI just needs the dialog mode + row handler + Playwright coverage. Disable Edit on `isSelf` rows.
- [ ] **Tailscale discovery endpoint.** New `GET /api/sync/peers/discover` on the CP shells out to `tailscale status --json` (already used in P4 node discovery), filters to peers tagged `tag:mesh-node`, probes each `http://<tailscaleIp>:8080/health`, and returns `{ machineId, hostname, tailscaleIp, syncUrl, nodePublicKey, reachable }[]` for any peer not already in `sync_nodes`. Rate-limit and auth-gate like other sync routes.
- [ ] **"Discover peers" UI flow.** Replace/augment the `+ Add peer` button with a two-step picker: step 1 lists discovered peers with a checkbox + reachability badge; step 2 previews the derived form and lets the user tweak `syncIntervalMs` before bulk-upserting. Keep the manual form behind an "Add manually" link for air-gapped cases.
- [ ] **Auto-fill by hostname or IP.** In the manual form, add a "Probe" button next to Hostname/Tailscale IP that calls a new `GET /api/sync/peers/probe?target=…` endpoint (hostname OR IP, SSRF-validated against the same blocklist as `validateSyncUrl`), pulls `{ machineId, nodePublicKey }` from `/health`, and fills the remaining fields. Default `syncUrl` to `http://<target>:8080`.
- [ ] **Default scheme + inline hint.** Make the Sync URL placeholder pre-fill with `http://` on focus if empty, and show a small "Tailscale already encrypts — HTTPS is only needed for public endpoints" helper below the field.
- [ ] **Playwright coverage.** Add `/mesh-peers` edit-flow, discover-flow, probe-flow, and ping-failure-detail scenarios to `packages/web/e2e/mesh-peers.spec.ts`.

**Depends on:** 33.4 (peer registry), 33.6 (ACL tagging). Contributes to 16.1 observability (surfacing mesh ping diagnostics).

### 33.8 Mesh Bidirectional Registration + Cross-Node Visibility (P0) — Planned

**Motivation:** 2026-04-15 beta follow-up revealed that peering is silently one-way. Adding `pinnacle-macmini` to the laptop's CP leaves the laptop (`mac-local`) completely absent from the macmini CP's `sync_nodes` table — `GET http://100.87.88.36:8080/api/sync/peers` returns only the self row. Consequences:

- The macmini's `sync-loop.ts` has no laptop peer to pull from, so change-log entries authored on the laptop (new agents, runs, machines) never arrive at the macmini.
- The macmini CP's `/machines` page therefore never discovers the laptop's worker, and vice-versa — even though `machines` already has a `sync_capture_change` trigger (see `drizzle/0021_mesh_change_log.sql`).
- In the UI, the symptom looks like "sync is broken," but the sync protocol is fine — it's never invited to run because the peer set isn't bidirectional.

**Scope:**

- [ ] **Authenticated bidirectional handshake.** When `POST /api/sync/peers` creates a new peer on node A, A signs a `register-peer` envelope with its Ed25519 key (already used by `peer-auth.ts`) and calls `POST /api/sync/peers/register` on the target. Target validates the signature, derives A's `{ machineId, hostname, tailscaleIp, publicKey, syncUrl }` from its own `/health` + `tailscale status` lookup of A's source IP, and upserts the reverse row with `sync_status = 'unknown'` until its own ping confirms reachability. The target responds with its own identity so A can fill in `publicKey` if missing.
- [ ] **Auto-register self on peer-add.** If the handshake above fails (remote unreachable, no `/register` endpoint on older peers), fall back to logging a `warn` + surfacing a "Peer did not acknowledge handshake — reverse registration may be incomplete" banner in the UI, so the operator knows to run the handshake manually from the other side.
- [ ] **"Register this CP with peer" action.** Add a per-row action on `/mesh-peers` to manually (re)trigger the handshake — useful when a peer is added before it's online, or when rotating `node_public_key`.
- [ ] **Machines / workers cross-visibility.** Once bidirectional peering works, confirm that the `machines` sync_capture trigger + sync_loop actually propagates rows end-to-end: add an integration test that upserts a machine on node A and asserts it appears on node B within one sync tick. Today the trigger fires but the pull side is never invoked.
- [ ] **Fleet view cross-node badge.** On `/machines`, badge each row with its **origin machine** (`Synced from <peer hostname>` vs `Local`) using the existing `machines.origin_node_id` / sync provenance metadata so the operator can see which worker lives where.
- [ ] **Mesh health panel.** Single-pane summary on `/mesh-peers` header: `N peers · bidirectional · M one-way · K stale (no sync in >10 min)`. Clicking a row reveals last pull/ack cursors from `sync_peer_cursors`.
- [ ] **Playwright coverage.** Two-node fixture (docker compose) exercising: add peer on A ⇒ sees self row on B, upsert machine on A ⇒ appears on B, break handshake ⇒ UI shows one-way warning.

**Depends on:** 33.7 (Edit/Probe plumbing), 33.4 (peer registry + peer-auth).

---

## Active Priorities

| Priority | Item | Section | Status |
|----------|------|---------|--------|
| **P0** | ~~Emergency Stop UI~~ | — | ✅ Delivered — PR #408 exposed existing emergency-stop backend routes in the web UI with confirmation dialogs, tests, and fleet-wide kill. |
| **P0** | ~~Sync Route Rate-Limit Hardening~~ | 16.1 / 33.2 | ✅ Delivered — PR #386 added the explicit sync pull/ack limiters on current `main`, PR #388 closed the final scripts CodeQL follow-up, and GitHub now reports `0` open security alerts |
| **P0** | ~~Agent Worker Container Security Remediation~~ | 26.1 | ✅ Delivered — PRs #307, #314, and #326 are on `main`, and as of 2026-03-20 GitHub code scanning shows `0` open alerts while both worker Trivy categories upload `0`-result analyses on recent `main` commits (`cdd63b8`, `3e38d87`, `4c82efb`) |
| **P0** | ~~Worker Git Capability Hardening~~ | 26.2 | ✅ Delivered — PR #322 landed the runtime hardening slice on `main`, and the post-#326 scans converged without removing `git` from the standard worker image |
| **P0** | ~~Web Hardening Follow-through~~ | 25.1-25.3 | ✅ Delivered — runtime sessions Playwright coverage (PR #306), settings control-center coverage (PR #304), and web/shared permission-request contract cleanup (PR #305) are now on `main`; machines / terminal coverage now lives in the dedicated section 29 follow-up |
| **P0** | ~~Mesh: Change Log + Vector Clock~~ | 33.1 | ✅ Delivered — PR #374 merged. 17 files, 871 additions, 32 tests. VectorClock utils, sync types, machine identity, pool hook, PG triggers on 15 tables, sync maintenance queue. |
| **P0** | ~~Mesh: Node Discovery + Peer Registry~~ | 33.4 | ✅ Delivered — PR #376 merged peer discovery, health check, auth, REST API, and 36 tests; PR #425 added the standalone `/mesh-peers` web read + ping surface over that registry, PR #431 added focused Playwright coverage, PR #452 hardened sync peer URL/SSRF validation, and PR #483 added Add/Delete peer registry actions plus browser coverage. |
| **P0** | ~~Mesh: Sync Protocol + API~~ | 33.2 | ✅ Delivered — PR #377 merged. Sync auth, pull/ack endpoints, apply logic with advisory locks, per-peer sync loop, synced marker. 33 tests. |
| **P1** | ~~Mesh: Conflict Resolution UI~~ | 33.3 | ✅ Delivered — PR #381 merged the feature slice, PR #389 added focused Playwright coverage for the existing `/conflicts` page state/filter flows, and PR #391 added direct backend route coverage for the `sync-conflicts` handlers. |
| **P1** | ~~Mesh: Unified CP + Worker~~ | 33.5 | ✅ Delivered — PR #379 merged. Machine-scoped jobs/reaper/scheduler, localhost dispatch, setup script, PM2 mesh config. |
| **P1** | ~~Mesh: Tailscale ACL Update~~ | 33.6 | ✅ Delivered — PR #378 merged. tag:mesh-node ACL + 5 embedded tests. |
| **P1** | Mesh Peer UX Overhaul | 33.7 | Planned — surface per-ping failure reason, add per-row Edit, Tailscale-backed `/discover` + `/probe` endpoints, and a two-step discovery picker so adding a peer no longer requires typing 6 fields. Motivated by 2026-04-15 beta incident where an `https://` syncUrl on an HTTP-only peer reported `unreachable` with no detail. |
| **P0** | Mesh Bidirectional Registration + Cross-Node Visibility | 33.8 | Planned — adding a peer on node A today does not register A on node B, so sync is silently one-way and peer Machines never cross-populate. Adds a signed `POST /api/sync/peers/register` handshake, a manual "Register with peer" action, origin-node badges on `/machines`, and a two-node Playwright fixture that proves machine rows replicate end-to-end. Motivated by 2026-04-15 observation that laptop-side `mac-local` never appeared in macmini's `sync_nodes` or `machines`. |
| **P0** | ~~CodeQL Scripts Alerts~~ | 32.1 | ✅ Delivered — PR #371 landed the scripts hardening, PR #380 re-closed the earlier latest-base alert, and PRs #386-#388 closed the reopened 2026-04-01 findings on current `main` |
| **P1** | ~~Machine ID → Hostname~~ | 32.2 | ✅ Delivered — PR #370 resolves machine UUIDs to hostnames with tooltip |
| **P0** | ~~CI Stability~~ | 32.3 | ✅ Delivered — PR #369 fixed the original `brace-expansion` regression, PR #380 closed the remaining latest-main dependency/security follow-up, and PR #385 cleared the last `pnpm/action-setup` Node20 deprecation warnings |
| **P1** | ~~Mesh / Runtime E2E Follow-up~~ | 16.1 / 31.3 / 33.3 / 33.4 | ✅ Delivered — PR #395 shipped the deeper session `Config` tab detail-state coverage, PR #396 shipped the `/conflicts` resolution-flow coverage, PR #397 landed the plan-tracking doc, and PR #431 added `/mesh-peers` render/empty/ping browser coverage. See [plans/2026-04-01-mesh-runtime-e2e-follow-up-plan.md](plans/2026-04-01-mesh-runtime-e2e-follow-up-plan.md) |
| **P0** | ~~Runtime Config Visibility~~ | 31.1-31.3 | ✅ Delivered — PRs #366 (backend), #368 (frontend), #389 (focused Playwright coverage), and #391 (direct backend route coverage) are on `main`; dispatch_config JSONB column, redactMcpServers, GET /sessions/:id/dispatch-config endpoint, and Config tab on session detail page |
| **P0** | ~~Running Agent Observability~~ | 30.1-30.2 | ✅ Delivered — direct `main` commits `7a2ae06` and `d1b7a77` shipped early session linking plus live cost/token reporting in run history, `e5f07913` hardened the early `rc_session` bookkeeping, and `bf899eb0` plus PR #361 now keep heartbeat refresh on live progress updates covered on current `main` |
| **P0** | ~~Unified Session Browser (Web)~~ | 4.6 | ✅ Delivered |
| **P0** | ~~CLAUDE.md Management Strategy~~ | 17.3 | ✅ Delivered — `project` / `managed` / `merge` strategies, accurate project preview, and targeted web coverage landed (PRs #215, #218, #220) |
| **P1** | ~~Unified Memory Layer~~ | 3.6 | ✅ Delivered — all knowledge engineering items complete (PRs #50-#59) |
| **P1** | ~~Unified Memory System UI~~ | 4.8 | ✅ Delivered — original 8 pages plus synthesis/maintenance follow-ups, integration points, and MCP tools (PRs #47,#50,#52-#59,#470,#473); backend routes for consolidation, reports, decay, synthesis, and maintenance all landed |
| **P1** | ~~Memory Browser Provenance Filters~~ | 4.8 | ✅ Delivered in PR #486 — exposes the already-supported `sessionId` / `agentId` / `machineId` memory fact filters in `/memory/browser`, keeps them shareable via URL state, and adds focused unit/Playwright coverage. See [plans/2026-04-14-memory-browser-provenance-filters-plan.md](plans/2026-04-14-memory-browser-provenance-filters-plan.md) |
| **P1** | ~~UI Quality & Accessibility~~ | 4.7 | ✅ Delivered — all original ARIA items complete (PRs #51,#54,#59), StatusBadge descriptions refreshed in PR #417, slash-search/hotkey discoverability improved in PRs #446/#449, shared Sidebar/Sessions `?` event ownership centralized in PR #450, and sidebar Go To keyboard coverage plus Settings shortcut docs expanded in PR #525 |
| **P1** | ~~Structured Execution Summary~~ | 2.5 | ✅ Delivered |
| **P1** | ~~Workdir Safety Tiers~~ | 2.6 | ✅ Delivered |
| **P1** | ~~Dispatch Signature Verification~~ | 2.7 | ✅ Delivered |
| **P1** | Machines / Terminal E2E Follow-up | 29 | ✅ Delivered — PR #346 shipped dedicated Playwright coverage for the existing machine terminal page without widening into §27.3 |
| **P1** | ~~Terminal Takeover~~ | 27.3 | ✅ Delivered — PRs #340-#344 and #350 shipped worker/control-plane/web/CLI live attach plus focused runtime-session attach e2e coverage on `main` |
| **P2** | ~~Memory Decay UI~~ | 3.6 / 4.8 | ✅ Delivered — PR #407 added stats card and trigger button for the existing memory-decay backend route. |
| **P2** | ~~AgentOutputStream~~ | 3.3 | ✅ Delivered |
| **P2** | ~~Fork UX Extensions~~ | 4.9 | ✅ Delivered — smart selection + runtime in fork (PR #57) |
| **P2** | ~~Mid-Execution Steering~~ | 2.8 | ✅ Delivered (PR #45) |
| **P2** | ~~Codex Operational Parity~~ | 3.4 | ✅ Delivered — sandbox enforcement (PR #61) + verification evidence (PR #70) |
| **P2** | ~~Automatic Handoff Triggers~~ | 3.5 | ✅ Delivered — task-affinity (PR #62) + live rate-limit failover + cost-threshold switching (PR #66) |
| **P2** | ~~Remote Control Integration / Manual Takeover~~ | 2.4 | ✅ Delivered — relay decision + narrow manual takeover + reconciliation re-verification (PR #405) plus the CodeQL #579 rate-limit false-positive follow-up (PRs #410/#413 and formal dismissal) |
| **P1** | ~~Approval Push Dispatch~~ | 21.2 | ✅ Delivered — Expo token bootstrap, device registry, tap routing, and control-plane dispatch are all on `main` (PRs #290, #291, #295) |
| **P2** | ~~Layered Knowledge Loading~~ | 7.1 | ✅ Delivered — always-on/on-demand split, error-handling rule extracted, all files audited |
| **P2** | Knowledge Sedimentation Rules | 7.2 | ✅ Delivered |
| **P3** | ~~Mobile Session Browser~~ | 5.1-5.3 | ✅ Delivered — all items complete: time-range, rich cards, handoff timeline, action bar, push notifications (PR #67), SSE stream + replay (PR #71) |
| **P3** | ~~Execution Environment Registry~~ | 2.9 | ✅ Delivered — DirectEnvironment + DockerEnvironment with gVisor (PR #69) |
| **P3** | ~~Automated Experience Extraction~~ | 7.3 | ✅ Delivered — Stop hook, entity routing, Jaccard dedup, review flags (PR #64) |
| **P3** | ~~Knowledge Maintenance / Dreaming~~ | 7.4 | ✅ Delivered — monthly lint, git cross-ref, synthesis, coverage reporting (PR #65) |
| **P1** | ~~Deploy CLI~~ | 8.1 | ✅ Delivered — `scripts/deploy.ts` with init/up/down/status/logs (PR #72) |
| **P1** | ~~TUI Monitoring Panel~~ | 8.2 | ✅ Delivered — Ink 4.x 3-panel TUI `scripts/tui.tsx` (PR #73) |
| **P1** | ~~Deployment Guide~~ | 8.3 | ✅ Delivered — `docs/DEPLOYMENT.md` quick-start/production/multi-machine (PR #72) |
| **P0** | ~~CLAUDE.md / Project Instructions Discovery~~ | 9.1 | ✅ Delivered — `--cwd` flag added to CLI args (PR #78) |
| **P0** | ~~MCP Server Configuration for Agents~~ | 9.2 | ✅ Delivered — `.mcp.json` + config downlink in dispatch payload (PRs #80, #132) |
| **P1** | ~~Agent Config as Default Prompt~~ | 9.3 | ✅ Delivered — `defaultPrompt` + optional prompt (PR #79) |
| **P1** | ~~Cost Tracking Display Fix~~ | 9.4 | ✅ Delivered — sdk-runner + frontend field mismatch (PR #79) |
| **P1** | ~~Cron UX Improvements~~ | 9.5 | ✅ Delivered — visual cron builder + next runs (PR #81) |
| **P2** | ~~Agent Execution History Improvements~~ | 9.6 | ✅ Delivered — grouped by date, filters, stats (PR #81) |
| **P0** | ~~Start Button Ignores defaultPrompt~~ | 11.1 | ✅ Delivered — effectivePrompt fallback + placeholder (PR #86) |
| **P0** | ~~MCP Auto-Detection & Managed Config~~ | 11.6 | ✅ Delivered — 3-layer discovery + McpServerPicker (PR #89) |
| **P0** | ~~Agent Settings Redesign (Tabbed)~~ | 11.7 | ✅ Delivered — full-page 5-tab settings (PR #90) |
| **P1** | ~~Agent Header Overflow~~ | 11.2 | ✅ Delivered — CSS truncate + tooltip (PR #86) |
| **P1** | ~~Cost Display Still $0.00~~ | 11.3 | ✅ Delivered — computed from runs (PR #87) |
| **P1** | ~~Run History Bar Redesign~~ | 11.4 | ✅ Delivered — recharts BarChart (PR #88) |
| **P1** | ~~Execution History ↔ Session Linkage~~ | 11.5 | ✅ Delivered — sessionId + View Session link (PR #88) |
| **P1** | ~~Multi-Agent Collaboration Phase 1~~ | 10.1 | ✅ Delivered — schema + stores + routes + Spaces UI (PRs #91-92) |
| **P2** | ~~Multi-Agent Communication~~ | 10.2 | ✅ Delivered — outbox + NATS + WS gateway + approvals (PR #95) |
| **P2** | ~~Task Graph + Fleet~~ | 10.3 | ✅ Delivered — DAG engine + leases + BullMQ executor (PR #94) |
| **P3** | ~~Context Bridge~~ | 10.4 | ✅ Delivered — cross-space context mobility, 4 modes + MCP tool + budget (PRs #97, #131, #133) |
| **P3** | ~~Intelligence Layer~~ | 10.5 | ✅ Delivered — smart routing, auto-decompose, outcome learning, notifications (PRs #111-113, #112) |
| **—** | ~~Security: CodeQL Path Injection~~ | — | ✅ Delivered — files.ts (PR #98) + sessions/git/cli-session-manager (PR #99) |
| **—** | ~~Security: CodeQL Sessions + Rate Limiting~~ | — | ✅ Delivered — safeRead/Write wrappers + @fastify/rate-limit (PR #115) |
| **—** | ~~Security: CodeQL Remaining Alerts~~ | — | ✅ Delivered — git.ts + audit-reporter.ts + knowledge-maintenance.ts (PR #116) |
| **—** | ~~Migration: Prerequisite Tables~~ | — | ✅ Delivered — collaboration/task-graph/approval-gates migrations for CI (PR #119) |
| **P1** | ~~Environment Isolation: De-Hardcode Ports~~ | 12.0 | ✅ Delivered — env var config for all ports (PR #103) |
| **P1** | ~~Environment Isolation: Env Files + DB + PM2~~ | 12.1-12.3 | ✅ Delivered — .env.template + env-migrate.sh + PM2 config (PRs #103-104) |
| **P2** | ~~Environment Isolation: Lifecycle Scripts~~ | 12.4 | ✅ Delivered — env-up.sh + env-down.sh + env-promote.sh (PRs #104, #130) |
| **P2** | ~~Environment Isolation: Worktree Integration~~ | 12.5 | ✅ Delivered — tier assignment + auto-source (PR #127), cleanup on PR completion (PR #125) |
| **—** | ~~Security: Worker Route Hardening~~ | — | ✅ Delivered — rate-limit assertions + path guard tightening (PR #124) |
| **—** | ~~Security: CodeQL Misc (temp-file, shell-injection)~~ | — | ✅ Delivered — audit-logger + knowledge-maintenance (PR #106) |
| **—** | ~~Security: CodeQL Worker Alerts~~ | — | ✅ Delivered — inline path checks, rate-limit config, symlink guards (PR #138) |
| **—** | ~~Security: CP Rate Limiting~~ | — | ✅ Delivered — memory-decay routes (PR #135) |
| **P3** | Environment: promote-beta.yml | 12.6 | Partial — PR #355 reality-synced the existing workflow scaffold, but live GitHub-triggered beta promotion still requires a dedicated `agentctl-beta` self-hosted runner plus `BETA_SELF_HOSTED_RUNNER_READY` |
| **—** | ~~Hardcoded Port Audit~~ | 12.0 | ✅ Delivered — scripts, TUI, Playwright config (PR #137), with deferred web `WEB_PORT` package scripts closed in PR #445 |
| **—** | ~~Open Source & Community~~ | 13 | ✅ Delivered — BSL 1.1, CONTRIBUTING, SECURITY, GitHub templates |
| **—** | ~~CI: Security Audit Push Trigger~~ | — | ✅ Delivered — CodeQL rescans on push to main (PR #140) |
| **—** | ~~Security: Discovery + Worktree Path Hardening~~ | — | ✅ Delivered — discovery path reads (PR #176) + worktree-manager path writes (PR #177) |
| **—** | ~~Security: Agent Start + MCP Discover Hardening~~ | — | ✅ Delivered — explicit agent-start framework rate limiting (PR #179) + safe MCP discover file reads (PR #180) |
| **—** | ~~Security: Path + Git + Memory + Loop Hardening~~ | — | ✅ Delivered — `path-security.ts` wrappers (PR #182), `git.ts` hardening (PR #183), control-plane memory-route limiters (PR #184), `loop-controller.ts` hard cap (PR #185), residual path-session cleanup (PRs #187-#188), and first residual agents/control-plane/loop follow-up batch (PRs #190-#192) |
| **P0** | ~~MCP & Skill Auto-Discovery: Types + Override Resolution~~ | 14.1 | ✅ Delivered (PR #146) |
| **P0** | ~~MCP & Skill Auto-Discovery: Worker Discovery~~ | 14.2 | ✅ Delivered (PR #147) |
| **P0** | ~~MCP & Skill Auto-Discovery: CP Proxies & Sync~~ | 14.3 | ✅ Delivered (PR #149) |
| **P0** | ~~MCP & Skill Auto-Discovery: Frontend Picker UX~~ | 14.4 | ✅ Delivered (PR #151) |
| **P1** | ~~MCP & Skill Auto-Discovery: Machine Capability Triggers~~ | 14.5 | ✅ Delivered (PR #153) |
| **P0** | ~~MCP & Skill Auto-Discovery: E2E Testing~~ | 14.6 | ✅ Delivered (PR #152) |
| **P0** | ~~Codex Parity: Runtime Selector Penetration~~ | 15.1 | ✅ Delivered (PRs #148, #150) |
| **P1** | ~~Codex Parity: Config Capabilities Exposure~~ | 15.2 | ✅ Delivered (PR #156) |
| **P0** | Agent Run Quality | 16.1 | Current loop closed through PR #542 on `main@ed9ee0ee` — PR #385 plus PRs #386-#388 finished the 2026-04-01 CI/security follow-up on `main`; PRs #398/#400/#401/#402/#404 cleared the 2026-04-13 dependency-audit + DAST WebSocket fuzz loop; PRs #410/#413 plus formal dismissal closed CodeQL #579; PRs #411/#414 repaired web test infrastructure; PR #415 added `/memory/reports` e2e depth; PR #416 surfaced security findings in Logs; PR #418/#422 covered NotificationBell approval-popover e2e depth and aria-label drift; PR #420 cleared the residual web unit failures; PR #423 added OAuth PKCE route rate limiting; PR #426 tightened web accessibility labels/titles; PR #427 added accounts route rate limiting; PR #429 covered account verification rate limiting; PR #431 added mesh peers browser coverage; PR #436 added security-findings browser coverage; PR #439 closed the remaining route-rate-limit audit; PR #440 cleaned up CI/security scan annotations; PR #442 landed a11y follow-up semantics; PR #443 added Zod input bounds to three write surfaces; PR #445 moved the webhooks Playwright slice into CI; PR #447 added mobile-push validation negative coverage; PR #448 tightened six control-plane input surfaces; PR #452 hardened sync-peer URL/SSRF validation; PR #454 covered the `/logs` Security Findings tab; PR #455 covered the `/memory/browser` facts flow; PRs #470-#478 shipped and tested the latest memory/tasks/webhook/push-device web feature batch; PR #479 removed stale agent-worker discovery type stubs; PR #480 fixed post-#477 roadmap sync review findings; PR #481 split the 2174-line web `lib/api.ts` into 11 domain modules behind an unchanged barrel; PR #482 added the dry-run-first `scripts/db-provision-tier.ts` dev-tier DB/role helper; PR #483 delivered the previously deferred `/mesh-peers` Add/Delete UI over the existing registry APIs; PR #487 added task auto-decompose apply-failure browser coverage; PR #488 added webhook delivery-list retry coverage; PRs #489-#493 synced the earlier roadmap checkpoint and Agent Run Quality summary; PR #492 added backend-independent `/agents/[id]` detail/start browser coverage; PR #494 added backend-independent `/agents` list/create/start browser coverage; PR #495 added agent settings browser coverage; PR #496 fixed dev-tier startup portability; PR #497 hardened routing payload bounds; PR #499 added machines browser coverage; PR #498 shipped the agent-profiles web UI; PR #517 shipped the scheduler jobs page; PR #518 gated the agents-list Playwright slice in focused CI with a shared build preflight; PR #520 modernized Docker publish Grype SARIF output; PR #522 removed duplicate cache-save annotations; PR #523 moved Docker publish/audit/DAST Docker actions onto Node24 majors; PR #524 synced the checkpoint; PR #525 shipped conflict-safe sidebar `g`-prefix Go To shortcuts with Settings docs; PR #526/#527 synced roadmap and affected plan records after that keyboard-accessibility landing; PR #529 added backend-independent `/sessions/[id]` detail route smoke coverage; PR #528 added backend-independent `/memory/dashboard` route smoke coverage; PR #530 synced the row-level roadmap ledger; PR #532 added client-side URL-length validation with inline feedback to the webhooks and sync-peers create dialogs; PR #533 added backend-independent `/scheduler` browser coverage; PR #536 removed the non-functional Consolidation Board Edit action; PR #537 fixed current Codex session discovery; PR #538 added approvals expander accessibility semantics; PR #540 wrapped `/logs` and `/settings` with shared ErrorBoundary coverage; PR #541 synced roadmap/plan records; and PR #542 added the Accounts empty-state credential CTA plus input validation accessibility wiring. |
| **P0** | ~~Dev Environment Infrastructure~~ | 16.2 | ✅ Delivered — dev-1/dev-2 isolation, PM2 configs, Next.js middleware proxy, version display |
| **P0** | ~~Frontend UI Polish (dashboard, agent detail, cards)~~ | 16.3 | ✅ Delivered — PRs #158-#165, #212-#213, #229-#246; all critique items resolved |
| **P1** | ~~Agent Settings Config Preview Sidebar~~ | 16.4 | ✅ Delivered (PR #163) |
| **P0** | ~~Config Preview Data Accuracy~~ | 16.5 | ✅ Delivered (PRs #194-#196) |
| **P0** | ~~Security Hardening (Codex batch)~~ | 16.6 | ✅ Delivered (PRs #167-#220) |

---

## Target Workflow Summary

```
PR:              CI (lint + test) → Docker build → security scan (CodeQL + Semgrep + Trivy)
merge → dev:     CI → Docker build → push ghcr.io:dev-latest → deploy dev → health check → ZAP
merge → main:    CI → Docker build → push ghcr.io:main-latest → (ready for release)
GitHub Release:  push ghcr.io:v*.*.* → approval gate → DB backup + migrate → deploy prod → smoke
rollback:        workflow_dispatch → select tag → deploy → health check
fleet deploy:    canary → verify → matrix remaining → per-machine health check
nightly:         security audit agent → structured report → auto-create issues
session control: CLI -p (primary) → Agent SDK wrapper → tmux fallback
handoff:         manual / rate-limit / cost → serialize context → hydrate target → resume
task complete:   execution summary (session resume) → JSONB → summary card
steer:           chat input → control plane proxy → worker → SDK streamInput → ack
safety check:    workdir classify (4 tiers) → SSE event → approve/reject/sandbox → execute
runtime mgmt:    config sync → managed sessions → native import preflight → snapshot fallback
mcp/skill:       machine config scan → discover MCP servers (JSON/TOML) + skills (SKILL.md) → machine defaults → per-agent opt-out overrides → picker UX
codex parity:    RuntimeSelector (radio/dropdown) → RuntimeAwareModelSelect → RuntimeAwareMachineSelect → unified create/edit/filter flows for claude-code + codex
memory:          embed fact → pgvector HNSW → hybrid search (vector+BM25+graph RRF) → 3-tier injection
memory UI:       /memory → browser/graph/dashboard/consolidation/reports/import/editor/scopes/synthesis/maintenance
memory integ:    session/agent/machine/dashboard/context-picker/cmd-palette → contextual memory data
knowledge:       extract → lint (dedup+contradict) → synthesize (LLM propose) → human review → promote
feedback:        agent uses fact → memory_feedback(used/irrelevant/outdated) → adjust strength/ranking
```

## Dependencies

| Item | Depends On | Notes |
|------|-----------|-------|
| ~~Unified Session Browser (P0)~~ | None | ✅ Delivered |
| ~~Unified Memory Layer (P1)~~ | None | ✅ Delivered — all knowledge engineering items complete, decay module landed (PR #76) |
| ~~Unified Memory System UI (P1)~~ | Unified Memory Layer (§3.6) backend routes | ✅ Delivered — original 8 pages plus synthesis/maintenance follow-ups + integration + all backend routes (consolidation, reports, decay, synthesis, maintenance) |
| ~~UI Quality & Accessibility (P1)~~ | None | ✅ Delivered — all original ARIA items complete; StatusBadge descriptions refreshed in PR #417; slash-search/hotkey discoverability improved in PRs #446/#449; shared Sidebar/Sessions `?` ownership centralized in PR #450; sidebar Go To keyboard coverage plus Settings shortcut docs expanded in PR #525 |
| ~~Execution Summary (P1)~~ | None | ✅ Delivered (PRs #32, #39) |
| ~~Workdir Safety (P1)~~ | None | ✅ Delivered |
| ~~Dispatch Signing (P1)~~ | None | ✅ Delivered |
| ~~AgentOutputStream (P2)~~ | None | ✅ Delivered (PR #29) |
| ~~Mid-Execution Steering (P2)~~ | AgentOutputStream | ✅ Delivered (PR #45) |
| ~~Codex Operational Parity (P2)~~ | None | ✅ Delivered — sandbox enforcement + verification evidence |
| ~~Automatic Handoff (P2)~~ | AgentOutputStream for live signals | ✅ Delivered — worker-side architecture (diverged from plan's CP-side design) |
| ~~Remote Control Integration (P2)~~ | None | ✅ Delivered — relay decision + narrow manual takeover + reconciliation re-verification (PR #405) plus CodeQL #579 follow-up (PRs #410/#413 and formal dismissal) |
| ~~Fork UX Extensions (P2)~~ | Unified Memory Layer + Memory UI (§4.8) | ✅ Delivered — smart selection + runtime in fork |
| ~~Layered Knowledge Loading (P2)~~ | None | ✅ Delivered — see §7.1 |
| ~~Knowledge Sedimentation Rules (P2)~~ | None | ✅ Delivered — see §7.2 |
| ~~Mobile Session Browser (P3)~~ | None | ✅ Delivered — all items complete |
| ~~Execution Environment Registry (P3)~~ | AgentOutputStream for adapter context + Docker | ✅ Delivered — Direct + Docker environments with gVisor |
| ~~Automated Experience Extraction (P3)~~ | Knowledge Sedimentation Rules | ✅ Delivered — stop hook, entity routing, dedup, review flags |
| ~~Knowledge Maintenance (P3)~~ | Unified Memory Layer | ✅ Delivered — monthly lint, git cross-ref, synthesis, coverage reporting |
| MCP & Skill Auto-Discovery (P0) | Codex Integration (§3.1), MCP Auto-Detection (§11.6) | Extends existing MCP discovery with runtime-awareness + new skill discovery |
| Codex Runtime Parity A (P0) | Codex Integration (§3.1) | Runtime selectors in all create/edit flows |
| Codex Runtime Parity B (P1) | Codex Runtime Parity A (§15.1) | Codex-specific config UI; depends on runtime being selectable first |

## References

### CI/CD
- [GitHub Actions Monorepo CI/CD Guide (2026)](https://dev.to/pockit_tools/github-actions-in-2026-the-complete-guide-to-monorepo-cicd-and-self-hosted-runners-1jop)
- [Docker Compose + Tailscale Deployment](https://aaronstannard.com/docker-compose-tailscale/)
- [Tailscale GitHub Action](https://tailscale.com/kb/1276/tailscale-github-action)
- [Trivy Container Scanning](https://github.com/aquasecurity/trivy-action)
- [Grype/Anchore Scan](https://github.com/anchore/scan-action)
- [Drizzle ORM Migrations](https://orm.drizzle.team/docs/migrations)

### Agent Runtime
- [Claude Code Remote Control (Feb 2026)](https://docs.anthropic.com/en/docs/claude-code/remote-control) — Outbound polling relay (optional enhancement)
- [Claude Agent SDK](https://github.com/anthropic/claude-agent-sdk) — TypeScript SDK wrapping Claude Code CLI
- [OpenAI Codex CLI](https://github.com/openai/codex) — Terminal-native coding agent
- [Astro Agent Runner](https://github.com/astro-anywhere/astro-agent) — Provider adapters, execution strategies, workdir safety, dispatch signing

### Security
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
- [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
- [AWS Agentic AI Security Scoping Matrix](https://aws.amazon.com/blogs/security/the-agentic-ai-security-scoping-matrix-a-framework-for-securing-autonomous-ai-systems/)

### Design Documents

| Plan | Status | Section |
|------|--------|---------|
| [scheduled-sessions-and-loop-design](plans/2026-03-02-scheduled-sessions-and-loop-design.md) | Archived | 2.1, 2.2 |
| [frontend-framework-survey](plans/2026-03-03-frontend-framework-survey.md) | Archived | 4.1 |
| [nextjs-migration-design](plans/2026-03-03-nextjs-migration-design.md) | Archived | 4.1 |
| [session-takeover-design](plans/2026-03-03-session-takeover-design.md) | Archived | 2.3 |
| [multi-account-design](plans/2026-03-04-multi-account-design.md) | Archived | 4.2 |
| [multi-account-impl-plan](plans/2026-03-04-multi-account-impl-plan.md) | Archived | 4.2 |
| [cross-machine-session-transfer](plans/2026-03-06-cross-machine-session-transfer.md) | Delivered | 4.3 |
| [advanced-fork-design](plans/2026-03-08-advanced-fork-design.md) | Archived | 4.3 |
| [advanced-fork-impl-plan](plans/2026-03-08-advanced-fork-impl-plan.md) | Archived | 4.3 |
| [codex-claude-runtime-unification-design](plans/2026-03-09-codex-claude-runtime-unification-design.md) | Delivered | 3.1, 3.2 |
| [codex-claude-runtime-unification-impl-plan](plans/2026-03-09-codex-claude-runtime-unification-impl-plan.md) | Delivered | 3.1, 3.2 |
| [fork-ux-overhaul](plans/2026-03-09-fork-ux-overhaul.md) | Delivered | 4.9 |
| [astro-agent-patterns-design](plans/2026-03-10-astro-agent-patterns-design.md) | Delivered | 2.5-2.9, 3.3 |
| [runtime-centric-settings-redesign-design](plans/2026-03-10-runtime-centric-settings-redesign-design.md) | Delivered | 4.5 |
| [runtime-centric-settings-redesign-impl-plan](plans/2026-03-10-runtime-centric-settings-redesign-impl-plan.md) | Delivered | 4.5 |
| [runtime-settings-config-consistency-design](plans/2026-03-10-runtime-settings-config-consistency-design.md) | Subsumed | 4.5 |
| [runtime-settings-config-consistency-impl-plan](plans/2026-03-10-runtime-settings-config-consistency-impl-plan.md) | Subsumed | 4.5 |
| [unified-sessions-ui-design](plans/2026-03-10-unified-sessions-ui-design.md) | Delivered | 4.6 |
| [unified-sessions-ui-impl-plan](plans/2026-03-10-unified-sessions-ui-impl-plan.md) | Delivered | 4.6 |
| [remote-control-relay-decision](plans/2026-03-10-remote-control-relay-decision.md) | Delivered | 2.4 |
| [unified-memory-layer-design](plans/2026-03-10-unified-memory-layer-design.md) | Delivered | 3.6 |
| [unified-memory-layer-impl-plan](plans/2026-03-10-unified-memory-layer-impl-plan.md) | Delivered | 3.6 |
| [public-repo-prep-design](plans/2026-03-10-public-repo-prep-design.md) | Delivered | 13.1-13.6 |
| [public-repo-prep-impl-plan](plans/2026-03-10-public-repo-prep-impl-plan.md) | Delivered | 13.1-13.6 |
| [automatic-handoff-triggers-design](plans/2026-03-11-automatic-handoff-triggers-design.md) | Delivered | 3.5 |
| [automatic-handoff-triggers-impl-plan](plans/2026-03-11-automatic-handoff-triggers-impl-plan.md) | Delivered | 3.5 |
| [execution-environment-registry-design](plans/2026-03-11-execution-environment-registry-design.md) | Delivered | 2.9 |
| [execution-environment-registry-impl-plan](plans/2026-03-11-execution-environment-registry-impl-plan.md) | Delivered | 2.9 |
| [manual-remote-takeover-design](plans/2026-03-11-manual-remote-takeover-design.md) | Delivered | 2.4 |
| [manual-remote-takeover-impl-plan](plans/2026-03-11-manual-remote-takeover-impl-plan.md) | Delivered | 2.4 |
| [claude-mem-migration-plan](plans/2026-03-11-claude-mem-migration-plan.md) | Delivered | 3.6 |
| [memory-ui-design](plans/2026-03-11-memory-ui-design.md) | Delivered | 4.8 |
| [memory-ui-implementation](plans/2026-03-11-memory-ui-implementation.md) | Delivered | 4.8 |
| [memory-browser-provenance-filters-plan](plans/2026-04-14-memory-browser-provenance-filters-plan.md) | Delivered in PR #486 — expose existing memory fact source filters in `/memory/browser` | 4.8 |
| [multi-agent-collaboration-design](plans/2026-03-12-multi-agent-collaboration-design.md) | Delivered | 10.1-10.5 |
| [multi-agent-collaboration-phase1-impl-plan](plans/2026-03-12-multi-agent-collaboration-phase1-impl-plan.md) | Delivered; PR #526 records the later PR #525 sidebar follow-up that expanded the same nav surface with `g`-prefix Go To chords and grouped Settings shortcut docs | 10.1 |
| [multi-agent-communication-impl-plan](plans/2026-03-12-multi-agent-communication-impl-plan.md) | Delivered | 10.2 |
| [task-graph-fleet-impl-plan](plans/2026-03-12-task-graph-fleet-impl-plan.md) | Delivered | 10.3 |
| [intelligence-layer-impl-plan](plans/2026-03-12-intelligence-layer-impl-plan.md) | Delivered | 10.5 |
| [agent-detail-ux-redesign](plans/2026-03-12-agent-detail-ux-redesign.md) | Delivered | 11.1-11.7 |
| [dev-environment-cd-strategy](plans/2026-03-12-dev-environment-cd-strategy.md) | Delivered — PR #445 closed the deferred web `WEB_PORT` package-script gap; PR #482 added the dry-run-first dev-1/dev-2 database/role provisioning helper while keeping actual provisioning as a user/admin step; PR #500 added `env-up.sh --dry-run` preflight output with redacted DB/Redis targets and no PM2/flock/DB side effects | 12.0-12.5 |
| [deployment-page-design](superpowers/specs/2026-03-13-deployment-page-design.md) | Delivered (PR #144); PR #453 added beta gate clarity copy/tests without changing promotion behavior | 12.7 |
| [deployment-page](superpowers/plans/2026-03-13-deployment-page.md) | Delivered (PR #144); PR #453 added beta gate clarity copy/tests without changing promotion behavior | 12.7 |
| [mcp-skill-discovery-design](superpowers/specs/2026-03-14-mcp-skill-discovery-design.md) | Delivered (PRs #146-153) | 14.1-14.6 |
| [mcp-skill-discovery](superpowers/plans/2026-03-14-mcp-skill-discovery.md) | Delivered (PRs #146-153) | 14.1-14.6 |
| [runtime-selector-penetration-design](superpowers/specs/2026-03-14-runtime-selector-penetration-design.md) | Delivered (PRs #148, #150) | 15.1 |
| [runtime-selector-penetration](superpowers/plans/2026-03-14-runtime-selector-penetration.md) | Delivered (PRs #148, #150) | 15.1 |
| [codex-config-capabilities-design](superpowers/specs/2026-03-14-codex-config-capabilities-design.md) | Delivered (PR #156) | 15.2 |
| [codex-config-capabilities](superpowers/plans/2026-03-14-codex-config-capabilities.md) | Delivered (PR #156) | 15.2 |
| [config-preview-sidebar-design](superpowers/specs/2026-03-15-config-preview-sidebar-design.md) | Delivered (PR #163) | 16.4 |
| [config-preview-sidebar](superpowers/plans/2026-03-15-config-preview-sidebar.md) | Delivered (PR #163) | 16.4 |
| [agent-coordination-board-design](plans/2026-03-15-agent-coordination-board-design.md) | Delivered (PRs #193, #201) | 16.1 |
| [agent-coordination-board-impl-plan](plans/2026-03-15-agent-coordination-board-impl-plan.md) | Delivered (PRs #193, #201) | 16.1 |
| [main-stability-and-security-cycle-plan](plans/2026-03-15-main-stability-and-security-cycle-plan.md) | Delivered on historical scope; PR #385 and PRs #386-#388 closed the 2026-04-01 CI/security follow-up, PRs #398/#400/#401/#402 closed the 2026-04-13 dependency-audit + DAST WebSocket fuzz follow-up on `main`, PR #404 reconciled roadmap/plan state after merge, PRs #410/#413 plus formal dismissal closed CodeQL #579, PRs #411/#414 repaired web test infrastructure, PR #415 added `/memory/reports` Playwright depth, PR #416 surfaced security findings in Logs, PR #418/#422 covered NotificationBell approval-popover e2e depth and aria-label drift, PR #419 reconciled plan status drift, PR #420 cleared the residual web unit failures, PR #423 added OAuth PKCE route rate limiting, PR #426 tightened web accessibility labels/titles, PR #427 added accounts route rate limiting, PR #429 covered account verification rate limiting, PR #431 added mesh peers Playwright coverage, PR #439 closed the route-rate-limit audit, PR #440 cleaned up CI/security scan annotations, PR #443 added Zod input bounds to three write surfaces, PR #445 moved the webhooks Playwright slice into CI, PR #447 added mobile-push validation negative coverage, PR #448 tightened six control-plane input surfaces, PR #452 hardened sync-peer URL/SSRF validation, PR #454 covered `/logs` Security Findings, PR #455 covered `/memory/browser` facts flow, PR #467 added webhook delivery-history UI coverage, PRs #470-#478 closed the latest memory/tasks/webhook/push-device feature and browser-coverage batch, PR #479 removed stale worker discovery type stubs, PR #481 split the web API client into domain modules, PR #483 completed the mesh peers Add/Delete browser slice, PR #486 added memory-browser provenance filters, PR #487 added task auto-decompose apply-failure coverage, PR #488 added webhook delivery-list retry coverage, PRs #489-#493 synced earlier roadmap status, PR #492 added agent detail browser coverage, PR #494 added agents index browser coverage, PR #495 added agent settings browser coverage, PR #496 fixed dev-tier startup portability, PR #497 hardened routing payload bounds, PR #499 added machines browser coverage, PR #498 shipped the agent-profiles web UI, PR #500 added env-up dry-run safety, PR #501 raised Web E2E timeout headroom, PRs #508-#513 closed the Docker SARIF/Node24/Node20-compat plus audit E2E follow-up loop, PR #515 replaced the retired `pnpm audit` endpoint path with the repo npm bulk-advisory audit script, PR #517 shipped the scheduler jobs page, PR #518 gated the agents-list Playwright slice in focused CI with a shared build preflight, PR #520 modernized Docker publish Grype SARIF output, PR #522 removed duplicate cache-save annotations, PR #523 moved Docker publish/audit/DAST Docker actions onto Node24 majors, PR #524 synced the checkpoint, PR #525 expanded sidebar keyboard access with grouped Settings docs, PR #526/#527 synced roadmap/plan records after that landing, PR #529 added `/sessions/[id]` route smoke coverage, PR #528 added `/memory/dashboard` route smoke coverage, and PR #530 synced the row-level roadmap ledger, PR #532 added client-side URL-length validation with inline feedback to the webhooks and sync-peers create dialogs (mirroring the backend `MAX_WEBHOOK_URL_LENGTH`/`MAX_SYNC_URL_LENGTH` 2048-char Zod bounds), PR #533 added backend-independent `/scheduler` browser coverage for the jobs page shipped in PR #517, PR #536 removed the non-functional Edit button from Consolidation Board cards and narrowed the ConsolidationAction type to accept/skip/delete, PR #537 fixed agent-worker discovery of in-flight Codex sessions, and PR #538 added aria-expanded/aria-label to the approvals session group expander, PR #540 wrapped the `/logs` and `/settings` page shells in `ErrorBoundary` to match the rest of the web app shell, PR #541 synced the roadmap/plan records after the ErrorBoundary landing, and PR #542 added an inline "Add managed credential" CTA to the `/settings` Accounts empty state and linked the credential input to its hint/warning via `aria-describedby`/`aria-invalid` with the warning marked `role="alert"` | 16.1-16.3 |
| [mesh-runtime-e2e-follow-up-plan](plans/2026-04-01-mesh-runtime-e2e-follow-up-plan.md) | Delivered — PR #395 (session `Config` tab detail-state coverage) + PR #396 (`/conflicts` resolution-flow coverage) both merged 2026-04-13; PR #397 synced the tracking doc; PR #431 extended coverage to `/mesh-peers` render/empty/ping states; PR #483 added `/mesh-peers` create/delete/validation coverage | 16.1, 31.3, 33.3, 33.4 |
| [coverage-feature-depth-batch-plan](plans/2026-03-19-coverage-feature-depth-batch-plan.md) | Delivered — §20.1-20.8 shipped on `main`; later §20.5 browser-depth follow-ups added `/logs` Security Findings coverage in PR #454, `/memory/browser` facts-flow coverage in PR #455, `/memory/import` wizard completion/cancellation coverage in PR #457, backend-independent `/settings` notification preference coverage in PR #458, `/discover` grouped/filter/import/new-session coverage in PR #459, `/memory` index coverage in PR #461, `/memory/consolidation` coverage in PR #462, `/memory/scopes` coverage in PR #465, `/memory/graph` coverage in PR #466, `/spaces/[id]` + `/tasks/[id]` detail coverage in PR #468, `/memory/synthesis` plus webhook-delivery plus push-device coverage in PR #475, `/memory/maintenance` plus auto-decompose coverage in PR #478, `/memory/browser` provenance-filter coverage in PR #486, task auto-decompose apply-failure coverage in PR #487, the §20.9 webhook delivery retry follow-up in PR #488, backend-independent `/agents/[id]` detail/start coverage in PR #492, backend-independent `/agents` list/create/start coverage in PR #494 with CI gating in PR #518, backend-independent `/agents/[id]/settings` coverage in PR #495, backend-independent `/machines` list/detail coverage in PR #499 with CI gating in PR #516, backend-independent `/agent-profiles` coverage in PR #505, dedicated `/audit` unit coverage in PR #507, backend-independent `/audit` Playwright coverage in PR #513, scheduler jobs page unit coverage in PR #517, backend-independent `/sessions/[id]` route smoke coverage in PR #529, and backend-independent `/memory/dashboard` route smoke coverage in PR #528 | 20.1-20.9 |
| [task-auto-decompose-apply-failure-e2e-plan](plans/2026-04-14-task-auto-decompose-apply-failure-e2e-plan.md) | Delivered — PR #487 added the focused `/tasks/[id]` browser regression for `POST /api/decompose` apply failures after a valid preview | 10.5, 20.5 |
| [webhook-deliveries-retry-e2e-plan](plans/2026-04-14-webhook-deliveries-retry-e2e-plan.md) | Delivered — PR #488 added backend-independent `/webhooks` delivery-list GET error and manual Retry recovery coverage | 16.1, 20.5, 20.9 |
| [agent-detail-e2e-plan](plans/2026-04-14-agent-detail-e2e-plan.md) | Delivered in PR #492 — backend-independent `/agents/[id]` route coverage for metadata/config/cost/session/memory/run-history render plus start-run prompt wiring | 20.5 |
| [agents-list-e2e-plan](plans/2026-04-14-agents-list-e2e-plan.md) | Delivered in PR #494 with CI-gating follow-up in PR #518 — backend-independent `/agents` index coverage for list/search/status filters, start prompt wiring, create-from-scratch payload capture, and focused e2e cold-CI shared build preflight | 20.5 |
| [agent-settings-e2e-plan](plans/2026-04-14-agent-settings-e2e-plan.md) | Delivered in PR #495 — backend-independent `/agents/[id]/settings` coverage for General, Model & Prompts, Runtime Config, and config-preview flows | 20.5 |
| [machines-e2e-plan](plans/2026-04-14-machines-e2e-plan.md) | Delivered in PR #499 with CI-gating follow-up in PR #516 — backend-independent `/machines` list/detail coverage for fleet status, filters, capability/runtime cards, memory stats, agents/sessions, and worker-node matching | 20.5 |
| [agent-profiles-web-plan](plans/2026-04-14-agent-profiles-web-plan.md) | Delivered in PR #498 with Playwright follow-up in PR #505 and edit follow-up in PR #506 — `/agent-profiles` CRUD page, sidebar entry, API-client module, unit coverage, CI-safe runtime constants, backend-independent render/create/delete/error browser coverage, and PATCH-backed editing | 10.2, 20.5 |
| [audit-trail-page-plan](plans/2026-04-14-audit-trail-page-plan.md) | Delivered in PR #507 with browser-depth follow-up in PR #513 — dedicated `/audit` page, sidebar entry, audit summary/action-list surface, filters/pagination, focused mocked-query unit coverage, and backend-independent Playwright coverage in the web E2E CI lane | 6.5, 20.5 |
| [scheduler-jobs-page-plan](plans/2026-04-15-scheduler-jobs-page-plan.md) | Delivered in PR #517 — `/scheduler` jobs page, sidebar entry, scheduler API client, not-configured/create/delete states, and focused unit coverage | 2.1, 20.5 |
| [mobile-approval-center-design](plans/2026-03-19-mobile-approval-center-design.md) | Delivered — 21.1 shipped; 21.2 now has dedicated push-notification design docs | 17.4, 21.1 |
| [mobile-approval-center-impl-plan](plans/2026-03-19-mobile-approval-center-impl-plan.md) | Delivered — 21.1 shipped; 21.2 now tracks execution in the dedicated push-notification impl plan | 21.1 |
| [approval-push-notifications-design](plans/2026-03-19-approval-push-notifications-design.md) | Delivered — PRs #290, #291, and #295 shipped the full 21.2 slice on `main` | 21.2 |
| [approval-push-notifications-impl-plan](plans/2026-03-19-approval-push-notifications-impl-plan.md) | Delivered — PRs #290, #291, and #295 completed mobile registration, device registry, Expo dispatch, and tap routing; PR #447 added validation hardening coverage for the registry route; PR #471 added the operator-facing Registered Push Devices UI; PR #475 added backend-independent registration/list/revoke browser coverage | 21.2 |
| [post-21-2-e2e-cd-hardening-plan](plans/2026-03-20-post-21-2-e2e-cd-hardening-plan.md) | Delivered — PRs #299, #297, #298, and #301 completed workstreams A-D on `main` | 24.1-24.4 |
| [web-hardening-follow-through-plan](plans/2026-03-20-web-hardening-follow-through-plan.md) | Delivered — PRs #305, #304, and #306 completed the runtime sessions, settings control-center, and permission-request contract follow-through on `main`; the remaining machines / terminal coverage now lives in the dedicated section 29 follow-up | 25.1-25.3 |
| [machine-terminal-e2e-follow-up-plan](plans/2026-03-21-machine-terminal-e2e-follow-up-plan.md) | Delivered — PR #346 added the dedicated machine terminal Playwright coverage on `main`; no page-level hardening was required beyond the focused e2e spec | 29 |
| [promote-beta-cd-gate-reality-sync-design](plans/2026-03-21-promote-beta-cd-gate-reality-sync-design.md) | Delivered (PR #355) — workflow now fail-fast-gates on `BETA_SELF_HOSTED_RUNNER_READY`; §12.6 stays Partial until the self-hosted runner lands | 12.6 |
| [promote-beta-cd-gate-reality-sync-implementation-plan](plans/2026-03-21-promote-beta-cd-gate-reality-sync-implementation-plan.md) | Delivered (PR #355) — readiness gate, pre-approval host-verification job, and roadmap/setup doc sync shipped | 12.6 |
| [agent-worker-container-security-remediation-plan](plans/2026-03-20-agent-worker-container-security-remediation-plan.md) | Delivered — PRs #307, #314, #322, and #326 are on `main`; as of 2026-03-20 GitHub code scanning shows `0` open alerts and both worker Trivy categories upload `0`-result analyses on recent `main` commits (`cdd63b8`, `3e38d87`, `4c82efb`) | 26.1 |
| [worker-runtime-surface-reduction-plan](plans/2026-03-20-worker-runtime-surface-reduction-plan.md) | Delivered — PR #322 landed the git-capability hardening slice on `main`; post-#326 worker scans converged to `0` open alerts without removing `git` from the standard worker image | 26.2 |
| [terminal-takeover-gap-implementation-plan](plans/2026-03-20-terminal-takeover-gap-implementation-plan.md) | Delivered — PRs #340-#344 and #350 shipped the live managed-session terminal attach feature plus focused runtime-session attach e2e coverage on `main`; this plan now remains only as the implementation record | 27.3 |
| [codex-gui-thread-prompts](plans/2026-03-10-codex-gui-thread-prompts.md) | Reference | — |
| [roadmap-parallelization-handoff-plan](plans/2026-03-10-roadmap-parallelization-handoff-plan.md) | Reference | — |

### Knowledge Engineering
- [Agent 知识工程实践 (stonepage)](https://zhuanlan.zhihu.com/p/1898602837) — Knowledge types, layered loading, dreaming/synthesis, meta-cognition
