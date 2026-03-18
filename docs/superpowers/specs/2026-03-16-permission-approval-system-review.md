# Permission Approval System Review

Date: 2026-03-16
Target: `docs/superpowers/specs/2026-03-16-permission-approval-system-design.md`
Reviewer: Codex

## CRITICAL

1. The reverse leg of the design is not validated.

   The spec assumes the worker can send a `permission_response` back into Claude CLI stdin:
   - `docs/superpowers/specs/2026-03-16-permission-approval-system-design.md`

   But the current worker explicitly spawns `claude -p` with stdin ignored and documents that "`-p` mode doesn't read from stdin":
   - `packages/agent-worker/src/runtime/cli-session-manager.ts:319`

   Local Claude `2.1.76` help only documents `--input-format stream-json` as generic streaming input:
   - `claude --help`
   - `packages/agent-worker/src/runtime/cli-session-manager.ts:595`

   I verified locally that a `type:"user"` message works over `--input-format stream-json`, but I found no documented support for a `permission_response` control envelope. Anthropic docs also describe stream-json input as limited to text-only user messages:
   - https://docs.anthropic.com/en/docs/claude-code/sdk#input-formats

   As written, the core approve/deny return path is likely impossible.

2. The design does not close the auth hole on a dangerous control surface.

   It proposes `POST /api/approvals` and `PATCH /api/approvals/:id` for creating/resolving permission requests:
   - `docs/superpowers/specs/2026-03-16-permission-approval-system-design.md:114`

   But the control-plane server currently registers only request-ID/logging hooks before routes, not auth:
   - `packages/control-plane/src/api/server.ts:185`

   The repo has an auth hook factory:
   - `packages/control-plane/src/api/middleware/auth.ts:130`

   But it is not wired into the server. `/ws` also accepts unauthenticated client messages:
   - `packages/control-plane/src/api/routes/ws.ts:220`

   Unless the spec adds mandatory authentication and principal propagation, any network-reachable caller can approve dangerous commands or spoof approval requests.

3. The design lacks a stable identifier model for the three surfaces.

   It stores a single `session_id TEXT`:
   - `docs/superpowers/specs/2026-03-16-permission-approval-system-design.md:47`

   But the runtime layer already distinguishes `sessionId` and `nativeSessionId`:
   - `packages/agent-worker/src/api/routes/runtime-sessions.ts:136`

   Session inline rendering, bell deep-linking, CP -> worker callback, and reload recovery need at least:
   - `approvalId`
   - UI-facing session id
   - native CLI session id

   Without that, the main “inline in session” surface is not reliably implementable.

## IMPORTANT

1. The spec collides with an existing approval system.

   `/api/approvals` is already registered for collaboration approval gates:
   - `packages/control-plane/src/api/server.ts:639`
   - `packages/control-plane/src/api/routes/approvals.ts:1`
   - `packages/control-plane/src/db/schema-collaboration.ts:128`

   Reusing the same path/file name for unrelated CLI permission approvals is a bad fit. This should either extend the existing approval model with a new gate kind, or use a separate namespace like `/api/permission-approvals`.

2. The state model is internally inconsistent.

   The goals say “auto-deny on timeout”:
   - `docs/superpowers/specs/2026-03-16-permission-approval-system-design.md:16`

   But the table and UI use `expired` as a terminal state:
   - `docs/superpowers/specs/2026-03-16-permission-approval-system-design.md:55`

   And later `resolvedBy` introduces `worker-unreachable`, which is not in the declared model:
   - `docs/superpowers/specs/2026-03-16-permission-approval-system-design.md:58`
   - `docs/superpowers/specs/2026-03-16-permission-approval-system-design.md:189`

   Pick one contract: either timeout becomes `denied`, or it becomes `expired`, but not both.

