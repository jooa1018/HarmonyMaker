ALTER TABLE omr_jobs
  ADD COLUMN IF NOT EXISTS capability_snapshot_digest text,
  ADD COLUMN IF NOT EXISTS operation_kind text,
  ADD COLUMN IF NOT EXISTS operation_lease_token text,
  ADD COLUMN IF NOT EXISTS operation_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_kind text,
  ADD COLUMN IF NOT EXISTS normalization_mapping jsonb,
  ADD COLUMN IF NOT EXISTS vendor_delete_state text NOT NULL DEFAULT 'not-started',
  ADD COLUMN IF NOT EXISTS local_delete_state text NOT NULL DEFAULT 'not-started',
  ADD COLUMN IF NOT EXISTS vendor_delete_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS local_delete_next_attempt_at timestamptz;

ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_state_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_state_check CHECK (state IN (
  'created','uploading','queued','processing','needs-input','completed','failed',
  'cancel-pending','cancel-failed','cancelled','reconciliation-required',
  'delete-pending','deleted','expired'
));
ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_operation_kind_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_operation_kind_check CHECK (operation_kind IS NULL OR operation_kind IN ('start','submit-input','cancel'));
ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_reconciliation_kind_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_reconciliation_kind_check CHECK (reconciliation_kind IS NULL OR reconciliation_kind IN ('create','page-upload','start','submit-input','cancel'));
ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_vendor_delete_state_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_vendor_delete_state_check CHECK (vendor_delete_state IN ('not-started','pending','deleted','not-supported','failed'));
ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_local_delete_state_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_local_delete_state_check CHECK (local_delete_state IN ('not-started','pending','deleted','failed'));
CREATE INDEX IF NOT EXISTS omr_jobs_operation_lease_idx ON omr_jobs (operation_lease_expires_at, id) WHERE operation_kind IS NOT NULL;
CREATE INDEX IF NOT EXISTS omr_jobs_delete_retry_idx ON omr_jobs (state, vendor_delete_next_attempt_at, local_delete_next_attempt_at, id) WHERE state = 'delete-pending';

ALTER TABLE omr_pages
  ADD COLUMN IF NOT EXISTS upload_lease_token text,
  ADD COLUMN IF NOT EXISTS upload_lease_expires_at timestamptz;
ALTER TABLE omr_pages DROP CONSTRAINT IF EXISTS omr_pages_upload_state_check;
ALTER TABLE omr_pages ADD CONSTRAINT omr_pages_upload_state_check CHECK (upload_state IS NULL OR upload_state IN ('pending','uploaded','failed','reconciliation-required'));
CREATE INDEX IF NOT EXISTS omr_pages_pending_lease_idx ON omr_pages (upload_lease_expires_at, job_id, page_ordinal) WHERE upload_state = 'pending';
