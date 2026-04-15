-- Machine provenance for mesh-synced fleet rows.
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "origin_node_id" text;
CREATE INDEX IF NOT EXISTS "idx_machines_origin_node_id" ON "machines" ("origin_node_id");
