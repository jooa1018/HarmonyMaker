ALTER TABLE idempotency_records
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;

UPDATE idempotency_records
SET claim_expires_at = created_at + interval '5 minutes'
WHERE claim_expires_at IS NULL;

ALTER TABLE idempotency_records
  ALTER COLUMN claim_expires_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idempotency_pending_recovery_idx
  ON idempotency_records (claim_expires_at, id)
  WHERE state = 'pending';
