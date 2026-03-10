# Automatic Handoff Triggers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add automatic handoff trigger policy, run-level decision history, and a staged path to live failover without regressing the current managed-session handoff flow.

**Architecture:** Keep the existing `/api/runtime-sessions/:id/handoff` path as the only execution mechanism. Add a control-plane evaluation layer that resolves policy, records every trigger decision, and only invokes the current handoff route when the trigger is allowed. Ship run-history and task-affinity dry-run first; defer live cost/rate-limit execution until `AgentOutputStream` is stable.

**Tech Stack:** TypeScript, Fastify, Drizzle, Vitest, pnpm workspaces, PostgreSQL

---

### Task 1: Add shared auto-handoff contracts

**Files:**
- Create: `packages/shared/src/types/auto-handoff.ts`
- Create: `packages/shared/src/types/auto-handoff.test.ts`
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/index.ts`
- Possibly modify: `packages/shared/src/types/runtime-management.ts`

**Step 1: Write the failing test**

Add tests for:
- `AutoHandoffPolicy`
- `HandoffTriggerSignal`
- `RunHandoffDecision`
- enum guards for `task-affinity`, `rate-limit`, `cost-threshold`

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/types/auto-handoff.test.ts
```

Expected: FAIL because the contract file and exports do not exist.

**Step 3: Write minimal implementation**

Create the shared types:

```ts
export type AutoHandoffTrigger = 'task-affinity' | 'rate-limit' | 'cost-threshold';
export type AutoHandoffStage = 'dispatch' | 'live';
export type AutoHandoffDecisionStatus =
  | 'suggested'
  | 'scheduled'
  | 'executed'
  | 'skipped'
  | 'failed';
```

Include:
- policy shape
- decision journal record shape
- minimal helper guards/constants

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/types/auto-handoff.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/types/auto-handoff.ts packages/shared/src/types/auto-handoff.test.ts packages/shared/src/types/index.ts packages/shared/src/index.ts packages/shared/src/types/runtime-management.ts
git commit -m "feat(shared): add automatic handoff trigger contracts"
```

### Task 2: Add run-level handoff decision persistence

**Files:**
- Create: `packages/control-plane/drizzle/0010_add_run_handoff_decisions.sql`
- Modify: `packages/control-plane/src/db/schema.ts`
- Modify: `packages/control-plane/src/db/schema.test.ts`
- Possibly modify: `packages/control-plane/src/db/exports.test.ts`

**Step 1: Write the failing test**

Extend schema tests to assert:
- `run_handoff_decisions` exists
- foreign key to `agent_runs`
- nullable links to managed sessions and session handoffs
- indexes on `source_run_id`, `trigger`, and `created_at`

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/db/schema.test.ts
```

Expected: FAIL because the table and schema exports do not exist.

**Step 3: Write minimal implementation**

Add a new table that records:
- `sourceRunId`
- `sourceManagedSessionId`
- `targetRunId`
- `handoffId`
- `trigger`
- `stage`
- `mode`
- `status`
- `dedupeKey`
- `policySnapshot`
- `signalPayload`
- `reason`
- `skippedReason`
- timestamps

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/db/schema.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/drizzle/0010_add_run_handoff_decisions.sql packages/control-plane/src/db/schema.ts packages/control-plane/src/db/schema.test.ts packages/control-plane/src/db/exports.test.ts
git commit -m "feat(cp): add run handoff decision schema"
```

### Task 3: Add control-plane decision store and run-history route

**Files:**
- Create: `packages/control-plane/src/runtime-management/run-handoff-decision-store.ts`
- Create: `packages/control-plane/src/runtime-management/run-handoff-decision-store.test.ts`
- Create: `packages/control-plane/src/api/routes/run-handoffs.ts`
- Create: `packages/control-plane/src/api/routes/run-handoffs.test.ts`
- Modify: `packages/control-plane/src/api/server.ts`
- Modify: `packages/control-plane/src/api/routes/openapi.test.ts`

**Step 1: Write the failing test**

Cover:
- creating decision records
- listing decision history for a run
- `GET /api/runs/:id/handoff-history`
- inclusion of linked `handoffId` and target identifiers when present

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/runtime-management/run-handoff-decision-store.test.ts src/api/routes/run-handoffs.test.ts src/api/routes/openapi.test.ts
```

Expected: FAIL because the store and route do not exist.

**Step 3: Write minimal implementation**

Create:
- a store for insert/list-by-run operations
- a route plugin for `GET /api/runs/:id/handoff-history`

