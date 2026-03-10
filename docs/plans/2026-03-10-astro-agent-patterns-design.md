# Design: Astro Agent Patterns Adoption

> Date: 2026-03-10
> Status: Draft
> Scope: Worker runtime, control plane orchestration, shared protocol
> Reference: [astro-anywhere/astro-agent](https://github.com/astro-anywhere/astro-agent)

## Context

Astro Agent is an open-source agent runner with design patterns that align well with
AgentCTL's roadmap. This document evaluates six specific patterns from their codebase,
maps each against our current architecture, and proposes concrete integration plans.

Our existing design doc
[codex-claude-runtime-unification](2026-03-09-codex-claude-runtime-unification-design.md)
already covers runtime adapter abstraction and handoff. This document focuses on
**complementary patterns** that the unification design does not address.

## Patterns Evaluated

| # | Pattern | Astro Source | Overlap with Existing Design |
|---|---------|-------------|------------------------------|
| 1 | Provider Adapter + TaskOutputStream | `src/providers/base-adapter.ts` | Partial — runtime unification covers adapter contract, not output streaming |
| 2 | Execution Strategy Registry | `src/execution/registry.ts` | None — we have no execution-environment abstraction |
| 3 | Workdir Safety Tiers | `src/lib/workdir-safety.ts` | None — we rely solely on git worktree isolation |
| 4 | Structured Execution Summary | `base-adapter.ts` SUMMARY_PROMPT | None — `agent_runs.result_summary` is a free-text field |
| 5 | Mid-Execution Steering | `claude-sdk-adapter.ts` Query.streamInput | Partial — we have signal injection but no interactive steering |
| 6 | Dispatch Signature Verification | `types.ts` dispatchSignature | None — we trust Tailscale network layer only |

---

## Pattern 1: TaskOutputStream — Unified Output Streaming

### What Astro Does

Every provider adapter emits events through a single `TaskOutputStream` interface:

```typescript
interface TaskOutputStream {
  text(data: string): void;
  toolUse(toolName: string, toolInput: unknown): void;
  toolResult(toolName: string, result: unknown, success: boolean): void;
  fileChange(path: string, action: 'created' | 'modified' | 'deleted', ...): void;
  sessionInit(sessionId: string, model?: string): void;
  approvalRequest(question: string, options: string[]): Promise<ApprovalResult>;
}
```

This decouples CLI output parsing (adapter-specific) from event dispatch (shared).

### Our Current State

- `sdk-runner.ts` converts Claude SDK messages into `AgentInstance` EventEmitter events
- Events are typed but tightly coupled to Claude's message format
- `OutputBuffer` accumulates events for SSE broadcast
- No adapter boundary — if we add Codex, we'd duplicate the entire event pipeline

### What to Adopt

Introduce `AgentOutputStream` as a shared contract between runtime adapters and the
event pipeline. This sits between the runtime adapter (which parses CLI output) and
`OutputBuffer` (which broadcasts to SSE/WebSocket).

```typescript
// packages/shared/src/protocol/agent-output-stream.ts
interface AgentOutputStream {
  text(data: string): void;
  thinking(data: string): void;
  toolUse(toolName: string, toolInput: unknown): void;
  toolResult(toolName: string, result: unknown, success: boolean): void;
  fileChange(path: string, action: FileChangeAction, diff?: string): void;
  sessionInit(sessionId: string, model?: string): void;
  costUpdate(turnCost: number, totalCost: number): void;
  approvalRequest(question: string, options: string[]): Promise<ApprovalResult>;
  error(code: string, message: string): void;
}
```

**Difference from Astro:** We add `thinking()` and `costUpdate()` which Astro
doesn't track. We omit `stdout`/`stderr` raw streams — our SSE protocol is
already structured.

### Integration Point

- `AgentInstance` creates an `AgentOutputStream` impl backed by EventEmitter + OutputBuffer
- `sdk-runner.ts` becomes `ClaudeRuntimeAdapter.execute(task, stream, signal)`
- Future `CodexRuntimeAdapter` uses same `stream` interface
- Runtime unification design's `RuntimeAdapter` contract gains `execute(task, stream, signal)`

### Effort: 2 days

Refactor `sdk-runner.ts` message handling into stream calls. Existing EventEmitter
stays as the implementation behind the interface.

---

## Pattern 2: Execution Strategy Registry

### What Astro Does

Separates "what agent to use" from "where to run it" with an orthogonal strategy layer:

```typescript
interface ExecutionStrategy {
  readonly id: 'direct' | 'slurm' | 'docker' | 'k8s-exec' | 'ssh';
  detect(): Promise<ExecutionStrategyDetection>;
  execute(spec: ExecutionSpec, callbacks: ExecutionCallbacks, signal: AbortSignal): Promise<ExecutionResult>;
  cancel(jobId: string): Promise<void>;
}
```

A `ExecutionStrategyRegistry` auto-detects available strategies at startup and the
task executor picks the appropriate one per-task.

### Our Current State

- Workers run tasks as local subprocesses only
- Control plane dispatches to workers via HTTP POST (machine selection is manual or round-robin)
- Docker containers are run via `docker exec` in scripts, not as a first-class execution path
- No detection of available compute backends

### What to Adopt

Add an `ExecutionEnvironment` abstraction to `agent-worker`. This is lighter than
Astro's full strategy — we don't need Slurm or K8s yet — but provides the extension
point.

```typescript
// packages/agent-worker/src/execution/environment.ts
interface ExecutionEnvironment {
  readonly id: string;
  readonly name: string;
  detect(): Promise<{ available: boolean; metadata?: Record<string, unknown> }>;
  prepare(task: TaskSpec): Promise<PreparedEnvironment>;
  cleanup(env: PreparedEnvironment): Promise<void>;
}

// Implementations (Phase 1)
class DirectEnvironment implements ExecutionEnvironment { ... }     // Current behavior
class DockerEnvironment implements ExecutionEnvironment { ... }     // gVisor container

// Implementations (Phase 2, when needed)
class SSHEnvironment implements ExecutionEnvironment { ... }        // Remote machine
class SlurmEnvironment implements ExecutionEnvironment { ... }      // HPC
```

**Key difference from Astro:** Our execution environment prepares the environment
(container, worktree, sandbox) but delegates agent execution to the runtime adapter.
Astro merges both concerns into the strategy. Our separation is cleaner:

```
ExecutionEnvironment.prepare() → sandbox/container/worktree
RuntimeAdapter.execute(task, stream, signal) → Claude/Codex agent
```

### Machine Registration Enhancement

Workers report available execution environments during registration:

```typescript
// In heartbeat payload
{
  machineId: 'mac-mini-office',
  executionEnvironments: [
    { id: 'direct', available: true },
    { id: 'docker', available: true, metadata: { runtime: 'gVisor' } },
  ],
  runtimeAdapters: [
    { id: 'claude-code', version: '1.0.22' },
    { id: 'codex', version: '0.1.2' },
  ],
}
```

Control plane can then make informed dispatch decisions:
- Task needs Docker isolation? → Only dispatch to machines with `docker` environment
- Task needs Codex? → Only dispatch to machines with `codex` adapter

### Effort: 3 days

Define interface + DirectEnvironment (wraps current behavior) + DockerEnvironment
(wraps existing Dockerfile patterns). Registry with auto-detection at startup.

---

## Pattern 3: Workdir Safety Tiers

### What Astro Does

Four-tier safety classification before task execution:

| Tier | Condition | Action |
|------|-----------|--------|
| `safe` | Git repo, clean state | Execute directly |
| `guarded` | Git repo, uncommitted changes | Warn, proceed |
| `risky` | Non-git directory | Require user confirmation |
| `unsafe` | Non-git + parallel tasks | Block execution |

Plus a sandbox mode: copy directory to temp, execute there, copy back on success.

### Our Current State

- Worktree manager creates isolated git branches per agent — this is always `safe`
- If worktree unavailable, we fall back to raw `projectPath` with no safety check
- No detection of uncommitted changes, non-git directories, or parallel conflicts
- No sandbox/copy-back pattern

### What to Adopt

Add `WorkdirSafetyCheck` as a pre-execution gate in `AgentInstance`:

```typescript
// packages/agent-worker/src/runtime/workdir-safety.ts
enum SafetyTier {
  SAFE = 'safe',
  GUARDED = 'guarded',
  RISKY = 'risky',
  UNSAFE = 'unsafe',
}

interface SafetyCheckResult {
  tier: SafetyTier;
  isGitRepo: boolean;
  hasUncommittedChanges: boolean;
  parallelTaskCount: number;
  warning?: string;
  blockReason?: string;
}

function checkWorkdirSafety(
  workdir: string,
  activeTaskCount: number,
): Promise<SafetyCheckResult>;
```

**Behavior per tier:**

1. **safe** → proceed (current worktree path)
2. **guarded** → emit `safety_warning` SSE event, proceed (user sees warning in dashboard)
3. **risky** → emit `safety_approval_needed` event, wait for user approval (mobile/web)
4. **unsafe** → reject task, emit `safety_blocked` event with reason

**Sandbox mode** (for risky directories approved by user):

```typescript
interface SandboxSetup {
  sandboxPath: string;
  originalPath: string;
  cleanup(): Promise<void>;
  copyBack(): Promise<void>;
}

async function createSandbox(workdir: string, taskId: string): Promise<SandboxSetup>;
```

### Integration Points

- `AgentInstance.start()` calls `checkWorkdirSafety()` before `attemptSdkRun()`
- Results flow through existing SSE event pipeline
- Mobile app gets new event types for safety prompts (mirrors existing approval flow)
- Control plane API: `POST /api/agents/:id/safety-decision` (approve/reject/sandbox)

### New Protocol Events

```typescript
// packages/shared/src/protocol/events.ts
type AgentSafetyEvent = {
  type: 'safety_warning' | 'safety_approval_needed' | 'safety_blocked';
  tier: SafetyTier;
  warning?: string;
  blockReason?: string;
  options?: Array<{ id: string; label: string }>;
};
```

### Effort: 2 days

Safety check function + SSE events + mobile/web approval flow (reuses existing
approval UI pattern).

---

## Pattern 4: Structured Execution Summary

### What Astro Does

After task completion, resumes the same session with a structured output prompt:

```typescript
const SUMMARY_PROMPT = `Produce a structured JSON summary of the work you just completed...`;

async generateSummary(taskId: string): Promise<ExecutionSummary | undefined> {
  // Resume session → send SUMMARY_PROMPT → parse JSON response
}
```

The summary includes: status, workCompleted, executiveSummary, keyFindings,
filesChanged, followUps, prUrl, branchName.

**Key insight:** The resumed session already has full context of what it just did,
so the summary is high-quality without re-reading files or parsing logs.

### Our Current State

- `agent_runs.result_summary` exists but is free-text (usually empty or the last
  assistant message)
- `PostToolUse` hook tracks individual tool calls but doesn't aggregate
- No structured summary type in shared protocol
- No mechanism to resume a completed session for summary generation

### What to Adopt

Add `ExecutionSummary` as a first-class type and generate it automatically on
task completion.

```typescript
// packages/shared/src/types/execution-summary.ts
type ExecutionSummary = {
  status: 'success' | 'partial' | 'failure';
  workCompleted: string;
  executiveSummary: string;
  keyFindings: string[];
  filesChanged: Array<{ path: string; action: 'created' | 'modified' | 'deleted' }>;
  commandsRun: number;
  toolUsageBreakdown: Record<string, number>;
  followUps: string[];
  branchName?: string;
  prUrl?: string;
  tokensUsed: { input: number; output: number };
  costUsd: number;
  durationMs: number;
};
```

**Two generation strategies:**

1. **Session resume (preferred):** After task completion, resume the same Claude Code
   session with SUMMARY_PROMPT. Agent has full context. Cost: ~$0.01 per summary
   (Haiku on cached context).

2. **Post-hoc aggregation (fallback):** If session resume is unavailable (session
   expired, different machine), construct summary from accumulated `PostToolUse`
   hook data + git diff. Lower quality but always available.

### Integration Points

- `AgentInstance.stop()` → attempt summary generation before emitting `stopped` event
- Summary stored in `agent_runs.result_summary` as JSONB (migrate from TEXT)
- New SSE event: `execution_summary` with full structured data
- Mobile/web: render summary card at end of session view
- Control plane: `GET /api/runs/:id/summary` returns structured data

### Database Migration

```sql
ALTER TABLE agent_runs
  ALTER COLUMN result_summary TYPE JSONB
  USING CASE
    WHEN result_summary IS NULL THEN NULL
    ELSE jsonb_build_object('workCompleted', result_summary)
  END;
```

### Effort: 3 days

Type definition + summary generation in worker + DB migration + SSE event + API
endpoint. The session-resume approach depends on Claude Agent SDK's resume
capability which we already use.

---

## Pattern 5: Mid-Execution Steering

### What Astro Does

Uses Claude Agent SDK's `Query.streamInput()` to inject messages into a running
session:

```typescript
// In claude-sdk-adapter.ts
private activeQueries = new Map<string, ActiveQuery>();

// Called when server sends task_steer message
steerTask(taskId: string, message: string) {
  const active = this.activeQueries.get(taskId);
  if (active?.query) {
    active.query.streamInput(message);
  }
}
```

The dashboard can send guidance mid-execution: "focus on error handling first",
"skip the tests for now", "use the existing auth module instead".

### Our Current State

- `POST /api/agents/:id/signal` exists but only sends a one-shot message as a
  new BullMQ job — it doesn't inject into the running session
- No reference to the live SDK `Query` object from the API layer
- `AgentInstance` holds the SDK subprocess reference but doesn't expose input injection
- Mobile app can stop/start agents but can't send mid-execution messages

### What to Adopt

Expose a steering channel from `AgentInstance` to the API layer:

```typescript
// packages/agent-worker/src/runtime/agent-instance.ts
class AgentInstance {
  // New: steering interface
  async steer(message: string): Promise<SteerResult> {
    if (this.status !== 'running') {
      return { accepted: false, reason: 'not_running' };
    }
    // Inject into active SDK query via streamInput()
    return this.sdkRunner.injectMessage(message);
  }
}
```

**Worker API:**

```
POST /api/agents/:agentId/steer
Body: { message: string, interrupt?: boolean }
Response: { accepted: boolean, reason?: string }
```

**Control Plane proxy:**

```
POST /api/agents/:agentId/steer
→ forwards to worker machine via HTTP
```

**Mobile/Web UX:**

- Text input at bottom of live session view (like a chat)
- "Steer" button sends message without stopping the agent
- Visual indicator when steer is accepted (checkmark) or rejected (agent not running)

### Protocol Events

```typescript
// New events
type AgentSteerEvent = {
  type: 'steer_sent';
  message: string;
  timestamp: string;
};

type AgentSteerAckEvent = {
  type: 'steer_ack';
  accepted: boolean;
  reason?: string;
};
```

### Prerequisites

- Requires Claude Agent SDK support for `Query.streamInput()` (available in latest SDK)
- For Codex: investigate equivalent capability (`codex exec --stdin`?)
- Runtime adapter contract gains `steer(message: string): Promise<SteerResult>`

### Effort: 3 days

SDK runner modification + worker API endpoint + control plane proxy + SSE events.
Mobile/web UI is a separate task.

---

## Pattern 6: Dispatch Signature Verification

### What Astro Does

Every dispatched task carries an ECDSA P-256 signature:

```typescript
interface Task {
  dispatchSignature?: string;  // base64url ECDSA
  dispatchSigningPayload?: {
    v: 1;
    nodeId: string;
    projectId: string;
    machineId: string;
    timestamp: string;
    nonce: string;
  };
}
```

The agent runner verifies the signature before executing, preventing man-in-the-middle
task injection even if the transport is compromised.

### Our Current State

- All traffic within Tailscale WireGuard mesh (encrypted, authenticated at network layer)
- No application-layer signing of dispatch payloads
- Worker trusts any request from the Tailscale network
- If Tailscale ACL is misconfigured, any mesh node could dispatch tasks

### What to Adopt

Add lightweight dispatch signing as defense-in-depth:

```typescript
// packages/shared/src/crypto/dispatch-signer.ts
interface DispatchSignature {
  version: 1;
  agentId: string;
  runId: string;
  machineId: string;
  timestamp: string;
  nonce: string;
  signature: string;  // Ed25519 (faster than ECDSA, TweetNaCl native)
}

// Control plane signs dispatches with its private key
function signDispatch(payload: DispatchPayload, secretKey: Uint8Array): string;

// Worker verifies with control plane's public key (distributed at registration)
function verifyDispatch(payload: DispatchPayload, signature: string, publicKey: Uint8Array): boolean;
```

**Key difference from Astro:** We use Ed25519 (TweetNaCl) instead of ECDSA P-256.
We already depend on TweetNaCl for E2E encryption — reuse the same library.

### Key Distribution

1. Control plane generates Ed25519 keypair at startup (or loads from env)
2. Public key distributed to workers during machine registration (`POST /api/machines/register`)
3. Workers store public key in local config
4. Every dispatch payload is signed; workers reject unsigned or invalid payloads

### Effort: 1 day

TweetNaCl sign/verify is ~20 lines. Add to dispatch path in `task-worker.ts` and
verification in worker's task consumer.

---

## Patterns NOT Adopted (and Why)

### DAG Task Decomposition

Astro's core differentiator is server-side goal decomposition into dependency graphs.
We deliberately skip this because:

- Our orchestration model is BullMQ (flat queue) → Temporal (workflow engine)
- Temporal natively supports DAG workflows with fan-out/fan-in
- Building a custom DAG scheduler would duplicate what Temporal provides
- When we migrate to Temporal (Phase 8 → future), DAG comes for free

### SSH Auto-Discovery

Astro reads `~/.ssh/config` to auto-discover and install agents on remote hosts.
We skip this because:

- Our fleet model is Tailscale mesh with explicit machine registration
- Machines are long-lived, not ephemeral SSH targets
- `scripts/setup-machine.sh` + fleet deploy workflow covers our use case
- Auto-SSH-install is a security risk we prefer to avoid (explicit > implicit)

### HPC/Slurm Integration

Astro has first-class Slurm support for university HPC clusters. We skip this because:

- Our target is personal/team fleets (laptop, Mac Mini, EC2), not shared HPC
- Adding Slurm complexity without a use case violates YAGNI

---

## Implementation Priority

### Phase A: Quick Wins (Week 1) — 6 days

| Pattern | Days | Dependency |
|---------|------|------------|
| 4. Execution Summary | 3 | None |
| 3. Workdir Safety | 2 | None |
| 6. Dispatch Signing | 1 | None |

**Rationale:** These are additive, don't restructure existing code, and deliver
immediate value. Execution summaries improve observability; safety tiers prevent
data loss; signing hardens security.

### Phase B: Streaming Abstraction (Week 2) — 2 days

| Pattern | Days | Dependency |
|---------|------|------------|
| 1. TaskOutputStream | 2 | Phase A (summary type) |

**Rationale:** Depends on Pattern 4's `ExecutionSummary` type. Creates the
foundation for multi-runtime support. Should land before or alongside the runtime
unification design's adapter work.

### Phase C: Steering & Execution Environments (Week 3) — 6 days

| Pattern | Days | Dependency |
|---------|------|------------|
| 5. Mid-Execution Steering | 3 | Phase B (stream interface) |
| 2. Execution Strategy Registry | 3 | Phase B (adapter interface) |

**Rationale:** Steering depends on the stream abstraction (steer-ack flows through
the same output stream). Execution environments depend on the adapter interface
existing.

### Total: ~14 days across 3 phases

---

## Relationship to Existing Roadmap

| Roadmap Phase | Patterns That Apply |
|---------------|-------------------|
| Phase 8.2 (Remote Control) | Pattern 1 (output stream), Pattern 5 (steering) |
| Phase 9 (Security) | Pattern 3 (safety tiers), Pattern 6 (dispatch signing) |
| Phase 10 (Codex) | Pattern 1 (output stream), Pattern 2 (exec environment) |
| Phase 10.2 (Handoff) | Pattern 4 (execution summary feeds handoff context) |

---

## Testing Strategy

### Unit Tests

- Safety tier classification (all 4 tiers with edge cases)
- Execution summary JSON parsing (valid, malformed, markdown-wrapped)
- Dispatch signature sign/verify round-trip
- Output stream event ordering guarantees

### Integration Tests

- Safety check → SSE event → approval flow → task execution
- Summary generation via session resume → JSONB storage → API retrieval
- Steering message → SDK injection → steer-ack event
- Signed dispatch → worker verification → task execution

### E2E Tests (Playwright)

- Mobile/web: safety warning display and approval interaction
- Mobile/web: execution summary card rendering
- Mobile/web: steering input during live session

---

## Decision Summary

1. Adopt all 6 patterns; skip DAG, SSH discovery, and Slurm
2. `AgentOutputStream` becomes the adapter-output contract (complements runtime unification)
3. `ExecutionEnvironment` is orthogonal to `RuntimeAdapter` — clean separation
4. Workdir safety is a pre-execution gate, not a new abstraction layer
5. Execution summaries use session-resume with post-hoc fallback
6. Steering requires SDK `streamInput()` support — Codex steering deferred until adapter lands
7. Dispatch signing uses Ed25519 via existing TweetNaCl dependency
