# MCP Server & Skill Auto-Discovery

**Date**: 2026-03-14
**Status**: Draft
**Scope**: Runtime-aware auto-discovery of MCP servers and skills, with machine-level defaults and per-agent overrides

## Problem

Creating or editing agents requires manually entering MCP server JSON configs and skill definitions every time. In a multi-agent, multi-machine environment this is O(n) repetitive work. MCP servers and skills are already configured on each machine in runtime-specific config files (Claude Code's `~/.claude.json`, Codex's `.codex/config.toml`, etc.) but the platform doesn't read them.

The create flow has partial MCP discovery (`McpServerPicker` calls `discoverAllMcpServers()`), but it only covers Claude Code configs and is not available in the edit flow. Skill discovery does not exist at all. Codex's TOML-based MCP config format is completely ignored.

## Goals

1. Auto-discover MCP servers and skills from each machine's local runtime configs
2. Support both Claude Code and Codex config formats (runtime-aware discovery)
3. Machine-level defaults: discovered items become the default set for all agents on that machine
4. Per-agent overrides: each agent can include/exclude from defaults and add custom entries
5. Unified picker UX for both create and edit flows, for both MCP servers and skills

## Non-Goals

- OpenClaw / NanoClaw discovery (no managed runtime implementation exists)
- Cross-machine MCP server sharing (each machine discovers its own)
- Auto-installing MCP servers or skills on machines
- Machine settings UI for editing defaults (future work; sync-capabilities handles this)

## Data Model

### Machine-Level Defaults

`mcpServers[]` and `skills[]` already exist on `ManagedRuntimeConfig`. Discovery populates them. Provenance metadata (which items are discovered vs manually added) is stored on the **machine record** in the database, not on `ManagedRuntimeConfig` — keeping the runtime config lean and focused on what config renderers consume.

```typescript
// Extend existing MachineCapabilities type in packages/shared/src/types/machine.ts
// (which already has gpu, docker, maxConcurrentAgents, etc.)
type MachineCapabilities = {
  // ... existing fields (gpu, docker, maxConcurrentAgents, executionEnvironments, etc.)

  // NEW: discovery provenance
  mcpServerSources?: Record<string, 'discovered' | 'manual'>
  skillSources?: Record<string, 'discovered' | 'manual'>
  lastDiscoveredAt?: string  // ISO timestamp of last successful sync
}
```

### Extend ManagedSkill with metadata

Extend `ManagedSkill` in `packages/shared/src/types/runtime-management.ts` to include display metadata so the picker can show names and descriptions without re-discovering:

```typescript
type ManagedSkill = {
  id: string
  path: string
  enabled: boolean
  // NEW: populated from SKILL.md frontmatter during discovery
  name?: string
  description?: string
  source?: 'global' | 'project'
}
```

### Agent-Level Overrides

New fields on `AgentConfig` in `packages/shared/src/types/agent.ts`. Uses an **opt-out model**: all machine defaults are included unless explicitly excluded.

```typescript
type AgentMcpOverride = {
  excluded: string[]          // server names explicitly excluded from machine defaults
  custom: McpServerConfig[]   // manually added, not from discovery
}

type AgentSkillOverride = {
  excluded: string[]          // skill IDs explicitly excluded from machine defaults
  custom: ManagedSkill[]      // manually added, not from discovery
}
```

No `included` field — all machine defaults are included unless they appear in `excluded`. This eliminates ambiguity about which list wins when a name appears in both.

### Effective Config Resolution

When starting an agent, compute effective MCP servers and skills:

```
effectiveMcpServers = machineDefaults.mcpServers.filter(s => !agent.mcpOverride.excluded.includes(s.name))
                      + agent.mcpOverride.custom

effectiveSkills = machineDefaults.skills.filter(s => !agent.skillOverride.excluded.includes(s.id))
                  + agent.skillOverride.custom
```

Resolution happens at agent start time, not at config save time, so it always reflects current machine defaults.

When `agent.mcpOverride` or `agent.skillOverride` is `undefined` (existing agents before migration), treat as empty overrides — all defaults included, no custom. This is a backward-compatible JSONB addition; no database migration is needed beyond adding the `MachineCapabilities` column.

### Unmanaged Runtime Handling

`AgentRuntime` includes `'nanoclaw' | 'openclaw'` which are not managed runtimes. When `agent.runtime` is not a `ManagedRuntime`, the MCP/Skill pickers are hidden and discovery is skipped. Use the existing `isManagedRuntime()` guard from `runtime-management.ts` before rendering pickers or calling discovery endpoints.

## Backend

### Discovery Endpoints

#### MCP Discovery (extend existing)

**Worker**: `GET /api/mcp/discover?runtime=claude-code|codex&projectPath=...`

| Runtime | Scan Paths | Format |
|---------|-----------|--------|
| `claude-code` | `~/.claude.json`, `~/.claude/settings.json`, `<project>/.mcp.json`, `<project>/.claude/settings.json` | JSON |
| `codex` | `~/.codex/config.toml`, `<project>/.codex/config.toml` | TOML `[mcp_servers.*]` sections |

