-- Mesh P4: Peer registry extensions
CREATE TABLE IF NOT EXISTS sync_nodes (
  id               TEXT PRIMARY KEY,
  hostname         TEXT NOT NULL,
  tailscale_ip     TEXT,
  role             TEXT NOT NULL DEFAULT 'full',
  last_seen        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_url         TEXT,
  sync_status      TEXT DEFAULT 'unknown',
  sync_interval_ms INTEGER DEFAULT 30000,
  is_self          BOOLEAN DEFAULT false,
  public_key       TEXT
);

ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS sync_url TEXT;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'unknown';
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS sync_interval_ms INTEGER DEFAULT 30000;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS is_self BOOLEAN DEFAULT false;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS public_key TEXT;

CREATE TABLE IF NOT EXISTS sync_peer_cursors (
  local_node_id   TEXT NOT NULL,
  remote_node_id  TEXT NOT NULL,
  pulled_cursor   BIGINT DEFAULT 0,
  acked_cursor    BIGINT DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (local_node_id, remote_node_id)
);
