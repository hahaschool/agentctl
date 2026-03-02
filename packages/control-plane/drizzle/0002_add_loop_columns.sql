-- AgentCTL Migration: Add loop-related columns
-- Phase 8.2: Loop checkpoint support

-- Add loop_config to agents table (stores LoopConfig from @agentctl/shared)
ALTER TABLE "agents" ADD COLUMN "loop_config" jsonb DEFAULT NULL;

-- Add loop_iteration to agent_runs (which iteration of a loop this run represents)
ALTER TABLE "agent_runs" ADD COLUMN "loop_iteration" integer DEFAULT NULL;

-- Add parent_run_id to agent_runs (links sub-runs to their parent loop run)
ALTER TABLE "agent_runs" ADD COLUMN "parent_run_id" text DEFAULT NULL;

-- Index for efficient lookup of sub-runs by parent
CREATE INDEX IF NOT EXISTS "idx_agent_runs_parent_run_id" ON "agent_runs" ("parent_run_id");
