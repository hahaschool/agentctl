-- AgentCTL Migration: Add Remote Control session tracking
-- Tracks active Claude Code Remote Control sessions across the fleet

CREATE TABLE IF NOT EXISTS "rc_sessions" (
  "id" text PRIMARY KEY,
  "agent_id" text NOT NULL REFERENCES "agents"("id"),
  "machine_id" text NOT NULL REFERENCES "machines"("id"),
  "session_url" text,
  "claude_session_id" text,
  "status" text NOT NULL DEFAULT 'starting',
  "project_path" text,
  "pid" integer,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "last_heartbeat" timestamptz,
  "ended_at" timestamptz,
  "metadata" jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS "idx_rc_sessions_agent_id" ON "rc_sessions"("agent_id");
CREATE INDEX IF NOT EXISTS "idx_rc_sessions_machine_id" ON "rc_sessions"("machine_id");
CREATE INDEX IF NOT EXISTS "idx_rc_sessions_status" ON "rc_sessions"("status");
