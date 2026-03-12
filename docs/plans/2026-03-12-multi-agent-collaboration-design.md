# Multi-Agent Collaboration Design

**Date**: 2026-03-12
**Status**: Draft — reviewed by Codex (gpt-5.4 xhigh), improvements incorporated
**Scope**: Human-agent collaborative workspaces with cross-space context mobility

## Problem Statement

AgentCTL currently manages agents as isolated sessions. As agent fleets grow, two collaboration patterns are needed:

1. **Team Collaboration**: Multiple agents (architect, coder, reviewer) work together on one complex task, with humans joining the conversation at will
2. **Fleet Management**: Multiple independent tasks run in parallel across machines, with humans monitoring and intervening at critical points

Existing tools (Slack, Cursor, Devin) each solve a piece:
- **Slack** provides the messaging paradigm but lacks rich artifacts and agent-native controls
- **Cursor** does parallel subagents but only within a single IDE
- **Devin** has compound AI (Planner/Coder/Critic) but no human-as-peer communication model

The key insight from slock.ai is that **Slack's channel/thread metaphor is the right interaction model for human-agent collaboration**, but it needs to be extended with:
- Rich, interactive artifacts (not just text messages)
- Hierarchical task decomposition (not flat message streams)
- Embedded control surfaces (approve/reject/steer/pause/takeover)
- **Cross-space context mobility** (cherry-pick context from one space to another)

## Research Context

### Academic Foundations

**ChatCollab** (arXiv 2412.01992, Dec 2024):
- Shared event timeline where all participants (human or AI) communicate via one Slack channel
- Role-based agents (CEO, PM, Dev, QA) with autonomous decision-making
- Human-AI substitution is seamless: join the channel with a name, start messaging
- Agents exhibit real behavioral differentiation by role
- Limitation: computational cost (all agents process every event), Slack-only

**SlackAgents** (EMNLP 2025, Salesforce Research):
- Multi-agent library built on Slack for scalable agent management
- Agent-to-agent delegation (A asks B for help, responds to human)
- Proactive mode: agents listen to threads and chime in when relevant
- Decentralized communication, no central orchestrator required

### Industry Landscape (March 2026)

| Product / Framework | Collaboration Model | Human Role | Key Takeaway for AgentCTL |
|--------------------|---------------------|------------|--------------------------|
| Devin | Compound AI (Planner/Coder/Critic) | PR review, conversational UI | Multi-model specialization works |
| Cursor | 8 parallel subagents, background agents | IDE direct control | Background agents + cloud VMs |
| Antigravity | Multi-agent from day one, artifact-based | Multi-workflow oversight | Artifact-based reporting |
| CrewAI | Role-based agent teams, HumanTool | Decision-maker / fallback | `human_as_tool` pattern |
| slock.ai | Slack-like workspace (early/stealth) | Peer in channels | Chat-first collaboration |
| OpenHands | WebSocket event-driven, browser sandbox | Chat + takeover | Event model + replay |
| LangGraph | Checkpointed state graphs, human-in-loop nodes | Interrupt/resume at nodes | Checkpointed subflows |
| AutoGen / AG2 | Event-driven async multi-agent conversations | Real-time oversight | Async agent conversations |
| OpenAI Agents SDK | Handoffs + guardrails + tracing | Approval via tool calls | Handoff patterns |
| Claude Code subagents | Parallel task agents within CLI | Permission-based | Native subagent spawning |
| Langroid | Multi-agent chat with tools | Chat participant | Typed message routing |
| Google A2A | Agent-to-agent protocol (JSON-RPC, Agent Cards) | External | Interoperability standard |

### Protocols: MCP and A2A

**MCP (Model Context Protocol)** has evolved significantly (2025-06-18, 2025-11-25 specs) and now includes Streamable HTTP transport, OAuth guidance, structured tool outputs, resource links, elicitation, and experimental tasks. Our cross-space query tool should align with MCP primitives rather than inventing a parallel system.

**Google A2A (Agent-to-Agent Protocol)** defines how agents discover each other (Agent Cards), negotiate capabilities, and communicate via JSON-RPC. If external agent interoperability matters (e.g., connecting AgentCTL to third-party agents), our Agent Bus edge should be A2A-compatible.

### Key Trend: HITL → HOTL

