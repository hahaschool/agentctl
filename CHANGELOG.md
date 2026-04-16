# Changelog

All notable changes to AgentCTL are documented in this file.


## [0.5.5] — 2026-04-16

fix proxy body hash mismatch in peer update forwarding

### Changes

- f6c831b2 fix(mesh): pass object (not string) to createPeerSignedHeader in proxy (#600)


## [0.5.4] — 2026-04-16

resolve Tailscale CLI path for macOS app bundle

### Changes

- e39151e6 fix(mesh): resolve Tailscale CLI binary path for macOS app bundle (#599)


## [0.5.3] — 2026-04-16

peer update proxy — sign and forward to remote peers

### Changes

- a9f4eeec fix(mesh): peer update proxy — sign and forward to remote peers (33.11) (#598)


## [0.5.2] — 2026-04-16

PM2 sync peer token passthrough + stale LOCAL_APP_VERSION fix

### Changes

- 68b9eccc docs: sync roadmap for PM2 token + version fix (PR #596) (#597)
- c79253a1 fix(mesh): pass SYNC_PEER_REGISTRATION_TOKEN through PM2 env + update LOCAL_APP_VERSION (#596)
- 1c483311 docs: sync roadmap §33.10 delivered + §33.11 machines.yml (PRs #593-#594) (#595)
- adddccc6 test(mesh): schema compat two-node integration + schema-ahead E2E (33.10) (#594)
- 0696b0b3 chore(infra): document fleet topology in machines.yml (33.11) (#593)
- 6d9e6519 docs: sync roadmap §33.7 delivered + §33.8 integration proof (PRs #589-#591) (#592)
- e6056aca test(mesh): add E2E coverage for ping diagnostics, health summary, and version banner (33.7) (#591)
- 01c5c135 feat(mesh): discover peers UI flow + probe auto-fill (33.7) (#590)
- 948332e9 test(mesh): two-node machine replication integration proof (33.8) (#589)
- b1bd8318 docs: sync roadmap §33.7 after discover/probe backend delivery (PR #586, #587) (#588)
- 20c9817f chore(deps): bump fastify in the npm_and_yarn group across 1 directory (#587)
- 70287081 feat(mesh): GET /api/sync/peers/discover + /probe endpoints (33.7) (#586)
- 5c078b1e docs(memory): plan MemPalace-inspired memory evolution (#584)
- d8415cfc docs(mesh): document SYNC_PEER_REGISTRATION_TOKEN for peer reverse-registration (#585)
- cfc38efe docs: sync roadmap §33.7/§33.11 after PRs #579/#580/#582 (#583)
- 8f855bee feat(mesh): ping failure details + update-available banner on /mesh-peers (33.7, 33.11) (#582)
- 2805e5d7 feat(mesh): agentctl peer update --rollback for PM2 topology (33.11) (#580)


## [0.5.1] — 2026-04-15

fix: stale LOCAL_APP_VERSION in web client bundle

### Changes

- 30ac9289 fix(web): bump LOCAL_APP_VERSION to v0.5.0 + sync LOCAL_SCHEMA_VERSION; rewrite mesh-version constants in version-bump.sh (#581)
- acd60285 ci(fleet): require migration-check gate in deploy-fleet (33.11) (#579)
- f8bba57a docs: sync roadmap §33.8/§33.11 after PRs #575-#577 (#578)
- 8b5ffb80 feat(mesh): /settings mesh auto-update section (33.11) (#577)
- a968c58d feat(mesh): health panel on /mesh-peers with cursor drill-down (33.8) (#576)


## [0.5.0] — 2026-04-15

mesh: ping diagnostics, bidirectional registration warnings, peer-update CLI/schedulers, /api/version-compat, peer-ahead rejection UI, health panel, Docker fleet attestations

### Changes

- 311416ff ci(fleet): build provenance attestations + deploy-fleet verification (33.11) (#575)
- 5701f34c docs: sync roadmap §33.10/§33.11 after PRs #567-#573 (#574)
- bce59bf8 feat(mesh): persist and surface per-peer schema-ahead rejections on /mesh-peers (33.10) (#573)
- 0c8d7451 feat(mesh): opt-in launchd + systemd peer-update schedulers (33.11) (#572)
- 38ca5e80 feat(mesh): /api/version-compat endpoint + client compat banner (33.11) (#570)
- 0a65612b feat(mesh): pnpm agentctl peer update CLI with rollback + history (33.11) (#571)
- a4773795 feat(mesh): ping diagnostics UI + Tailscale discover/probe endpoints (33.7) (#569)
- 0e27c838 feat(web): one-way registration warning badge on /machines (33.8 followup) (#568)
- 0e865bde feat(web): peer-ahead per-row banner on /mesh-peers (33.10 followup) (#567)
- 86dcf10d docs(roadmap): sync mesh checkpoint through PR 565 (#566)
- ff4cbd34 feat(mesh): auto reverse-register peer on add (33.8) (#564)
- 9efcd36c fix(control-plane): add missing journal entries for migrations 0021-0025 (#565)
- 657f2047 feat(mesh): manual "Update peer" action [33.11 slice 1] (#563)
- 51005b25 test(control-plane): cover peer health version persistence (#562)
- 482d68bc feat(control-plane): persist peer version fields from /health pings (33.9) (#561)
- 3d87d225 docs(roadmap): sync mesh version and compat status
- 2bdd54f2 feat(web): show peer version column + mesh drift banner (33.9) (#558)
- 7c0f0fa3 feat(control-plane): mesh envelope schema + protocol compat gate (33.10) (#557)
- 11bd3b5f feat(control-plane): expose appVersion + gitSha + schemaVersion on /health (#556)
- fe42df07 feat(control-plane): persist peer version on sync_nodes (33.9 partial) (#555)

## [0.4.0] — 2026-04-15

283-commit backlog from v0.3.1 → v0.4.0. Highlights:

### Web
- New pages: /audit (#507), /agent-profiles (#498 + #506), /scheduler (#517), /memory/maintenance, /memory/synthesis, /memory/consolidation surfaces
- ErrorBoundary wraps /logs and /settings (#540) to match the rest of the app shell
- /settings Accounts: inline "Add managed credential" CTA in empty state + credential input a11y (#542)
- /settings push-device surface + notification preferences coverage
- Sidebar keyboard access: 1-9,0 digit shortcuts + g-prefix Go To chords + grouped Settings docs (#525)
- Memory dashboard polish (ConfirmDialog primitive, loading/error/retry)
- Webhooks delivery history viewer (#467, retry UI #488)
- Consolidation: removed non-functional Edit button (#536)
- Approvals: aria-expanded/aria-label on session group expander (#538)
- Mesh peers Add/Delete flow (#483)
- Web API client split into 11 domain modules (#481)

### Control Plane
- Rate-limit audit completed: OAuth PKCE (#423), accounts (#427), verification (#429), deferred write surfaces (#439)
- Zod input validation + length bounds on checkpoint/mobile-push/knowledge-maintenance/webhooks/permission-requests/approvals/handoffs/sync-conflicts/memory-facts (#443, #448)
- Sync-peer URL/SSRF hardening (#452)
- Agent-profile PATCH endpoint + Edit dialog (#506)
- Routing API payload bounds (#497)

### Worker
- Codex in-flight session discovery fix (#537)
- Stale discovery type stubs removed after shared types became canonical (#479)

### CI & Security
- Docker publish Grype SARIF modernization + Node24 action majors (#508, #510, #520, #523)
- Dependency Audit migrated from retired pnpm endpoint to npm bulk advisory (#515)
- CI cache-save key scoped per run (#522)
- Biome 2.4 security-lint restore + SARIF validation (#440)
- Backend-independent Playwright coverage gated in CI for /webhooks, /agents, /machines, /agent-profiles, /audit, /logs, /memory/browser, /memory/import, /memory/scopes, /memory/graph, /memory/consolidation, /discover, /settings, /spaces, /tasks, /mesh-peers, /sessions/[id], /memory/dashboard, /scheduler

### Dev Infrastructure
- env-up.sh --dry-run preflight with redacted DB/Redis targets (#500)
- db-provision-tier.ts dry-run-first helper (#482)
- Dev-tier startup portability (#496)



## [0.3.1] — 2026-03-20

Force kill, stall detection, permission bypass fix, UX polish

### Features
- Force kill endpoint for stuck sessions (§27.1)
- Stall detection — 15min no output marks session stalled (§27.2)
- Session metrics card showing token usage and cost (§28.1)
- Sidebar version links to GitHub releases (§28.2)
- Command palette searches sessions by prompt (§28.3)
- PageContainer consistent layout wrapper (§28.4)
- "Allow for session" permission approval option

### Fixes
- CRITICAL: permissionMode now passed in dispatch payload — bypass agents no longer get approval popups
- Promotion flow: correct PM2 names, SSE parsing, send success before CP restart
- Session reaper skips sessions with claudeSessionId (prevents false timeouts)
- Approvals page rewritten from thread-based to permission-request based
- Tool input formatting: Bash shows command, Read shows path, AskUserQuestion shows questions
- Retry order: latest attempt shown as lead run, older failures collapsed


## [0.3.0] — 2026-03-19

§14-23: MCP discovery, permission approvals, mobile inbox, knowledge graph, API docs, full route test coverage, UX polish

### Features
- Permission approval system with WebSocket real-time notifications (§17.4)
- Agent run state machine visibility — dispatch states in UI (§17.5)
- Agent templates, enhanced command palette, onboarding empty states (§18.1-18.3)
- ToolUseBlock component for structured tool display in sessions (§19.3)
- Tasks detail page /tasks/[id] with graph nodes + run history (§20.2)
- Real memory dashboard replacing placeholder (§20.4)
- Notification preferences settings panel (§20.8)
- Dedicated Approvals page with approve/deny actions (§23.3)
- Dashboard enhancement — health summary, recent runs, quick actions (§23.4)
- Knowledge graph SVG visualization replacing placeholder (§23.2)
- Mobile pending approvals inbox + push notification infrastructure (§21.1)
- Comprehensive API reference docs/API.md (§20.3)

### Testing
- Full CP route test coverage — all routes now tested (§19.1, §20.1, §22.1, §23.1)
- Playwright E2E specs for /tasks, /spaces, /deployment (§20.5)
- Permission-requests route tests (14 tests)
- Spaces (76), task-graphs (35), agent-profiles (33), memory-reports, notification-preferences, approvals, task-runs, context-bridge (52), memory-consolidation, knowledge-maintenance, run-reaper

### Fixes
- Promotion flow: correct PM2 names, SSE parsing (onmessage not named events), send success before CP restart
- Preflight build check: skip rebuild when .next/BUILD_ID is fresh, exclude mobile package
- Migration journal: add missing 0019_add_permission_requests entry
- Light mode: replace hardcoded dark colors with semantic tokens in 6 components
- WebSocket permission events wired to React Query for instant notifications
- React.memo on 7 session display components for performance
- Agent detail page UX polish — loading states, empty states, cost summary

### Performance
- React.memo on SessionContent, InlineMessage, ToolUseBlock, ThinkingBlock, SubagentBlock, TodoBlock, ProgressIndicator


## [0.2.0] — 2026-03-15

§14 MCP/Skill Auto-Discovery, §15 Codex Runtime Parity, §12.7 Deployment Page

### Changes

- 8712d32 feat: add development flow rules + version bump script
- 2c198f3 fix: ModelPromptsTab uses runtime-aware model options instead of hardcoded Claude models
- 7b1388c fix: MCP/skill picker bugs — default runtime, show both runtimes' servers
- 332e135 docs: mark §15.2 Codex Config Capabilities fully delivered — roadmap clear
- e52859a feat: Codex config capabilities — RuntimeConfigTab + config preview (#15.2) (#156)
- 875976a docs: update roadmap — §15.2 spec + plan linked, scope revised
- 5ee55ad docs: add §15.2 Codex Config Capabilities implementation plan
- 6123605 docs: add §15.2 Codex Config Capabilities design spec (revised)
- 0a8143a test(cp): add TierConfigLoader and Pm2Client unit tests (#155)
- 0ababab feat(cp): add GET /preflight/:tier endpoint + deployment route tests (#154)
- bfa3d5c docs: mark §12.7 deployment page as delivered (PR #144, retroactive)
- b3d9073 docs: mark §14 MCP/Skill Auto-Discovery fully delivered (PRs #146-153)
- 963bd38 feat: machine capability triggers — heartbeat sync, picker refresh, runtime auto-clear (#153)
- bd1e625 test(web): add E2E stubs for MCP and skill discovery flows (#152)
- c947e60 docs: fix roadmap consistency — add §12.7 deployment page, fix plan status refs
- 408d73c fix: resolve AgentFormDialog merge conflict — use override model for MCP/skill pickers
- dbcf243 docs: update roadmap — §14.3, §14.4, §15.1 fully delivered
- 50abe45 feat(web): MCP/skill discovery pickers + override model + SkillsTab (#151)
- fe6eef6 feat(web): runtime selector integration across all create/edit/filter flows (#150)
- 2ccfdd7 feat(cp): MCP/skill discover proxies + sync-capabilities endpoint (#149)

