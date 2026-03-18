-- AgentCTL Migration: Permission approval request queue for canUseTool flow

CREATE TABLE IF NOT EXISTS "permission_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_id" uuid NOT NULL,
  "session_id" text NOT NULL,
  "machine_id" text NOT NULL,
  "request_id" text NOT NULL,
  "tool_name" text NOT NULL,
  "tool_input" jsonb,
  "description" text,
  "status" text NOT NULL DEFAULT 'pending',
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "timeout_at" timestamptz NOT NULL,
  "resolved_at" timestamptz,
  "resolved_by" text,
  "decision" text,
  CONSTRAINT "permission_requests_valid_status"
    CHECK ("status" IN ('pending', 'approved', 'denied', 'expired', 'cancelled')),
  CONSTRAINT "permission_requests_valid_decision"
    CHECK ("decision" IS NULL OR "decision" IN ('approved', 'denied'))
);

CREATE INDEX IF NOT EXISTS "idx_perm_req_status" ON "permission_requests"("status");
CREATE INDEX IF NOT EXISTS "idx_perm_req_agent" ON "permission_requests"("agent_id");
CREATE INDEX IF NOT EXISTS "idx_perm_req_session" ON "permission_requests"("session_id");
