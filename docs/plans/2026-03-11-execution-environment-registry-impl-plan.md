# Execution Environment Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a first-class execution-environment layer that separates direct-vs-Docker machine preparation from Claude/Codex runtime semantics, while keeping Docker session execution gated behind a stable output contract.

**Architecture:** Introduce worker-local `ExecutionEnvironment` and `ExecutionEnvironmentRegistry` abstractions, persist worker-reported environment capabilities through existing machine capability storage, and thread environment selection through managed-session APIs. Land `DirectEnvironment` first as a compatibility wrapper; stage `DockerEnvironment` integration after `AgentOutputStream` stabilizes.

**Tech Stack:** TypeScript, Fastify, Drizzle, Vitest, pnpm workspaces, Docker, Claude Code CLI, Codex CLI

---

### Task 1: Add Shared Execution-Environment Contracts

**Files:**
- Modify: `packages/shared/src/types/runtime-management.ts`
- Modify: `packages/shared/src/protocol/runtime-management.ts`
- Modify: `packages/shared/src/types/machine.ts`
- Modify: `packages/shared/src/protocol/commands.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/protocol/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/types/runtime-management.test.ts`
- Test: `packages/shared/src/types/machine.test.ts`
- Test: `packages/shared/src/protocol/runtime-management.test.ts`

**Step 1: Write the failing tests**

Add tests that define the new shared surface:

```ts
expect(EXECUTION_ENVIRONMENTS).toEqual(['direct', 'docker']);
expect(isExecutionEnvironmentId('direct')).toBe(true);
expect(machine.capabilities.executionEnvironments?.[0]?.id).toBe('direct');
expect(request.executionRequirements?.environment).toBe('docker');
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/types/runtime-management.test.ts src/types/machine.test.ts src/protocol/runtime-management.test.ts
```

Expected: FAIL because execution-environment ids, capability types, and request fields do not exist yet.

**Step 3: Write minimal implementation**

Add the shared contracts:

```ts
export const EXECUTION_ENVIRONMENTS = ['direct', 'docker'] as const;
export type ExecutionEnvironmentId = (typeof EXECUTION_ENVIRONMENTS)[number];

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

Extend machine capabilities and managed-session request types to carry these fields.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/types/runtime-management.test.ts src/types/machine.test.ts src/protocol/runtime-management.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/types/runtime-management.ts packages/shared/src/protocol/runtime-management.ts packages/shared/src/types/machine.ts packages/shared/src/protocol/commands.ts packages/shared/src/types/index.ts packages/shared/src/protocol/index.ts packages/shared/src/index.ts packages/shared/src/types/runtime-management.test.ts packages/shared/src/types/machine.test.ts packages/shared/src/protocol/runtime-management.test.ts
git commit -m "feat(shared): add execution environment contracts"
```

### Task 2: Persist Execution-Environment Capability Snapshots on Machines

**Files:**
- Modify: `packages/control-plane/src/registry/db-registry.ts`
- Modify: `packages/control-plane/src/registry/db-registry.test.ts`
- Modify: `packages/control-plane/src/api/routes/agents.ts`
- Modify: `packages/control-plane/src/api/routes/agents.test.ts`
- Modify: `packages/control-plane/src/db/schema.ts` only if the existing `machines.capabilities` typing needs tightening

**Step 1: Write the failing tests**

Add tests for:

- register persists `executionEnvironments` and `defaultExecutionEnvironment`
- heartbeat refreshes machine capability snapshots
- machine listing returns the expanded capability shape

Example:

```ts
expect(machine.capabilities.executionEnvironments?.map((env) => env.id)).toEqual(['direct', 'docker']);
expect(machine.capabilities.defaultExecutionEnvironment).toBe('direct');
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/registry/db-registry.test.ts src/api/routes/agents.test.ts
```

Expected: FAIL because the registry and route layer do not yet preserve the expanded capability fields.

**Step 3: Write minimal implementation**

