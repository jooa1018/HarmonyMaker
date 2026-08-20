ALTER TABLE omr_jobs
  ADD COLUMN IF NOT EXISTS cleanup_last_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS omr_jobs_cleanup_fairness_idx
  ON omr_jobs (cleanup_last_attempt_at NULLS FIRST, expires_at, id)
  WHERE state <> 'deleted';
