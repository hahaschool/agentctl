# Permission Approval System

**Date**: 2026-03-16
**Status**: Draft
**Scope**: End-to-end permission approval pipeline — CLI permission requests surface in 3 UI locations with approve/deny actions

## Problem

When an agent's permission mode is not `bypassPermissions`, Claude CLI outputs `permission_request` events for dangerous operations (Bash commands, file writes, network access). AgentCTL has no mechanism for users to respond to these requests. The agent hangs waiting for approval until it times out and is killed.

## Goals

1. Capture CLI `permission_request` events and surface them to users in realtime
2. Three approval surfaces: session inline, notification bell, dedicated `/approvals` page
3. User can approve/deny from any surface; decision propagates back to CLI
4. Auto-deny on timeout (configurable, default 5 minutes)
5. Full approval history for audit

## Non-Goals

- Automated approval policies (auto-approve certain tools) — future enhancement
- Approval delegation to other users — single-user MVP
- Mobile push notifications — use existing infrastructure later

## Data Flow

```
CLI stdout ──→ Worker ──→ CP ──→ Frontend
   permission_request    POST /api/approvals    WebSocket broadcast
                                                      │
                                          ┌───────────┼───────────┐
                                          │           │           │
                                    Session View   Notif Bell  /approvals
                                    (inline btns)  (dropdown)  (full page)
                                          │           │           │
                                          └───────────┼───────────┘
                                                      │
Frontend decision ──→ WebSocket ──→ CP ──→ Worker ──→ CLI stdin
   PATCH /api/approvals/:id     POST /api/agents/:id/approval-response
```

## Data Model

### `pending_approvals` table

```sql
CREATE TABLE pending_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  session_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  command TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | denied | expired
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,  -- 'user' | 'timeout' | 'agent-killed'
  timeout_seconds INTEGER NOT NULL DEFAULT 300,
  CONSTRAINT valid_status CHECK (status IN ('pending', 'approved', 'denied', 'expired'))
);

CREATE INDEX idx_pending_approvals_status ON pending_approvals(status);
CREATE INDEX idx_pending_approvals_agent ON pending_approvals(agent_id);
```

### Shared types

```typescript
type PendingApproval = {
  id: string;
  agentId: string;
  sessionId: string;
  machineId: string;
  toolName: string;
  command?: string;
  description?: string;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  timeoutSeconds: number;
};

type ApprovalDecision = {
  approvalId: string;
  decision: 'approved' | 'denied';
};
```

## Backend

### Worker — Capture permission requests

In `packages/agent-worker/src/runtime/cli-session-manager.ts`, the stream parser already has a `permission_request` case (line ~890). Extend it to:

1. Create a `PendingApproval` object from the event data
2. POST to CP: `POST /api/approvals` with the approval data
3. Store a promise resolver keyed by approval ID
4. When CP calls back with decision (`POST /api/agents/:id/approval-response`), resolve the promise
5. Write the decision to CLI stdin as a `permission_response` JSON event

### Worker — Receive decision

New route: `POST /api/agents/:agentId/approval-response`
- Body: `{ approvalId, decision: 'approved' | 'denied' }`
- Finds the agent instance, resolves the pending promise
- Writes to CLI stdin

### CP — Approval CRUD + broadcast

New route plugin: `packages/control-plane/src/api/routes/approvals.ts`

- `POST /api/approvals` — Worker creates approval request. CP stores in DB, broadcasts via WebSocket to all connected clients.
- `GET /api/approvals?status=pending&agentId=...` — List approvals with optional filters.
- `PATCH /api/approvals/:id` — Frontend resolves (approve/deny). CP updates DB, broadcasts resolution via WebSocket, forwards decision to worker via `POST /api/agents/:agentId/approval-response`.
- Expiry: On each heartbeat cycle (or a dedicated interval), check for expired approvals (requestedAt + timeoutSeconds < now) and auto-deny them.

### WebSocket events

```typescript
// CP → Frontend
{ type: 'approval_request', data: PendingApproval }
{ type: 'approval_resolved', data: PendingApproval }

// Frontend → CP (via existing WS or REST)
PATCH /api/approvals/:id { decision: 'approved' | 'denied' }
```

## Frontend

### Surface 1: Session View (inline)

In the session message stream component, when a message has type `permission_request` (or `tool_result` with content "This command requires approval"):

