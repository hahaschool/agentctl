# Intelligence Layer Implementation Plan (Phase 5)

**Date**: 2026-03-12
**Scope**: Section 10.5 of multi-agent collaboration design
**Branch**: `feat/collaboration-phase5-intelligence`
**Depends on**: Phase 1 (Spaces), Phase 2 (Agent Bus), Phase 3 (Task Graph + Fleet), Phase 4 (Context Bridge) -- all delivered

## Problem

Today, task-to-agent assignment is manual. A human creates a TaskGraph, manually assigns TaskDefinitions to agent profiles, and hopes the capabilities match. There is no feedback loop: the system does not learn which agents are effective at which tasks, approval gates always use the same hardcoded timeouts, and notifications are broadcast uniformly regardless of urgency or recipient preference.

Phase 5 closes this gap with four capabilities:

1. **Smart Routing** -- match task `requiredCapabilities` to agent `capabilities` + machine `capabilities`, factoring in load, cost, and historical performance.
2. **Auto-Decompose** -- accept a natural-language task description and produce a TaskGraph via LLM-based decomposition.
3. **Outcome Learning** -- record task outcomes and use them to refine routing scores and approval timeout policies.
4. **Notification Routing** -- deliver notifications through the channel most likely to get a timely human response.

## Design Constraints

- Build on the existing Phase 1-4 infrastructure. No new databases, no new transport layers.
- Use PostgreSQL for all persistent state (consistent with the Postgres-first architecture).
- LLM calls for auto-decompose go through the existing LiteLLM proxy (`packages/control-plane/src/router/`).
- All new types go in `@agentctl/shared` so web/mobile can consume them.
- All new stores follow the existing `Store` class pattern (constructor takes `db` + `logger`).
- All new routes follow the existing Fastify plugin pattern.

---

## Part 1: Smart Routing

### What "Smart Routing" Means Concretely

Given a `TaskDefinition` with `requiredCapabilities: string[]`, find the best `(AgentProfile, WorkerNode)` pair by scoring candidates on:

| Signal | Source | Weight |
|--------|--------|--------|
| **Capability match** | `AgentProfile.capabilities` intersect `TaskDefinition.requiredCapabilities` | Must be 100% (hard filter) |
| **Machine capability match** | `WorkerNode.capabilities` (e.g., `gpu`, `docker`, `high-memory`) | Hard filter if task specifies machine requirements |
| **Current load** | `WorkerNode.currentLoad` (0.0 - 1.0) | Prefer lower load (soft score) |
| **Available capacity** | `WorkerNode.maxConcurrentAgents` minus running instances | Hard filter: skip nodes at capacity |
| **Cost efficiency** | `AgentProfile.maxCostPerHour` vs task `estimatedTokens` | Prefer cheaper profiles when capability is equal |
| **Historical success rate** | `RoutingOutcome` table (new) | Prefer agents with higher completion rate for similar capabilities |
| **Historical duration** | `RoutingOutcome` table (new) | Prefer agents that complete similar tasks faster |

The routing algorithm:

1. **Filter**: Discard profiles that lack any required capability. Discard nodes that are offline, draining, or at capacity.
2. **Score**: For each surviving `(profile, node)` pair, compute a weighted score.
3. **Rank**: Return the top-N candidates, ordered by score descending.
4. **Select**: The caller (task executor or human via UI) picks from the ranked list. In auto mode, pick the top candidate.

### New Types (`packages/shared/src/types/intelligence.ts`)