Response keeps the existing coarse-grained `source: McpServerSource` (`'project' | 'machine' | 'global' | 'template'`) for UI grouping, and adds a `configFile: string` field on `DiscoveredMcpServer` (in `packages/shared/src/types/agent.ts`) for structured provenance detail (e.g., `~/.claude.json`, `.codex/config.toml`). This replaces the current pattern of stuffing provenance into the `description` field as `"From <path>"` strings — `description` will be reserved for actual server descriptions. This avoids diverging from the existing `McpServerSource` type while providing cleaner provenance tracking.

**CP proxy**: `GET /api/mcp/discover?machineId=...&runtime=...&projectPath=...`
Forwards to worker on target machine via Tailscale. Same pattern as existing proxy.

#### Skill Discovery (new)

**Worker**: `GET /api/skills/discover?runtime=claude-code|codex&projectPath=...`

| Runtime | Scan Paths |
|---------|-----------|
| `claude-code` | `~/.claude/skills/*/SKILL.md`, `<project>/.claude/skills/*/SKILL.md` |
| `codex` | `~/.agents/skills/*/SKILL.md`, `<project>/.agents/skills/*/SKILL.md` (note: Codex skill convention is speculative — verify at implementation time whether Codex uses the same `SKILL.md` frontmatter format as Claude Code, or requires a different parser) |

Response:
```typescript
type DiscoveredSkill = {
  id: string                    // derived from directory name
  name: string                  // from SKILL.md YAML frontmatter
  description: string           // from SKILL.md YAML frontmatter
  path: string                  // absolute path to SKILL.md
  source: 'global' | 'project'
  runtime: 'claude-code' | 'codex'
  userInvokable?: boolean       // from frontmatter
  args?: string                 // from frontmatter
}
```

**CP proxy**: `GET /api/skills/discover?machineId=...&runtime=...&projectPath=...`

#### Machine Capabilities Sync (new)

**CP**: `POST /api/machines/:machineId/sync-capabilities`

1. Calls MCP discovery endpoint on target machine (for each managed runtime the machine supports)
2. Calls skill discovery endpoint on target machine (same)
3. Updates `ManagedRuntimeConfig.mcpServers` and `skills` with discovered items
4. Updates `MachineCapabilities.mcpServerSources` / `skillSources` on the machine record, tagging each as `'discovered'`
5. Preserves existing `'manual'` entries in both config and provenance

Trigger conditions:
- **Manually**: "Refresh capabilities" button in machine settings or picker UI
- **On machine online transition**: When machine status transitions from offline → online (detected via heartbeat), trigger sync once. Not on every heartbeat — only on state transition.
- **On demand**: Picker can trigger if cached results are older than 5 minutes

## Frontend

### McpServerPicker (refactor existing)

Currently embedded in `AgentFormDialog` (create flow only). Refactor to standalone reusable component.

**Props:**
```typescript
type McpServerPickerProps = {
  machineId: string
  runtime: ManagedRuntime
  projectPath?: string
  currentOverrides: AgentMcpOverride
  onChange: (overrides: AgentMcpOverride) => void
}
```

**Migration from existing API:** The current `McpServerPicker` uses `value: Record<string, McpServerConfig>` and `onChange: (servers: Record<string, McpServerConfig>) => void`. This is a breaking change. `AgentFormDialog`'s state management must change from a flat `Record<string, McpServerConfig>` to the new `AgentMcpOverride` shape. Existing agents with `mcpServers` as a flat record are treated as `custom` entries (all pre-existing servers become `custom: [...]` with empty `excluded: []`).

**Visual states per item:**
- **Inherited** — checkbox checked, subtle "machine default" badge, discovered source label
- **Excluded** — checkbox unchecked, strikethrough name, "excluded" indicator
- **Custom** — checkbox checked, "custom" badge

**Grouping:** Items grouped by `configFile` provenance (e.g., "From ~/.claude.json", "From .codex/config.toml", "Custom").

**"Add custom server"** inline form at bottom (retained from current `McpServersTab`).

### SkillPicker (new, mirrors McpServerPicker)

**Props:**
```typescript
type SkillPickerProps = {
  machineId: string
  runtime: ManagedRuntime
  projectPath?: string
  currentOverrides: AgentSkillOverride
  onChange: (overrides: AgentSkillOverride) => void
}
```

**Same visual states:** inherited / excluded / custom.

**Each skill row shows:** name, description (from SKILL.md frontmatter), source badge (global/project).

**Grouping:** "Global (~/.claude/skills/)" and "Project (.claude/skills/)".

**"Add custom skill"** inline form at bottom.

### Integration Points

| Flow | Component | Change |
|------|-----------|--------|
| Create agent (`AgentFormDialog`) | Existing MCP step | Replace with refactored `McpServerPicker`; add `SkillPicker` |
| Edit agent — MCP tab (`McpServersTab`) | Manual JSON form | Replace with `McpServerPicker` |
| Edit agent — Skills tab (`SkillsTab`) | Does not exist | New tab with `SkillPicker` |

