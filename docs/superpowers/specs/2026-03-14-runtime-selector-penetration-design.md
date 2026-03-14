# Runtime Selector Penetration

**Date**: 2026-03-14
**Status**: Draft
**Scope**: Sub-project A of Codex Runtime Parity — make all create/edit/filter flows runtime-aware
**Related**: §14 MCP & Skill Auto-Discovery (per-runtime overrides depend on runtime being selectable)

## Problem

The backend fully supports both `claude-code` and `codex` runtimes, but the "classic" frontend flows (agent creation, session creation, discover page) assume Claude Code exclusively. Users cannot:

1. Create agents that run on Codex (no runtime field in `AgentFormDialog`)
2. Start sessions on Codex from `CreateSessionForm` or `DiscoverNewSessionForm`
3. See which runtime a discovered session belongs to (no runtime in `DiscoveredSession`)
4. Filter discovered or listed sessions by runtime
5. See which runtimes are installed on each machine
6. Get runtime-appropriate model lists (forms hardcode Claude models via `ALL_MODELS`)

The managed runtime sessions page (`RuntimeSessionsPage`) already has full Codex support — this spec brings the rest of the UI to parity.

## Goals

1. Every session/agent creation form includes a runtime selector
2. Model dropdowns show runtime-specific options and auto-reset on runtime change
3. Machine selectors filter by runtime availability
4. Discover page shows runtime per session and supports runtime filtering
5. Machine detail page shows installed runtimes
6. All changes are backward-compatible (existing agents/sessions default to `claude-code`)

## Non-Goals

- Codex-specific config capabilities (sandbox, approval policy, reasoning effort) — that's Sub-project B
- New runtime types beyond `claude-code` | `codex` — YAGNI until needed
- Mobile app runtime support — separate scope

## Shared Components

### `RuntimeSelector`

Reusable component for selecting a managed runtime.

```typescript
type RuntimeSelectorProps = {
  value: ManagedRuntime;
  onChange: (runtime: ManagedRuntime) => void;
  disabled?: boolean;
  variant?: 'radio' | 'dropdown';
};
```

- `radio` variant: horizontal radio group with runtime icons + labels. Used in create/edit forms where runtime is a primary choice.
- `dropdown` variant: compact select for filter bars and toolbars.
- Driven by `MANAGED_RUNTIMES` constant — adding a new runtime auto-populates.
- File: `packages/web/src/components/RuntimeSelector.tsx`

**`ManagedRuntime` vs `AgentRuntime` type handling**: `AgentRuntime` is a superset (`'claude-code' | 'codex' | 'nanoclaw' | 'openclaw'`). `RuntimeSelector` only offers `ManagedRuntime` values. When editing an agent with `runtime: 'nanoclaw'` or `'openclaw'`, the `RuntimeSelector` is hidden and a read-only badge shows the current unmanaged runtime with a note "Runtime selection is only available for managed runtimes (Claude Code, Codex)." Use `isManagedRuntime()` guard before rendering the selector.

### `RuntimeAwareModelSelect`

Model dropdown that switches options based on selected runtime.

```typescript
type RuntimeAwareModelSelectProps = {
  runtime: ManagedRuntime;
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
};
```

- Uses existing `RUNTIME_MODEL_OPTIONS[runtime]` from `packages/web/src/lib/model-options.ts` (already defined but not wired into forms).
- On runtime change: if current `value` is not in the new runtime's model list, auto-reset to that runtime's default model and call `onChange` with the new value.
- Retains free-text input option (combobox pattern) for custom model names.
- File: `packages/web/src/components/RuntimeAwareModelSelect.tsx`

### `RuntimeAwareMachineSelect`

Machine selector that shows runtime availability per machine.

```typescript
type RuntimeAwareMachineSelectProps = {
  runtime: ManagedRuntime;
  value: string;
  onChange: (machineId: string) => void;
  machines: Machine[];
  disabled?: boolean;
};
```

- Queries existing `GET /api/runtime-config/drift` endpoint to get per-machine runtime installation status (`isInstalled`, `isAuthenticated`).
- Machines without the target runtime installed: rendered as disabled with tooltip "Codex not installed on this machine" (or equivalent).
- On runtime change: if currently selected machine doesn't support the new runtime, auto-reset to first available machine and toast "Machine reset — {machineName} does not have {runtime} installed".
- File: `packages/web/src/components/RuntimeAwareMachineSelect.tsx`

## Integration Points

### `AgentFormDialog` — Create/Edit Agent

**File**: `packages/web/src/components/AgentFormDialog.tsx`

