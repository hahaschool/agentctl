# Multi-Agent Collaboration Design

**Date**: 2026-03-12
**Status**: Draft — pending Codex review
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

| Product | Collaboration Model | Human Role |
|---------|--------------------|------------|
| Devin | Compound AI (Planner/Coder/Critic) | PR review, conversational UI |
| Cursor | 8 parallel subagents, background agents | IDE direct control |
| Antigravity | Multi-agent from day one, artifact-based | Multi-workflow oversight |
| CrewAI | Role-based agent teams, HumanTool | Decision-maker / fallback |
| slock.ai | Slack-like workspace (early/stealth) | Peer in channels |

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

### Primary Entities

```typescript
type Space = {
  id: string
  name: string
  description: string
  icon?: string
  type: "collaboration" | "solo" | "fleet-overview"
  members: SpaceMember[]
  threads: Thread[]
  artifacts: Artifact[]
  contextBridge: ContextLink[]
  taskGraphId: string | null
  createdBy: string
  createdAt: Date
}

type SpaceMember = {
  spaceId: string
  memberType: "human" | "agent"
  memberId: string
  role: "owner" | "member" | "observer"
}

type Thread = {
  id: string
  spaceId: string
  title: string
  type: "discussion" | "execution" | "review" | "approval"
  messages: Message[]
  artifacts: Artifact[]
  taskNodeId: string | null
  controls: ThreadControls
  createdAt: Date
}

type TaskNode = {
  id: string
  graphId: string
  type: "task" | "gate" | "fork" | "join"
  status: "pending" | "running" | "blocked" | "completed" | "failed"
  assigneeType: "agent" | "human" | null
  assigneeId: string | null
  dependencies: Array<{ nodeId: string; type: "blocks" | "context" }>
  spaceId: string
  threadId: string
  machineId: string | null
  artifacts: ArtifactRef[]
}
```

### Artifact System

```typescript
type Artifact = {
  id: string
  spaceId: string
  threadId: string
  taskNodeId?: string
  kind: ArtifactKind
  visibility: "space" | "thread" | "public"
  linkedFrom: Array<{ spaceId: string; threadId: string }>
  createdAt: Date
}

type ArtifactKind =
  | { type: "code-diff"; before: string; after: string; language: string; filePath: string }
  | { type: "terminal"; sessionId: string; live: boolean }
  | { type: "test-result"; passed: number; failed: number; summary: string }
  | { type: "file"; path: string; content: string; language: string }
  | { type: "diagram"; source: string; format: "mermaid" | "dot" }
  | { type: "log"; entries: LogEntry[]; levelFilter?: string }
  | { type: "context-snapshot"; messages: unknown[]; tokens: number; compressed: boolean }
```

### Context Bridge (Cross-Space Context Mobility)

```typescript
type ContextLink = {
  id: string
  sourceSpaceId: string
  sourceArtifactIds: string[]
  targetSpaceId: string
  targetThreadId: string
  mode: "reference" | "copy" | "live-sync"
  injectionMethod: "system-prompt" | "context-window" | "tool-accessible"
  createdAt: Date
}
```

Three modes:

1. **Reference**: Read-only pointer. Source updates reflect in target. Zero token cost until accessed.
2. **Copy (Import)**: Snapshot into target context. Independent of source after creation. Uses existing ContextPicker UI for cherry-picking.
3. **Live Bridge**: Agent can query another space's artifacts on demand via MCP tool. No pre-loading into context window.

## Communication Architecture

### Three-Layer Model

```
Layer 1: Space Messaging (Human ↔ Agent)
  Protocol: WebSocket (bidirectional)
  Format: Rich Messages (text + artifacts + controls)
  Routing: Space → Thread → Members

Layer 2: Agent Bus (Agent ↔ Agent)
  Protocol: Redis PubSub (same machine) / NATS (cross-machine)
  Format: Typed AgentMessage envelope
  Routing: agent-id → agent-id, or broadcast to space
  Visibility: Messages auto-surface to Space Threads

Layer 3: Fleet Control (CP ↔ Workers)
  Protocol: Existing REST + SSE + BullMQ
  Format: Existing AgentEvent / HandoffEvent
  Routing: CP → Worker (task dispatch, handoff)
```

### Agent Bus Message Format

```typescript
type AgentMessage = {
  id: string
  from: string               // AgentId
  to: string | "broadcast"   // AgentId or SpaceBroadcast
  spaceId: string
  threadId: string
  type: "request" | "response" | "inform" | "delegate" | "escalate"
  payload: AgentPayload
  visibility: "public" | "internal" | "silent"
  replyTo?: string
  timestamp: number
}

type AgentPayload =
  | { kind: "ask"; question: string; context?: ArtifactRef[] }
  | { kind: "deliver"; artifacts: Artifact[] }
  | { kind: "delegate-task"; taskNodeId: string; briefing: string }
  | { kind: "escalate-to-human"; reason: string; urgency: "low" | "high" | "critical" }
  | { kind: "steer"; instruction: string }
```