Route response should include:
- ordered decision records
- count
- linked `handoffId` when an execution occurred

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/runtime-management/run-handoff-decision-store.test.ts src/api/routes/run-handoffs.test.ts src/api/routes/openapi.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/runtime-management/run-handoff-decision-store.ts packages/control-plane/src/runtime-management/run-handoff-decision-store.test.ts packages/control-plane/src/api/routes/run-handoffs.ts packages/control-plane/src/api/routes/run-handoffs.test.ts packages/control-plane/src/api/server.ts packages/control-plane/src/api/routes/openapi.test.ts
git commit -m "feat(cp): add run handoff history api"
```

### Task 4: Add policy resolver and task-affinity evaluator

**Files:**
- Create: `packages/control-plane/src/runtime-management/auto-handoff-policy.ts`
- Create: `packages/control-plane/src/runtime-management/auto-handoff-policy.test.ts`
- Create: `packages/control-plane/src/runtime-management/handoff-trigger-evaluator.ts`
- Create: `packages/control-plane/src/runtime-management/handoff-trigger-evaluator.test.ts`
- Possibly modify: `packages/control-plane/src/runtime-management/managed-session-store.ts`
- Possibly modify: `packages/control-plane/src/registry/db-registry.ts`

**Step 1: Write the failing test**

Add tests for:
- resolving agent-level override vs default policy
- task-affinity rule ranking
- same-runtime no-op rejection
- dedupe key generation
- cooldown/max-handoff guardrails

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/runtime-management/auto-handoff-policy.test.ts src/runtime-management/handoff-trigger-evaluator.test.ts
```

Expected: FAIL because the resolver and evaluator do not exist.

**Step 3: Write minimal implementation**

Implement:
- `resolveAutoHandoffPolicy()`
- `evaluateTrigger(signal, context)`
- deterministic candidate ranking for task-affinity

Do not execute handoffs in this task. Return decision objects only.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/runtime-management/auto-handoff-policy.test.ts src/runtime-management/handoff-trigger-evaluator.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/runtime-management/auto-handoff-policy.ts packages/control-plane/src/runtime-management/auto-handoff-policy.test.ts packages/control-plane/src/runtime-management/handoff-trigger-evaluator.ts packages/control-plane/src/runtime-management/handoff-trigger-evaluator.test.ts packages/control-plane/src/runtime-management/managed-session-store.ts packages/control-plane/src/registry/db-registry.ts
git commit -m "feat(cp): add automatic handoff policy evaluation"
```

### Task 5: Wire dispatch-time task-affinity in dry-run mode

**Files:**
- Modify: `packages/control-plane/src/api/routes/runtime-sessions.ts`
- Modify: `packages/control-plane/src/api/routes/runtime-sessions.test.ts`
- Possibly modify: `packages/control-plane/src/api/routes/handoffs.ts`
- Modify: `packages/control-plane/src/api/routes/e2e-smoke.test.ts`

**Step 1: Write the failing test**

Cover:
- runtime session creation evaluates task-affinity
- dry-run mode records a `suggested` decision without changing execution path
- duplicate evaluations within the same run/session collapse to one record

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/runtime-sessions.test.ts src/api/routes/e2e-smoke.test.ts
```

Expected: FAIL because runtime session creation does not evaluate or record trigger decisions.

**Step 3: Write minimal implementation**

Integrate the evaluator into managed runtime session creation or handoff entrypoints:
- resolve effective policy
- build a dispatch-stage `task-affinity` signal
- record `suggested` or `skipped`
- do not auto-execute yet

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/api/routes/runtime-sessions.test.ts src/api/routes/e2e-smoke.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/api/routes/runtime-sessions.ts packages/control-plane/src/api/routes/runtime-sessions.test.ts packages/control-plane/src/api/routes/handoffs.ts packages/control-plane/src/api/routes/e2e-smoke.test.ts
git commit -m "feat(cp): record task affinity handoff suggestions"
```

### Task 6: Add live trigger signal contract after `AgentOutputStream` lands

**Files:**
- Modify: `packages/shared/src/protocol/events.ts`
- Modify: `packages/shared/src/protocol/events.test.ts`
- Create: `packages/control-plane/src/api/routes/runtime-trigger-signals.ts`
- Create: `packages/control-plane/src/api/routes/runtime-trigger-signals.test.ts`
- Modify: `packages/control-plane/src/api/server.ts`
- Modify: `packages/agent-worker/src/runtime/sdk-runner.ts`
- Modify: `packages/agent-worker/src/runtime/claude-runtime-adapter.ts`
- Modify: `packages/agent-worker/src/runtime/codex-runtime-adapter.ts`

**Step 1: Write the failing test**

Add tests for:
- new structured rate-limit signal ingestion
- new structured cost-threshold signal ingestion
- route validation and persistence of decision journal entries

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/protocol/events.test.ts
pnpm --filter @agentctl/control-plane test -- src/api/routes/runtime-trigger-signals.test.ts
```

