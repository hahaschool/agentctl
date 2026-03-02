# Project Roadmap

> Last updated: 2026-03-02

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

**1984 tests** across 77 files. All packages build cleanly.

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
- [ ] `anchore/scan-action` (Grype) as second scanner
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

- [ ] `deploy` user with limited permissions
- [ ] Pre-install Docker, Compose, Tailscale
- [ ] Store `docker-compose.prod.yml` + `.env` on target

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

- [ ] On PRs touching `drizzle/**`: run `drizzle-kit generate`, validate SQL
- [ ] Spin up throwaway PostgreSQL (`services:`) and apply migration

### 4.2 Migration in CD (Deploy-Time)

- [ ] Run migration in transaction before starting new containers
- [ ] If migration fails: abort deploy, keep old containers, alert
- [ ] Limited-privilege PostgreSQL user for migrations

### 4.3 Backup Before Migration

- [ ] `pg_dump` before applying (timestamped artifact)
- [ ] Retain last 7 backups
- [ ] Destructive migrations (DROP) require manual approval

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

- [ ] Keep last 5 image tags in ghcr.io
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
- [ ] Integrate `scripts/setup-machine.sh` for new machine bootstrap

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

### 8.2 Continuous Loop (Ralph Loop)

- [x] Add `LoopConfig` type and `AgentType: 'loop'`
- [x] Implement `LoopController` in agent-worker
  - Three modes: `result-feedback`, `fixed-prompt`, `callback`
  - Limits: `maxIterations`, `costLimitUsd`, `maxDurationMs`
  - Checkpoint to control plane every N iterations
- [x] DB columns: `loop_config`, `loop_iteration`, `parent_run_id`
- [x] API: `PUT/DEL /loop`, `POST /loop/stop`, `GET /loop/status`
- [x] SSE events: `loop_iteration`, `loop_checkpoint`, `loop_complete`

### 8.3 Safety & Limits

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
| **ASI01 — Agent Goal Hijack** | PreToolUse hook validates tool calls against task scope; prompt injection detection on external inputs | [ ] |
| **ASI02 — Tool Misuse** | `allowedTools`/`disallowedTools` allowlist; PreToolUse denies undeclared tools; no wildcard permissions | [ ] |
| **ASI03 — Identity & Privilege Abuse** | Per-agent identity (agentId + machineId); short-lived session tokens; no shared credentials; Tailscale ACLs per role | [ ] |
| **ASI04 — Supply Chain** | `pnpm audit` in CI; Trivy + Grype scanning; SBOM; pinned deps; MCP server verification | [ ] |
| **ASI05 — Code Execution** | Claude Code sandbox (bubblewrap/Seatbelt); `--cap-drop=ALL`; `--network=none`; gVisor option | [ ] |
| **ASI06 — Memory Poisoning** | Validate data before Mem0 storage; per-agent memory isolation; TTL + size limits; integrity checks | [ ] |
| **ASI07 — Inter-Agent Comms** | TweetNaCl E2E encryption; signed payloads; Tailscale WireGuard transport | [ ] |
| **ASI08 — Cascading Failures** | Per-agent timeout; circuit breaker on dispatch; BullMQ retry with backoff; loop checkpoints | [ ] |
| **ASI09 — Trust Exploitation** | Approval gates for destructive ops; cost alerts at 80%; mandatory human review for prod; dead-loop detection | [ ] |
| **ASI10 — Rogue Agents** | Audit logging with SHA-256; anomaly detection on tool patterns; kill switch; valid status transitions | [ ] |

### 9.2 Automated Security Pipeline (SAST + DAST + SCA)

Dedicated security workflow on every PR and nightly:

- [x] **SAST — CodeQL**: GitHub native with `security-extended` queries for JS/TS
- [x] **SAST — Semgrep**: `semgrep/semgrep-action` with `p/security-audit` + `p/secrets`
- [x] **SCA — Dependency Audit**: `pnpm audit --audit-level=high` as blocking CI step
- [x] **SCA — License Check**: no GPL/AGPL dependencies
- [x] **Secret Scanning**: `gitleaks` on every PR; GitHub push protection
- [x] **Container Scanning**: Trivy + Grype with SARIF to Security tab
- [ ] **DAST — OWASP ZAP**: baseline scan on `/api/*` + WebSocket fuzzing on `/ws` (post-deploy to staging)

**Deliverable**: `.github/workflows/security-audit.yml`

### 9.3 Independent Security Audit Agent

A dedicated Claude Code agent that continuously audits the AgentCTL codebase:

- [ ] **Agent config**: read-only access, `allowedTools: ['Read', 'Glob', 'Grep']` only
- [ ] **Schedule**: nightly cron via BullMQ (uses Phase 8 cron feature)
- [ ] **Prompt template**: structured security review covering:
  - Input validation on all API routes (SQLi, command injection, XSS)
  - Secrets leakage in code, config, logs, git history
  - Container security (Dockerfile, compose hardening)
  - Auth/authz gaps in API endpoints
  - Dependency vulnerabilities and outdated packages
  - OWASP Agentic Top 10 compliance gaps
- [ ] **Output**: structured JSON report (severity, file, line, description, recommendation)
- [ ] **Integration**: results posted to control plane; high-severity -> auto-create GitHub Issues
- [ ] **Guardrails**: audit agent itself runs sandboxed (read-only FS, no network egress, restricted tools)

### 9.4 Runtime Security Controls

- [x] **Agent identity**: unique short-lived tokens per session (not shared machine keys)
- [ ] **Network egress**: `--network=none` default; allowlist specific domains per agent
- [ ] **FS isolation**: worktrees read-only except output dirs; block `.ssh`, `.gnupg`, `.aws`, `.env`
- [ ] **Memory security**: encrypt sensitive Mem0 fields at rest; TTL auto-expiry; per-agent isolation
- [x] **Tool rate limiting**: cap tool calls/minute/agent to detect runaway loops
- [x] **Prompt injection defense**:
  - Sanitize external content before agent context injection
  - Flag patterns: `ignore previous instructions`, `system:`, encoded payloads
  - Guardian agent: lightweight validator reviews high-risk tool calls pre-execution
- [x] **Kill switch**: `POST /api/agents/:id/emergency-stop` — abort + revoke token
- [x] **Anomaly detection**: baseline tool-call patterns; alert on deviations (e.g., agent using Bash after only Read/Write)

### 9.5 Audit Logging & Forensics

- [x] Structured NDJSON with SHA-256 integrity hashes (extends existing `AuditLogger`)
- [ ] Log retention: 90 days ClickHouse, 7 days local
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

## Target Workflow Summary

```
PR:              CI (lint + test) -> Docker build -> security scan (CodeQL + Semgrep + Trivy)
merge -> dev:    CI -> Docker build -> push ghcr.io:dev-latest -> deploy dev -> health check -> ZAP scan
merge -> main:   CI -> Docker build -> push ghcr.io:main-latest -> (ready for release)
GitHub Release:  push ghcr.io:v*.*.* -> approval gate -> DB backup + migrate -> deploy prod -> smoke test
rollback:        workflow_dispatch -> select previous tag -> deploy -> health check
fleet deploy:    canary -> verify -> matrix deploy remaining -> per-machine health check
nightly:         security audit agent -> structured report -> auto-create issues for high-severity
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
| Phase 8 — Sessions & Loop | Phase 4 (DB) | Types/API can start with Phase 1-2 |
| Phase 9 — Security Audit | Phase 2 (scan) + Phase 3 (DAST) + Phase 8 (audit agent) | SAST/SCA start with Phase 1 |

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
