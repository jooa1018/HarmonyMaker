import "server-only";

import type { Pool, PoolClient } from "pg";
import { MAX_OMR_CREDIT_ESTIMATE, MAX_OMR_DAILY_CREDIT_CEILING } from "../../domain/omr/contracts";

import type { AeadEnvelopeV1 } from "../security/crypto-core";
import type { PrivateRowId } from "../persistence/store";
import type {
  OmrCreateClaim, OmrOperationClaim, OmrPageClaim, OmrStore,
  DurableOmrJobRecord, OmrDurableCompletionInspection, OmrPageCompletionExpectation,
  OmrPageRecord, OmrResultCompletionExpectation,
} from "./store";
import {
  ACTIVE_OMR_LIFECYCLE_STATES, VENDOR_CLEANUP_EXPOSURE_STATES, isCreateReplayUsable,
  isLegalOmrTransition, utcAccountingWindow,
} from "./store";

const ACTIVE_VENDOR_EXPOSURE_SQL = `(state = ANY($4::text[])
  OR vendor_create_outcome_state='outcome-uncertain'
  OR (vendor_create_outcome_state='confirmed' AND state = ANY($5::text[]) AND vendor_delete_state<>'deleted'))`;

function id(value: unknown): PrivateRowId { return String(value) as PrivateRowId; }
function iso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }
function json<T>(value: unknown): T { return (typeof value === "string" ? JSON.parse(value) : value) as T; }

function pageRow(row: Record<string, unknown>): OmrPageRecord {
  return {
    pageIndex: row.page_ordinal as number,
    pageDigest: row.page_digest as OmrPageRecord["pageDigest"],
    mimeType: row.mime_type as string,
    idempotencyKeyHash: row.upload_idempotency_key_hash as string,
    width: row.width_pixels as number,
    height: row.height_pixels as number,
    quality: json(row.quality_report),
    warnAcknowledged: row.warn_acknowledged as boolean,
    duplicateConfirmed: row.duplicate_confirmed as boolean,
    uploadState: row.upload_state as OmrPageRecord["uploadState"],
    retryCount: row.retry_count as number,
    ...(row.upload_lease_token ? { uploadLeaseToken: row.upload_lease_token as string } : {}),
    ...(row.upload_lease_expires_at ? { uploadLeaseExpiresAt: iso(row.upload_lease_expires_at) } : {}),
    ...(row.processed_object_reference_id === null || row.processed_object_reference_id === undefined ? {} : { objectReferenceId: id(row.processed_object_reference_id) }),
  };
}

function jobRow(row: Record<string, unknown>, pages: readonly OmrPageRecord[]): DurableOmrJobRecord {
  return {
    id: id(row.id), ownerSessionId: id(row.owner_session_id), ipOwnerHash: row.ip_owner_hash as string,
    publicHandleHash: row.public_handle_hash as string,
    publicHandleReplayEnvelope: json<AeadEnvelopeV1>(row.public_handle_replay_envelope),
    handleExpiresAt: iso(row.expires_at), sourceKind: row.source_kind as DurableOmrJobRecord["sourceKind"],
    pageCount: row.page_count as number, state: row.state as DurableOmrJobRecord["state"],
    canonicalCreateRequest: json(row.canonical_create_request),
    rights: json(row.rights_json), providerTransferConsent: true,
    providerConsentRecordedAt: iso(row.provider_consent_recorded_at), capabilities: json(row.capability_snapshot),
    capabilitySnapshotDigest: row.capability_snapshot_digest as DurableOmrJobRecord["capabilitySnapshotDigest"],
    providerBindingId: row.provider_binding_id as string,
    adapterContractVersion: row.adapter_contract_version as string,
    vendorCreateIdempotencyKey: row.vendor_create_idempotency_key as string,
    vendorCreateLeaseExpiresAt: iso(row.vendor_create_lease_expires_at),
    vendorCreateOutcomeState: row.vendor_create_outcome_state as DurableOmrJobRecord["vendorCreateOutcomeState"],
    ...(row.vendor_job_id_envelope ? { vendorJobIdEnvelope: json<AeadEnvelopeV1>(row.vendor_job_id_envelope) } : {}),
    creditEstimate: row.credit_estimate as number, creditState: row.credit_state as DurableOmrJobRecord["creditState"],
    pages, ...(row.progress_bp === null || row.progress_bp === undefined ? {} : { progressBp: row.progress_bp as number }),
    ...(row.current_input_request ? { currentInputRequest: json(row.current_input_request) } : {}),
    ...(row.accepted_input ? { acceptedInput: json(row.accepted_input) } : {}),
    ...(row.accepted_input_digest ? { acceptedInputDigest: row.accepted_input_digest as DurableOmrJobRecord["acceptedInputDigest"] } : {}),
    ...(row.result_object_reference_id ? { resultObjectReferenceId: id(row.result_object_reference_id) } : {}),
    ...(row.vendor_result_digest ? { vendorResultDigest: row.vendor_result_digest as DurableOmrJobRecord["vendorResultDigest"] } : {}),
    ...(row.evidence_bundle ? { evidence: json(row.evidence_bundle) } : {}),
    ...(row.normalization_mapping ? { normalizationMapping: json(row.normalization_mapping) } : {}),
    ...(row.retention_info ? { retentionInfo: json(row.retention_info) } : {}),
    ...(row.vendor_delete_result ? { vendorDeleteResult: json(row.vendor_delete_result) } : {}),
    vendorDeleteState: row.vendor_delete_state as DurableOmrJobRecord["vendorDeleteState"],
    localDeleteState: row.local_delete_state as DurableOmrJobRecord["localDeleteState"],
    ...(row.vendor_delete_next_attempt_at ? { vendorDeleteNextAttemptAt: iso(row.vendor_delete_next_attempt_at) } : {}),
    ...(row.local_delete_next_attempt_at ? { localDeleteNextAttemptAt: iso(row.local_delete_next_attempt_at) } : {}),
    ...(row.operation_kind ? { operationKind: row.operation_kind as DurableOmrJobRecord["operationKind"] } : {}),
    ...(row.operation_request_digest ? { operationRequestDigest: row.operation_request_digest as DurableOmrJobRecord["operationRequestDigest"] } : {}),
    ...(row.operation_lease_token ? { operationLeaseToken: row.operation_lease_token as string } : {}),
    ...(row.operation_lease_expires_at ? { operationLeaseExpiresAt: iso(row.operation_lease_expires_at) } : {}),
    ...(row.result_capture_lease_token ? { resultCaptureLeaseToken: row.result_capture_lease_token as string } : {}),
    ...(row.result_capture_lease_expires_at ? { resultCaptureLeaseExpiresAt: iso(row.result_capture_lease_expires_at) } : {}),
    ...(row.status_observation_lease_token ? { statusObservationLeaseToken: row.status_observation_lease_token as string } : {}),
    ...(row.status_observation_lease_expires_at ? { statusObservationLeaseExpiresAt: iso(row.status_observation_lease_expires_at) } : {}),
    ...(row.cleanup_lease_token ? { cleanupLeaseToken: row.cleanup_lease_token as string } : {}),
    ...(row.cleanup_lease_expires_at ? { cleanupLeaseExpiresAt: iso(row.cleanup_lease_expires_at) } : {}),
    ...(row.reconciliation_kind ? { reconciliationKind: row.reconciliation_kind as DurableOmrJobRecord["reconciliationKind"] } : {}),
    ...(row.retry_kind ? { retryKind: row.retry_kind as DurableOmrJobRecord["retryKind"] } : {}),
    ...(row.retry_attempt === null || row.retry_attempt === undefined ? {} : { retryAttempt: row.retry_attempt as number }),
    ...(row.retry_next_attempt_at ? { retryNextAttemptAt: iso(row.retry_next_attempt_at) } : {}),
    ...(row.retry_last_failure_code ? { retryLastFailureCode: row.retry_last_failure_code as string } : {}),
    ...(row.public_failure_code ? { publicFailureCode: row.public_failure_code as string } : {}),
    ...(row.public_failure_message_ko ? { publicFailureMessageKo: row.public_failure_message_ko as string } : {}),
    handleActive: row.handle_active as boolean, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at ?? row.created_at),
    ...(row.started_at ? { startedAt: iso(row.started_at) } : {}),
    ...(row.completed_at ? { completedAt: iso(row.completed_at) } : {}),
    ...(row.deleted_at ? { deletedAt: iso(row.deleted_at) } : {}),
  };
}

