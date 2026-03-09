# Codex and Claude Runtime Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add first-class Codex runtime support plus unified runtime configuration and cross-runtime handoff plumbing without regressing the existing Claude Code control path.

**Architecture:** Introduce a runtime-aware control plane centered on canonical config, managed sessions, and handoff snapshots. Keep same-runtime continuation native, route cross-runtime switching through a guaranteed snapshot path, and isolate native import behind feature flags so it can fail safely.

**Tech Stack:** TypeScript, Fastify, Drizzle, Vitest, Claude Code CLI, Codex CLI, pnpm workspaces

---

### Task 1: Add Shared Runtime-Management Contracts

**Files:**
- Create: `packages/shared/src/types/runtime-management.ts`
- Create: `packages/shared/src/types/runtime-management.test.ts`
- Create: `packages/shared/src/protocol/runtime-management.ts`
- Create: `packages/shared/src/protocol/runtime-management.test.ts`
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/protocol/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/types/agent.test.ts`

**Step 1: Write the failing tests**

Add tests that define the new runtime-management surface:

```ts
expect(MANAGED_RUNTIMES).toEqual(['claude-code', 'codex']);
expect(isManagedSessionStatus('handing_off')).toBe(true);
expect(isHandoffStrategy('snapshot-handoff')).toBe(true);
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/types/runtime-management.test.ts src/protocol/runtime-management.test.ts src/types/agent.test.ts
```

Expected: FAIL because the new files, exports, and `codex` runtime support do not exist yet.

**Step 3: Write minimal implementation**

Create the canonical shared contracts:

```ts
export type ManagedRuntime = 'claude-code' | 'codex';
export type ManagedSessionStatus = 'starting' | 'active' | 'paused' | 'handing_off' | 'ended' | 'error';
export type HandoffStrategy = 'native-import' | 'snapshot-handoff';
```

Update `AgentRuntime` to include `codex` and export the new types from shared entrypoints.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/types/runtime-management.test.ts src/protocol/runtime-management.test.ts src/types/agent.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/types/runtime-management.ts packages/shared/src/types/runtime-management.test.ts packages/shared/src/protocol/runtime-management.ts packages/shared/src/protocol/runtime-management.test.ts packages/shared/src/types/agent.ts packages/shared/src/types/index.ts packages/shared/src/protocol/index.ts packages/shared/src/index.ts packages/shared/src/types/agent.test.ts
git commit -m "feat(shared): add runtime management contracts"
```

### Task 2: Add Control-Plane Schema for Managed Sessions and Runtime Config

**Files:**
- Create: `packages/control-plane/drizzle/0009_add_runtime_management.sql`
- Modify: `packages/control-plane/src/db/schema.ts`
- Modify: `packages/control-plane/src/db/schema.test.ts`
- Test: `packages/control-plane/src/db/migration-runner.test.ts`

**Step 1: Write the failing tests**

Extend schema tests to assert the new tables and columns are present:

```ts
expect(schema.managedSessions).toBeDefined();
expect(schema.runtimeConfigRevisions).toBeDefined();
expect(schema.sessionHandoffs).toBeDefined();
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/db/schema.test.ts src/db/migration-runner.test.ts
```

Expected: FAIL because the schema objects and migration file are missing.

**Step 3: Write minimal implementation**

Add idempotent SQL for:
- `managed_sessions`
- `runtime_config_revisions`
- `machine_runtime_state`
- `session_handoffs`
- `native_import_attempts`

