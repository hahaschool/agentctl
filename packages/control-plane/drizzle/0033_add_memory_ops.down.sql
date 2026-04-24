-- packages/control-plane/drizzle/0033_add_memory_ops.down.sql
DROP TABLE IF EXISTS memory_ops_job_events;
DROP TABLE IF EXISTS memory_ops_audit;
DROP TABLE IF EXISTS memory_ops_jobs;
DROP INDEX IF EXISTS api_accounts_one_active_embedding;
DROP INDEX IF EXISTS idx_api_accounts_kind;
ALTER TABLE api_accounts
  DROP COLUMN IF EXISTS credential_last4,
  DROP CONSTRAINT IF EXISTS api_accounts_kind_check,
  DROP COLUMN IF EXISTS credential_kind;
