# Project Roadmap

> Last updated: 2026-03-10

## Current State

Full CI/CD pipeline with 9 workflow files:

- **CI** (`ci.yml`): paths-filter, matrix build/test, security scanning, coverage
- **Docker Build** (`build-images.yml`): multi-stage, Trivy, SBOM, GHCR
- **Security Audit** (`security-audit.yml`): CodeQL, Semgrep, gitleaks, license check
- **Deploy Dev** (`deploy-dev.yml`): Tailscale SSH, auto-deploy on push to dev
- **Deploy Prod** (`deploy-prod.yml`): approval gate, blue-green, pg_dump backup
- **Rollback** (`rollback.yml`): manual rollback to any previous image tag
- **Fleet Deploy** (`deploy-fleet.yml`): canary/rolling/all-at-once fleet deployment
- **Migration Check** (`migration-check.yml`): PR validation with throwaway PostgreSQL
- **Build Images** (`build-images.yml`): multi-stage Docker with Trivy + SBOM

**3902 tests** across 102 files. All packages build cleanly.

---

## Phase 1 — CI Hardening (Priority: Critical)

> Goal: Make CI faster, more reliable, and security-aware before adding CD.

### 1.1 Monorepo-Aware Conditional Builds

- [x] Add `dorny/paths-filter` to detect which packages changed
- [x] Only run build/test for affected packages on PRs
- [x] Full build on `main` merges for safety

### 1.2 Dependency Caching

- [x] Verify pnpm store caching via `setup-node`
- [x] Add TypeScript build cache (`tsconfig.tsBuildInfoFile`)
- [x] Add TypeScript build output cache (`packages/*/dist`)
- [ ] Target: CI < 2 minutes for unchanged packages

### 1.3 Security Scanning in CI

- [x] Add `pnpm audit` step for dependency vulnerabilities
- [x] Add `gitleaks` for secret scanning
- [x] Add Biome security lint rules

**Deliverable**: Updated `.github/workflows/ci.yml` ✅

---

## Phase 2 — Docker Image Build & Registry (Priority: Critical)

> Goal: Every merge to `main` produces a versioned, scannable, deployable image.

### 2.1 Multi-Stage Docker Build

- [x] Use `docker/build-push-action` with Buildx
- [x] Build `control-plane` and `agent-worker` in parallel (matrix)
- [x] Multi-stage: `node:22-alpine` build -> `node:22-alpine` prod (non-root uid 1001)

### 2.2 Image Tagging

- [x] `sha-<commit>` on every build
- [x] `main-latest` / `dev-latest` for environment tracking
- [x] Semver `v*.*.*` on GitHub Release

### 2.3 Container Security Scanning

- [x] `aquasecurity/trivy-action` — fail on CRITICAL/HIGH, SARIF to GitHub Security tab
- [x] `anchore/scan-action` (Grype) as second scanner
- [x] Generate SBOM with Trivy, upload as build artifact

### 2.4 Image Layer Caching

- [x] GHA cache backend (`cache-from: type=gha`)
- [ ] Target: Docker build < 3 minutes with warm cache

**Deliverable**: `.github/workflows/build-images.yml` ✅

---

## Phase 3 — Dev Environment Auto-Deploy (Priority: High)

> Goal: Merge to `dev` auto-deploys to dev environment via Tailscale.

### 3.1 Tailscale-Based Deployment

- [x] `tailscale/github-action` with ephemeral OAuth client
- [x] SSH into target via Tailscale IP (zero public ports)
- [x] Tailscale ACL: allow `tag:ci` to SSH into `tag:server`

### 3.2 Deploy Steps

- [x] Pull images from ghcr.io
- [x] Run Drizzle migrations before container restart
- [x] `docker compose up -d --remove-orphans`
- [x] Post-deploy health check (`/api/health` returns 200)
- [x] On failure: alert, keep old containers

### 3.3 Target Machine Setup