3. “DB transaction, first PATCH wins” is not enough detail.

   The existing approval-store pattern is read-then-insert-then-update:
   - `packages/control-plane/src/collaboration/approval-store.ts:80`
   - `packages/control-plane/src/collaboration/approval-store.ts:142`

   That pattern is race-prone. The spec needs an atomic compare-and-set rule, not just the word “transaction”.

4. The timeout/expiry mechanism is too vague to be robust.

   “On each heartbeat cycle (or a dedicated interval)”:
   - `docs/superpowers/specs/2026-03-16-permission-approval-system-design.md:117`

   This couples expiry to unrelated scheduler behavior. CP should own expiry deterministically on read/write paths, with a background sweeper as optimization, not correctness.

5. The current frontend event contract already disagrees with the worker/shared contract.

   Shared emits `approval_needed` as:
   - `{ tool, input, timeoutSeconds }`
   - `packages/shared/src/protocol/events.ts:30`

   But the web stream hook expects:
   - `{ toolName, args }`
   - `packages/web/src/hooks/use-session-stream.ts:10`

   And `SessionContent` reads `toolName`:
   - `packages/web/src/components/SessionContent.tsx:92`

   If the new system reuses that event, the frontend will already misread it. The new approval payload should be a shared type and include `approvalId`.

6. The spec points at the wrong live-session component.

   It says to modify `SessionMessageList.tsx`:
   - `docs/superpowers/specs/2026-03-16-permission-approval-system-design.md:223`

   But the active session detail path goes through:
   - `packages/web/src/components/SessionDetailPanel.tsx`
   - `packages/web/src/components/SessionContent.tsx`

   That is an implementation trap.

7. The WebSocket piece is underspecified.

   Current `/ws` is a command socket for agent subscriptions and start/stop actions, not a generic broadcast bus:
   - `packages/control-plane/src/api/routes/ws.ts:217`

   The design says “broadcast to all connected clients” but does not explain:
   - connection tracking
   - new outgoing message types
   - how the frontend subscribes globally

8. The worker-forwarding trust model is implicit, not designed.

   Current CP -> worker proxy requests send only JSON content type headers:
   - `packages/control-plane/src/api/proxy-worker-request.ts:157`

   If the new approval-response endpoint is intentionally protected only by internal network topology, the spec should say that explicitly. Otherwise it needs worker auth too.

9. The spec never addresses rollout behavior against current runtime defaults.

   The worker currently defaults to `--dangerously-skip-permissions` when no explicit permission mode is set:
   - `packages/agent-worker/src/runtime/cli-session-manager.ts:631`

   So this feature will not appear for the common path unless config and UX are updated in tandem.

## SUGGESTION

1. `Approve All Pending / Deny All Pending` looks like negative ROI for MVP and is risky for destructive tools:
   - `docs/superpowers/specs/2026-03-16-permission-approval-system-design.md:171`

   I would cut batch actions from v1.

2. Pending approvals should not behave like ordinary dismissible notifications.

   The current bell supports:
   - `Mark all read`
   - `Clear`
   - per-item dismiss

   See:
   - `packages/web/src/components/NotificationBell.tsx`

   The spec should explicitly separate “unresolved approval queue” from “historical notifications”.

3. For auditability, `resolved_by: 'user'` is too weak.

   Store the actual authenticated principal or key suffix, analogous to the existing `decidedBy` field in the collaboration approval system:
   - `packages/control-plane/src/collaboration/approval-store.ts:97`

## CLI Evidence

- Local `claude --help` on `2.1.76` documents `--input-format stream-json` only as “realtime streaming input”, not a permission-response protocol.
- Local verification:
  - `type:"user"` over `--input-format stream-json` works.
  - No successful evidence found for `type:"permission_response"`.
- Anthropic docs:
  - https://docs.anthropic.com/en/docs/claude-code/sdk#input-formats

## Bottom Line

The biggest blocker is not schema or UI polish; it is that the design assumes a Claude CLI control protocol that the current worker and available docs do not establish. I would not write an implementation plan until that reverse path is proven or the architecture is changed to avoid it.
