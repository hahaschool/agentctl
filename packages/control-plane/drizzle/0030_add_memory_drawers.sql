CREATE TABLE memory_drawers (
  id text PRIMARY KEY,
  scope text NOT NULL REFERENCES memory_scopes(scope) ON DELETE CASCADE,
  topic text NOT NULL DEFAULT 'general',
  source_type text NOT NULL CHECK (
    source_type IN (
      'session-jsonl',
      'runtime-checkpoint',
      'claude-mem-observation',
      'claude-mem-session-summary',
      'manual',
      'document',
      'diary'
    )
  ),
  source_id text NOT NULL,
  source_uri text,
  chunk_index integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  content_sha256 text NOT NULL,
  embedding vector(1536),
  embedding_model text NOT NULL DEFAULT 'text-embedding-3-small',
  embedding_version integer NOT NULL DEFAULT 1,
  content_tsv_simple tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  token_count integer NOT NULL DEFAULT 0,
  source_json jsonb NOT NULL DEFAULT '{}',
  sync_visibility text NOT NULL DEFAULT 'local' CHECK (
    sync_visibility IN ('local', 'project', 'global')
  ),
  retention_expires_at timestamptz,
  archived_at timestamptz,
  redaction_status text NOT NULL DEFAULT 'unreviewed' CHECK (
    redaction_status IN ('unreviewed', 'sanitized', 'quarantined', 'approved')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, chunk_index)
);

CREATE INDEX idx_memory_drawers_embedding
  ON memory_drawers USING hnsw (embedding vector_cosine_ops)
  WITH (m = 32, ef_construction = 256);

CREATE INDEX idx_memory_drawers_content_tsv_simple
  ON memory_drawers USING gin (content_tsv_simple);

CREATE INDEX idx_memory_drawers_scope_topic
  ON memory_drawers(scope, topic);

CREATE INDEX idx_memory_drawers_source
  ON memory_drawers(source_type, source_id, chunk_index);

CREATE INDEX idx_memory_drawers_content_sha256
  ON memory_drawers(content_sha256);

CREATE INDEX idx_memory_drawers_retention
  ON memory_drawers(retention_expires_at)
  WHERE retention_expires_at IS NOT NULL AND archived_at IS NULL;
