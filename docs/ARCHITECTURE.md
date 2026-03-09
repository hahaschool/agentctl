# Architecture Decisions

## 1. Control Plane

The control plane is the central brain. It runs on the most reliable machine (likely EC2) and manages agent lifecycle across all machines.

### Components

**Agent Registry** (PostgreSQL)
```sql
CREATE TABLE machines (
  id TEXT PRIMARY KEY,                    -- human-readable (hostname or custom ID)
  hostname TEXT UNIQUE NOT NULL,        -- Tailscale MagicDNS hostname
  tailscale_ip INET NOT NULL,           -- 100.x.x.x address
  os TEXT NOT NULL,                      -- linux/darwin
  arch TEXT NOT NULL,                    -- x64/arm64
  status TEXT DEFAULT 'online',         -- online/offline/degraded
  last_heartbeat TIMESTAMPTZ,
  capabilities JSONB DEFAULT '{}',      -- {gpu: false, docker: true, ...}
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id TEXT REFERENCES machines(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,                    -- heartbeat/cron/manual/adhoc
  status TEXT DEFAULT 'idle',           -- idle/running/paused/error/stopped
  schedule TEXT,                         -- cron expression or interval
  project_path TEXT,
  worktree_branch TEXT,
  current_session_id TEXT,              -- Claude Code session ID for resume
  config JSONB DEFAULT '{}',           -- allowedTools, model, etc.
  last_run_at TIMESTAMPTZ,
  last_cost_usd NUMERIC(10,6),
  total_cost_usd NUMERIC(12,6) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id),
  trigger TEXT NOT NULL,                 -- schedule/manual/signal/adhoc
  status TEXT NOT NULL,                  -- running/success/failure/timeout/cancelled
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  cost_usd NUMERIC(10,6),
  tokens_in BIGINT,
  tokens_out BIGINT,
  model TEXT,
  provider TEXT,                         -- anthropic/bedrock/vertex
  session_id TEXT,
  error_message TEXT,
  result_summary TEXT
);

CREATE TABLE agent_actions (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID REFERENCES agent_runs(id),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  action_type TEXT NOT NULL,            -- bash/read/write/edit/web_search/mcp
  tool_name TEXT,
  tool_input JSONB,
  tool_output_hash TEXT,                -- SHA-256, not full output
  duration_ms INTEGER,
  approved_by TEXT                      -- null = auto, 'human' = manual approval
);
```

**Task Scheduler** (BullMQ → Temporal)

MVP uses BullMQ with Redis:
- Cron jobs: `new Queue('agent-cron')` with `repeat: { cron: '0 8 * * MON-FRI' }`
- Heartbeat: `repeat: { every: 30000 }` (30s interval)
- Manual: direct `queue.add()` from API
- Ad-hoc: immediate `queue.add()` with priority

Scale path to Temporal when needing:
- Durable multi-step workflows (plan → approve → execute → verify)
- Human-in-the-loop gates via Signals
- Workflows spanning hours/days with crash recovery
- Fan-out parallel agent execution with join

**LLM Router** (LiteLLM Proxy)

Runs as Docker container with this config structure:
```yaml
# infra/litellm/config.yaml
model_list:
  # Primary: Anthropic Direct (2 orgs for rate limit multiplication)
  - model_name: claude-sonnet
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
      api_key: os.environ/ANTHROPIC_KEY_ORG1
      rpm: 4000
      tpm: 400000

  - model_name: claude-sonnet
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
      api_key: os.environ/ANTHROPIC_KEY_ORG2
      rpm: 4000

  # Failover: AWS Bedrock
  - model_name: claude-sonnet
    litellm_params:
      model: bedrock/us.anthropic.claude-sonnet-4-20250514-v1:0
      aws_region_name: us-east-1
      rpm: 1000

  # Failover: Google Vertex AI
  - model_name: claude-sonnet
    litellm_params:
      model: vertex_ai/claude-sonnet-4-20250514
      vertex_project: os.environ/GCP_PROJECT
      rpm: 1000

  # Budget tier for simple tasks
  - model_name: claude-haiku
    litellm_params:
      model: anthropic/claude-haiku-4-5-20251001
      api_key: os.environ/ANTHROPIC_KEY_ORG1
      rpm: 4000

router_settings:
  routing_strategy: usage-based-routing
  num_retries: 3
  allowed_fails: 3
  cooldown_time: 60
  retry_after: 15

litellm_settings:
  fallbacks:
    - claude-sonnet: [claude-haiku]
  cache: true
  cache_params:
    type: redis
    host: os.environ/REDIS_HOST
```

### Runtime Management Plane

Claude Code and Codex now share a runtime-aware backend control surface instead
of being modeled as Claude-only session variants.

Canonical configuration lives in the control plane and is rendered per-runtime
on each worker:

- `ManagedRuntimeConfig` is the single source of truth for instructions, MCP
  servers, skills, sandbox mode, approval policy, and environment policy
- `runtime_config_revisions` stores versioned config bundles plus hashes
- `machine_runtime_state` stores per-machine apply results and drift signals

