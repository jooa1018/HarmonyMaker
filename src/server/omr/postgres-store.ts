import "server-only";

import type { Pool, PoolClient } from "pg";

import type { AeadEnvelopeV1 } from "../security/crypto-core";
import type { PrivateRowId } from "../persistence/store";
import type {
  OmrCreateClaim, OmrOperationClaim, OmrPageClaim, OmrStore,
  DurableOmrJobRecord, OmrPageRecord,
} from "./store";
import { isLegalOmrTransition } from "./store";

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
    rights: json(row.rights_json), providerTransferConsent: true,
    providerConsentRecordedAt: iso(row.provider_consent_recorded_at), capabilities: json(row.capability_snapshot),
    capabilitySnapshotDigest: row.capability_snapshot_digest as DurableOmrJobRecord["capabilitySnapshotDigest"],
    vendorCreateIdempotencyKey: row.vendor_create_idempotency_key as string,
    vendorCreateLeaseExpiresAt: iso(row.vendor_create_lease_expires_at),
    ...(row.vendor_job_id_envelope ? { vendorJobIdEnvelope: json<AeadEnvelopeV1>(row.vendor_job_id_envelope) } : {}),
    creditEstimate: row.credit_estimate as number, creditState: row.credit_state as DurableOmrJobRecord["creditState"],
    pages, ...(row.progress_bp === null || row.progress_bp === undefined ? {} : { progressBp: row.progress_bp as number }),
    ...(row.current_input_request ? { currentInputRequest: json(row.current_input_request) } : {}),
    ...(row.accepted_input ? { acceptedInput: json(row.accepted_input) } : {}),
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
    ...(row.operation_lease_token ? { operationLeaseToken: row.operation_lease_token as string } : {}),
    ...(row.operation_lease_expires_at ? { operationLeaseExpiresAt: iso(row.operation_lease_expires_at) } : {}),
    ...(row.reconciliation_kind ? { reconciliationKind: row.reconciliation_kind as DurableOmrJobRecord["reconciliationKind"] } : {}),
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
  { key: "progressBp", column: "progress_bp" },
  { key: "vendorJobIdEnvelope", column: "vendor_job_id_envelope", json: true },
  { key: "currentInputRequest", column: "current_input_request", json: true },
  { key: "acceptedInput", column: "accepted_input", json: true },
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
  { key: "operationLeaseToken", column: "operation_lease_token" },
  { key: "operationLeaseExpiresAt", column: "operation_lease_expires_at" },
  { key: "reconciliationKind", column: "reconciliation_kind" },
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

  async claimCreate(input: Parameters<OmrStore["claimCreate"]>[0]): Promise<OmrCreateClaim> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1214349646)");
      const existing = await client.query(
        `SELECT i.request_digest,i.state AS idempotency_state,i.job_id,j.vendor_create_lease_expires_at,j.public_handle_replay_envelope
         FROM omr_create_idempotency i JOIN omr_jobs j ON j.id=i.job_id
         WHERE i.owner_session_id=$1 AND i.key_hash=$2 FOR UPDATE OF i,j`,
        [input.ownerSessionId, input.idempotencyKeyHash],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.request_digest !== input.requestDigest) { await client.query("ROLLBACK"); return { status: "conflict" }; }
        if (row.idempotency_state === "complete") { await client.query("COMMIT"); return { status: "replay", handleReplayEnvelope: json(row.public_handle_replay_envelope) }; }
        if (iso(row.vendor_create_lease_expires_at) > input.now) { await client.query("COMMIT"); return { status: "pending" }; }
        const job = await loadJob(client, id(row.job_id));
        if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
        await client.query("COMMIT");
        return { status: "resume", job };
      }
      const counts = await client.query(
        `SELECT
          count(*) FILTER (WHERE owner_session_id=$1 AND state IN ('created','uploading','queued','processing','needs-input','cancel-pending','cancel-failed'))::int AS session_active,
          count(*) FILTER (WHERE ip_owner_hash=$2 AND state IN ('created','uploading','queued','processing','needs-input','cancel-pending','cancel-failed'))::int AS ip_active,
          count(*) FILTER (WHERE owner_session_id=$1 AND created_at > $3::timestamptz - interval '1 hour')::int AS session_hour,
          count(*) FILTER (WHERE ip_owner_hash=$2 AND created_at > $3::timestamptz - interval '1 hour')::int AS ip_hour,
          COALESCE(sum(credit_estimate) FILTER (WHERE created_at >= date_trunc('day',$3::timestamptz) AND credit_state <> 'released'),0)::int AS day_credit
         FROM omr_jobs`,
        [input.ownerSessionId, input.ipOwnerHash, input.now],
      );
      const count = counts.rows[0];
      if (count.session_active >= input.quota.maxConcurrentJobsPerSession || count.ip_active >= input.quota.maxConcurrentJobsPerIp
        || count.session_hour >= input.quota.maxJobsPerSessionPerHour || count.ip_hour >= input.quota.maxJobsPerIpPerHour) {
        await client.query("ROLLBACK"); return { status: "quota-denied" };
      }
      if (count.day_credit + input.record.creditEstimate > input.quota.dailyGlobalCreditCeiling) {
        await client.query("ROLLBACK"); return { status: "credit-denied" };
      }
      const record = input.record;
      const inserted = await client.query(
        `INSERT INTO omr_jobs (
          owner_session_id,public_handle_hash,vendor_job_id_envelope,state,created_at,expires_at,
          ip_owner_hash,public_handle_replay_envelope,handle_active,source_kind,page_count,rights_json,
          provider_transfer_consent,provider_consent_recorded_at,capability_snapshot,vendor_create_idempotency_key,
          vendor_create_lease_expires_at,credit_estimate,credit_state,updated_at,capability_snapshot_digest,
          vendor_delete_state,local_delete_state)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,true,$8,$9,$10,true,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
        [record.ownerSessionId, record.publicHandleHash, record.state, record.createdAt, record.handleExpiresAt,
          record.ipOwnerHash, JSON.stringify(record.publicHandleReplayEnvelope), record.sourceKind, record.pageCount,
          JSON.stringify(record.rights), record.providerConsentRecordedAt, JSON.stringify(record.capabilities),
          record.vendorCreateIdempotencyKey, record.vendorCreateLeaseExpiresAt, record.creditEstimate, record.creditState, record.updatedAt,
          record.capabilitySnapshotDigest, record.vendorDeleteState, record.localDeleteState],
      );
      const jobId = id(inserted.rows[0].id);
      await client.query("INSERT INTO omr_create_idempotency (owner_session_id,key_hash,request_digest,job_id,state,created_at) VALUES ($1,$2,$3,$4,'pending',$5)", [input.ownerSessionId, input.idempotencyKeyHash, input.requestDigest, jobId, input.now]);
      const job = await loadJob(client, jobId); if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      await client.query("COMMIT");
      return { status: "claimed", job };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async completeVendorCreation(jobId: PrivateRowId, envelope: AeadEnvelopeV1, now: string): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query("UPDATE omr_jobs SET vendor_job_id_envelope=$2,updated_at=$3 WHERE id=$1 AND vendor_job_id_envelope IS NULL RETURNING id", [jobId, JSON.stringify(envelope), now]);
      if (updated.rowCount !== 1) {
        const found = await client.query("SELECT vendor_job_id_envelope FROM omr_jobs WHERE id=$1", [jobId]);
        if (!found.rows[0]) throw new RangeError("OMR_JOB_UNAVAILABLE");
      }
      await client.query("UPDATE omr_create_idempotency SET state='complete' WHERE job_id=$1", [jobId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async failVendorCreation(jobId: PrivateRowId, code: string, messageKo: string, now: string): Promise<void> {
    await this.transition(jobId, { state: "failed", creditState: "released", publicFailureCode: code, publicFailureMessageKo: messageKo }, now);
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

  async completePage(jobId: PrivateRowId, pageIndex: number, leaseToken: string, objectReferenceId: PrivateRowId, now: string): Promise<void> {
    const result = await this.database.query("UPDATE omr_pages SET processed_object_reference_id=$4,upload_state='uploaded',upload_lease_token=NULL,upload_lease_expires_at=NULL WHERE job_id=$1 AND page_ordinal=$2 AND upload_state='pending' AND upload_lease_token=$3", [jobId, pageIndex, leaseToken, objectReferenceId]);
    if (result.rowCount !== 1) throw new RangeError("OMR_PAGE_UNAVAILABLE");
    await this.database.query("UPDATE omr_jobs SET updated_at=$2 WHERE id=$1", [jobId, now]);
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
        if (job.operationKind !== input.kind || !input.supportsIdempotency) {
          await updateLockedJob(client, input.jobId, {
            state: "reconciliation-required", reconciliationKind: job.operationKind,
            operationKind: undefined, operationLeaseToken: undefined, operationLeaseExpiresAt: undefined,
          }, input.now);
          await client.query("COMMIT"); return { status: "reconciliation-required" };
        }
      } else if (!input.expectedStates.includes(job.state)) {
        await client.query("COMMIT"); return { status: "invalid" };
      }
      const resumed = Boolean(job.operationKind);
      await updateLockedJob(client, input.jobId, {
        ...(input.kind === "cancel" ? { state: "cancel-pending" as const } : {}),
        operationKind: input.kind, operationLeaseToken: input.leaseToken,
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
        ...input.update, operationKind: undefined, operationLeaseToken: undefined, operationLeaseExpiresAt: undefined,
      }, input.now);
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async failOperation(input: Parameters<OmrStore["failOperation"]>[0]): Promise<boolean> {
    return this.completeOperation(input);
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
    const result = await this.database.query("UPDATE omr_jobs SET handle_active=false,state='delete-pending',deleted_at=COALESCE(deleted_at,$2),credit_state='released',updated_at=$2 WHERE id=$1 AND handle_active=true", [jobId, now]);
    if (result.rowCount !== 1) throw new RangeError("OMR_JOB_UNAVAILABLE");
  }

  async recordAudit(jobId: PrivateRowId | undefined, eventKind: string, outcome: string, now: string): Promise<void> {
    await this.database.query(
      "INSERT INTO audit_events (event_kind,omr_job_id,outcome,created_at) VALUES ($1,$2,$3,$4)",
      [`omr:${eventKind}`.slice(0, 128), jobId ?? null, outcome.slice(0, 256), now],
    );
  }

  async claimCleanup(now: string, limit: number): Promise<readonly DurableOmrJobRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new RangeError("OMR_CLEANUP_LIMIT_INVALID");
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        `SELECT id FROM omr_jobs WHERE state <> 'deleted' AND (
           (handle_active=true AND expires_at <= $1)
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
        await client.query("UPDATE omr_jobs SET state=CASE WHEN state='delete-pending' THEN state ELSE 'expired' END,handle_active=false,credit_state='released',updated_at=$2 WHERE id=$1", [jobId, now]);
        const loaded = await loadJob(client, jobId); if (loaded) records.push(loaded);
      }
      await client.query("COMMIT");
      return records;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
}
