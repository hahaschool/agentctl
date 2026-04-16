-- §33.12 Phase 3.1: Structured error codes for reverse registration.
-- Captures the HTTP status and a machine-readable error code so the
-- frontend can map failures to actionable user guidance instead of
-- rendering raw error strings.
ALTER TABLE sync_nodes
  ADD COLUMN IF NOT EXISTS reverse_registration_error_code TEXT,
  ADD COLUMN IF NOT EXISTS reverse_registration_http_status INTEGER;
