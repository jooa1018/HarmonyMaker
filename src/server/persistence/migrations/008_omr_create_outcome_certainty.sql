ALTER TABLE omr_jobs
  ADD COLUMN IF NOT EXISTS vendor_create_outcome_state text;

UPDATE omr_jobs AS jobs
SET vendor_create_outcome_state = CASE
  WHEN jobs.vendor_job_id_envelope IS NOT NULL THEN 'confirmed'
  WHEN EXISTS (
    SELECT 1 FROM omr_create_idempotency AS create_keys
    WHERE create_keys.job_id = jobs.id AND create_keys.state = 'complete' AND create_keys.failure_code IS NULL
  ) THEN 'confirmed'
  WHEN EXISTS (
    SELECT 1 FROM omr_create_idempotency AS create_keys
    WHERE create_keys.job_id = jobs.id AND create_keys.state = 'complete' AND create_keys.failure_code IS NOT NULL
  ) THEN 'definitive-no-job'
  WHEN jobs.reconciliation_kind = 'create' OR EXISTS (
    SELECT 1 FROM omr_create_idempotency AS create_keys
    WHERE create_keys.job_id = jobs.id AND create_keys.state = 'pending'
  ) THEN 'outcome-uncertain'
  ELSE 'not-attempted'
END
WHERE jobs.vendor_create_outcome_state IS NULL;

ALTER TABLE omr_jobs ALTER COLUMN vendor_create_outcome_state SET DEFAULT 'not-attempted';
ALTER TABLE omr_jobs ALTER COLUMN vendor_create_outcome_state SET NOT NULL;
ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_vendor_create_outcome_state_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_vendor_create_outcome_state_check CHECK (
  vendor_create_outcome_state IN ('not-attempted','definitive-no-job','outcome-uncertain','confirmed')
);