The industry is shifting from Human-in-the-Loop (every step needs human approval) to Human-on-the-Loop (agents run autonomously, humans are notified at critical points). This aligns with our notification-driven mobile UX.

## Design Decision: Hybrid Spaces + Task Graph (Option C)

### Why This Approach

Three options were evaluated:

- **Option A (Workspace-Centric)**: Simple Slack-like workspaces. Intuitive but limited to two hierarchy levels, breaks down with inter-task dependencies.
- **Option B (Task Graph First)**: DAG-based execution engine. Powerful for scheduling and dependencies but too abstract for casual human interaction, especially on mobile.
- **Option C (Hybrid)**: Spaces as the human-facing layer, Task Graph as the system backbone. Selected because:
  - Humans see familiar "channel" metaphor (low learning curve)
  - System gets proper DAG scheduling (handles dependencies, parallelism, handoff)
  - Simple tasks stay simple (one Space + one agent, no graph complexity visible)
  - Complex tasks scale naturally (Space maps to subgraph, threads map to nodes)

## Architecture Overview

```
┌─ Human Layer (Spaces) ─────────────────────────┐
│                                                  │
│  Space: "auth refactor"   Space: "v2.0 release" │
│  ├── 💬 Discussion        ├── 📊 Status Board   │
│  ├── 🔧 Terminal          ├── 🔔 Approval Queue │
│  ├── 📝 Diff Viewer       └── 📎 Context Links  │
│  └── 📎 → borrows from "perf tests"             │
│                                                  │
├─ Agent Layer (Agent Bus) ───────────────────────┤
│                                                  │
│  Agent-to-agent messaging within spaces          │
│  Redis PubSub (same machine) / NATS (cross-machine) │
│  Messages surface to Space Threads by default    │
│                                                  │
├─ System Layer (Task Graph) ─────────────────────┤
│                                                  │
│  [design-api] → [implement] → [review] → [merge]│
│       ↑              ↑                           │
│  architect-agent  coder-agent  reviewer-agent    │
│                                                  │
├─ Fleet Layer (Control Plane) ───────────────────┤
│                                                  │
│  Machine: EC2    Machine: Mac Mini   Machine: MBP│
│  agents: 2/3    agents: 1/3         agents: 0/3 │
│                                                  │
└──────────────────────────────────────────────────┘
```

## Core Data Model

### Identity Entities (Codex review: #4 — first-class identity)

```typescript
// Agent identity with capabilities, not just a string ID
type AgentProfile = {
  id: string
  name: string
  runtimeType: "claude-code" | "codex" | "openclaw" | "nanoclaw"
  modelId: string                    // e.g., "claude-opus-4-6"
  providerId: string                 // e.g., "anthropic-direct", "bedrock"
  capabilities: string[]             // e.g., ["typescript", "python", "review", "architecture"]
  toolScopes: string[]               // allowed tools
  budgetLimits: { maxTokensPerTask: number; maxCostPerHour: number }
  createdAt: Date
}

// Runtime instance of an agent (one profile can have multiple instances)
type AgentInstance = {
  id: string
  profileId: string
  machineId: string
  worktreeId: string | null
  runtimeSessionId: string | null
  status: "idle" | "running" | "paused" | "crashed"
  heartbeatAt: Date
  startedAt: Date
}

// Machine/worker node in the fleet
type WorkerNode = {
  id: string
  hostname: string
  tailscaleIp: string
  maxConcurrentAgents: number
  currentLoad: number                // 0.0 – 1.0
  capabilities: string[]             // e.g., ["gpu", "docker", "high-memory"]
  status: "online" | "offline" | "draining"
  lastHeartbeatAt: Date
}
```

### Primary Entities

```typescript
type Space = {
  id: string
  name: string
  description: string
  icon?: string
  type: "collaboration" | "solo" | "fleet-overview"
  visibility: "private" | "team" | "public"
  members: SpaceMember[]
  threads: Thread[]
  artifacts: Artifact[]
  contextBridge: ContextLink[]
  taskGraphId: string | null
  costBudget: { maxTokens: number; maxCost: number } | null
  createdBy: string
  createdAt: Date
}

type SpaceMember = {
  spaceId: string
  memberType: "human" | "agent"
  memberId: string                   // references AgentProfile.id or human user id
  role: "owner" | "member" | "observer"
  // Agent-specific: subscription filter to avoid ChatCollab cost problem
  subscriptionFilter?: {
    threadTypes?: ThreadType[]       // only receive events from these thread types
    minVisibility?: "public" | "internal"
  }
}

type Thread = {
  id: string
  spaceId: string
  title: string
  type: "discussion" | "execution" | "review" | "approval"
  messages: Message[]
  artifacts: Artifact[]
  taskRunId: string | null           // maps to TaskRun, not TaskDefinition
  controls: ThreadControls
  createdAt: Date
}
```