Mirror those tables in `schema.ts` using Drizzle.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/db/schema.test.ts src/db/migration-runner.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/drizzle/0009_add_runtime_management.sql packages/control-plane/src/db/schema.ts packages/control-plane/src/db/schema.test.ts packages/control-plane/src/db/migration-runner.test.ts
git commit -m "feat(cp): add runtime management schema"
```

### Task 3: Add Runtime-Management Persistence Stores

**Files:**
- Create: `packages/control-plane/src/runtime-management/runtime-config-store.ts`
- Create: `packages/control-plane/src/runtime-management/runtime-config-store.test.ts`
- Create: `packages/control-plane/src/runtime-management/managed-session-store.ts`
- Create: `packages/control-plane/src/runtime-management/managed-session-store.test.ts`
- Create: `packages/control-plane/src/runtime-management/handoff-store.ts`
- Create: `packages/control-plane/src/runtime-management/handoff-store.test.ts`

**Step 1: Write the failing tests**

Define repository-level behavior:

```ts
expect(await store.createManagedSession(input)).toMatchObject({ runtime: 'codex' });
expect(await configStore.saveRevision(input)).toHaveProperty('hash');
expect(await handoffStore.listForSession(id)).toHaveLength(1);
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/runtime-management/runtime-config-store.test.ts src/runtime-management/managed-session-store.test.ts src/runtime-management/handoff-store.test.ts
```

Expected: FAIL because the stores do not exist.

**Step 3: Write minimal implementation**

Create small store classes that isolate DB access and keep route files thin.

```ts
class ManagedSessionStore {
  async create(input: CreateManagedSessionInput): Promise<ManagedSessionRecord> {}
  async list(filters: ManagedSessionFilters): Promise<ManagedSessionPage> {}
}
```

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/runtime-management/runtime-config-store.test.ts src/runtime-management/managed-session-store.test.ts src/runtime-management/handoff-store.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/runtime-management/runtime-config-store.ts packages/control-plane/src/runtime-management/runtime-config-store.test.ts packages/control-plane/src/runtime-management/managed-session-store.ts packages/control-plane/src/runtime-management/managed-session-store.test.ts packages/control-plane/src/runtime-management/handoff-store.ts packages/control-plane/src/runtime-management/handoff-store.test.ts
git commit -m "feat(cp): add runtime management stores"
```

### Task 4: Add Control-Plane Runtime Config Routes

**Files:**
- Create: `packages/control-plane/src/api/routes/runtime-config.test.ts`
- Create: `packages/control-plane/src/api/routes/runtime-config.ts`
- Modify: `packages/control-plane/src/api/server.ts`
- Modify: `packages/control-plane/src/api/routes/openapi.test.ts`

**Step 1: Write the failing tests**

Add route tests for:
- `GET /api/runtime-config/defaults`
- `PUT /api/runtime-config/defaults`
- `POST /api/runtime-config/sync`
- `GET /api/runtime-config/drift`

Example:

```ts
expect(response.statusCode).toBe(200);
expect(response.json()).toHaveProperty('config');
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/runtime-config.test.ts src/api/routes/openapi.test.ts
```

Expected: FAIL because the route plugin is not registered.

**Step 3: Write minimal implementation**

Implement the route plugin using the stores from Task 3 and register it in `api/server.ts`.

```ts
app.get('/defaults', async () => ({ config, version, hash }));
app.post('/sync', async () => ({ queued: machineIds.length }));
```

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/runtime-config.test.ts src/api/routes/openapi.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/runtime-config.ts packages/control-plane/src/api/routes/runtime-config.test.ts packages/control-plane/src/api/server.ts packages/control-plane/src/api/routes/openapi.test.ts
git commit -m "feat(cp): add runtime config routes"
```

### Task 5: Add Worker Config Renderers and Runtime Config Routes

**Files:**
- Create: `packages/agent-worker/src/runtime/config/claude-config-renderer.ts`
- Create: `packages/agent-worker/src/runtime/config/claude-config-renderer.test.ts`
- Create: `packages/agent-worker/src/runtime/config/codex-config-renderer.ts`
- Create: `packages/agent-worker/src/runtime/config/codex-config-renderer.test.ts`
- Create: `packages/agent-worker/src/runtime/config/runtime-config-applier.ts`
- Create: `packages/agent-worker/src/runtime/config/runtime-config-applier.test.ts`
- Create: `packages/agent-worker/src/api/routes/runtime-config.ts`
- Create: `packages/agent-worker/src/api/routes/runtime-config.test.ts`
- Modify: `packages/agent-worker/src/api/server.ts`

**Step 1: Write the failing tests**

Add tests for renderer output and route behavior:

```ts
expect(rendered.files).toContainEqual(expect.objectContaining({ path: '.mcp.json' }));
expect(rendered.files).toContainEqual(expect.objectContaining({ path: '.codex/config.toml' }));
expect(response.json().applied).toBe(true);
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/config/claude-config-renderer.test.ts src/runtime/config/codex-config-renderer.test.ts src/runtime/config/runtime-config-applier.test.ts src/api/routes/runtime-config.test.ts
```

Expected: FAIL because the renderers, applier, and route do not exist.

**Step 3: Write minimal implementation**

Implement pure renderers first, then a small applier that writes files and reports hashes.

```ts
class RuntimeConfigApplier {
  async apply(config: ManagedRuntimeConfig): Promise<ApplyRuntimeConfigResult> {}
  async getState(): Promise<MachineRuntimeState> {}
}
```

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/config/claude-config-renderer.test.ts src/runtime/config/codex-config-renderer.test.ts src/runtime/config/runtime-config-applier.test.ts src/api/routes/runtime-config.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent-worker/src/runtime/config/claude-config-renderer.ts packages/agent-worker/src/runtime/config/claude-config-renderer.test.ts packages/agent-worker/src/runtime/config/codex-config-renderer.ts packages/agent-worker/src/runtime/config/codex-config-renderer.test.ts packages/agent-worker/src/runtime/config/runtime-config-applier.ts packages/agent-worker/src/runtime/config/runtime-config-applier.test.ts packages/agent-worker/src/api/routes/runtime-config.ts packages/agent-worker/src/api/routes/runtime-config.test.ts packages/agent-worker/src/api/server.ts
git commit -m "feat(worker): add runtime config rendering and apply routes"
```

