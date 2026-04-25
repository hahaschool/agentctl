ALTER TABLE memory_import_jobs
  ADD COLUMN cursor_json jsonb NOT NULL DEFAULT '{}';