Keep using `machines.capabilities` JSONB instead of adding a new table. Update the registry and route typing so worker-provided environment capability snapshots survive register/list/heartbeat flows unchanged.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/registry/db-registry.test.ts src/api/routes/agents.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/registry/db-registry.ts packages/control-plane/src/registry/db-registry.test.ts packages/control-plane/src/api/routes/agents.ts packages/control-plane/src/api/routes/agents.test.ts packages/control-plane/src/db/schema.ts
git commit -m "feat(cp): persist execution environment capability snapshots"
```

### Task 3: Add Worker Execution-Environment Interface and DirectEnvironment

**Files:**
- Create: `packages/agent-worker/src/runtime/execution-environment.ts`
- Create: `packages/agent-worker/src/runtime/direct-environment.ts`
- Create: `packages/agent-worker/src/runtime/execution-environment-registry.ts`
- Create: `packages/agent-worker/src/runtime/execution-environment.test.ts`
- Create: `packages/agent-worker/src/runtime/direct-environment.test.ts`
- Create: `packages/agent-worker/src/runtime/execution-environment-registry.test.ts`
- Modify: `packages/agent-worker/src/runtime/index.ts`

**Step 1: Write the failing tests**

Define the worker-local behavior:

```ts
expect(await registry.detectAll()).toEqual(
  expect.arrayContaining([expect.objectContaining({ id: 'direct', available: true })]),
);
expect(await registry.getDefault()).toMatchObject({ id: 'direct' });
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/execution-environment.test.ts src/runtime/direct-environment.test.ts src/runtime/execution-environment-registry.test.ts
```

Expected: FAIL because the interface, direct environment, and registry do not exist.

**Step 3: Write minimal implementation**

Create worker-local contracts and the compatibility environment:

```ts
export interface ExecutionEnvironment {
  readonly id: ExecutionEnvironmentId;
  detect(): Promise<ExecutionEnvironmentCapability>;
  prepare(input: PrepareExecutionEnvironmentInput): Promise<ExecutionEnvironmentPreparation>;
  cleanup(preparation: ExecutionEnvironmentPreparation): Promise<void>;
}
```

`DirectEnvironment.prepare()` should mostly wrap current host behavior and return host paths with a no-op cleanup path.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/execution-environment.test.ts src/runtime/direct-environment.test.ts src/runtime/execution-environment-registry.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent-worker/src/runtime/execution-environment.ts packages/agent-worker/src/runtime/direct-environment.ts packages/agent-worker/src/runtime/execution-environment-registry.ts packages/agent-worker/src/runtime/execution-environment.test.ts packages/agent-worker/src/runtime/direct-environment.test.ts packages/agent-worker/src/runtime/execution-environment-registry.test.ts packages/agent-worker/src/runtime/index.ts
git commit -m "feat(worker): add direct execution environment registry"
```

### Task 4: Report Environment Capabilities from the Worker

**Files:**
- Modify: `packages/agent-worker/src/health-reporter.ts`
- Modify: `packages/agent-worker/src/health-reporter.test.ts`
- Modify: `packages/agent-worker/src/api/server.ts`
- Modify: `packages/agent-worker/src/api/server.test.ts`

**Step 1: Write the failing tests**

Add tests that prove:

- worker registration includes environment capability snapshots
- heartbeat includes environment capability snapshots
- default execution environment is present when the registry provides one

Example:

```ts
expect(body.capabilities.executionEnvironments?.[0]?.id).toBe('direct');
expect(body.capabilities.defaultExecutionEnvironment).toBe('direct');
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/health-reporter.test.ts src/api/server.test.ts
```

Expected: FAIL because `HealthReporter` does not yet know about the environment registry.

**Step 3: Write minimal implementation**

Inject the worker environment registry into `HealthReporter`, include the latest capability snapshot in register/heartbeat payloads, and expose the registry from worker bootstrap.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/health-reporter.test.ts src/api/server.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent-worker/src/health-reporter.ts packages/agent-worker/src/health-reporter.test.ts packages/agent-worker/src/api/server.ts packages/agent-worker/src/api/server.test.ts
git commit -m "feat(worker): report execution environment capabilities"
```

### Task 5: Validate Managed-Session Environment Selection in the Control Plane

**Files:**
- Modify: `packages/control-plane/src/api/routes/runtime-sessions.ts`
- Modify: `packages/control-plane/src/api/routes/runtime-sessions.test.ts`
- Modify: `packages/control-plane/src/runtime-management/managed-session-store.ts`
- Modify: `packages/control-plane/src/runtime-management/managed-session-store.test.ts`
- Modify: `packages/control-plane/src/db/schema.ts`
- Create: `packages/control-plane/drizzle/0011_add_execution_environment_to_managed_sessions.sql`

**Step 1: Write the failing tests**

Add tests for:

- create managed session with explicit `environment: 'direct'`
- reject unknown/unavailable environment for selected machine
- default to machine default environment when omitted
- persist the chosen environment on the managed-session record

Example:

```ts
expect(response.statusCode).toBe(201);
expect(response.json().session.executionEnvironment).toBe('direct');
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/runtime-sessions.test.ts src/runtime-management/managed-session-store.test.ts
```

Expected: FAIL because runtime-session requests and managed-session rows do not yet understand execution environments.

**Step 3: Write minimal implementation**

Add an explicit `execution_environment` field to `managed_sessions`, validate requested environment id against the target machine capability snapshot, and persist the selected value.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/runtime-sessions.test.ts src/runtime-management/managed-session-store.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/runtime-sessions.ts packages/control-plane/src/api/routes/runtime-sessions.test.ts packages/control-plane/src/runtime-management/managed-session-store.ts packages/control-plane/src/runtime-management/managed-session-store.test.ts packages/control-plane/src/db/schema.ts packages/control-plane/drizzle/0011_add_execution_environment_to_managed_sessions.sql
git commit -m "feat(cp): validate and persist managed session environment selection"
```

