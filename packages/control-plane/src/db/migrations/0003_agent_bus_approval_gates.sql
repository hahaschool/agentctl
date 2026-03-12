-- Migration: Phase 2 — agent identity, subscription filters, approval gates
-- Part of §10.2 Multi-Agent Communication

BEGIN;

-- ── Extend space_members with subscription filter ────────────
ALTER TABLE space_members
  ADD COLUMN IF NOT EXISTS subscription_filter JSONB DEFAULT '{}';

-- ── Extend agent_profiles with richer identity columns ────────
-- (agent_profiles + agent_instances created in 0002_task_graph_fleet.sql)
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS runtime_type TEXT NOT NULL DEFAULT 'claude-code';
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS provider_id TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS tool_scopes TEXT[] DEFAULT '{}';
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS max_tokens_per_task INTEGER;
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS max_cost_per_hour REAL;

-- ── Extend agent_instances with runtime fields ────────────────
ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS machine_id TEXT;
ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS worktree_id TEXT;
ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS runtime_session_id TEXT;
ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT now();

-- ── Approval gates ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_definition_id TEXT NOT NULL,
  task_run_id TEXT,
  thread_id UUID REFERENCES threads(id),
  required_approvers TEXT[] NOT NULL DEFAULT '{}',
  required_count INTEGER NOT NULL DEFAULT 1,
  timeout_ms INTEGER DEFAULT 3600000,
  timeout_policy TEXT DEFAULT 'pause',
  context_artifact_ids TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_gates_thread ON approval_gates(thread_id);
CREATE INDEX IF NOT EXISTS idx_approval_gates_status ON approval_gates(status);

-- ── Approval decisions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS approval_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_id UUID NOT NULL REFERENCES approval_gates(id) ON DELETE CASCADE,
  decided_by TEXT NOT NULL,
  action TEXT NOT NULL,
  comment TEXT,
  via_timeout BOOLEAN DEFAULT FALSE,
  decided_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_decisions_gate ON approval_decisions(gate_id);

COMMIT;
