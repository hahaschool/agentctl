-- AgentCTL Migration: Add unified PostgreSQL-native memory layer
-- Facts + graph edges + scope hierarchy for hybrid memory retrieval

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS "memory_scopes" (
  "scope" text PRIMARY KEY,
  "parent_scope" text REFERENCES "memory_scopes"("scope"),
  "display_name" text,
  "config_json" jsonb NOT NULL DEFAULT '{}'
);

INSERT INTO "memory_scopes" ("scope", "parent_scope", "display_name")
VALUES ('global', NULL, 'Global Knowledge')
ON CONFLICT ("scope") DO NOTHING;

CREATE TABLE IF NOT EXISTS "memory_facts" (
  "id" text PRIMARY KEY,
  "scope" text NOT NULL,
  "content" text NOT NULL,
  "embedding" vector(1536),
  "content_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED,
  "content_model" text NOT NULL DEFAULT 'text-embedding-3-small',
  "entity_type" text NOT NULL,
  "confidence" real NOT NULL DEFAULT 0.8,
  "strength" real NOT NULL DEFAULT 1.0,
  "source_json" jsonb NOT NULL DEFAULT '{}',
  "valid_from" timestamptz NOT NULL DEFAULT now(),
  "valid_until" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "accessed_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_memory_facts_embedding"
  ON "memory_facts" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 256);

CREATE INDEX IF NOT EXISTS "idx_memory_facts_content_tsv"
  ON "memory_facts" USING gin ("content_tsv");

CREATE INDEX IF NOT EXISTS "idx_memory_facts_scope"
  ON "memory_facts"("scope");

CREATE INDEX IF NOT EXISTS "idx_memory_facts_entity_type"
  ON "memory_facts"("entity_type");

CREATE INDEX IF NOT EXISTS "idx_memory_facts_strength"
  ON "memory_facts"("strength")
  WHERE "strength" > 0.05;

CREATE INDEX IF NOT EXISTS "idx_memory_facts_valid"
  ON "memory_facts"("valid_until")
  WHERE "valid_until" IS NULL;

CREATE TABLE IF NOT EXISTS "memory_edges" (
  "id" text PRIMARY KEY,
  "source_fact_id" text NOT NULL REFERENCES "memory_facts"("id") ON DELETE CASCADE,
  "target_fact_id" text NOT NULL REFERENCES "memory_facts"("id") ON DELETE CASCADE,
  "relation" text NOT NULL,
  "weight" real NOT NULL DEFAULT 0.5,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("source_fact_id", "target_fact_id", "relation")
);

CREATE INDEX IF NOT EXISTS "idx_memory_edges_source"
  ON "memory_edges"("source_fact_id");

CREATE INDEX IF NOT EXISTS "idx_memory_edges_target"
  ON "memory_edges"("target_fact_id");