### Task 6: Add Runtime Adapter Abstractions

**Files:**
- Create: `packages/agent-worker/src/runtime/runtime-adapter.ts`
- Create: `packages/agent-worker/src/runtime/runtime-registry.ts`
- Create: `packages/agent-worker/src/runtime/runtime-registry.test.ts`
- Create: `packages/agent-worker/src/runtime/claude-runtime-adapter.ts`
- Create: `packages/agent-worker/src/runtime/claude-runtime-adapter.test.ts`
- Modify: `packages/agent-worker/src/runtime/index.ts`

**Step 1: Write the failing tests**

Assert adapter registration and Claude wrapping behavior:

```ts
expect(registry.get('claude-code')).toBeDefined();
expect(await adapter.getCapabilities()).toMatchObject({ runtime: 'claude-code' });
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/runtime-registry.test.ts src/runtime/claude-runtime-adapter.test.ts
```

Expected: FAIL because the adapter layer does not exist.

**Step 3: Write minimal implementation**

Create an interface that hides runtime-specific session managers behind one contract.

```ts
export interface RuntimeAdapter {
  readonly runtime: ManagedRuntime;
  startSession(input: StartManagedSessionInput): Promise<ManagedSessionHandle>;
  resumeSession(input: ResumeManagedSessionInput): Promise<ManagedSessionHandle>;
}
```

Wrap the existing `CliSessionManager` inside `ClaudeRuntimeAdapter`.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/runtime-registry.test.ts src/runtime/claude-runtime-adapter.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent-worker/src/runtime/runtime-adapter.ts packages/agent-worker/src/runtime/runtime-registry.ts packages/agent-worker/src/runtime/runtime-registry.test.ts packages/agent-worker/src/runtime/claude-runtime-adapter.ts packages/agent-worker/src/runtime/claude-runtime-adapter.test.ts packages/agent-worker/src/runtime/index.ts
git commit -m "feat(worker): add runtime adapter abstraction"
```

### Task 7: Add Codex Session Manager and Worker Runtime Session Routes

**Files:**
- Create: `packages/agent-worker/src/runtime/codex-session-manager.ts`
- Create: `packages/agent-worker/src/runtime/codex-session-manager.test.ts`
- Create: `packages/agent-worker/src/runtime/codex-runtime-adapter.ts`
- Create: `packages/agent-worker/src/runtime/codex-runtime-adapter.test.ts`
- Create: `packages/agent-worker/src/api/routes/runtime-sessions.ts`
- Create: `packages/agent-worker/src/api/routes/runtime-sessions.test.ts`
- Modify: `packages/agent-worker/src/api/server.ts`
- Modify: `packages/agent-worker/src/runtime/index.ts`

**Step 1: Write the failing tests**

Cover:
- `codex exec --json` start flow
- `codex exec resume --json` resume flow
- `codex fork` invocation mapping
- runtime-aware route dispatch

```ts
expect(manager.startSession(...).runtime).toBe('codex');
expect(response.json().session.runtime).toBe('codex');
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/codex-session-manager.test.ts src/runtime/codex-runtime-adapter.test.ts src/api/routes/runtime-sessions.test.ts
```

Expected: FAIL because Codex runtime support is missing.

**Step 3: Write minimal implementation**

Implement the Codex session manager around spawned Codex CLI commands and JSON event parsing.

```ts
spawn('codex', ['exec', '--json', prompt], { cwd: projectPath });
spawn('codex', ['exec', 'resume', nativeSessionId, '--json', prompt], { cwd: projectPath });
```

Register the adapter and expose worker routes that dispatch on `runtime`.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/codex-session-manager.test.ts src/runtime/codex-runtime-adapter.test.ts src/api/routes/runtime-sessions.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent-worker/src/runtime/codex-session-manager.ts packages/agent-worker/src/runtime/codex-session-manager.test.ts packages/agent-worker/src/runtime/codex-runtime-adapter.ts packages/agent-worker/src/runtime/codex-runtime-adapter.test.ts packages/agent-worker/src/api/routes/runtime-sessions.ts packages/agent-worker/src/api/routes/runtime-sessions.test.ts packages/agent-worker/src/api/server.ts packages/agent-worker/src/runtime/index.ts
git commit -m "feat(worker): add codex runtime sessions"
```