```typescript
// ── Routing ────────────────────────────────────────────────────

export type RoutingCandidate = {
  readonly profileId: string;
  readonly nodeId: string;
  readonly score: number;
  readonly breakdown: RoutingScoreBreakdown;
};

export type RoutingScoreBreakdown = {
  readonly capabilityMatch: number;    // 1.0 = all required caps present
  readonly loadScore: number;          // 1.0 = idle, 0.0 = at capacity
  readonly costScore: number;          // normalized 0-1, lower cost = higher
  readonly successRateScore: number;   // from historical outcomes
  readonly durationScore: number;      // from historical outcomes
  readonly weightedTotal: number;
};

export type RoutingRequest = {
  readonly taskDefinitionId: string;
  readonly requiredCapabilities: readonly string[];
  readonly machineRequirements?: readonly string[];
  readonly estimatedTokens: number | null;
  readonly limit?: number;             // max candidates to return (default 5)
};

export type RoutingDecision = {
  readonly id: string;
  readonly taskDefinitionId: string;
  readonly taskRunId: string;
  readonly selectedProfileId: string;
  readonly selectedNodeId: string;
  readonly score: number;
  readonly breakdown: RoutingScoreBreakdown;
  readonly mode: 'auto' | 'suggested';
  readonly createdAt: string;
};

// ── Outcome Tracking ───────────────────────────────────────────

export type RoutingOutcome = {
  readonly id: string;
  readonly routingDecisionId: string | null;
  readonly taskRunId: string;
  readonly profileId: string;
  readonly nodeId: string;
  readonly capabilities: readonly string[];   // snapshot of task's required capabilities
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly durationMs: number | null;
  readonly costUsd: number | null;
  readonly tokensUsed: number | null;
  readonly errorCode: string | null;
  readonly createdAt: string;
};
```

### New DB Schema (`packages/control-plane/src/db/schema-intelligence.ts`)

Two new tables:

```sql
-- Routing decisions (audit trail of every assignment)
CREATE TABLE routing_decisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_def_id   UUID NOT NULL REFERENCES task_definitions(id),
  task_run_id   UUID NOT NULL REFERENCES task_runs(id),
  profile_id    UUID NOT NULL REFERENCES agent_profiles(id),
  node_id       UUID NOT NULL REFERENCES worker_nodes(id),
  score         REAL NOT NULL,
  breakdown     JSONB NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'auto',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Outcome records (one per completed/failed/cancelled task run)
CREATE TABLE routing_outcomes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_decision_id UUID REFERENCES routing_decisions(id),
  task_run_id         UUID NOT NULL REFERENCES task_runs(id),
  profile_id          UUID NOT NULL REFERENCES agent_profiles(id),
  node_id             UUID NOT NULL REFERENCES worker_nodes(id),
  capabilities        TEXT[] NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL,
  duration_ms         INTEGER,
  cost_usd            REAL,
  tokens_used         INTEGER,
  error_code          TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_routing_outcomes_profile ON routing_outcomes(profile_id);
CREATE INDEX idx_routing_outcomes_caps ON routing_outcomes USING GIN(capabilities);
CREATE INDEX idx_routing_outcomes_status ON routing_outcomes(status);
```

### New Store (`packages/control-plane/src/collaboration/routing-store.ts`, ~200 lines)

```
RoutingStore
  - recordDecision(input): Promise<RoutingDecision>
  - recordOutcome(input): Promise<RoutingOutcome>
  - getOutcomesByProfile(profileId): Promise<RoutingOutcome[]>
  - getOutcomesByCapabilities(caps: string[]): Promise<RoutingOutcome[]>
  - getAggregateStats(profileId, capabilities): Promise<{ successRate, avgDurationMs, avgCostUsd }>
```

### New Service (`packages/control-plane/src/intelligence/routing-engine.ts`, ~250 lines)

Pure scoring logic, no DB dependency (receives data, returns scores):

```
RoutingEngine
  - rankCandidates(request, profiles, nodes, instances, stats): RoutingCandidate[]
  - computeScore(profile, node, instances, taskReq, stats): RoutingScoreBreakdown
```

Default weights (configurable via environment):

```
CAPABILITY_MATCH_WEIGHT = 0.0   (hard filter, not scored)
LOAD_WEIGHT             = 0.25
COST_WEIGHT             = 0.20
SUCCESS_RATE_WEIGHT     = 0.35
DURATION_WEIGHT         = 0.20
```

