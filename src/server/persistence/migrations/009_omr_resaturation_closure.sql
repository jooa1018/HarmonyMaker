ALTER TABLE omr_jobs
  ADD COLUMN IF NOT EXISTS status_observation_lease_token text,
  ADD COLUMN IF NOT EXISTS status_observation_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_input_digest text;

ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_status_observation_lease_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_status_observation_lease_check CHECK (
  (status_observation_lease_token IS NULL) = (status_observation_lease_expires_at IS NULL)
);

CREATE INDEX IF NOT EXISTS omr_jobs_status_observation_lease_idx
  ON omr_jobs (status_observation_lease_expires_at, id)
  WHERE status_observation_lease_token IS NOT NULL;

ALTER TABLE object_references
  ADD COLUMN IF NOT EXISTS publication_token text,
  ADD COLUMN IF NOT EXISTS publication_lease_expires_at timestamptz;

ALTER TABLE object_references DROP CONSTRAINT IF EXISTS object_references_lifecycle_check;
ALTER TABLE object_references ADD CONSTRAINT object_references_lifecycle_check CHECK (
  lifecycle IN ('upload-pending','active','delete-pending','deleted','expired')
);
ALTER TABLE object_references DROP CONSTRAINT IF EXISTS object_references_publication_check;
ALTER TABLE object_references ADD CONSTRAINT object_references_publication_check CHECK (
  lifecycle <> 'upload-pending'
  OR (publication_token IS NOT NULL AND publication_lease_expires_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS object_references_publication_cleanup_idx
  ON object_references (publication_lease_expires_at, id)
  WHERE lifecycle = 'upload-pending';

ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_credit_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_credit_check CHECK (
  (credit_estimate IS NULL AND credit_state IS NULL)
  OR (credit_estimate BETWEEN 1 AND 2147483647 AND credit_state IN ('reserved','settled','released'))
);
