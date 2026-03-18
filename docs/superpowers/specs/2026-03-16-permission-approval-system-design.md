# Permission Approval System (v2 — post Codex GPT-5.4 review)

**Date**: 2026-03-16 (revised 2026-03-18)
**Status**: Draft v2
**Scope**: End-to-end permission approval pipeline via Agent SDK `canUseTool` hook

## Problem

When an agent's permission mode is not `bypassPermissions`, tool executions require user approval. Currently AgentCTL has no mechanism for users to respond — the agent hangs until timeout.

## Critical Design Decision: Transport

**v1 spec proposed writing to CLI stdin — this is impossible.** The worker spawns Claude with `stdin: 'ignore'` and `-p` mode doesn't read stdin.

**v2 uses Agent SDK `canUseTool` hook** — the SDK provides an async callback called before each tool execution. We implement it to:
1. Check if the tool needs approval (based on permission mode)
2. If yes: create a pending request, notify the user, wait for response
3. Return `{ allowed: true/false }` to the SDK

This is the SDK's intended mechanism for headless permission handling.

## Goals

1. Capture tool approval requests via Agent SDK `canUseTool` hook
2. Surface pending approvals in 2 UI locations (MVP): session inline + notification bell
3. User can approve/deny; decision resolves the `canUseTool` promise
4. Auto-deny on timeout (use Claude's per-request timeout, default 5 min)
5. Full audit trail with user identity

## Non-Goals (MVP)

- Dedicated `/approvals` page (Phase 2)
- Batch approve/deny (Phase 2)
- Mobile push notifications (Phase 2)
- Auto-approve policies (Phase 2)

## Architecture

```
Agent SDK calls canUseTool(toolName, input)
    ↓
Worker canUseTool implementation:
    1. Generate requestId (UUID)
    2. POST /api/permission-requests to CP
    3. Return a Promise that resolves when CP calls back
    ↓
CP stores in DB, broadcasts via WebSocket
    ↓
Frontend receives WS event, shows in:
    - Session message stream (inline approve/deny card)
    - NotificationBell (badge + dropdown item)
    ↓
User clicks Approve/Deny
    ↓
Frontend PATCH /api/permission-requests/:id
    ↓
CP updates DB, calls Worker POST /api/agents/:id/permission-response
    ↓
Worker resolves the canUseTool Promise
    ↓
Agent SDK proceeds (tool runs or is blocked)
```

## Data Model

### `permission_requests` table (NEW — avoids collision with existing `approval_gates`)

```sql
CREATE TABLE permission_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  session_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  request_id TEXT NOT NULL,         -- correlation ID from canUseTool call
  tool_name TEXT NOT NULL,
  tool_input JSONB,                 -- sanitized input (secrets stripped)
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  timeout_at TIMESTAMPTZ NOT NULL,  -- requestedAt + timeout from CLI
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,                 -- user email/id, 'timeout', 'agent-killed'
  decision TEXT,                    -- 'approved' | 'denied' (null when pending)
  CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled'))
);

CREATE INDEX idx_perm_req_status ON permission_requests(status);
CREATE INDEX idx_perm_req_agent ON permission_requests(agent_id);
CREATE INDEX idx_perm_req_session ON permission_requests(session_id);
```

### Shared types (`packages/shared/src/types/permission-request.ts`)

```typescript
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

## Backend

### Worker — `canUseTool` implementation

In `packages/agent-worker/src/runtime/sdk-runner.ts`, when creating the Agent SDK session, pass a `canUseTool` callback:

```typescript
canUseTool: async (toolName, input, { signal }) => {
  // Check if this tool needs approval based on permission mode
  if (permissionMode === 'bypassPermissions') {
    return { allowed: true };
  }

  const requestId = crypto.randomUUID();

  // POST to CP to create permission request
  await fetch(`${controlPlaneUrl}/api/permission-requests`, {
    method: 'POST',
    body: JSON.stringify({
      agentId, sessionId, machineId, requestId, toolName,
      toolInput: sanitizeToolInput(input),
      timeoutSeconds: 300,
    }),
  });

  // Wait for response (resolved by approval-response route)
  const decision = await waitForDecision(requestId, signal);

  return { allowed: decision === 'approved' };
}
```

`waitForDecision` stores a promise resolver in a Map keyed by `requestId`. The worker's `POST /api/agents/:id/permission-response` route resolves it.

### Worker — receive decision

New route: `POST /api/agents/:agentId/permission-response`
- Body: `{ requestId, decision }`
- Resolves the waiting promise for that requestId

### CP — permission request CRUD + broadcast

New route plugin: `packages/control-plane/src/api/routes/permission-requests.ts`

- `POST /api/permission-requests` — Worker creates request. CP stores in DB, broadcasts `permission_request_created` via WebSocket.
- `GET /api/permission-requests?status=pending&agentId=...` — List with optional filters.
- `PATCH /api/permission-requests/:id` — Frontend resolves. CP updates DB, broadcasts `permission_request_resolved`, forwards to worker.
- Expiry check: on interval (30s), find expired requests (`timeout_at < now() AND status = 'pending'`), mark as `expired`, notify worker with denial.

### WebSocket protocol extension

Add two new event types to the existing WS protocol:

```typescript
// CP → Frontend
{ type: 'permission_request_created', data: PermissionRequest }
{ type: 'permission_request_resolved', data: PermissionRequest }
```

## Frontend

### Surface 1: Session View (inline)

When the session SSE stream emits an `approval_needed` event (or when the WS broadcasts `permission_request_created` for the current session):

- Render an inline card in the message stream with:
  - Yellow border, ShieldAlert icon, "Permission Required"
  - Tool name + sanitized input preview (monospace)
  - Countdown showing time until auto-deny
  - Approve (green) + Deny (red) buttons
  - After resolution: status text replaces buttons

### Surface 2: Notification Bell

Extend `NotificationBell.tsx`:

- Subscribe to `permission_request_created` WebSocket events
- Show red badge with pending count
- Dropdown items: agent name, tool, time remaining, inline approve/deny buttons
- Persist pending requests via React Query polling `GET /api/permission-requests?status=pending` (fallback if WS disconnects)

## Error Handling

- **Agent killed**: Worker detects process exit → POST to CP cancelling all pending requests for that session (`status: 'cancelled'`, `resolvedBy: 'agent-killed'`)
- **CLI timeout first**: If Claude's internal timeout fires before ours, `canUseTool` signal aborts → catch abort → mark as `expired`
- **Worker unreachable**: CP retries 3x, then marks as `expired` with `resolvedBy: 'delivery-failed'` (NOT `denied` — preserves audit integrity)
- **WS disconnected**: Frontend falls back to polling `GET /api/permission-requests?status=pending` every 5s
- **Race condition**: DB transaction on PATCH — first write wins, 409 on duplicate

## Security

- `resolvedBy` stores actual user identifier (not generic 'user')
- `toolInput` is sanitized before storage: strip env vars matching `*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`
- Only authenticated users can PATCH (existing auth middleware)
- Broadcast only to clients subscribed to the agent's machine

## Testing

**Backend (Vitest):**
- canUseTool: creates request, waits, resolves on callback
- CP: permission request CRUD, WS broadcast, expiry
- Worker: receives response, resolves promise

**Frontend (Vitest):**
- Session inline card: renders, buttons trigger PATCH, countdown works
- NotificationBell: shows pending count, dropdown actions

## Files

### New
- `packages/shared/src/types/permission-request.ts`
- `packages/control-plane/src/db/schema-permission-requests.ts`
- `packages/control-plane/drizzle/0019_add_permission_requests.sql`
- `packages/control-plane/src/api/routes/permission-requests.ts`
- `packages/agent-worker/src/api/routes/permission-response.ts`
- `packages/web/src/components/PermissionRequestCard.tsx`

### Modified
- `packages/agent-worker/src/runtime/sdk-runner.ts` — add canUseTool callback
- `packages/agent-worker/src/api/server.ts` — register permission-response route
- `packages/control-plane/src/api/server.ts` — register permission-requests routes
- `packages/control-plane/src/api/routes/ws.ts` — add permission_request events
- `packages/web/src/components/NotificationBell.tsx` — show pending approvals
- `packages/web/src/components/SessionContent.tsx` — render inline approval cards
- `packages/web/src/hooks/use-websocket.ts` — handle new event types
