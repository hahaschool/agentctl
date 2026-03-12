-- AgentCTL Migration 0016: Intelligence layer tables for §10.5 Phase 5
-- Depends on: 0013 (collaboration), 0014 (task_graph/fleet), 0015 (agent_bus/approval_gates)
-- Adds: routing_decisions, routing_outcomes, approval_timings, notification_preferences

-- ── Routing Decisions (audit trail of every assignment) ─────

CREATE TABLE IF NOT EXISTS "routing_decisions" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_def_id"  uuid NOT NULL REFERENCES "task_definitions"("id"),
  "task_run_id"  uuid NOT NULL REFERENCES "task_runs"("id"),
  "profile_id"   uuid NOT NULL,
  "node_id"      uuid NOT NULL REFERENCES "worker_nodes"("id"),
  "score"        real NOT NULL,
  "breakdown"    jsonb NOT NULL,
  "mode"         text NOT NULL DEFAULT 'auto',
  "created_at"   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_routing_decisions_task_run"
  ON "routing_decisions"("task_run_id");

CREATE INDEX IF NOT EXISTS "idx_routing_decisions_profile"
  ON "routing_decisions"("profile_id");

-- ── Routing Outcomes (one per completed/failed/cancelled task run) ──

CREATE TABLE IF NOT EXISTS "routing_outcomes" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "routing_decision_id"  uuid REFERENCES "routing_decisions"("id"),
  "task_run_id"          uuid NOT NULL REFERENCES "task_runs"("id"),
  "profile_id"           uuid NOT NULL,
  "node_id"              uuid NOT NULL REFERENCES "worker_nodes"("id"),
  "capabilities"         text[] NOT NULL DEFAULT '{}',
  "status"               text NOT NULL,
  "duration_ms"          integer,
  "cost_usd"             real,
  "tokens_used"          integer,
  "error_code"           text,
  "created_at"           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_routing_outcomes_profile"
  ON "routing_outcomes"("profile_id");

CREATE INDEX IF NOT EXISTS "idx_routing_outcomes_status"
  ON "routing_outcomes"("status");

-- ── Approval Timings (response time tracking for approval gates) ──

CREATE TABLE IF NOT EXISTS "approval_timings" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "gate_id"           uuid NOT NULL REFERENCES "approval_gates"("id"),
  "decided_by"        text NOT NULL,
  "capabilities"      text[] NOT NULL DEFAULT '{}',
  "decision_time_ms"  integer NOT NULL,
  "timed_out"         boolean NOT NULL DEFAULT false,
  "created_at"        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_approval_timings_decided_by"
  ON "approval_timings"("decided_by");

-- ── Notification Preferences (per-user channel + priority config) ──

CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"           text NOT NULL,
  "priority"          text NOT NULL,
  "channels"          text[] NOT NULL DEFAULT '{}',
  "quiet_hours_start" text,
  "quiet_hours_end"   text,
  "timezone"          text,
  "created_at"        timestamptz DEFAULT now()
);

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "uq_notification_pref_user_priority" UNIQUE ("user_id", "priority");