async function loadJob(client: Pool | PoolClient, jobId: PrivateRowId): Promise<DurableOmrJobRecord | undefined> {
  const result = await client.query("SELECT * FROM omr_jobs WHERE id=$1", [jobId]);
  if (!result.rows[0]) return undefined;
  const pages = await client.query("SELECT * FROM omr_pages WHERE job_id=$1 ORDER BY page_ordinal", [jobId]);
  return jobRow(result.rows[0], pages.rows.map(pageRow));
}

const JOB_UPDATE_MAPPINGS: ReadonlyArray<{ key: keyof DurableOmrJobRecord; column: string; json?: boolean }> = [
  { key: "state", column: "state" }, { key: "creditState", column: "credit_state" },
  { key: "vendorCreateOutcomeState", column: "vendor_create_outcome_state" },
  { key: "progressBp", column: "progress_bp" },
  { key: "vendorJobIdEnvelope", column: "vendor_job_id_envelope", json: true },
  { key: "currentInputRequest", column: "current_input_request", json: true },
  { key: "acceptedInput", column: "accepted_input", json: true },
  { key: "acceptedInputDigest", column: "accepted_input_digest" },
  { key: "resultObjectReferenceId", column: "result_object_reference_id" },
  { key: "vendorResultDigest", column: "vendor_result_digest" },
  { key: "evidence", column: "evidence_bundle", json: true },
  { key: "normalizationMapping", column: "normalization_mapping", json: true },
  { key: "retentionInfo", column: "retention_info", json: true },
  { key: "vendorDeleteResult", column: "vendor_delete_result", json: true },
  { key: "vendorDeleteState", column: "vendor_delete_state" },
  { key: "localDeleteState", column: "local_delete_state" },
  { key: "vendorDeleteNextAttemptAt", column: "vendor_delete_next_attempt_at" },
  { key: "localDeleteNextAttemptAt", column: "local_delete_next_attempt_at" },
  { key: "operationKind", column: "operation_kind" },
  { key: "operationRequestDigest", column: "operation_request_digest" },
  { key: "operationLeaseToken", column: "operation_lease_token" },
  { key: "operationLeaseExpiresAt", column: "operation_lease_expires_at" },
  { key: "resultCaptureLeaseToken", column: "result_capture_lease_token" },
  { key: "resultCaptureLeaseExpiresAt", column: "result_capture_lease_expires_at" },
  { key: "statusObservationLeaseToken", column: "status_observation_lease_token" },
  { key: "statusObservationLeaseExpiresAt", column: "status_observation_lease_expires_at" },
  { key: "cleanupLeaseToken", column: "cleanup_lease_token" },
  { key: "cleanupLeaseExpiresAt", column: "cleanup_lease_expires_at" },
  { key: "reconciliationKind", column: "reconciliation_kind" },
  { key: "retryKind", column: "retry_kind" },
  { key: "retryAttempt", column: "retry_attempt" },
  { key: "retryNextAttemptAt", column: "retry_next_attempt_at" },
  { key: "retryLastFailureCode", column: "retry_last_failure_code" },
  { key: "publicFailureCode", column: "public_failure_code" },
  { key: "publicFailureMessageKo", column: "public_failure_message_ko" },
  { key: "startedAt", column: "started_at" }, { key: "completedAt", column: "completed_at" },
  { key: "deletedAt", column: "deleted_at" }, { key: "handleActive", column: "handle_active" },
];

async function updateLockedJob(
  client: PoolClient,
  jobId: PrivateRowId,
  update: Partial<DurableOmrJobRecord>,
  now: string,
): Promise<void> {
  const assignments: string[] = ["updated_at=$2"];
  const values: unknown[] = [jobId, now];
  for (const mapping of JOB_UPDATE_MAPPINGS) {
    if (!Object.prototype.hasOwnProperty.call(update, mapping.key)) continue;
    const raw = update[mapping.key];
    values.push(raw === undefined ? null : mapping.json ? JSON.stringify(raw) : raw);
    assignments.push(`${mapping.column}=$${values.length}`);
  }
  const result = await client.query(`UPDATE omr_jobs SET ${assignments.join(",")} WHERE id=$1`, values);
  if (result.rowCount !== 1) throw new RangeError("OMR_JOB_UNAVAILABLE");
}