### Task 8: Add Control-Plane Runtime Session Routes

**Files:**
- Create: `packages/control-plane/src/api/routes/runtime-sessions.ts`
- Create: `packages/control-plane/src/api/routes/runtime-sessions.test.ts`
- Modify: `packages/control-plane/src/api/server.ts`
- Modify: `packages/control-plane/src/api/routes/openapi.test.ts`

**Step 1: Write the failing tests**

Add route tests for:
- `GET /api/runtime-sessions`
- `POST /api/runtime-sessions`
- `POST /api/runtime-sessions/:id/resume`
- `POST /api/runtime-sessions/:id/fork`

```ts
expect(body.sessions[0].runtime).toBe('codex');
expect(body.session.status).toBe('starting');
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/runtime-sessions.test.ts src/api/routes/openapi.test.ts
```

Expected: FAIL because the route plugin is not registered.

**Step 3: Write minimal implementation**

Use the stores from Task 3 plus worker proxy calls to coordinate lifecycle.

```ts
app.post('/', async (request) => {
  const session = await managedSessionStore.create(request.body);
  await proxyWorkerRequest(...);
  return { ok: true, session };
});
```

Keep existing `/api/sessions` untouched.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/runtime-sessions.test.ts src/api/routes/openapi.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/runtime-sessions.ts packages/control-plane/src/api/routes/runtime-sessions.test.ts packages/control-plane/src/api/server.ts packages/control-plane/src/api/routes/openapi.test.ts
git commit -m "feat(cp): add runtime session routes"
```

### Task 9: Add Snapshot Handoff Protocol and Controller

**Files:**
- Create: `packages/shared/src/protocol/handoff.ts`
- Create: `packages/shared/src/protocol/handoff.test.ts`
- Create: `packages/agent-worker/src/runtime/handoff-controller.ts`
- Create: `packages/agent-worker/src/runtime/handoff-controller.test.ts`
- Create: `packages/control-plane/src/api/routes/handoffs.ts`
- Create: `packages/control-plane/src/api/routes/handoffs.test.ts`
- Modify: `packages/shared/src/protocol/index.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/control-plane/src/api/server.ts`
- Modify: `packages/agent-worker/src/api/routes/runtime-sessions.ts`

**Step 1: Write the failing tests**

Define handoff behavior:

```ts
expect(snapshot.strategy).toBe('snapshot-handoff');
expect(controller.pickStrategy(...)).toEqual(['native-import', 'snapshot-handoff']);
expect(response.statusCode).toBe(202);
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/protocol/handoff.test.ts
pnpm --filter @agentctl/agent-worker test -- src/runtime/handoff-controller.test.ts src/api/routes/runtime-sessions.test.ts
pnpm --filter @agentctl/control-plane test -- src/api/routes/handoffs.test.ts
```

Expected: FAIL because no handoff protocol or routes exist.

**Step 3: Write minimal implementation**

Add snapshot types, worker export/import orchestration, and control-plane routes.

```ts
class HandoffController {
  async handoff(input: HandoffInput): Promise<HandoffResult> {}
}
```

Implement snapshot export as the guaranteed path.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/protocol/handoff.test.ts
pnpm --filter @agentctl/agent-worker test -- src/runtime/handoff-controller.test.ts src/api/routes/runtime-sessions.test.ts
pnpm --filter @agentctl/control-plane test -- src/api/routes/handoffs.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/protocol/handoff.ts packages/shared/src/protocol/handoff.test.ts packages/agent-worker/src/runtime/handoff-controller.ts packages/agent-worker/src/runtime/handoff-controller.test.ts packages/control-plane/src/api/routes/handoffs.ts packages/control-plane/src/api/routes/handoffs.test.ts packages/shared/src/protocol/index.ts packages/shared/src/index.ts packages/control-plane/src/api/server.ts packages/agent-worker/src/api/routes/runtime-sessions.ts
git commit -m "feat(runtime): add snapshot handoff flow"
```

