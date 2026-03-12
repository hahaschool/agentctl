# Agent Detail Page UX Redesign

**Date**: 2026-03-12
**Status**: Draft
**Scope**: §11.1-11.7 — Fix 7 user-reported issues on the agent detail page

## Problem Statement

The agent detail page (`/agents/[id]`) has accumulated several UX issues as features were added incrementally:

1. **Start requires manual prompt** even when `defaultPrompt` is configured
2. **Header overflows** with long agent names
3. **Cost shows $0.00** despite cost tracking pipeline being fixed
4. **Run History bar** is a flat thin strip with minimal information value
5. **No link between Execution History and Sessions** — user can't correlate runs to sessions
6. **MCP config is fully manual** — should auto-detect from project/machine
7. **Agent edit form is a long single-column dialog** — doesn't scale with 12+ fields

## Design

### 1. Start Button + Default Prompt (§11.1)

**Current behavior:**
```typescript
// page.tsx:130
const handleStart = (): void => {
  if (!prompt.trim()) return;  // ← blocks submission
  startAgent.mutate({ id: agentId, prompt: prompt.trim() });
};
```

**New behavior:**
```typescript
const effectivePrompt = prompt.trim() || agent.config.defaultPrompt || '';

const handleStart = (): void => {
  if (!effectivePrompt) return;  // only block if NO prompt source
  startAgent.mutate({ id: agentId, prompt: prompt.trim() || undefined });
  // undefined prompt → backend uses defaultPrompt
};
```

**UI changes:**
- If `agent.config.defaultPrompt` exists and prompt input is empty:
  - Show ghost text in input: `"Default: {first 60 chars of defaultPrompt}..."`
  - "Go" button stays enabled (not grayed out)
  - Clicking "Go" sends request without `prompt` field → backend falls back to `defaultPrompt`
- If no `defaultPrompt` and prompt is empty → "Go" stays disabled (current behavior)
- Add small badge below input: "Using default prompt" when applicable

### 2. Header Overflow (§11.2)

**Fix:** Apply `truncate` to the agent name `<h1>` element:
```tsx
<h1 className="text-lg font-semibold truncate max-w-[300px]" title={agent.name}>
  {agent.name}
</h1>
```

Also ensure the status badge + model badge don't wrap — use `flex-shrink-0` on badges.

### 3. Cost Display (§11.3)

**Investigation needed:**
1. Query DB: `SELECT last_cost_usd, total_cost_usd FROM agents WHERE id = '...'`
2. Query runs: `SELECT cost_usd FROM agent_runs WHERE agent_id = '...' ORDER BY started_at DESC LIMIT 5`

**Likely fixes:**
- The agent record's `last_cost_usd` / `total_cost_usd` may not be getting updated on completion
- The completion callback (`POST /api/agents/:id/complete`) may be writing `costUsd` as string `"0"` or not at all
- The API response may be returning the raw string from DB instead of parsing to number

**Approach:**
1. Fix the completion callback to correctly update `last_cost_usd` and accumulate `total_cost_usd`
2. Add a fallback: if agent-level cost is 0 but runs have cost, compute from runs
3. Ensure the API response parses numeric strings to numbers: `Number(row.last_cost_usd) || 0`

### 4. Run History Mini-Chart (§11.4)

**Replace** the current `RunHistoryBar` (flat colored blocks) with a recharts-based mini bar chart:

```
Current:  ██ ██ ██ ░░ ██ ██ ░░ ██ ██ ██    67% success rate
Proposed: ▇▅▇▂▇▇▁▇▅▇                       67% success rate
          (height = duration, color = status)
```

**Component: `RunHistoryMiniChart`**
- Uses recharts `BarChart` with no axes, no grid, no legend
- Height: 48px (vs current 20px)
- Bar width: flexible based on count (max 30 runs)
- Bar height: proportional to duration (min 4px for 0s runs)
- Color: green (success), red (failure), amber (timeout), gray (cancelled), blue (running)
- Tooltip on hover: date, status, duration, cost
- Click: scroll to that run in Execution History below
- Success rate badge stays in top-right corner

### 5. Unified Sessions + Execution History (§11.5)

**Problem:** Two separate sections showing overlapping data with no cross-reference.

**Solution:** Merge into a single **"Activity"** section that combines sessions and runs:

```
Activity  15 total                    [Filter: All ▾] [Status ▾]
─────────────────────────────────────────────────────────────
Today
  ● 3cfdb13c-678  Stopped  0s  $0.00  claude-opus-4-6  15m ago
    └─ Run #15: success, manual trigger, 0s
  ● 62582e36-aa1  Stopped  13s $0.02  claude-opus-4-6  17m ago
    └─ Run #14: success, manual trigger, 13s

Yesterday
  ● 877aa46a-53a  Stopped  0s  $0.00  claude-opus-4-6  2h ago
    └─ Run #13: failure, schedule trigger, 0s
    └─ Run #12: failure, schedule trigger, 0s
```

**Key design decisions:**
- Each session row shows: session ID (clickable → session detail), status, duration, cost, model, time
- Nested under each session: associated runs with trigger type, status, and duration
- Runs without sessions (orphaned) appear as top-level entries with a "No session" badge
- Group by date (same as current GroupedRunHistory)
- Filters apply to both sessions and runs
- Clickable session IDs navigate to session detail view

