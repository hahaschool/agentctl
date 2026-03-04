-- 0007: Add multi-account tables and columns
CREATE TABLE IF NOT EXISTS "api_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "provider" text NOT NULL,
  "credential" text NOT NULL,
  "credential_iv" text NOT NULL,
  "priority" integer NOT NULL DEFAULT 0,
  "rate_limit" jsonb DEFAULT '{}',
  "is_active" boolean DEFAULT true,
  "metadata" jsonb DEFAULT '{}',
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "project_account_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_path" text NOT NULL UNIQUE,
  "account_id" uuid NOT NULL REFERENCES "api_accounts"("id") ON DELETE CASCADE,
  "created_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "settings" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now()
);

-- Add account_id to agents
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE "agents" ADD COLUMN "account_id" uuid REFERENCES "api_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Add account_id to rc_sessions
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rc_sessions' AND column_name = 'account_id'
  ) THEN
    ALTER TABLE "rc_sessions" ADD COLUMN "account_id" uuid REFERENCES "api_accounts"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_api_accounts_provider" ON "api_accounts"("provider");
CREATE INDEX IF NOT EXISTS "idx_api_accounts_is_active" ON "api_accounts"("is_active");
CREATE INDEX IF NOT EXISTS "idx_project_account_mappings_account_id" ON "project_account_mappings"("account_id");