- [x] `deploy` user with limited permissions
- [x] Pre-install Docker, Compose, Tailscale
- [x] Store `docker-compose.prod.yml` + `.env` on target

### 3.4 GitHub Secrets

| Secret | Purpose |
|--------|---------|
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth for CI |
| `TS_OAUTH_SECRET` | Tailscale OAuth secret |
| `DEV_TAILSCALE_IP` | Dev machine IP (100.x.x.x) |
| `DEPLOY_SSH_KEY` | SSH private key for deploy user |
| `POSTGRES_PASSWORD` | PostgreSQL password |

**Deliverable**: `.github/workflows/deploy-dev.yml`

---

## Phase 4 — Database Migration Safety (Priority: High)

> Goal: Schema changes applied automatically, safely, and reversibly.

### 4.1 Migration in CI (PR Validation)

- [x] On PRs touching `drizzle/**`: run `drizzle-kit generate`, validate SQL
- [x] Spin up throwaway PostgreSQL (`services:`) and apply migration

### 4.2 Migration in CD (Deploy-Time)

- [x] Run migration in transaction before starting new containers (109 tests)
- [x] If migration fails: abort deploy, keep old containers, alert
- [x] Limited-privilege PostgreSQL user for migrations

### 4.3 Backup Before Migration

- [x] `pg_dump` before applying (timestamped artifact) (99 tests)
- [x] Retain last 7 backups
- [x] Destructive migrations (DROP) require manual approval

**Deliverable**: Migration scripts integrated into deploy workflows

---

## Phase 5 — Production Deploy with Approval Gate (Priority: Medium)

> Goal: Production deploys are manual, auditable, and rollback-ready.

### 5.1 Release-Based Trigger

- [x] GitHub Release or `workflow_dispatch` with image tag input
- [x] GitHub Environment protection rule: `production` with required reviewers

### 5.2 Blue-Green Deployment

- [x] Scale up new container -> health check -> scale down old
- [x] Health check retry loop (5 attempts, 10s interval)

### 5.3 Rollback

- [x] Keep last 5 image tags in ghcr.io (cleanup-images.yml)
- [x] `workflow_dispatch` rollback workflow (select previous tag)
- [x] Post-rollback health check

### 5.4 Smoke Tests

- [x] API health, PostgreSQL, Redis, WebSocket upgrade, cross-service registration

**Deliverable**: `.github/workflows/deploy-prod.yml`, `.github/workflows/rollback.yml`

---

## Phase 6 — Observability & Notifications (Priority: Medium)

> Goal: Know immediately when deploys succeed, fail, or degrade.

- [x] Slack/Discord webhook on deploy success/failure
- [x] Deploy audit trail (table or append-only log)
- [x] Vector -> ClickHouse pipeline for structured logs
- [x] Prometheus-compatible `/metrics` endpoint
- [x] Track: request latency, active agents, queue depth, error rate

**Deliverable**: Notification integration, `/metrics` endpoint, Vector config

---

## Phase 7 — Multi-Machine Fleet Deploy (Priority: Low, post-MVP)

> Goal: Deploy agent-worker to all machines in the Tailscale mesh.

- [x] Machine inventory file (`infra/machines.yml`)
- [x] Matrix deploy with canary strategy
- [x] Per-machine health verification
- [x] Staggered rollout: canary -> verify -> remaining
- [x] Integrate `scripts/setup-machine.sh` for new machine bootstrap

**Deliverable**: `.github/workflows/deploy-fleet.yml`, `infra/machines.yml` ✅

---

## Phase 8 — Scheduled Sessions & Continuous Loop (Priority: High, Core Feature)

> Goal: Allow sessions to run on cron schedules and in continuous loop mode.
> Design doc: [plans/2026-03-02-scheduled-sessions-and-loop-design.md](plans/2026-03-02-scheduled-sessions-and-loop-design.md)

### 8.1 Scheduled Sessions (Cron-like)

