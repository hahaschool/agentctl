# Runtime Config Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist dispatch config for every agent run and display it on the session detail page.

**Architecture:** Add a `dispatch_config` JSONB column to `agent_runs`, populate it from `task-worker.ts` at dispatch time with redacted MCP configs, and expose it via a `GET /api/sessions/:id/dispatch-config` endpoint. The frontend adds a "Config" tab to `SessionDetailView` that lazily fetches and renders the config.

**Tech Stack:** Drizzle ORM (schema + queries), Fastify (route), React + TanStack Query (frontend), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-03-28-runtime-config-visibility-design.md`

---

### Task 1: Shared Types + Redaction Utility

**Files:**
- Create: `packages/shared/src/types/dispatch-config.ts`
- Modify: `packages/shared/src/types/index.ts`
- Create: `packages/shared/src/redact-mcp.ts`
- Create: `packages/shared/src/redact-mcp.test.ts`

- [ ] **Step 1: Create the DispatchConfigSnapshot type**

Create `packages/shared/src/types/dispatch-config.ts`:

```typescript
import type { AgentConfig } from './agent.js';

/** Snapshot of what task-worker.ts dispatched to the worker. Read-only audit record. */
export type DispatchConfigSnapshot = {
  model: string | null;
  permissionMode: AgentConfig['permissionMode'] | null;
  allowedTools: string[] | null;
  mcpServers: Record<string, McpServerConfigRedacted> | null;
  systemPrompt: string | null;
  defaultPrompt: string | null;
  instructionsStrategy: AgentConfig['instructionsStrategy'] | null;
  mcpServerCount: number;
  accountProvider: string | null;
};

/** MCP server config with sensitive values redacted. */
export type McpServerConfigRedacted = {
  command: string;
  args?: string[];
  envKeys?: string[];
};
```

- [ ] **Step 2: Re-export from types/index.ts**

Add to `packages/shared/src/types/index.ts` after the existing agent-run exports:

```typescript
export type {
  DispatchConfigSnapshot,
  McpServerConfigRedacted,
} from './dispatch-config.js';
```

- [ ] **Step 3: Write failing tests for redactMcpServers**

Create `packages/shared/src/redact-mcp.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { redactMcpServers } from './redact-mcp.js';

