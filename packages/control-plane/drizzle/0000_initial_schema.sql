-- AgentCTL Initial Schema Migration
-- Generated from packages/control-plane/src/db/schema.ts

-- ============================================================
-- Table: machines
-- Tracks physical/virtual machines in the Tailscale fleet
-- ============================================================
CREATE TABLE IF NOT EXISTS "machines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "hostname" text NOT NULL UNIQUE,
  "tailscale_ip" inet NOT NULL,
  "os" text NOT NULL,
  "arch" text NOT NULL,
  "status" text DEFAULT 'online',
  "last_heartbeat" timestamp with time zone,
  "capabilities" jsonb DEFAULT '{}',
  "created_at" timestamp with time zone DEFAULT now()
);

-- ============================================================
-- Table: agents
-- Agent definitions bound to machines
-- ============================================================
CREATE TABLE IF NOT EXISTS "agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "machine_id" uuid REFERENCES "machines"("id"),
  "name" text NOT NULL,
  "type" text NOT NULL,
  "status" text DEFAULT 'idle',
  "schedule" text,
  "project_path" text,
  "worktree_branch" text,
  "current_session_id" text,
  "config" jsonb DEFAULT '{}',
  "last_run_at" timestamp with time zone,
  "last_cost_usd" numeric(10, 6),
  "total_cost_usd" numeric(12, 6) DEFAULT '0',
  "created_at" timestamp with time zone DEFAULT now()
);

-- ============================================================
-- Table: agent_runs
-- Individual execution runs for each agent
-- ============================================================
CREATE TABLE IF NOT EXISTS "agent_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "agent_id" uuid REFERENCES "agents"("id"),
  "trigger" text NOT NULL,
  "status" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "finished_at" timestamp with time zone,
  "cost_usd" numeric(10, 6),
  "tokens_in" bigint,
  "tokens_out" bigint,
  "model" text,
  "provider" text,
  "session_id" text,
  "error_message" text,
  "result_summary" text
);

-- ============================================================
-- Table: agent_actions
-- Fine-grained audit log of tool calls within a run
-- ============================================================
CREATE TABLE IF NOT EXISTS "agent_actions" (
  "id" bigserial PRIMARY KEY,
  "run_id" uuid REFERENCES "agent_runs"("id"),
  "timestamp" timestamp with time zone DEFAULT now(),
  "action_type" text NOT NULL,
  "tool_name" text,
  "tool_input" jsonb,
  "tool_output_hash" text,
  "duration_ms" integer,
  "approved_by" text
);

-- ============================================================
-- Indexes for common query patterns
-- ============================================================
CREATE INDEX IF NOT EXISTS "idx_machines_status" ON "machines" ("status");
CREATE INDEX IF NOT EXISTS "idx_agents_machine_id" ON "agents" ("machine_id");
CREATE INDEX IF NOT EXISTS "idx_agents_status" ON "agents" ("status");
CREATE INDEX IF NOT EXISTS "idx_agent_runs_agent_id" ON "agent_runs" ("agent_id");
CREATE INDEX IF NOT EXISTS "idx_agent_runs_status" ON "agent_runs" ("status");
CREATE INDEX IF NOT EXISTS "idx_agent_actions_run_id" ON "agent_actions" ("run_id");
CREATE INDEX IF NOT EXISTS "idx_agent_actions_action_type" ON "agent_actions" ("action_type");