- [x] Add `ScheduleConfig` type (`sessionMode`, `promptTemplate`, `pattern`)
- [x] Extend `AgentTaskJobData` with `sessionMode: 'fresh' | 'resume'`
- [x] Session resume: look up `currentSessionId`, pass as `resumeSession`
- [x] Prompt template variables: `{{date}}`, `{{iteration}}`, `{{lastResult}}`
- [x] Add `schedule_config` jsonb column, API endpoints

### 8.2 Claude Code Remote Control Integration

> Key discovery (2026-02-24): Claude Code ships a built-in **Remote Control**
> feature that uses an outbound polling model to the Anthropic API relay.
> AgentCTL should leverage this instead of spawning Claude Code CLI as a
> subprocess via the Agent SDK. Benefits:
>
> - **No inbound ports** — the Claude Code instance polls outward, fitting
>   AgentCTL's Tailscale mesh without extra firewall rules
> - **Native mobile relay** — the same relay the iOS Claude app uses can be
>   reused by AgentCTL's React Native client
> - **Session persistence** — Remote Control sessions survive network blips;
>   no PID management or respawn logic needed
> - **First-class API** — tool calls, streaming output, and session lifecycle
>   are exposed as structured events on the relay

- [ ] Spike: replace Agent SDK subprocess wrapper with Remote Control relay client
- [ ] Update `agent-worker/src/runtime/` to connect via outbound polling
- [ ] Migrate hook system (PreToolUse/PostToolUse/Stop) to relay event filters
- [ ] Validate loop controller + scheduled sessions work over relay
- [ ] Remove `child_process.spawn` code path once relay path is stable
- [ ] Document latency/reliability comparison (subprocess vs relay)

### 8.3 Continuous Loop (Ralph Loop)

- [x] Add `LoopConfig` type and `AgentType: 'loop'`
- [x] Implement `LoopController` in agent-worker
  - Three modes: `result-feedback`, `fixed-prompt`, `callback`
  - Limits: `maxIterations`, `costLimitUsd`, `maxDurationMs`
  - Checkpoint to control plane every N iterations
- [x] DB columns: `loop_config`, `loop_iteration`, `parent_run_id`
- [x] API: `PUT/DEL /loop`, `POST /loop/stop`, `GET /loop/status`
- [x] SSE events: `loop_iteration`, `loop_checkpoint`, `loop_complete`

### 8.4 Safety & Limits

- [x] At least one limit required (iterations/cost/duration)
- [x] `iterationDelayMs >= 500` enforced server-side
- [x] Cost alert at 80% of limit
- [x] Dead-loop detection (3 identical results -> warn/stop)
- [x] Network partition: auto-pause if checkpoint fails 3x
- [x] Emergency stop via API + abort signal

**Deliverable**: `loop-controller.ts`, updated types, API routes, DB migration

---

## Phase 9 — Security Audit & Hardening (Priority: High)

> Goal: Systematic security audit aligned with OWASP Agentic Top 10 (2026). Deploy an independent agent to continuously audit the project.

### 9.1 OWASP Agentic Top 10 Compliance Checklist

Map every OWASP ASI risk to concrete mitigations in AgentCTL:

| OWASP Risk | AgentCTL Mitigation | Status |
|------------|---------------------|--------|
| **ASI01 — Agent Goal Hijack** | PreToolUse hook validates tool calls against task scope; prompt injection detection on external inputs | [x] |
| **ASI02 — Tool Misuse** | `allowedTools`/`disallowedTools` allowlist; PreToolUse denies undeclared tools; no wildcard permissions | [x] |
| **ASI03 — Identity & Privilege Abuse** | Per-agent identity (agentId + machineId); short-lived session tokens; no shared credentials; Tailscale ACLs per role | [x] |
| **ASI04 — Supply Chain** | `pnpm audit` in CI; Trivy + Grype scanning; SBOM; pinned deps; MCP server verification | [x] |
| **ASI05 — Code Execution** | Claude Code sandbox (bubblewrap/Seatbelt); `--cap-drop=ALL`; `--network=none`; gVisor option | [x] |
| **ASI06 — Memory Poisoning** | Validate data before Mem0 storage; per-agent memory isolation; TTL + size limits; integrity checks | [x] |
| **ASI07 — Inter-Agent Comms** | TweetNaCl E2E encryption; signed payloads; Tailscale WireGuard transport | [x] |
| **ASI08 — Cascading Failures** | Per-agent timeout; circuit breaker on dispatch; BullMQ retry with backoff; loop checkpoints | [x] |
| **ASI09 — Trust Exploitation** | Approval gates for destructive ops; cost alerts at 80%; mandatory human review for prod; dead-loop detection | [x] |
| **ASI10 — Rogue Agents** | Audit logging with SHA-256; anomaly detection on tool patterns; kill switch; valid status transitions | [x] |

