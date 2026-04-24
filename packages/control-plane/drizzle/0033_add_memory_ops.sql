-- packages/control-plane/drizzle/0033_add_memory_ops.sql

-- ============================================================
-- Group A — api_accounts extensions
-- ============================================================
ALTER TABLE api_accounts
  ADD COLUMN credential_kind text NOT NULL DEFAULT 'runtime',
  ADD CONSTRAINT api_accounts_kind_check
    CHECK (credential_kind IN ('runtime', 'embedding')),
  ADD COLUMN credential_last4 text;

CREATE UNIQUE INDEX api_accounts_one_active_embedding
  ON api_accounts (credential_kind)
  WHERE is_active = true AND credential_kind = 'embedding';

CREATE INDEX idx_api_accounts_kind ON api_accounts (credential_kind);

-- ============================================================
-- Group B — memory_ops_jobs (mesh-synced mutable)
-- ============================================================
CREATE TABLE memory_ops_jobs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                      text NOT NULL
                            CHECK (kind IN ('embedding-backfill','drawer-backfill',
                                            'consolidation','synthesis')),
  status                    text NOT NULL
                            CHECK (status IN ('queued','running','cancelling',
                                              'completed','failed','cancelled')),
  params                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress                  jsonb NOT NULL
                            DEFAULT '{"processed":0,"embedded":0,"failed":0,"total":0,"costUsd":0,"usageEstimated":false}'::jsonb,
  result                    jsonb,
  error                     text,
  error_code                text,
  credential_id             uuid,
  provider_kind             text,
  provider_model            text,
  provider_host             text,
  price_usd_per_mtoken      numeric(12,8),
  origin_machine_id         text NOT NULL,
  executor_machine_id       text NOT NULL,
  cancel_requested_at       timestamptz,
  started_at                timestamptz,
  finished_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  egress_confirmed_at       timestamptz,
  egress_confirmed_by       text,
  egress_snapshot           jsonb
);

CREATE INDEX idx_memory_ops_jobs_status_executor
  ON memory_ops_jobs (status, executor_machine_id);
CREATE INDEX idx_memory_ops_jobs_kind_created
  ON memory_ops_jobs (kind, created_at DESC);
-- Expression index — raw SQL only; Drizzle cannot express COALESCE in index().on().
-- CAUTION: Never drop this index in a future drizzle-kit migration.
CREATE INDEX idx_memory_ops_jobs_kind_scope_status
  ON memory_ops_jobs ((COALESCE(params->>'scope','')), kind, status);

CREATE TRIGGER sync_capture
  AFTER INSERT OR UPDATE OF status, result, finished_at, error, error_code,
                             cancel_requested_at
     OR DELETE
  ON memory_ops_jobs
  FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

-- ============================================================
-- Group C — memory_ops_job_events (LOCAL-ONLY)
-- ============================================================
CREATE TABLE memory_ops_job_events (
  event_id   bigserial PRIMARY KEY,
  job_id     uuid NOT NULL REFERENCES memory_ops_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL
             CHECK (event_type IN ('started','progress','log','completed',
                                   'failed','cancelled','cancelling')),
  level      text CHECK (level IN ('info','warn','error')),
  message    text,
  progress   jsonb,
  payload    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_ops_job_events_job ON memory_ops_job_events (job_id, event_id);
-- LOCAL-ONLY: NO sync_capture trigger. Not in TABLE_SYNC_CONFIG.

-- ============================================================
-- Group D — memory_ops_audit (LOCAL-ONLY)
-- ============================================================
CREATE TABLE memory_ops_audit (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor     text NOT NULL,
  action    text NOT NULL,
  target    text NOT NULL,
  context   jsonb NOT NULL DEFAULT '{}'::jsonb,
  timestamp timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_ops_audit_action_ts ON memory_ops_audit (action, timestamp DESC);
CREATE INDEX idx_memory_ops_audit_target ON memory_ops_audit (target);
-- LOCAL-ONLY. No sync_capture. Not in TABLE_SYNC_CONFIG.
