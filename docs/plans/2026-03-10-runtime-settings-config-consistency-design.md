# Design: Runtime Settings and Config Consistency UI

> Date: 2026-03-10
> Status: Approved
> Scope: Web settings UI for machine-local Claude Code / Codex access and managed config consistency

## Summary

AgentCTL already has backend support for managed Claude Code and Codex configuration:

- canonical runtime defaults in the control plane
- worker-side config renderers for Claude Code and Codex
- per-machine runtime capability probing (`installed`, `authenticated`)
- drift inspection (`in-sync`, `drifted`, version/hash mismatch)

What is missing is a frontend surface that exposes these capabilities clearly.

The current settings page only exposes cloud API accounts and project account overrides. That creates two user-facing failures:

1. There is no obvious place to manage machine-local Claude Code / Codex access
2. There is no UI to inspect or repair Claude/Codex configuration consistency across machines

The recommended design is to add a dedicated `Claude & Codex` group to the web settings page with two sections:

1. `Machine Runtime Access`
2. `Config Consistency`

## Goals

1. Restore a visible place in settings for Codex-related setup
2. Make Claude Code and Codex machine-local login state visible per machine
3. Make managed runtime config defaults editable from the UI
4. Show config drift across machines and runtimes
5. Provide machine-level actions to refresh state, sync config, and open terminal/login flows
6. Reduce confusion between cloud API accounts and local CLI runtime access

## Non-Goals

1. Centralized remote storage of Claude/Codex CLI credentials in this slice
2. Automatic remote login without user interaction
3. Batch rollout workflows beyond simple sync actions
4. Mobile parity in this slice
5. New backend runtime-management primitives unless required for frontend support

## Validated Constraints

### Existing backend surface already exists

Control-plane routes already expose:

- `GET /api/runtime-config/defaults`
- `PUT /api/runtime-config/defaults`
- `POST /api/runtime-config/sync`
- `GET /api/runtime-config/drift`

Worker runtime config state already includes:

- `installed`
- `authenticated`

This means the feature gap is mostly frontend composition.

### Runtime login is machine-local

Worker probing currently treats authentication as machine-local state:

- Claude Code: `ANTHROPIC_API_KEY` or `~/.claude.json`
- Codex: `OPENAI_API_KEY` or `~/.codex/auth.json`

That is the correct model for this feature. The UI should surface machine-local status and help the user complete login on the target machine. It should not silently move CLI auth secrets through the control plane.

### Terminal support already exists

The web app already supports machine terminals via `/api/machines/:id/terminal` and an interactive terminal page. That makes it practical to provide an `Open Terminal` action as the primary runtime-login entrypoint.

## UX Model

### Rename existing account concept

Current `API Accounts` is actually cloud provider credential management, not runtime CLI access.

To reduce confusion:

- keep the existing accounts model intact
- rename the settings group title to `Cloud API Accounts`
- add a new sibling settings group titled `Claude & Codex`

### Section 1: Machine Runtime Access

This section is machine-centric.

For each machine, render two runtime cards:

- `Claude Code`
- `Codex`

Each runtime card shows:

- install status
- authentication status
- sync status
- applied config version/hash summary when available
- last applied timestamp when available
- metadata hints when present

Actions:

- `Open Terminal`
  - deep-link to `/machines/[id]/terminal`
- `Run Claude Login`
  - opens terminal page with suggested command copy text (`claude login` or `claude setup-token`)
- `Run Codex Login`
  - opens terminal page with suggested command copy text (`codex login`)
- `Refresh Status`
  - refreshes query state from control plane
- `Sync Config`
  - triggers managed config sync for that machine using current defaults version

The first release does not need remote command execution from settings. Deep-link plus suggested login command is sufficient and safer.

### Section 2: Config Consistency

This section is config-centric.

It shows:

- active managed runtime defaults
- editable defaults fields that already map cleanly to the backend model
- drift table grouped by machine and runtime

Initial editable fields:

- `instructions.userGlobal`
- `instructions.projectTemplate`
- `sandbox`
- `approvalPolicy`
- `environmentPolicy.inherit`
- `environmentPolicy.set` as JSON text

For this first slice, MCP servers and skills can remain read-only summaries if needed. That keeps the form tractable while still making Codex/Claude config management visible and useful.

Actions:

- `Save Defaults`
  - `PUT /api/runtime-config/defaults`
- `Sync Drifted Machines`
  - calls `POST /api/runtime-config/sync` with only drifted machine IDs
- `Sync Selected Machine`
  - machine-level action in drift rows/cards
- `Refresh Drift`
  - refetch defaults + drift

## Data Model Mapping

### Defaults

Map control-plane `ManagedRuntimeConfig` directly into a form state model.

### Drift items

Map `GET /api/runtime-config/drift` items into runtime status cards using:

- `machineId`
- `runtime`
- `isInstalled`
- `isAuthenticated`
- `syncStatus`
- `configVersion`
- `configHash`
- `metadata`
- `lastConfigAppliedAt`
- derived `drifted`

### Machine join

Join drift items with `listMachines()` to display hostname, OS, and status.

## UI Composition

New web view components:

- `RuntimeAccessSection`
- `RuntimeConsistencySection`

Settings page structure becomes:

1. `Cloud API Accounts`
2. `Claude & Codex`
3. `Appearance & Preferences`
4. `System`

## API / Query Additions

Web client additions:

- `getRuntimeConfigDefaults()`
- `updateRuntimeConfigDefaults()`
- `getRuntimeConfigDrift(machineId?)`
- `syncRuntimeConfig(machineIds, configVersion)`

React Query additions:

- `runtimeConfigDefaultsQuery()`
- `runtimeConfigDriftQuery(machineId?)`
- `useUpdateRuntimeConfigDefaults()`
- `useSyncRuntimeConfig()`

## Testing Strategy

### Web API/query tests

Add coverage for the four runtime-config client methods and corresponding query keys.

### Component tests

Add focused tests for:

- `SettingsView` rendering new group and renamed cloud accounts group
- `RuntimeAccessSection`
  - renders machine/runtime status
  - shows Claude/Codex actions
  - sync action calls the right mutation
- `RuntimeConsistencySection`
  - renders defaults form
  - shows drift rows
  - saves defaults
  - syncs drifted machines

## Risks and Tradeoffs

### Not true remote login automation

This slice does not directly write runtime auth credentials to machines. That is intentional. CLI authentication is machine-local and deserves a separate security design before any centralized secret movement is added.

### Partial defaults editor in v1

Editing the full runtime config document in one shot would be too much UI for a first slice. Restricting v1 to the highest-value fields keeps implementation understandable and testable.

## Follow-Up Work

1. Add remote command execution / prefilled terminal sessions from settings
2. Add batch sync policies and rollout controls
3. Add mobile runtime settings summary and drift view
4. Add richer editors for MCP servers and skills
5. Add secure machine-scoped credential injection only after explicit security review