### New Route (`packages/control-plane/src/api/routes/routing.ts`, ~120 lines)

```
POST /api/routing/rank
  Body: { taskDefinitionId, requiredCapabilities, machineRequirements?, estimatedTokens?, limit? }
  Response: RoutingCandidate[]

POST /api/routing/assign
  Body: { taskRunId, profileId, nodeId }
  Response: RoutingDecision
  Side effect: calls taskRunStore.updateStatus('claimed') + workerLeaseStore.claimLease()

GET /api/routing/decisions/:taskRunId
  Response: RoutingDecision | null

POST /api/routing/outcomes
  Body: { taskRunId, status, durationMs?, costUsd?, tokensUsed?, errorCode? }
  Response: RoutingOutcome
```

### Wiring: Auto-Assign on Task Ready

Extend the existing task executor flow. When `getReadyDefinitions()` returns ready tasks:

1. For each ready definition, call `POST /api/routing/rank`.
2. If mode is `auto` and top candidate score exceeds a configurable threshold (default 0.5), auto-assign.
3. If mode is `suggested` or score is below threshold, post a notification to the Space thread with ranked candidates for human selection.

This wiring lives in a new file `packages/control-plane/src/intelligence/auto-assigner.ts` (~100 lines) that subscribes to task-state events via the EventBus.

---

## Part 2: Auto-Decompose

### Algorithm: LLM-Based Task Description to TaskGraph

The auto-decompose flow:

1. Human provides a **natural-language task description** (e.g., "Refactor the auth module to use OAuth PKCE, add tests, update docs").
2. System sends a structured prompt to an LLM (via LiteLLM proxy) containing:
   - The task description
   - Available agent profiles (names + capabilities) from `AgentProfileStore`
   - Available machine capabilities from `WorkerNodeStore`
   - A JSON schema for the expected output
3. LLM returns a structured `DecompositionResult`:
   - List of sub-tasks with names, descriptions, types, required capabilities, estimated tokens
   - Dependencies between sub-tasks (which blocks which)
   - Suggested approval gates (e.g., "review before merge")
4. System validates the result:
   - Parse JSON against schema
   - Run `validateTaskGraph()` on the proposed DAG
   - Verify all referenced capabilities exist in at least one agent profile
5. System creates the TaskGraph via existing `TaskGraphStore` API.

### New Types (added to `packages/shared/src/types/intelligence.ts`)

```typescript
// ── Decomposition ──────────────────────────────────────────────

export type DecompositionRequest = {
  readonly description: string;
  readonly spaceId?: string;
  readonly constraints?: DecompositionConstraints;
};

export type DecompositionConstraints = {
  readonly maxSubTasks?: number;          // default 10
  readonly maxDepthLevels?: number;       // default 4
  readonly requiredCapabilities?: readonly string[];  // must appear in at least one sub-task
  readonly excludeCapabilities?: readonly string[];
  readonly budgetTokens?: number;
  readonly budgetCostUsd?: number;
};

export type DecomposedTask = {
  readonly tempId: string;                // temporary ID for edge references
  readonly type: 'task' | 'gate';
  readonly name: string;
  readonly description: string;
  readonly requiredCapabilities: readonly string[];
  readonly estimatedTokens: number;
  readonly timeoutMs: number;
};

export type DecomposedEdge = {
  readonly from: string;                  // tempId
  readonly to: string;                    // tempId
  readonly type: 'blocks' | 'context';
};

export type DecompositionResult = {
  readonly tasks: readonly DecomposedTask[];
  readonly edges: readonly DecomposedEdge[];
  readonly suggestedApprovalGates: readonly string[];  // tempIds of gate nodes
  readonly reasoning: string;             // LLM's explanation of the decomposition
  readonly estimatedTotalTokens: number;
  readonly estimatedTotalCostUsd: number | null;
};

export type DecompositionResponse = {
  readonly graphId: string;
  readonly definitionIdMap: Record<string, string>;  // tempId -> real UUID
  readonly result: DecompositionResult;
  readonly validationErrors: readonly string[];
};
```

