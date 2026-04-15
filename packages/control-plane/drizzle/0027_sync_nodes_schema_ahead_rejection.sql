-- Roadmap §33.10 — Persist schema-ahead mesh envelope rejections.
--
-- When a peer sends a change-log envelope whose `schemaVersion` exceeds the
-- local control plane's schema by more than 1, the apply-side compat gate
-- (see src/sync/mesh-compat.ts) rejects it with MESH_ENVELOPE_SCHEMA_AHEAD.
-- PR #567 added a ping-based "peer ahead" badge, but ping-derived drift is a
-- coarse signal: it fires on *any* schema difference reported via /health.
-- The columns below record the *actual* rejection events so /mesh-peers can
-- surface a red "Peer ahead — update this CP" badge pinpointing the peer that
-- is currently producing envelopes our apply gate cannot accept.
--
-- Columns:
--   last_schema_ahead_version — schemaVersion from the most recent rejected
--       envelope. NULL when we have never rejected one from this peer.
--   last_schema_ahead_at      — timestamp of the most recent rejection.
--   schema_ahead_count        — rolling count of rejected envelopes from this
--       peer. Operators can clear it by updating the local control plane (the
--       count is reset when the peer catches up; see recordSchemaAheadRejection
--       + the catch-up path to be added in a follow-up slice).
--
-- All three columns are nullable (count defaults to 0) so the migration is a
-- pure add — no data backfill is required and older peer rows remain valid.

ALTER TABLE sync_nodes
  ADD COLUMN IF NOT EXISTS last_schema_ahead_version integer,
  ADD COLUMN IF NOT EXISTS last_schema_ahead_at timestamptz,
  ADD COLUMN IF NOT EXISTS schema_ahead_count integer NOT NULL DEFAULT 0;
