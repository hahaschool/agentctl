CREATE TABLE memory_drawer_backfill_state (
  id text PRIMARY KEY,
  source_type text NOT NULL,
  source_root text NOT NULL,
  cursor_json jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('running', 'paused', 'complete', 'failed')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX memory_drawer_backfill_source_unique
  ON memory_drawer_backfill_state(source_type, source_root);

CREATE INDEX idx_memory_drawer_backfill_state_status
  ON memory_drawer_backfill_state(status);
