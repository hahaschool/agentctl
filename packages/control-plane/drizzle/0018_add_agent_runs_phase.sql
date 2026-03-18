ALTER TABLE "agent_runs" ADD COLUMN IF NOT EXISTS "phase" text;

UPDATE "agent_runs"
SET
  "phase" = CASE
    WHEN "status" = 'success' THEN 'completed'
    WHEN "status" IN ('failure', 'error', 'timeout', 'cancelled') THEN 'failed'
    WHEN "status" = 'empty' THEN 'empty'
    WHEN "status" = 'running' THEN 'running'
    ELSE 'queued'
  END
WHERE
  "phase" IS NULL;

ALTER TABLE "agent_runs" ALTER COLUMN "phase" SET DEFAULT 'queued';
ALTER TABLE "agent_runs" ALTER COLUMN "phase" SET NOT NULL;