### UX Flow

1. User opens create/edit agent form
2. Picker calls discovery endpoint for the selected machine and agent's runtime
3. Machine defaults shown as pre-checked items
4. User toggles items on/off — generates `AgentMcpOverride` / `AgentSkillOverride`
5. Save writes overrides to agent config
6. Effective config resolved at agent start time

## Error Handling

### Discovery Failures

- **Machine offline**: Picker shows cached last-known results with "stale" badge + timestamp of last successful discovery
- **Config file parse error** (malformed TOML/JSON): Return partial results from parseable files + per-file error detail in response; picker shows warning banner listing unparseable files
- **No config files found**: Empty discovery result; picker shows "No servers/skills discovered on this machine" with guidance text

### Override Consistency

- **Machine defaults change** (user installs new MCP server): Next sync updates defaults; existing agent overrides preserved as-is
- **Discovered server removed from machine config**: Stays in agent's `excluded` list as harmless no-op; no error surfaced
- **Agent references custom server that machine can't reach**: Runtime error at agent start, not at config save time; agent logs include the unreachable server details

### Runtime Mismatch

- **Agent switches runtime** (claude-code → codex): Overrides reset to empty; picker re-discovers for new runtime; user notified that previous overrides were cleared
- **Machine has configs for both runtimes**: Picker only shows results for agent's current runtime; no cross-runtime pollution

## Testing

### Backend (Vitest)

**Unit tests:**
- `discoverCodexMcpServers()`: TOML parsing, malformed configs, missing files, empty sections
- `discoverSkills()`: SKILL.md YAML frontmatter parsing, global vs project source tagging, missing frontmatter fields
- Override resolution: `(defaults - excluded + custom)` — all combinations including empty/undefined overrides, all-excluded, custom-only, existing agents without override fields

**Integration tests:**
- `GET /api/mcp/discover?runtime=codex` with mock filesystem containing `.codex/config.toml`
- `GET /api/skills/discover?runtime=claude-code` with mock `~/.claude/skills/` directory structure
- `POST /api/machines/:machineId/sync-capabilities` — discovery → config update flow, preserving manual entries

### Frontend (Vitest)

- `McpServerPicker`: renders discovered items, toggles overrides correctly, shows inherited/excluded/custom badges, groups by source
- `SkillPicker`: same coverage as McpServerPicker, plus SKILL.md frontmatter display
- `McpServersTab`: refactored to use picker, retains custom server inline form
- `SkillsTab`: new tab renders, override state management works
- Override state round-trip: include → exclude → re-include preserves correct state

### E2E (Playwright)

- Create agent → picker shows discovered MCP servers for selected runtime → toggle some off → save → verify agent config has correct overrides
- Edit agent → MCP tab shows picker instead of manual form → modify overrides → save → verify
- Edit agent → new Skills tab visible → toggle skills → save → verify
- Switch agent runtime → verify picker refreshes with new runtime's discovered items

## Dependencies

### New: TOML parser

Codex MCP discovery requires parsing `.codex/config.toml`. The existing codebase only *writes* TOML (via string concatenation in `codex-config-renderer.ts`) but never *reads* it. Add `smol-toml` (zero-dependency, fast, ESM-native) to `packages/agent-worker/package.json`.

### Backend caching

Worker caches discovery results in memory for 60 seconds to avoid redundant filesystem scans when multiple agents on the same machine are being configured simultaneously. Cache key: `${runtime}:${projectPath || 'global'}`. Cache invalidated on `sync-capabilities` call.

## Files to Create/Modify

### New Files
- `packages/agent-worker/src/api/routes/skill-discover.ts` — skill discovery endpoint
- `packages/agent-worker/src/runtime/discovery/codex-mcp-discovery.ts` — Codex TOML MCP parser
- `packages/agent-worker/src/runtime/discovery/skill-discovery.ts` — skill filesystem scanner
- `packages/control-plane/src/api/routes/skill-discover.ts` — CP proxy for skill discovery
- `packages/web/src/components/SkillPicker.tsx` — skill picker component
- `packages/web/src/components/agent-settings/SkillsTab.tsx` — new skills tab in agent settings

### Modified Files
- `packages/shared/src/types/runtime-management.ts` — extend `ManagedSkill` with `name`, `description`, `source` fields
- `packages/shared/src/types/agent.ts` — add `AgentMcpOverride`, `AgentSkillOverride` types
- `packages/agent-worker/src/api/routes/mcp-discover.ts` — add `runtime` param, Codex support
- `packages/control-plane/src/api/routes/mcp-templates.ts` — add `runtime` param forwarding to existing MCP discovery proxy (lines 138-207)
- `packages/web/src/components/McpServerPicker.tsx` — refactor to standalone, add override states
- `packages/web/src/components/agent-settings/McpServersTab.tsx` — replace manual form with picker
- `packages/web/src/components/AgentFormDialog.tsx` — use refactored picker, add skill step
