# Design: Manual Remote Takeover for Claude Runtime Sessions

> Date: 2026-03-11
> Status: Approved
> Scope: Add a narrow manual takeover surface for existing Claude managed runtime sessions without replacing the current `claude -p` managed-session path.

## Summary

AgentCTL already has three distinct session-control paths:

- `claude -p` as the primary managed Claude runtime path
- Agent SDK for hook-heavy/background execution
- tmux fallback for emergency/manual attachment

The repo also contains an `RcSessionManager` spike that can launch `claude remote-control` and capture a `claude.ai/code` session URL, but that spike is not connected to the runtime-session APIs, managed-session persistence, or the existing web/mobile runtime session views.

The recommended design is to treat Remote Control as an **operator-invoked manual takeover surface attached to an existing `claude-code` managed session**, not as a new orchestration backend.

This slice:

1. Starts a separate `claude remote-control` process on the same worker for an existing Claude managed session
2. Persists the active takeover state under `managed_sessions.metadata.manualTakeover`
3. Exposes explicit start/status/stop endpoints through the control plane
4. Renders a new `Manual Takeover` section in runtime-session detail views

This slice does **not** change loops, scheduler flows, `sdk-runner`, or the current `claude -p` runtime adapter contract.

## Goals

1. Let an operator open an existing Claude managed session in `claude.ai/code` as a manual takeover action
2. Keep the current managed-session row as the source of truth rather than creating a third primary session model
3. Persist enough takeover state that refresh/reconnect flows remain understandable to web/mobile operators
4. Keep the blast radius small by reusing the existing worker and control-plane runtime-session plumbing
5. Make failure modes explicit: one active takeover per project/session, process-liveness checks, explicit revoke

## Non-Goals

1. Replacing `claude -p` as the primary Claude managed-session backend
2. Routing loops, scheduler jobs, or autonomous runs through Remote Control
3. Changing `AgentInstance`, `sdk-runner`, loop control, or scheduled-session execution
4. Creating a cross-runtime feature; this is Claude-only in the initial slice
5. Introducing automatic failover or `preferRemoteControl` dispatch for new runs
6. Adding a new `managed_runtime` or `session_handoff` table just for takeover
7. Building a real-time event bridge from Remote Control into AgentCTL; the CLI does not expose a compatible structured stream today

## Current State and Constraints

### Managed-session plane already exists

The control plane already tracks runtime sessions in `managed_sessions` with:

- `runtime`
- `nativeSessionId`
- `machineId`
- `projectPath`
- `status`
- `metadata`

That table is already the canonical place to hang runtime-scoped state for Claude Code and Codex. Reusing it avoids inventing a parallel persistence model.

### `RcSessionManager` is a narrow spike, not a product surface

`packages/agent-worker/src/runtime/rc-session-manager.ts` already supports:

- spawning `claude remote-control`
- spawning `claude --resume <id> --remote-control`
- parsing the `https://claude.ai/code/...` URL from stdout
- tracking in-memory RC session lifecycle and process health

It does **not** currently:

- register with the worker API server
- integrate with the runtime registry
- update `managed_sessions`
- expose control-plane-facing endpoints
- feed the existing runtime session UI

### Remote Control constraints are materially different from `-p`

The decision memo for 2026-03-10 already established the hard constraints:

- human-first relay model
- the local process must stay alive
- only one active remote-control session per directory
- no local structured event stream like `--output-format stream-json`
- browser auth and `claude.ai/code` state are outside AgentCTL control

These constraints are exactly why this must stay a narrow manual surface rather than become a runtime replacement.

### Existing `layer-router` remote-control selection is not the right abstraction

There is legacy dispatcher code that can select `remote-control` as a `SessionLayer` when `preferRemoteControl` is set on a Max-plan machine. That path is an orchestration-time layer decision for **new sessions**.

This design is deliberately different:

- it starts from an **existing Claude managed session**
- it exposes an **explicit operator action**
- it does **not** alter the default selection of `cli-p`

So this slice should not wire itself through `layer-router` or revive `preferRemoteControl` semantics.

## Approaches Considered

### 1. Promote Remote Control into a first-class primary runtime

Treat Remote Control as another runtime-control backend alongside `claude -p` and Codex, then route new Claude sessions into it when requested.

Pros:

- consistent with the old `layer-router` idea
- fewer concepts on paper

Cons:

- contradicts the existing decision memo
- collides with loop/scheduler assumptions
- requires worker-local lifecycle/event semantics that the Remote Control CLI does not expose
- creates pressure to rewrite the stable `claude -p` path

Rejected.

### 2. Create a separate managed-session row for every manual takeover

Store Remote Control takeovers as a second managed session, linked back to the source Claude session.

Pros:

- explicit persistence model
- easier to query “active takeovers” in SQL

Cons:

- invents a third session meaning inside the same table
- complicates runtime lists and status semantics
- makes one operator action look like a second runtime run
- requires new linking and filtering logic everywhere

Rejected.

### 3. Attach takeover state to the existing Claude managed session

Persist active takeover state inside `managed_sessions.metadata.manualTakeover`, and expose dedicated start/status/stop endpoints.

Pros:

- smallest safe slice
- preserves current session identity
- keeps manual takeover conceptually subordinate to the main Claude runtime session
- avoids schema churn
- maps directly onto the web/mobile runtime-session detail surfaces that already exist

Cons:

- requires metadata merge semantics in the store
- historical reporting is audit-log based rather than SQL-first in the first slice

Recommended.

## Recommended Architecture

### 1. Identity model

Manual takeover is modeled as an **optional attached surface** for an existing `claude-code` managed session.

Eligibility:

- `runtime === 'claude-code'`
- `status` is `active` or `paused`
- `nativeSessionId` exists

Key consequence:

- the managed session ID remains the stable product identity
- the RC process is an auxiliary operator surface for that session
- start/stop of the takeover does not create a new managed session row

### 2. Data model

Use `managed_sessions.metadata.manualTakeover` as the persistence location.

Recommended shape:

```ts
type ManualTakeoverStatus = 'starting' | 'online' | 'reconnecting' | 'stopped' | 'error';

type ManualTakeoverPermissionMode = 'default' | 'accept-edits' | 'plan';

type ManualTakeoverState = {
  workerSessionId: string;
  nativeSessionId: string;
  projectPath: string;
  status: ManualTakeoverStatus;
  permissionMode: ManualTakeoverPermissionMode;
  sessionUrl: string | null;
  startedAt: string;
  lastHeartbeat: string | null;
  lastVerifiedAt: string | null;
  error: string | null;
};
```

Why metadata instead of a new table:

- the feature is subordinate to one managed session
- active state is small and sparse
- the repo already uses `metadata` JSONB for runtime-specific details
- we can ship a narrow slice without adding migrations

Important implementation detail:

`ManagedSessionStore.updateStatus()` currently overwrites `metadata` wholesale. This slice needs a safe metadata-merge path so `manualTakeover` updates do not clobber existing handoff metadata.

### 3. Worker ownership

The worker owns the Remote Control subprocess and liveness truth.

Recommended worker responsibilities:

- instantiate one `RcSessionManager` alongside the worker API server
- start a remote-control session with `--resume <nativeSessionId> --remote-control`
- dedupe by `nativeSessionId` or `projectPath` so only one active takeover exists per session/directory
- expose start/status/stop endpoints
- report process failure and heartbeat timestamps

The worker should not attempt to translate RC output into the managed session stream. The operator already gets the interactive browser UI from `claude.ai/code`; AgentCTL only needs status and control.

### 4. API surface

#### Control plane endpoints

Add explicit runtime-session takeover routes:

- `POST /api/runtime-sessions/:id/manual-takeover`
- `GET /api/runtime-sessions/:id/manual-takeover`
- `DELETE /api/runtime-sessions/:id/manual-takeover`

Control-plane responsibilities:

- validate the managed session exists and is Claude-backed
- resolve the correct worker by `machineId`
- proxy start/status/stop requests to the worker
- sync `metadata.manualTakeover` after successful worker responses
- reconcile stale state when the worker no longer has the RC session

#### Worker endpoints

Add worker runtime-session takeover routes:

- `POST /api/runtime-sessions/:sessionId/manual-takeover`
- `GET /api/runtime-sessions/:sessionId/manual-takeover`
- `DELETE /api/runtime-sessions/:sessionId/manual-takeover`

At the worker layer, `:sessionId` should refer to the Claude native session ID that Remote Control resumes.

### 5. Lifecycle

#### Start