Unified runtime sessions and handoffs are tracked separately from the older
Claude-only `rc_sessions` table:

- `managed_sessions` tracks runtime, native session id, machine, project path,
  status, config revision, and handoff lineage
- `session_handoffs` stores the exported `HandoffSnapshot`, source/target
  runtimes, reason, strategy, and result
- `native_import_attempts` stores experimental native import probe attempts so
  the stable snapshot path remains auditable

Control-plane HTTP surface:

- `GET|PUT /api/runtime-config/defaults`
- `POST /api/runtime-config/sync`
- `GET /api/runtime-config/drift`
- `GET|POST /api/runtime-sessions`
- `POST /api/runtime-sessions/:id/resume`
- `POST /api/runtime-sessions/:id/fork`
- `POST /api/runtime-sessions/:id/handoff`

## 2. Agent Worker

The worker daemon runs on each machine, managing local agent instances.

### Runtime Architecture

```
agent-worker process (PM2 managed)
├── HealthReporter        → POST /heartbeat to control plane every 15s
├── TaskConsumer           → BullMQ consumer, pulls jobs from Redis
├── AgentPool              → Map<agentId, AgentInstance>
│   ├── AgentInstance #1   → Claude Agent SDK session (subprocess)
│   │   ├── HookHandler    → PreToolUse/PostToolUse/Stop events
│   │   ├── OutputBuffer   → SSE broadcast to dashboard
│   │   └── WorktreeManager → git worktree lifecycle
│   └── AgentInstance #2
├── IpcWatcher             → Polls data/ipc/ for container outputs (1000ms)
└── MetricsExporter        → Prometheus /metrics endpoint on :9090
```

### Runtime Adapters and Handoff

The worker now exposes a runtime adapter layer so Claude Code and Codex share a
single lifecycle API.

- `ClaudeRuntimeAdapter` wraps the existing Claude session manager
- `CodexRuntimeAdapter` wraps Codex CLI `exec`, `exec resume`, and `fork`
- `RuntimeRegistry` resolves adapters by managed runtime id
- `RuntimeConfigApplier` renders native Claude/Codex config files and reports
  capability state

Cross-runtime switching is implemented as a two-step handoff:

1. Export a portable `HandoffSnapshot` from the source runtime
2. Start the target runtime from that snapshot on the same project/worktree

The stable path is `snapshot-handoff`. Experimental native import probes run
first when enabled, but they are allowed to fail and automatically fall back to
the snapshot path without breaking the handoff.

### Agent Instance Lifecycle

```
REGISTERED → STARTING → RUNNING → STOPPING → STOPPED
                ↓                     ↓
             ERROR ←──────────── TIMEOUT
                ↓
           RESTARTING (auto, up to 3 times)
```

### Hooks for Monitoring

```typescript
// packages/agent-worker/src/hooks/audit-hook.ts
import { writeFileSync, appendFileSync } from 'fs';
import { createHash } from 'crypto';

interface HookInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export function handlePreToolUse(input: HookInput): 'allow' | 'deny' {
  const entry = {
    timestamp: new Date().toISOString(),
    session_id: input.session_id,
    tool: input.tool_name,
    input_hash: createHash('sha256')
      .update(JSON.stringify(input.tool_input))
      .digest('hex'),
    decision: 'allow' as const,
  };

  // Block dangerous patterns
  if (input.tool_name === 'Bash') {
    const cmd = String(input.tool_input.command || '');
    const blocked = ['rm -rf /', 'curl | sh', 'wget -O- | bash', '> /etc/'];
    if (blocked.some(p => cmd.includes(p))) {
      entry.decision = 'deny';
    }
  }

  appendFileSync('/var/log/agentctl/audit.ndjson', JSON.stringify(entry) + '\n');
  return entry.decision;
}
```

## 3. Memory Architecture

Three-tier memory system:

### Tier 1: CLAUDE.md (Git-native, travels with code)
- `~/.claude/CLAUDE.md` — user-level preferences
- `./CLAUDE.md` — project-level instructions (this file)
- `.claude/rules/*.md` — fine-grained rules

### Tier 2: Mem0 (Cross-device, API-accessible)
- Self-hosted Docker: `docker run -p 8080:8080 mem0/mem0:latest`
- Scoped by `user_id` (you), `agent_id` (specific agent), `session_id`
- Auto-extracts atomic facts, detects conflicts, resolves via LLM
- REST API for add/search/get operations

```typescript
// Memory sync on agent task completion
async function syncMemory(agentId: string, sessionSummary: string) {
  await mem0.add({
    messages: [{ role: 'user', content: sessionSummary }],
    user_id: 'yuu',
    agent_id: agentId,
    metadata: { machine: hostname(), timestamp: Date.now() }
  });
}
```

### Tier 3: .mv2 File (Portable, git-committable)
- Single binary file from claude-brain/Memvid
- Sub-ms search over 10K+ memories, stays under 5MB
- Backup/archive: `cp project.mv2 backups/$(date +%Y%m%d).mv2`

### Import Pipeline

