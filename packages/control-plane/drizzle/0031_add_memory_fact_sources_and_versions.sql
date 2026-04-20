ALTER TABLE memory_facts
  ADD COLUMN embedding_version integer NOT NULL DEFAULT 1;

ALTER TABLE memory_edges
  ADD COLUMN embedding_version integer NOT NULL DEFAULT 1;

CREATE TABLE memory_fact_sources (
  id text PRIMARY KEY,
  fact_id text NOT NULL REFERENCES memory_facts(id) ON DELETE CASCADE,
  drawer_id text NOT NULL REFERENCES memory_drawers(id) ON DELETE CASCADE,
  start_offset integer NOT NULL CHECK (start_offset >= 0),
  end_offset integer NOT NULL CHECK (end_offset >= start_offset),
  source_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fact_id, drawer_id, start_offset, end_offset)
);

CREATE INDEX idx_memory_fact_sources_fact
  ON memory_fact_sources(fact_id);

CREATE INDEX idx_memory_fact_sources_drawer
  ON memory_fact_sources(drawer_id);
