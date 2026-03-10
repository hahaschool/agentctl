# Design: Automatic Handoff Triggers

> Date: 2026-03-11
> Status: Proposed
> Scope: Control-plane orchestration, managed runtime sessions, run history, handoff policy evaluation

## Summary

AgentCTL already supports manual managed-session handoff between Claude Code and Codex:

- workers can export a `HandoffSnapshot`
- the control plane can create a target managed session
- `/api/runtime-sessions/:id/handoff` executes the transfer
- `/api/runtime-sessions/:id/handoffs` and `/api/runtime-sessions/handoffs/summary` expose managed-session history

What does **not** exist yet is an automatic trigger layer that can decide when a handoff should happen, explain why it happened, prevent duplicate trigger storms, and expose run-level history for operator review.

The recommended design is to add a **control-plane-owned trigger engine** that:

1. resolves an auto-handoff policy for a run or managed session
2. evaluates trigger signals in a deterministic order
3. records every evaluation in a run-level decision journal
4. reuses the existing runtime handoff route for actual execution
5. stages live switching behind `AgentOutputStream`, while allowing lower-risk groundwork to land earlier

This keeps the current runtime/session architecture intact and avoids pushing orchestration policy into worker-local runtime adapters.

## Goals

1. Support automatic handoff decisions for:
   - rate-limit failover
   - cost-threshold switching
   - task-type affinity routing
2. Introduce run-level handoff history at `GET /api/runs/:id/handoff-history`
3. Preserve the current managed-session handoff route as the single execution path
4. Make decisions auditable, idempotent, and safe under retries or repeated signals
5. Separate work that can land now from work that must wait for `AgentOutputStream`

## Non-Goals

1. Replacing the existing `/api/runtime-sessions/:id/handoff` flow
2. Assuming mid-execution steering exists
3. Designing a general workflow engine beyond handoff evaluation
4. Implementing memory continuity in the same slice
5. Reworking runtime adapters to own orchestration policy

## Current State

### What exists today

- Shared runtime contracts already define:
  - `ManagedRuntime`
  - `HandoffReason`
  - `ManagedSession`
  - `HandoffSnapshot`
- Worker-side `HandoffController` already supports:
  - `snapshot-handoff`
  - optional `native-import`
  - preflight probing
- Control-plane routes already support:
  - create/resume/fork managed sessions
  - execute manual handoff
  - session-level handoff history
  - fleet handoff summary analytics

### What is missing

- no automatic trigger policy model
- no control-plane evaluator that decides whether to hand off
- no run-level decision journal
- no `GET /api/runs/:id/handoff-history`
- no live rate-limit or live cost trigger signal path
- no debounce, cooldown, or max-handoff guardrail for automatic switching

### Important existing mismatch

Roadmap item 3.5 says `GET /api/runs/:id/handoff-history`, but current APIs only expose **managed-session history** under `/api/runtime-sessions/:id/handoffs`.

That is useful, but it is not enough for automatic triggers because operators also need to know:

- which run produced the decision
- which trigger fired
- whether the trigger only suggested a handoff or actually executed one
- whether the decision was skipped by cooldown, dedupe, or a failed preflight

## Approaches Considered

### Option A: Worker-owned automatic handoff

Each worker/runtime adapter detects rate limits and cost conditions locally, then directly starts a handoff.

Pros:

- low local latency
- minimal control-plane round trips

Cons:

- duplicates orchestration logic across adapters
- makes run-level audit history fragmented
- hard to apply fleet-wide cooldown and policy rules
- poor fit with existing control-plane-owned managed-session persistence

### Option B: Control-plane trigger engine with worker signal adapters

Workers emit structured trigger signals; the control plane evaluates policy, records a decision, and reuses the existing handoff route.

Pros:

- single source of truth for policy resolution and audit
- matches current managed-session architecture
- supports both dry-run recommendations and executed handoffs
- naturally yields `GET /api/runs/:id/handoff-history`

Cons:

- requires one new control-plane evaluation layer
- live triggers depend on `AgentOutputStream`

### Option C: Suggestion-only recommender

The system only surfaces “should hand off” recommendations, never executing automatically.

Pros:

- lowest risk
- useful for initial operator confidence

Cons:

- does not actually satisfy roadmap 3.5
- still needs much of the same policy and history machinery

### Recommendation

Adopt **Option B**.

Treat Option C as the first safe rollout mode inside Option B, not as the final product.

## Recommended Architecture

### 1. Trigger stages

Automatic handoff triggers should be evaluated in three distinct stages.

#### Stage 1: Dispatch-time affinity evaluation

Runs before or at managed-session creation.

Purpose:

- decide whether the requested runtime is a poor fit
- optionally recommend or rewrite to a better target runtime
- does not require live output streaming

Primary trigger:

- task-type affinity

