# Agent Settings Config Preview Sidebar

**Date**: 2026-03-15
**Status**: Draft
**Scope**: Redesign agent settings page layout with persistent config preview sidebar

## Problem

Config Preview is buried inside the Runtime Config tab as a collapsible section. Users need to see what configuration files will be written when an agent runs — and whether each file is managed by AgentCTL, merged with overrides, or left as-is from the project directory. This information should be visible regardless of which settings tab is active.

## Goals

1. Agent settings page becomes a two-column layout with persistent config preview on the right
2. Each config file shows its override status (Managed / Merged / Original)
3. Preview updates automatically when settings are saved
4. Works on mobile (preview collapses to bottom panel)

## Non-Goals

- Live preview of unsaved changes (too complex, confusing with dirty state)
- Syntax highlighting library (use simple regex-based coloring)
- Editing config files directly in the preview panel
- Probing project filesystem for "original" files (simplification: files not managed by AgentCTL are omitted)

## Layout

Settings page changes from single-column to **left 60% + right 40%** grid.

**Container width change**: The current `max-w-[900px]` is too narrow for two columns. Change to `max-w-[1400px]` to give the left column ~840px (enough for 7 tab labels) and right column ~560px.

```
┌─────────────────────────────┬──────────────────────┐
│  Tabs + Forms (60%)         │  Config Preview (40%) │
│                             │  [sticky, scrollable] │
│  ┌─────────────────────┐    │                      │
│  │ General │ Model │ ...│    │  .claude/settings.json│
│  ├─────────────────────┤    │  ● Managed            │
│  │                     │    │  ┌──────────────────┐ │
│  │  Form fields...     │    │  │ { "sandbox": ... }│ │
│  │                     │    │  └──────────────────┘ │
│  │                     │    │                      │
│  │                     │    │  .mcp.json            │
│  │                     │    │  ● Managed            │
│  │                     │    │  ┌──────────────────┐ │
│  │                     │    │  │ { "mcpServers".. }│ │
│  └─────────────────────┘    │  └──────────────────┘ │
└─────────────────────────────┴──────────────────────┘
```

- Desktop (≥ 1024px): `grid grid-cols-[3fr_2fr] gap-6`
- Mobile (< 1024px): single column, preview collapses to bottom `CollapsibleSection` titled "Config Preview (N files)"
- Right column: `sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto`
- Update loading/error states to use same `max-w-[1400px]`

## Override Status Badges

Each config file header shows one of two badges:

| Badge | Color | Meaning |
|-------|-------|---------|
| Managed | `bg-green-500/10 text-green-400 border-green-500/30` | AgentCTL writes this file with fleet defaults only |
| Merged | `bg-yellow-500/10 text-yellow-400 border-yellow-500/30` | Agent overrides merged with fleet defaults |

**Simplification**: "Original" status is dropped. Files not managed by AgentCTL are omitted from the preview entirely. The preview shows only what AgentCTL will write — if it's not here, it's not touched.

### Status determination

- **Managed**: File is produced by the renderer using fleet defaults only (`runtimeConfigOverrides` is empty or has no keys affecting this file)
- **Merged**: File is produced by the renderer AND the agent has `runtimeConfigOverrides` that affect fields in this file

### Files shown per runtime

**Claude Code**: `.claude/settings.json` (home), `.claude.json` (home), `.mcp.json` (workspace), `CLAUDE.md` (workspace), `.claude/skills/agentctl-managed-skills.json` (workspace)

**Codex**: `.codex/config.toml` (home), `.codex/config.toml` (workspace), `AGENTS.md` (home), `AGENTS.md` (workspace), `.agents/skills/agentctl-managed-skills.json` (workspace)

All files produced by the renderer are shown. Default status is "Managed". Any file containing fields from `runtimeConfigOverrides` is "Merged".

## Backend

### Extend config preview endpoint

Modify the existing `GET /api/agents/:id/config-preview` (CP proxy → worker `GET /api/config/preview`).

New response:
```typescript
// In packages/shared/src/types/deployment.ts (or new config-preview.ts)
type ConfigPreviewFile = {
  path: string;              // display path, e.g. "[home] .claude/settings.json"
  scope: 'home' | 'workspace';
  content: string;           // rendered file content
  status: 'managed' | 'merged';
  overriddenFields?: string[];  // fields from agent override (for 'merged' status)
};

type ConfigPreviewResponse = {
  ok: boolean;
  runtime: string;
  files: ConfigPreviewFile[];
};
```

