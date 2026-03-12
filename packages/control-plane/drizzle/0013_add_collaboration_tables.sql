-- AgentCTL Migration: Collaboration spaces, threads, events, members
-- Part of §10.1 Multi-Agent Collaboration Phase 1

CREATE TABLE IF NOT EXISTS "spaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text DEFAULT '',
  "type" text NOT NULL,
  "visibility" text DEFAULT 'team',
  "created_by" text NOT NULL,
  "created_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "space_members" (
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "member_type" text NOT NULL,
  "member_id" text NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  PRIMARY KEY ("space_id", "member_type", "member_id")
);

CREATE INDEX IF NOT EXISTS "idx_space_members_member_id" ON "space_members"("member_id");

CREATE TABLE IF NOT EXISTS "threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "title" text,
  "created_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_threads_space_id" ON "threads"("space_id");

CREATE TABLE IF NOT EXISTS "space_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "space_id" uuid NOT NULL REFERENCES "spaces"("id"),
  "thread_id" uuid NOT NULL REFERENCES "threads"("id"),
  "sequence_num" bigint NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE,
  "correlation_id" text NOT NULL,
  "type" text NOT NULL,
  "sender_type" text NOT NULL,
  "sender_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "visibility" text DEFAULT 'public',
  "published" boolean DEFAULT false,
  "created_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_space_events_thread_seq" ON "space_events"("thread_id", "sequence_num");
CREATE INDEX IF NOT EXISTS "idx_space_events_outbox" ON "space_events"("published");

CREATE TABLE IF NOT EXISTS "session_space_links" (
  "session_id" text PRIMARY KEY,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "linked_at" timestamptz DEFAULT now()
);
