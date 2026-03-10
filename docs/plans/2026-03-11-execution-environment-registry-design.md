# Design: Execution Environment Registry

> Date: 2026-03-11
> Status: Proposed
> Scope: Roadmap `2.9 Execution Environment Registry` for `direct` and `docker` environments only. No SSH, Slurm, or Kubernetes in this slice.

## Summary

AgentCTL already has a useful separation between:

- runtime semantics such as Claude/Codex session start, resume, and fork
- machine-level concerns such as runtime installation/auth probing
- low-level sandbox helpers such as filesystem isolation and network policy generation

What it does not have yet is a first-class abstraction for **where** a runtime executes.
Today, that concern is implicit: every managed runtime session runs as a direct local subprocess
on the worker host, and Docker-related behavior exists only as helper code or infra assets.

The recommended design is to introduce a dedicated `ExecutionEnvironment` layer inside the
worker. That layer prepares the execution substrate for a session, while `RuntimeAdapter`
continues to own runtime-native session semantics.

The core design decisions are:

1. Keep `RuntimeAdapter` focused on Claude/Codex lifecycle semantics
2. Add `ExecutionEnvironment` for machine-local preparation, isolation, and cleanup
3. Introduce an `ExecutionEnvironmentRegistry` in the worker with auto-detection
4. Report available execution environments through machine registration and heartbeat
5. Route managed-session creation and future agent dispatches using runtime + environment capability checks
6. Treat `DockerEnvironment` as a staged follow-up that is only fully executable after `AgentOutputStream` stabilizes

This keeps the architecture orthogonal:

```text
ExecutionEnvironment = WHERE and HOW to prepare execution
RuntimeAdapter       = WHAT runtime to launch and how its sessions behave
```

## Goals

1. Represent execution substrate separately from runtime choice
2. Support `direct` and `docker` as first-class worker execution environments
3. Surface environment availability to the control plane through existing machine registration and heartbeat flows
4. Let control-plane routing validate environment requirements before selecting a target machine
5. Reuse existing work in `fs-isolation`, `network-policy`, and runtime config management instead of replacing it
6. Create a clean path for later containerized Claude/Codex execution without rewriting runtime semantics

## Non-Goals

1. Implement the feature in this document; this is design only
2. Introduce SSH, Slurm, Kubernetes, or general remote execution strategies
3. Rewrite the current managed-session storage model around environments in one step
4. Redesign the runtime adapter contract beyond the minimal changes needed to accept prepared execution context
5. Build containerized session streaming, steering, or handoff triggers in this slice
6. Replace current worker registration tables with a new machine-capability table

## Current State

### Runtime semantics already exist

`ClaudeRuntimeAdapter` and `CodexRuntimeAdapter` already implement a runtime-centric contract:

- `startSession`
- `resumeSession`
- `forkSession`
- `getCapabilities`

These adapters know how to talk to runtime-specific session managers and how to convert runtime-native
session state into `ManagedSessionHandle`.

### Execution substrate is implicit

The worker currently assumes a local host execution path:

- the runtime managers spawn local host processes
- project paths are real host paths
- runtime config files are written directly into host home/workspace locations
- session routing does not reason about execution substrate

### Capability reporting is coarse-grained

Machine registration and heartbeat already persist a `machines.capabilities` JSONB object.
That object currently carries only:

- `gpu`
- `docker`
- `maxConcurrentAgents`

There is no notion of:

- environment availability by environment id
- default execution environment
- environment-specific metadata such as isolation mode or detected runtime

### Worker-side isolation primitives already exist

Two worker modules are directly relevant:

- `fs-isolation.ts` can validate paths and generate mount/seccomp-related arguments
- `network-policy.ts` can evaluate requests and generate Docker network arguments

These are the right building blocks for `DockerEnvironment`, but they are not yet orchestrated
as a first-class lifecycle.

## Alternatives Considered

### Option A: Fold environment choice into `RuntimeAdapter`

