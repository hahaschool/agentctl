-- Add dispatch_config column to agent_runs for runtime config audit trail.
-- Nullable JSONB, no index (only read by single-row PK lookup).
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS dispatch_config JSONB DEFAULT NULL;
