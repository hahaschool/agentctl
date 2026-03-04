-- Add model column to rc_sessions table (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rc_sessions' AND column_name = 'model'
  ) THEN
    ALTER TABLE "rc_sessions" ADD COLUMN "model" text;
  END IF;
END $$;
