-- Migration: Task Graph + Fleet (§10.3 Multi-Agent Collaboration Phase 3)
-- Tables: worker_nodes, agent_profiles, agent_instances, task_graphs,
--         task_definitions, task_edges, task_runs, worker_leases

BEGIN;

-- ── worker_nodes ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname TEXT NOT NULL,
  tailscale_ip TEXT NOT NULL,
  max_concurrent_agents INTEGER DEFAULT 3,
  current_load REAL DEFAULT 0.0,
  capabilities TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'online' CHECK (status IN ('online', 'offline', 'draining')),
  last_heartbeat_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_nodes_status ON worker_nodes(status);
CREATE INDEX IF NOT EXISTS idx_worker_nodes_hostname ON worker_nodes(hostname);

-- ── agent_profiles ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  capabilities TEXT[] DEFAULT '{}',
  preferred_model TEXT,
  max_concurrent_tasks INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── agent_instances ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES worker_nodes(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'idle',
  current_task_run_id UUID,
  last_heartbeat_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_instances_profile_id ON agent_instances(profile_id);
CREATE INDEX IF NOT EXISTS idx_agent_instances_worker_id ON agent_instances(worker_id);
CREATE INDEX IF NOT EXISTS idx_agent_instances_status ON agent_instances(status);

-- ── task_graphs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_graphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── task_definitions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id UUID NOT NULL REFERENCES task_graphs(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('task', 'gate', 'fork', 'join')),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  required_capabilities TEXT[] DEFAULT '{}',
  estimated_tokens INTEGER,
  timeout_ms INTEGER DEFAULT 3600000,
  max_retry_attempts INTEGER DEFAULT 1,
  retry_backoff_ms INTEGER DEFAULT 5000,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_definitions_graph_id ON task_definitions(graph_id);

-- ── task_edges ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_edges (
  from_definition UUID NOT NULL REFERENCES task_definitions(id) ON DELETE CASCADE,
  to_definition UUID NOT NULL REFERENCES task_definitions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('blocks', 'context')),
  PRIMARY KEY (from_definition, to_definition)
);

CREATE INDEX IF NOT EXISTS idx_task_edges_to_definition ON task_edges(to_definition);

-- ── task_runs ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID NOT NULL REFERENCES task_definitions(id),
  space_id UUID REFERENCES spaces(id),
  thread_id UUID REFERENCES threads(id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'running', 'blocked', 'completed', 'failed', 'cancelled')),
  attempt INTEGER DEFAULT 1,
  assignee_instance_id UUID REFERENCES agent_instances(id),
  machine_id UUID REFERENCES worker_nodes(id),
  claimed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  result JSONB,
  error JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_runs_definition_id ON task_runs(definition_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);
CREATE INDEX IF NOT EXISTS idx_task_runs_machine_id ON task_runs(machine_id);

-- ── worker_leases ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_leases (
  task_run_id UUID PRIMARY KEY REFERENCES task_runs(id),
  worker_id UUID NOT NULL REFERENCES worker_nodes(id),
  agent_instance_id UUID NOT NULL REFERENCES agent_instances(id),
  expires_at TIMESTAMPTZ NOT NULL,
  renewed_at TIMESTAMPTZ DEFAULT now()
);

COMMIT;