**Status + overriddenFields computation**: Done in the route handler (`config-preview.ts`), NOT in the renderer. The route handler already receives `overridesJson` as a query parameter. Before calling the renderer, it computes `overriddenFields` from the raw overrides object:

```typescript
function computeOverriddenFields(overrides?: AgentRuntimeConfigOverrides): string[] {
  if (!overrides) return [];
  return Object.entries(overrides)
    .filter(([_, v]) => v !== undefined)
    .map(([k]) => k);
}
```

Then after rendering, the handler annotates each file: if any of its rendered content contains keys from `overriddenFields`, status is `'merged'`; otherwise `'managed'`.

The renderers remain pure — they take config in, produce files out. No tracking logic added.

## Frontend

### New components

**`ConfigPreviewPanel.tsx`** — Right-column container
- Queries `agentConfigPreview(agentId)` with `staleTime: 10_000`
- Maps `files` array to `ConfigFileCard` components
- Shows skeleton placeholders while loading
- Shows "Preview unavailable — worker offline" on error
- `isManagedRuntime()` guard — hidden for unmanaged runtimes

**`ConfigFileCard.tsx`** — Single file display
- Props: `path`, `scope`, `content`, `status`, `overriddenFields?`
- Header: file path (monospace) + status badge
- Body: `<pre>` block with monospace content
- For `merged` status: lines containing overridden fields get a blue left border (`border-l-2 border-blue-500`)
- Collapsible via `CollapsibleSection` (inherits keyboard + ARIA support)
- Default: first file expanded, others collapsed

### Modified files

**`packages/web/src/app/agents/[id]/settings/page.tsx`**
- Change `max-w-[900px]` to `max-w-[1400px]` (all states: loading, error, content)
- Wrap existing content in grid layout
- Left column: existing tabs + tab content
- Right column: `<ConfigPreviewPanel agentId={id} runtime={agent.runtime} />`

**`packages/web/src/components/agent-settings/RuntimeConfigTab.tsx`**
- Remove the `ConfigPreview` import and rendering

**`packages/web/src/lib/api.ts`**
- Update `getAgentConfigPreview` response type to `ConfigPreviewResponse`

**`packages/web/src/lib/queries.ts`**
- Add `agentConfigPreview` to `useUpdateAgent` mutation's `onSuccess` invalidation list
- Add 500ms delay before invalidation to avoid stale worker cache

### Deleted files

- `packages/web/src/components/agent-settings/ConfigPreview.tsx` — replaced by `ConfigPreviewPanel`

## Error Handling

- Worker offline: panel shows muted message, doesn't block settings editing
- Agent has no runtime: panel hidden entirely
- Single file render fails: show that file's card with error message, other files unaffected
- Mobile: preview collapsed by default, expandable via chevron

## Testing

**Unit (Vitest)**:
- `ConfigPreviewPanel`: renders file cards, loading skeleton, error state, hidden for unmanaged runtime
- `ConfigFileCard`: managed + merged badge variants, override line highlighting, collapsible behavior

**No E2E** — visual verification on dev-1.

## Files to Create/Modify

### New
- `packages/shared/src/types/config-preview.ts` — `ConfigPreviewFile`, `ConfigPreviewResponse` types
- `packages/web/src/components/agent-settings/ConfigPreviewPanel.tsx`
- `packages/web/src/components/agent-settings/ConfigFileCard.tsx`
- `packages/web/src/components/agent-settings/ConfigPreviewPanel.test.tsx`

### Modified
- `packages/shared/src/types/index.ts` — export new types
- `packages/web/src/app/agents/[id]/settings/page.tsx` — two-column layout, max-w-[1400px]
- `packages/web/src/components/agent-settings/RuntimeConfigTab.tsx` — remove ConfigPreview
- `packages/web/src/lib/api.ts` — update response type
- `packages/web/src/lib/queries.ts` — add preview invalidation with delay
- `packages/agent-worker/src/api/routes/config-preview.ts` — return per-file response with status
- `packages/control-plane/src/api/routes/agent-config-preview.ts` — forward new response shape

### Deleted
- `packages/web/src/components/agent-settings/ConfigPreview.tsx`
