# Changelog

All notable changes to AgentCTL are documented in this file.


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

