CREATE TABLE memory_import_jobs (
  id text PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('claude-mem', 'jsonl-history')),
  source_path text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted', 'rolled_back')
  ),
  progress_current integer NOT NULL DEFAULT 0,
  progress_total integer NOT NULL DEFAULT 0,
  imported integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  rolled_back integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_import_jobs_status_updated
  ON memory_import_jobs(status, updated_at DESC);

CREATE INDEX idx_memory_import_jobs_source_updated
  ON memory_import_jobs(source, updated_at DESC);

CREATE UNIQUE INDEX memory_import_jobs_one_running
  ON memory_import_jobs(status)
  WHERE status = 'running';
