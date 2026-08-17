ALTER TABLE omr_jobs
  ADD COLUMN IF NOT EXISTS ip_owner_hash text,
  ADD COLUMN IF NOT EXISTS public_handle_replay_envelope jsonb,
  ADD COLUMN IF NOT EXISTS handle_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS rights_json jsonb,
  ADD COLUMN IF NOT EXISTS provider_transfer_consent boolean,
  ADD COLUMN IF NOT EXISTS provider_consent_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS capability_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS vendor_create_idempotency_key text,
  ADD COLUMN IF NOT EXISTS vendor_create_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS credit_estimate integer,
  ADD COLUMN IF NOT EXISTS credit_state text,
  ADD COLUMN IF NOT EXISTS progress_bp integer,
  ADD COLUMN IF NOT EXISTS current_input_request jsonb,
  ADD COLUMN IF NOT EXISTS accepted_input jsonb,
  ADD COLUMN IF NOT EXISTS result_object_reference_id bigint REFERENCES object_references(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS vendor_result_digest text,
  ADD COLUMN IF NOT EXISTS evidence_bundle jsonb,
  ADD COLUMN IF NOT EXISTS retention_info jsonb,
  ADD COLUMN IF NOT EXISTS vendor_delete_result jsonb,
  ADD COLUMN IF NOT EXISTS public_failure_code text,
  ADD COLUMN IF NOT EXISTS public_failure_message_ko text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_state_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_state_check CHECK (state IN ('created','uploading','queued','processing','needs-input','completed','failed','cancelled','delete-pending','deleted','expired'));
ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_source_kind_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_source_kind_check CHECK (source_kind IS NULL OR source_kind IN ('digital-pdf','scanned-pdf','camera-photo'));
ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_page_count_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_page_count_check CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 12);
ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_credit_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_credit_check CHECK (
  (credit_estimate IS NULL AND credit_state IS NULL)
  OR (credit_estimate > 0 AND credit_state IN ('reserved','settled','released'))
);
ALTER TABLE omr_jobs DROP CONSTRAINT IF EXISTS omr_jobs_progress_check;
ALTER TABLE omr_jobs ADD CONSTRAINT omr_jobs_progress_check CHECK (progress_bp IS NULL OR progress_bp BETWEEN 0 AND 10000);

CREATE INDEX IF NOT EXISTS omr_jobs_handle_owner_idx ON omr_jobs (public_handle_hash, owner_session_id) WHERE handle_active;
CREATE INDEX IF NOT EXISTS omr_jobs_state_cleanup_idx ON omr_jobs (state, expires_at, id);
CREATE INDEX IF NOT EXISTS omr_jobs_ip_created_idx ON omr_jobs (ip_owner_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS omr_jobs_credit_day_idx ON omr_jobs (created_at, credit_state);

CREATE TABLE IF NOT EXISTS omr_create_idempotency (
  owner_session_id bigint NOT NULL REFERENCES anonymous_sessions(id) ON DELETE RESTRICT,
  key_hash text NOT NULL,
  request_digest text NOT NULL,
  job_id bigint NOT NULL UNIQUE REFERENCES omr_jobs(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('pending','complete')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_session_id, key_hash)
);
CREATE INDEX IF NOT EXISTS omr_create_idempotency_job_idx ON omr_create_idempotency (job_id);

ALTER TABLE omr_pages
  ADD COLUMN IF NOT EXISTS page_digest text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS upload_idempotency_key_hash text,
  ADD COLUMN IF NOT EXISTS width_pixels integer,
  ADD COLUMN IF NOT EXISTS height_pixels integer,
  ADD COLUMN IF NOT EXISTS quality_report jsonb,
  ADD COLUMN IF NOT EXISTS warn_acknowledged boolean,
  ADD COLUMN IF NOT EXISTS duplicate_confirmed boolean,
  ADD COLUMN IF NOT EXISTS upload_state text,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_object_reference_id bigint REFERENCES object_references(id) ON DELETE RESTRICT;

ALTER TABLE omr_pages DROP CONSTRAINT IF EXISTS omr_pages_dimensions_check;
ALTER TABLE omr_pages ADD CONSTRAINT omr_pages_dimensions_check CHECK (
  (width_pixels IS NULL AND height_pixels IS NULL)
  OR (width_pixels > 0 AND height_pixels > 0)
);
ALTER TABLE omr_pages DROP CONSTRAINT IF EXISTS omr_pages_upload_state_check;
ALTER TABLE omr_pages ADD CONSTRAINT omr_pages_upload_state_check CHECK (upload_state IS NULL OR upload_state IN ('pending','uploaded','failed'));
ALTER TABLE omr_pages DROP CONSTRAINT IF EXISTS omr_pages_retry_count_check;
ALTER TABLE omr_pages ADD CONSTRAINT omr_pages_retry_count_check CHECK (retry_count BETWEEN 0 AND 2);
CREATE INDEX IF NOT EXISTS omr_pages_upload_idx ON omr_pages (job_id, upload_state, page_ordinal);

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS omr_job_id bigint REFERENCES omr_jobs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS audit_events_omr_job_idx ON audit_events (omr_job_id, created_at DESC);