### 6. MCP Auto-Detection (§11.6)

**Three-layer MCP discovery:**

```
┌─ Layer 1: Project Discovery (highest priority) ─────────┐
│ Worker reads .mcp.json + ~/.claude.json from projectPath │
│ Returns list of configured MCP servers                    │
└──────────────────────────────────────────────────────────┘
         ↓ merge
┌─ Layer 2: Machine Inventory ─────────────────────────────┐
│ Worker reports available MCP servers in heartbeat         │
│ CP stores per-machine MCP inventory                       │
└──────────────────────────────────────────────────────────┘
         ↓ merge
┌─ Layer 3: Template Library (fallback) ───────────────────┐
│ CP maintains curated MCP server templates                 │
│ User can add custom templates                             │
└──────────────────────────────────────────────────────────┘
```

**New worker endpoint:**
```
GET /api/mcp/discover?projectPath=/Users/hahaschool/data_team_ticket_agent
→ {
    discovered: [
      { name: "claude-mem", source: "project/.mcp.json", config: {...} },
      { name: "slack", source: "~/.claude.json", config: {...} }
    ],
    machine: [
      { name: "filesystem", available: true, config: {...} }
    ]
  }
```

**UI: MCP picker (replaces manual form)**
```
MCP Servers
  ✅ claude-mem     (auto-detected from project)    [Configure ▾]
  ✅ slack          (auto-detected from ~/.claude)   [Configure ▾]
  ☐  filesystem    (available on this machine)       [Configure ▾]
  ── Templates ──
  ☐  memory-server  (npx @anthropic/memory-server)  [Configure ▾]
  ☐  Custom...      [+ Add manually]
```

**Runtime awareness:**
- Claude Code agents: full MCP support, `.mcp.json` discovery
- Codex agents: MCP not applicable, show "MCP is not available for Codex agents" info
- Runtime selector determines which MCP UI to show

### 7. Agent Settings Full-Page Redesign (§11.7)

**Replace** the single-column dialog with a full-page settings view.

**URL:** `/agents/[id]/settings` (new route, linked from "Edit" button)

**Layout:**
```
┌─ Agent Settings ─────────────────────────────────────────┐
│                                                           │
│  ┌── Tabs ──────────────────────────────────────────┐    │
│  │ General │ Prompts │ Tools & Perms │ MCP │ Memory │    │
│  └──────────────────────────────────────────────────┘    │
│                                                           │
│  [Tab content area — form fields for selected tab]        │
│                                                           │
│  ┌─────────────────────────┐                              │
│  │ Save Changes   Discard  │                              │
│  └─────────────────────────┘                              │
└───────────────────────────────────────────────────────────┘
```

**Tab breakdown:**

| Tab | Fields |
|-----|--------|
| **General** | name, machine, type, schedule (with CronBuilder), runtime |
| **Prompts** | initialPrompt, defaultPrompt, systemPrompt, maxTurns |
| **Tools & Permissions** | permissionMode, allowedTools (multi-select), disallowedTools (multi-select) |
| **MCP Servers** | Auto-detected list + manual override (§11.6 picker UI) |
| **Memory** | memoryScopeId, memoryMaxTokens, memoryMaxFacts |

**Quick-create stays as dialog** — simplified form with just: name, machine, prompt, model. Advanced config is done via the settings page after creation.

**Each tab:**
- Loads current config values on mount
- Validates on change
- "Save Changes" button per tab (independent saves)
- "Discard" resets to last saved state
- Unsaved changes badge on tab header

## Implementation Priority

| Phase | Items | Effort |
|-------|-------|--------|
| Phase A (quick fixes) | §11.1 (prompt), §11.2 (overflow) | Small — 2 files, ~30 lines |
| Phase B (data fixes) | §11.3 (cost) | Medium — investigate + fix pipeline |
| Phase C (UI improvements) | §11.4 (mini-chart), §11.5 (unified activity) | Medium — 2 new components |
| Phase D (settings redesign) | §11.7 (tabbed settings), §11.6 (MCP discovery) | Large — new page + worker endpoint |

Phases A-C can be parallelized. Phase D is the largest piece and should follow.

## Files Affected

| File | Changes |
|------|---------|
| `packages/web/src/app/agents/[id]/page.tsx` | §11.1-11.5 (prompt, overflow, cost, chart, activity) |
| `packages/web/src/app/agents/[id]/settings/page.tsx` | §11.7 (new file — tabbed settings page) |
| `packages/web/src/components/RunHistoryMiniChart.tsx` | §11.4 (new file — recharts mini chart) |
| `packages/web/src/components/AgentActivityTimeline.tsx` | §11.5 (new file — unified sessions+runs) |
| `packages/web/src/components/McpServerPicker.tsx` | §11.6 (new file — auto-detect + picker UI) |
| `packages/web/src/components/AgentFormDialog.tsx` | §11.7 (simplify to quick-create only) |
| `packages/agent-worker/src/api/routes/mcp.ts` | §11.6 (new file — discover endpoint) |
| `packages/control-plane/src/api/routes/agents.ts` | §11.3 (fix cost update in completion) |
| `packages/control-plane/src/registry/db-registry.ts` | §11.6 (store machine MCP inventory) |
