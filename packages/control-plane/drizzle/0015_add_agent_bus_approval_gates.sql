-- AgentCTL Migration: Phase 2 — agent identity extensions, subscription filters, approval gates
-- Part of §10.2 Multi-Agent Communication

-- ── Extend space_members with subscription filter ────────────
ALTER TABLE "space_members"
  ADD COLUMN IF NOT EXISTS "subscription_filter" jsonb DEFAULT '{}';

-- ── Extend agent_profiles with richer identity columns ────────
-- (agent_profiles + agent_instances created in 0014_add_task_graph_fleet.sql)
ALTER TABLE "agent_profiles" ADD COLUMN IF NOT EXISTS "runtime_type" text NOT NULL DEFAULT 'claude-code';
ALTER TABLE "agent_profiles" ADD COLUMN IF NOT EXISTS "model_id" text NOT NULL DEFAULT '';
ALTER TABLE "agent_profiles" ADD COLUMN IF NOT EXISTS "provider_id" text NOT NULL DEFAULT '';
ALTER TABLE "agent_profiles" ADD COLUMN IF NOT EXISTS "tool_scopes" text[] DEFAULT '{}';
ALTER TABLE "agent_profiles" ADD COLUMN IF NOT EXISTS "max_tokens_per_task" integer;
ALTER TABLE "agent_profiles" ADD COLUMN IF NOT EXISTS "max_cost_per_hour" real;

-- ── Extend agent_instances with runtime fields ────────────────
ALTER TABLE "agent_instances" ADD COLUMN IF NOT EXISTS "machine_id" text;
ALTER TABLE "agent_instances" ADD COLUMN IF NOT EXISTS "worktree_id" text;
ALTER TABLE "agent_instances" ADD COLUMN IF NOT EXISTS "runtime_session_id" text;
ALTER TABLE "agent_instances" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamptz DEFAULT now();
ALTER TABLE "agent_instances" ADD COLUMN IF NOT EXISTS "started_at" timestamptz DEFAULT now();

-- ── Approval gates ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "approval_gates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_definition_id" text NOT NULL,
  "task_run_id" text,
  "thread_id" uuid REFERENCES "threads"("id"),
  "required_approvers" text[] NOT NULL DEFAULT '{}',
  "required_count" integer NOT NULL DEFAULT 1,
  "timeout_ms" integer DEFAULT 3600000,
  "timeout_policy" text DEFAULT 'pause',
  "context_artifact_ids" text[] DEFAULT '{}',
  "status" text DEFAULT 'pending',
  "created_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_approval_gates_thread"
  ON "approval_gates"("thread_id");

CREATE INDEX IF NOT EXISTS "idx_approval_gates_status"
  ON "approval_gates"("status");

-- ── Approval decisions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "approval_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "gate_id" uuid NOT NULL REFERENCES "approval_gates"("id") ON DELETE CASCADE,
  "decided_by" text NOT NULL,
  "action" text NOT NULL,
  "comment" text,
  "via_timeout" boolean DEFAULT false,
  "decided_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_approval_decisions_gate"
  ON "approval_decisions"("gate_id");