### 9.2 Automated Security Pipeline (SAST + DAST + SCA)

Dedicated security workflow on every PR and nightly:

- [x] **SAST — CodeQL**: GitHub native with `security-extended` queries for JS/TS
- [x] **SAST — Semgrep**: `semgrep/semgrep-action` with `p/security-audit` + `p/secrets`
- [x] **SCA — Dependency Audit**: `pnpm audit --audit-level=high` as blocking CI step
- [x] **SCA — License Check**: no GPL/AGPL dependencies
- [x] **Secret Scanning**: `gitleaks` on every PR; GitHub push protection
- [x] **Container Scanning**: Trivy + Grype with SARIF to Security tab
- [x] **DAST — OWASP ZAP**: baseline scan on `/api/*` + WebSocket fuzzing on `/ws` (post-deploy to staging)

**Deliverable**: `.github/workflows/security-audit.yml`

### 9.3 Independent Security Audit Agent

A dedicated Claude Code agent that continuously audits the AgentCTL codebase:

- [x] **Agent config**: read-only access, `allowedTools: ['Read', 'Glob', 'Grep']` only (61 tests)
- [x] **Schedule**: nightly cron via BullMQ (uses Phase 8 cron feature) (106 tests)
- [x] **Prompt template**: structured security review covering:
  - Input validation on all API routes (SQLi, command injection, XSS)
  - Secrets leakage in code, config, logs, git history
  - Container security (Dockerfile, compose hardening)
  - Auth/authz gaps in API endpoints
  - Dependency vulnerabilities and outdated packages
  - OWASP Agentic Top 10 compliance gaps
- [x] **Output**: structured JSON report (severity, file, line, description, recommendation)
- [x] **Integration**: results posted to control plane; high-severity -> auto-create GitHub Issues (60 tests)
- [x] **Guardrails**: audit agent itself runs sandboxed (read-only FS, no network egress, restricted tools)

### 9.4 Runtime Security Controls

- [x] **Agent identity**: unique short-lived tokens per session (not shared machine keys)
- [x] **Network egress**: `--network=none` default; allowlist specific domains per agent (70 tests)
- [x] **FS isolation**: worktrees read-only except output dirs; block `.ssh`, `.gnupg`, `.aws`, `.env` (111 tests)
- [x] **Memory security**: content validation, PII redaction, agent namespace isolation (67 tests)
- [x] **Tool rate limiting**: cap tool calls/minute/agent to detect runaway loops
- [x] **Prompt injection defense**:
  - Sanitize external content before agent context injection
  - Flag patterns: `ignore previous instructions`, `system:`, encoded payloads
  - Guardian agent: lightweight validator reviews high-risk tool calls pre-execution
- [x] **Kill switch**: `POST /api/agents/:id/emergency-stop` — abort + revoke token
- [x] **Anomaly detection**: baseline tool-call patterns; alert on deviations (e.g., agent using Bash after only Read/Write)

### 9.5 Audit Logging & Forensics

