-- AgentCTL Migration: Relax agent_id constraint on rc_sessions
-- Allows adhoc sessions without requiring a pre-registered agent.

DO $$ BEGIN
  ALTER TABLE "rc_sessions" DROP CONSTRAINT IF EXISTS "rc_sessions_agent_id_fkey";
  ALTER TABLE "rc_sessions" DROP CONSTRAINT IF EXISTS "rc_sessions_agent_id_agents_id_fk";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Constraint already dropped';
END $$;

ALTER TABLE "rc_sessions" ALTER COLUMN "agent_id" TYPE text USING "agent_id"::text;