### Task 10: Add Experimental Native Import Scaffolding

**Files:**
- Create: `packages/agent-worker/src/runtime/native-import/claude-to-codex.ts`
- Create: `packages/agent-worker/src/runtime/native-import/codex-to-claude.ts`
- Create: `packages/agent-worker/src/runtime/native-import/native-import.test.ts`
- Modify: `packages/agent-worker/src/runtime/handoff-controller.ts`
- Modify: `packages/control-plane/src/runtime-management/handoff-store.ts`

**Step 1: Write the failing tests**

Add tests proving:
- native import is attempted first when enabled
- snapshot handoff is used when native import returns failure
- native import attempts are recorded separately

```ts
expect(result.attemptedStrategies).toEqual(['native-import', 'snapshot-handoff']);
expect(result.finalStrategy).toBe('snapshot-handoff');
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/native-import/native-import.test.ts src/runtime/handoff-controller.test.ts
pnpm --filter @agentctl/control-plane test -- src/runtime-management/handoff-store.test.ts
```

Expected: FAIL because the native import probe layer does not exist.

**Step 3: Write minimal implementation**

Create feature-flagged probe modules that return typed success/failure results without blocking the main handoff flow.

```ts
export async function tryClaudeToCodexImport(...): Promise<NativeImportAttemptResult> {
  return { ok: false, reason: 'not_implemented' };
}
```

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/agent-worker test -- src/runtime/native-import/native-import.test.ts src/runtime/handoff-controller.test.ts
pnpm --filter @agentctl/control-plane test -- src/runtime-management/handoff-store.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/agent-worker/src/runtime/native-import/claude-to-codex.ts packages/agent-worker/src/runtime/native-import/codex-to-claude.ts packages/agent-worker/src/runtime/native-import/native-import.test.ts packages/agent-worker/src/runtime/handoff-controller.ts packages/control-plane/src/runtime-management/handoff-store.ts
git commit -m "feat(runtime): add native import scaffolding"
```

### Task 11: Wire Verification, Documentation, and Compatibility Checks

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/QUICKSTART-AGENT.md`
- Modify: `packages/control-plane/src/api/routes/openapi.test.ts`
- Modify: `packages/control-plane/src/api/server.test.ts`
- Modify: `packages/agent-worker/src/api/server.test.ts`

**Step 1: Write the failing tests**

Add server-level assertions that the new route plugins are mounted and the existing Claude route stack still starts cleanly.

```ts
expect(spec.paths['/api/runtime-config/defaults']).toBeDefined();
expect(spec.paths['/api/runtime-sessions']).toBeDefined();
```

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/api/server.test.ts src/api/routes/openapi.test.ts
pnpm --filter @agentctl/agent-worker test -- src/api/server.test.ts
```

Expected: FAIL until all registrations are complete.

**Step 3: Write minimal implementation**

Update docs and server tests to reflect the new runtime-aware route surface and compatibility strategy.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/api/server.test.ts src/api/routes/openapi.test.ts
pnpm --filter @agentctl/agent-worker test -- src/api/server.test.ts
pnpm check
pnpm build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add docs/ARCHITECTURE.md docs/ROADMAP.md docs/QUICKSTART-AGENT.md packages/control-plane/src/api/routes/openapi.test.ts packages/control-plane/src/api/server.test.ts packages/agent-worker/src/api/server.test.ts
git commit -m "docs: document unified runtime management"
```

### Task 12: Final End-to-End Verification

**Files:**
- Verify only; no planned file creation

**Step 1: Run package tests**

```bash
pnpm --filter @agentctl/shared test
pnpm --filter @agentctl/control-plane test
pnpm --filter @agentctl/agent-worker test
```

Expected: PASS for all three packages.

**Step 2: Run workspace checks**

```bash
pnpm check
pnpm build
```

Expected: PASS with no type or Biome errors.

**Step 3: Run focused regression checks**

```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/sessions.test.ts src/api/routes/agents.test.ts
pnpm --filter @agentctl/agent-worker test -- src/api/routes/sessions.test.ts src/runtime/cli-session-manager.test.ts
```

Expected: PASS, confirming the Claude-only compatibility path still works.

**Step 4: Commit verification notes if docs changed during verification**

If verification required doc updates, commit them separately.

**Step 5: Stop and hand back for branch-finishing workflow**

At this point, use `superpowers:finishing-a-development-branch` before merge or PR creation.