Examples:

- Python-heavy bugfix prompt prefers Codex
- long-form repo refactor with existing Claude session context prefers Claude Code

#### Stage 2: Live-session trigger evaluation

Runs while a managed session is active.

Purpose:

- react to structured runtime signals
- switch runtimes or providers before the current run fully fails

Primary triggers:

- rate-limit failover
- cost-threshold switching

This stage **requires `AgentOutputStream`** or an equivalent structured signal channel.

#### Stage 3: Post-decision history and analytics

Runs regardless of whether the handoff actually executes.

Purpose:

- record recommendations, skips, executions, and failures
- expose run-level history and fleet analytics

This stage can begin before Stage 2 is fully wired.

### 2. Policy model

Add a new control-plane policy contract for automatic handoff evaluation.

```ts
type AutoHandoffPolicy = {
  enabled: boolean;
  mode: 'dry-run' | 'execute';
  maxAutomaticHandoffsPerRun: number;
  cooldownMs: number;
  taskAffinity?: {
    enabled: boolean;
    rules: Array<{
      id: string;
      match: 'python-heavy' | 'frontend-heavy' | 'claude-context-heavy' | 'long-running';
      targetRuntime: 'claude-code' | 'codex';
      reason: string;
      priority: number;
    }>;
  };
  rateLimitFailover?: {
    enabled: boolean;
    targetRuntimeOrder: Array<'claude-code' | 'codex'>;
    retryBudget: number;
  };
  costThreshold?: {
    enabled: boolean;
    thresholdUsd: number;
    targetRuntime: 'claude-code' | 'codex';
    minRemainingWorkSignal: 'required' | 'best-effort';
  };
};
```

### 3. Policy resolution order

Policy resolution should be deterministic:

1. agent-level override from `agents.config.autoHandoff`
2. runtime/session-level override from managed-session metadata
3. control-plane default policy constant

The MVP does not need a full settings UI. Agent-level config plus a control-plane default is enough.

### 4. Signal model

Add a normalized signal contract that the control plane can evaluate.

```ts
type HandoffTriggerSignal = {
  runId: string;
  managedSessionId: string | null;
  sourceRuntime: 'claude-code' | 'codex';
  trigger: 'task-affinity' | 'rate-limit' | 'cost-threshold';
  stage: 'dispatch' | 'live';
  observedAt: string;
  payload: Record<string, unknown>;
};
```

Signal sources:

- dispatch-time evaluator in the control plane
- live runtime stream bridge after `AgentOutputStream`
- terminal completion/checkpoint summaries for secondary evidence

### 5. Decision journal

Add a run-level decision journal instead of overloading `session_handoffs`.

`session_handoffs` should remain the record of actual managed-session transfers.

Add a new table such as `run_handoff_decisions`:

```ts
type RunHandoffDecision = {
  id: string;
  sourceRunId: string;
  sourceManagedSessionId: string | null;
  targetRuntime: 'claude-code' | 'codex' | null;
  trigger: 'task-affinity' | 'rate-limit' | 'cost-threshold';
  stage: 'dispatch' | 'live';
  mode: 'dry-run' | 'execute';
  status: 'suggested' | 'scheduled' | 'executed' | 'skipped' | 'failed';
  dedupeKey: string;
  policySnapshot: Record<string, unknown>;
  signalPayload: Record<string, unknown>;
  reason: string;
  skippedReason: string | null;
  handoffId: string | null;
  targetRunId: string | null;
  createdAt: string;
  completedAt: string | null;
};
```

This solves three problems:

1. run-level history exists even when no handoff executes
2. dedupe/cooldown decisions become explainable
3. the roadmap `GET /api/runs/:id/handoff-history` can be implemented cleanly

### 6. Control-plane components

Add four small orchestration components:

1. `AutoHandoffPolicyResolver`
   - resolves effective policy for a run/session
2. `HandoffTriggerEvaluator`
   - decides whether a signal should be suggested, skipped, or executed
3. `HandoffTriggerCoordinator`
   - creates decision records and invokes the existing handoff route when needed
4. `RunHandoffDecisionStore`
   - persistence and history queries

The key rule is:

- `HandoffStore` records actual managed-session transfers
- `RunHandoffDecisionStore` records why the system did or did not attempt them

### 7. Decision order

Each trigger evaluation should run in this order:

1. Confirm the source run/session is still eligible
   - run still active
   - session not already `handing_off`
   - policy enabled
2. Resolve effective policy
3. Build dedupe key
4. Check max automatic handoffs for the run
5. Check cooldown window for the same trigger + target runtime
6. Rank target candidates
7. Reject same-runtime no-op candidates
8. Preflight target viability
9. If `mode = dry-run`, record `suggested`
10. If `mode = execute`, create `scheduled`, call existing handoff route, then mark `executed` or `failed`

