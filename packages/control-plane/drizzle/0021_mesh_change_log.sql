-- Mesh P1: Change log + vector clock infrastructure
-- All DDL is idempotent (IF NOT EXISTS / DROP IF EXISTS) for replay-on-boot safety.

-- ============================================================================
-- 1. New tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_nodes (
  id          TEXT PRIMARY KEY,
  hostname    TEXT NOT NULL,
  tailscale_ip TEXT,
  role        TEXT NOT NULL DEFAULT 'full',
  is_self     BOOLEAN NOT NULL DEFAULT false,
  last_seen   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_change_log (
  id          BIGSERIAL PRIMARY KEY,
  node_id     TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  operation   TEXT NOT NULL,
  payload     JSONB,
  vclock      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_change_log_unsynced
  ON sync_change_log (synced, created_at) WHERE synced = false;
CREATE INDEX IF NOT EXISTS idx_change_log_table_row
  ON sync_change_log (table_name, row_id);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name      TEXT NOT NULL,
  row_id          TEXT NOT NULL,
  local_vclock    JSONB NOT NULL,
  local_payload   JSONB,
  remote_vclock   JSONB NOT NULL,
  remote_payload  JSONB,
  remote_node_id  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  resolution      TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conflicts_pending
  ON sync_conflicts (status) WHERE status = 'pending';

-- ============================================================================
-- 2. Add sync_id UUID to agent_actions (bigserial PK is not globally unique)
-- ============================================================================

ALTER TABLE agent_actions ADD COLUMN IF NOT EXISTS
  sync_id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_actions_sync_id
  ON agent_actions (sync_id);

-- ============================================================================
-- 3. Generic trigger function
--    Reads PK column name from TG_ARGV[0].
--    Uses advisory lock to serialize concurrent vclock increments.
--    Skips if app.sync_applying = 'true' (prevents loops during remote apply).
--    Skips if app.node_id is not set (graceful degradation).
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_capture_change() RETURNS trigger AS $$
DECLARE
  v_node_id     TEXT;
  v_pk_col      TEXT;
  v_row_id      TEXT;
  v_payload     JSONB;
  v_vclock      JSONB;
  v_prev_vclock JSONB;
BEGIN
  -- Guard: skip during remote-apply to prevent infinite sync loops
  IF current_setting('app.sync_applying', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Guard: skip if no node identity is set (trigger is a no-op before mesh init)
  v_node_id := current_setting('app.node_id', true);
  IF v_node_id IS NULL OR v_node_id = '' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Read PK column name from trigger argument
  v_pk_col := TG_ARGV[0];

  -- Extract row ID and payload using dynamic column reference
  IF TG_OP = 'DELETE' THEN
    EXECUTE format('SELECT ($1).%I::text', v_pk_col) INTO v_row_id USING OLD;
    v_payload := NULL;
  ELSE
    EXECUTE format('SELECT ($1).%I::text', v_pk_col) INTO v_row_id USING NEW;
    v_payload := to_jsonb(NEW);
  END IF;

  -- Serialize concurrent vclock increments for the same logical row.
  -- hashtext() returns int4, cast to bigint for the single-key overload.
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || ':' || v_row_id)::bigint);

  -- Read latest vector clock for this row
  SELECT vclock INTO v_prev_vclock
    FROM sync_change_log
    WHERE table_name = TG_TABLE_NAME AND row_id = v_row_id
    ORDER BY id DESC LIMIT 1;

  v_prev_vclock := COALESCE(v_prev_vclock, '{}'::jsonb);

  -- Increment this node's component
  v_vclock := jsonb_set(
    v_prev_vclock,
    ARRAY[v_node_id],
    to_jsonb(COALESCE((v_prev_vclock->>v_node_id)::int, 0) + 1)
  );

  -- Record the change
  INSERT INTO sync_change_log (node_id, table_name, row_id, operation, payload, vclock)
  VALUES (v_node_id, TG_TABLE_NAME, v_row_id, TG_OP, v_payload, v_vclock);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. Attach triggers to all 15 synced tables (no api_accounts — local-only)
--    DROP + CREATE for idempotent replay-on-boot.
--    PK column name is passed as the trigger argument.
-- ============================================================================

-- Append-only tables (4 tables)
DROP TRIGGER IF EXISTS sync_capture ON agent_actions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON agent_actions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('sync_id');

DROP TRIGGER IF EXISTS sync_capture ON session_handoffs;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON session_handoffs FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON native_import_attempts;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON native_import_attempts FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON run_handoff_decisions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON run_handoff_decisions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

-- Mutable tables (11 tables)
DROP TRIGGER IF EXISTS sync_capture ON agents;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON agents FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON machines;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON machines FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON agent_runs;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON agent_runs FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON rc_sessions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON rc_sessions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON managed_sessions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON managed_sessions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON project_account_mappings;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON project_account_mappings FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON settings;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON settings FOR EACH ROW EXECUTE FUNCTION sync_capture_change('key');

DROP TRIGGER IF EXISTS sync_capture ON runtime_config_revisions;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON runtime_config_revisions FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON memory_scopes;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON memory_scopes FOR EACH ROW EXECUTE FUNCTION sync_capture_change('scope');

DROP TRIGGER IF EXISTS sync_capture ON memory_facts;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON memory_facts FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');

DROP TRIGGER IF EXISTS sync_capture ON memory_edges;
CREATE TRIGGER sync_capture AFTER INSERT OR UPDATE OR DELETE
  ON memory_edges FOR EACH ROW EXECUTE FUNCTION sync_capture_change('id');