### Task 6: Gate Runtime-Adapter Context Plumbing on AgentOutputStream

**Files:**
- Modify later: `packages/agent-worker/src/runtime/runtime-adapter.ts`
- Modify later: `packages/agent-worker/src/runtime/claude-runtime-adapter.ts`
- Modify later: `packages/agent-worker/src/runtime/codex-runtime-adapter.ts`
- Modify later: `packages/agent-worker/src/runtime/cli-session-manager.ts`
- Modify later: `packages/agent-worker/src/runtime/codex-session-manager.ts`
- Test later: runtime adapter and session manager tests

**Step 1: Do not implement this task until the output contract is stable**

Blocked on: `AgentOutputStream` landing and freezing the runtime execution context boundary.

**Step 2: When unblocked, write the failing tests**

Add tests proving adapters can accept execution context prepared by `DirectEnvironment` without changing existing session semantics.

**Step 3: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/claude-runtime-adapter.test.ts src/runtime/codex-runtime-adapter.test.ts
```

Expected: FAIL because adapters do not yet accept execution context.

**Step 4: Write minimal implementation**

Add a narrow `ManagedExecutionContext` parameter and thread it through start/resume/fork without yet introducing Docker-specific behavior.

**Step 5: Run test to verify it passes**

Run the same adapter tests and expect PASS.

**Step 6: Commit**

```bash
git add packages/agent-worker/src/runtime/runtime-adapter.ts packages/agent-worker/src/runtime/claude-runtime-adapter.ts packages/agent-worker/src/runtime/codex-runtime-adapter.ts packages/agent-worker/src/runtime/cli-session-manager.ts packages/agent-worker/src/runtime/codex-session-manager.ts
git commit -m "refactor(worker): add execution context plumbing to runtime adapters"
```

### Task 7: Add DockerEnvironment After AgentOutputStream Stabilizes

**Files:**
- Create later: `packages/agent-worker/src/runtime/docker-environment.ts`
- Create later: `packages/agent-worker/src/runtime/docker-environment.test.ts`
- Modify later: `packages/agent-worker/src/runtime/execution-environment-registry.ts`
- Modify later: `packages/agent-worker/src/runtime/fs-isolation.ts`
- Modify later: `packages/agent-worker/src/runtime/network-policy.ts`
- Modify later: `packages/agent-worker/src/api/server.ts`

**Step 1: Write the failing tests**

Define detection and prepare/cleanup behavior for:

- docker availability detection
- generated mount/network context
- cleanup after failed prepare

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/docker-environment.test.ts
```

Expected: FAIL because `DockerEnvironment` does not exist.

**Step 3: Write minimal implementation**

Implement a Docker-backed environment that:

- detects container capability
- stages runtime config in a container-visible path
- derives mount/network arguments from existing isolation helpers
- returns a cleanup token for container teardown

Do not extend this task to SSH, Slurm, or general remote execution.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/docker-environment.test.ts src/runtime/network-policy.test.ts src/runtime/fs-isolation.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent-worker/src/runtime/docker-environment.ts packages/agent-worker/src/runtime/docker-environment.test.ts packages/agent-worker/src/runtime/execution-environment-registry.ts packages/agent-worker/src/runtime/fs-isolation.ts packages/agent-worker/src/runtime/network-policy.ts packages/agent-worker/src/api/server.ts
git commit -m "feat(worker): add docker execution environment"
```

### Task 8: Verify the Slice End-to-End

**Files:**
- Modify only if verification exposes issues

**Step 1: Run focused shared/control-plane/worker tests**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/types/runtime-management.test.ts src/types/machine.test.ts src/protocol/runtime-management.test.ts
pnpm --filter @agentctl/control-plane test -- src/registry/db-registry.test.ts src/api/routes/agents.test.ts src/api/routes/runtime-sessions.test.ts src/runtime-management/managed-session-store.test.ts
pnpm --filter @agentctl/agent-worker test -- src/runtime/execution-environment.test.ts src/runtime/direct-environment.test.ts src/runtime/execution-environment-registry.test.ts src/health-reporter.test.ts src/api/server.test.ts
```

Expected: PASS for the non-gated tasks in this plan.

**Step 2: Run broader package verification**

Run:
```bash
pnpm --filter @agentctl/shared build
pnpm --filter @agentctl/control-plane build
pnpm --filter @agentctl/agent-worker build
```

Expected: PASS.

**Step 3: Manual QA**

Verify:

- worker registration stores execution environment capabilities
- heartbeat refreshes those capabilities
- managed-session create rejects unavailable environment ids
- managed-session create persists the chosen environment
- direct environment remains the default compatibility path

**Step 4: Commit**

```bash
git add packages/shared packages/control-plane packages/agent-worker docs/plans/2026-03-11-execution-environment-registry-design.md docs/plans/2026-03-11-execution-environment-registry-impl-plan.md
git commit -m "docs: plan execution environment registry"
```
