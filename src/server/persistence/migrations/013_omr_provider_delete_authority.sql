CREATE TABLE IF NOT EXISTS omr_provider_delete_operations (
  job_id bigint PRIMARY KEY REFERENCES omr_jobs(id) ON DELETE RESTRICT,
  operation_id text NOT NULL UNIQUE,
  operation_generation bigint NOT NULL CHECK (operation_generation > 0),
  provider_binding_id text NOT NULL,
  adapter_contract_version text NOT NULL,
  vendor_id text NOT NULL,
  vendor_job_id_envelope jsonb NOT NULL,
  idempotency_key text NOT NULL,
  supports_deletion boolean NOT NULL,
  supports_idempotency boolean NOT NULL,
  dispatch_outcome text NOT NULL CHECK (dispatch_outcome IN (
    'not-dispatched','outcome-uncertain','acknowledged-deleted',
    'acknowledged-not-supported','acknowledged-failed'
  )),
  result_json jsonb,
  claim_token text,
  claim_lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  reconciliation_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (job_id, operation_generation),
  CHECK ((claim_token IS NULL) = (claim_lease_expires_at IS NULL)),
  CHECK (NOT reconciliation_required OR dispatch_outcome = 'outcome-uncertain'),
  CHECK (dispatch_outcome NOT IN ('acknowledged-deleted','acknowledged-not-supported')
    OR (result_json IS NOT NULL AND next_attempt_at IS NULL AND NOT reconciliation_required))
);

CREATE INDEX IF NOT EXISTS omr_provider_delete_operations_due_idx
  ON omr_provider_delete_operations (next_attempt_at, claim_lease_expires_at, job_id)
  WHERE dispatch_outcome NOT IN ('acknowledged-deleted','acknowledged-not-supported');
