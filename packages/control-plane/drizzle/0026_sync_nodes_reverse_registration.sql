-- Roadmap §33.8 — Mesh Bidirectional Registration.
--
-- When an operator adds a peer locally, the control plane now auto-calls the
-- peer's POST /api/sync/peers/register handshake so registration is symmetric.
-- We persist the outcome on the sync_nodes row so the UI can surface "one-way"
-- peers and the operator can retry the reverse handshake from a button.
--
-- Status values:
--   NULL      — never attempted (existing rows, or peer registered via reverse
--               inbound flow)
--   'pending' — reverse handshake in progress (transient; should only appear
--               while the outbound request is inflight)
--   'ok'      — reverse registration succeeded and the remote peer now knows
--               about us
--   'failed'  — reverse registration failed; reverse_registration_error holds
--               the truncated reason and the operator can retry manually.

ALTER TABLE sync_nodes
  ADD COLUMN IF NOT EXISTS reverse_registration_status text,
  ADD COLUMN IF NOT EXISTS reverse_registration_error text,
  ADD COLUMN IF NOT EXISTS reverse_registration_at timestamptz;
