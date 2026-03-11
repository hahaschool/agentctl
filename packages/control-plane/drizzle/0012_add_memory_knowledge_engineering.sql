-- AgentCTL Migration: Knowledge engineering additions for §3.6
-- Adds: tags (role-aware search), usage_count (feedback), consolidation_items table

-- Role-aware tags on memory facts
ALTER TABLE "memory_facts"
  ADD COLUMN IF NOT EXISTS "tags" text[] NOT NULL DEFAULT '{}';

-- Usage count for feedback tracking
ALTER TABLE "memory_facts"
  ADD COLUMN IF NOT EXISTS "usage_count" integer NOT NULL DEFAULT 0;

-- Index for tag-based lookups (GIN for array contains queries)
CREATE INDEX IF NOT EXISTS "idx_memory_facts_tags"
  ON "memory_facts" USING gin ("tags");

-- Consolidation items table (stores contradiction + review flags)
CREATE TABLE IF NOT EXISTS "memory_consolidation_items" (
  "id"         text PRIMARY KEY,
  "type"       text NOT NULL,
  "severity"   text NOT NULL,
  "fact_ids"   text[] NOT NULL DEFAULT '{}',
  "suggestion" text NOT NULL DEFAULT '',
  "reason"     text NOT NULL DEFAULT '',
  "status"     text NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_consolidation_items_status"
  ON "memory_consolidation_items"("status");

CREATE INDEX IF NOT EXISTS "idx_consolidation_items_type"
  ON "memory_consolidation_items"("type");