describe('redactMcpServers', () => {
  it('extracts basename from command paths', () => {
    const result = redactMcpServers({
      slack: {
        command: '/Users/hahaschool/.codex/vendor_imports/slack-mcp-server/bin/slack-mcp-server',
        args: ['--transport', 'stdio'],
      },
    });
    expect(result.slack.command).toBe('slack-mcp-server');
  });

  it('stores only env key names, never values', () => {
    const result = redactMcpServers({
      slack: {
        command: 'slack-mcp',
        env: {
          SLACK_MCP_XOXP_TOKEN: 'xoxp-secret-value-here',
          SLACK_MCP_XOXB_TOKEN: 'xoxb-another-secret',
        },
      },
    });
    expect(result.slack.envKeys).toEqual(['SLACK_MCP_XOXP_TOKEN', 'SLACK_MCP_XOXB_TOKEN']);
    expect(result.slack).not.toHaveProperty('env');
  });

  it('redacts args that look like tokens (sk- prefix)', () => {
    const result = redactMcpServers({
      test: { command: 'node', args: ['--auth', 'sk-ant-secret-key-here'] },
    });
    expect(result.test.args).toEqual(['--auth', '[REDACTED]']);
  });

  it('redacts value after --token flag', () => {
    const result = redactMcpServers({
      test: { command: 'npx', args: ['server', '--token', 'my-secret-token'] },
    });
    expect(result.test.args).toEqual(['server', '--token', '[REDACTED]']);
  });

  it('redacts --key=value inline format', () => {
    const result = redactMcpServers({
      test: { command: 'npx', args: ['--api-key=sk-proj-abc123'] },
    });
    expect(result.test.args).toEqual(['--api-key=[REDACTED]']);
  });

  it('redacts KEY=value inline env format in args', () => {
    const result = redactMcpServers({
      test: { command: 'npx', args: ['API_KEY=secret123'] },
    });
    expect(result.test.args).toEqual(['API_KEY=[REDACTED]']);
  });

  it('preserves normal args', () => {
    const result = redactMcpServers({
      test: { command: 'uv', args: ['run', '--with', 'mcp-clickhouse', '--python', '3.10'] },
    });
    expect(result.test.args).toEqual(['run', '--with', 'mcp-clickhouse', '--python', '3.10']);
  });

  it('handles servers with no args or env', () => {
    const result = redactMcpServers({
      simple: { command: 'node' },
    });
    expect(result.simple).toEqual({ command: 'node', args: undefined, envKeys: undefined });
  });

  it('processes multiple servers', () => {
    const result = redactMcpServers({
      a: { command: '/usr/bin/node', args: ['server.js'] },
      b: { command: 'python', args: ['-m', 'server'], env: { KEY: 'val' } },
    });
    expect(Object.keys(result)).toEqual(['a', 'b']);
    expect(result.a.command).toBe('node');
    expect(result.b.envKeys).toEqual(['KEY']);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd packages/shared && pnpm vitest run src/redact-mcp.test.ts`
Expected: FAIL — module `./redact-mcp.js` not found

- [ ] **Step 5: Implement redactMcpServers**

Create `packages/shared/src/redact-mcp.ts`:

```typescript
import type { McpServerConfigRedacted } from './types/dispatch-config.js';

const SECRET_ARG_PATTERN = /^--?(token|key|secret|password|credential|api[_-]?key)/i;
const LOOKS_LIKE_TOKEN = /^(sk-|xox[bpas]-|ghp_|gho_|Bearer )/;
const INLINE_SECRET = /^[A-Z_]+=.+/;

function basename(cmd: string): string {
  return cmd.split('/').pop() ?? cmd;
}

function redactArg(arg: string, prevArg: string | undefined): string {
  if (prevArg && SECRET_ARG_PATTERN.test(prevArg)) return '[REDACTED]';
  if (LOOKS_LIKE_TOKEN.test(arg)) return '[REDACTED]';
  if (SECRET_ARG_PATTERN.test(arg) && arg.includes('=')) {
    return `${arg.split('=')[0]}=[REDACTED]`;
  }
  if (INLINE_SECRET.test(arg)) {
    return `${arg.split('=')[0]}=[REDACTED]`;
  }
  return arg;
}

export function redactMcpServers(
  servers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>,
): Record<string, McpServerConfigRedacted> {
  const result: Record<string, McpServerConfigRedacted> = {};
  for (const [name, config] of Object.entries(servers)) {
    result[name] = {
      command: basename(config.command),
      args: config.args?.map((arg, i, arr) => redactArg(arg, i > 0 ? arr[i - 1] : undefined)),
      envKeys: config.env ? Object.keys(config.env) : undefined,
    };
  }
  return result;
}
```

- [ ] **Step 6: Re-export from shared index**

Add to `packages/shared/src/index.ts`:

```typescript
export { redactMcpServers } from './redact-mcp.js';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/shared && pnpm vitest run src/redact-mcp.test.ts`
Expected: all 9 tests PASS

- [ ] **Step 8: Build shared package**

Run: `pnpm --filter @agentctl/shared build`
Expected: clean build, no errors

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/types/dispatch-config.ts packages/shared/src/types/index.ts packages/shared/src/redact-mcp.ts packages/shared/src/redact-mcp.test.ts packages/shared/src/index.ts
git commit -m "feat: add DispatchConfigSnapshot type and redactMcpServers utility"
```

---

### Task 2: Database Schema + Migration

**Files:**
- Modify: `packages/control-plane/src/db/schema.ts:57-88`
- Create: `packages/control-plane/src/db/migrations/0004_dispatch_config.sql`

- [ ] **Step 1: Add dispatchConfig column to schema**

In `packages/control-plane/src/db/schema.ts`, add inside the `agentRuns` table definition (after `retryIndex` at line ~82):

```typescript
    /** Dispatch config snapshot captured at dispatch time. Excluded from list queries. */
    dispatchConfig: jsonb('dispatch_config').$type<DispatchConfigSnapshot | null>(),
```

Add the import at top of the file:

```typescript
import type { DispatchConfigSnapshot } from '@agentctl/shared';
```

- [ ] **Step 2: Create migration file**

Create `packages/control-plane/src/db/migrations/0004_dispatch_config.sql`:

```sql
-- Add dispatch_config column to agent_runs for runtime config audit trail.
-- Nullable JSONB, no index (only read by single-row PK lookup).
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS dispatch_config JSONB DEFAULT NULL;
```

- [ ] **Step 3: Build control-plane to verify schema compiles**

Run: `pnpm --filter @agentctl/control-plane build`
Expected: clean build

- [ ] **Step 4: Run migration against dev database**

Run: `psql "postgresql://hahaschool@127.0.0.1:5433/agentctl_dev1" -f packages/control-plane/src/db/migrations/0004_dispatch_config.sql`
Expected: `ALTER TABLE`

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/db/schema.ts packages/control-plane/src/db/migrations/0004_dispatch_config.sql
git commit -m "feat: add dispatch_config JSONB column to agent_runs"
```

---

### Task 3: DbRegistry Methods

**Files:**
- Modify: `packages/control-plane/src/registry/db-registry.ts:518-537,951-971`

- [ ] **Step 1: Add updateRunDispatchConfig method**

In `packages/control-plane/src/registry/db-registry.ts`, add after the `getRun` method (~line 526):

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

Add the import at top:

```typescript
import type { DispatchConfigSnapshot } from '@agentctl/shared';
```

- [ ] **Step 2: Add a helper for run columns without dispatchConfig**

Add a private helper that returns all run columns except `dispatchConfig`, and use it in both `getRun()` and `getRecentRuns()`:

```typescript
  /** All agent_runs columns except the heavy dispatchConfig JSONB blob. */
  private get runColumnsSlim() {
    return {
      id: agentRuns.id,
      agentId: agentRuns.agentId,
      trigger: agentRuns.trigger,
      status: agentRuns.status,
      phase: agentRuns.phase,
      startedAt: agentRuns.startedAt,
      finishedAt: agentRuns.finishedAt,
      costUsd: agentRuns.costUsd,
      tokensIn: agentRuns.tokensIn,
      tokensOut: agentRuns.tokensOut,
      model: agentRuns.model,
      provider: agentRuns.provider,
      sessionId: agentRuns.sessionId,
      errorMessage: agentRuns.errorMessage,
      resultSummary: agentRuns.resultSummary,
      loopIteration: agentRuns.loopIteration,
      parentRunId: agentRuns.parentRunId,
      retryOf: agentRuns.retryOf,
      retryIndex: agentRuns.retryIndex,
    } as const;
  }
```

- [ ] **Step 3: Update getRun() to use slim columns**

Replace `getRun` (~line 518-526):

```typescript
  async getRun(runId: string): Promise<AgentRun | undefined> {
    const rows = await this.db
      .select(this.runColumnsSlim)
      .from(agentRuns)
      .where(eq(agentRuns.id, runId));

    if (rows.length === 0) {
      return undefined;
    }

    return this.toRun(rows[0] as typeof agentRuns.$inferSelect);
  }
```

- [ ] **Step 4: Update getRecentRuns() to use slim columns**

Replace `getRecentRuns` (~line 528-537):

```typescript
  async getRecentRuns(agentId: string, limit = 20): Promise<AgentRun[]> {
    const rows = await this.db
      .select(this.runColumnsSlim)
      .from(agentRuns)
      .where(eq(agentRuns.agentId, agentId))
      .orderBy(desc(agentRuns.startedAt))
      .limit(limit);

    return rows.map((row) => this.toRun(row as typeof agentRuns.$inferSelect));
  }
```

- [ ] **Step 5: Add getLatestRunForSession and countRunsForSession**

Add two new methods for the dispatch-config API endpoint:

```typescript
  async getLatestRunForSession(sessionId: string): Promise<AgentRun | undefined> {
    const rows = await this.db
      .select(this.runColumnsSlim)
      .from(agentRuns)
      .where(eq(agentRuns.sessionId, sessionId))
      .orderBy(desc(agentRuns.startedAt))
      .limit(1);

    if (rows.length === 0) return undefined;
    return this.toRun(rows[0] as typeof agentRuns.$inferSelect);
  }

  async countRunsForSession(sessionId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(eq(agentRuns.sessionId, sessionId));
    return row?.count ?? 0;
  }
```

Add `sql` import if not already present:

```typescript
import { sql } from 'drizzle-orm';
```

- [ ] **Step 3: Build control-plane**

Run: `pnpm --filter @agentctl/control-plane build`
Expected: clean build

- [ ] **Step 4: Run existing tests to verify no regression**

Run: `cd packages/control-plane && pnpm vitest run --reporter=verbose 2>&1 | tail -20`
Expected: all existing tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/control-plane/src/registry/db-registry.ts
git commit -m "feat: add dispatch config registry methods, exclude from list queries"
```

---

### Task 4: Persist Config in Task Worker

**Files:**
- Modify: `packages/control-plane/src/scheduler/task-worker.ts:504`

- [ ] **Step 1: Add import**

At top of `packages/control-plane/src/scheduler/task-worker.ts`, add:

```typescript
import { redactMcpServers } from '@agentctl/shared';
import type { DispatchConfigSnapshot } from '@agentctl/shared';
```

- [ ] **Step 2: Persist config after payload assembly**

After line 504 (after `const unsignedPayload = { ... };`) and before `const payload: DispatchPayload = {` (line 506), insert:

```typescript
        // Persist dispatch config snapshot for audit trail
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

        try {
          await dbRegistry.updateRunDispatchConfig(runId, dispatchConfig);
        } catch (configErr) {
          jobLogger.warn(
            { err: configErr instanceof Error ? configErr.message : String(configErr) },
            'Failed to persist dispatch config (non-fatal)',
          );
        }
```

- [ ] **Step 3: Build control-plane**

Run: `pnpm --filter @agentctl/control-plane build`
Expected: clean build

- [ ] **Step 4: Commit**

```bash
git add packages/control-plane/src/scheduler/task-worker.ts
git commit -m "feat: persist dispatch config snapshot to agent_runs at dispatch time"
```

---

### Task 5: API Endpoint — GET /sessions/:id/dispatch-config

**Files:**
- Modify: `packages/control-plane/src/api/routes/sessions.ts`

- [ ] **Step 1: Add the dispatch-config endpoint**

In `packages/control-plane/src/api/routes/sessions.ts`, add the following route inside the plugin function (near the other session GET routes). Note: `db` and `dbRegistry` are destructured from `opts` at line 65.

```typescript
  app.get<{ Params: { sessionId: string } }>(
    '/:sessionId/dispatch-config',
    {
      schema: {
        tags: ['sessions'],
        summary: 'Get dispatch config for a session',
        description:
          'Returns the dispatch config from the latest agent run linked to this session.',
      },
    },
    async (request, reply) => {
      const { sessionId } = request.params;

      // Verify session exists (query rc_sessions directly)
      const [session] = await db
        .select({ id: rcSessions.id })
        .from(rcSessions)
        .where(eq(rcSessions.id, sessionId))
        .limit(1);

      if (!session) {
        return reply.code(404).send({
          error: 'SESSION_NOT_FOUND',
          message: `Session '${sessionId}' does not exist`,
        });
      }

      // Query agent_runs by sessionId directly (not via agentId)
      const runCount = await dbRegistry.countRunsForSession(sessionId);

      if (runCount === 0) {
        return { runId: null, runCount: 0, config: null };
      }

      const latestRun = await dbRegistry.getLatestRunForSession(sessionId);
      const config = latestRun
        ? await dbRegistry.getRunDispatchConfig(latestRun.id)
        : null;

      return {
        runId: latestRun?.id ?? null,
        runCount,
        config,
      };
    },
  );
```

Ensure `rcSessions` and `eq` are imported at the top of the file (they should already be — verify).

- [ ] **Step 2: Build control-plane**

Run: `pnpm --filter @agentctl/control-plane build`
Expected: clean build

- [ ] **Step 3: Test the endpoint manually**

Run the migration against beta DB first:
```bash
psql "postgresql://hahaschool@127.0.0.1:5433/agentctl" -f packages/control-plane/src/db/migrations/0004_dispatch_config.sql
```

Then restart CP and test:
```bash
pm2 restart agentctl-cp-beta
sleep 3
curl -s http://localhost:8080/api/sessions/4af949af-1756-4076-9487-c2fa5f177888/dispatch-config | python3 -m json.tool
```

Expected: `{ "runId": "56bfdedd-...", "runCount": 1, "config": null }` (null because config wasn't captured for pre-feature runs)

- [ ] **Step 4: Commit**

```bash
git add packages/control-plane/src/api/routes/sessions.ts
git commit -m "feat: add GET /sessions/:id/dispatch-config endpoint"
```

---

### Task 5b: Backend Tests for Registry + Route

**Files:**
- Modify: `packages/control-plane/src/registry/db-registry.test.ts` (or nearest test file)
- Modify: `packages/control-plane/src/api/routes/sessions.test.ts` (or nearest test file)

- [ ] **Step 1: Add registry tests**

Add to the existing db-registry test file. Use the existing `createMockDbRegistry()` helper:

```typescript
describe('dispatch config', () => {
  it('updateRunDispatchConfig persists and getRunDispatchConfig retrieves', async () => {
    // Create a run first, then update its dispatch config
    const config: DispatchConfigSnapshot = {
      model: 'claude-opus-4-6',
      permissionMode: 'bypassPermissions',
      allowedTools: null,
      mcpServers: { slack: { command: 'slack-mcp', args: ['--stdio'], envKeys: ['TOKEN'] } },
      systemPrompt: null,
      defaultPrompt: 'test prompt',
      instructionsStrategy: null,
      mcpServerCount: 1,
      accountProvider: 'claude_team',
    };
    await dbRegistry.updateRunDispatchConfig(testRunId, config);
    const result = await dbRegistry.getRunDispatchConfig(testRunId);
    expect(result).toEqual(config);
  });

  it('getRunDispatchConfig returns null for runs without config', async () => {
    const result = await dbRegistry.getRunDispatchConfig(testRunId);
    expect(result).toBeNull();
  });

  it('getLatestRunForSession returns most recent run', async () => {
    const run = await dbRegistry.getLatestRunForSession('test-session-id');
    // Depends on test data setup — verify it returns the run or undefined
    expect(run === undefined || typeof run.id === 'string').toBe(true);
  });

  it('countRunsForSession returns count', async () => {
    const count = await dbRegistry.countRunsForSession('nonexistent-session');
    expect(count).toBe(0);
  });
});
```

Note: Exact test setup depends on how db-registry tests create/seed data in this repo. Adapt `testRunId` and setup from existing test patterns.

- [ ] **Step 2: Add route test for dispatch-config endpoint**

Add to `packages/control-plane/src/api/routes/sessions.test.ts`:

```typescript
describe('GET /:sessionId/dispatch-config', () => {
  it('returns 404 for nonexistent session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/nonexistent-id/dispatch-config',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns runCount=0 when session has no runs', async () => {
    // Create a session without any runs
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionWithNoRuns}/dispatch-config`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runCount).toBe(0);
    expect(body.config).toBeNull();
  });
});
```

- [ ] **Step 3: Run backend tests**

Run: `cd packages/control-plane && pnpm vitest run --reporter=verbose 2>&1 | tail -20`
Expected: all tests pass including new ones

- [ ] **Step 4: Commit**

```bash
git add packages/control-plane/src/registry/db-registry.test.ts packages/control-plane/src/api/routes/sessions.test.ts
git commit -m "test: add backend tests for dispatch config registry and route"
```

---

### Task 6: Frontend — API Client + Query Hook

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/queries.ts`

