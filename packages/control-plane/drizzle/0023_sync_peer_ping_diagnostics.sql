-- Mesh peer manual ping diagnostics
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS last_ping_error TEXT;
ALTER TABLE sync_nodes ADD COLUMN IF NOT EXISTS last_ping_status_code INTEGER;