### Task Graph: Definition vs Execution (Codex review: #2 — split concerns)

```typescript
// DEFINITION: what needs to happen (immutable after creation)
type TaskDefinition = {
  id: string
  graphId: string
  type: "task" | "gate" | "fork" | "join"
  name: string
  description: string
  requiredCapabilities: string[]     // matched against AgentProfile.capabilities
  estimatedTokens: number | null
  timeoutMs: number                  // default: 1 hour
  retryPolicy: { maxAttempts: number; backoffMs: number }
  spaceId: string
}

// EXECUTION: a specific run of a definition
type TaskRun = {
  id: string
  definitionId: string
  status: "pending" | "claimed" | "running" | "blocked" | "completed" | "failed" | "cancelled"
  attempt: number                    // increments on retry
  assigneeInstanceId: string | null  // references AgentInstance.id
  machineId: string | null
  threadId: string | null
  claimedAt: Date | null
  startedAt: Date | null
  completedAt: Date | null
  lastHeartbeatAt: Date | null
  result: { success: boolean; summary: string; artifactIds: string[] } | null
  error: { code: string; message: string; retryable: boolean } | null
}

// Lease: prevents double-claiming
type WorkerLease = {
  taskRunId: string
  workerId: string
  agentInstanceId: string
  expiresAt: Date                    // must heartbeat before expiry
  renewedAt: Date
}

// Edge: dependency between definitions
type TaskEdge = {
  fromDefinitionId: string
  toDefinitionId: string
  type: "blocks" | "context"         // blocks = must complete; context = output available
}
```

### Artifact System (Codex review: #5 — content-addressed, provenance-shaped)

```typescript
type Artifact = {
  id: string
  spaceId: string
  threadId: string | null
  taskRunId: string | null
  kind: ArtifactKind
  // Content-addressed storage
  contentHash: string                // SHA-256 of blob content
  blobUri: string | null             // external storage URI for large payloads
  mimeType: string
  sizeBytes: number
  // Provenance
  schemaVersion: number
  commitSha: string | null           // git commit that produced this
  sourceRunId: string | null         // which TaskRun created it
  createdByAgentId: string | null
  // Versioning
  version: number
  parentArtifactId: string | null    // previous version
  // Access control
  visibility: "space" | "thread" | "public"
  sensitivity: "normal" | "sensitive" | "secret"  // secrets never cross-space
  createdAt: Date
}

type ArtifactKind =
  | { type: "code-diff"; language: string; filePath: string; hunks: DiffHunk[] }
  | { type: "terminal"; sessionId: string; live: boolean; scrollbackLines: number }
  | { type: "test-result"; framework: string; passed: number; failed: number; skipped: number; durationMs: number; details: TestCase[] }
  | { type: "file"; path: string; language: string }  // content in blob, not inline
  | { type: "diagram"; format: "mermaid" | "dot" }    // source in blob
  | { type: "log"; levelFilter?: string; lineCount: number }
  | { type: "context-snapshot"; tokenCount: number; compressed: boolean; messageCount: number }
```

### Context Bridge (Codex review: #3 — version-pinned by default)

```typescript
type ContextLink = {
  id: string
  sourceSpaceId: string
  sourceArtifactIds: string[]
  sourceVersion: number              // pinned version at time of creation
  targetSpaceId: string
  targetThreadId: string
  mode: "snapshot" | "version-pinned" | "query" | "subscription"
  injectionMethod: "system-prompt" | "context-window" | "tool-accessible"
  createdAt: Date
}
```

Four modes (revised from Codex feedback — default to immutable):