### New Service (`packages/control-plane/src/intelligence/task-decomposer.ts`, ~300 lines)

```
TaskDecomposer
  constructor(litellmClient, agentProfileStore, workerNodeStore, taskGraphStore, logger)

  - decompose(request: DecompositionRequest): Promise<DecompositionResponse>
    1. Fetch available profiles + node capabilities
    2. Build prompt with schema + context
    3. Call LLM via LiteLLM proxy
    4. Parse + validate response
    5. Create TaskGraph + definitions + edges via TaskGraphStore
    6. Return response with ID mapping

  - buildPrompt(description, profiles, nodeCapabilities, constraints): string
    Private. Constructs the system + user prompt for decomposition.

  - validateDecomposition(result, availableCapabilities): string[]
    Private. Returns validation errors (empty = valid).
```

The LLM prompt template will be stored in a separate file for maintainability:

**File: `packages/control-plane/src/intelligence/prompts/decompose-task.ts`** (~80 lines)

Contains the system prompt and user prompt template. The system prompt instructs the LLM to:
- Output valid JSON matching the `DecompositionResult` schema
- Use only capabilities that exist in the provided profile list
- Prefer parallelism where sub-tasks are independent
- Insert approval gates before destructive or high-risk steps
- Keep sub-tasks small enough for a single agent session (under the token budget)

### New Route (`packages/control-plane/src/api/routes/decompose.ts`, ~80 lines)

```
POST /api/decompose
  Body: { description, spaceId?, constraints? }
  Response: DecompositionResponse

POST /api/decompose/preview
  Body: { description, constraints? }
  Response: DecompositionResult (without creating the graph -- dry run)
```

The `preview` endpoint runs the LLM and validation but does not persist. This lets the UI show the proposed graph before the user commits.

---

## Part 3: Outcome Learning (Feedback Loop)

### How Outcomes Improve Future Routing

The learning loop is a simple historical statistics model, not ML. It works as follows:

1. **Record**: When a TaskRun completes (success, failure, or cancellation), an outcome record is written to `routing_outcomes` via a TaskRun completion hook.

2. **Aggregate**: The `RoutingStore.getAggregateStats(profileId, capabilities)` method computes per-profile, per-capability-set statistics:
   - `successRate` = completed / (completed + failed) over the last N runs (configurable window, default 50)
   - `avgDurationMs` = mean duration of successful runs
   - `avgCostUsd` = mean cost of successful runs

3. **Influence routing**: The `RoutingEngine.computeScore()` incorporates these stats into the weighted score. A profile with 95% success rate on `["typescript", "testing"]` tasks scores higher than one with 60% success rate.

4. **Decay**: Stats are computed over a sliding window (last 50 outcomes per capability set). This means poor early performance can be recovered from, and agents that degrade over time lose their score advantage.

### Approval Timeout Learning

A separate, simpler feedback loop for approval gate timeouts:

1. **Record**: When an approval gate resolves (approved, rejected, or timed-out), record the time-to-decision in a new `approval_timing` table.

2. **Compute P95**: For each `(decidedBy, taskCapabilities)` combination, compute the P95 response time from the last 20 decisions.

3. **Suggest timeout**: When creating a new approval gate, the system suggests a timeout based on the P95 of the approver's historical response time, clamped to a minimum (5 minutes) and maximum (24 hours).

### New DB Table (added to `schema-intelligence.ts`)

```sql
CREATE TABLE approval_timings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id           UUID NOT NULL REFERENCES approval_gates(id),
  decided_by        TEXT NOT NULL,
  capabilities      TEXT[] NOT NULL DEFAULT '{}',
  decision_time_ms  INTEGER NOT NULL,
  timed_out         BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_approval_timings_decided_by ON approval_timings(decided_by);
```