### 8. Idempotency and debounce

Use a deterministic dedupe key:

`{sourceRunId}:{stage}:{trigger}:{targetRuntime}:{bucket}`

Where `bucket` is a coarse time window:

- dispatch stage: fixed to one bucket per run
- live stage: one bucket per `cooldownMs`

Rules:

- identical dedupe key cannot schedule twice
- each run has `maxAutomaticHandoffsPerRun`
- each trigger has a cooldown window
- failed decisions increment a small circuit-breaker counter
- once the circuit opens for a run, further automatic triggers become `skipped`

### 9. Trigger-specific behavior

#### Task-type affinity routing

Can land before `AgentOutputStream`.

Evaluation inputs:

- requested runtime
- agent metadata
- project path
- prompt classifier or explicit tags

Recommended MVP behavior:

- run in `dry-run` first
- record recommendation history
- only enable automatic execution after operators validate the rules

#### Rate-limit failover

Should wait for `AgentOutputStream`.

Why:

- current system does not expose a stable structured signal for “the active runtime hit a recoverable rate limit”
- terminal error strings are too brittle for autonomous switching

Required signal examples:

- runtime adapter emits `error` with `category = rate_limit`
- optional provider/model metadata

#### Cost-threshold switching

Should wait for `AgentOutputStream`.

Why:

- current control plane only gets final run cost on completion and occasional checkpoint summaries
- automatic switching requires current cumulative cost while the session is still recoverable

Required signal examples:

- periodic `costUpdate`
- optional estimate of remaining work or confidence that a switch is worth it

### 10. Failure handling and rollback

Failure policy must preserve the source session whenever possible.

Cases:

1. Suggestion-only mode
   - no execution
   - record `suggested`
2. Preflight failure
   - record `failed` or `skipped`
   - keep source session unchanged
3. Target startup failure before source pause
   - record `failed`
   - keep source session active
4. Failure after source entered `handing_off`
   - restore source to `active` if still healthy
   - otherwise leave as-is and surface operator-visible error

Existing `/api/runtime-sessions/:id/handoff` behavior already restores source status on some failure paths; the trigger coordinator should reuse that instead of inventing a second rollback path.

### 11. Audit events

Emit control-plane audit events for every evaluation:

- `auto_handoff_evaluated`
- `auto_handoff_suggested`
- `auto_handoff_skipped`
- `auto_handoff_scheduled`
- `auto_handoff_executed`
- `auto_handoff_failed`

Minimum fields:

- `runId`
- `managedSessionId`
- `trigger`
- `stage`
- `targetRuntime`
- `dedupeKey`
- `policyMode`
- `handoffId`
- `reason`
- `skippedReason`

### 12. APIs

Keep existing APIs:

- `POST /api/runtime-sessions/:id/handoff`
- `GET /api/runtime-sessions/:id/handoffs`
- `GET /api/runtime-sessions/handoffs/summary`

Add new run-level history API:

- `GET /api/runs/:id/handoff-history`

Response shape should include:

- decision records
- linked `handoffId` when execution happened
- linked target run/session ids when available
- dedupe/skipped reasons

## Phase Plan

### Phase 1: Can land before `AgentOutputStream`

1. Shared policy and decision-history contracts
2. `run_handoff_decisions` schema + store
3. `GET /api/runs/:id/handoff-history`
4. Control-plane policy resolver
5. Dispatch-time task-affinity evaluator
6. Dry-run decision recording

This phase gives operators visibility and safe policy validation without autonomous live switching.

### Phase 2: Requires `AgentOutputStream`

1. Live trigger signal contract
2. Worker/control-plane ingestion path for structured runtime trigger signals
3. Automatic rate-limit failover
4. Automatic cost-threshold switching
5. Executed decision records linked to `session_handoffs`

This is the first phase that should turn `mode = execute` on for live-session triggers.

### Phase 3: Hardening and follow-through

1. provider-aware target ranking
2. per-run circuit breaker telemetry
3. richer policy scopes and settings UI
4. memory continuity integration once roadmap 3.6 lands

## Minimal Viable Slice

The smallest safe slice is:

1. define the policy and decision contracts
2. add `run_handoff_decisions`
3. expose `GET /api/runs/:id/handoff-history`
4. implement task-affinity evaluation in `dry-run`
5. record recommendations without executing them automatically

This delivers immediate operator value, exercises the policy model, and avoids coupling the first rollout to `AgentOutputStream`.

## Open Questions

1. Should task-affinity rules be prompt-heuristic only at first, or require explicit agent metadata tags?
2. Should `GET /api/runs/:id/handoff-history` live under a new `/api/runs` route family or be colocated under existing agent routes with an alias?
3. Do we want a single global default policy constant first, or a persisted control-plane default policy record in Phase 1?
