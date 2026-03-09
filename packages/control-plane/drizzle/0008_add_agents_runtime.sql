-- Add runtime column to agents table (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'runtime'
  ) THEN
    ALTER TABLE "agents" ADD COLUMN "runtime" text DEFAULT 'claude-code';
  END IF;
END $$;
