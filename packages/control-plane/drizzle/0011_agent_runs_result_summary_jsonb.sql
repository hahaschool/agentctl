ALTER TABLE agent_runs
  ALTER COLUMN result_summary TYPE JSONB
  USING CASE
    WHEN result_summary IS NULL THEN NULL
    ELSE to_jsonb(result_summary)
  END;