- [ ] **Step 1: Add API method**

In `packages/web/src/lib/api.ts`, add in the return object of `createApiClient()`:

```typescript
  getSessionDispatchConfig: (sessionId: string) =>
    request<{
      runId: string | null;
      runCount: number;
      config: DispatchConfigSnapshot | null;
    }>(`/api/sessions/${sessionId}/dispatch-config`),
```

Add the type import at the top:

```typescript
import type { DispatchConfigSnapshot } from '@agentctl/shared';
```

- [ ] **Step 2: Add query hook**

In `packages/web/src/lib/queries.ts`, add the query key and hook:

In the `queryKeys` object, add:

```typescript
  sessionDispatchConfig: (id: string) => ['sessions', id, 'dispatch-config'] as const,
```

Then add the query function:

```typescript
export function sessionDispatchConfigQuery(sessionId: string) {
  return queryOptions({
    queryKey: queryKeys.sessionDispatchConfig(sessionId),
    queryFn: () => api.getSessionDispatchConfig(sessionId),
    enabled: !!sessionId,
    staleTime: 60_000, // Config doesn't change after dispatch
  });
}
```

- [ ] **Step 3: Build web**

Run: `pnpm --filter @agentctl/web build 2>&1 | tail -5`
Expected: clean build

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/queries.ts
git commit -m "feat: add session dispatch config API client and query hook"
```

---

### Task 7: Frontend — SessionConfigTab Component

**Files:**
- Create: `packages/web/src/components/SessionConfigTab.tsx`
- Create: `packages/web/src/components/SessionConfigTab.test.tsx`

- [ ] **Step 1: Create SessionConfigTab component**

Create `packages/web/src/components/SessionConfigTab.tsx`:

```tsx
'use client';

