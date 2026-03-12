# Project Roadmap

> Last updated: 2026-03-12 (§10.1 collaboration Phase 1 delivered (PRs #91-92); §11 fully complete (PRs #86-90); PR #85 code quality fixes merged)

## Current State

AgentCTL is a multi-machine AI agent orchestration platform with:

- **Web App**: Next.js 15 (App Router) + React Query + Tailwind CSS + shadcn/ui
- **Control Plane**: Fastify + PostgreSQL + BullMQ + Drizzle ORM
- **Agent Worker**: Claude Agent SDK + node-pty + PM2
- **Mobile**: React Native (Expo) — early stage, but already ships unified session browsing/filtering, managed runtime session controls, handoff history, and agent detail streaming
- **CI/CD**: 9 GitHub Actions workflows (build, test, deploy, security, fleet)
- **Security**: OWASP Agentic Top 10 compliance, CodeQL + Semgrep + Trivy + ZAP

**7,255+ unit tests** across 111 files + **143 Playwright e2e tests**. All packages build and lint cleanly (TypeScript 0 errors, Biome 0 errors).

---

## 1. Infrastructure

> CI/CD pipeline, deployment, fleet management, database migrations.

<details>
<summary>✅ All complete — 9 workflows, full deploy chain, fleet rollout</summary>

### 1.1 CI Hardening

- [x] `dorny/paths-filter` for monorepo-aware conditional builds
- [x] pnpm store caching + TypeScript build cache
- [x] Security scanning: `pnpm audit`, `gitleaks`, Biome security lint

### 1.2 Docker Build & Registry

- [x] Multi-stage Docker build (`node:22-alpine`, non-root uid 1001)
- [x] Image tagging: `sha-<commit>`, `main-latest`/`dev-latest`, semver `v*.*.*`
- [x] Trivy + Grype container scanning, SBOM generation

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

**Workflows**: `ci.yml`, `build-images.yml`, `deploy-dev.yml`, `deploy-prod.yml`, `rollback.yml`, `deploy-fleet.yml`, `migration-check.yml`, `security-audit.yml`

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

### 2.4 Remote Control Integration (Relay Decision + Manual Takeover) — P2

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
> web controls. The remaining roadmap item here is re-evaluating the relay only
> if Anthropic later exposes richer programmatic session APIs.

- [x] Spike: evaluate Remote Control relay vs current CLI `-p`
- [x] Decision: keep `claude -p` as the primary managed-session path for now
- [x] Narrow manual takeover flow for Claude managed sessions (`RcSessionManager`, worker/control-plane routes, runtime-session web controls)
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
> Status note: Implemented on `main` via signed control-plane dispatches, worker-side
> verification, and verification-key bootstrap on register/heartbeat. Remaining
> work here is roadmap hygiene rather than missing runtime wiring.

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
> Status note: Phase 1 is already on `main`. Shared execution-environment
> contracts, `ExecutionEnvironment`/`DirectEnvironment`, worker capability
> reporting, and control-plane environment selection are landed. The remaining
> gap here is `DockerEnvironment`, which the plan intentionally stages after
> `AgentOutputStream` stabilizes.

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

> Status note: Partially delivered on `main`. The worker already renders managed
> Codex config, including sandbox, approval, provider, and shell-environment
> policy, detects Codex auth, runs under the shared PM2 worker process, and
> includes sandbox/network helper primitives. LiteLLM routing/failover is already
> landed; the remaining gap is runtime-level enforcement/evidence for
> bubblewrap/Seatbelt or container-backed restrictions on the Codex path.

- [x] LiteLLM config: Codex model routing with OpenAI Direct → Azure OpenAI failover
- [x] PM2 ecosystem config for Codex-capable worker processes
- [x] Azure OpenAI credential detection for Codex authentication
- [x] Config renderer: `modelProvider`, `reasoningEffort`, and shell environment policy in Codex TOML
- [x] Sandbox constraints end-to-end: post-spawn verification (bubblewrap/Seatbelt/Codex), network enforcement, SSE `sandbox_verified` event *(PR #70)*

### 3.5 Automatic Handoff Triggers — P2

> Design doc: [plans/2026-03-11-automatic-handoff-triggers-design.md](plans/2026-03-11-automatic-handoff-triggers-design.md)
> Impl plan: [plans/2026-03-11-automatic-handoff-triggers-impl-plan.md](plans/2026-03-11-automatic-handoff-triggers-impl-plan.md)
>
> Status note: Phase 1 is already on `main`. Shared auto-handoff contracts,
> decision persistence, policy evaluation, run handoff history, and
> dispatch-time task-affinity dry-run suggestions are landed. Live
> rate-limit/cost-threshold execution remains deferred until
> `AgentOutputStream` is stable.

- [x] Rate limit hit → failover to other agent type *(PR #66 — LiveHandoffOrchestrator + AgentInstance integration)*
- [x] Cost threshold → switch to cheaper model/provider *(PR #66 — CostThresholdTrigger wired into AgentInstance)*
- [x] Task-type affinity rules (dispatch-time dry-run suggestions + decision logging)
- [x] Handoff history API: `GET /api/runs/:id/handoff-history`

### 3.6 Unified Memory Layer — P1

> Design doc: [plans/2026-03-10-unified-memory-layer-design.md](plans/2026-03-10-unified-memory-layer-design.md)
> Impl plan: [plans/2026-03-10-unified-memory-layer-impl-plan.md](plans/2026-03-10-unified-memory-layer-impl-plan.md)
>
> Status note: Substantially delivered on `main` via PRs #30 (claude-mem
> migration tooling), #31 (memory cutover: dual-backend `MemoryInjector`,
> memory API routes, memory MCP server), and #43 (3-tier context budget:
> pinned + on-demand + triggered injection with token/fact limits).
> Remaining work is knowledge-engineering follow-through.

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
> Top-level `/memory` route with left sidebar, 8 sub-pages, plus memory data
> surfaced contextually across existing agent/session/machine pages.

**Pages (priority order):**

- [x] Memory Browser (`/memory/browser`) — searchable, filterable data table of all facts; 3-column layout (filter sidebar, results list, detail panel); hybrid search (semantic + keyword); bulk actions; URL state via `nuqs`
- [x] Knowledge Graph (`/memory/graph`) — multi-view visualization (Graph/Table/Timeline/Clusters); react-force-graph-2d; click node → detail panel; focus mode, time-lapse animation *(PR #50)*
- [x] Memory Dashboard (`/memory/dashboard`) — KPI cards (total facts, new this week, avg confidence, pending consolidation); recharts line/donut/bar charts; GitHub-style activity heatmap; recent activity feed *(PR #52)*
- [x] Consolidation Board (`/memory/consolidation`) — human-in-the-loop knowledge quality review; category cards (contradictions, near-duplicates, stale, orphans); severity-sorted priority queue; AI suggestions with accept/edit/skip/delete actions *(PR #53)*
- [x] Reports (`/memory/reports`) — 3 report types (Project Progress, Knowledge Health, Activity Digest); scope + time range selector; LLM-generated summaries; rendered markdown with download/copy *(PR #53)*
- [x] Import Wizard (`/memory/import`) — 4-step claude-mem migration wizard (source detection → preview/mapping → progress → summary); dedup via embedding similarity; rollback support *(PR #55)*
- [x] Fact Editor (modal) — accessible from Browser/Graph/command palette; content, entity type, scope, confidence, pinned toggle, relationships editor *(PR #53)*
- [x] Scope Manager (`/memory/scopes`) — scope hierarchy tree with fact counts; promote, merge, rename, delete scope operations *(PR #55)*

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
> Status note: Partially delivered on `main` through the unified
> `ContextPickerDialog`, memory search/timeline panel, smart selection helpers,
> and prompt preview. Remaining gaps are centered on automatic related-message
> selection and carrying the runtime dimension all the way through classic fork
> flows.

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

> Status note: Partially delivered on `main`. The mobile app already has a
> unified browser model and `SessionBrowserScreen` covering classic + managed
> sessions with type/runtime/machine/status filters. Time-range filtering,
> richer cards, and deeper replay/live entry remain.

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
| ASI04 — Supply Chain | pnpm audit + Trivy + Grype + SBOM + pinned deps | ✅ |
| ASI05 — Code Execution | Sandbox (bubblewrap/Seatbelt) + cap-drop + network=none | ✅ |
| ASI06 — Memory Poisoning | Mem0 validation + per-agent isolation + TTL | ✅ |
| ASI07 — Inter-Agent Comms | TweetNaCl E2E + Tailscale WireGuard | ✅ |
| ASI08 — Cascading Failures | Timeout + circuit breaker + BullMQ backoff + checkpoints | ✅ |
| ASI09 — Trust Exploitation | Approval gates + cost alerts + dead-loop detection | ✅ |
| ASI10 — Rogue Agents | SHA-256 audit log + anomaly detection + kill switch | ✅ |

### 6.2 Security Pipeline

- [x] SAST: CodeQL (`security-extended`) + Semgrep (`p/security-audit` + `p/secrets`)
- [x] SCA: `pnpm audit`, license check (no GPL/AGPL), Trivy + Grype
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
- [ ] Control plane → worker config downlink: include MCP config in job payload — future

> **User feedback**: Manual MCP form is bad UX. Needs auto-detection and managed push-down. See §11.6.

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

### 10.2 Phase 2: Multi-Agent Communication — P2

Agent Bus for inter-agent messaging and delegation.

- [ ] Agent Bus (Redis PubSub same-machine / NATS cross-machine)
- [ ] AgentMessage protocol: request/response/inform/delegate/escalate
- [ ] Agent-to-agent delegation workflow
- [ ] Space membership management (add/remove agents and humans)

### 10.3 Phase 3: Task Graph + Fleet — P2

DAG-based task scheduling and fleet-wide orchestration.

- [ ] Task Graph engine: TaskNode, dependencies, fork/join
- [ ] Approval gates: human sign-off before proceeding
- [ ] Fleet overview Space: aggregate status across all machines
- [ ] Temporal.io migration for durable multi-step workflows

### 10.4 Phase 4: Context Bridge — P3

Cross-space context mobility.

- [ ] Reference mode: live pointer to source
- [ ] Copy mode: ContextPicker snapshot
- [ ] Live-sync mode: cross_space_query MCP tool
- [ ] Context budget management across spaces

### 10.5 Phase 5: Intelligence Layer — P3

Smart routing, auto-composition, and learning.

- [ ] Smart agent selection based on task type
- [ ] Auto-compose agent teams from task description
- [ ] Learning from collaboration outcomes
- [ ] Notification routing optimization

---

## Active Priorities

| Priority | Item | Section | Status |
|----------|------|---------|--------|
| **P0** | ~~Unified Session Browser (Web)~~ | 4.6 | ✅ Delivered |
| **P1** | ~~Unified Memory Layer~~ | 3.6 | ✅ Delivered — all knowledge engineering items complete (PRs #50-#59) |
| **P1** | ~~Unified Memory System UI~~ | 4.8 | ✅ Delivered — 8 pages + integration points + MCP tools (PRs #47,#50,#52-#59); backend routes for consolidation, reports, and decay all landed |
| **P1** | ~~UI Quality & Accessibility~~ | 4.7 | ✅ Delivered — all ARIA items complete (PRs #51,#54,#59) |
| **P1** | ~~Structured Execution Summary~~ | 2.5 | ✅ Delivered |
| **P1** | ~~Workdir Safety Tiers~~ | 2.6 | ✅ Delivered |
| **P1** | ~~Dispatch Signature Verification~~ | 2.7 | ✅ Delivered |
| **P2** | ~~AgentOutputStream~~ | 3.3 | ✅ Delivered |
| **P2** | ~~Fork UX Extensions~~ | 4.9 | ✅ Delivered — smart selection + runtime in fork (PR #57) |
| **P2** | ~~Mid-Execution Steering~~ | 2.8 | ✅ Delivered (PR #45) |
| **P2** | ~~Codex Operational Parity~~ | 3.4 | ✅ Delivered — sandbox enforcement (PR #61) + verification evidence (PR #70) |
| **P2** | ~~Automatic Handoff Triggers~~ | 3.5 | ✅ Delivered — task-affinity (PR #62) + live rate-limit failover + cost-threshold switching (PR #66) |
| **P2** | Remote Control Integration / Manual Takeover | 2.4 | Partial — relay decision + narrow manual takeover shipped; relay re-evaluation remains |
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
| **P0** | ~~MCP Server Configuration for Agents~~ | 9.2 | ✅ Delivered — `.mcp.json` written before agent startup (PR #80) |
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
| **P2** | Multi-Agent Communication | 10.2 | Not started — Agent Bus + delegation |
| **P2** | Task Graph + Fleet | 10.3 | Not started — DAG engine + approval gates |
| **P3** | Context Bridge | 10.4 | Not started — cross-space context mobility |
| **P3** | Intelligence Layer | 10.5 | Not started — smart routing + auto-compose |

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
memory:          embed fact → pgvector HNSW → hybrid search (vector+BM25+graph RRF) → 3-tier injection
memory UI:       /memory (8 pages) → browser/graph/dashboard/consolidation/reports/import/editor/scopes
memory integ:    session/agent/machine/dashboard/context-picker/cmd-palette → contextual memory data
knowledge:       extract → lint (dedup+contradict) → synthesize (LLM propose) → human review → promote
feedback:        agent uses fact → memory_feedback(used/irrelevant/outdated) → adjust strength/ranking
```

## Dependencies

| Item | Depends On | Notes |
|------|-----------|-------|
| ~~Unified Session Browser (P0)~~ | None | ✅ Delivered |
| ~~Unified Memory Layer (P1)~~ | None | ✅ Delivered — all knowledge engineering items complete, decay module landed (PR #76) |
| ~~Unified Memory System UI (P1)~~ | Unified Memory Layer (§3.6) backend routes | ✅ Delivered — 8 pages + integration + all backend routes (consolidation, reports, decay) |
| ~~UI Quality & Accessibility (P1)~~ | None | ✅ Delivered — all ARIA items complete |
| ~~Execution Summary (P1)~~ | None | ✅ Delivered (PRs #32, #39) |
| ~~Workdir Safety (P1)~~ | None | ✅ Delivered |
| ~~Dispatch Signing (P1)~~ | None | ✅ Delivered |
| ~~AgentOutputStream (P2)~~ | None | ✅ Delivered (PR #29) |
| ~~Mid-Execution Steering (P2)~~ | AgentOutputStream | ✅ Delivered (PR #45) |
| ~~Codex Operational Parity (P2)~~ | None | ✅ Delivered — sandbox enforcement + verification evidence |
| ~~Automatic Handoff (P2)~~ | AgentOutputStream for live signals | ✅ Delivered — worker-side architecture (diverged from plan's CP-side design) |
| Remote Control Integration (P2) | None | Partial — relay decision + narrow manual takeover shipped; relay re-evaluation remains |
| ~~Fork UX Extensions (P2)~~ | Unified Memory Layer + Memory UI (§4.8) | ✅ Delivered — smart selection + runtime in fork |
| ~~Layered Knowledge Loading (P2)~~ | None | ✅ Delivered — see §7.1 |
| ~~Knowledge Sedimentation Rules (P2)~~ | None | ✅ Delivered — see §7.2 |
| ~~Mobile Session Browser (P3)~~ | None | ✅ Delivered — all items complete |
| ~~Execution Environment Registry (P3)~~ | AgentOutputStream for adapter context + Docker | ✅ Delivered — Direct + Docker environments with gVisor |
| ~~Automated Experience Extraction (P3)~~ | Knowledge Sedimentation Rules | ✅ Delivered — stop hook, entity routing, dedup, review flags |
| ~~Knowledge Maintenance (P3)~~ | Unified Memory Layer | ✅ Delivered — monthly lint, git cross-ref, synthesis, coverage reporting |

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
| [public-repo-prep-design](plans/2026-03-10-public-repo-prep-design.md) | Delivered | — |
| [public-repo-prep-impl-plan](plans/2026-03-10-public-repo-prep-impl-plan.md) | Delivered | — |
| [automatic-handoff-triggers-design](plans/2026-03-11-automatic-handoff-triggers-design.md) | Delivered | 3.5 |
| [automatic-handoff-triggers-impl-plan](plans/2026-03-11-automatic-handoff-triggers-impl-plan.md) | Delivered | 3.5 |
| [execution-environment-registry-design](plans/2026-03-11-execution-environment-registry-design.md) | Delivered | 2.9 |
| [execution-environment-registry-impl-plan](plans/2026-03-11-execution-environment-registry-impl-plan.md) | Delivered | 2.9 |
| [manual-remote-takeover-design](plans/2026-03-11-manual-remote-takeover-design.md) | Delivered | 2.4 |
| [manual-remote-takeover-impl-plan](plans/2026-03-11-manual-remote-takeover-impl-plan.md) | Delivered | 2.4 |
| [claude-mem-migration-plan](plans/2026-03-11-claude-mem-migration-plan.md) | Delivered | 3.6 |
| [memory-ui-design](plans/2026-03-11-memory-ui-design.md) | Delivered | 4.8 |
| [memory-ui-implementation](plans/2026-03-11-memory-ui-implementation.md) | Delivered | 4.8 |

| [multi-agent-collaboration-design](plans/2026-03-12-multi-agent-collaboration-design.md) | Active | 10.1-10.5 |
| [multi-agent-collaboration-phase1-impl-plan](plans/2026-03-12-multi-agent-collaboration-phase1-impl-plan.md) | Delivered | 10.1 |
| [agent-detail-ux-redesign](plans/2026-03-12-agent-detail-ux-redesign.md) | Delivered | 11.1-11.7 |
| [codex-gui-thread-prompts](plans/2026-03-10-codex-gui-thread-prompts.md) | Reference | — |
| [roadmap-parallelization-handoff-plan](plans/2026-03-10-roadmap-parallelization-handoff-plan.md) | Reference | — |

### Knowledge Engineering
- [Agent 知识工程实践 (stonepage)](https://zhuanlan.zhihu.com/p/1898602837) — Knowledge types, layered loading, dreaming/synthesis, meta-cognition
