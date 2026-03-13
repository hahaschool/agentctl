-- AgentCTL Migration: Promotion history table for deployment page
-- Tracks tier-to-tier promotion records with preflight check results

CREATE TABLE IF NOT EXISTS "promotion_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_tier" text NOT NULL,
  "target_tier" text NOT NULL DEFAULT 'beta',
  "status" text NOT NULL DEFAULT 'pending',
  "checks" jsonb DEFAULT '[]'::jsonb,
  "error" text,
  "git_sha" text,
  "started_at" timestamptz DEFAULT now(),
  "completed_at" timestamptz,
  "duration_ms" integer,
  "triggered_by" text NOT NULL DEFAULT 'web'
);
