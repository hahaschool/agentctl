# Permission Approval System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to approve/deny agent tool executions in realtime via Agent SDK `canUseTool` hook, with inline session cards and notification bell.

**Architecture:** Worker implements `canUseTool` callback that POSTs to CP, waits for decision via promise. CP stores in DB, broadcasts via WebSocket. Frontend shows approval card in session view + notification bell. User decision flows back: frontend → CP → worker → SDK resumes.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM, PostgreSQL, WebSocket, React, React Query

**Spec:** `docs/superpowers/specs/2026-03-16-permission-approval-system-design.md`

---

## Chunk 1: Shared Types + Database

### Task 1: Add shared PermissionRequest types

**Files:**
- Create: `packages/shared/src/types/permission-request.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Create types**

```typescript
// packages/shared/src/types/permission-request.ts
export type PermissionRequestStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';

export type PermissionRequest = {
  id: string;
  agentId: string;
  sessionId: string;
  machineId: string;
  requestId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  description?: string;
  status: PermissionRequestStatus;
  requestedAt: string;
  timeoutAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  decision?: 'approved' | 'denied';
};

export type PermissionDecision = {
  requestId: string;
  decision: 'approved' | 'denied';
};
```

Export from `packages/shared/src/types/index.ts`.

- [ ] **Step 2: Build shared**

```bash
pnpm --filter @agentctl/shared build
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(shared): add PermissionRequest types"
```

---

### Task 2: Database schema + migration

**Files:**
- Create: `packages/control-plane/src/db/schema-permission-requests.ts`
- Create: `packages/control-plane/drizzle/0019_add_permission_requests.sql`
- Modify: `packages/control-plane/src/db/index.ts`

- [ ] **Step 1: Create Drizzle schema**

```typescript
// packages/control-plane/src/db/schema-permission-requests.ts
import { pgTable, text, timestamp, integer, uuid, jsonb, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const permissionRequests = pgTable('permission_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull(),
  sessionId: text('session_id').notNull(),
  machineId: text('machine_id').notNull(),
  requestId: text('request_id').notNull(),
  toolName: text('tool_name').notNull(),
  toolInput: jsonb('tool_input'),
  description: text('description'),
  status: text('status').notNull().default('pending'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  timeoutAt: timestamp('timeout_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: text('resolved_by'),
  decision: text('decision'),
}, (table) => [
  check('valid_status', sql`${table.status} IN ('pending', 'approved', 'denied', 'expired', 'cancelled')`),
]);
```

- [ ] **Step 2: Create SQL migration**

```sql
-- 0019_add_permission_requests.sql
CREATE TABLE permission_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  session_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_input JSONB,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  timeout_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  decision TEXT,
  CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled'))
);

CREATE INDEX idx_perm_req_status ON permission_requests(status);
CREATE INDEX idx_perm_req_agent ON permission_requests(agent_id);
CREATE INDEX idx_perm_req_session ON permission_requests(session_id);
```

Re-export from `packages/control-plane/src/db/index.ts`.

- [ ] **Step 3: Build + verify**

```bash
pnpm --filter @agentctl/control-plane build
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cp): add permission_requests schema + migration"
```

---

## Chunk 2: CP API Routes

### Task 3: Permission requests CRUD routes

**Files:**
- Create: `packages/control-plane/src/api/routes/permission-requests.ts`
- Modify: `packages/control-plane/src/api/server.ts`

- [ ] **Step 1: Implement routes**

```typescript
// POST /api/permission-requests — Worker creates request
// GET /api/permission-requests?status=pending&agentId=... — List with filters
// PATCH /api/permission-requests/:id — Frontend resolves (approve/deny)
```

POST handler:
1. Validate body (agentId, sessionId, machineId, requestId, toolName, timeoutSeconds)
2. Compute `timeoutAt = now() + timeoutSeconds`
3. Insert into DB
4. Broadcast `permission_request_created` via WebSocket (Task 4)
5. Return the created record

PATCH handler:
1. Validate body (decision: 'approved' | 'denied')
2. Find record, check status is 'pending' (409 if already resolved)
3. Update: status=decision, resolvedAt=now(), resolvedBy=userId
4. Broadcast `permission_request_resolved` via WebSocket
5. Forward decision to worker: POST to `${workerUrl}/api/agents/${agentId}/permission-response` with { requestId, decision }
6. Return updated record

GET handler:
1. Query with optional filters: status, agentId, sessionId
2. Order by requestedAt DESC
3. Return array

Register in server.ts with prefix `/api/permission-requests`.

- [ ] **Step 2: Add expiry check**

In the route plugin setup (or a separate interval), run every 30 seconds:

```typescript
// Find expired: timeout_at < now() AND status = 'pending'
// Update to status='expired', resolvedBy='timeout'
// For each expired: forward denial to worker
```

- [ ] **Step 3: Build**

```bash
pnpm --filter @agentctl/control-plane build
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cp): add permission-requests CRUD + expiry"
```

---

### Task 4: WebSocket protocol extension

**Files:**
- Modify: `packages/control-plane/src/api/routes/ws.ts`

- [ ] **Step 1: Add permission request broadcast**

Add a broadcast function that the permission-requests route can call:

```typescript
// In ws.ts, export a function:
export function broadcastPermissionEvent(
  type: 'permission_request_created' | 'permission_request_resolved',
  data: PermissionRequest,
): void {
  // Send to all connected clients (or filter by machineId/agentId subscription)
  for (const [, sub] of sseSubscriptions) {
    sub.reply.raw.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  }
}
```

Also handle incoming permission decisions via WS (if frontend sends via WS instead of REST):

```typescript
// Add to VALID_INCOMING_TYPES:
'resolve_permission'

