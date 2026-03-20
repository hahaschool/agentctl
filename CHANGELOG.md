# Changelog

All notable changes to AgentCTL are documented in this file.


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