```
Claude Code JSONL sessions ──┐
                              ├──► ETL Script ──► Mem0 API
claude-mem SQLite/ChromaDB ──┘         │
                                       ├──► .mv2 archive
                                       └──► CLAUDE.md summaries
```

## 4. Networking (Tailscale)

### Topology

```
┌──────────────────────────────────────────────────────┐
│                   Tailscale Mesh                      │
│                                                       │
│  ec2-control (100.x.x.1)    ← Control Plane          │
│  ├── :8080  API server                                │
│  ├── :6379  Redis (BullMQ)                            │
│  ├── :5432  PostgreSQL                                │
│  ├── :4000  LiteLLM Proxy                             │
│  └── :8000  Mem0 Server                               │
│                                                       │
│  mac-mini-worker (100.x.x.2)  ← Worker Node          │
│  ├── :9000  Agent Worker API                          │
│  ├── :9090  Prometheus metrics                        │
│  └── :9100  SSE agent streams                         │
│                                                       │
│  laptop-worker (100.x.x.3)    ← Worker Node          │
│  ├── :9000  Agent Worker API                          │
│  ├── :9090  Prometheus metrics                        │
│  └── :9100  SSE agent streams                         │
│                                                       │
│  iphone (100.x.x.4)           ← iOS Client           │
│  └── connects to :8080 on ec2-control                 │
└──────────────────────────────────────────────────────┘
```

### ACL Policy

```json
{
  "tagOwners": {
    "tag:control": ["autogroup:admin"],
    "tag:worker": ["autogroup:admin"],
    "tag:mobile": ["autogroup:admin"]
  },
  "acls": [
    {"action": "accept", "src": ["tag:control"], "dst": ["tag:worker:9000-9100"]},
    {"action": "accept", "src": ["tag:worker"], "dst": ["tag:control:4000,5432,6379,8000,8080"]},
    {"action": "accept", "src": ["tag:mobile"], "dst": ["tag:control:8080"]}
  ],
  "ssh": [
    {"action": "accept", "src": ["tag:control"], "dst": ["tag:worker"], "users": ["autogroup:nonroot"]}
  ]
}
```

## 5. Wire Protocol (Control Plane ↔ Worker)

### Agent Commands (HTTP POST)

```typescript
// POST /api/agents/:id/start
interface StartAgentRequest {
  prompt?: string;          // Initial prompt (ad-hoc)
  resume_session?: string;  // Resume existing session
  model?: string;           // Override default model
  tools?: string[];         // Override allowed tools
}

// POST /api/agents/:id/stop
interface StopAgentRequest {
  reason: 'user' | 'timeout' | 'error' | 'schedule';
  graceful: boolean;        // Wait for current turn to complete
}

// POST /api/agents/:id/message
interface SendMessageRequest {
  content: string;          // User message to inject
  approval?: boolean;       // For human-in-the-loop gates
}
```

### Agent Events (SSE)

```typescript
// GET /api/agents/:id/stream (SSE)
type AgentEvent =
  | { event: 'output'; data: { type: 'text' | 'tool_use' | 'tool_result'; content: string } }
  | { event: 'status'; data: { status: AgentStatus; reason?: string } }
  | { event: 'cost'; data: { turn_cost: number; total_cost: number } }
  | { event: 'approval_needed'; data: { tool: string; input: unknown; timeout_s: number } }
  | { event: 'heartbeat'; data: { timestamp: number } };
```

## 6. Phased Implementation Plan

### Phase 1: Foundation (Week 1-2)
- [ ] Monorepo setup (pnpm workspaces, tsconfig, biome)
- [ ] Tailscale mesh across all machines
- [ ] Basic control plane API (Express/Fastify)
- [ ] PostgreSQL schema + migrations (drizzle-orm)
- [ ] Single agent worker with Claude Agent SDK
- [ ] PM2 ecosystem config for worker persistence
- [ ] Health check heartbeat loop

### Phase 2: Scheduling & Routing (Week 3-4)
- [ ] BullMQ integration for cron/heartbeat/manual triggers
- [ ] LiteLLM proxy deployment with multi-provider config
- [ ] Agent hooks (PreToolUse audit logging)
- [ ] Git worktree management (bare repo pattern)
- [ ] SSE streaming of agent output

### Phase 3: Memory & iOS (Week 5-6)
- [ ] Mem0 self-hosted deployment
- [ ] Import scripts (claude-mem, JSONL history)
- [ ] Memory injection into agent system prompts
- [ ] React Native (Expo) iOS app skeleton
- [ ] WebSocket control + E2E encryption (TweetNaCl)
- [ ] Push notifications (APNs via Expo)

### Phase 4: Polish & Scale (Week 7-8)
- [ ] Web dashboard with xterm.js terminal rendering
- [ ] Cost tracking dashboard (per-agent, per-model, per-day)
- [ ] Multi-agent parallel execution with worktree isolation
- [ ] Container sandboxing (gVisor + seccomp profiles)
- [ ] Vector → ClickHouse log pipeline
- [ ] Human-in-the-loop approval flow
