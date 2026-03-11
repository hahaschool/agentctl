# Project Roadmap

> Last updated: 2026-03-11 (added §4.8 Unified Memory System UI)

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

### 2.5 Structured Execution Summary — P1

> Design doc: [plans/2026-03-10-astro-agent-patterns-design.md](plans/2026-03-10-astro-agent-patterns-design.md) §11.1
>
> Status note: Partially delivered on `main`. Shared `ExecutionSummary` types,
> the `agent_runs.result_summary` JSONB column, and `GET /api/runs/:id/summary`
> with stored/replay fallback are already landed. Remaining work is generating
> structured summaries in the worker completion path, emitting a dedicated SSE
> event, and surfacing summary cards in web/mobile views.

Auto-generate structured summary at task completion via session resume.

- [x] Define `ExecutionSummary` type (status, workCompleted, executiveSummary, filesChanged, followUps, cost)
- [ ] Implement summary generation in `AgentInstance.stop()`; post-hoc fallback already exists in the run summary route
- [x] DB migration: `agent_runs.result_summary` JSONB
- [ ] SSE event: `execution_summary`
- [x] API: `GET /api/runs/:id/summary`
- [ ] Summary card in web/mobile session view

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

### 2.8 Mid-Execution Steering — P2

Inject guidance into running sessions via SDK `streamInput()`.

- [ ] `steer(message)` on `AgentInstance`
- [ ] Worker API: `POST /api/agents/:agentId/steer`
- [ ] Control plane proxy → forward to worker
- [ ] SSE events: `steer_sent`, `steer_ack`
- [ ] Chat-like input in live session view (web/mobile)

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
- [ ] `DockerEnvironment` (gVisor)
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

### 3.3 AgentOutputStream — Unified Output Streaming — P2

Shared output contract between runtime adapters. Foundation for multi-runtime.

- [ ] Define `AgentOutputStream` interface (text, thinking, toolUse, toolResult, fileChange, costUpdate, error)
- [ ] Refactor `sdk-runner.ts` to emit through `AgentOutputStream`
- [ ] `AgentInstance` stream impl backed by EventEmitter + OutputBuffer
- [ ] Both `ClaudeRuntimeAdapter` and `CodexRuntimeAdapter` use same interface

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
- [ ] Sandbox constraints end-to-end: config rendering and network-policy helpers exist, but full bubblewrap/Seatbelt parity is not yet evidenced here

### 3.5 Automatic Handoff Triggers — P2

> Design doc: [plans/2026-03-11-automatic-handoff-triggers-design.md](plans/2026-03-11-automatic-handoff-triggers-design.md)
> Impl plan: [plans/2026-03-11-automatic-handoff-triggers-impl-plan.md](plans/2026-03-11-automatic-handoff-triggers-impl-plan.md)
>
> Status note: Phase 1 is already on `main`. Shared auto-handoff contracts,
> decision persistence, policy evaluation, run handoff history, and
> dispatch-time task-affinity dry-run suggestions are landed. Live
> rate-limit/cost-threshold execution remains deferred until
> `AgentOutputStream` is stable.

- [ ] Rate limit hit → failover to other agent type
- [ ] Cost threshold → switch to cheaper model/provider
- [x] Task-type affinity rules (dispatch-time dry-run suggestions + decision logging)
- [x] Handoff history API: `GET /api/runs/:id/handoff-history`

### 3.6 Unified Memory Layer — P1

> Design doc: [plans/2026-03-10-unified-memory-layer-design.md](plans/2026-03-10-unified-memory-layer-design.md)
> Impl plan: [plans/2026-03-10-unified-memory-layer-impl-plan.md](plans/2026-03-10-unified-memory-layer-impl-plan.md)
>
> Status note: Partially delivered on `main`. Shared memory types, the `0010`
> migration, Drizzle schema, embedding client, `MemoryStore`, and
> `MemorySearch` are present. The remaining cutover work is centered on
> replacing the current Mem0-backed injector/routes, adding runtime-side access,
> and finishing migration/knowledge-engineering follow-through.

