CREATE TABLE memory_entities (
  id text PRIMARY KEY,
  entity_type text NOT NULL,
  canonical_name text NOT NULL,
  normalized_canonical_name text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_entities_type_normalized_name
  ON memory_entities(entity_type, normalized_canonical_name);

CREATE INDEX idx_memory_entities_created_at
  ON memory_entities(created_at);

CREATE TABLE memory_entity_aliases (
  id text PRIMARY KEY,
  canonical_id text NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX memory_entity_aliases_canonical_unique
  ON memory_entity_aliases(canonical_id, normalized_alias);

CREATE INDEX idx_memory_entity_aliases_normalized_alias
  ON memory_entity_aliases(normalized_alias, canonical_id);
