ALTER TABLE abuse_reports
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS claim_token text,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS resolution text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE abuse_reports SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE abuse_reports ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE abuse_reports DROP CONSTRAINT IF EXISTS abuse_reports_status_check;
ALTER TABLE abuse_reports ADD CONSTRAINT abuse_reports_status_check CHECK (status IN ('pending','claimed','resolved'));
ALTER TABLE abuse_reports DROP CONSTRAINT IF EXISTS abuse_reports_moderation_state_check;
ALTER TABLE abuse_reports ADD CONSTRAINT abuse_reports_moderation_state_check CHECK (
  (status = 'pending' AND claim_token IS NULL AND claim_expires_at IS NULL AND claimed_by IS NULL AND resolution IS NULL AND resolved_at IS NULL)
  OR (status = 'claimed' AND claim_token IS NOT NULL AND claim_expires_at IS NOT NULL AND claimed_by IS NOT NULL AND resolution IS NULL AND resolved_at IS NULL)
  OR (status = 'resolved' AND claim_token IS NULL AND claim_expires_at IS NULL AND claimed_by IS NOT NULL AND resolution IN ('dismissed','takedown') AND resolved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS abuse_reports_moderation_queue_idx ON abuse_reports (status, created_at, id);
CREATE INDEX IF NOT EXISTS abuse_reports_claim_expiry_idx ON abuse_reports (claim_expires_at, id) WHERE status = 'claimed';

ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS abuse_report_id bigint REFERENCES abuse_reports(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS audit_events_abuse_report_idx ON audit_events (abuse_report_id, created_at, id) WHERE abuse_report_id IS NOT NULL;