export class PostgresOmrStore implements OmrStore {
  constructor(private readonly database: Pool) {}

  async inspectCreate(input: Parameters<OmrStore["inspectCreate"]>[0]) {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
         `SELECT i.request_digest,i.state AS idempotency_state,i.job_id,i.failure_code,i.failure_message_ko,j.vendor_create_lease_expires_at,j.public_handle_replay_envelope,j.state AS job_state,j.reconciliation_kind,j.handle_active,j.expires_at
         FROM omr_create_idempotency i JOIN omr_jobs j ON j.id=i.job_id
         WHERE i.owner_session_id=$1 AND i.key_hash=$2 FOR UPDATE OF i,j`,
        [input.ownerSessionId, input.idempotencyKeyHash],
      );
      if (!existing.rows[0]) { await client.query("COMMIT"); return { status: "missing" as const }; }
      const row = existing.rows[0];
      if (row.request_digest !== input.requestDigest) { await client.query("ROLLBACK"); return { status: "conflict" as const }; }
      if (row.idempotency_state === "complete") {
        const completed = row.failure_code
          ? { status: "rejected" as const, code: row.failure_code as string, messageKo: row.failure_message_ko as string }
          : isCreateReplayUsable({ handleActive: row.handle_active as boolean, handleExpiresAt: iso(row.expires_at), state: row.job_state }, input.now)
            ? { status: "replay" as const, handleReplayEnvelope: json<AeadEnvelopeV1>(row.public_handle_replay_envelope) }
            : { status: "replay-unavailable" as const };
        await client.query("COMMIT");
        return completed;
      }
       if (!row.handle_active || (row.job_state !== "created"
         && !(row.job_state === "reconciliation-required" && row.reconciliation_kind === "create"))) { await client.query("COMMIT"); return { status: "pending" as const }; }
      if (iso(row.vendor_create_lease_expires_at) > input.now) { await client.query("COMMIT"); return { status: "pending" as const }; }
      await client.query("UPDATE omr_jobs SET vendor_create_lease_expires_at=$2,updated_at=$3 WHERE id=$1", [row.job_id, input.vendorCreateLeaseExpiresAt, input.now]);
      const job = await loadJob(client, id(row.job_id));
      if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      await client.query("COMMIT");
      return { status: "resume" as const, job };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async claimCreate(input: Parameters<OmrStore["claimCreate"]>[0]): Promise<OmrCreateClaim> {
    if (!Number.isSafeInteger(input.record.creditEstimate) || input.record.creditEstimate <= 0
      || input.record.creditEstimate > MAX_OMR_CREDIT_ESTIMATE
      || !Number.isSafeInteger(input.quota.dailyGlobalCreditCeiling) || input.quota.dailyGlobalCreditCeiling <= 0
      || input.quota.dailyGlobalCreditCeiling > MAX_OMR_DAILY_CREDIT_CEILING) throw new RangeError("OMR_CREDIT_DOMAIN_INVALID");
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1214349646)");
      const existing = await client.query(
         `SELECT i.request_digest,i.state AS idempotency_state,i.job_id,i.failure_code,i.failure_message_ko,j.vendor_create_lease_expires_at,j.public_handle_replay_envelope,j.state AS job_state,j.reconciliation_kind,j.handle_active,j.expires_at
         FROM omr_create_idempotency i JOIN omr_jobs j ON j.id=i.job_id
         WHERE i.owner_session_id=$1 AND i.key_hash=$2 FOR UPDATE OF i,j`,
        [input.ownerSessionId, input.idempotencyKeyHash],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.request_digest !== input.requestDigest) { await client.query("ROLLBACK"); return { status: "conflict" }; }
        if (row.idempotency_state === "complete") {
          const completed = row.failure_code
            ? { status: "rejected" as const, code: row.failure_code as string, messageKo: row.failure_message_ko as string }
            : isCreateReplayUsable({ handleActive: row.handle_active as boolean, handleExpiresAt: iso(row.expires_at), state: row.job_state }, input.now)
              ? { status: "replay" as const, handleReplayEnvelope: json<AeadEnvelopeV1>(row.public_handle_replay_envelope) }
              : { status: "replay-unavailable" as const };
          await client.query("COMMIT");
          return completed;
        }
         if (!row.handle_active || (row.job_state !== "created"
           && !(row.job_state === "reconciliation-required" && row.reconciliation_kind === "create"))) { await client.query("COMMIT"); return { status: "pending" }; }
        if (iso(row.vendor_create_lease_expires_at) > input.now) { await client.query("COMMIT"); return { status: "pending" }; }
        await client.query("UPDATE omr_jobs SET vendor_create_lease_expires_at=$2,updated_at=$3 WHERE id=$1", [row.job_id, input.record.vendorCreateLeaseExpiresAt, input.now]);
        const job = await loadJob(client, id(row.job_id));
        if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
        await client.query("COMMIT");
        return { status: "resume", job };
      }
      const { dayStartUtc, nextDayStartUtc } = utcAccountingWindow(input.now);
      const counts = await client.query(
        `SELECT
          count(*) FILTER (WHERE owner_session_id=$1 AND ${ACTIVE_VENDOR_EXPOSURE_SQL}) AS session_active,
          count(*) FILTER (WHERE ip_owner_hash=$2 AND ${ACTIVE_VENDOR_EXPOSURE_SQL}) AS ip_active,
          count(*) FILTER (WHERE owner_session_id=$1 AND created_at > $3::timestamptz - interval '1 hour') AS session_hour,
          count(*) FILTER (WHERE ip_owner_hash=$2 AND created_at > $3::timestamptz - interval '1 hour') AS ip_hour,
          COALESCE(sum(credit_estimate::bigint) FILTER (WHERE credit_state = 'reserved' OR (credit_state = 'settled' AND created_at >= $6::timestamptz AND created_at < $7::timestamptz)),0::bigint) AS day_credit
         FROM omr_jobs`,
        [input.ownerSessionId, input.ipOwnerHash, input.now, ACTIVE_OMR_LIFECYCLE_STATES, VENDOR_CLEANUP_EXPOSURE_STATES, dayStartUtc, nextDayStartUtc],
      );
      const count = counts.rows[0];
      if (BigInt(count.session_active) >= BigInt(input.quota.maxConcurrentJobsPerSession) || BigInt(count.ip_active) >= BigInt(input.quota.maxConcurrentJobsPerIp)
        || BigInt(count.session_hour) >= BigInt(input.quota.maxJobsPerSessionPerHour) || BigInt(count.ip_hour) >= BigInt(input.quota.maxJobsPerIpPerHour)) {
        await client.query("ROLLBACK"); return { status: "quota-denied" };
      }
      if (BigInt(count.day_credit) + BigInt(input.record.creditEstimate) > BigInt(input.quota.dailyGlobalCreditCeiling)) {
        await client.query("ROLLBACK"); return { status: "credit-denied" };
      }
      const record = input.record;
      const inserted = await client.query(
        `INSERT INTO omr_jobs (
          owner_session_id,public_handle_hash,vendor_job_id_envelope,state,created_at,expires_at,
          ip_owner_hash,public_handle_replay_envelope,handle_active,source_kind,page_count,rights_json,
          provider_transfer_consent,provider_consent_recorded_at,capability_snapshot,provider_binding_id,adapter_contract_version,vendor_create_idempotency_key,
          vendor_create_lease_expires_at,vendor_create_outcome_state,credit_estimate,credit_state,updated_at,capability_snapshot_digest,
          vendor_delete_state,local_delete_state,canonical_create_request)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,true,$8,$9,$10,true,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id`,
        [record.ownerSessionId, record.publicHandleHash, record.state, record.createdAt, record.handleExpiresAt,
          record.ipOwnerHash, JSON.stringify(record.publicHandleReplayEnvelope), record.sourceKind, record.pageCount,
          JSON.stringify(record.rights), record.providerConsentRecordedAt, JSON.stringify(record.capabilities), record.providerBindingId, record.adapterContractVersion,
          record.vendorCreateIdempotencyKey, record.vendorCreateLeaseExpiresAt, record.vendorCreateOutcomeState, record.creditEstimate, record.creditState, record.updatedAt,
          record.capabilitySnapshotDigest, record.vendorDeleteState, record.localDeleteState, JSON.stringify(record.canonicalCreateRequest)],
      );
      const jobId = id(inserted.rows[0].id);
      await client.query("INSERT INTO omr_create_idempotency (owner_session_id,key_hash,request_digest,job_id,state,created_at) VALUES ($1,$2,$3,$4,'pending',$5)", [input.ownerSessionId, input.idempotencyKeyHash, input.requestDigest, jobId, input.now]);
      const job = await loadJob(client, jobId); if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      await client.query("COMMIT");
      return { status: "claimed", job };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async beginVendorCreation(input: Parameters<OmrStore["beginVendorCreation"]>[0]): Promise<void> {
    const result = await this.database.query(
       `UPDATE omr_jobs SET vendor_create_outcome_state='outcome-uncertain',updated_at=$5
       WHERE id=$1 AND handle_active=true AND state=$2 AND vendor_create_outcome_state=$3
          AND (state='created' OR (state='reconciliation-required' AND reconciliation_kind='create'))
          AND vendor_create_lease_expires_at=$4 AND vendor_job_id_envelope IS NULL AND cleanup_lease_token IS NULL`,
      [input.jobId, input.expectedState, input.expectedOutcomeState, input.expectedVendorCreateLeaseExpiresAt, input.now],
    );
    if (result.rowCount !== 1) {
      const found = await this.database.query("SELECT id FROM omr_jobs WHERE id=$1", [input.jobId]);
      if (!found.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      throw new RangeError("OMR_CREATE_COMPLETION_SUPERSEDED");
    }
  }

  async completeVendorCreation(input: Parameters<OmrStore["completeVendorCreation"]>[0]): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const publicRecovery = input.completionMode === "public-handle-recovery";
      const updated = await client.query(
        publicRecovery
          ? `UPDATE omr_jobs AS j SET vendor_job_id_envelope=$2,vendor_create_outcome_state='confirmed',state='created',
               reconciliation_kind=NULL,public_failure_code=NULL,public_failure_message_ko=NULL,updated_at=$3
             FROM omr_create_idempotency i
             WHERE j.id=$1 AND i.job_id=j.id AND i.state='pending' AND j.handle_active=true AND j.state=$4
               AND (j.state='created' OR (j.state='reconciliation-required' AND j.reconciliation_kind='create'))
               AND j.vendor_create_outcome_state='outcome-uncertain' AND j.vendor_job_id_envelope IS NULL
               AND j.cleanup_lease_token IS NULL AND $5::text IS NULL AND j.vendor_create_lease_expires_at=$6
             RETURNING j.id`
          : `UPDATE omr_jobs AS j SET vendor_job_id_envelope=$2,vendor_create_outcome_state='confirmed',updated_at=$3
             FROM omr_create_idempotency i
             WHERE j.id=$1 AND i.job_id=j.id AND i.state='pending' AND j.handle_active=false AND j.state=$4
               AND j.state='delete-pending' AND j.vendor_create_outcome_state='outcome-uncertain' AND j.vendor_job_id_envelope IS NULL
               AND (($5::text IS NULL AND j.cleanup_lease_token IS NULL AND j.vendor_create_lease_expires_at=$6) OR j.cleanup_lease_token=$5)
             RETURNING j.id`,
        [input.jobId, JSON.stringify(input.vendorJobIdEnvelope), input.now, input.expectedState, input.cleanupLeaseToken ?? null, input.expectedVendorCreateLeaseExpiresAt ?? null],
      );
      if (updated.rowCount !== 1) {
        const found = await client.query("SELECT id FROM omr_jobs WHERE id=$1", [input.jobId]);
        if (!found.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
        throw new RangeError("OMR_CREATE_COMPLETION_SUPERSEDED");
      }
      const completed = await client.query("UPDATE omr_create_idempotency SET state='complete',failure_code=NULL,failure_message_ko=NULL WHERE job_id=$1 AND state='pending'", [input.jobId]);
      if (completed.rowCount !== 1) throw new RangeError("OMR_CREATE_COMPLETION_SUPERSEDED");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async markVendorCreationUnresolved(input: Parameters<OmrStore["markVendorCreationUnresolved"]>[0]): Promise<void> {
    const result = await this.database.query(
      `UPDATE omr_jobs AS j SET state='reconciliation-required',reconciliation_kind='create',
         public_failure_code=$4,public_failure_message_ko=$5,updated_at=$6
       FROM omr_create_idempotency i
       WHERE j.id=$1 AND i.job_id=j.id AND i.state='pending' AND j.handle_active=true AND j.state=$2
         AND (j.state='created' OR (j.state='reconciliation-required' AND j.reconciliation_kind='create'))
         AND j.vendor_create_outcome_state='outcome-uncertain' AND j.vendor_create_lease_expires_at=$3
         AND j.vendor_job_id_envelope IS NULL AND j.cleanup_lease_token IS NULL`,
      [input.jobId, input.expectedState, input.expectedVendorCreateLeaseExpiresAt, input.code, input.messageKo, input.now],
    );
    if (result.rowCount !== 1) {
      const found = await this.database.query("SELECT id FROM omr_jobs WHERE id=$1", [input.jobId]);
      if (!found.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      throw new RangeError("OMR_CREATE_COMPLETION_SUPERSEDED");
    }
  }

  async failVendorCreation(input: Parameters<OmrStore["failVendorCreation"]>[0]): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE omr_jobs SET state='failed',vendor_create_outcome_state='definitive-no-job',credit_state='released',
           public_failure_code=$2,public_failure_message_ko=$3,updated_at=$4
         WHERE id=$1 AND state='created' AND vendor_create_outcome_state='outcome-uncertain'
           AND vendor_create_lease_expires_at=$5 AND vendor_job_id_envelope IS NULL AND cleanup_lease_token IS NULL RETURNING id`,
        [input.jobId, input.code, input.messageKo, input.now, input.expectedVendorCreateLeaseExpiresAt],
      );
      if (updated.rowCount !== 1) {
        const found = await client.query("SELECT id FROM omr_jobs WHERE id=$1", [input.jobId]);
        if (!found.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
        throw new RangeError("OMR_CREATE_COMPLETION_SUPERSEDED");
      }
      await client.query("UPDATE omr_create_idempotency SET state='complete',failure_code=$2,failure_message_ko=$3 WHERE job_id=$1", [input.jobId, input.code, input.messageKo]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async findOwnedByHandleHash(handleHash: string, ownerSessionId: PrivateRowId, includeInactive = false): Promise<DurableOmrJobRecord | undefined> {
    const result = await this.database.query("SELECT id FROM omr_jobs WHERE public_handle_hash=$1 AND owner_session_id=$2 AND (handle_active=true OR $3=true)", [handleHash, ownerSessionId, includeInactive]);
    return result.rows[0] ? loadJob(this.database, id(result.rows[0].id)) : undefined;
  }

  async claimPage(jobId: PrivateRowId, page: OmrPageRecord, maxRetries: number, leaseToken: string, leaseExpiresAt: string, supportsIdempotency: boolean, now: string): Promise<OmrPageClaim> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const job = await client.query("SELECT state FROM omr_jobs WHERE id=$1 FOR UPDATE", [jobId]);
      if (!job.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      if (!["created", "uploading"].includes(job.rows[0].state)) { await client.query("ROLLBACK"); return { status: "conflict" }; }
      const duplicate = await client.query("SELECT 1 FROM omr_pages WHERE job_id=$1 AND page_ordinal<>$2 AND page_digest=$3 LIMIT 1", [jobId, page.pageIndex, page.pageDigest]);
      if (duplicate.rows[0] && page.duplicateConfirmed !== true) { await client.query("ROLLBACK"); return { status: "duplicate-confirmation-required" }; }
      const priorResult = await client.query("SELECT * FROM omr_pages WHERE job_id=$1 AND page_ordinal=$2 FOR UPDATE", [jobId, page.pageIndex]);
      const prior = priorResult.rows[0] ? pageRow(priorResult.rows[0]) : undefined;
      if (prior && (prior.pageDigest !== page.pageDigest || prior.idempotencyKeyHash !== page.idempotencyKeyHash)) { await client.query("ROLLBACK"); return { status: "conflict" }; }
      if (prior?.uploadState === "uploaded") { await client.query("COMMIT"); return { status: "replay" }; }
      if (prior?.uploadState === "reconciliation-required") { await client.query("COMMIT"); return { status: "reconciliation-required" }; }
      if (prior?.uploadState === "pending" && (prior.uploadLeaseExpiresAt ?? "") > now) { await client.query("COMMIT"); return { status: "pending" }; }
      if (prior?.uploadState === "pending" && !supportsIdempotency) {
        await client.query("UPDATE omr_pages SET upload_state='reconciliation-required',upload_lease_token=NULL,upload_lease_expires_at=NULL WHERE job_id=$1 AND page_ordinal=$2", [jobId, page.pageIndex]);
        await client.query("UPDATE omr_jobs SET state='reconciliation-required',reconciliation_kind='page-upload',updated_at=$2 WHERE id=$1", [jobId, now]);
        await client.query("COMMIT"); return { status: "reconciliation-required" };
      }
      if (prior?.uploadState === "failed" && prior.retryCount >= maxRetries) { await client.query("COMMIT"); return { status: "retry-exhausted" }; }
      const retryCount = prior?.uploadState === "failed" ? prior.retryCount + 1 : prior?.retryCount ?? 0;
      const values = [jobId, page.pageIndex, page.pageDigest, page.mimeType, page.idempotencyKeyHash, page.width, page.height, JSON.stringify(page.quality), page.warnAcknowledged, page.duplicateConfirmed, retryCount, leaseToken, leaseExpiresAt];
      await client.query(
        `INSERT INTO omr_pages (job_id,page_ordinal,page_digest,mime_type,upload_idempotency_key_hash,width_pixels,height_pixels,quality_report,warn_acknowledged,duplicate_confirmed,upload_state,retry_count,upload_lease_token,upload_lease_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13)
         ON CONFLICT (job_id,page_ordinal) DO UPDATE SET upload_state='pending',retry_count=EXCLUDED.retry_count,quality_report=EXCLUDED.quality_report,warn_acknowledged=EXCLUDED.warn_acknowledged,duplicate_confirmed=EXCLUDED.duplicate_confirmed,upload_lease_token=EXCLUDED.upload_lease_token,upload_lease_expires_at=EXCLUDED.upload_lease_expires_at`, values);
      await client.query("UPDATE omr_jobs SET state='uploading',updated_at=$2 WHERE id=$1 AND state='created'", [jobId, now]);
      await client.query("COMMIT");
      return { status: "claimed", page: { ...page, retryCount, uploadState: "pending", uploadLeaseToken: leaseToken, uploadLeaseExpiresAt: leaseExpiresAt } };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async completePage(jobId: PrivateRowId, pageIndex: number, leaseToken: string, objectReferenceId: PrivateRowId, now: string): Promise<boolean> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const job = await client.query("SELECT state FROM omr_jobs WHERE id=$1 FOR UPDATE", [jobId]);
      if (!job.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      const page = await client.query("SELECT upload_state,upload_lease_token FROM omr_pages WHERE job_id=$1 AND page_ordinal=$2 FOR UPDATE", [jobId, pageIndex]);
      if (!["created", "uploading"].includes(job.rows[0].state) || page.rows[0]?.upload_state !== "pending" || page.rows[0]?.upload_lease_token !== leaseToken) {
        await client.query("COMMIT"); return false;
      }
      await client.query("UPDATE omr_pages SET processed_object_reference_id=$4,upload_state='uploaded',upload_lease_token=NULL,upload_lease_expires_at=NULL WHERE job_id=$1 AND page_ordinal=$2 AND upload_lease_token=$3", [jobId, pageIndex, leaseToken, objectReferenceId]);
      await client.query("UPDATE omr_jobs SET updated_at=$2 WHERE id=$1", [jobId, now]);
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async inspectPageCompletion(input: OmrPageCompletionExpectation): Promise<OmrDurableCompletionInspection> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const jobResult = await client.query("SELECT state FROM omr_jobs WHERE id=$1 FOR SHARE", [input.jobId]);
      const pageResult = await client.query("SELECT * FROM omr_pages WHERE job_id=$1 AND page_ordinal=$2 FOR SHARE", [input.jobId, input.pageIndex]);
      const referenceResult = await client.query(
        `SELECT EXISTS (
          SELECT 1 FROM omr_jobs WHERE result_object_reference_id=$1
          UNION ALL
          SELECT 1 FROM omr_pages WHERE processed_object_reference_id=$1
        ) AS referenced`,
        [input.objectReferenceId],
      );
      await client.query("COMMIT");
      const page = pageResult.rows[0] ? pageRow(pageResult.rows[0]) : undefined;
      if (page?.uploadState === "uploaded"
        && page.objectReferenceId === input.objectReferenceId
        && page.pageDigest === input.pageDigest
        && page.idempotencyKeyHash === input.idempotencyKeyHash) return { status: "committed-exact" };
      if (referenceResult.rows[0]?.referenced === true) return { status: "unknown" };
      if (!jobResult.rows[0] || !page) return { status: "not-committed" };
      if (page.uploadState === "pending"
        && page.uploadLeaseToken === input.leaseToken
        && page.pageDigest === input.pageDigest
        && page.idempotencyKeyHash === input.idempotencyKeyHash) return { status: "not-committed" };
      return { status: "superseded" };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async failPage(jobId: PrivateRowId, pageIndex: number, leaseToken: string, outcome: "failed" | "reconciliation-required", now: string): Promise<void> {
    await this.database.query("UPDATE omr_pages SET upload_state=$4,upload_lease_token=NULL,upload_lease_expires_at=NULL WHERE job_id=$1 AND page_ordinal=$2 AND upload_lease_token=$3", [jobId, pageIndex, leaseToken, outcome]);
    if (outcome === "reconciliation-required") await this.database.query("UPDATE omr_jobs SET state='reconciliation-required',reconciliation_kind='page-upload',updated_at=$2 WHERE id=$1 AND state IN ('created','uploading')", [jobId, now]);
    await this.database.query("UPDATE omr_jobs SET updated_at=$2 WHERE id=$1", [jobId, now]);
  }

  async claimOperation(input: Parameters<OmrStore["claimOperation"]>[0]): Promise<OmrOperationClaim> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT * FROM omr_jobs WHERE id=$1 FOR UPDATE", [input.jobId]);
      if (!selected.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      const job = jobRow(selected.rows[0], []);
      if (job.operationKind) {
        if ((job.operationLeaseExpiresAt ?? "") > input.now) {
          await client.query("COMMIT"); return { status: "pending" };
        }
        if (job.operationRequestDigest !== input.operationRequestDigest) {
          await client.query("COMMIT"); return { status: "request-conflict" };
        }
        if (job.operationKind !== input.kind || !input.supportsIdempotency) {
          await updateLockedJob(client, input.jobId, {
            state: "reconciliation-required", reconciliationKind: job.operationKind,
            operationKind: undefined, operationRequestDigest: undefined, operationLeaseToken: undefined, operationLeaseExpiresAt: undefined,
          }, input.now);
          await client.query("COMMIT"); return { status: "reconciliation-required" };
        }
      } else if (!input.expectedStates.includes(job.state)) {
        await client.query("COMMIT"); return { status: "invalid" };
      }
      const resumed = Boolean(job.operationKind);
      await updateLockedJob(client, input.jobId, {
        ...(input.kind === "cancel" ? { state: "cancel-pending" as const } : {}),
        operationKind: input.kind, operationRequestDigest: input.operationRequestDigest, operationLeaseToken: input.leaseToken,
        operationLeaseExpiresAt: input.leaseExpiresAt,
      }, input.now);
      const loaded = await loadJob(client, input.jobId);
      if (!loaded) throw new RangeError("OMR_JOB_UNAVAILABLE");
      await client.query("COMMIT");
      return { status: resumed ? "resume" : "claimed", job: loaded };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async completeOperation(input: Parameters<OmrStore["completeOperation"]>[0]): Promise<boolean> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT state,operation_kind,operation_lease_token FROM omr_jobs WHERE id=$1 FOR UPDATE", [input.jobId]);
      if (!selected.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      const row = selected.rows[0];
      if (row.operation_kind !== input.kind || row.operation_lease_token !== input.leaseToken) {
        await client.query("COMMIT"); return false;
      }
      if (input.update.state !== undefined && !isLegalOmrTransition(row.state, input.update.state)) {
        throw new RangeError("OMR_STATE_TRANSITION_INVALID");
      }
      await updateLockedJob(client, input.jobId, {
        ...input.update, operationKind: undefined, operationRequestDigest: undefined, operationLeaseToken: undefined, operationLeaseExpiresAt: undefined,
      }, input.now);
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async failOperation(input: Parameters<OmrStore["failOperation"]>[0]): Promise<boolean> {
    return this.completeOperation(input);
  }

  async claimResultCapture(input: Parameters<OmrStore["claimResultCapture"]>[0]) {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT state,result_capture_lease_token,result_capture_lease_expires_at,status_observation_lease_token,status_observation_lease_expires_at FROM omr_jobs WHERE id=$1 FOR UPDATE", [input.jobId]);
      if (!selected.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      const row = selected.rows[0];
      if (row.state === "completed") { await client.query("COMMIT"); return { status: "replay" as const }; }
      if (!["queued", "processing", "needs-input", "sync-retry-pending", "capture-retry-pending"].includes(row.state)) { await client.query("COMMIT"); return { status: "invalid" as const }; }
      if (input.statusObservationLeaseToken !== undefined && row.status_observation_lease_token !== input.statusObservationLeaseToken) { await client.query("COMMIT"); return { status: "invalid" as const }; }
      if (input.statusObservationLeaseToken === undefined && row.status_observation_lease_token && iso(row.status_observation_lease_expires_at) > input.now) { await client.query("COMMIT"); return { status: "pending" as const }; }
      if (row.result_capture_lease_token && iso(row.result_capture_lease_expires_at) > input.now) { await client.query("COMMIT"); return { status: "pending" as const }; }
      await updateLockedJob(client, input.jobId, {
        statusObservationLeaseToken: undefined,
        statusObservationLeaseExpiresAt: undefined,
        resultCaptureLeaseToken: input.leaseToken,
        resultCaptureLeaseExpiresAt: input.leaseExpiresAt,
      }, input.now);
      const job = await loadJob(client, input.jobId); if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      await client.query("COMMIT"); return { status: "claimed" as const, job };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async completeResultCapture(input: Parameters<OmrStore["completeResultCapture"]>[0]): Promise<boolean> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT state,result_capture_lease_token FROM omr_jobs WHERE id=$1 FOR UPDATE", [input.jobId]);
      if (!selected.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      if (selected.rows[0].result_capture_lease_token !== input.leaseToken || !["queued", "processing", "needs-input", "sync-retry-pending", "capture-retry-pending"].includes(selected.rows[0].state)) { await client.query("COMMIT"); return false; }
      if (input.update.state !== undefined && !isLegalOmrTransition(selected.rows[0].state, input.update.state)) throw new RangeError("OMR_STATE_TRANSITION_INVALID");
      await updateLockedJob(client, input.jobId, { ...input.update, resultCaptureLeaseToken: undefined, resultCaptureLeaseExpiresAt: undefined }, input.now);
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async failResultCapture(input: Parameters<OmrStore["failResultCapture"]>[0]): Promise<boolean> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT state,result_capture_lease_token FROM omr_jobs WHERE id=$1 FOR UPDATE", [input.jobId]);
      if (!selected.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      const row = selected.rows[0];
      if (row.result_capture_lease_token !== input.leaseToken || !input.expectedStates.includes(row.state)) {
        await client.query("COMMIT"); return false;
      }
      if (input.update.state !== undefined && !isLegalOmrTransition(row.state, input.update.state)) throw new RangeError("OMR_STATE_TRANSITION_INVALID");
      await updateLockedJob(client, input.jobId, {
        ...input.update,
        resultCaptureLeaseToken: undefined,
        resultCaptureLeaseExpiresAt: undefined,
      }, input.now);
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async inspectResultCompletion(input: OmrResultCompletionExpectation): Promise<OmrDurableCompletionInspection> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const jobResult = await client.query(
        `SELECT state,credit_state,result_object_reference_id,vendor_result_digest,evidence_bundle,
                normalization_mapping,result_capture_lease_token
         FROM omr_jobs WHERE id=$1 FOR SHARE`,
        [input.jobId],
      );
      const referenceResult = await client.query(
        `SELECT EXISTS (
          SELECT 1 FROM omr_jobs WHERE result_object_reference_id=$1
          UNION ALL
          SELECT 1 FROM omr_pages WHERE processed_object_reference_id=$1
        ) AS referenced`,
        [input.objectReferenceId],
      );
      await client.query("COMMIT");
      const row = jobResult.rows[0] as Record<string, unknown> | undefined;
      const evidence = row?.evidence_bundle ? json<DurableOmrJobRecord["evidence"]>(row.evidence_bundle) : undefined;
      const mapping = row?.normalization_mapping ? json<DurableOmrJobRecord["normalizationMapping"]>(row.normalization_mapping) : undefined;
      if (row?.state === "completed"
        && row.credit_state === "settled"
        && id(row.result_object_reference_id) === input.objectReferenceId
        && row.vendor_result_digest === input.vendorResultDigest
        && evidence?.providerBundleDigest === input.providerBundleDigest
        && mapping?.artifactDigest === input.normalizationMappingArtifactDigest) return { status: "committed-exact" };
      if (referenceResult.rows[0]?.referenced === true) return { status: "unknown" };
      if (!row) return { status: "not-committed" };
      if (row.result_capture_lease_token === input.leaseToken
        && ["queued", "processing", "needs-input", "sync-retry-pending", "capture-retry-pending"].includes(String(row.state))) return { status: "not-committed" };
      return { status: "superseded" };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async releaseResultCapture(jobId: PrivateRowId, leaseToken: string, now: string): Promise<void> {
    await this.database.query("UPDATE omr_jobs SET result_capture_lease_token=NULL,result_capture_lease_expires_at=NULL,updated_at=$3 WHERE id=$1 AND result_capture_lease_token=$2", [jobId, leaseToken, now]);
  }

  async claimStatusObservation(input: Parameters<OmrStore["claimStatusObservation"]>[0]) {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        "SELECT state,result_capture_lease_token,result_capture_lease_expires_at,status_observation_lease_token,status_observation_lease_expires_at FROM omr_jobs WHERE id=$1 FOR UPDATE",
        [input.jobId],
      );
      if (!selected.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      const row = selected.rows[0];
      if (!["queued", "processing", "needs-input", "sync-retry-pending"].includes(row.state)) { await client.query("COMMIT"); return { status: "invalid" as const }; }
      if (row.result_capture_lease_token && iso(row.result_capture_lease_expires_at) > input.now) { await client.query("COMMIT"); return { status: "pending" as const }; }
      if (row.status_observation_lease_token && iso(row.status_observation_lease_expires_at) > input.now) { await client.query("COMMIT"); return { status: "pending" as const }; }
      await updateLockedJob(client, input.jobId, {
        resultCaptureLeaseToken: undefined,
        resultCaptureLeaseExpiresAt: undefined,
        statusObservationLeaseToken: input.leaseToken,
        statusObservationLeaseExpiresAt: input.leaseExpiresAt,
      }, input.now);
      const job = await loadJob(client, input.jobId);
      if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      await client.query("COMMIT");
      return { status: "claimed" as const, job };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async completeStatusObservation(input: Parameters<OmrStore["completeStatusObservation"]>[0]): Promise<boolean> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT state,status_observation_lease_token,result_capture_lease_token,result_capture_lease_expires_at FROM omr_jobs WHERE id=$1 FOR UPDATE", [input.jobId]);
      if (!selected.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      const row = selected.rows[0];
      if (row.status_observation_lease_token !== input.leaseToken || !input.expectedStates.includes(row.state)
        || (row.result_capture_lease_token && iso(row.result_capture_lease_expires_at) > input.now)) {
        await client.query("COMMIT"); return false;
      }
      if (input.update.state !== undefined && !isLegalOmrTransition(row.state, input.update.state)) throw new RangeError("OMR_STATE_TRANSITION_INVALID");
      await updateLockedJob(client, input.jobId, {
        ...input.update,
        statusObservationLeaseToken: undefined,
        statusObservationLeaseExpiresAt: undefined,
      }, input.now);
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async transition(jobId: PrivateRowId, update: Partial<DurableOmrJobRecord>, now: string): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT state FROM omr_jobs WHERE id=$1 FOR UPDATE", [jobId]);
      if (!existing.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      if (update.state !== undefined && !isLegalOmrTransition(existing.rows[0].state, update.state)) throw new RangeError("OMR_STATE_TRANSITION_INVALID");
      await updateLockedJob(client, jobId, update, now);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async markHandleDeleted(jobId: PrivateRowId, now: string): Promise<void> {
    const result = await this.database.query("UPDATE omr_jobs SET handle_active=false,state='delete-pending',deleted_at=COALESCE(deleted_at,$2),credit_state=CASE WHEN credit_state='settled' THEN 'settled' WHEN credit_state='reserved' AND (vendor_create_outcome_state='outcome-uncertain' OR (vendor_create_outcome_state='confirmed' AND vendor_delete_state<>'deleted')) THEN 'reserved' ELSE 'released' END,updated_at=$2 WHERE id=$1 AND handle_active=true", [jobId, now]);
    if (result.rowCount !== 1) throw new RangeError("OMR_JOB_UNAVAILABLE");
  }

  async recordAudit(jobId: PrivateRowId | undefined, eventKind: string, outcome: string, now: string): Promise<void> {
    await this.database.query(
      "INSERT INTO audit_events (event_kind,omr_job_id,outcome,created_at) VALUES ($1,$2,$3,$4)",
      [`omr:${eventKind}`.slice(0, 128), jobId ?? null, outcome.slice(0, 256), now],
    );
  }

  async claimCleanup(input: Parameters<OmrStore["claimCleanup"]>[0]): Promise<readonly DurableOmrJobRecord[]> {
    const { now, limit } = input;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new RangeError("OMR_CLEANUP_LIMIT_INVALID");
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
         `SELECT id FROM omr_jobs WHERE state <> 'deleted' AND (cleanup_lease_token IS NULL OR cleanup_lease_expires_at <= $1) AND (
           (handle_active=true AND expires_at <= $1)
           OR state='expired'
           OR (state='delete-pending' AND (
             (vendor_delete_state <> 'deleted' AND COALESCE(vendor_delete_next_attempt_at,$1) <= $1)
             OR (local_delete_state <> 'deleted' AND COALESCE(local_delete_next_attempt_at,$1) <= $1)
           ))
         ) ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT $2`,
        [now, limit],
      );
      const records: DurableOmrJobRecord[] = [];
      for (const row of selected.rows) {
        const jobId = id(row.id);
        await client.query("UPDATE omr_jobs SET state=CASE WHEN state='delete-pending' THEN state ELSE 'expired' END,handle_active=false,credit_state=CASE WHEN credit_state='settled' THEN 'settled' WHEN credit_state='reserved' AND (vendor_create_outcome_state='outcome-uncertain' OR (vendor_create_outcome_state='confirmed' AND vendor_delete_state<>'deleted')) THEN 'reserved' ELSE 'released' END,cleanup_lease_token=$3,cleanup_lease_expires_at=$4,updated_at=$2 WHERE id=$1", [jobId, now, input.leaseToken, input.leaseExpiresAt]);
        const loaded = await loadJob(client, jobId); if (loaded) records.push(loaded);
      }
      await client.query("COMMIT");
      return records;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async completeCleanup(input: Parameters<OmrStore["completeCleanup"]>[0]): Promise<boolean> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT state,cleanup_lease_token FROM omr_jobs WHERE id=$1 FOR UPDATE", [input.jobId]);
      if (!selected.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      if (selected.rows[0].cleanup_lease_token !== input.leaseToken) { await client.query("COMMIT"); return false; }
      if (input.update.state !== undefined && !isLegalOmrTransition(selected.rows[0].state, input.update.state)) throw new RangeError("OMR_STATE_TRANSITION_INVALID");
      await updateLockedJob(client, input.jobId, { ...input.update, cleanupLeaseToken: undefined, cleanupLeaseExpiresAt: undefined }, input.now);
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
