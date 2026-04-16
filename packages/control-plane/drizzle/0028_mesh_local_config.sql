-- §33.12 Phase 2: Local-only mesh identity configuration.
-- This table stores per-machine mesh config (Tailscale IP override, sync URL
-- override, registration token). It is intentionally NOT synced — each machine
-- manages its own identity config independently.
--
-- CRITICAL: NO sync trigger. If you add a trigger for change tracking on this
-- table, you will replicate machine-local secrets across the mesh.

CREATE TABLE IF NOT EXISTS mesh_local_config (
  key   TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE mesh_local_config IS
  'Local-only mesh identity config. Intentionally excluded from sync triggers — each machine stores its own identity.';