- [x] Structured NDJSON with SHA-256 integrity hashes (extends existing `AuditLogger`)
- [x] Log retention: configurable per-table retention with batch cleanup (78 tests)
- [x] Tamper detection: hash chain (each entry includes previous hash)
- [x] Queryable API: `GET /api/audit?agentId=X&from=T1&to=T2&tool=Bash`
- [x] Dashboard: top tools, cost by agent, error rates, blocked calls
- [x] Incident response: full session replay from audit logs

### 9.6 Threat Model & Compliance

- [x] Document AgentCTL-specific threat model (multi-machine, multi-agent, mobile control surface)
- [x] Map controls to OWASP Agentic Top 10, NIST AI RMF, Anthropic safety guidelines
- [x] Security runbook: incident procedures for rogue agent, credential leak, prompt injection
- [ ] Quarterly review cadence for security controls

**Deliverable**: Security audit workflow, audit agent config, runtime hardening, threat model document

---

## Phase 10 — Codex CLI Integration & Cross-Agent Session Handoff (Priority: Medium)

> Goal: Support OpenAI Codex CLI as a first-class agent type alongside Claude
> Code, enable seamless session handoff between agent types, and surface all
> sessions in a unified iOS browser.

### 10.1 Codex CLI Integration

Use the same Remote Control relay pattern proven with Claude Code (Phase 8.2)
to orchestrate Codex CLI instances across the fleet:

- [x] Add managed runtime support for `codex` in shared contracts and worker/control-plane APIs
- [x] Implement `CodexRuntimeAdapter` and `CodexSessionManager` in `agent-worker/src/runtime/`
  - Supports create via `codex exec --json`
  - Supports resume via `codex exec resume ... --json`
  - Supports same-runtime fork via `codex fork`
- [x] Add runtime-aware worker and control-plane session routes
  - `GET|POST /api/runtime-sessions`
  - `POST /api/runtime-sessions/:id/resume`
  - `POST /api/runtime-sessions/:id/fork`
- [ ] Add Codex model routing to LiteLLM config (`infra/litellm/`)
  - Provider failover: OpenAI Direct -> Azure OpenAI
  - Cost tracking parity with Claude models
- [ ] Extend PM2 ecosystem config to manage Codex worker processes
- [x] Registry: managed Codex sessions use the same machine registry and worker URL resolution path
- [ ] Security: apply identical sandbox constraints (bubblewrap/Seatbelt, `--cap-drop=ALL`, `--network=none`)

### 10.2 Cross-Agent Session Handoff (Claude Code <-> Codex)

Enable seamless mid-task switching between agent types without losing context:

- [x] Define `SessionHandoff` protocol in `packages/shared/src/protocol/`
  - Portable session snapshot includes worktree path, git branch/SHA, dirty files, diff summary, conversation summary, active MCP/skills, and handoff reason
  - Handoff reason enum includes `'model-affinity'`, `'cost-optimization'`, `'rate-limit-failover'`, and `'manual'`
- [x] Implement `HandoffController` in agent-worker
  - Export portable snapshots from the source runtime
  - Hydrate incoming runtime from the snapshot preamble
  - Preserve the existing project/worktree path through the handoff
- [x] Control plane API:
  - `POST /api/runtime-sessions/:id/handoff` — initiate runtime handoff to a target runtime
- [x] Experimental native import scaffolding
  - Probe native import first when enabled
  - Fall back automatically to `snapshot-handoff`
  - Audit every failed native import attempt separately
- [ ] Handoff history API:
  - `GET /api/runs/:id/handoff-history` or equivalent unified session history view
- [ ] Automatic handoff triggers:
  - Rate limit hit on current provider -> failover to other agent type
  - Cost threshold -> switch to cheaper model/provider
  - Task-type affinity rules (e.g., prefer Codex for Python-heavy tasks)
- [ ] Memory continuity: Mem0 context shared across agent types within a single run
- [x] Audit: backend stores every handoff plus native import attempt metadata

### 10.3 Unified Session Browser (Web + iOS)

> Design doc: [plans/2026-03-10-unified-sessions-ui-design.md](plans/2026-03-10-unified-sessions-ui-design.md)