1. **Snapshot**: Copy artifact content at creation time. Independent of source. Default for agent context injection.
2. **Version-Pinned Pointer**: Points to a specific artifact version. Source can update, but the link stays on the pinned version until explicitly bumped. Safe for audit.
3. **Query (MCP Tool)**: Agent can query another space's artifacts on demand via `cross_space_query` tool. No pre-loading. Each query result is versioned.
4. **Subscription**: Real-time updates pushed to target. Reserved for human UI (live dashboards) or explicit background sync. **Never used for agent context injection** — prevents the version-drift audit problem.

## Communication Architecture

### Three-Layer Model

```
Layer 1: Space Messaging (Human ↔ Agent)
  Protocol: WebSocket (bidirectional)
  Format: Rich Messages (text + artifacts + controls)
  Routing: Space → Thread → Members

Layer 2: Agent Bus (Agent ↔ Agent)
  Protocol: Postgres outbox + NATS JetStream (unified)
  Format: Typed AgentMessage envelope with delivery guarantees
  Routing: agent-id → agent-id, or broadcast to space
  Visibility: Messages auto-surface to Space Threads (filtered by subscription)

Layer 3: Fleet Control (CP ↔ Workers)
  Protocol: Existing REST + SSE + BullMQ
  Format: Existing AgentEvent / HandoffEvent
  Routing: CP → Worker (task dispatch, handoff)
```

### Agent Bus Design (Codex review: #1 — durable event model)

**Why Postgres outbox + NATS JetStream** (not Redis PubSub + NATS):
- Redis PubSub is fire-and-forget — lost messages on reconnect, no replay
- Different delivery guarantees per machine placement creates correctness bugs
- Postgres outbox ensures every event is durably persisted before publishing
- NATS JetStream provides at-least-once delivery, consumer acks, replay from sequence

**Event flow**:
```
Agent action → write to space_events table (outbox) → outbox publisher polls →
  publish to NATS JetStream subject (space.<id>.thread.<id>) →
    consumers: other agents (filtered), WebSocket gateway (for humans), audit sink
```

### Append-Only Event Model (Codex review: #1)

```typescript
type SpaceEvent = {
  id: string
  spaceId: string
  threadId: string
  sequenceNum: number               // per-thread monotonic sequence
  idempotencyKey: string            // prevents duplicate processing
  correlationId: string             // traces a request across agents
  type: "message" | "artifact" | "control" | "task-state" | "approval"
  senderType: "human" | "agent" | "system"
  senderId: string
  payload: EventPayload
  visibility: "public" | "internal" | "silent"
  createdAt: Date
}
```

### Agent Bus Message Format

```typescript
type AgentMessage = {
  id: string
  from: string                      // AgentInstance.id
  to: string | "broadcast"          // AgentInstance.id or space broadcast
  spaceId: string
  threadId: string
  sequenceNum: number               // from SpaceEvent
  idempotencyKey: string
  correlationId: string
  type: "request" | "response" | "inform" | "delegate" | "escalate" | "ack"
  payload: AgentPayload
  visibility: "public" | "internal" | "silent"
  replyTo?: string
  timestamp: number
}

type AgentPayload =
  | { kind: "ask"; question: string; context?: ArtifactRef[] }
  | { kind: "deliver"; artifacts: Artifact[] }
  | { kind: "delegate-task"; taskDefinitionId: string; briefing: string }
  | { kind: "escalate-to-human"; reason: string; urgency: "low" | "high" | "critical" }
  | { kind: "steer"; instruction: string }
  | { kind: "ack"; originalMessageId: string; status: "received" | "processing" | "done" }
```

### Message Visibility & Subscription (Codex review: #7 — load control)

**Visibility levels**:
- **public** (default): Appears in Space Thread, humans see it
- **internal**: Hidden by default, humans can expand "agent internal discussion" to view
- **silent**: Audit-only, not displayed (heartbeats, acks, protocol noise)