// Add case in message handler:
case 'resolve_permission': {
  // Call PATCH /api/permission-requests/:id internally
}
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(cp): WebSocket broadcast for permission request events"
```

---

## Chunk 3: Worker — canUseTool + Response Route

### Task 5: Implement canUseTool in sdk-runner

**Files:**
- Modify: `packages/agent-worker/src/runtime/sdk-runner.ts`

- [ ] **Step 1: Add permission request infrastructure**

Create a module-level Map to hold pending permission promises:

```typescript
const pendingPermissions = new Map<string, {
  resolve: (decision: 'approved' | 'denied') => void;
  timeoutId: NodeJS.Timeout;
}>();
```

Add `canUseTool` to the SDK session options:

```typescript
canUseTool: async (toolName, input, { signal }) => {
  const mode = config.permissionMode ?? 'default';

  // bypassPermissions = always allow
  if (mode === 'bypassPermissions') {
    return { allowed: true };
  }

  // acceptEdits = allow reads, prompt for writes
  // default = prompt for dangerous operations
  // For now, all non-bypass modes create a permission request

  const requestId = crypto.randomUUID();
  const timeoutSeconds = 300;

  // POST to CP
  try {
    await fetch(`${controlPlaneUrl}/api/permission-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId, sessionId, machineId, requestId, toolName,
        toolInput: sanitizeToolInput(input),
        timeoutSeconds,
      }),
    });
  } catch (err) {
    logger.error({ err, toolName }, 'Failed to create permission request');
    return { allowed: false }; // deny on failure to contact CP
  }

  // Wait for response
  return new Promise<{ allowed: boolean }>((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingPermissions.delete(requestId);
      resolve({ allowed: false });
    }, timeoutSeconds * 1000);

    pendingPermissions.set(requestId, {
      resolve: (decision) => {
        clearTimeout(timeoutId);
        pendingPermissions.delete(requestId);
        resolve({ allowed: decision === 'approved' });
      },
      timeoutId,
    });

    // Respect abort signal
    signal?.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      pendingPermissions.delete(requestId);
      resolve({ allowed: false });
    });
  });
}
```

Add `sanitizeToolInput` helper:

```typescript
function sanitizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const sensitive = /key|secret|token|password|credential/i;
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    sanitized[k] = sensitive.test(k) ? '[REDACTED]' : v;
  }
  return sanitized;
}
```

Export `pendingPermissions` for the response route to access.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(worker): implement canUseTool with permission request flow"
```

---

### Task 6: Permission response route on worker

**Files:**
- Create: `packages/agent-worker/src/api/routes/permission-response.ts`
- Modify: `packages/agent-worker/src/api/server.ts`

- [ ] **Step 1: Create route**

```typescript
// POST /api/agents/:agentId/permission-response
// Body: { requestId, decision: 'approved' | 'denied' }

app.post('/:agentId/permission-response', async (request, reply) => {
  const { requestId, decision } = request.body;

  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    return reply.status(404).send({ error: 'No pending permission request found' });
  }

  pending.resolve(decision);
  return reply.send({ ok: true });
});
```

Register in server.ts alongside existing agent routes.

- [ ] **Step 2: Build worker**

```bash
pnpm --filter @agentctl/agent-worker build
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(worker): add permission-response route"
```

---

## Chunk 4: Frontend

### Task 7: Add API + query hooks

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/lib/queries.ts`

- [ ] **Step 1: Add API methods**

```typescript
// api.ts
getPermissionRequests(params?: { status?: string; agentId?: string }): Promise<PermissionRequest[]>,
resolvePermissionRequest(id: string, decision: 'approved' | 'denied'): Promise<PermissionRequest>,
```

- [ ] **Step 2: Add query hooks**

```typescript
// queries.ts
permissionRequests: (status?: string) => ['permission-requests', status] as const,

export function pendingPermissionRequestsQuery() {
  return queryOptions({
    queryKey: queryKeys.permissionRequests('pending'),
    queryFn: () => api.getPermissionRequests({ status: 'pending' }),
    refetchInterval: 5_000, // fallback polling if WS disconnects
  });
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): add permission request API + query hooks"
```

---

### Task 8: PermissionRequestCard component

**Files:**
- Create: `packages/web/src/components/PermissionRequestCard.tsx`

- [ ] **Step 1: Create component**

Inline approval card with:
- Yellow border (`border-yellow-500/30 bg-yellow-500/5`)
- ShieldAlert icon + "Permission Required" header
- Tool name + sanitized input in monospace `<pre>`
- CountdownBadge showing remaining seconds
- Approve (green Button) + Deny (red destructive Button)
- After resolution: status text replaces buttons

Props: `permissionRequest: PermissionRequest`, `onResolve: (id, decision) => void`

CountdownBadge: computed from `timeoutAt - now()`, updates via `useEffect` + `setInterval` every second. Color: green >2min, yellow >30s, red <30s.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): add PermissionRequestCard component"
```

---

### Task 9: Session inline integration

**Files:**
- Modify: `packages/web/src/components/SessionContent.tsx` (or wherever session messages render)
- Modify: `packages/web/src/hooks/use-websocket.ts`

- [ ] **Step 1: Handle WS permission events**

In `use-websocket.ts`, add handler for `permission_request_created` and `permission_request_resolved` events. Store in a local state or context.

- [ ] **Step 2: Render inline card in session**

When the session view receives a `permission_request_created` for the current session, insert a `PermissionRequestCard` in the message stream.

On approve/deny click: call `api.resolvePermissionRequest(id, decision)` + invalidate permission queries.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): inline permission approval in session view"
```

---

### Task 10: NotificationBell integration

**Files:**
- Modify: `packages/web/src/components/NotificationBell.tsx`

- [ ] **Step 1: Show pending approval count**

Query `pendingPermissionRequestsQuery()`. Show red badge with count if > 0.

- [ ] **Step 2: Dropdown items**

Each pending request shows: agent name, tool name, time remaining, inline Approve/Deny buttons.

Click on item navigates to agent detail page.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): notification bell shows pending permission requests"
```

---

### Task 11: Build + verify on dev-1

- [ ] **Step 1: Build all**

```bash
pnpm build
```

- [ ] **Step 2: Run migration on dev-1 DB**

```bash
psql -h 127.0.0.1 -p 5433 -d agentctl_dev1 -f packages/control-plane/drizzle/0019_add_permission_requests.sql
```

- [ ] **Step 3: Restart dev-1**

```bash
pm2 restart agentctl-cp-dev1 agentctl-worker-dev1 agentctl-web-dev1
```

- [ ] **Step 4: Test flow**

1. Create an agent with `permissionMode: 'default'` (not bypassPermissions)
2. Start the agent with a prompt that will trigger Bash usage
3. Observe: permission request appears in session view + notification bell
4. Click Approve → agent continues
5. Click Deny → agent receives denial

- [ ] **Step 5: Push**

```bash
git push -u origin HEAD
```
