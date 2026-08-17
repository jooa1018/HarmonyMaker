import "server-only";

import { createHash } from "node:crypto";
import type { Pool } from "pg";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const SEGMENT_C_FOUNDATION_SQL = String.raw`
CREATE TABLE IF NOT EXISTS anonymous_sessions (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, token_hash text NOT NULL UNIQUE, csrf_nonce text NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz, CHECK (expires_at > created_at));
CREATE INDEX IF NOT EXISTS anonymous_sessions_expiry_idx ON anonymous_sessions (expires_at, id);
CREATE TABLE IF NOT EXISTS quota_windows (owner_kind text NOT NULL CHECK (owner_kind IN ('session','ip-hmac')), owner_hash text NOT NULL, policy_key text NOT NULL, window_started_at timestamptz NOT NULL, used_count integer NOT NULL CHECK (used_count >= 0), expires_at timestamptz NOT NULL, PRIMARY KEY (owner_kind, owner_hash, policy_key, window_started_at));
CREATE INDEX IF NOT EXISTS quota_windows_expiry_idx ON quota_windows (expires_at, owner_hash);
CREATE TABLE IF NOT EXISTS quota_leases (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, session_id bigint NOT NULL REFERENCES anonymous_sessions(id) ON DELETE CASCADE, policy_key text NOT NULL, lease_key text NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, released_at timestamptz, UNIQUE (session_id, policy_key, lease_key));
CREATE INDEX IF NOT EXISTS quota_leases_active_idx ON quota_leases (session_id, policy_key, expires_at) WHERE released_at IS NULL;
CREATE TABLE IF NOT EXISTS idempotency_records (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, session_id bigint NOT NULL REFERENCES anonymous_sessions(id) ON DELETE CASCADE, operation text NOT NULL, key_hash text NOT NULL, request_digest text NOT NULL, state text NOT NULL CHECK (state IN ('pending','complete')), response_json jsonb, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, UNIQUE (session_id, operation, key_hash));
CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON idempotency_records (expires_at, id);
CREATE TABLE IF NOT EXISTS share_records (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, owner_session_id bigint NOT NULL REFERENCES anonymous_sessions(id) ON DELETE RESTRICT, token_hash text NOT NULL UNIQUE, delete_secret_verifier text NOT NULL, payload_digest text NOT NULL, encrypted_payload jsonb NOT NULL, plaintext_size integer NOT NULL CHECK (plaintext_size > 0), rights_basis text NOT NULL, lifecycle text NOT NULL CHECK (lifecycle IN ('active','disabled','deleted','expired')), created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, disabled_at timestamptz, deleted_at timestamptz);
CREATE INDEX IF NOT EXISTS share_records_owner_idx ON share_records (owner_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS share_records_expiry_idx ON share_records (lifecycle, expires_at, id);
CREATE TABLE IF NOT EXISTS abuse_reports (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, reporter_session_id bigint REFERENCES anonymous_sessions(id) ON DELETE SET NULL, share_record_id bigint REFERENCES share_records(id) ON DELETE SET NULL, opaque_reference_hash text NOT NULL, category text NOT NULL, detail text, created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS abuse_reports_created_idx ON abuse_reports (created_at, id);
CREATE TABLE IF NOT EXISTS object_references (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, owner_session_id bigint NOT NULL REFERENCES anonymous_sessions(id) ON DELETE RESTRICT, object_key text NOT NULL UNIQUE, content_type text NOT NULL, byte_size bigint NOT NULL CHECK (byte_size >= 0), binary_digest text NOT NULL, lifecycle text NOT NULL CHECK (lifecycle IN ('active','delete-pending','deleted','expired')), created_at timestamptz NOT NULL, expires_at timestamptz, deleted_at timestamptz);
CREATE INDEX IF NOT EXISTS object_references_owner_idx ON object_references (owner_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS object_references_cleanup_idx ON object_references (lifecycle, expires_at, id);
CREATE TABLE IF NOT EXISTS audit_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, event_kind text NOT NULL, share_record_id bigint REFERENCES share_records(id) ON DELETE SET NULL, object_reference_id bigint REFERENCES object_references(id) ON DELETE SET NULL, outcome text NOT NULL, created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events (created_at, id);
CREATE TABLE IF NOT EXISTS omr_jobs (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, owner_session_id bigint NOT NULL REFERENCES anonymous_sessions(id) ON DELETE RESTRICT, public_handle_hash text NOT NULL UNIQUE, vendor_job_id_envelope jsonb, state text NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS omr_jobs_owner_idx ON omr_jobs (owner_session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS omr_jobs_expiry_idx ON omr_jobs (expires_at, id);
CREATE TABLE IF NOT EXISTS omr_pages (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job_id bigint NOT NULL REFERENCES omr_jobs(id) ON DELETE CASCADE, page_ordinal integer NOT NULL CHECK (page_ordinal >= 0), source_object_reference_id bigint REFERENCES object_references(id) ON DELETE RESTRICT, UNIQUE (job_id, page_ordinal));
CREATE TABLE IF NOT EXISTS omr_evidence (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, page_id bigint NOT NULL REFERENCES omr_pages(id) ON DELETE CASCADE, evidence_ordinal integer NOT NULL CHECK (evidence_ordinal >= 0), payload jsonb NOT NULL, UNIQUE (page_id, evidence_ordinal));
CREATE TABLE IF NOT EXISTS omr_review_metadata (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job_id bigint NOT NULL REFERENCES omr_jobs(id) ON DELETE CASCADE, revision_ordinal integer NOT NULL CHECK (revision_ordinal >= 0), metadata jsonb NOT NULL, created_at timestamptz NOT NULL, UNIQUE (job_id, revision_ordinal));
`;