**Agent subscription filters** (prevents ChatCollab's "all agents process all events" cost problem):
- Each agent's `SpaceMember.subscriptionFilter` controls which events it receives
- Agents only subscribe to thread types relevant to their role
- A `summarizer` agent can periodically condense busy threads into digest artifacts
- Hard cost budgets per space prevent runaway token consumption

### Failure Semantics (Codex review: #6 — explicit failure modes)

| Failure | Behavior |
|---------|----------|
| **CP down** | Workers continue running tasks. Agent Bus (NATS) operates independently. Events queue in outbox. On reconnect, outbox replays undelivered events. |
| **Worker crash** | WorkerLease expires (no heartbeat). TaskRun transitions to `failed`. Retry policy kicks in: new TaskRun attempt on another worker if available. |
| **Bus partition** | NATS JetStream retains messages. Consumers replay from last ack'd sequence on reconnect. Idempotency keys prevent double-processing. |
| **Duplicate delivery** | Idempotency key on every SpaceEvent. Consumers check before processing. |
| **Late completion after rejection** | TaskRun has `cancelled` status. Late completions logged but ignored. Artifacts kept for audit. |
| **Approval timeout** | Policy-driven: auto-approve, escalate to another human, pause agent, or reject. Decision recorded with `timeout` flag. |
| **Mobile reconnect** | WebSocket gateway replays events from last client sequence number. No data loss. |

## Control Surfaces

### Thread-Level Controls

```
Thread type: "execution"
  ▶️ Resume / ⏸️ Pause / ⏹️ Stop
  🔄 Steer: inject new instructions into agent context
  👋 Takeover: human assumes control, agent becomes assistant
  📊 Resource: current token usage / cost / machine

Thread type: "approval"
  ✅ Approve / ❌ Reject / 💬 Comment & Request Changes
  📎 Context: auto-attached artifacts for review
  ⏰ Timeout: auto-policy (auto-approve / escalate / pause)

Thread type: "review"
  👍 LGTM / 🔄 Request Changes
  📝 Inline comments on diff artifacts
  🤖 Can assign another reviewer-agent to assist
```

### Approval Gates (Codex review: #2 — multi-decision support)

```typescript
type ApprovalGate = {
  id: string
  taskDefinitionId: string
  taskRunId: string
  threadId: string
  requiredApprovers: Array<string>   // HumanId or "any-human"
  requiredCount: number              // how many approvals needed (e.g., 1 of 3)
  timeoutMs: number
  timeoutPolicy: "auto-approve" | "escalate" | "pause" | "reject"
  context: ArtifactRef[]
  status: "pending" | "approved" | "rejected" | "timed-out"
  decisions: ApprovalDecision[]      // supports multiple approvers
}

type ApprovalDecision = {
  id: string
  gateId: string
  by: string
  action: "approved" | "rejected" | "changes-requested"
  comment: string | null
  viaTimeout: boolean                // true if auto-decided by timeout
  timestamp: Date
}
```

### Notification Router

```
Trigger                        → Notification Type
────────────────────────────────────────────────────
TaskNode → "gate"              → 🔔 Approval Required (critical)
AgentMessage "escalate"        → 🔔 Agent Needs Help (by urgency)
TaskNode → "failed"            → 🔔 Task Failed (high)
TaskNode → "completed"         → ✅ Task Done (low, batched)
CostThreshold crossed          → ⚠️ Budget Alert (high)
RateLimit handoff triggered    → ℹ️ Auto-switched provider (low)
```

**Mobile UX contract**: notification → tap → land on exact Thread + action card → approve/reject/reply → done. **Max 3 taps from notification to completed decision.**

### Cross-Space Query MCP Tool

```typescript
// Agent-callable tool for on-demand cross-space access
type CrossSpaceQueryTool = {
  name: "cross_space_query"
  input: {
    targetSpaceId: string
    query: string                     // natural language
    artifactFilter?: ArtifactKind[]
    maxTokens?: number
  }
  output: {
    artifacts: Artifact[]
    tokenCount: number
    sources: Array<{ spaceId: string; threadId: string; artifactId: string }>
  }
}
```

### Permission Model

```
Space visibility:
  "private"  → only members can access
  "team"     → all fleet users/agents can reference
  "public"   → anyone can reference

Cross-space access:
  Default: same-team spaces can reference + import
  Live Bridge: requires target space owner approval (or whitelist)
  Sensitive artifacts (env vars, secrets): never cross-space
```

## Database Schema (Codex review: #8 — fixed integrity, no circular refs)

```sql
-- ============================================================
-- Identity & Fleet (created first, no forward references)
-- ============================================================

CREATE TABLE worker_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname TEXT NOT NULL,
  tailscale_ip TEXT NOT NULL,
  max_concurrent_agents INTEGER DEFAULT 3,
  current_load REAL DEFAULT 0.0,
  capabilities TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'online' CHECK (status IN ('online', 'offline', 'draining')),
  last_heartbeat_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  runtime_type TEXT NOT NULL CHECK (runtime_type IN ('claude-code', 'codex', 'openclaw', 'nanoclaw')),
  model_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  capabilities TEXT[] DEFAULT '{}',
  tool_scopes TEXT[] DEFAULT '{}',
  max_tokens_per_task INTEGER,
  max_cost_per_hour REAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES agent_profiles(id),
  machine_id UUID REFERENCES worker_nodes(id),
  worktree_id TEXT,
  runtime_session_id TEXT,
  status TEXT DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'paused', 'crashed')),
  heartbeat_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Task Graph (definition layer — immutable after creation)
-- ============================================================

CREATE TABLE task_graphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE task_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id UUID NOT NULL REFERENCES task_graphs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('task', 'gate', 'fork', 'join')),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  required_capabilities TEXT[] DEFAULT '{}',
  estimated_tokens INTEGER,
  timeout_ms INTEGER DEFAULT 3600000,
  max_retry_attempts INTEGER DEFAULT 1,
  retry_backoff_ms INTEGER DEFAULT 5000,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE task_edges (
  from_definition UUID NOT NULL REFERENCES task_definitions(id) ON DELETE CASCADE,
  to_definition UUID NOT NULL REFERENCES task_definitions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('blocks', 'context')),
  PRIMARY KEY (from_definition, to_definition)
);

-- ============================================================
-- Spaces & Threads (reference task_graphs, not task_definitions)
-- ============================================================

CREATE TABLE spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('collaboration', 'solo', 'fleet-overview')),
  visibility TEXT DEFAULT 'team' CHECK (visibility IN ('private', 'team', 'public')),
  task_graph_id UUID REFERENCES task_graphs(id),
  cost_budget_tokens INTEGER,
  cost_budget_usd REAL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE space_members (
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  member_type TEXT NOT NULL CHECK (member_type IN ('human', 'agent')),
  member_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'observer')),
  subscription_filter JSONB DEFAULT '{}',
  PRIMARY KEY (space_id, member_type, member_id)  -- includes member_type
);

CREATE TABLE threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('discussion', 'execution', 'review', 'approval')),
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Task Runs (execution layer — references definitions + threads)
-- ============================================================

CREATE TABLE task_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID NOT NULL REFERENCES task_definitions(id),
  space_id UUID REFERENCES spaces(id),
  thread_id UUID REFERENCES threads(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'running', 'blocked', 'completed', 'failed', 'cancelled')),
  attempt INTEGER DEFAULT 1,
  assignee_instance_id UUID REFERENCES agent_instances(id),
  machine_id UUID REFERENCES worker_nodes(id),
  claimed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  result JSONB,
  error JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE worker_leases (
  task_run_id UUID PRIMARY KEY REFERENCES task_runs(id),
  worker_id UUID NOT NULL REFERENCES worker_nodes(id),
  agent_instance_id UUID NOT NULL REFERENCES agent_instances(id),
  expires_at TIMESTAMPTZ NOT NULL,
  renewed_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Events (append-only, durable event log)
-- ============================================================

CREATE TABLE space_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id),
  thread_id UUID NOT NULL REFERENCES threads(id),
  sequence_num BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('message', 'artifact', 'control', 'task-state', 'approval')),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('human', 'agent', 'system')),
  sender_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'internal', 'silent')),
  published BOOLEAN DEFAULT FALSE,  -- outbox: false until NATS confirms
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (thread_id, sequence_num)
);

CREATE INDEX idx_space_events_outbox ON space_events (published) WHERE published = FALSE;
CREATE INDEX idx_space_events_thread_seq ON space_events (thread_id, sequence_num);

-- ============================================================
-- Artifacts (content-addressed, versioned, provenance-tracked)
-- ============================================================

CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES threads(id),
  task_run_id UUID REFERENCES task_runs(id),
  kind TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  blob_uri TEXT,
  mime_type TEXT NOT NULL DEFAULT 'application/json',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 1,
  commit_sha TEXT,
  source_run_id UUID REFERENCES task_runs(id),
  created_by_agent_id UUID REFERENCES agent_profiles(id),
  version INTEGER NOT NULL DEFAULT 1,
  parent_artifact_id UUID REFERENCES artifacts(id),
  data JSONB NOT NULL,               -- metadata + small payloads; large in blob
  visibility TEXT DEFAULT 'space' CHECK (visibility IN ('space', 'thread', 'public')),
  sensitivity TEXT DEFAULT 'normal' CHECK (sensitivity IN ('normal', 'sensitive', 'secret')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Context Links (cross-space, version-pinned by default)
-- ============================================================

CREATE TABLE context_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_space_id UUID NOT NULL REFERENCES spaces(id),
  source_artifact_ids UUID[] NOT NULL,
  source_version INTEGER NOT NULL,
  target_space_id UUID NOT NULL REFERENCES spaces(id),
  target_thread_id UUID REFERENCES threads(id),
  mode TEXT NOT NULL CHECK (mode IN ('snapshot', 'version-pinned', 'query', 'subscription')),
  injection_method TEXT CHECK (injection_method IN ('system-prompt', 'context-window', 'tool-accessible')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Approval Gates (multi-decision support)
-- ============================================================

CREATE TABLE approval_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_definition_id UUID NOT NULL REFERENCES task_definitions(id),
  task_run_id UUID REFERENCES task_runs(id),
  thread_id UUID REFERENCES threads(id),
  required_approvers TEXT[] NOT NULL,
  required_count INTEGER NOT NULL DEFAULT 1,
  timeout_ms INTEGER DEFAULT 3600000,
  timeout_policy TEXT DEFAULT 'pause' CHECK (timeout_policy IN ('auto-approve', 'escalate', 'pause', 'reject')),
  context_artifact_ids UUID[],
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'timed-out')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE approval_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id UUID NOT NULL REFERENCES approval_gates(id),
  decided_by TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approved', 'rejected', 'changes-requested')),
  comment TEXT,
  via_timeout BOOLEAN DEFAULT FALSE,
  decided_at TIMESTAMPTZ DEFAULT now()
);
```

## Integration with Existing AgentCTL

### Component Mapping

| Existing Component | Evolution |
|-------------------|-----------|
| Session | Space (type: "solo") + single execution Thread |
| AgentPool | Space members (agent subset) + fleet scheduling |
| HandoffPolicy | TaskNode reassignment + Agent Bus "delegate" message |
| Fork / ContextPicker | Context Bridge UI (upgraded for cross-space) |
| SSE streams | Thread artifact live-update source |
| IPC Channel | Agent Bus container-local fallback |
| Memory (PG) | Shared cross-Space, scoped from session → space |
| BullMQ | Fleet-layer task dispatch (unchanged) |
| WebSocket | Space Messaging transport layer (upgraded) |

### Migration Strategy

Existing sessions become Spaces with `type: "solo"`. No breaking changes — the Space model is a superset of the current session model. Multi-agent capabilities layer on top.

## Implementation Phases

### Phase 1: Space + Thread + Messages (MVP)
- Wrap existing sessions as Spaces
- Thread = existing session message stream
- Single agent per Space, human interacts via Thread
- Mobile notification pipeline (basic)
- DB migration for spaces, threads, messages tables

### Phase 2: Multi-Agent Spaces
- Agent Bus (Postgres outbox + NATS JetStream)
- Append-only space_events table with sequence numbers and idempotency
- Multiple agents join one Space with subscription filters
- Agent-to-agent messages surface in Threads
- Basic Approval Gates with multi-decision support
- Message visibility controls (public/internal/silent)

### Phase 3: Task Graph + Fleet
- TaskDefinition/TaskRun split with WorkerLease claim protocol
- Pluggable executor (BullMQ now, Temporal later — no domain rewrite)
- Space ↔ TaskGraph mapping
- Fleet dashboard (bird's-eye all Spaces + machines)
- AgentProfile capability matching for task assignment
- Automatic task decomposition suggestions

### Phase 4: Context Bridge
- Snapshot + Version-Pinned modes (builds on existing ContextPicker)
- Cross-Space Query MCP tool (aligned with MCP spec primitives)
- Subscription mode for human UI dashboards
- Permission model enforcement
- A2A-compatible edge for external agent interop (optional)

### Phase 5: Intelligence
- Agent auto-decomposes tasks → generates TaskGraph
- Optimal agent/machine assignment based on task affinity
- Learned approval gate timeout policies from history
- Proactive agents (SlackAgents-style: listen and chime in)

## Key Design Principles

1. **Human-on-the-Loop, not in-the-loop**: Agents run autonomously. Humans are notified at critical points (approval gates, failures, escalations). Mobile UX is notification-driven.
2. **Rich artifacts, not just text**: Code diffs, live terminals, test results, diagrams — all first-class citizens in threads. Not attachments to messages, but interactive components.
3. **Cross-space context is a first-class feature**: The ability to cherry-pick, reference, or query context across spaces is a key differentiator. Builds on existing ContextPicker/Fork infrastructure.
4. **Progressive complexity**: A simple task looks like a chat with one agent (current UX). Complexity emerges only when needed (multi-agent, task graph, cross-space).
5. **Everything auditable**: All agent-to-agent messages are logged. "Internal" visibility hides noise from humans but preserves full audit trail.

## Open Questions

1. **Temporal timeline**: At what scale do we migrate the task executor from BullMQ to Temporal? Codex recommends earlier adoption. Decision: design executor interface as pluggable from Phase 3, evaluate Temporal migration based on whether multi-day approval waits or compensation flows become common.
2. **A2A adoption**: Should AgentCTL expose Agent Cards for external discovery? Low priority unless third-party agent integration becomes a user request.
3. **LangGraph for subflows**: Worth evaluating for agent-local checkpointed subflows (within a single task), distinct from the fleet-level task graph. Could complement rather than replace our DAG engine.
4. **Summarizer agent**: Should thread summarization be a built-in system service or a configurable agent role? Leaning toward system service for predictability.

## Appendix: Codex Review (gpt-5.4, xhigh reasoning)

Independent review conducted 2026-03-12. Key findings incorporated into this document:

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | Critical | No durable event model; Redis PubSub has no delivery guarantees | Replaced with Postgres outbox + NATS JetStream; added SpaceEvent with sequence/idempotency |
| 2 | Critical | TaskNode conflates definition and execution; no retry/lease/heartbeat | Split into TaskDefinition + TaskRun + WorkerLease |
| 3 | High | Cross-space live-sync breaks auditability (version drift) | Replaced reference/copy/live-sync with snapshot/version-pinned/query/subscription; agents default to immutable |
| 4 | High | Missing first-class identity and capability entities | Added AgentProfile, AgentInstance, WorkerNode with capabilities and budgets |
| 5 | High | Artifact model is UI-shaped, not storage/provenance-shaped | Added content hash, blob URI, MIME, schema version, commit SHA, sensitivity, versioning |
| 6 | High | CP failure semantics undefined | Added explicit failure semantics table for all failure modes |
| 7 | Medium | ChatCollab cost problem not solved | Added subscription filters per agent + summarizer + cost budgets per space |
| 8 | Medium | SQL schema integrity bugs | Fixed creation order, added member_type to PK, removed circular refs, proper FKs |

Competitive gaps surfaced: LangGraph, AutoGen/AG2, OpenHands, OpenAI Agents SDK, Claude Code subagents, Langroid, Google A2A, MCP spec evolution. Added to Industry Landscape table.

## References

- [ChatCollab: Exploring Collaboration Between Humans and AI Agents in Software Teams](https://arxiv.org/abs/2412.01992)
- [SlackAgents: Scalable Collaboration of AI Agents in Workspaces](https://aclanthology.org/2025.emnlp-demos.76.pdf)
- [Human-in-the-Loop for AI Agents: Best Practices](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo)
- [Why 2026 is the year of Human-on-the-Loop AI](https://www.torryharris.com/insights/articles/human-on-the-loop-ai)
- [Multi-Agent Frameworks Explained for Enterprise AI Systems](https://www.adopt.ai/blog/multi-agent-frameworks)
- [Google A2A Protocol](https://a2aprotocol.ai/)
- [MCP Specification (latest)](https://modelcontextprotocol.io/specification/2025-11-25/changelog)
- [NATS JetStream](https://docs.nats.io/nats-concepts/jetstream/consumers)
- [Temporal Workflows](https://docs.temporal.io/)
- [OpenHands WebSocket/Events](https://docs.all-hands.dev/openhands/usage/developers/websocket-connection)
- [OpenAI Agents SDK Multi-Agent](https://openai.github.io/openai-agents-python/multi_agent/)
- [AutoGen User Guide](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/index.html)
- [LangChain Multi-Agent](https://docs.langchain.com/oss/python/langchain/multi-agent)
- [slock.ai](https://slock.ai/)