This would make each adapter responsible for:

- local vs Docker decisions
- config staging
- mount/network policy wiring
- runtime-native session semantics

Rejected because it mixes orthogonal concerns and duplicates environment logic across Claude and Codex.
It would also make later environment additions much more expensive.

### Option B: Adopt a full Astro-style execution strategy abstraction

This would make the execution layer responsible for both:

- environment preparation
- runtime execution semantics

Rejected because AgentCTL already has a meaningful runtime abstraction and does not need Slurm/SSH breadth.
A full strategy model is wider than the current roadmap requires.

### Option C: Add a dedicated `ExecutionEnvironment` registry under the worker

Chosen because it preserves the existing runtime split and adds the missing extension point with limited blast radius.
It also allows staged delivery: detection and routing can land before containerized execution.

## Proposed Architecture

## Responsibility Boundary

### `RuntimeAdapter` responsibilities

`RuntimeAdapter` continues to own runtime-native semantics:

- Claude vs Codex CLI/session-manager selection
- session ids and native session ids
- start/resume/fork semantics
- runtime capability reporting such as `supportsResume` and `supportsFork`
- eventual runtime-native output streaming integration

### `ExecutionEnvironment` responsibilities

`ExecutionEnvironment` owns machine-local execution preparation:

- availability detection
- worktree and execution-root preparation
- config staging for the chosen environment
- isolation wiring such as mount/network/container arguments
- temporary resource cleanup
- environment metadata for routing and audit

### Control-plane responsibilities

The control plane should not create environments itself. It should:

- persist worker-reported environment capabilities
- validate that a requested environment is available on the selected machine
- use environment requirements during machine selection
- persist chosen environment identity on managed-session records

## Core Interfaces

### Shared capability and selection types

Add environment-centric shared types under runtime management:

```ts
export type ExecutionEnvironmentId = 'direct' | 'docker';

export type ExecutionEnvironmentCapability = {
  id: ExecutionEnvironmentId;
  available: boolean;
  isDefault: boolean;
  isolation: 'host' | 'container';
  reasonUnavailable?: string | null;
  metadata: Record<string, unknown>;
};

export type ManagedExecutionRequirements = {
  environment?: ExecutionEnvironmentId | null;
};
```

`ManagedExecutionRequirements` is intentionally narrow in the first slice. It selects a concrete
environment id instead of introducing a generic policy DSL too early.

### Worker-side environment contract

The worker should define a dedicated interface, separate from `RuntimeAdapter`:

```ts
export type ExecutionEnvironmentPreparation = {
  environmentId: ExecutionEnvironmentId;
  executionRoot: string;
  worktreePath: string | null;
  runtimeHomeDir: string | null;
  env: Record<string, string>;
  spawnContext: Record<string, unknown>;
  metadata: Record<string, unknown>;
  cleanupToken?: Record<string, unknown>;
};

export interface ExecutionEnvironment {
  readonly id: ExecutionEnvironmentId;
  readonly name: string;
  detect(): Promise<ExecutionEnvironmentCapability>;
  prepare(input: PrepareExecutionEnvironmentInput): Promise<ExecutionEnvironmentPreparation>;
  cleanup(preparation: ExecutionEnvironmentPreparation): Promise<void>;
}
```

`spawnContext` is intentionally opaque in the shared design. The worker can evolve it from direct
spawn options to Docker-specific exec/create arguments without changing control-plane contracts.

### Runtime adapter integration point

The runtime adapter contract should eventually gain an optional execution-context parameter:

```ts
startSession(input: StartManagedSessionInput, context?: ManagedExecutionContext): Promise<ManagedSessionHandle>;
resumeSession(input: ResumeManagedSessionInput, context?: ManagedExecutionContext): Promise<ManagedSessionHandle>;
forkSession(input: ForkManagedSessionInput, context?: ManagedExecutionContext): Promise<ManagedSessionHandle>;
```

