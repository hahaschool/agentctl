-- Mesh peer version observability (roadmap §33.9, partial)
-- All columns are nullable: older peers advertise nothing on /health until the
-- matching 33.9 ping slice ships, and we must continue to accept their pings.
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS peer_version TEXT;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS peer_git_sha TEXT;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS peer_schema_version INTEGER;
