-- AgentCTL Migration: Add runtime-aware session and config persistence
-- Supports managed Claude Code + Codex runtimes, handoffs, and config sync state

CREATE TABLE IF NOT EXISTS "runtime_config_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "version" integer NOT NULL UNIQUE,
  "hash" text NOT NULL UNIQUE,
  "config" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "managed_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "runtime" text NOT NULL,
  "native_session_id" text,
  "machine_id" text NOT NULL REFERENCES "machines"("id"),
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "project_path" text NOT NULL,
  "worktree_path" text,
  "status" text NOT NULL DEFAULT 'starting',
  "config_version" integer NOT NULL,
  "handoff_strategy" text,
  "handoff_source_session_id" uuid REFERENCES "managed_sessions"("id") ON DELETE SET NULL,
  "metadata" jsonb DEFAULT '{}',
  "started_at" timestamptz DEFAULT now(),
  "last_heartbeat" timestamptz,
  "ended_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "machine_runtime_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "machine_id" text NOT NULL REFERENCES "machines"("id") ON DELETE CASCADE,
  "runtime" text NOT NULL,
  "is_installed" boolean NOT NULL DEFAULT false,
  "is_authenticated" boolean NOT NULL DEFAULT false,
  "sync_status" text NOT NULL DEFAULT 'unknown',
  "config_version" integer,
  "config_hash" text,
  "metadata" jsonb DEFAULT '{}',
  "last_config_applied_at" timestamptz,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session_handoffs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_session_id" uuid NOT NULL REFERENCES "managed_sessions"("id") ON DELETE CASCADE,
  "target_session_id" uuid REFERENCES "managed_sessions"("id") ON DELETE SET NULL,
  "source_runtime" text NOT NULL,
  "target_runtime" text NOT NULL,
  "reason" text NOT NULL,
  "strategy" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "snapshot" jsonb NOT NULL,
  "error_message" text,
  "created_at" timestamptz DEFAULT now(),
  "completed_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "native_import_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "handoff_id" uuid REFERENCES "session_handoffs"("id") ON DELETE SET NULL,
  "source_session_id" uuid REFERENCES "managed_sessions"("id") ON DELETE SET NULL,
  "target_session_id" uuid REFERENCES "managed_sessions"("id") ON DELETE SET NULL,
  "source_runtime" text NOT NULL,
  "target_runtime" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "metadata" jsonb DEFAULT '{}',
  "error_message" text,
  "attempted_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_runtime_config_revisions_version"
  ON "runtime_config_revisions"("version");
CREATE INDEX IF NOT EXISTS "idx_runtime_config_revisions_hash"
  ON "runtime_config_revisions"("hash");
CREATE INDEX IF NOT EXISTS "idx_managed_sessions_machine_id"
  ON "managed_sessions"("machine_id");
CREATE INDEX IF NOT EXISTS "idx_managed_sessions_agent_id"
  ON "managed_sessions"("agent_id");
CREATE INDEX IF NOT EXISTS "idx_managed_sessions_status"
  ON "managed_sessions"("status");
CREATE INDEX IF NOT EXISTS "idx_managed_sessions_runtime"
  ON "managed_sessions"("runtime");
CREATE INDEX IF NOT EXISTS "idx_machine_runtime_state_machine_id"
  ON "machine_runtime_state"("machine_id");
CREATE INDEX IF NOT EXISTS "idx_machine_runtime_state_runtime"
  ON "machine_runtime_state"("runtime");
CREATE INDEX IF NOT EXISTS "idx_session_handoffs_source_session_id"
  ON "session_handoffs"("source_session_id");
CREATE INDEX IF NOT EXISTS "idx_session_handoffs_target_session_id"
  ON "session_handoffs"("target_session_id");
CREATE INDEX IF NOT EXISTS "idx_session_handoffs_status"
  ON "session_handoffs"("status");
CREATE INDEX IF NOT EXISTS "idx_native_import_attempts_handoff_id"
  ON "native_import_attempts"("handoff_id");
CREATE INDEX IF NOT EXISTS "idx_native_import_attempts_status"
  ON "native_import_attempts"("status");
