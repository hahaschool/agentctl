-- AgentCTL Migration: Persist execution environment selection on managed sessions

ALTER TABLE "managed_sessions"
ADD COLUMN IF NOT EXISTS "execution_environment" text;