Changes:
- Add `RuntimeSelector` (radio variant) inside the Advanced section alongside the model selector (keeps the create-mode form simple; runtime + model are logically grouped since model auto-resets on runtime change)
- Replace `ALL_MODELS` dropdown with `RuntimeAwareModelSelect`
- Replace machine dropdown with `RuntimeAwareMachineSelect`
- Add `runtime` to form state, default `'claude-code'`
- Include `runtime` in form submission (`AgentConfig.runtime`)
- Edit mode: populate from `agent.runtime ?? 'claude-code'`; if `agent.runtime` is not a `ManagedRuntime`, show read-only badge instead of selector

### Agent Settings — General Tab

**File**: `packages/web/src/app/agents/[id]/settings/page.tsx` (GeneralTab)

Changes:
- Add `RuntimeSelector` (dropdown variant) in the general settings
- On runtime change: show confirmation dialog "Changing runtime will reset MCP servers and model. Continue?"
- On confirm: clear `config.mcpServers` (existing flat record), reset model to new runtime's default. If §14 override fields (`mcpOverride`, `skillOverride`) exist by implementation time, clear those too.
- Save mutation includes updated `runtime` field

### `CreateSessionForm`

**File**: `packages/web/src/components/CreateSessionForm.tsx`

Changes:
- Add `RuntimeSelector` (radio variant)
- Replace model dropdown with `RuntimeAwareModelSelect`
- Replace machine dropdown with `RuntimeAwareMachineSelect`
- Include `runtime` in session creation payload

### `DiscoverNewSessionForm`

**File**: `packages/web/src/components/DiscoverNewSessionForm.tsx`

Changes:
- Add `runtime` and `onRuntimeChange` props to `DiscoverNewSessionForm`
- Add `RuntimeSelector` (radio variant) inside the form
- Parent `DiscoverPage` manages `newRuntime` state and passes it down
- `DiscoverPage.handleNewSession()` must include `runtime` in the `api.createSession()` call

### `DiscoverPage` — Session List + Filters

**File**: `packages/web/src/views/DiscoverPage.tsx`

Changes:
- Add `newRuntime` state for the create form
- Add `RuntimeSelector` (dropdown variant) to filter toolbar for session list
- Display runtime badge on each discovered session row
- Filter sessions by runtime (client-side if backend provides the field, server-side if query param supported)

### `SessionsPage` — Unified Session List

**File**: `packages/web/src/views/SessionsPage.tsx`

Changes:
- Add runtime filter option (dropdown variant) to existing filter bar
- Display runtime badge in session rows where runtime is known

### `MachineDetailView` — Available Runtimes

**File**: `packages/web/src/views/MachineDetailView.tsx`

Changes:
- Add "Available Runtimes" section in capabilities area
- Query `GET /api/runtime-config/drift` for the machine's runtime status
- Display each runtime with status: installed + authenticated, installed but not authenticated, not installed
- No selection — display only

## Backend Changes

### DiscoveredSession runtime field

**File**: `packages/agent-worker/src/api/routes/sessions.ts` (discover endpoint)

The `DiscoveredSession` type and the worker's session discovery logic need a `runtime` field.

**Detection heuristic** (during existing filesystem scan, no extra I/O):
- Session directory contains `.claude/` markers or JSONL conversation format → `'claude-code'`
- Session directory contains `.codex/` markers → `'codex'`
- Cannot determine → `runtime: undefined`

**Prerequisite — type consolidation**: `DiscoveredSession` is currently defined independently in three places:
1. `packages/agent-worker/src/runtime/session-discovery.ts` (canonical)
2. `packages/web/src/lib/api.ts` (frontend copy)
3. `packages/control-plane/src/api/routes/sessions.ts` (as `DiscoveredSessionFromWorker`)

Before adding `runtime`, consolidate the type into `packages/shared/src/types/` and refactor all three locations to import from shared. Then add `runtime?: ManagedRuntime` to the single shared definition.

**CP proxy**: Forward the field as-is, no transformation needed.

### Session creation API — add `runtime` parameter

The `api.createSession()` function in `packages/web/src/lib/api.ts` does not currently include `runtime` in its type signature. Add `runtime?: ManagedRuntime` to the `createSession` body type. Verify the backend session creation route (`POST /api/sessions`) also accepts and forwards `runtime` — if not, add it there too.

### Other backend — no changes needed

- `AgentConfig.runtime` already exists and is read/written by agent CRUD routes
- `GET /api/runtime-config/drift` already returns per-machine runtime installation status
- Model options are frontend-only (`RUNTIME_MODEL_OPTIONS` in `model-options.ts`)