### New Store Methods (extend `RoutingStore`)

```
  - recordApprovalTiming(input): Promise<ApprovalTiming>
  - getApprovalTimingStats(decidedBy, capabilities?): Promise<{ p50Ms, p95Ms, count }>
  - suggestTimeout(decidedBy, capabilities?): Promise<number>  // returns ms
```

### Wiring: Outcome Recording Hook

**File: `packages/control-plane/src/intelligence/outcome-recorder.ts`** (~80 lines)

Subscribes to the EventBus for `task-state` events. When a TaskRun transitions to `completed`, `failed`, or `cancelled`:

1. Look up the routing decision for this TaskRun (if one exists).
2. Compute duration from `startedAt` to `completedAt`.
3. Extract cost from the TaskRun result payload.
4. Write a `RoutingOutcome` record.

Similarly, when an approval gate resolves:

1. Compute time from gate creation to decision.
2. Write an `ApprovalTiming` record.

This recorder is a background service that starts with the control plane.

---

## Part 4: Notification Routing Optimization

### Problem

Today, webhooks fire uniformly (same channel for all events). A cost alert and an approval request go through the same Slack webhook. Humans miss critical notifications because they are buried in noise.

### Solution: Priority-Based Notification Routing

Extend the existing `WebhookDispatcher` with priority classification and channel selection.

### New Types (added to `packages/shared/src/types/intelligence.ts`)

```typescript
// ── Notification Routing ───────────────────────────────────────

export const NOTIFICATION_PRIORITIES = ['critical', 'high', 'normal', 'low'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const NOTIFICATION_CHANNELS = ['push', 'webhook-slack', 'webhook-discord', 'webhook-generic', 'in-app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationPreference = {
  readonly id: string;
  readonly userId: string;
  readonly priority: NotificationPriority;
  readonly channels: readonly NotificationChannel[];
  readonly quietHoursStart?: string;     // HH:MM in user's timezone
  readonly quietHoursEnd?: string;
  readonly timezone?: string;            // IANA timezone
  readonly createdAt: string;
};

export type NotificationRoutingRule = {
  readonly eventType: string;            // WebhookEventType or '*'
  readonly priority: NotificationPriority;
  readonly escalateAfterMs?: number;     // auto-escalate if unacknowledged
  readonly escalateTo?: NotificationPriority;
};
```

### Default Priority Mapping

| Event Type | Default Priority |
|------------|-----------------|
| `agent.error` | critical |
| `deploy.failure` | critical |
| `audit.high_severity` | critical |
| `agent.cost_alert` | high |
| `agent.stopped` | normal |
| `agent.started` | low |
| `deploy.success` | low |
| Approval gate pending | high |
| Approval gate timed-out | critical |

### New DB Table (added to `schema-intelligence.ts`)

```sql
CREATE TABLE notification_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  priority        TEXT NOT NULL,
  channels        TEXT[] NOT NULL DEFAULT '{}',
  quiet_hours_start TEXT,
  quiet_hours_end   TEXT,
  timezone        TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, priority)
);
```

### New Store (`packages/control-plane/src/intelligence/notification-router-store.ts`, ~100 lines)

```
NotificationRouterStore
  - getPreferences(userId): Promise<NotificationPreference[]>
  - setPreference(input): Promise<NotificationPreference>
  - deletePreference(id): Promise<void>
```

### New Service (`packages/control-plane/src/intelligence/notification-router.ts`, ~150 lines)

```
NotificationRouter
  constructor(preferences: NotificationRouterStore, webhookDispatcher: WebhookDispatcher, logger)

  - route(event, data, targetUserIds): Promise<void>
    1. Classify event priority (from default mapping or custom rules)
    2. For each target user, resolve their channel preferences for this priority
    3. Filter out channels blocked by quiet hours
    4. Dispatch to each resolved channel

  - classifyPriority(eventType): NotificationPriority
  - isQuietHours(preference): boolean
```

