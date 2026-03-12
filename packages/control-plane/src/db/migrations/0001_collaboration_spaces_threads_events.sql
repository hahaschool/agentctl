-- Migration: collaboration spaces, threads, events, members, session links
-- Part of §10.1 Multi-Agent Collaboration Phase 1

BEGIN;

-- ── spaces ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT NOT NULL,
  visibility TEXT DEFAULT 'team',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── space_members ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS space_members (
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  member_type TEXT NOT NULL,
  member_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (space_id, member_type, member_id)
);

CREATE INDEX IF NOT EXISTS idx_space_members_member_id ON space_members(member_id);

-- ── threads ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_threads_space_id ON threads(space_id);

-- ── space_events (append-only) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS space_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id),
  thread_id UUID NOT NULL REFERENCES threads(id),
  sequence_num BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  correlation_id TEXT NOT NULL,
  type TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  visibility TEXT DEFAULT 'public',
  published BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_space_events_thread_seq ON space_events(thread_id, sequence_num);
CREATE INDEX IF NOT EXISTS idx_space_events_outbox ON space_events(published);

-- ── session_space_links ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS session_space_links (
  session_id TEXT PRIMARY KEY,
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ DEFAULT now()
);

COMMIT;