Surface all sessions through one primary browser, starting with the web app and then aligning mobile:

#### Web consolidation

- [ ] Consolidate `/sessions` and `/runtime-sessions` into one canonical `/sessions` browser
- [ ] Default `/sessions` to `All` with `Agent` and `Runtime` type filters
- [ ] Reuse the existing `SessionsPage` shell and embed runtime-specific handoff/native-import actions as type-specific detail UI
- [ ] Redirect `/runtime-sessions` to `/sessions?type=runtime` after the unified browser is stable
- [ ] Collapse dashboard/sidebar/command-palette session navigation onto the unified route

#### Mobile

Surface all agent sessions — regardless of agent type — in one mobile view:

- [ ] New `SessionBrowser` screen in `packages/mobile/src/screens/`
  - Filterable by: agent type (Claude Code / Codex), machine, status, time range
  - Session cards show: agent type badge, model used, cost, duration, last tool call
  - Tap to view live SSE stream or completed session replay
- [ ] Cross-agent run view: for runs with handoffs, show timeline of agent switches
  - Visual handoff markers with reason and context-transfer summary
  - Expandable diff of what each agent contributed
- [ ] Session actions from mobile:
  - Pause / resume / stop any session
  - Trigger manual handoff to different agent type
  - Fork session (create new branch from session state)
- [ ] Push notifications for handoff events (agent switched, handoff failed, awaiting approval)

**Deliverable status**

- Backend runtime management, managed session schema, Codex session lifecycle,
  snapshot handoff, and native import scaffolding are implemented
- Unified mobile/web session browser and automatic handoff policy are still open

---

## Phase 11 — Runtime Hardening & Observability Patterns (Priority: High)

