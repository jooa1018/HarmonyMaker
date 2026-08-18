ALTER TABLE omr_jobs
  ADD COLUMN IF NOT EXISTS provider_binding_id text,
  ADD COLUMN IF NOT EXISTS adapter_contract_version text,
  ADD COLUMN IF NOT EXISTS retry_kind text,
  ADD COLUMN IF NOT EXISTS retry_attempt integer,
  ADD COLUMN IF NOT EXISTS retry_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_last_failure_code text;

UPDATE omr_jobs
SET provider_binding_id = COALESCE(provider_binding_id, capability_snapshot->>'vendorId'),
    adapter_contract_version = COALESCE(adapter_contract_version, 'omr-vendor-adapter-v1')
WHERE provider_binding_id IS NULL OR adapter_contract_version IS NULL;

ALTER TABLE omr_jobs ALTER COLUMN provider_binding_id SET NOT NULL;
ALTER TABLE omr_jobs ALTER COLUMN adapter_contract_version SET NOT NULL;

ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_state_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_state_check CHECK (state IN (
  'created','uploading','queued','processing','needs-input','sync-retry-pending','capture-retry-pending',
  'completed','failed','cancel-pending','cancel-failed','cancelled','reconciliation-required',
  'delete-pending','deleted','expired'
));
ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_reconciliation_kind_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_reconciliation_kind_check CHECK (reconciliation_kind IS NULL OR reconciliation_kind IN ('create','page-upload','start','submit-input','cancel','sync','capture'));
ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_retry_metadata_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_retry_metadata_check CHECK (
  (retry_kind IS NULL AND retry_attempt IS NULL AND retry_next_attempt_at IS NULL AND retry_last_failure_code IS NULL)
  OR (retry_kind IN ('sync','capture') AND retry_attempt BETWEEN 1 AND 5 AND retry_next_attempt_at IS NOT NULL AND retry_last_failure_code IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS omr_jobs_retry_due_idx ON omr_jobs (retry_next_attempt_at, id) WHERE state IN ('sync-retry-pending','capture-retry-pending');