### Message Visibility Rules

- **public** (default): Appears in Space Thread, humans see it
- **internal**: Hidden by default, humans can expand "agent internal discussion" to view
- **silent**: Audit-only, not displayed (heartbeats, acks, protocol noise)

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

### Approval Gates

```typescript
type ApprovalGate = {
  id: string
  taskNodeId: string
  threadId: string
  requiredApprovers: Array<string>  // HumanId or "any-human"
  timeoutMs: number
  timeoutPolicy: "auto-approve" | "escalate" | "pause" | "reject"
  context: ArtifactRef[]
  decision?: {
    by: string
    action: "approved" | "rejected" | "changes-requested"
    comment?: string
    timestamp: number
  }
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

## Database Schema

```sql
-- Spaces
CREATE TABLE spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('collaboration', 'solo', 'fleet-overview')),
  visibility TEXT DEFAULT 'team' CHECK (visibility IN ('private', 'team', 'public')),
  task_graph_id UUID REFERENCES task_graphs(id),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE space_members (
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  member_type TEXT NOT NULL CHECK (member_type IN ('human', 'agent')),
  member_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'observer')),
  PRIMARY KEY (space_id, member_id)
);

-- Threads
CREATE TABLE threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('discussion', 'execution', 'review', 'approval')),
  title TEXT,
  task_node_id UUID REFERENCES task_nodes(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES threads(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('human', 'agent', 'system')),
  sender_id TEXT NOT NULL,
  content JSONB NOT NULL,
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'internal', 'silent')),
  reply_to UUID REFERENCES messages(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Artifacts
CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES threads(id),
  task_node_id UUID,
  kind TEXT NOT NULL,
  data JSONB NOT NULL,
  visibility TEXT DEFAULT 'space' CHECK (visibility IN ('space', 'thread', 'public')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Context Links (cross-space)
CREATE TABLE context_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_space_id UUID REFERENCES spaces(id),
  source_artifact_ids UUID[] NOT NULL,
  target_space_id UUID REFERENCES spaces(id),
  target_thread_id UUID REFERENCES threads(id),
  mode TEXT NOT NULL CHECK (mode IN ('reference', 'copy', 'live-sync')),
  injection_method TEXT CHECK (injection_method IN ('system-prompt', 'context-window', 'tool-accessible')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Task Graph
CREATE TABLE task_graphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE task_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id UUID REFERENCES task_graphs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('task', 'gate', 'fork', 'join')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'blocked', 'completed', 'failed')),
  assignee_type TEXT CHECK (assignee_type IN ('agent', 'human')),
  assignee_id TEXT,
  machine_id TEXT,
  parent_id UUID REFERENCES task_nodes(id),
  space_id UUID REFERENCES spaces(id),
  thread_id UUID REFERENCES threads(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE task_edges (
  from_node UUID REFERENCES task_nodes(id) ON DELETE CASCADE,
  to_node UUID REFERENCES task_nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('blocks', 'context')),
  PRIMARY KEY (from_node, to_node)
);

-- Approval Gates
CREATE TABLE approval_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_node_id UUID REFERENCES task_nodes(id),
  thread_id UUID REFERENCES threads(id),
  required_approvers TEXT[] NOT NULL,
  timeout_ms INTEGER DEFAULT 3600000,
  timeout_policy TEXT DEFAULT 'pause' CHECK (timeout_policy IN ('auto-approve', 'escalate', 'pause', 'reject')),
  context_artifact_ids UUID[],
  decision_by TEXT,
  decision_action TEXT CHECK (decision_action IN ('approved', 'rejected', 'changes-requested')),
  decision_comment TEXT,
  decided_at TIMESTAMPTZ
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
- Agent Bus (Redis PubSub, same-machine first)
- Multiple agents join one Space
- Agent-to-agent messages surface in Threads
- Basic Approval Gates
- Message visibility controls (public/internal/silent)

### Phase 3: Task Graph + Fleet
- TaskNode DAG engine
- Space ↔ TaskGraph mapping
- Fleet dashboard (bird's-eye all Spaces + machines)
- NATS for cross-machine Agent Bus
- Automatic task decomposition suggestions

### Phase 4: Context Bridge
- Reference + Import modes (builds on existing ContextPicker)
- Cross-Space Query MCP tool
- Live Bridge (bidirectional sync)
- Permission model enforcement

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

## References

- [ChatCollab: Exploring Collaboration Between Humans and AI Agents in Software Teams](https://arxiv.org/abs/2412.01992)
- [SlackAgents: Scalable Collaboration of AI Agents in Workspaces](https://aclanthology.org/2025.emnlp-demos.76.pdf)
- [Human-in-the-Loop for AI Agents: Best Practices](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo)
- [Why 2026 is the year of Human-on-the-Loop AI](https://www.torryharris.com/insights/articles/human-on-the-loop-ai)
- [Multi-Agent Frameworks Explained for Enterprise AI Systems](https://www.adopt.ai/blog/multi-agent-frameworks)
- [slock.ai](https://slock.ai/)
