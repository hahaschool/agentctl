# Runtime Config Visibility — Design Spec

**Date:** 2026-03-28
**Status:** Draft v3 (post-Codex R2)
**Problem:** When a session reports MCP tools aren't loaded or behaves unexpectedly, there's no way to see what config was actually dispatched. The dispatch config (MCP servers, permissions, model, tools) is assembled in memory, sent to the worker, and never persisted.

## Scope Decision

This is a **run-level audit feature**. Config belongs to the run — the dispatch event. The session detail page surfaces it by looking up the latest run linked to this session.

Sessions created through direct routes (fork, resume, ad-hoc) bypass `task-worker` and produce no `agent_run`. These sessions show a precise empty state.

## Goals

1. Persist the dispatch config snapshot for every agent-dispatched run
2. Surface it from the session detail page via the associated run
3. Redact MCP env values (key names only), command paths (basenames only), and token-like args

## Non-Goals

- Config for fork/resume/ad-hoc sessions (no `agent_run` exists)
- General-purpose secret scanning across all fields
- Editing config from the UI (read-only)
- Capturing post-worker "effective" config (we store what task-worker sent)
- Config diffing between runs (future work)

---

## 1. Database: `dispatch_config` column on `agent_runs`

Add a nullable JSONB column to the existing `agent_runs` table.

**Schema change (Drizzle):**

```typescript
dispatchConfig: jsonb('dispatch_config').$type<DispatchConfigSnapshot | null>(),
```

**Migration SQL:**

```sql
ALTER TABLE agent_runs ADD COLUMN dispatch_config JSONB DEFAULT NULL;
```

No index needed — read by single-row lookup only.

**CRITICAL: Exclude from list queries.** `getRecentRuns()`, `getRun()`, and all list endpoints in `db-registry.ts` MUST explicitly select columns excluding `dispatch_config`. Only `getRunDispatchConfig()` and the dedicated API endpoint should return it.

**Type definition (in `packages/shared/src/types/dispatch-config.ts`):**

```typescript
import type { AgentConfig } from './agent.js';

/** Snapshot of what task-worker.ts dispatched to the worker. Read-only audit record. */
export type DispatchConfigSnapshot = {
  model: string | null;
  permissionMode: AgentConfig['permissionMode'] | null;
  allowedTools: string[] | null;
  mcpServers: Record<string, McpServerConfigRedacted> | null;
  systemPrompt: string | null;       // truncated to 500 chars
  defaultPrompt: string | null;      // truncated to 500 chars
  instructionsStrategy: AgentConfig['instructionsStrategy'] | null;
  mcpServerCount: number;
  accountProvider: string | null;
};

/** MCP server config with sensitive values redacted. */
export type McpServerConfigRedacted = {
  command: string;                    // basename only (e.g. "node", "uvx")
  args?: string[];                    // token-like args redacted
  envKeys?: string[];                 // only key names, no values
};
```

**Why on `agent_runs`, not `rc_sessions`:**
- A run = one dispatch with one specific config. 1:1 relationship.
- Sessions can be resumed by multiple runs with different configs.
- Runs are the audit unit.

## 2. Backend: Persist config at dispatch time

**File:** `packages/control-plane/src/scheduler/task-worker.ts`

After `unsignedPayload` assembly (~line 504), persist the snapshot:

```typescript
const dispatchConfig: DispatchConfigSnapshot = {
  model,
  permissionMode: agent.config?.permissionMode ?? null,
  allowedTools,
  mcpServers: mcpServers ? redactMcpServers(mcpServers) : null,
  systemPrompt: agent.config?.systemPrompt?.slice(0, 500) ?? null,
  defaultPrompt: agent.config?.defaultPrompt?.slice(0, 500) ?? null,
  instructionsStrategy: agent.config?.instructionsStrategy ?? null,
  mcpServerCount: mcpServers ? Object.keys(mcpServers).length : 0,
  accountProvider: accountProvider ?? null,
};

await dbRegistry.updateRunDispatchConfig(runId, dispatchConfig);
```