That context should contain only what a runtime needs to launch in the prepared environment.
It should not expose environment-detection logic back into the adapter.

## DirectEnvironment

`DirectEnvironment` is the compatibility environment. It formalizes current behavior instead of changing it.

### Detection

`DirectEnvironment.detect()` always returns available on a healthy worker.

Metadata should include:

- `isolation: host`
- `supportsPersistentWorktree: true`
- `supportsContainerBoundary: false`

### Prepare lifecycle

1. Resolve the project path or worktree path for the session
2. Ensure runtime config has already been applied to host home/workspace locations
3. Build a minimal `ExecutionEnvironmentPreparation`
4. Return host paths and environment variables for local process launch

### Cleanup lifecycle

`DirectEnvironment.cleanup()` is usually a no-op, except for optional temp directories created for
future sandboxed copy-in/copy-back flows.

## DockerEnvironment

`DockerEnvironment` is the isolation environment, but it should be introduced in two stages.

### Detection

`DockerEnvironment.detect()` verifies:

- Docker CLI/daemon availability
- required base image or runtime image availability
- whether the worker supports the container isolation mode expected by AgentCTL

Metadata should include:

- `isolation: container`
- detected Docker version if available
- whether hardened network policy arguments are supported
- whether the worker can mount the workspace root safely

### Prepare lifecycle

The full Docker prepare path should do all of the following:

1. Materialize or bind-mount the execution root
2. Apply filesystem-isolation mounts derived from `fs-isolation.ts`
3. Apply network arguments derived from `network-policy.ts`
4. Stage managed runtime config into the container-visible home/workspace
5. Return a preparation object with container identifiers and host/container path mapping

### Cleanup lifecycle

`DockerEnvironment.cleanup()` should:

1. stop/remove ephemeral containers when used
2. clean temporary volumes or staging directories
3. optionally copy back allowed artifacts when a copy-back flow is used
4. emit cleanup metadata for audit and diagnostics

### Why Docker is staged

Containerized runtime sessions are not just environment preparation. They also need:

- runtime stdout/stderr streaming parity
- stable resume/fork path mapping
- session-id persistence across container boundaries
- a durable way to represent file-change and cost events

Those concerns are exactly where `AgentOutputStream` becomes a prerequisite.

## ExecutionEnvironmentRegistry

The worker should own an `ExecutionEnvironmentRegistry` alongside the existing `RuntimeRegistry`.

Responsibilities:

- register environment implementations
- run detection at startup and on demand
- expose the latest capability snapshot to `HealthReporter`
- select a default environment locally when none is requested
- resolve an environment by id during worker request handling

This registry should remain worker-local. The control plane should receive snapshots, not registry logic.

## Capability Reporting and Heartbeat

## Data model choice

Use the existing `machines.capabilities` JSONB as the first persistence target.

That is preferable to a new table because:

- execution environments are machine-level capabilities
- the current registration and inventory pipeline already persists machine capability JSON
- roadmap `2.9` does not require historical capability auditing in the first slice

### Machine capability shape

Extend shared machine capability types to include:

```ts
type MachineCapabilities = {
  gpu: boolean;
  docker: boolean;
  maxConcurrentAgents: number;
  executionEnvironments?: ExecutionEnvironmentCapability[];
  defaultExecutionEnvironment?: ExecutionEnvironmentId | null;
};
```

### Register and heartbeat payloads

`RegisterWorkerRequest` should carry the full environment snapshot at worker startup.
`HeartbeatRequest` should carry the latest environment snapshot as well, even if unchanged, to keep the
control plane stateless about worker restarts and environment drift.

This integrates naturally with `HealthReporter.register()` and `HealthReporter.sendHeartbeat()`.

### Runtime vs environment capability boundary

Keep runtime capability reporting distinct from environment capability reporting:

- runtime install/auth state remains in runtime config state flows
- environment availability remains in machine capabilities

That avoids overloading `machine_runtime_state` with machine-wide environment semantics.