## Error Handling

### Machine doesn't support target runtime

- `RuntimeAwareMachineSelect` renders unsupported machines as disabled with explanatory tooltip
- If currently selected machine becomes unsupported after runtime switch: auto-reset to first available machine, toast warning with machine name

### Agent runtime switch

- Confirmation dialog required: "Changing runtime will reset MCP servers and model. Continue?"
- On confirm: clear `config.mcpServers`, reset model to new runtime's default. If §14 override fields (`mcpOverride`, `skillOverride`) exist by implementation time, clear those too.
- On cancel: revert runtime selector to previous value
- Existing session history is unaffected (sessions already ran with their original runtime)

### Discovered session runtime unknown

- `runtime: undefined` → UI badge shows "Unknown" with muted styling
- Runtime filter includes "All" / "Claude Code" / "Codex" / "Unknown" options
- No impact on other session operations (view, fork, etc.)

### Model auto-reset

- When runtime changes and current model is invalid for new runtime: auto-reset to default and toast "Model reset to {defaultModel}"
- Free-text model input always accepted (user can type a custom model name for any runtime)

### Backward compatibility

- Existing agents without `runtime` field → default to `'claude-code'` (matches current behavior)
- Existing session creation flows without runtime → default to `'claude-code'`
- No database migration needed — `runtime` is already an optional field on `AgentConfig`

## Testing

### Unit Tests (Vitest)

**Shared components:**
- `RuntimeSelector`: renders both runtimes, onChange fires correctly, disabled state, radio vs dropdown variants
- `RuntimeAwareModelSelect`: model list switches on runtime change, auto-reset when current model invalid for new runtime, free-text input preserved, onChange called on auto-reset
- `RuntimeAwareMachineSelect`: filters machines by runtime installation, disabled state + tooltip for unsupported machines, auto-reset on runtime switch

**Integration points:**
- `AgentFormDialog`: runtime field renders, model + machine respond to runtime change, form submission includes runtime, edit mode populates from agent.runtime
- `CreateSessionForm`: runtime selector present, model list runtime-aware, submission includes runtime
- `DiscoverNewSessionForm`: runtime selector present in form, included in submission
- `DiscoverPage`: runtime filter renders, badge displays per row, filter actually filters
- `MachineDetailView`: "Available Runtimes" section renders with correct status per runtime
- Agent Settings GeneralTab: runtime change shows confirmation, overrides reset on confirm, cancel reverts

### Backend Tests (Vitest)

- `GET /api/sessions/discover`: response includes `runtime` field
- Runtime detection: Claude Code session → `'claude-code'`, Codex session → `'codex'`, unknown → `undefined`

### E2E Tests (Playwright)

- Create agent with codex runtime → model dropdown shows Codex models → save → verify `agent.runtime === 'codex'`
- Create session with codex → verify model list → verify machine filter shows only Codex-capable machines
- Discover page → filter by "Codex" → verify filtered results → verify runtime badge
- Agent settings → change runtime claude-code → codex → confirm dialog → verify overrides cleared
- Machine detail page → verify "Available Runtimes" section shows installed runtimes

## Files to Create/Modify

### New Files
- `packages/web/src/components/RuntimeSelector.tsx` — runtime radio/dropdown component
- `packages/web/src/components/RuntimeSelector.test.tsx`
- `packages/web/src/components/RuntimeAwareModelSelect.tsx` — runtime-aware model dropdown
- `packages/web/src/components/RuntimeAwareModelSelect.test.tsx`
- `packages/web/src/components/RuntimeAwareMachineSelect.tsx` — runtime-filtered machine selector
- `packages/web/src/components/RuntimeAwareMachineSelect.test.tsx`
- `packages/web/e2e/runtime-selector.spec.ts` — E2E tests

### Modified Files
- `packages/shared/src/types/` — add `runtime` to `DiscoveredSession`
- `packages/agent-worker/src/api/routes/sessions.ts` — add runtime detection to discover endpoint
- `packages/web/src/components/AgentFormDialog.tsx` — add runtime selector, model, machine integration
- `packages/web/src/components/CreateSessionForm.tsx` — same
- `packages/web/src/components/DiscoverNewSessionForm.tsx` — add runtime selector
- `packages/web/src/views/DiscoverPage.tsx` — add runtime filter + badge
- `packages/web/src/views/SessionsPage.tsx` — add runtime filter
- `packages/web/src/views/MachineDetailView.tsx` — add "Available Runtimes" section
- `packages/web/src/app/agents/[id]/settings/page.tsx` — add runtime to GeneralTab
