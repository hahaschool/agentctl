-- AgentCTL Migration: Task Graph + Fleet
-- Part of §10.3 Multi-Agent Collaboration Phase 3

CREATE TABLE IF NOT EXISTS "worker_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "hostname" text NOT NULL,
  "tailscale_ip" text NOT NULL,
  "max_concurrent_agents" integer DEFAULT 3,
  "current_load" real DEFAULT 0.0,
  "capabilities" text[] DEFAULT '{}',
  "status" text DEFAULT 'online' CHECK ("status" IN ('online', 'offline', 'draining')),
  "last_heartbeat_at" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_worker_nodes_status" ON "worker_nodes"("status");
CREATE INDEX IF NOT EXISTS "idx_worker_nodes_hostname" ON "worker_nodes"("hostname");

CREATE TABLE IF NOT EXISTS "agent_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "capabilities" text[] DEFAULT '{}',
  "preferred_model" text,
  "max_concurrent_tasks" integer DEFAULT 1,
  "created_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "agent_instances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "profile_id" uuid NOT NULL REFERENCES "agent_profiles"("id") ON DELETE CASCADE,
  "worker_id" uuid NOT NULL REFERENCES "worker_nodes"("id") ON DELETE CASCADE,
  "status" text DEFAULT 'idle',
  "current_task_run_id" uuid,
  "last_heartbeat_at" timestamptz DEFAULT now(),
  "created_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_agent_instances_profile_id" ON "agent_instances"("profile_id");
CREATE INDEX IF NOT EXISTS "idx_agent_instances_worker_id" ON "agent_instances"("worker_id");
CREATE INDEX IF NOT EXISTS "idx_agent_instances_status" ON "agent_instances"("status");

CREATE TABLE IF NOT EXISTS "task_graphs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text,
  "created_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "task_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "graph_id" uuid NOT NULL REFERENCES "task_graphs"("id") ON DELETE CASCADE,
  "type" text NOT NULL CHECK ("type" IN ('task', 'gate', 'fork', 'join')),
  "name" text NOT NULL,
  "description" text DEFAULT '',
  "required_capabilities" text[] DEFAULT '{}',
  "estimated_tokens" integer,
  "timeout_ms" integer DEFAULT 3600000,
  "max_retry_attempts" integer DEFAULT 1,
  "retry_backoff_ms" integer DEFAULT 5000,
  "created_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_task_definitions_graph_id" ON "task_definitions"("graph_id");

CREATE TABLE IF NOT EXISTS "task_edges" (
  "from_definition" uuid NOT NULL REFERENCES "task_definitions"("id") ON DELETE CASCADE,
  "to_definition" uuid NOT NULL REFERENCES "task_definitions"("id") ON DELETE CASCADE,
  "type" text NOT NULL CHECK ("type" IN ('blocks', 'context')),
  PRIMARY KEY ("from_definition", "to_definition")
);

CREATE INDEX IF NOT EXISTS "idx_task_edges_to_definition" ON "task_edges"("to_definition");

CREATE TABLE IF NOT EXISTS "task_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "definition_id" uuid NOT NULL REFERENCES "task_definitions"("id"),
  "space_id" uuid REFERENCES "spaces"("id"),
  "thread_id" uuid REFERENCES "threads"("id"),
  "status" text DEFAULT 'pending' CHECK ("status" IN ('pending', 'claimed', 'running', 'blocked', 'completed', 'failed', 'cancelled')),
  "attempt" integer DEFAULT 1,
  "assignee_instance_id" uuid REFERENCES "agent_instances"("id"),
  "machine_id" uuid REFERENCES "worker_nodes"("id"),
  "claimed_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "last_heartbeat_at" timestamptz,
  "result" jsonb,
  "error" jsonb,
  "created_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_task_runs_definition_id" ON "task_runs"("definition_id");
CREATE INDEX IF NOT EXISTS "idx_task_runs_status" ON "task_runs"("status");
CREATE INDEX IF NOT EXISTS "idx_task_runs_machine_id" ON "task_runs"("machine_id");

CREATE TABLE IF NOT EXISTS "worker_leases" (
  "task_run_id" uuid PRIMARY KEY REFERENCES "task_runs"("id"),
  "worker_id" uuid NOT NULL REFERENCES "worker_nodes"("id"),
  "agent_instance_id" uuid NOT NULL REFERENCES "agent_instances"("id"),
  "expires_at" timestamptz NOT NULL,
  "renewed_at" timestamptz DEFAULT now()
);
