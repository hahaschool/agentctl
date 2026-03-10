# Design: Unified Sessions UI

> Date: 2026-03-10
> Status: Approved
> Scope: Merge `/sessions` and `/runtime-sessions` into a single web session browser while keeping the current backend session models separate.

## Summary

AgentCTL currently exposes two session browsers in the web app:

- `/sessions` for agent sessions
- `/runtime-sessions` for managed Claude Code / Codex runtime sessions

This split was acceptable while runtime management was still landing, but it is now the wrong long-term UX.

The `sessions` page already carries most of the mature interaction model in the product: search, filtering, bulk actions, detail-side workflows, create/resume/fork, and session-centric navigation. Keeping a second page for runtime sessions duplicates list-shell logic, splits user attention, and makes every future workflow harder to discover.

The recommended design is:

1. Keep `/sessions` as the only primary session browser
2. Default the page to a unified `All` view
3. Preserve the existing backend distinction between `agent session` and `runtime session`
4. Introduce a unified frontend view model that renders both types in one browser
5. Keep `/runtime-sessions` temporarily as a compatibility route that redirects to `/sessions?type=runtime`

This gives users one place to look for active work without forcing a risky data-model rewrite.

## Goals

1. Make `/sessions` the single primary entry point for all session browsing
2. Default the browser to `All` so users see both agent and runtime activity by default
3. Preserve the existing investment in `SessionsPage` interactions and affordances
4. Add runtime-specific actions and diagnostics without regressing agent-session workflows
5. Reduce future maintenance cost by eliminating two parallel page shells

## Non-Goals

1. Merge the backend `sessions` and `managed_sessions` tables in this slice
2. Rewrite worker/control-plane APIs into one unified session endpoint in this slice
3. Remove runtime-specific concepts such as handoff history, native import preflight, or config revision
4. Redesign the detailed session content/replay model in this slice
5. Mobile unification in the same change; web is the first target

## Why there are currently two session systems

The two session systems are not accidental duplication. They represent two distinct layers.

### Agent session

The existing `Session` model represents an AgentCTL run/session:

- tied to an `agentId`
- carries run metadata such as `costUsd`, `messageCount`, `pid`, `claudeSessionId`
- supports operations such as message send, resume, fork, replay, delete, and context-aware agent workflows

This is the business-layer session the product originally revolved around.

### Runtime session

The `ManagedSession` / `RuntimeSession` model represents a managed Claude Code or Codex runtime session:

- tied to `runtime`, `nativeSessionId`, `configRevision`
- tracks runtime-specific lifecycle like `handoffStrategy`, `handoffSourceSessionId`
- supports cross-runtime handoff, native import preflight, runtime-aware fork/resume, and config-synchronized execution

This is the execution-layer session introduced by runtime management.

### Why we should not force a backend merge right now

A hard backend merge would mix incompatible concerns into one schema and one route family:

- agent-oriented fields (`agentName`, `costUsd`, `claudeSessionId`) are not general runtime concepts
- runtime-oriented fields (`runtime`, `handoffStrategy`, `nativeSessionId`, `configRevision`) are not meaningful for all agent sessions
- the lifecycle semantics are different enough that a premature schema unification would increase risk without improving user experience immediately

The right near-term move is UI unification first, storage/API unification later only if it proves valuable.

## UX Model

### Primary route

Use `/sessions` as the canonical session browser.

Introduce a top-level `Session Type` filter with values:

- `All`
- `Agent`
- `Runtime`

Default value: `All`

### All view

The list includes both session types, ordered by recent activity.

Each row shows a type badge:

- `Agent`
- `Runtime · Claude Code`
- `Runtime · Codex`

Rows share a common list layout, but the detail/actions area can branch based on type.

### Agent view

This is the current `/sessions` behavior, preserved as closely as possible.

### Runtime view

This surfaces the current `/runtime-sessions` workflows inside the same page shell:

- runtime filtering
- handoff preflight
- handoff initiation
- native import / fallback diagnostics
- handoff history

## Information architecture

Reuse the existing `SessionsPage` shell and split it into composable layers:

1. Unified page state and filters
2. Unified list view model
3. Type-specific detail panel/actions

The key design principle is:

- shared list shell
- type-specific capabilities

That avoids flattening meaningful runtime behaviors into generic, opaque rows.

## Data model strategy

Keep fetching from two APIs:

- `GET /api/sessions`
- `GET /api/runtime-sessions`

Then build a web-only normalized type such as:

```ts
type UnifiedSessionRow =
  | { kind: 'agent'; agentSession: Session; activityAt: string | null }
  | { kind: 'runtime'; runtimeSession: RuntimeSession; activityAt: string | null };
```

This unified row type should drive list rendering, search, sort, and top-level selection.

### Shared row fields

The unified mapper should expose:

- `id`
- `kind`
- `machineId`
- `projectPath`
- `status`
- `activityAt`
- `label`
- `secondaryLabel`
- `searchTerms`

### Type-specific enrichments

Agent rows keep:

- cost/message stats
- model
- agent name
- replay/message actions

Runtime rows keep:

- runtime label
- native session ID summary
- config revision
- handoff state
- runtime-specific diagnostics

## Search and filters

Top-level filters should become:

- `Type`: `All | Agent | Runtime`
- `Status`
- `Machine`
- free-text search

Runtime-only secondary filters should appear when `Type` is `Runtime` or when a runtime row is selected:

- runtime kind (`Claude Code`, `Codex`)
- handoff history filter

This prevents the all-view from becoming visually overloaded.

## Detail panel strategy

Do not try to collapse all detail UI into a single generic panel.

Instead:

- keep the existing agent detail panel path for `kind: 'agent'`
- embed the existing runtime detail/handoff panel path for `kind: 'runtime'`

This means the page unifies navigation and discovery without pretending the actions are identical.

## Route migration

### Canonical

- `/sessions`

### Compatibility

- `/runtime-sessions` should redirect to `/sessions?type=runtime`

This preserves bookmarks and existing links while guiding all new usage into one place.

## Dashboard and navigation follow-up

Once `/sessions` is unified:

- dashboard quick links to `Runtime Sessions` should collapse into `Sessions`
- sidebar should expose only `Sessions`
- command palette should direct runtime session browsing into `/sessions?type=runtime`

These can be done in the same implementation if low-risk, or immediately after the page merge.

## Risks

### Risk 1: sessions page becomes too dense

Mitigation:

- keep type-specific actions hidden unless the row type is selected
- keep runtime-only filters contextual
- preserve the existing agent-session default interaction patterns inside the unified shell

### Risk 2: query/model complexity increases too quickly

Mitigation:

- create a dedicated `unified session row` mapper module
- avoid inlining normalization logic across the page component
- keep agent and runtime detail components separate

### Risk 3: regressions in existing agent workflows

Mitigation:

- preserve current agent tests
- add targeted tests for mixed lists, default `All`, and runtime-only filtering
- land the route redirect only after the unified page is stable

## Testing Strategy

1. Extend `SessionsPage` tests for `All`, `Agent`, and `Runtime` modes
2. Add mixed-list tests for search, sort, and selection
3. Preserve existing runtime handoff/history tests by rehoming them into the unified page
4. Add route tests for `/runtime-sessions` redirecting to `/sessions?type=runtime`
5. Run targeted web tests plus a production build

## Recommended rollout

1. Add unified data model and `Type` filter inside `/sessions`
2. Render runtime rows in the existing sessions shell
3. Move runtime detail/handoff UI into the unified page
4. Convert `/runtime-sessions` into a redirect
5. Clean up dashboard/sidebar references after verification

## Recommendation

Unify the browser now, but do not unify the backend session models yet.

That gives users one obvious place to manage active work, preserves the mature `sessions` experience, and avoids a needless schema/API migration in the same slice.