**Redaction function (in `packages/shared/src/format-utils.ts`):**

```typescript
const SECRET_ARG_PATTERN = /^--?(token|key|secret|password|credential|api[_-]?key)/i;
const LOOKS_LIKE_TOKEN = /^(sk-|xox[bpas]-|ghp_|gho_|Bearer )/;
const INLINE_SECRET = /^[A-Z_]+=.+/;  // KEY=value in args

export function redactMcpServers(
  servers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>,
): Record<string, McpServerConfigRedacted> {
  const result: Record<string, McpServerConfigRedacted> = {};
  for (const [name, config] of Object.entries(servers)) {
    result[name] = {
      command: basename(config.command),
      args: config.args?.map((arg, i, arr) => {
        if (i > 0 && SECRET_ARG_PATTERN.test(arr[i - 1])) return '[REDACTED]';
        if (LOOKS_LIKE_TOKEN.test(arg)) return '[REDACTED]';
        if (SECRET_ARG_PATTERN.test(arg) && arg.includes('=')) return arg.split('=')[0] + '=[REDACTED]';
        if (INLINE_SECRET.test(arg)) return arg.split('=')[0] + '=[REDACTED]';
        return arg;
      }),
      envKeys: config.env ? Object.keys(config.env) : undefined,
    };
  }
  return result;
}

function basename(cmd: string): string {
  return cmd.split('/').pop() ?? cmd;
}
```

**Security scope (explicit):** This redaction covers MCP server configs only — env values, command paths, and token-like args. Prompts (`systemPrompt`, `defaultPrompt`) are stored as-is (truncated to 500 chars). This is acceptable because prompts are already visible in session JSONL and the UI message view.

**DbRegistry methods:**

```typescript
async updateRunDispatchConfig(
  runId: string,
  config: DispatchConfigSnapshot,
): Promise<void> {
  await this.db
    .update(agentRuns)
    .set({ dispatchConfig: config })
    .where(eq(agentRuns.id, runId));
}

async getRunDispatchConfig(
  runId: string,
): Promise<DispatchConfigSnapshot | null> {
  const [row] = await this.db
    .select({ dispatchConfig: agentRuns.dispatchConfig })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1);
  return (row?.dispatchConfig as DispatchConfigSnapshot) ?? null;
}
```

## 3. API: Session-oriented config endpoint

**Endpoint:** `GET /api/sessions/:id/dispatch-config`

**File:** `packages/control-plane/src/api/routes/sessions.ts`

This endpoint encapsulates the session→run lookup internally:

```typescript
// 1. Find all runs with sessionId matching this session
// 2. Order by startedAt DESC, take first (latest)
// 3. Return { runId, runCount, config }
```

**Response type:**

```typescript
{
  runId: string | null;          // ID of the run whose config is shown
  runCount: number;              // total runs for this session (for "Run X of Y")
  config: DispatchConfigSnapshot | null;
}
```

Returns `404` if the session ID does not exist (consistent with `GET /api/sessions/:id`).
Returns `{ runId: null, runCount: 0, config: null }` when the session exists but has no runs.

**Why this approach (addressing Codex R1):**
- Single endpoint, no multi-step frontend resolution
- `runId` is explicit in the response — the frontend knows which run it's showing
- `runCount` enables "Run 1 of 3" display
- The session→run join is done server-side where it belongs
- No need to add `?sessionId` filter to existing runs endpoint

**Route registration:** Register in `sessions.ts` under the existing `/api/sessions` prefix. Not in `agents.ts`.

## 4. Frontend: "Config" tab on Session Detail Page

**File:** `packages/web/src/views/SessionDetailView.tsx`

Add a third tab: `Session | Memory | Config`

**New component:** `packages/web/src/components/SessionConfigTab.tsx`

**Props:** `{ sessionId: string }`