1. Operator selects a Claude managed session in the runtime-session detail UI
2. UI calls `POST /api/runtime-sessions/:id/manual-takeover`
3. Control plane validates the session and proxies to the worker
4. Worker starts or reuses an RC process for that native session
5. Worker returns `{ sessionUrl, status, workerSessionId, lastHeartbeat }`
6. Control plane stores the state in `metadata.manualTakeover`
7. UI offers `Open`, `Copy URL`, and `Revoke`

#### Status / refresh

1. UI calls `GET /api/runtime-sessions/:id/manual-takeover`
2. Control plane reads stored state, then asks the worker for current liveness
3. If worker still owns the RC process, the control plane refreshes `lastHeartbeat` and `status`
4. If worker says the session is missing, the control plane marks the takeover `stopped` or `error` and returns the reconciled state

#### Stop / revoke

1. Operator clicks revoke
2. Control plane proxies `DELETE`
3. Worker sends `/exit`, then falls back to `SIGTERM` if needed
4. Control plane persists a terminal `manualTakeover` state with `status: 'stopped'`

#### Worker restart

`RcSessionManager` is in-memory. After worker restart:

- prior RC processes are gone
- stored `manualTakeover` metadata may be stale
- the next `GET` should reconcile the stale state and mark it inactive

This is acceptable for the first slice because Remote Control is explicitly ephemeral and manual.

### 6. UI entry points

Manual takeover should appear only in runtime-session detail views, never in top-level list rows.

#### Web

Add a new `Manual Takeover` card to `RuntimeSessionPanel` for Claude sessions:

- permission mode selector
- start/open/copy/revoke actions
- active status badge
- last verified / heartbeat timestamps
- current warning text that this is a manual operator surface, not the managed execution backend

#### Mobile

Add a corresponding section to `runtime-session-screen`:

- start takeover
- open or copy session URL
- revoke takeover
- status summary

Web can be the more complete first-class operator surface; mobile parity can trail slightly as long as the state is visible.

### 7. Audit and permissions

Manual takeover must remain explicit and observable.

Rules:

- no automatic takeover triggers
- no use from loops or scheduled sessions
- no implicit invocation from handoff flows
- only expose the full session URL from the dedicated detail endpoint
- never include the raw session URL in logs

Recommended audit events:

- `runtime.manual_takeover.started`
- `runtime.manual_takeover.reused`
- `runtime.manual_takeover.revoked`
- `runtime.manual_takeover.reconciled_missing`
- `runtime.manual_takeover.error`

The first slice can emit these through existing structured logging/audit infrastructure rather than introducing a new SQL history table.

### 8. Security constraints

The Remote Control session URL should be treated as sensitive operational data:

- return it only from the dedicated detail endpoint
- omit it from generic `GET /api/runtime-sessions` responses
- redact it from logs
- keep it scoped to explicit operator actions

This does not make the URL cryptographically safe, but it keeps the blast radius aligned with the narrow takeover scope.

## Minimal Safe Slice

The smallest useful product slice is:

1. Claude-only
2. metadata-backed persistence
3. start/status/stop control-plane proxy
4. worker-backed RC process lifecycle
5. web detail-panel UI

Everything else is secondary:

- mobile polish
- richer audit history views
- dispatcher cleanup for old `preferRemoteControl` concepts

## Risks

1. The Remote Control CLI still does not provide a structured event stream, so AgentCTL cannot mirror the live browser session with the same fidelity as `claude -p`
2. The session URL is sensitive and ephemeral; if it leaks into logs or broad list payloads, the feature becomes too permissive
3. The “one session per directory” relay rule means the worker must reject or reuse duplicate takeovers predictably
4. Worker restart destroys in-memory RC state, so status reconciliation must be intentional
5. Browser auth/session validity remains external to AgentCTL and can fail even when the worker-side RC process is healthy

## Explicitly Not Doing in This Slice

1. Changing the primary Claude runtime adapter from `CliSessionManager` to `RcSessionManager`
2. Creating `claude-remote-control` as a new `ManagedRuntime`
3. Routing new sessions through dispatcher `remote-control` selection
4. Changing loops, scheduler jobs, or `sdk-runner`
5. Unifying Remote Control with cross-runtime handoff semantics
6. Building Codex or cross-runtime manual takeover equivalents