PostgreSQL-native hybrid memory replacing external Mem0 service. 4-scope isolation (global > project > agent > session), pgvector + tsvector + graph traversal fused via Reciprocal Rank Fusion.

**Core (MVP)**:
- [x] Shared types: `MemoryFact`, `MemoryEdge`, `MemoryScope`, `InjectionBudget`
- [x] SQL migration `0010`: pgvector extension, `memory_facts` (HNSW index), `memory_edges`, `memory_scopes`
- [x] Drizzle schema + embedding client (text-embedding-3-small via LiteLLM)
- [x] `MemoryStore`: CRUD with scope isolation, dedup, Ebbinghaus decay
- [x] `MemorySearch`: hybrid search (vector + BM25 + graph CTE + RRF fusion)
- [ ] `MemoryInjector` refactor: dual-backend (Mem0 / PG) via `MEMORY_BACKEND` env var
- [ ] Memory API routes: search, add, list, delete (with scope filtering)
- [ ] Context budget: maxTokens 2400, maxFacts 20, 3-tier injection (pinned + on-demand + triggered)
- [ ] Memory MCP server for runtime-side access
- [ ] Migration path: dual-write → import → cutover
- [ ] Claude-mem data migration: audit → import script (PG target) → API dual-read → UI migration → MCP transition → cleanup

> Migration plan: [plans/2026-03-11-claude-mem-migration-plan.md](plans/2026-03-11-claude-mem-migration-plan.md)
> Frontend UI: see §4.8 Unified Memory System UI for the full 8-page UI plan + integration points