> Goal: Adopt battle-tested patterns from [astro-agent](https://github.com/astro-anywhere/astro-agent)
> to harden execution safety, improve observability, and prepare the adapter layer for multi-runtime support.
> Design doc: [plans/2026-03-10-astro-agent-patterns-design.md](plans/2026-03-10-astro-agent-patterns-design.md)

### 11.1 Structured Execution Summary (P0)

Automatically generate a structured summary at task completion by resuming the same
session with a summary prompt. Stores as JSONB in `agent_runs.result_summary`.

- [ ] Define `ExecutionSummary` type in `packages/shared/src/types/`
  - Fields: status, workCompleted, executiveSummary, keyFindings, filesChanged, followUps, cost, tokens
- [ ] Implement summary generation in `AgentInstance.stop()` (session-resume approach)
- [ ] Fallback: post-hoc aggregation from PostToolUse hook data + git diff
- [ ] DB migration: `agent_runs.result_summary` TEXT → JSONB
- [ ] New SSE event: `execution_summary`
- [ ] API: `GET /api/runs/:id/summary` returns structured data
- [ ] Mobile/web: summary card at end of session view

### 11.2 Workdir Safety Tiers (P0)

Pre-execution safety check classifying working directories into 4 tiers:
safe (git clean) → guarded (git dirty) → risky (non-git) → unsafe (non-git + parallel).

- [ ] Implement `checkWorkdirSafety()` in `agent-worker/src/runtime/workdir-safety.ts`
- [ ] Gate in `AgentInstance.start()` before `attemptSdkRun()`
- [ ] SSE events: `safety_warning`, `safety_approval_needed`, `safety_blocked`
- [ ] Sandbox mode: copy-to-temp + execute + copy-back for approved risky directories
- [ ] API: `POST /api/agents/:id/safety-decision` (approve/reject/sandbox)
- [ ] Mobile/web: safety prompt UI (reuses existing approval flow pattern)

### 11.3 Dispatch Signature Verification (P0)

Ed25519 signing of dispatch payloads for defense-in-depth over Tailscale.

- [ ] Control plane: sign dispatch payloads with Ed25519 (TweetNaCl)
- [ ] Public key distributed to workers during machine registration
- [ ] Worker: verify signature before task execution, reject invalid payloads
- [ ] Audit: log signature verification failures

### 11.4 AgentOutputStream — Unified Output Streaming (P1)

Shared output contract between runtime adapters and event pipeline. Foundation for
multi-runtime support (bridges to Phase 10 Codex integration).

- [ ] Define `AgentOutputStream` interface in `packages/shared/src/protocol/`
  - Methods: text, thinking, toolUse, toolResult, fileChange, sessionInit, costUpdate, error
- [ ] Refactor `sdk-runner.ts` to emit through `AgentOutputStream`
- [ ] `AgentInstance` creates stream impl backed by EventEmitter + OutputBuffer
- [ ] Runtime unification adapters (`ClaudeRuntimeAdapter`, `CodexRuntimeAdapter`) use same interface

### 11.5 Mid-Execution Steering (P1)

Inject guidance into running agent sessions via Claude Agent SDK `streamInput()`.

- [ ] Expose `steer(message)` on `AgentInstance` (delegates to SDK Query.streamInput)
- [ ] Worker API: `POST /api/agents/:agentId/steer`
- [ ] Control plane proxy: `POST /api/agents/:agentId/steer` → forward to worker
- [ ] SSE events: `steer_sent`, `steer_ack`
- [ ] Mobile/web: chat-like input at bottom of live session view
- [ ] Codex steering deferred until CodexRuntimeAdapter lands

### 11.6 Execution Environment Registry (P2)

Orthogonal abstraction for WHERE tasks execute (local/Docker/SSH), separate from
WHAT agent runs them (Claude/Codex).

- [ ] Define `ExecutionEnvironment` interface in `agent-worker/src/execution/`
  - Methods: detect, prepare, cleanup
- [ ] `DirectEnvironment`: wraps current subprocess behavior
- [ ] `DockerEnvironment`: wraps existing Dockerfile patterns with gVisor
- [ ] `ExecutionEnvironmentRegistry`: auto-detect at startup, report in heartbeat
- [ ] Machine registration includes available environments + runtime adapters
- [ ] Control plane: dispatch routing considers environment requirements

**Deliverable**: Execution summary, safety tiers, dispatch signing, output stream, steering, environment registry

---

## Target Workflow Summary

```
PR:              CI (lint + test) -> Docker build -> security scan (CodeQL + Semgrep + Trivy)
merge -> dev:    CI -> Docker build -> push ghcr.io:dev-latest -> deploy dev -> health check -> ZAP scan
merge -> main:   CI -> Docker build -> push ghcr.io:main-latest -> (ready for release)
GitHub Release:  push ghcr.io:v*.*.* -> approval gate -> DB backup + migrate -> deploy prod -> smoke test
rollback:        workflow_dispatch -> select previous tag -> deploy -> health check
fleet deploy:    canary -> verify -> matrix deploy remaining -> per-machine health check
nightly:         security audit agent -> structured report -> auto-create issues for high-severity
handoff:         rate limit / cost threshold / manual -> serialize context -> hydrate target agent -> resume
codex session:   same relay pattern as Claude Code -> outbound poll -> SSE stream -> iOS unified browser
task complete:   execution summary (session resume) -> JSONB storage -> summary card in mobile/web
steer:           mobile chat input -> control plane proxy -> worker steer -> SDK streamInput -> steer ack
safety check:    workdir classify (4 tiers) -> SSE safety event -> user approve/reject/sandbox -> execute
runtime mgmt:    canonical config sync -> managed sessions -> native import preflight -> snapshot fallback
```

## Timeline & Dependencies

| Phase | Dependency | Notes |
|-------|-----------|-------|
| Phase 1 — CI Hardening | None | Start immediately |
| Phase 2 — Docker Build | None | Parallel with Phase 1 |
| Phase 3 — Dev Deploy | Phase 2 + Tailscale ACL | Need target machine |
| Phase 4 — DB Migration | Phase 3 | Integrate into deploy |
| Phase 5 — Prod Deploy | Phase 3 + 4 | After dev deploy stable |
| Phase 6 — Observability | Phase 5 | After prod deploy exists |
| Phase 7 — Fleet Deploy | Phase 5 | Post-MVP |
| Phase 8 — Sessions & Loop | Phase 4 (DB) | Types/API can start with Phase 1-2; 8.2 (Remote Control) unlocks Phase 10 |
| Phase 9 — Security Audit | Phase 2 (scan) + Phase 3 (DAST) + Phase 8 (audit agent) | SAST/SCA start with Phase 1 |
| Phase 10 — Codex & Handoff | Phase 8.2 (Remote Control) + Phase 7 (Fleet) + Phase 11.4 (output stream) | Codex runtime mirrors Claude relay pattern; handoff needs fleet routing; adapter uses AgentOutputStream |
| Phase 11 — Runtime Hardening | Phase 8 (runtime) + Phase 9 (security) | 11.1-11.3 start immediately; 11.4-11.5 after Phase 8; 11.6 after Phase 10 |

## References

### CI/CD
- [GitHub Actions Monorepo CI/CD Guide (2026)](https://dev.to/pockit_tools/github-actions-in-2026-the-complete-guide-to-monorepo-cicd-and-self-hosted-runners-1jop)
- [Docker Compose + Tailscale Deployment](https://aaronstannard.com/docker-compose-tailscale/)
- [Tailscale GitHub Action](https://tailscale.com/kb/1276/tailscale-github-action)
- [Trivy Container Scanning](https://github.com/aquasecurity/trivy-action)
- [Grype/Anchore Scan](https://github.com/anchore/scan-action)
- [CI/CD for Node.js (Red Hat)](https://developers.redhat.com/articles/2023/11/01/cicd-best-practices-nodejs)
- [DB Migration CI/CD](https://www.bytebase.com/blog/how-to-build-cicd-pipeline-for-database-schema-migration/)
- [Drizzle ORM Migrations](https://orm.drizzle.team/docs/migrations)

### Agent Runtime & Remote Control
- [Claude Code Remote Control (Feb 2026)](https://docs.anthropic.com/en/docs/claude-code/remote-control) — Outbound polling relay; replaces subprocess spawning
- [Claude Agent SDK](https://github.com/anthropic/claude-agent-sdk) — TypeScript SDK wrapping Claude Code CLI
- [OpenAI Codex CLI](https://github.com/openai/codex) — Terminal-native coding agent

### Runtime Patterns
- [Astro Agent Runner](https://github.com/astro-anywhere/astro-agent) — Provider adapters, execution strategies, workdir safety, dispatch signing
- [Astro Agent Patterns Design](plans/2026-03-10-astro-agent-patterns-design.md) — Evaluation and adoption plan

### Security
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
- [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
- [AWS Agentic AI Security Scoping Matrix](https://aws.amazon.com/blogs/security/the-agentic-ai-security-scoping-matrix-a-framework-for-securing-autonomous-ai-systems/)
- [NVIDIA Sandboxing Agentic Workflows](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk/)
- [Security Patterns for Autonomous Agents (Pentagi)](https://www.sitepoint.com/security-patterns-for-autonomous-agents-lessons-from-pentagi/)
- [AI Agent Security Best Practices 2026](https://aiagentskit.com/blog/ai-agent-security-best-practices/)
- [Glean AI Agent Security](https://www.glean.com/perspectives/best-practices-for-ai-agent-security-in-2025)
- [OpenAI Prompt Injections](https://openai.com/index/prompt-injections/)
- [Google ADK Safety](https://google.github.io/adk-docs/safety/)
- [GitHub Actions Security Scanning](https://oneuptime.com/blog/post/2025-12-20-github-actions-container-scanning/view)
- [SBOM Automation](https://medium.com/@bhpuri/github-actions-series-41-github-actions-for-software-supply-chain-security-and-sbom-18ff7f998a49)