Expected: FAIL because the signal event types and route do not exist.

**Step 3: Write minimal implementation**

Add event types or signal payloads that are emitted from the post-`AgentOutputStream` path, then ingest them in the control plane.

Do not do this task before the `AgentOutputStream` branch lands.

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/protocol/events.test.ts
pnpm --filter @agentctl/control-plane test -- src/api/routes/runtime-trigger-signals.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/protocol/events.ts packages/shared/src/protocol/events.test.ts packages/control-plane/src/api/routes/runtime-trigger-signals.ts packages/control-plane/src/api/routes/runtime-trigger-signals.test.ts packages/control-plane/src/api/server.ts packages/agent-worker/src/runtime/sdk-runner.ts packages/agent-worker/src/runtime/claude-runtime-adapter.ts packages/agent-worker/src/runtime/codex-runtime-adapter.ts
git commit -m "feat(runtime): add automatic handoff trigger signals"
```

### Task 7: Execute live rate-limit and cost triggers via the existing handoff route

**Files:**
- Create: `packages/control-plane/src/runtime-management/handoff-trigger-coordinator.ts`
- Create: `packages/control-plane/src/runtime-management/handoff-trigger-coordinator.test.ts`
- Modify: `packages/control-plane/src/api/routes/handoffs.ts`
- Modify: `packages/control-plane/src/runtime-management/handoff-store.ts`
- Modify: `packages/control-plane/src/api/routes/handoffs.test.ts`
- Modify: `packages/control-plane/src/api/routes/e2e-smoke.test.ts`

**Step 1: Write the failing test**

Cover:
- `rate-limit` signal schedules automatic handoff once
- `cost-threshold` signal respects cooldown and `maxAutomaticHandoffsPerRun`
- failed target startup restores or preserves the source session correctly
- successful execution links `run_handoff_decisions` to `session_handoffs`

**Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/runtime-management/handoff-trigger-coordinator.test.ts src/api/routes/handoffs.test.ts src/api/routes/e2e-smoke.test.ts
```

Expected: FAIL because no automatic coordinator exists.

**Step 3: Write minimal implementation**

Implement a coordinator that:
- resolves policy
- checks dedupe/cooldown
- records `scheduled`
- invokes the current manual handoff path
- records `executed` or `failed`

**Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter @agentctl/control-plane test -- src/runtime-management/handoff-trigger-coordinator.test.ts src/api/routes/handoffs.test.ts src/api/routes/e2e-smoke.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/control-plane/src/runtime-management/handoff-trigger-coordinator.ts packages/control-plane/src/runtime-management/handoff-trigger-coordinator.test.ts packages/control-plane/src/api/routes/handoffs.ts packages/control-plane/src/runtime-management/handoff-store.ts packages/control-plane/src/api/routes/handoffs.test.ts packages/control-plane/src/api/routes/e2e-smoke.test.ts
git commit -m "feat(cp): execute automatic runtime handoff triggers"
```

### Task 8: Verify staged rollout boundaries

**Files:**
- Modify only if verification exposes issues

**Step 1: Run pre-`AgentOutputStream` verification**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/types/auto-handoff.test.ts
pnpm --filter @agentctl/control-plane test -- src/db/schema.test.ts src/runtime-management/run-handoff-decision-store.test.ts src/runtime-management/auto-handoff-policy.test.ts src/runtime-management/handoff-trigger-evaluator.test.ts src/api/routes/run-handoffs.test.ts src/api/routes/runtime-sessions.test.ts
```

Expected: PASS for Tasks 1-5.

**Step 2: Run post-`AgentOutputStream` verification**

Run:
```bash
pnpm --filter @agentctl/shared test -- src/protocol/events.test.ts
pnpm --filter @agentctl/control-plane test -- src/api/routes/runtime-trigger-signals.test.ts src/runtime-management/handoff-trigger-coordinator.test.ts src/api/routes/handoffs.test.ts
```

Expected: PASS after Tasks 6-7 land.

**Step 3: Run broader repo checks**

Run:
```bash
pnpm --filter @agentctl/control-plane build
pnpm --filter @agentctl/shared build
```

Expected: PASS.

**Step 4: Commit**

```bash
git add packages/shared packages/control-plane docs/plans/2026-03-11-automatic-handoff-triggers-design.md docs/plans/2026-03-11-automatic-handoff-triggers-impl-plan.md
git commit -m "docs: plan automatic handoff triggers"
```
