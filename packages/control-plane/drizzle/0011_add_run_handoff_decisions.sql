-- AgentCTL Migration: Add run-level automatic handoff decision journal
-- Tracks dry-run and executed automatic handoff evaluations by run

CREATE TABLE IF NOT EXISTS "run_handoff_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_run_id" uuid NOT NULL REFERENCES "agent_runs"("id") ON DELETE CASCADE,
  "source_managed_session_id" uuid REFERENCES "managed_sessions"("id") ON DELETE SET NULL,
  "target_run_id" uuid REFERENCES "agent_runs"("id") ON DELETE SET NULL,
  "handoff_id" uuid REFERENCES "session_handoffs"("id") ON DELETE SET NULL,
  "trigger" text NOT NULL,
  "stage" text NOT NULL,
  "mode" text NOT NULL,
  "status" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "policy_snapshot" jsonb NOT NULL DEFAULT '{}',
  "signal_payload" jsonb NOT NULL DEFAULT '{}',
  "reason" text,
  "skipped_reason" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_run_handoff_decisions_source_run_id"
  ON "run_handoff_decisions"("source_run_id");

CREATE INDEX IF NOT EXISTS "idx_run_handoff_decisions_trigger"
  ON "run_handoff_decisions"("trigger");

CREATE INDEX IF NOT EXISTS "idx_run_handoff_decisions_created_at"
  ON "run_handoff_decisions"("created_at");