```tsx
<div className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-3 my-2">
  <div className="flex items-center gap-2 mb-2">
    <ShieldAlert className="w-4 h-4 text-yellow-500" />
    <span className="text-sm font-medium">Permission Required</span>
    <CountdownBadge seconds={remainingSeconds} />
  </div>
  <pre className="text-xs bg-neutral-900 p-2 rounded font-mono mb-3">
    {command}
  </pre>
  <div className="flex gap-2">
    <Button size="sm" variant="default" onClick={approve}>Approve</Button>
    <Button size="sm" variant="destructive" onClick={deny}>Deny</Button>
  </div>
</div>
```

After resolution, replace buttons with status text: "Approved" (green) / "Denied" (red) / "Expired" (gray).

### Surface 2: Notification Bell

Modify `packages/web/src/components/NotificationBell.tsx`:

- Query `GET /api/approvals?status=pending` on mount + subscribe to WebSocket events
- Badge shows count of pending approvals (red dot with number)
- Dropdown items show: agent name, tool name, command preview, time remaining
- Each item has inline Approve/Deny buttons
- Click on item navigates to `/approvals` or the agent's session

### Surface 3: `/approvals` page

New page: `packages/web/src/app/approvals/page.tsx`

- Add "Approvals" to sidebar nav with pending count badge
- Table columns: Status | Agent | Tool | Command | Requested | Time Left | Actions
- Pending approvals at top, resolved below (collapsible history)
- Batch actions: "Approve All Pending" / "Deny All Pending"
- Filter tabs: All | Pending | Approved | Denied | Expired
- Empty state: "No pending approvals. Agents with bypassPermissions won't generate approval requests."

### Countdown component

Shared `CountdownBadge` component:
- Shows remaining seconds/minutes until auto-deny
- Color transitions: green (>2min) → yellow (>30s) → red (<30s) → gray (expired)
- Updates every second via `useEffect` + `setInterval`

## Error Handling

- **Agent killed while waiting**: Worker detects process exit → POST to CP marking all pending approvals for that session as `expired` with `resolvedBy: 'agent-killed'`
- **User offline**: Approval expires after timeout → auto-deny → worker writes denial to CLI → agent receives denial and can handle gracefully
- **Race condition**: CP uses DB transaction — first `PATCH` wins, subsequent attempts get 409 Conflict with "Already resolved"
- **WebSocket disconnected**: Approvals page polls `GET /api/approvals?status=pending` as fallback (React Query refetchInterval: 5s)
- **Worker unreachable when forwarding decision**: CP retries 3 times with 1s delay, then marks approval as `denied` with `resolvedBy: 'worker-unreachable'`

## Testing

**Backend (Vitest):**
- Worker: parse permission_request → create PendingApproval → POST to CP
- Worker: receive approval-response → write to CLI stdin
- CP: approval CRUD, WebSocket broadcast, expiry logic
- CP: race condition handling (409 on double-resolve)

**Frontend (Vitest):**
- Session inline card: renders with countdown, buttons trigger PATCH
- NotificationBell: shows pending count, dropdown items
- Approvals page: table renders, filters work, batch actions

## Files to Create/Modify

### New
- `packages/shared/src/types/approval.ts` — PendingApproval, ApprovalDecision types
- `packages/control-plane/src/db/schema-approvals.ts` — Drizzle schema
- `packages/control-plane/drizzle/0018_add_pending_approvals.sql` — Migration
- `packages/control-plane/src/api/routes/approvals.ts` — CRUD + broadcast
- `packages/agent-worker/src/api/routes/approval-response.ts` — Decision receiver
- `packages/web/src/app/approvals/page.tsx` — Full approvals page
- `packages/web/src/app/approvals/layout.tsx` — Layout
- `packages/web/src/components/ApprovalCard.tsx` — Shared inline approval card
- `packages/web/src/components/CountdownBadge.tsx` — Countdown timer

### Modified
- `packages/agent-worker/src/runtime/cli-session-manager.ts` — Capture permission_request, write response
- `packages/agent-worker/src/api/server.ts` — Register approval-response route
- `packages/control-plane/src/api/server.ts` — Register approvals routes, WebSocket events
- `packages/web/src/components/NotificationBell.tsx` — Show pending approvals
- `packages/web/src/components/Sidebar.tsx` — Add Approvals nav item with badge
- `packages/web/src/components/SessionMessageList.tsx` — Render inline approval cards