### New Route (`packages/control-plane/src/api/routes/notification-preferences.ts`, ~80 lines)

```
GET    /api/notifications/preferences
POST   /api/notifications/preferences
DELETE /api/notifications/preferences/:id
GET    /api/notifications/preferences/:userId
```

---

## File Summary

### New Files

| File | Package | Lines (est) | Description |
|------|---------|-------------|-------------|
| `types/intelligence.ts` | shared | ~180 | All new types for routing, decomposition, outcomes, notifications |
| `db/schema-intelligence.ts` | control-plane | ~100 | Drizzle schema for routing_decisions, routing_outcomes, approval_timings, notification_preferences |
| `db/migrations/NNNN_intelligence_layer.sql` | control-plane | ~80 | SQL DDL migration |
| `intelligence/routing-engine.ts` | control-plane | ~250 | Pure scoring + ranking logic |
| `intelligence/routing-engine.test.ts` | control-plane | ~300 | Unit tests for scoring |
| `intelligence/task-decomposer.ts` | control-plane | ~300 | LLM-based decomposition service |
| `intelligence/task-decomposer.test.ts` | control-plane | ~250 | Unit tests (mocked LLM) |
| `intelligence/prompts/decompose-task.ts` | control-plane | ~80 | Prompt templates |
| `intelligence/auto-assigner.ts` | control-plane | ~100 | EventBus subscriber for auto-assignment |
| `intelligence/auto-assigner.test.ts` | control-plane | ~150 | Unit tests |
| `intelligence/outcome-recorder.ts` | control-plane | ~80 | EventBus subscriber for outcome recording |
| `intelligence/outcome-recorder.test.ts` | control-plane | ~100 | Unit tests |
| `intelligence/notification-router.ts` | control-plane | ~150 | Priority-based notification dispatch |
| `intelligence/notification-router.test.ts` | control-plane | ~150 | Unit tests |
| `intelligence/notification-router-store.ts` | control-plane | ~100 | DB store for preferences |
| `collaboration/routing-store.ts` | control-plane | ~200 | DB store for decisions + outcomes + timings |
| `collaboration/routing-store.test.ts` | control-plane | ~200 | Unit tests |
| `api/routes/routing.ts` | control-plane | ~120 | Routing API endpoints |
| `api/routes/routing.test.ts` | control-plane | ~200 | Route tests |
| `api/routes/decompose.ts` | control-plane | ~80 | Decomposition API endpoints |
| `api/routes/decompose.test.ts` | control-plane | ~150 | Route tests |
| `api/routes/notification-preferences.ts` | control-plane | ~80 | Notification preferences CRUD |
| `api/routes/notification-preferences.test.ts` | control-plane | ~100 | Route tests |

**Estimated total**: ~3,400 lines of code + tests

### Modified Files

| File | Change |
|------|--------|
| `packages/shared/src/types/index.ts` | Re-export `intelligence.ts` |
| `packages/control-plane/src/db/index.ts` | Re-export `schema-intelligence.ts` |
| `packages/control-plane/src/api/routes/task-runs.ts` | Add outcome recording call on status update to `completed`/`failed`/`cancelled` |
| `packages/control-plane/src/api/routes/approvals.ts` | Add timing recording call on gate resolution |
| `packages/control-plane/src/notifications/webhook-dispatcher.ts` | Accept priority parameter; delegate to NotificationRouter when available |
| `packages/control-plane/src/index.ts` | Wire up new stores, services, and routes |

---

## Implementation Phases

### Phase 5a: Smart Routing (P1, ~2 days)

1. Add `intelligence.ts` types to shared
2. Add `schema-intelligence.ts` with `routing_decisions` and `routing_outcomes` tables
3. Implement `RoutingStore`
4. Implement `RoutingEngine` (pure scoring, TDD)
5. Implement routing API routes
6. Wire auto-assigner to EventBus

