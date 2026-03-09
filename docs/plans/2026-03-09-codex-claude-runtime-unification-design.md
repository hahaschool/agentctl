# Design: Codex and Claude Runtime Unification

> Date: 2026-03-09
> Status: Approved
> Scope: Control plane + worker runtime management; no UI implementation in this slice

## Summary

AgentCTL already has strong Claude Code session control, but Codex is only present in the roadmap and project vision. The system also lacks a canonical configuration layer that can keep Claude Code and Codex aligned on MCP servers, project instructions, and reusable skills.

The recommended design is a three-layer runtime-management architecture:

1. **Canonical configuration plane** in the control plane
2. **Unified managed-session plane** for runtime-aware lifecycle tracking
3. **Cross-runtime handoff plane** with experimental native import ahead of snapshot fallback

This keeps the stable path simple:

- Same-runtime continuation uses each tool's native resume/fork support
- Cross-runtime switching uses a portable `HandoffSnapshot`
- Experimental native import is optional and never required for a successful handoff

## Validated Constraints

### Session compatibility

Local validation plus vendor documentation confirms:

- Claude Code supports its own `--resume`, `--continue`, and `--fork-session`
- Codex CLI supports its own `resume`, `exec resume`, and `fork`
- Neither tool exposes an official import path for the other tool's native session format

**Design consequence:** cross-runtime continuation cannot rely on official native session conversion.

### Configuration compatibility

Both runtimes support MCP, local instructions, and custom skill-like extensions, but their storage models differ:

- **Claude Code**: `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`, `~/.claude.json`, `.mcp.json`, `CLAUDE.md`, `.claude/skills/`
- **Codex**: `~/.codex/config.toml`, `.codex/config.toml`, `~/.codex/AGENTS.md`, `AGENTS.md`, `.agents/skills/`

**Design consequence:** AgentCTL needs a canonical representation plus per-runtime renderers.

### Existing codebase constraints

- Current session APIs and persistence are Claude-centric (`rc_sessions`, `CliSessionManager`, `sessionRoutes`)
- `agents.runtime` already exists and is validated through the API layer
- There is no current mobile or web package in the repo tree to update in the same slice
- Existing worker route and session logic is large; adding a second runtime directly into the current Claude route stack would raise regression risk

**Design consequence:** add v2 runtime-aware services and routes alongside current Claude-only routes, then migrate callers gradually.

## Goals

1. Make Codex a first-class managed runtime alongside Claude Code
2. Keep Claude/Codex config aligned across machines for MCP, instructions, and skills
3. Provide unified session discovery, creation, resume, fork, and handoff APIs
4. Preserve same-runtime native behavior
5. Support cross-runtime switching with reliable fallback semantics
6. Leave room for experimental native import without coupling core system behavior to private file formats

## Non-Goals

1. Full mobile or web UI in this slice
2. Replacing Claude-only routes immediately
3. Depending on undocumented native session file layouts as a required path
4. Building a generic plugin framework for every future runtime before Codex support ships

## Approaches Considered

### 1. Native import first

Treat Claude and Codex session files as convertible and build direct session translators first.

Pros:
- Closest to true native continuity

Cons:
- Depends on undocumented formats
- High breakage risk on CLI upgrades
- Forces the whole feature on the least stable part

### 2. Snapshot handoff only

Never try native import; always export a portable snapshot and start a new session in the target runtime.

Pros:
- Predictable and robust
- Smallest maintenance burden

Cons:
- Leaves performance and continuity benefits on the table when native import is feasible

### 3. Hybrid model (recommended)

Use canonical config + managed sessions + snapshot handoff as the official path. Add native import as an opportunistic pre-step.

Pros:
- Stable core architecture
- Same-runtime native behavior preserved
- Cross-runtime switching always succeeds through fallback
- Native import can improve experience later without changing system semantics

Cons:
- Slightly more surface area than snapshot-only

## Recommended Architecture