## Dispatch Routing Integration

## Managed-session API

Add optional environment selection to managed-session creation and handoff requests:

```ts
type CreateManagedSessionRequest = {
  runtime: ManagedRuntime;
  machineId: string;
  executionRequirements?: ManagedExecutionRequirements;
  ...
};
```

The initial implementation may accept a direct `environment` field inside `executionRequirements`.

### Selection rules

Phase 1 routing should be conservative:

1. If the caller chooses a machine and environment, validate both
2. If the caller chooses a machine only, default to that machine's default environment
3. If the caller later omits both machine and environment, the control plane may auto-select from capable machines

### Managed-session persistence

Persist the chosen execution environment with the managed session.
The preferred representation is an explicit `execution_environment` field on `managed_sessions`,
not opaque JSON metadata, because it is a first-class routing attribute.

### Future agent dispatch routing

For agent-triggered runs, control-plane dispatch should eventually filter candidate machines by:

- requested runtime
- requested execution environment
- runtime installation/auth capability
- machine availability and concurrency

This should reuse the same environment capability snapshot already stored in machine records.

## AgentOutputStream Dependency Boundary

The following pieces do **not** need `AgentOutputStream` to stabilize:

- shared environment ids and capability types
- worker environment detection
- capability reporting in register/heartbeat
- control-plane validation and machine filtering
- `DirectEnvironment` wrapping the current host path

The following pieces **do** depend on `AgentOutputStream` or equivalent stable adapter output contract:

- Docker-backed runtime session streaming
- containerized resume/fork semantics with live output parity
- steer-ack flows from containerized sessions
- event normalization for file changes, tool events, and cost inside Docker
- environment-aware automatic handoff triggers

That dependency line is the main reason to stage Docker execution after the output contract is settled.

## Rollout Plan

### Phase 1: Capability model and direct environment

- add shared environment types
- add worker `ExecutionEnvironmentRegistry`
- add `DirectEnvironment`
- report environment capabilities through register/heartbeat
- validate requested environment on managed-session create/handoff

### Phase 2: Adapter context plumbing

- add execution context to runtime adapters
- thread `DirectEnvironment` preparation through managed-session routes
- persist chosen environment on managed-session records

### Phase 3: Docker environment

- add `DockerEnvironment` detection and preparation
- integrate container launch and cleanup
- keep streaming-compatible behavior behind the stable adapter output contract

## Testing Strategy

### Unit tests

- environment capability detection and default selection
- direct environment preparation and cleanup behavior
- worker capability payload shaping
- control-plane validation of requested environment vs machine capabilities

### Integration tests

- register/heartbeat updates machine capability snapshots
- runtime-session creation rejects unavailable environment ids
- runtime-session creation defaults to machine default environment when omitted

### Deferred integration tests

After `AgentOutputStream` stabilizes:

- Docker-backed runtime session start/stream/cleanup
- containerized resume/fork path handling
- environment-aware event propagation

## Risks and Open Questions

1. Docker path mapping for native session resume may differ between Claude and Codex
2. Copy-back policy for containerized file changes should remain explicit, not implicit
3. The current runtime config applier writes to host home/workspace paths; Docker may need a container-visible remapping strategy
4. Some workers may report `docker: true` while still lacking the image/runtime guarantees required for safe execution
5. If environment identity becomes important to audits and analytics, `managed_sessions` should get an explicit field early rather than hiding it in metadata

## Decision Summary

1. Introduce `ExecutionEnvironment` as a worker-local abstraction distinct from `RuntimeAdapter`
2. Limit the first slice to `direct` and `docker`
3. Reuse `machines.capabilities` JSONB for environment capability persistence
4. Treat `DirectEnvironment` as the compatibility baseline and `DockerEnvironment` as the staged follow-up
5. Gate containerized runtime streaming and advanced environment-aware orchestration on `AgentOutputStream`
6. Explicitly avoid SSH/Slurm scope in this roadmap item