Tests: unit tests for scoring engine + store + routes. Verify with manual TaskGraph creation + routing rank call.

### Phase 5b: Auto-Decompose (P2, ~2 days)

1. Add decomposition types to `intelligence.ts`
2. Implement prompt template
3. Implement `TaskDecomposer` service
4. Implement decompose API routes (including preview)
5. Integration test with mocked LLM response

Tests: unit tests with deterministic mocked LLM output. Verify DAG validation catches bad decompositions.

### Phase 5c: Outcome Learning (P2, ~1 day)

1. Implement `OutcomeRecorder` EventBus subscriber
2. Add approval timing table + store methods
3. Wire outcome recording into task-run completion flow
4. Wire timing recording into approval resolution flow
5. Verify RoutingEngine consumes historical stats

Tests: unit tests for recorder + aggregate stat computation.

### Phase 5d: Notification Routing (P3, ~1 day)

1. Add notification types to `intelligence.ts`
2. Add `notification_preferences` table
3. Implement `NotificationRouterStore`
4. Implement `NotificationRouter` service
5. Implement notification preferences API routes
6. Wire into existing WebhookDispatcher

Tests: unit tests for priority classification + channel selection + quiet hours.

---

## Open Questions

1. **Scoring weight tuning**: The default weights (load 0.25, cost 0.20, success 0.35, duration 0.20) are initial guesses. Should we expose a UI for tuning, or iterate based on usage data first?

2. **LLM model for decomposition**: Which model should decompose tasks? A fast model (Haiku) for speed, or a reasoning model (Opus) for quality? Recommendation: start with Sonnet as default, make it configurable via `DECOMPOSE_MODEL_ID` env var.

3. **Decomposition guardrails**: Should we limit the maximum token budget that auto-decompose can allocate? Recommendation: yes, configurable via `MAX_DECOMPOSE_BUDGET_TOKENS` (default 500,000).

4. **Proactive agents**: The design doc mentions "SlackAgents-style: listen and chime in." This requires agents to subscribe to Space events and autonomously decide whether to contribute. This is architecturally possible with the existing EventBus subscription model, but the prompt engineering and cost management are non-trivial. Recommendation: defer to a follow-up after the core intelligence layer ships. The subscription infrastructure from Phase 2 already supports this; the missing piece is the "should I chime in?" decision logic, which is a prompt + cost-budget problem.

5. **Cold start**: When there are no historical outcomes, the routing engine falls back to load + cost scoring only. Should we seed initial scores from agent profile metadata (e.g., assume Opus is better at architecture tasks)? Recommendation: yes, add an optional `defaultAffinities` field to `AgentProfile` that provides initial scores until real data accumulates.

---

## Non-Goals (Explicitly Out of Scope)

- **ML-based routing**: No neural network or reinforcement learning. Simple weighted scoring with sliding-window statistics is sufficient for the fleet sizes AgentCTL targets (3-20 agents).
- **Proactive agent behavior**: Deferred to a follow-up. The infrastructure supports it, but the prompt engineering is a separate effort.
- **Cross-workspace routing**: Single-workspace only. Multi-tenant routing is a future concern.
- **A2A protocol integration**: External agent discovery and capability negotiation via Google A2A is out of scope for Phase 5.

## References

- [Multi-Agent Collaboration Design](2026-03-12-multi-agent-collaboration-design.md) -- Phase 5 section
- [Task Graph + Fleet Implementation Plan](2026-03-12-task-graph-fleet-impl-plan.md) -- Phase 3 infrastructure this builds on
- Existing types: `packages/shared/src/types/task-graph.ts`, `agent-identity.ts`, `approval.ts`
- Existing stores: `packages/control-plane/src/collaboration/` (task-graph-store, agent-profile-store, worker-node-store, approval-store)
- Existing routes: `packages/control-plane/src/api/routes/` (task-graphs, task-runs, agent-profiles, worker-nodes, approvals)