```text
Control Plane
├── RuntimeConfigStore
├── ManagedSessionStore
├── HandoffStore
├── RuntimeConfigRoutes (/api/runtime-config/*)
├── RuntimeSessionRoutes (/api/runtime-sessions/*)
└── HandoffRoutes (/api/runtime-sessions/:id/handoff)

Worker
├── RuntimeConfigApplier
│   ├── ClaudeConfigRenderer
│   └── CodexConfigRenderer
├── RuntimeAdapterRegistry
│   ├── ClaudeRuntimeAdapter
│   └── CodexRuntimeAdapter
├── HandoffController
│   ├── tryNativeImport()
│   └── snapshotHandoff()
└── RuntimeSessionRoutes (/api/runtime-sessions/*)
```

## Canonical Configuration Plane

### Canonical model

Introduce a control-plane-owned `ManagedRuntimeConfig` document as the single source of truth.

Core fields:

- `instructions.userGlobal`
- `instructions.projectTemplate`
- `mcpServers`
- `skills`
- `sandbox`
- `approvalPolicy`
- `environmentPolicy`
- `runtimeOverrides.claudeCode`
- `runtimeOverrides.codex`
- `version`
- `hash`

This model is runtime-neutral except for explicit overrides.

### Renderers

Two worker-side renderers materialize the canonical model into native config files.

**Claude renderer** writes:
- `~/.claude/settings.json`
- `.claude/settings.json`
- `.claude/settings.local.json` only when explicitly requested
- `~/.claude.json`
- `.mcp.json`
- `~/.claude/CLAUDE.md`
- `CLAUDE.md`
- `.claude/skills/*`

**Codex renderer** writes:
- `~/.codex/config.toml`
- `.codex/config.toml`
- `~/.codex/AGENTS.md`
- `AGENTS.md`
- `.agents/skills/*`

### Drift detection

Every apply operation returns:

- rendered file list
- content hash per file
- machine runtime capabilities
- last applied config version

The control plane stores this state and computes drift by comparing expected hashes against reported hashes. Drift is therefore explicit, auditable, and machine-specific.

## Unified Managed Session Plane

### New persistence model

Add a new `managed_sessions` table rather than forcing Codex into `rc_sessions`.

`rc_sessions` stays in place for compatibility with the current Claude session features. During migration:

- existing Claude-only flows continue to use `rc_sessions`
- new runtime-aware flows use `managed_sessions`
- Claude runtime v2 may dual-write selected session metadata into both tables until all callers move over

### Managed session shape

Key fields:

- `id`
- `runtime` (`claude-code` or `codex`)
- `machineId`
- `agentId`
- `projectPath`
- `worktreePath`
- `nativeSessionId`
- `status`
- `configRevision`
- `handoffStrategy`
- `handoffSourceSessionId`
- `metadata`

### Runtime adapters

Each runtime implements a shared adapter contract:

- `discoverSessions()`
- `startSession()`
- `resumeSession()`
- `forkSession()`
- `stopSession()`
- `streamSession()`
- `exportSnapshot()`
- `applyManagedConfig()`
- `getCapabilities()`
- `tryNativeImport()` optional

The existing `CliSessionManager` becomes an implementation detail of `ClaudeRuntimeAdapter`.

`CodexRuntimeAdapter` will use `codex exec --json`, `codex exec resume`, `codex resume`, and `codex fork` as appropriate. Initial support only needs to guarantee AgentCTL-managed Codex sessions, not arbitrary historical Codex sessions on disk.

### Session lifecycle

Managed session states:

- `starting`
- `active`
- `paused`
- `handing_off`
- `ended`
- `error`

These are intentionally runtime-agnostic.

## Cross-Runtime Handoff Plane

### Handoff snapshot

A `HandoffSnapshot` is the official portability layer.

Contents:

- `sourceRuntime`
- `sourceSessionId`
- `projectPath`
- `worktreePath`
- `branch`
- `headSha`
- `dirtyFiles`
- `diffSummary`
- `conversationSummary`
- `openTodos`
- `nextSuggestedPrompt`
- `activeConfigRevision`
- `activeMcpServers`
- `activeSkills`
- `reason`

The snapshot deliberately excludes opaque internal runtime state that cannot be portably reproduced.

### Strategy order

For cross-runtime handoff, the controller uses the following strategy order:

1. `native-import`
2. `snapshot-handoff`

If `native-import` fails for any reason, the controller records the failure and immediately retries with `snapshot-handoff`.

### Failure isolation

Native import failures must not fail the handoff request unless snapshot handoff also fails. This prevents experimental behavior from becoming an availability risk.

## Experimental Native Import

Native import is treated as capability-based experimentation.

Rules:

- feature-flagged by runtime pair and machine
- audited separately in `native_import_attempts`
- never the only path
- only receives sanitized, bounded context
- may inspect local session metadata, but private file format assumptions are isolated in dedicated modules

The first iteration only needs stub probes and failure-safe plumbing. It does not need to achieve actual import success on day one.

## Control-Plane API Changes

### New routes

`/api/runtime-config`
- `GET /defaults`
- `PUT /defaults`
- `POST /sync`
- `GET /drift`

`/api/runtime-sessions`
- `GET /`
- `POST /`
- `POST /:id/resume`
- `POST /:id/fork`
- `POST /:id/stop`
- `GET /:id/handoffs`
- `POST /:id/handoff`

### Compatibility strategy

Current `/api/sessions` remains available for the existing Claude path while v2 routes land. The control plane can later alias unified session listing back onto `/api/sessions` once callers are migrated.

## Worker API Changes

Add worker-facing routes:

- `POST /api/runtime-config/apply`
- `GET /api/runtime-config/state`
- `GET /api/runtime-sessions`
- `POST /api/runtime-sessions`
- `POST /api/runtime-sessions/:id/resume`
- `POST /api/runtime-sessions/:id/fork`
- `POST /api/runtime-sessions/:id/handoff-export`
- `POST /api/runtime-sessions/:id/native-import`
- `DELETE /api/runtime-sessions/:id`

These routes sit beside the existing Claude-only session routes rather than replacing them immediately.

## Database Changes

Add tables:

1. `managed_sessions`
2. `runtime_config_revisions`
3. `machine_runtime_state`
4. `session_handoffs`
5. `native_import_attempts`

Keep existing tables:

- `agents`
- `rc_sessions`
- `settings`

This minimizes regression risk while enabling incremental migration.

## Rollout Plan

### Phase 1

Shared contracts, migration, and persistence.

### Phase 2

Config rendering and drift detection.

### Phase 3

Codex runtime adapter and runtime-aware worker routes.

### Phase 4

Unified control-plane session APIs.

### Phase 5

Snapshot handoff.

### Phase 6

Experimental native import.

### Phase 7

Caller migration and UI follow-up in a later slice.

## Testing Strategy

### Unit

- shared type guards and serialization
- config renderers
- Codex adapter parsing
- handoff controller strategy selection
- native import feature flags

### Route

- control-plane runtime-config routes
- control-plane runtime-session routes
- worker runtime-config routes
- worker runtime-session routes

### Integration

- Claude runtime session creation still works
- Codex runtime session creation works through the new route stack
- handoff from Claude to Codex falls back correctly when native import fails
- config drift is reported when a rendered file changes on disk

## Risks

1. Codex local session discovery may be less stable than Claude session discovery
2. Native import may remain mostly experimental for some time
3. Dual-write migration requires discipline to avoid divergent semantics
4. Config rendering must avoid clobbering user-local files unless explicitly managed

## Decision Summary

1. Build Codex support on top of a new runtime-aware session plane, not the Claude-only route layer
2. Treat canonical configuration as a first-class control-plane concern
3. Make snapshot handoff the guaranteed path
4. Add native import only as an optional optimization
5. Keep backward compatibility while migrating toward unified runtime management