**Data flow:**
1. Fetch `GET /api/sessions/:id/dispatch-config`
2. If loading → skeleton placeholders
3. If `runCount === 0` → "No dispatch record — this session has no associated agent run."
4. If `config === null && runCount > 0` → "Config not captured for this run (pre-feature data)."
5. If `runCount > 1` → info line: "Showing config from latest dispatch (1 of {runCount} runs)."
6. Display config sections

**Layout:**

```
┌─────────────────────────────────────────────┐
│ Dispatch Configuration                       │
│ Captured when run was dispatched to worker   │
├─────────────────────────────────────────────┤
│                                              │
│ GENERAL                                      │
│ Model         claude-opus-4-6                │
│ Permission    bypassPermissions              │
│ Provider      claude_team                    │
│ Strategy      (not set)                      │
│                                              │
│ MCP SERVERS (8)                              │
│ ┌───────────────────────────────────────────┐│
│ │ slack                                     ││
│ │   slack-mcp-server --transport stdio      ││
│ │   env: SLACK_MCP_XOXP_TOKEN              ││
│ │                                           ││
│ │ clickhouse                                ││
│ │   uv run --with mcp-clickhouse ...        ││
│ │                                           ││
│ │ warehouse-agent                           ││
│ │   node dist/index.js                      ││
│ └───────────────────────────────────────────┘│
│                                              │
│ TOOL RESTRICTIONS                            │
│ Allowed:     (all — no restrictions)         │
│                                              │
│ PROMPTS                                      │
│ Default: 开始处理工单                         │
│ System:  (not set)                           │
└─────────────────────────────────────────────┘
```

**Loading state:** Skeleton within tab content. Tab bar itself is always visible.

## 5. File Changes Summary

| File | Change |
|------|--------|
| `packages/shared/src/types/dispatch-config.ts` | New: `DispatchConfigSnapshot`, `McpServerConfigRedacted` |
| `packages/shared/src/redact-mcp.ts` | New: `redactMcpServers()` |
| `packages/shared/src/types/index.ts` | Re-export new types |
| `packages/control-plane/src/db/schema.ts` | Add `dispatchConfig` column |
| `packages/control-plane/src/db/migrations/0004_dispatch_config.sql` | Migration |
| `packages/control-plane/src/registry/db-registry.ts` | Add `updateRunDispatchConfig()`, `getRunDispatchConfig()`. Exclude from list selects. |
| `packages/control-plane/src/api/routes/sessions.ts` | Add `GET /:id/dispatch-config` |
| `packages/control-plane/src/scheduler/task-worker.ts` | Persist config after assembly |
| `packages/web/src/lib/api.ts` | Add `getSessionDispatchConfig(sessionId)` |
| `packages/web/src/lib/queries.ts` | Add `sessionDispatchConfigQuery(sessionId)` query function |
| `packages/web/src/components/SessionConfigTab.tsx` | New component |
| `packages/web/src/views/SessionDetailView.tsx` | Add "Config" tab |

## 6. Edge Cases

| Scenario | Behavior |
|----------|----------|
| Run fails before dispatch | `dispatch_config` is null — "Config not captured (run failed before dispatch)" |
| Retried run | Each retry is a separate run with its own config |
| Resumed session (N runs) | Shows latest run's config. "Showing 1 of N dispatches." |
| Discovered session (no run) | "No dispatch record — this session has no associated agent run" |
| Fork/resume via session route | No `agent_run` created — same as above |
| Pre-feature runs | `dispatch_config` is null — "Config not available (pre-capture)" |
| Large MCP env blocks | Only key names stored. Bounded size. |

## 7. Testing

- **Unit:** `redactMcpServers` — basenames, arg redaction (--token, --key=, KEY=, sk- prefix), env key-only extraction, inline secrets
- **Unit:** `updateRunDispatchConfig` / `getRunDispatchConfig` — round-trip JSONB
- **Unit:** `SessionConfigTab` — renders all sections; null/empty/multi-run states
- **Unit:** Run list queries do NOT include `dispatchConfig` column
- **Integration:** dispatch → persist → `GET /sessions/:id/dispatch-config` → verify
