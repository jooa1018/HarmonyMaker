ALTER TABLE omr_jobs
  ADD COLUMN IF NOT EXISTS canonical_create_request jsonb,
  ADD COLUMN IF NOT EXISTS operation_request_digest text,
  ADD COLUMN IF NOT EXISTS result_capture_lease_token text,
  ADD COLUMN IF NOT EXISTS result_capture_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleanup_lease_token text,
  ADD COLUMN IF NOT EXISTS cleanup_lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS omr_jobs_result_capture_lease_idx
  ON omr_jobs (result_capture_lease_expires_at, id)
  WHERE result_capture_lease_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS omr_jobs_cleanup_lease_idx
  ON omr_jobs (cleanup_lease_expires_at, id)
  WHERE cleanup_lease_token IS NOT NULL;

ALTER TABLE omr_create_idempotency
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS failure_message_ko text;
