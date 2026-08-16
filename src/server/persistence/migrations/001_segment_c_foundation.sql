CREATE TABLE IF NOT EXISTS anonymous_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  csrf_nonce text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS anonymous_sessions_expiry_idx ON anonymous_sessions (expires_at, id);

CREATE TABLE IF NOT EXISTS quota_windows (
  owner_kind text NOT NULL CHECK (owner_kind IN ('session','ip-hmac')),
  owner_hash text NOT NULL,
  policy_key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  used_count integer NOT NULL CHECK (used_count >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner_kind, owner_hash, policy_key, window_started_at)
);
CREATE INDEX IF NOT EXISTS quota_windows_expiry_idx ON quota_windows (expires_at, owner_hash);

CREATE TABLE IF NOT EXISTS quota_leases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES anonymous_sessions(id) ON DELETE CASCADE,
  policy_key text NOT NULL,
  lease_key text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  UNIQUE (session_id, policy_key, lease_key)
);
CREATE INDEX IF NOT EXISTS quota_leases_active_idx ON quota_leases (session_id, policy_key, expires_at) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS idempotency_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES anonymous_sessions(id) ON DELETE CASCADE,
  operation text NOT NULL,
  key_hash text NOT NULL,
  request_digest text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','complete')),
  response_json jsonb,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (session_id, operation, key_hash)
);
CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON idempotency_records (expires_at, id);

CREATE TABLE IF NOT EXISTS share_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_session_id bigint NOT NULL REFERENCES anonymous_sessions(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  delete_secret_verifier text NOT NULL,
  payload_digest text NOT NULL,
  encrypted_payload jsonb NOT NULL,
  plaintext_size integer NOT NULL CHECK (plaintext_size > 0),
  rights_basis text NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('active','disabled','deleted','expired')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  disabled_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS share_records_owner_idx ON share_records (owner_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS share_records_expiry_idx ON share_records (lifecycle, expires_at, id);

CREATE TABLE IF NOT EXISTS abuse_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reporter_session_id bigint REFERENCES anonymous_sessions(id) ON DELETE SET NULL,
  share_record_id bigint REFERENCES share_records(id) ON DELETE SET NULL,
  opaque_reference_hash text NOT NULL,
  category text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS abuse_reports_created_idx ON abuse_reports (created_at, id);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_kind text NOT NULL,
  share_record_id bigint REFERENCES share_records(id) ON DELETE SET NULL,
  object_reference_id bigint,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events (created_at, id);

CREATE TABLE IF NOT EXISTS object_references (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_session_id bigint NOT NULL REFERENCES anonymous_sessions(id) ON DELETE RESTRICT,
  object_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  binary_digest text NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('active','delete-pending','deleted','expired')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  deleted_at timestamptz
);
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_object_reference_fk;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_object_reference_fk FOREIGN KEY (object_reference_id) REFERENCES object_references(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS object_references_owner_idx ON object_references (owner_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS object_references_cleanup_idx ON object_references (lifecycle, expires_at, id);

CREATE TABLE IF NOT EXISTS omr_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_session_id bigint NOT NULL REFERENCES anonymous_sessions(id) ON DELETE RESTRICT,
  public_handle_hash text NOT NULL UNIQUE,
  vendor_job_id_envelope jsonb,
  state text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS omr_jobs_owner_idx ON omr_jobs (owner_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS omr_jobs_expiry_idx ON omr_jobs (expires_at, id);

CREATE TABLE IF NOT EXISTS omr_pages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES omr_jobs(id) ON DELETE CASCADE,
  page_ordinal integer NOT NULL CHECK (page_ordinal >= 0),
  source_object_reference_id bigint REFERENCES object_references(id) ON DELETE RESTRICT,
  UNIQUE (job_id, page_ordinal)
);

CREATE TABLE IF NOT EXISTS omr_evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  page_id bigint NOT NULL REFERENCES omr_pages(id) ON DELETE CASCADE,
  evidence_ordinal integer NOT NULL CHECK (evidence_ordinal >= 0),
  payload jsonb NOT NULL,
  UNIQUE (page_id, evidence_ordinal)
);

CREATE TABLE IF NOT EXISTS omr_review_metadata (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES omr_jobs(id) ON DELETE CASCADE,
  revision_ordinal integer NOT NULL CHECK (revision_ordinal >= 0),
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (job_id, revision_ordinal)
);