import type { DispatchConfigSnapshot, McpServerConfigRedacted } from '@agentctl/shared';
import { Info, Server, Settings, Shield, Terminal } from 'lucide-react';
import type React from 'react';

import { useQuery } from '@tanstack/react-query';

import { sessionDispatchConfigQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

type SessionConfigTabProps = {
  sessionId: string;
};

export function SessionConfigTab({ sessionId }: SessionConfigTabProps): React.JSX.Element {
  const { data, isLoading, error } = useQuery(sessionDispatchConfigQuery(sessionId));

  if (isLoading) {
    return <ConfigSkeleton />;
  }

  if (error) {
    return (
      <div className="text-sm text-destructive p-4">
        Failed to load dispatch config: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }

  if (!data || data.runCount === 0) {
    return (
      <EmptyState message="No dispatch record — this session has no associated agent run." />
    );
  }

  if (!data.config) {
    return (
      <EmptyState message="Config not captured for this run (pre-feature data)." />
    );
  }

  return (
    <div className="space-y-5">
      {data.runCount > 1 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-accent/10 rounded px-3 py-2">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>Showing config from latest dispatch (1 of {data.runCount} runs).</span>
        </div>
      )}
      <GeneralSection config={data.config} />
      <McpServersSection servers={data.config.mcpServers} count={data.config.mcpServerCount} />
      <ToolRestrictionsSection allowedTools={data.config.allowedTools} />
      <PromptsSection
        defaultPrompt={data.config.defaultPrompt}
        systemPrompt={data.config.systemPrompt}
      />
    </div>
  );
}

function GeneralSection({ config }: { config: DispatchConfigSnapshot }): React.JSX.Element {
  return (
    <ConfigSection title="General" icon={Settings}>
      <ConfigRow label="Model" value={config.model ?? '(not set)'} />
      <ConfigRow label="Permission" value={config.permissionMode ?? '(not set)'} />
      <ConfigRow label="Provider" value={config.accountProvider ?? '(not set)'} />
      <ConfigRow label="Strategy" value={config.instructionsStrategy ?? '(not set)'} />
    </ConfigSection>
  );
}

function McpServersSection({
  servers,
  count,
}: {
  servers: Record<string, McpServerConfigRedacted> | null;
  count: number;
}): React.JSX.Element {
  if (!servers || count === 0) {
    return (
      <ConfigSection title="MCP Servers (0)" icon={Server}>
        <p className="text-xs text-muted-foreground">No MCP servers configured.</p>
      </ConfigSection>
    );
  }

  return (
    <ConfigSection title={`MCP Servers (${count})`} icon={Server}>
      <div className="space-y-3">
        {Object.entries(servers).map(([name, srv]) => (
          <div key={name} className="text-xs">
            <div className="font-medium text-foreground">{name}</div>
            <div className="font-mono text-muted-foreground mt-0.5">
              {srv.command} {srv.args?.join(' ')}
            </div>
            {srv.envKeys && srv.envKeys.length > 0 && (
              <div className="text-muted-foreground mt-0.5">
                env: {srv.envKeys.join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </ConfigSection>
  );
}

function ToolRestrictionsSection({
  allowedTools,
}: {
  allowedTools: string[] | null;
}): React.JSX.Element {
  return (
    <ConfigSection title="Tool Restrictions" icon={Shield}>
      <ConfigRow
        label="Allowed"
        value={
          allowedTools && allowedTools.length > 0
            ? allowedTools.join(', ')
            : '(all — no restrictions)'
        }
      />
    </ConfigSection>
  );
}

function PromptsSection({
  defaultPrompt,
  systemPrompt,
}: {
  defaultPrompt: string | null;
  systemPrompt: string | null;
}): React.JSX.Element {
  return (
    <ConfigSection title="Prompts" icon={Terminal}>
      <ConfigRow label="Default" value={defaultPrompt ?? '(not set)'} />
      <ConfigRow label="System" value={systemPrompt ?? '(not set)'} />
    </ConfigSection>
  );
}

// --- Shared primitives ---

function ConfigSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-accent/10 border-b border-border/50">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="px-3 py-2.5 space-y-1.5">{children}</div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  const isUnset = value === '(not set)' || value === '(all — no restrictions)';
  return (
    <div className="flex items-baseline gap-3 text-xs">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span className={cn('font-mono', isUnset ? 'text-muted-foreground/60' : 'text-foreground')}>
        {value}
      </span>
    </div>
  );
}

function ConfigSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="border border-border/30 rounded-lg overflow-hidden">
          <div className="h-8 bg-accent/10" />
          <div className="p-3 space-y-2">
            <div className="h-3 bg-muted/30 rounded w-2/3" />
            <div className="h-3 bg-muted/30 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Settings className="w-8 h-8 text-muted-foreground/40 mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
```

- [ ] **Step 2: Write component tests**

Create `packages/web/src/components/SessionConfigTab.test.tsx`. Uses `vi.mock('@/lib/queries')` pattern consistent with repo conventions (no msw, no jest-dom):

```tsx
import type React from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SessionConfigTab } from './SessionConfigTab';

// Mock the query module — return a queryOptions-shaped object whose queryFn we control
const mockQueryFn = vi.fn();
vi.mock('@/lib/queries', () => ({
  sessionDispatchConfigQuery: (_id: string) => ({
    queryKey: ['sessions', _id, 'dispatch-config'],
    queryFn: () => mockQueryFn(),
    enabled: true,
    staleTime: 60_000,
  }),
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('SessionConfigTab', () => {
  it('shows empty state when no runs exist', async () => {
    mockQueryFn.mockResolvedValue({ runId: null, runCount: 0, config: null });
    renderWithClient(<SessionConfigTab sessionId="test-session" />);
    await waitFor(() => {
      expect(screen.getByText(/no associated agent run/i)).toBeDefined();
    });
  });

  it('shows pre-feature message when config is null but run exists', async () => {
    mockQueryFn.mockResolvedValue({ runId: 'run-1', runCount: 1, config: null });
    renderWithClient(<SessionConfigTab sessionId="test-session" />);
    await waitFor(() => {
      expect(screen.getByText(/pre-feature data/i)).toBeDefined();
    });
  });

  it('renders config sections when data is present', async () => {
    mockQueryFn.mockResolvedValue({
      runId: 'run-1',
      runCount: 1,
      config: {
        model: 'claude-opus-4-6',
        permissionMode: 'bypassPermissions',
        allowedTools: null,
        mcpServers: {
          slack: { command: 'slack-mcp-server', args: ['--transport', 'stdio'], envKeys: ['SLACK_TOKEN'] },
        },
        systemPrompt: null,
        defaultPrompt: '开始处理工单',
        instructionsStrategy: null,
        mcpServerCount: 1,
        accountProvider: 'claude_team',
      },
    });
    renderWithClient(<SessionConfigTab sessionId="test-session" />);
    await waitFor(() => {
      expect(screen.getByText('claude-opus-4-6')).toBeDefined();
      expect(screen.getByText('bypassPermissions')).toBeDefined();
      expect(screen.getByText('slack')).toBeDefined();
      expect(screen.getByText(/SLACK_TOKEN/)).toBeDefined();
      expect(screen.getByText('开始处理工单')).toBeDefined();
    });
  });

  it('shows multi-run indicator when runCount > 1', async () => {
    mockQueryFn.mockResolvedValue({
      runId: 'run-2',
      runCount: 3,
      config: {
        model: 'sonnet',
        permissionMode: null,
        allowedTools: null,
        mcpServers: null,
        systemPrompt: null,
        defaultPrompt: null,
        instructionsStrategy: null,
        mcpServerCount: 0,
        accountProvider: null,
      },
    });
    renderWithClient(<SessionConfigTab sessionId="test-session" />);
    await waitFor(() => {
      expect(screen.getByText(/1 of 3 runs/)).toBeDefined();
    });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd packages/web && pnpm vitest run src/components/SessionConfigTab.test.tsx`
Expected: all 4 tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/SessionConfigTab.tsx packages/web/src/components/SessionConfigTab.test.tsx
git commit -m "feat: add SessionConfigTab component with empty/loaded/multi-run states"
```

---

### Task 8: Integrate Config Tab into SessionDetailView

**Files:**
- Modify: `packages/web/src/views/SessionDetailView.tsx:326-342`

- [ ] **Step 1: Add Config tab to the tab bar**

In `packages/web/src/views/SessionDetailView.tsx`, change the tab array at ~line 327 from:

```tsx
{(['session', 'memory'] as const).map((tab) => (
```

to:

```tsx
{(['session', 'memory', 'config'] as const).map((tab) => (
```

Update the label mapping at ~line 339 from:

```tsx
{tab === 'session' ? 'Session' : 'Memory'}
```

to:

```tsx
{tab === 'session' ? 'Session' : tab === 'memory' ? 'Memory' : 'Config'}
```

- [ ] **Step 2: Update primaryTab state type**

Find the `useState` for `primaryTab` and update the type to include 'config':

```tsx
const [primaryTab, setPrimaryTab] = useState<'session' | 'memory' | 'config'>('session');
```

- [ ] **Step 3: Add Config tab content**

After the memory tab content block (~line 348), add:

```tsx
{primaryTab === 'config' && (
  <div className="flex-1 overflow-y-auto px-5 py-4">
    <SessionConfigTab sessionId={sessionId} />
  </div>
)}
```

Add the import at top:

```typescript
import { SessionConfigTab } from '@/components/SessionConfigTab';
```

- [ ] **Step 4: Build web**

Run: `pnpm --filter @agentctl/web build 2>&1 | tail -5`
Expected: clean build

- [ ] **Step 5: Deploy and verify**

```bash
pm2 restart agentctl-web-beta
```

Open `http://localhost:5173/sessions/4af949af-1756-4076-9487-c2fa5f177888`, click "Config" tab.
Expected: Shows "Config not captured for this run (pre-feature data)" since the run predates the feature.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/views/SessionDetailView.tsx
git commit -m "feat: add Config tab to session detail page"
```

---

### Task 9: End-to-End Verification

**Files:** None (verification only)

- [ ] **Step 1: Run migration on beta DB**

```bash
psql "postgresql://hahaschool@127.0.0.1:5433/agentctl" -f packages/control-plane/src/db/migrations/0004_dispatch_config.sql
```

- [ ] **Step 2: Rebuild and restart all beta services**

```bash
pnpm build
pm2 restart agentctl-cp-beta agentctl-worker-beta agentctl-web-beta
```

- [ ] **Step 3: Trigger a new agent run**

From the Agents page, start the "工单处理流程" agent. Wait for it to begin running.

- [ ] **Step 4: Verify config was persisted**

```bash
psql "postgresql://hahaschool@127.0.0.1:5433/agentctl" -c "SELECT id, dispatch_config IS NOT NULL as has_config FROM agent_runs ORDER BY started_at DESC LIMIT 3;"
```

Expected: The newest run should show `has_config = true`.

- [ ] **Step 5: Verify API endpoint**

```bash
curl -s http://localhost:8080/api/sessions/<new-session-id>/dispatch-config | python3 -m json.tool
```

Expected: JSON with `runId`, `runCount: 1`, and `config` containing model, permissionMode, mcpServers with redacted values.

- [ ] **Step 6: Verify UI**

Open the new session in the browser. Click the "Config" tab.
Expected: Shows General section (model, permission, provider), MCP Servers section with server names and redacted info, Tool Restrictions, and Prompts.