export const IDEMPOTENCY_RECOVERY_SQL = String.raw`
ALTER TABLE idempotency_records ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;
UPDATE idempotency_records SET claim_expires_at = created_at + interval '5 minutes' WHERE claim_expires_at IS NULL;
ALTER TABLE idempotency_records ALTER COLUMN claim_expires_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS idempotency_pending_recovery_idx ON idempotency_records (claim_expires_at, id) WHERE state = 'pending';
`;

export const SHARE_REPLAY_ENVELOPE_SQL = String.raw`
DELETE FROM idempotency_records WHERE operation = 'share-create-v1';
ALTER TABLE idempotency_records DROP CONSTRAINT IF EXISTS idempotency_share_replay_envelope;
ALTER TABLE idempotency_records ADD CONSTRAINT idempotency_share_replay_envelope CHECK (
  operation <> 'share-create-v1' OR state <> 'complete' OR (
    response_json->>'version' = '1'
    AND response_json->>'algorithm' = 'aes-256-gcm'
    AND response_json->>'associatedDataVersion' = 'share-create-replay-v1'
    AND response_json ? 'nonce'
    AND response_json ? 'ciphertext'
    AND response_json ? 'authenticationTag'
  )
);
`;


export const OMR_CORE_SQL = String.raw`
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
`;

export const OMR_RECOVERY_SQL = String.raw`
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
`;

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  { version: 1, name: "segment_c_foundation", sql: SEGMENT_C_FOUNDATION_SQL },
  { version: 2, name: "idempotency_recovery", sql: IDEMPOTENCY_RECOVERY_SQL },
  { version: 3, name: "share_replay_envelope", sql: SHARE_REPLAY_ENVELOPE_SQL },
  { version: 4, name: "omr_core", sql: OMR_CORE_SQL },
  { version: 5, name: "omr_recovery", sql: OMR_RECOVERY_SQL },
]);

export function migrationChecksum(migration: Migration): string {
  return createHash("sha256").update(migration.sql, "utf8").digest("hex");
}

export function validateMigrationInventory(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1 || !/^[a-z][a-z0-9_]*$/u.test(migration.name) || !migration.sql.trim()) {
      throw new RangeError("MIGRATION_INVENTORY_INVALID");
    }
  });
}

export interface MigrationClient {
  query(text: string, values?: unknown[]): Promise<{ readonly rows: Record<string, unknown>[]; readonly rowCount: number | null }>;
}

export async function applyMigrationsWithClient(
  client: MigrationClient,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<readonly number[]> {
  validateMigrationInventory(migrations);
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(1214349645)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL UNIQUE, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = await client.query("SELECT version, name, checksum FROM schema_migrations ORDER BY version");
    if (applied.rows.length > migrations.length) throw new RangeError("MIGRATION_HISTORY_DIVERGED");
    for (let index = 0; index < applied.rows.length; index += 1) {
      const expected = migrations[index];
      const row = applied.rows[index];
      if (row.version !== expected.version || row.name !== expected.name || row.checksum !== migrationChecksum(expected)) {
        throw new RangeError("MIGRATION_HISTORY_DIVERGED");
      }
    }
    const installed: number[] = [];
    for (const migration of migrations.slice(applied.rows.length)) {
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
        [migration.version, migration.name, migrationChecksum(migration)],
      );
      installed.push(migration.version);
    }
    await client.query("COMMIT");
    return installed;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function applyMigrations(pool: Pool): Promise<readonly number[]> {
  const client = await pool.connect();
  try {
    return await applyMigrationsWithClient(client);
  } finally {
    client.release();
  }
}