**Knowledge Engineering** (inspired by [stonepage's Agent 知识工程实践](https://zhuanlan.zhihu.com/p/1898602837)):
- [ ] Expanded EntityType: +`skill`, +`experience`, +`principle`, +`question` (11 total)
- [ ] Expanded RelationType: +`derived_from`, +`validates`, +`contradicts` (10 total)
- [ ] Pinned facts: always-injected guardrails, no decay, hard cap per scope
- [ ] Trigger-based injection: `TriggerSpec` (tool/file_pattern/keyword) integrated with PreToolUse hooks
- [ ] Role-aware search: `tags[]` field + `roleAffinity` boost in RRF reranking
- [ ] Meta-cognition: extraction quality rules embedded in extraction LLM prompt
- [ ] `memory_feedback` MCP tool: `used` / `irrelevant` / `outdated` signals
- [ ] Knowledge synthesis: weekly cron Phase 1 (lint) + Phase 2 (LLM-proposed principles, human review)
- [ ] Contradiction detection: `contradicts` edges trigger human review flags

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

#### 4.7.1 Critical Accessibility Fixes (Immediate)

- [ ] `CopyableText.tsx:77` — span mode: add `role="button"`, `tabIndex={0}`, `onKeyDown` for keyboard access (WCAG 2.1.1)
- [ ] `Spinner.tsx:16` — replace `<output>` with `<div role="status">` (WCAG 1.3.1, 4.1.2)
- [ ] `layout.tsx` — remove `userScalable: false` to allow pinch-zoom (WCAG 2.5.5)

#### 4.7.2 ARIA & Keyboard Hardening

- [ ] `CommandPalette.tsx:469` — add `aria-activedescendant` management to listbox
- [ ] `NotificationBell.tsx:90` — migrate manual dropdown to Radix `Popover` with focus trap
- [ ] `ContextPickerDialog.tsx` — add `role="tablist"`/`role="tab"`/`role="tabpanel"` to tab interface
- [ ] `KeyboardHelpOverlay.tsx:32` — fix backdrop `aria-hidden` + `onClick` conflict
- [ ] `CollapsibleSection.tsx:21` — add `aria-controls` pointing to content panel
- [ ] `Sidebar.tsx` — add `aria-current="page"` to active navigation link
- [ ] `SessionMessageList.tsx:25` — add `aria-pressed` to ViewModeToggle buttons
- [ ] `ErrorBanner.tsx` — add `role="alert"` for screen reader announcement
- [ ] Decorative Lucide icons — audit and add `aria-hidden="true"` where missing

#### 4.7.3 Theming Normalization (Kill AI Palette)

- [ ] `ProgressIndicator.tsx` — replace hard-coded `cyan-500/400/600` with `--color-primary` tokens
- [ ] `SessionContent.tsx:419-461` — replace cyan/purple/yellow/blue toggles with semantic theme colors
- [ ] `SessionMessageList.tsx:299` — same cyan replacement
- [ ] `SettingsView.tsx:260-289` — extract 14 hard-coded hex colors into CSS variables or constants
- [ ] `DashboardPage.tsx:228` — replace inline `style={{ color: '#ffffff' }}` with token
- [ ] `terminal-theme.ts` — migrate 20 hard-coded xterm colors to CSS variable-backed config
- [ ] Replace all `rgba(0,0,0,...)` shadows (6 instances in SettingsShell, SessionPreview, SessionsPage) with theme-aware values
- [ ] `MemoryPanel.tsx:12` — fix gray-on-gray contrast (gray-600 on gray-500/10)
- [ ] Reduce glassmorphism: keep `backdrop-blur` only on overlays (CommandPalette, Dialog), remove from SettingsShell, SettingsView decorative use

#### 4.7.4 Responsive & Touch Target Hardening

- [ ] `ContextPickerDialog.tsx:588` — make `w-80` right panel responsive: `w-full sm:w-80`
- [ ] `ForkConfigPanel.tsx:57` — same responsive fix
- [ ] `NotificationBell.tsx:44` — responsive dropdown: `w-full sm:w-80`
- [ ] `KeyboardHelpOverlay.tsx:47` — add responsive breakpoints for mobile
- [ ] `ContextPickerToolbar.tsx:76` — increase "By Topic" button from `py-0.5` to min 44px touch target
- [ ] `DiscoverSessionRow.tsx:96` — wrap 7x7px dot in 44x44px touch-target container
- [ ] `Sidebar.tsx:262` — increase Plus icon button padding for 44px minimum

#### 4.7.5 Performance Optimization

- [ ] `SessionListItem.tsx` — wrap export with `React.memo()`
- [ ] `SessionsPage.tsx:130` — wrap `RuntimeSessionListItem` with `React.memo()`
- [ ] `button.tsx`, `input.tsx` — verify focus ring `ring-ring/50` meets 3:1 contrast ratio (WCAG 2.4.7)

**Deliverable**: Zero critical a11y violations, design token compliance, mobile-safe layouts, optimized list rendering

### 4.8 Unified Memory System UI — P1

> Design spec: [plans/2026-03-11-memory-ui-design.md](plans/2026-03-11-memory-ui-design.md)
> Impl plan: [plans/2026-03-11-memory-ui-implementation.md](plans/2026-03-11-memory-ui-implementation.md)
>
> Full-stack vertical implementation: each page ships API route → component → test.
> Top-level `/memory` route with left sidebar, 8 sub-pages, plus memory data
> surfaced contextually across existing agent/session/machine pages.

**Pages (priority order):**

- [ ] Memory Browser (`/memory/browser`) — searchable, filterable data table of all facts; 3-column layout (filter sidebar, results list, detail panel); hybrid search (semantic + keyword); bulk actions; URL state via `nuqs`
- [ ] Knowledge Graph (`/memory/graph`) — multi-view visualization (Graph/Table/Timeline/Clusters); react-force-graph-2d; click node → detail panel; focus mode, time-lapse animation
- [ ] Memory Dashboard (`/memory/dashboard`) — KPI cards (total facts, new this week, avg confidence, pending consolidation); recharts line/donut/bar charts; GitHub-style activity heatmap; recent activity feed
- [ ] Consolidation Board (`/memory/consolidation`) — human-in-the-loop knowledge quality review; category cards (contradictions, near-duplicates, stale, orphans); severity-sorted priority queue; AI suggestions with accept/edit/skip/delete actions
- [ ] Reports (`/memory/reports`) — 3 report types (Project Progress, Knowledge Health, Activity Digest); scope + time range selector; LLM-generated summaries; rendered markdown with download/copy
- [ ] Import Wizard (`/memory/import`) — 4-step claude-mem migration wizard (source detection → preview/mapping → progress → summary); dedup via embedding similarity; rollback support
- [ ] Fact Editor (modal) — accessible from Browser/Graph/command palette; content, entity type, scope, confidence, pinned toggle, relationships editor
- [ ] Scope Manager (`/memory/scopes`) — scope hierarchy tree with fact counts; promote, merge, rename, delete scope operations

**Integration points (memory woven into existing pages):**

- [ ] Session Detail: new "Memory" tab showing facts read/created/updated during session
- [ ] Agent Detail: memory usage section with scope distribution + mini knowledge graph
- [ ] Runtime Sessions: memory injection status with token budget usage
- [ ] Machine Page: per-machine memory stats and cross-machine sync status
- [ ] Main Dashboard: memory health card (total facts, growth trend, pending consolidation)
- [ ] Context Picker: replace current claude-mem panel with unified memory search
- [ ] Command Palette: `memory:search`, `memory:create`, `memory:graph` commands
- [ ] Session Creation Form: scope selector + memory budget override

**Backend API (`/api/memory/*`):**

- [ ] Facts CRUD: `GET/POST/PATCH/DELETE /api/memory/facts`
- [ ] Edges CRUD: `GET/POST/DELETE /api/memory/edges`
- [ ] Graph data: `GET /api/memory/graph` (nodes + edges for visualization)
- [ ] Scopes: `GET/POST /api/memory/scopes`
- [ ] Consolidation: `GET /api/memory/consolidation`, `POST .../action`
- [ ] Reports: `POST /api/memory/reports`, `GET /api/memory/reports/:id`
- [ ] Import: `POST /api/memory/import`, `GET /api/memory/import/status`
- [ ] Stats: `GET /api/memory/stats` (dashboard metrics)
- [ ] Cross-entity queries: `?sessionId=X`, `?agentId=X`, `?machineId=X`

**MCP tools (agent runtime access):**

- [ ] `memory_search` — hybrid search (vector + BM25 + graph), ranked results
- [ ] `memory_store` — store new fact with scope + entity_type
- [ ] `memory_recall` — graph traversal (2-hop BFS) from entity
- [ ] `memory_feedback` — signal relevance (used / irrelevant / outdated)
- [ ] `memory_report` — generate scoped report
- [ ] `memory_promote` — escalate fact to parent scope

**Shared components:**

- [ ] `FactCard`, `EntityTypeBadge`, `ScopeBadge`, `ConfidenceBar`, `StrengthMeter`
- [ ] `MemorySidebar`, `ScopeSelector`, `FactDetailPanel`

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
- [ ] Smart selection tools (auto-select related messages)
- [x] Live prompt preview in fork dialog
- [x] Runtime dimension in create-agent flow from session context
- [ ] Runtime dimension in direct session fork flow

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
- [ ] Add time-range filtering to the unified browser
- [ ] Rich session cards across both surfaces: agent type badge, model, cost, duration, last tool call
- [ ] Tap from the browser into live SSE stream or session replay

### 5.2 Cross-Agent Run View — P3

- [x] Handoff history cards with strategy, reason, preflight summary, and analytics
- [ ] Handoff timeline with richer visual markers and context-transfer summary
- [ ] Expandable diff of each agent's contribution

### 5.3 Mobile Session Actions — P3

- [x] Resume / fork / manual handoff from mobile managed-runtime screen
- [x] Stop / signal / live SSE stream from mobile agent detail screen
- [ ] Pause / resume / stop runtime sessions from one unified action surface
- [ ] Push notifications for handoff events

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
- [ ] Split always-on rules (critical guardrails) from on-demand rules (coding style, patterns)
- [ ] Minimize MEMORY.md to only irreversible-damage rules; move everything else to topic-specific files
- [ ] Audit existing rules for relevance and remove outdated entries

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

- [ ] Claude Code Stop hook: summarize key decisions and lessons from session
- [ ] Route extracted knowledge to correct file (LESSONS_LEARNED.md, debugging.md, or relevant topic file)
- [ ] Dedup against existing entries before writing
- [ ] Human review flag for non-obvious extractions

### 7.4 Knowledge Maintenance / Dreaming — P3

Periodic review of accumulated knowledge for staleness, contradictions, and synthesis opportunities.

- [ ] Monthly lint of LESSONS_LEARNED.md, MEMORY.md, `.claude/rules/` for outdated entries
- [ ] Cross-reference lessons against codebase changes (lessons about deleted code should be archived)
- [ ] Synthesis pass: identify clusters of related lessons and propose higher-level principles
- [ ] Track "knowledge coverage" — which areas of the codebase have lessons vs. knowledge gaps

---

## Active Priorities

| Priority | Item | Section | Status |
|----------|------|---------|--------|
| **P0** | ~~Unified Session Browser (Web)~~ | 4.6 | ✅ Delivered |
| **P1** | Unified Memory Layer | 3.6 | Partial — core types/schema/store/search landed; injector/routes/MCP cutover remains |
| **P1** | Unified Memory System UI | 4.8 | Not started — 8 pages + 8 integration points + backend API + MCP tools |
| **P1** | UI Quality & Accessibility | 4.7 | Not started — 2 critical, 11 high, 18 medium from audit |
| **P1** | Structured Execution Summary | 2.5 | Not started |
| **P1** | ~~Workdir Safety Tiers~~ | 2.6 | ✅ Delivered |
| **P1** | ~~Dispatch Signature Verification~~ | 2.7 | ✅ Delivered |
| **P2** | AgentOutputStream | 3.3 | Not started |
| **P2** | Fork UX Extensions | 4.9 | Partial — auto-related-message/runtime-in-direct-fork work remains |
| **P2** | Mid-Execution Steering | 2.8 | Not started |
| **P2** | Codex Operational Parity | 3.4 | Partial — runtime-level sandbox enforcement/evidence still remains |
| **P2** | Automatic Handoff Triggers | 3.5 | Not started |
| **P2** | Remote Control Integration / Manual Takeover | 2.4 | Partial — relay decision + narrow manual takeover shipped; relay re-evaluation remains |
| **P2** | Layered Knowledge Loading | 7.1 | Partial — rule triggers landed; split/audit work remains |
| **P2** | Knowledge Sedimentation Rules | 7.2 | ✅ Delivered |
| **P3** | Mobile Session Browser | 5.1-5.3 | Partial — unified browser/filtering exists; richer cards, time range, and deeper replay/live entry remain |
| **P3** | Execution Environment Registry | 2.9 | Not started |
| **P3** | Automated Experience Extraction | 7.3 | Not started |
| **P3** | Knowledge Maintenance / Dreaming | 7.4 | Not started |

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
| Unified Memory Layer (P1) | None | Core types/schema/search/store have landed; remaining work is injector/routes/MCP cutover. Claude-mem migration is part of this — see [migration plan](plans/2026-03-11-claude-mem-migration-plan.md) |
| Unified Memory System UI (P1) | Unified Memory Layer (§3.6) backend routes | Backend API routes build on existing MemoryStore/MemorySearch; UI pages can start with mock data while backend catches up |
| UI Quality & Accessibility (P1) | None | Can start immediately — 2 critical, 11 high, 18 medium issues from audit |
| Execution Summary (P1) | None | Can start immediately |
| ~~Workdir Safety (P1)~~ | None | ✅ Delivered |
| ~~Dispatch Signing (P1)~~ | None | ✅ Delivered |
| AgentOutputStream (P2) | None | Foundation for multi-runtime unification |
| Mid-Execution Steering (P2) | AgentOutputStream | Needs stream interface for response routing |
| Codex Operational Parity (P2) | None | Partial on `main`; LiteLLM routing/failover is done, remaining work is runtime-level sandbox enforcement/evidence |
| Automatic Handoff (P2) | AgentOutputStream for live signals | Policy/history/task-affinity groundwork can land before it; live trigger execution waits on unified runtime signals |
| Remote Control Integration (P2) | None | Relay decision and narrow manual takeover are already on `main`; only relay re-evaluation remains |
| Fork UX Extensions (P2) | Unified Memory Layer + Memory UI (§4.8) | Memory integration in fork context selection; extends existing `ContextPickerDialog`, memory panel, and prompt preview |
| Layered Knowledge Loading (P2) | None | Can start immediately; restructure `.claude/rules/` with trigger-based loading |
| Knowledge Sedimentation Rules (P2) | None | Can start immediately; meta-rules for knowledge management |
| Mobile Session Browser (P3) | None | Web unification patterns are already on `main`; remaining work is mobile-side unification/filtering/actions |
| Execution Environment Registry (P3) | AgentOutputStream for adapter context + Docker | Capability model, direct environment, and worker reporting can land earlier; adapter plumbing and Docker execution wait on a stable output boundary |
| Automated Experience Extraction (P3) | Knowledge Sedimentation Rules | Needs sedimentation rules to know where to route extracted knowledge |
| Knowledge Maintenance (P3) | Unified Memory Layer | Lint/synthesis features build on the memory layer's graph and contradiction detection |

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
| [fork-ux-overhaul](plans/2026-03-09-fork-ux-overhaul.md) | Active | 4.9 |
| [astro-agent-patterns-design](plans/2026-03-10-astro-agent-patterns-design.md) | Active | 2.5-2.9, 3.3 |
| [runtime-centric-settings-redesign-design](plans/2026-03-10-runtime-centric-settings-redesign-design.md) | Delivered | 4.5 |
| [runtime-centric-settings-redesign-impl-plan](plans/2026-03-10-runtime-centric-settings-redesign-impl-plan.md) | Delivered | 4.5 |
| [runtime-settings-config-consistency-design](plans/2026-03-10-runtime-settings-config-consistency-design.md) | Subsumed | 4.5 |
| [runtime-settings-config-consistency-impl-plan](plans/2026-03-10-runtime-settings-config-consistency-impl-plan.md) | Subsumed | 4.5 |
| [unified-sessions-ui-design](plans/2026-03-10-unified-sessions-ui-design.md) | Delivered | 4.6 |
| [unified-sessions-ui-impl-plan](plans/2026-03-10-unified-sessions-ui-impl-plan.md) | Delivered | 4.6 |
| [remote-control-relay-decision](plans/2026-03-10-remote-control-relay-decision.md) | Delivered | 2.4 |
| [unified-memory-layer-design](plans/2026-03-10-unified-memory-layer-design.md) | Active | 3.6 |
| [unified-memory-layer-impl-plan](plans/2026-03-10-unified-memory-layer-impl-plan.md) | Active | 3.6 |
| [public-repo-prep-design](plans/2026-03-10-public-repo-prep-design.md) | Planned | — |
| [public-repo-prep-impl-plan](plans/2026-03-10-public-repo-prep-impl-plan.md) | Planned | — |
| [automatic-handoff-triggers-design](plans/2026-03-11-automatic-handoff-triggers-design.md) | Planned | 3.5 |
| [automatic-handoff-triggers-impl-plan](plans/2026-03-11-automatic-handoff-triggers-impl-plan.md) | Planned | 3.5 |
| [execution-environment-registry-design](plans/2026-03-11-execution-environment-registry-design.md) | Planned | 2.9 |
| [execution-environment-registry-impl-plan](plans/2026-03-11-execution-environment-registry-impl-plan.md) | Planned | 2.9 |
| [manual-remote-takeover-design](plans/2026-03-11-manual-remote-takeover-design.md) | Delivered | 2.4 |
| [manual-remote-takeover-impl-plan](plans/2026-03-11-manual-remote-takeover-impl-plan.md) | Delivered | 2.4 |
| [claude-mem-migration-plan](plans/2026-03-11-claude-mem-migration-plan.md) | Active | 3.6 |
| [memory-ui-design](plans/2026-03-11-memory-ui-design.md) | Approved | 4.8 |
| [memory-ui-implementation](plans/2026-03-11-memory-ui-implementation.md) | Planned | 4.8 |

### Knowledge Engineering
- [Agent 知识工程实践 (stonepage)](https://zhuanlan.zhihu.com/p/1898602837) — Knowledge types, layered loading, dreaming/synthesis, meta-cognition
