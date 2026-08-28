import "server-only";

import type { Pool, PoolClient } from "pg";

import type {
  AbuseReportInput, AbuseReportRecord, AbuseReportResolution, AbuseReportStatus, CleanupResult, DurableShareRecord, GovernanceStore,
  IdempotencyClaim, IdempotencyRecoveryLookup, ObjectPublicationGenerationRecord, ObjectReferenceRecord, PrivateRowId, QuotaConsumption, SessionRecord,
} from "./store";

type Queryable = Pick<Pool | PoolClient, "query">;

function id(value: string | number): PrivateRowId { return String(value) as PrivateRowId; }
function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : value; }
function sessionRow(row: Record<string, unknown>): SessionRecord {
  return {
    id: id(row.id as string), tokenHash: row.token_hash as string, csrfNonce: row.csrf_nonce as string,
    createdAt: iso(row.created_at as Date), expiresAt: iso(row.expires_at as Date),
    ...(row.revoked_at ? { revokedAt: iso(row.revoked_at as Date) } : {}),
  };
}
function shareRow(row: Record<string, unknown>): DurableShareRecord {
  return {
    id: id(row.id as string), ownerSessionId: id(row.owner_session_id as string),
    tokenHash: row.token_hash as string, deleteSecretVerifier: row.delete_secret_verifier as string,
    payloadDigest: row.payload_digest as string,
    encryptedPayload: row.encrypted_payload as DurableShareRecord["encryptedPayload"],
    plaintextSize: row.plaintext_size as number, rightsBasis: row.rights_basis as string,
    lifecycle: row.lifecycle as DurableShareRecord["lifecycle"], createdAt: iso(row.created_at as Date),
    expiresAt: iso(row.expires_at as Date),
    ...(row.disabled_at ? { disabledAt: iso(row.disabled_at as Date) } : {}),
    ...(row.deleted_at ? { deletedAt: iso(row.deleted_at as Date) } : {}),
  };
}
function abuseReportRow(row: Record<string, unknown>): AbuseReportRecord {
  return {
    id: id(row.id as string),
    ...(row.reporter_session_id ? { reporterSessionId: id(row.reporter_session_id as string) } : {}),
    ...(row.share_record_id ? { shareRecordId: id(row.share_record_id as string) } : {}),
    opaqueReferenceHash: row.opaque_reference_hash as string,
    category: row.category as string,
    ...(row.detail ? { detail: row.detail as string } : {}),
    createdAt: iso(row.created_at as Date),
    status: row.status as AbuseReportStatus,
    updatedAt: iso(row.updated_at as Date),
    ...(row.claim_token ? { claimToken: row.claim_token as string } : {}),
    ...(row.claim_expires_at ? { claimExpiresAt: iso(row.claim_expires_at as Date) } : {}),
    ...(row.claimed_by ? { claimedBy: row.claimed_by as string } : {}),
    ...(row.resolution ? { resolution: row.resolution as AbuseReportResolution } : {}),
    ...(row.resolved_at ? { resolvedAt: iso(row.resolved_at as Date) } : {}),
  };
}
function objectRow(row: Record<string, unknown>): ObjectReferenceRecord {
  return {
    id: id(row.id as string), ownerSessionId: id(row.owner_session_id as string),
    logicalPublicationKey: row.logical_publication_key as string,
    objectKey: row.object_key as string, contentType: row.content_type as string,
    byteSize: Number(row.byte_size), binaryDigest: row.binary_digest as string,
    lifecycle: row.lifecycle as ObjectReferenceRecord["lifecycle"], createdAt: iso(row.created_at as Date),
    ...(row.publication_token ? { publicationToken: row.publication_token as string } : {}),
    ...(row.publication_lease_expires_at ? { publicationLeaseExpiresAt: iso(row.publication_lease_expires_at as Date) } : {}),
    ...(row.publication_generation !== undefined ? { publicationGeneration: Number(row.publication_generation) } : {}),
    ...(row.publication_put_may_still_complete !== undefined ? { publicationPutMayStillComplete: row.publication_put_may_still_complete as boolean } : {}),
    ...(row.publication_predecessor_token ? { publicationPredecessorToken: row.publication_predecessor_token as string } : {}),
    ...(row.publication_predecessor_generation !== null && row.publication_predecessor_generation !== undefined ? { publicationPredecessorGeneration: Number(row.publication_predecessor_generation) } : {}),
    ...(row.publication_delete_confirmed_at ? { publicationDeleteConfirmedAt: iso(row.publication_delete_confirmed_at as Date) } : {}),
    ...(row.publication_cleanup_token ? { publicationCleanupToken: row.publication_cleanup_token as string } : {}),
    ...(row.publication_cleanup_lease_expires_at ? { publicationCleanupLeaseExpiresAt: iso(row.publication_cleanup_lease_expires_at as Date) } : {}),
    ...(row.expires_at ? { expiresAt: iso(row.expires_at as Date) } : {}),
    ...(row.deleted_at ? { deletedAt: iso(row.deleted_at as Date) } : {}),
  };
}
function objectPublicationGenerationRow(row: Record<string, unknown>): ObjectPublicationGenerationRecord {
  return {
    objectReferenceId: id(row.object_reference_id as string),
    publicationGeneration: Number(row.publication_generation),
    physicalObjectKey: row.physical_object_key as string,
    publicationToken: row.publication_token as string,
    publicationPutMayStillComplete: row.publication_put_may_still_complete as boolean,
    ...(row.publication_lease_expires_at ? { publicationLeaseExpiresAt: iso(row.publication_lease_expires_at as Date) } : {}),
    deleteOutcome: row.delete_outcome as ObjectPublicationGenerationRecord["deleteOutcome"],
    ...(row.delete_confirmed_at ? { deleteConfirmedAt: iso(row.delete_confirmed_at as Date) } : {}),
    ...(row.cleanup_token ? { cleanupToken: row.cleanup_token as string } : {}),
    ...(row.cleanup_lease_expires_at ? { cleanupLeaseExpiresAt: iso(row.cleanup_lease_expires_at as Date) } : {}),
    createdAt: iso(row.created_at as Date),
    updatedAt: iso(row.updated_at as Date),
    ...(row.deleted_at ? { deletedAt: iso(row.deleted_at as Date) } : {}),
  };
}

/** Direct PostgreSQL data access. No client-supplied owner is ever resolved here. */
export class PostgresGovernanceStore implements GovernanceStore {
  constructor(private readonly database: Pool) {}

  async createSession(input: Omit<SessionRecord, "id">): Promise<SessionRecord> {
    const result = await this.database.query(
      "INSERT INTO anonymous_sessions (token_hash, csrf_nonce, created_at, expires_at, revoked_at) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [input.tokenHash, input.csrfNonce, input.createdAt, input.expiresAt, input.revokedAt ?? null],
    );
    return sessionRow(result.rows[0]);
  }
  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined> {
    const result = await this.database.query("SELECT * FROM anonymous_sessions WHERE token_hash=$1", [tokenHash]);
    return result.rows[0] ? sessionRow(result.rows[0]) : undefined;
  }
  async revokeSession(sessionId: PrivateRowId, revokedAt: string): Promise<void> {
    await this.database.query("UPDATE anonymous_sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE id=$1", [sessionId, revokedAt]);
  }
  async consumeQuota(input: QuotaConsumption): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO quota_windows (owner_kind,owner_hash,policy_key,window_started_at,used_count,expires_at)
       VALUES ($1,$2,$3,$4,1,$5)
       ON CONFLICT (owner_kind,owner_hash,policy_key,window_started_at)
       DO UPDATE SET used_count=quota_windows.used_count+1
       WHERE quota_windows.used_count < $6 AND quota_windows.expires_at > $4
       RETURNING used_count`,
      [input.ownerKind, input.ownerHash, input.policyKey, input.windowStartedAt, input.expiresAt, input.limit],
    );
    return result.rowCount === 1;
  }
  async claimIdempotency(input: { readonly sessionId: PrivateRowId; readonly operation: string; readonly keyHash: string; readonly requestDigest: string; readonly createdAt: string; readonly claimExpiresAt: string; readonly expiresAt: string }): Promise<IdempotencyClaim> {
    const inserted = await this.database.query(
      `INSERT INTO idempotency_records (session_id,operation,key_hash,request_digest,state,created_at,claim_expires_at,expires_at)
       VALUES ($1,$2,$3,$4,'pending',$5,$6,$7)
       ON CONFLICT (session_id,operation,key_hash) DO UPDATE
       SET created_at=EXCLUDED.created_at,claim_expires_at=EXCLUDED.claim_expires_at,expires_at=EXCLUDED.expires_at
       WHERE idempotency_records.state='pending'
         AND idempotency_records.request_digest=EXCLUDED.request_digest
         AND idempotency_records.claim_expires_at <= EXCLUDED.created_at
       RETURNING id`,
      [input.sessionId, input.operation, input.keyHash, input.requestDigest, input.createdAt, input.claimExpiresAt, input.expiresAt],
    );
    if (inserted.rowCount === 1) return { status: "claimed", claimCreatedAt: input.createdAt };
    const existing = await this.database.query(
      "SELECT request_digest,state,response_json FROM idempotency_records WHERE session_id=$1 AND operation=$2 AND key_hash=$3",
      [input.sessionId, input.operation, input.keyHash],
    );
    const row = existing.rows[0];
    if (!row || row.request_digest !== input.requestDigest) return { status: "conflict" };
    return row.state === "complete" ? { status: "replay", response: row.response_json } : { status: "pending" };
  }
  async recoverIdempotency(input: { readonly operation: string; readonly keyHash: string; readonly requestDigest: string; readonly now: string }): Promise<IdempotencyRecoveryLookup> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT id,request_digest,state,response_json,claim_expires_at,expires_at FROM idempotency_records WHERE operation=$1 AND key_hash=$2 ORDER BY id LIMIT 2 FOR UPDATE",
        [input.operation, input.keyHash],
      );
      if (result.rows.length === 0) { await client.query("COMMIT"); return { status: "missing" }; }
      if (result.rows.length !== 1) { await client.query("COMMIT"); return { status: "ambiguous" }; }
      const row = result.rows[0];
      if (row.request_digest !== input.requestDigest) { await client.query("COMMIT"); return { status: "conflict" }; }
      if (row.state === "complete") {
        await client.query("COMMIT");
        return iso(row.expires_at as Date) <= input.now ? { status: "expired" } : { status: "replay", response: row.response_json };
      }
      if (iso(row.claim_expires_at as Date) > input.now) { await client.query("COMMIT"); return { status: "pending" }; }
      const retired = await client.query("DELETE FROM idempotency_records WHERE id=$1 AND state='pending'", [row.id]);
      if (retired.rowCount !== 1) throw new Error("IDEMPOTENCY_RECOVERY_FENCE_FAILED");
      await client.query("COMMIT");
      return { status: "retired-no-effect" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  async completeIdempotency(input: { readonly sessionId: PrivateRowId; readonly operation: string; readonly keyHash: string; readonly response: unknown }): Promise<void> {
    const result = await this.database.query(
      "UPDATE idempotency_records SET state='complete',response_json=$4 WHERE session_id=$1 AND operation=$2 AND key_hash=$3 AND state='pending'",
      [input.sessionId, input.operation, input.keyHash, JSON.stringify(input.response)],
    );
    if (result.rowCount !== 1) throw new Error("IDEMPOTENCY_NOT_CLAIMED");
  }
  async completeIdempotentShareCreation(input: { readonly sessionId: PrivateRowId; readonly operation: string; readonly keyHash: string; readonly requestDigest: string; readonly claimCreatedAt: string; readonly replayEnvelope: DurableShareRecord["encryptedPayload"]; readonly share?: Omit<DurableShareRecord, "id"> }): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        "SELECT request_digest,state,created_at FROM idempotency_records WHERE session_id=$1 AND operation=$2 AND key_hash=$3 FOR UPDATE",
        [input.sessionId, input.operation, input.keyHash],
      );
      const row = claimed.rows[0];
      if (!row || row.request_digest !== input.requestDigest || row.state !== "pending" || iso(row.created_at as Date) !== input.claimCreatedAt) throw new Error("IDEMPOTENCY_NOT_CLAIMED");
      if (input.share) {
        await client.query(
          `INSERT INTO share_records (owner_session_id,token_hash,delete_secret_verifier,payload_digest,encrypted_payload,plaintext_size,rights_basis,lifecycle,created_at,expires_at,disabled_at,deleted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [input.share.ownerSessionId, input.share.tokenHash, input.share.deleteSecretVerifier, input.share.payloadDigest, JSON.stringify(input.share.encryptedPayload), input.share.plaintextSize, input.share.rightsBasis, input.share.lifecycle, input.share.createdAt, input.share.expiresAt, input.share.disabledAt ?? null, input.share.deletedAt ?? null],
        );
      }
      const completed = await client.query(
        "UPDATE idempotency_records SET state='complete',response_json=$5 WHERE session_id=$1 AND operation=$2 AND key_hash=$3 AND request_digest=$4 AND state='pending'",
        [input.sessionId, input.operation, input.keyHash, input.requestDigest, JSON.stringify(input.replayEnvelope)],
      );
      if (completed.rowCount !== 1) throw new Error("IDEMPOTENCY_NOT_CLAIMED");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async releaseIdempotency(input: { readonly sessionId: PrivateRowId; readonly operation: string; readonly keyHash: string; readonly claimCreatedAt?: string }): Promise<void> {
    await this.database.query(
      "DELETE FROM idempotency_records WHERE session_id=$1 AND operation=$2 AND key_hash=$3 AND state='pending' AND ($4::timestamptz IS NULL OR created_at=$4)",
      [input.sessionId, input.operation, input.keyHash, input.claimCreatedAt ?? null],
    );
  }
  async createShare(input: Omit<DurableShareRecord, "id">): Promise<DurableShareRecord> {
    const result = await this.database.query(
      `INSERT INTO share_records (owner_session_id,token_hash,delete_secret_verifier,payload_digest,encrypted_payload,plaintext_size,rights_basis,lifecycle,created_at,expires_at,disabled_at,deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [input.ownerSessionId, input.tokenHash, input.deleteSecretVerifier, input.payloadDigest, JSON.stringify(input.encryptedPayload), input.plaintextSize, input.rightsBasis, input.lifecycle, input.createdAt, input.expiresAt, input.disabledAt ?? null, input.deletedAt ?? null],
    );
    return shareRow(result.rows[0]);
  }
  async findShareByTokenHash(tokenHash: string): Promise<DurableShareRecord | undefined> {
    const result = await this.database.query("SELECT * FROM share_records WHERE token_hash=$1", [tokenHash]);
    return result.rows[0] ? shareRow(result.rows[0]) : undefined;
  }
  async transitionShare(input: { readonly id: PrivateRowId; readonly lifecycle: "disabled" | "deleted" | "expired"; readonly at: string }): Promise<void> {
    const timestampColumn = input.lifecycle === "disabled" ? "disabled_at" : "deleted_at";
    await this.database.query(`UPDATE share_records SET lifecycle=$2,${timestampColumn}=COALESCE(${timestampColumn},$3) WHERE id=$1 AND lifecycle='active'`, [input.id, input.lifecycle, input.at]);
  }
  async createAbuseReport(input: AbuseReportInput): Promise<AbuseReportRecord> {
    const result = await this.database.query(
      "INSERT INTO abuse_reports (reporter_session_id,share_record_id,opaque_reference_hash,category,detail,created_at,status,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'pending',$6) RETURNING *",
      [input.reporterSessionId ?? null, input.shareRecordId ?? null, input.opaqueReferenceHash, input.category, input.detail ?? null, input.createdAt],
    );
    return abuseReportRow(result.rows[0]);
  }
  async listAbuseReports(input: { readonly status?: AbuseReportStatus; readonly limit: number }): Promise<readonly AbuseReportRecord[]> {
    const result = await this.database.query(
      `SELECT * FROM abuse_reports WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at,id LIMIT $2`,
      [input.status ?? null, input.limit],
    );
    return result.rows.map(abuseReportRow);
  }
  async claimAbuseReport(input: { readonly id: PrivateRowId; readonly moderatorId: string; readonly claimToken: string; readonly now: string; readonly claimExpiresAt: string }): Promise<AbuseReportRecord | undefined> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query(
        `UPDATE abuse_reports SET status='claimed',claim_token=$3,claim_expires_at=$4,claimed_by=$2,updated_at=$5
         WHERE id=$1 AND (status='pending' OR (status='claimed' AND claim_expires_at <= $5)) RETURNING *`,
        [input.id, input.moderatorId, input.claimToken, input.claimExpiresAt, input.now],
      );
      if (claimed.rowCount !== 1) { await client.query("ROLLBACK"); return undefined; }
      const row = abuseReportRow(claimed.rows[0]);
      await client.query(
        "INSERT INTO audit_events (event_kind,share_record_id,abuse_report_id,outcome,created_at) VALUES ('share-moderation-claim',$1,$2,$3,$4)",
        [row.shareRecordId ?? null, row.id, input.moderatorId, input.now],
      );
      await client.query("COMMIT");
      return row;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async resolveAbuseReport(input: { readonly id: PrivateRowId; readonly claimToken: string; readonly resolution: AbuseReportResolution; readonly now: string }): Promise<AbuseReportRecord | undefined> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query("SELECT * FROM abuse_reports WHERE id=$1 FOR UPDATE", [input.id]);
      const current = locked.rows[0];
      if (!current || current.status !== "claimed" || current.claim_token !== input.claimToken || iso(current.claim_expires_at as Date) <= input.now) {
        await client.query("ROLLBACK"); return undefined;
      }
      if (input.resolution === "takedown" && current.share_record_id) {
        await client.query("UPDATE share_records SET lifecycle='disabled',disabled_at=COALESCE(disabled_at,$2) WHERE id=$1 AND lifecycle='active'", [current.share_record_id, input.now]);
      }
      const resolved = await client.query(
        `UPDATE abuse_reports SET status='resolved',claim_token=NULL,claim_expires_at=NULL,resolution=$2,resolved_at=$3,updated_at=$3
         WHERE id=$1 RETURNING *`,
        [input.id, input.resolution, input.now],
      );
      const row = abuseReportRow(resolved.rows[0]);
      await client.query(
        "INSERT INTO audit_events (event_kind,share_record_id,abuse_report_id,outcome,created_at) VALUES ('share-moderation-resolve',$1,$2,$3,$4)",
        [row.shareRecordId ?? null, row.id, input.resolution, input.now],
      );
      await client.query("COMMIT");
      return row;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async createAudit(input: { readonly eventKind: string; readonly shareRecordId?: PrivateRowId; readonly abuseReportId?: PrivateRowId; readonly objectReferenceId?: PrivateRowId; readonly outcome: string; readonly createdAt: string }): Promise<void> {
    await this.database.query("INSERT INTO audit_events (event_kind,share_record_id,abuse_report_id,object_reference_id,outcome,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [input.eventKind, input.shareRecordId ?? null, input.abuseReportId ?? null, input.objectReferenceId ?? null, input.outcome, input.createdAt]);
  }
  async createObjectReference(input: Omit<ObjectReferenceRecord, "id">): Promise<ObjectReferenceRecord> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO object_references (owner_session_id,logical_publication_key,object_key,content_type,byte_size,binary_digest,lifecycle,created_at,expires_at,deleted_at,publication_token,publication_lease_expires_at,publication_generation,publication_put_may_still_complete,publication_predecessor_token,publication_predecessor_generation,publication_delete_confirmed_at,publication_cleanup_token,publication_cleanup_lease_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [input.ownerSessionId, input.logicalPublicationKey, input.objectKey, input.contentType, input.byteSize, input.binaryDigest, input.lifecycle, input.createdAt, input.expiresAt ?? null, input.deletedAt ?? null,
          input.publicationToken ?? null, input.publicationLeaseExpiresAt ?? null, input.publicationGeneration ?? 0, input.publicationPutMayStillComplete ?? false,
          input.publicationPredecessorToken ?? null, input.publicationPredecessorGeneration ?? null, input.publicationDeleteConfirmedAt ?? null,
          input.publicationCleanupToken ?? null, input.publicationCleanupLeaseExpiresAt ?? null],
      );
      const record = objectRow(result.rows[0]);
      if (input.publicationToken && input.publicationGeneration !== undefined) {
        await client.query(
          `INSERT INTO object_publication_generations
           (object_reference_id,publication_generation,physical_object_key,publication_token,publication_put_may_still_complete,
            publication_lease_expires_at,delete_outcome,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,'not-started',$7,$7)`,
          [record.id, input.publicationGeneration, input.objectKey, input.publicationToken,
            input.publicationPutMayStillComplete ?? false, input.publicationLeaseExpiresAt ?? null, input.createdAt],
        );
      }
      await client.query("COMMIT");
      return record;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async findObjectReference(objectId: PrivateRowId, ownerSessionId: PrivateRowId): Promise<ObjectReferenceRecord | undefined> {
    const result = await this.database.query("SELECT * FROM object_references WHERE id=$1 AND owner_session_id=$2", [objectId, ownerSessionId]);
    return result.rows[0] ? objectRow(result.rows[0]) : undefined;
  }
  async findObjectReferenceByKey(objectKey: string, ownerSessionId: PrivateRowId): Promise<ObjectReferenceRecord | undefined> {
    const result = await this.database.query("SELECT * FROM object_references WHERE object_key=$1 AND owner_session_id=$2", [objectKey, ownerSessionId]);
    return result.rows[0] ? objectRow(result.rows[0]) : undefined;
  }
  async findObjectReferenceByLogicalKey(logicalPublicationKey: string, ownerSessionId: PrivateRowId): Promise<ObjectReferenceRecord | undefined> {
    const result = await this.database.query("SELECT * FROM object_references WHERE logical_publication_key=$1 AND owner_session_id=$2", [logicalPublicationKey, ownerSessionId]);
    return result.rows[0] ? objectRow(result.rows[0]) : undefined;
  }
  async findObjectPublicationGeneration(input: Parameters<GovernanceStore["findObjectPublicationGeneration"]>[0]): Promise<ObjectPublicationGenerationRecord | undefined> {
    const result = await this.database.query(
      `SELECT generation.* FROM object_publication_generations generation
       JOIN object_references reference ON reference.id=generation.object_reference_id
       WHERE generation.object_reference_id=$1 AND generation.publication_generation=$2 AND reference.owner_session_id=$3`,
      [input.id, input.publicationGeneration, input.ownerSessionId],
    );
    return result.rows[0] ? objectPublicationGenerationRow(result.rows[0]) : undefined;
  }
  async listObjectPublicationGenerations(input: Parameters<GovernanceStore["listObjectPublicationGenerations"]>[0]): Promise<readonly ObjectPublicationGenerationRecord[]> {
    const result = await this.database.query(
      `SELECT generation.* FROM object_publication_generations generation
       JOIN object_references reference ON reference.id=generation.object_reference_id
       WHERE generation.object_reference_id=$1 AND reference.owner_session_id=$2 ORDER BY generation.publication_generation`,
      [input.id, input.ownerSessionId],
    );
    return result.rows.map(objectPublicationGenerationRow);
  }
  async completeObjectPublication(input: Parameters<GovernanceStore["completeObjectPublication"]>[0]): Promise<"active" | "delete-required" | "superseded"> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT * FROM object_references WHERE id=$1 AND owner_session_id=$2 FOR UPDATE", [input.id, input.ownerSessionId]);
      const row = selected.rows[0];
      if (!row) { await client.query("COMMIT"); return "superseded"; }
      const generationResult = await client.query(
        `SELECT * FROM object_publication_generations WHERE object_reference_id=$1 AND publication_generation=$2
         AND physical_object_key=$3 AND publication_token=$4 FOR UPDATE`,
        [input.id, input.publicationGeneration, input.objectKey, input.publicationToken],
      );
      if (!generationResult.rows[0]) { await client.query("COMMIT"); return "superseded"; }
      await client.query(
        `UPDATE object_publication_generations SET publication_put_may_still_complete=false,publication_lease_expires_at=NULL,
         delete_outcome=CASE WHEN $5 THEN 'not-started' ELSE delete_outcome END,
         delete_confirmed_at=CASE WHEN $5 THEN NULL ELSE delete_confirmed_at END,
         deleted_at=CASE WHEN $5 THEN NULL ELSE deleted_at END,updated_at=$6
         WHERE object_reference_id=$1 AND publication_generation=$2 AND physical_object_key=$3 AND publication_token=$4`,
        [input.id, input.publicationGeneration, input.objectKey, input.publicationToken, input.materialized, input.at],
      );
      const current = Number(row.publication_generation) === input.publicationGeneration;
      const predecessor = row.publication_predecessor_token === input.publicationToken && Number(row.publication_predecessor_generation) === input.publicationGeneration;
      if (!current) {
        if (predecessor) await client.query("UPDATE object_references SET publication_predecessor_token=NULL,publication_predecessor_generation=NULL WHERE id=$1", [input.id]);
        await client.query("COMMIT"); return "delete-required";
      }
      if (row.lifecycle === "active") { await client.query("COMMIT"); return "active"; }
      if (row.lifecycle !== "upload-pending") {
        await client.query(
          `UPDATE object_references SET publication_put_may_still_complete=false,publication_lease_expires_at=NULL,
           publication_delete_confirmed_at=CASE WHEN $2 THEN NULL ELSE publication_delete_confirmed_at END,
           publication_predecessor_token=CASE WHEN publication_predecessor_generation=$3 THEN NULL ELSE publication_predecessor_token END,
           publication_predecessor_generation=CASE WHEN publication_predecessor_generation=$3 THEN NULL ELSE publication_predecessor_generation END WHERE id=$1`,
          [input.id, input.materialized, input.publicationGeneration],
        );
        await client.query("COMMIT"); return "delete-required";
      }
      await client.query(
        `UPDATE object_references SET lifecycle='active',object_key=$2,publication_token=NULL,publication_lease_expires_at=NULL,
         publication_put_may_still_complete=false,publication_delete_confirmed_at=NULL,
         publication_cleanup_token=NULL,publication_cleanup_lease_expires_at=NULL,
         publication_predecessor_token=CASE WHEN publication_predecessor_generation=$3 THEN NULL ELSE publication_predecessor_token END,
         publication_predecessor_generation=CASE WHEN publication_predecessor_generation=$3 THEN NULL ELSE publication_predecessor_generation END WHERE id=$1`,
        [input.id, input.objectKey, input.publicationGeneration],
      );
      await client.query("COMMIT");
      return "active";
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async beginObjectPublicationAttempt(input: Parameters<GovernanceStore["beginObjectPublicationAttempt"]>[0]): Promise<boolean> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        `SELECT reference.object_key FROM object_references reference
         JOIN object_publication_generations generation ON generation.object_reference_id=reference.id
           AND generation.publication_generation=reference.publication_generation
         WHERE reference.id=$1 AND reference.owner_session_id=$2 AND reference.lifecycle='upload-pending'
           AND reference.publication_token=$3 AND reference.publication_generation=$4
           AND generation.publication_token=$3 AND generation.publication_put_may_still_complete=false FOR UPDATE OF reference,generation`,
        [input.id, input.ownerSessionId, input.publicationToken, input.publicationGeneration],
      );
      if (!selected.rows[0]) { await client.query("COMMIT"); return false; }
      await client.query(
        `UPDATE object_publication_generations SET publication_put_may_still_complete=true,publication_lease_expires_at=$3,updated_at=$4
         WHERE object_reference_id=$1 AND publication_generation=$2`,
        [input.id, input.publicationGeneration, input.publicationLeaseExpiresAt, input.at],
      );
      await client.query(
        "UPDATE object_references SET publication_put_may_still_complete=true,publication_lease_expires_at=$3 WHERE id=$1 AND publication_generation=$2",
        [input.id, input.publicationGeneration, input.publicationLeaseExpiresAt],
      );
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async restartObjectPublication(input: Parameters<GovernanceStore["restartObjectPublication"]>[0]): Promise<boolean> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT * FROM object_references WHERE id=$1 AND owner_session_id=$2 FOR UPDATE", [input.id, input.ownerSessionId]);
      const row = selected.rows[0];
      if (!row || row.logical_publication_key !== input.logicalPublicationKey || row.content_type !== input.contentType
        || Number(row.byte_size) !== input.byteSize || row.binary_digest !== input.binaryDigest) {
        await client.query("COMMIT"); return false;
      }
      const currentGeneration = Number(row.publication_generation);
      const currentResult = await client.query(
        "SELECT * FROM object_publication_generations WHERE object_reference_id=$1 AND publication_generation=$2 FOR UPDATE",
        [input.id, currentGeneration],
      );
      const current = currentResult.rows[0];
      const restartableTombstone = row.lifecycle === "tombstone-pending" && current
        && current.delete_confirmed_at !== null && current.publication_put_may_still_complete === true
        && current.cleanup_token === null;
      if (row.lifecycle !== "deleted" && !restartableTombstone) { await client.query("COMMIT"); return false; }
      if (row.publication_predecessor_generation !== null) {
        const predecessor = await client.query(
          "SELECT 1 FROM object_publication_generations WHERE object_reference_id=$1 AND publication_generation=$2",
          [input.id, row.publication_predecessor_generation],
        );
        if (!predecessor.rows[0]) { await client.query("COMMIT"); return false; }
      }
      const publicationGeneration = currentGeneration + 1;
      const inserted = await client.query(
        `INSERT INTO object_publication_generations
         (object_reference_id,publication_generation,physical_object_key,publication_token,publication_put_may_still_complete,
          publication_lease_expires_at,delete_outcome,created_at,updated_at)
         VALUES ($1,$2,$3,$4,true,$5,'not-started',$6,$6) ON CONFLICT DO NOTHING RETURNING publication_generation`,
        [input.id, publicationGeneration, input.objectKey, input.publicationToken, input.publicationLeaseExpiresAt, input.at],
      );
      if (!inserted.rows[0]) { await client.query("COMMIT"); return false; }
      await client.query(
        `UPDATE object_references SET lifecycle='upload-pending',object_key=$2,publication_token=$3,publication_lease_expires_at=$4,
         publication_generation=$5,publication_put_may_still_complete=true,
         publication_predecessor_token=CASE WHEN $6 THEN $7::text ELSE NULL END,
         publication_predecessor_generation=CASE WHEN $6 THEN $8::bigint ELSE NULL END,
         publication_delete_confirmed_at=NULL,publication_cleanup_token=NULL,publication_cleanup_lease_expires_at=NULL,deleted_at=NULL
         WHERE id=$1`,
        [input.id, input.objectKey, input.publicationToken, input.publicationLeaseExpiresAt, publicationGeneration,
          restartableTombstone, current?.publication_token ?? null, restartableTombstone ? currentGeneration : null],
      );
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async settleObjectPublicationPut(input: Parameters<GovernanceStore["settleObjectPublicationPut"]>[0]): Promise<"active" | "delete-required" | "settled" | "superseded"> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT * FROM object_references WHERE id=$1 AND owner_session_id=$2 FOR UPDATE", [input.id, input.ownerSessionId]);
      const row = selected.rows[0];
      if (!row) { await client.query("COMMIT"); return "superseded"; }
      const generation = await client.query(
        `SELECT * FROM object_publication_generations WHERE object_reference_id=$1 AND publication_generation=$2
         AND physical_object_key=$3 AND publication_token=$4 FOR UPDATE`,
        [input.id, input.publicationGeneration, input.objectKey, input.publicationToken],
      );
      if (!generation.rows[0]) { await client.query("COMMIT"); return "superseded"; }
      await client.query(
        `UPDATE object_publication_generations SET publication_put_may_still_complete=false,publication_lease_expires_at=NULL,
         delete_outcome=CASE WHEN $5 THEN 'not-started' ELSE delete_outcome END,
         delete_confirmed_at=CASE WHEN $5 THEN NULL ELSE delete_confirmed_at END,
         deleted_at=CASE WHEN $5 THEN NULL ELSE deleted_at END,updated_at=$6
         WHERE object_reference_id=$1 AND publication_generation=$2 AND physical_object_key=$3 AND publication_token=$4`,
        [input.id, input.publicationGeneration, input.objectKey, input.publicationToken, input.materialized, input.at],
      );
      const current = Number(row.publication_generation) === input.publicationGeneration;
      await client.query(
        `UPDATE object_references SET
         publication_put_may_still_complete=CASE WHEN publication_generation=$2 THEN false ELSE publication_put_may_still_complete END,
         publication_lease_expires_at=CASE WHEN publication_generation=$2 THEN NULL ELSE publication_lease_expires_at END,
         publication_delete_confirmed_at=CASE WHEN publication_generation=$2 AND $3 THEN NULL ELSE publication_delete_confirmed_at END,
         publication_predecessor_token=CASE WHEN publication_predecessor_generation=$2 THEN NULL ELSE publication_predecessor_token END,
         publication_predecessor_generation=CASE WHEN publication_predecessor_generation=$2 THEN NULL ELSE publication_predecessor_generation END
         WHERE id=$1`,
        [input.id, input.publicationGeneration, input.materialized],
      );
      await client.query("COMMIT");
      if (!current) return "delete-required";
      if (row.lifecycle === "active") return "active";
      return row.lifecycle === "tombstone-pending" || row.lifecycle === "delete-pending" || row.lifecycle === "deleted" ? "delete-required" : "settled";
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async claimObjectPublicationCleanup(input: Parameters<GovernanceStore["claimObjectPublicationCleanup"]>[0]): Promise<boolean> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        `SELECT reference.lifecycle,reference.publication_generation,generation.cleanup_token,generation.cleanup_lease_expires_at,generation.deleted_at
         FROM object_references reference JOIN object_publication_generations generation ON generation.object_reference_id=reference.id
         WHERE reference.id=$1 AND reference.owner_session_id=$2 AND generation.publication_generation=$3
           AND generation.physical_object_key=$4 FOR UPDATE OF reference,generation`,
        [input.id, input.ownerSessionId, input.publicationGeneration, input.objectKey],
      );
      const row = selected.rows[0];
      if (!row || row.deleted_at !== null || (Number(row.publication_generation) === input.publicationGeneration && row.lifecycle === "active")
        || (row.cleanup_token !== null && iso(row.cleanup_lease_expires_at as Date) > input.now)) {
        await client.query("COMMIT"); return false;
      }
      await client.query(
        `UPDATE object_publication_generations SET cleanup_token=$3,cleanup_lease_expires_at=$4,updated_at=$5
         WHERE object_reference_id=$1 AND publication_generation=$2`,
        [input.id, input.publicationGeneration, input.publicationCleanupToken, input.publicationCleanupLeaseExpiresAt, input.now],
      );
      if (Number(row.publication_generation) === input.publicationGeneration) {
        await client.query(
          `UPDATE object_references SET lifecycle=CASE WHEN lifecycle='upload-pending' THEN 'tombstone-pending' ELSE lifecycle END,
           publication_cleanup_token=$2,publication_cleanup_lease_expires_at=$3 WHERE id=$1`,
          [input.id, input.publicationCleanupToken, input.publicationCleanupLeaseExpiresAt],
        );
      }
      await client.query("COMMIT"); return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async completeObjectPublicationCleanup(input: Parameters<GovernanceStore["completeObjectPublicationCleanup"]>[0]): Promise<"reference-deleted" | "generation-deleted" | "tombstone" | "superseded"> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const referenceResult = await client.query("SELECT * FROM object_references WHERE id=$1 AND owner_session_id=$2 FOR UPDATE", [input.id, input.ownerSessionId]);
      const row = referenceResult.rows[0];
      const generationResult = await client.query(
        `SELECT * FROM object_publication_generations WHERE object_reference_id=$1 AND publication_generation=$2
         AND physical_object_key=$3 AND cleanup_token=$4 FOR UPDATE`,
        [input.id, input.publicationGeneration, input.objectKey, input.publicationCleanupToken],
      );
      const generation = generationResult.rows[0];
      if (!row || !generation) { await client.query("COMMIT"); return "superseded"; }
      const generationTerminal = generation.publication_put_may_still_complete === false;
      await client.query(
        `UPDATE object_publication_generations SET delete_outcome='acknowledged',delete_confirmed_at=$3,
         cleanup_token=NULL,cleanup_lease_expires_at=NULL,deleted_at=CASE WHEN $4 THEN $3::timestamptz ELSE NULL END,updated_at=$3
         WHERE object_reference_id=$1 AND publication_generation=$2`,
        [input.id, input.publicationGeneration, input.at, generationTerminal],
      );
      const current = Number(row.publication_generation) === input.publicationGeneration;
      const pending = generationTerminal ? await client.query(
        "SELECT 1 FROM object_publication_generations WHERE object_reference_id=$1 AND deleted_at IS NULL LIMIT 1",
        [input.id],
      ) : undefined;
      const referenceTerminal = generationTerminal && row.lifecycle !== "active" && !pending?.rows[0];
      if (referenceTerminal) {
        await client.query(
          `UPDATE object_references SET
           lifecycle='deleted',deleted_at=COALESCE(deleted_at,$2::timestamptz),publication_token=NULL,
           publication_lease_expires_at=NULL,publication_put_may_still_complete=false,
           publication_delete_confirmed_at=$2,publication_cleanup_token=NULL,publication_cleanup_lease_expires_at=NULL,
           publication_predecessor_token=NULL,publication_predecessor_generation=NULL
           WHERE id=$1`,
          [input.id, input.at],
        );
      } else if (current) {
        await client.query(
          `UPDATE object_references SET publication_delete_confirmed_at=$2,publication_cleanup_token=NULL,
           publication_cleanup_lease_expires_at=NULL WHERE id=$1`,
          [input.id, input.at],
        );
      } else if (generationTerminal && Number(row.publication_predecessor_generation) === input.publicationGeneration) {
        await client.query("UPDATE object_references SET publication_predecessor_token=NULL,publication_predecessor_generation=NULL WHERE id=$1", [input.id]);
      }
      await client.query("COMMIT");
      return referenceTerminal ? "reference-deleted" : generationTerminal ? "generation-deleted" : "tombstone";
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async markObjectPublicationDeleteUncertain(input: Parameters<GovernanceStore["markObjectPublicationDeleteUncertain"]>[0]): Promise<boolean> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE object_publication_generations SET delete_outcome='outcome-uncertain',cleanup_token=NULL,
         cleanup_lease_expires_at=NULL,updated_at=$6 WHERE object_reference_id=$1 AND publication_generation=$2
         AND physical_object_key=$3 AND cleanup_token=$4
         AND EXISTS (SELECT 1 FROM object_references WHERE id=$1 AND owner_session_id=$5) RETURNING publication_generation`,
        [input.id, input.publicationGeneration, input.objectKey, input.publicationCleanupToken, input.ownerSessionId, input.at],
      );
      if (result.rows[0]) {
        await client.query(
          `UPDATE object_references SET publication_cleanup_token=NULL,publication_cleanup_lease_expires_at=NULL
           WHERE id=$1 AND owner_session_id=$2 AND publication_generation=$3 AND publication_cleanup_token=$4`,
          [input.id, input.ownerSessionId, input.publicationGeneration, input.publicationCleanupToken],
        );
      }
      await client.query("COMMIT"); return Boolean(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async releaseObjectPublicationCleanup(input: Parameters<GovernanceStore["releaseObjectPublicationCleanup"]>[0]): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE object_publication_generations SET cleanup_token=NULL,cleanup_lease_expires_at=NULL
         WHERE object_reference_id=$1 AND publication_generation=$2 AND cleanup_token=$3
         AND EXISTS (SELECT 1 FROM object_references WHERE id=$1 AND owner_session_id=$4)`,
        [input.id, input.publicationGeneration, input.publicationCleanupToken, input.ownerSessionId],
      );
      await client.query(
        `UPDATE object_references SET publication_cleanup_token=NULL,publication_cleanup_lease_expires_at=NULL
         WHERE id=$1 AND owner_session_id=$2 AND publication_generation=$3 AND publication_cleanup_token=$4`,
        [input.id, input.ownerSessionId, input.publicationGeneration, input.publicationCleanupToken],
      );
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async transitionObjectReference(input: { readonly id: PrivateRowId; readonly ownerSessionId: PrivateRowId; readonly lifecycle: ObjectReferenceRecord["lifecycle"]; readonly at: string }): Promise<void> {
    await this.database.query(
      `UPDATE object_references SET lifecycle=$3,
       deleted_at=CASE WHEN $3='deleted' THEN COALESCE(deleted_at,$4::timestamptz) ELSE deleted_at END,
       publication_token=CASE WHEN $3='deleted' THEN NULL ELSE publication_token END,
       publication_lease_expires_at=CASE WHEN $3='deleted' THEN NULL ELSE publication_lease_expires_at END,
       publication_put_may_still_complete=CASE WHEN $3='deleted' THEN false ELSE publication_put_may_still_complete END,
       publication_predecessor_token=CASE WHEN $3='deleted' THEN NULL ELSE publication_predecessor_token END,
       publication_predecessor_generation=CASE WHEN $3='deleted' THEN NULL ELSE publication_predecessor_generation END,
       publication_cleanup_token=CASE WHEN $3='deleted' THEN NULL ELSE publication_cleanup_token END,
       publication_cleanup_lease_expires_at=CASE WHEN $3='deleted' THEN NULL ELSE publication_cleanup_lease_expires_at END
       WHERE id=$1 AND owner_session_id=$2`,
      [input.id, input.ownerSessionId, input.lifecycle, input.at],
    );
  }
  async cleanup(input: { readonly now: string; readonly batchSize: number; readonly dryRun: boolean }): Promise<CleanupResult> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const sessions = await this.cleanupIds(client, "anonymous_sessions", "expires_at <= $1 AND revoked_at IS NULL", input, "revoked_at=$1");
      const shares = await this.cleanupIds(client, "share_records", "expires_at <= $1 AND lifecycle='active'", input, "lifecycle='expired',deleted_at=$1");
      const pendingObjects = await client.query(
        `SELECT * FROM object_references WHERE lifecycle IN ('delete-pending','tombstone-pending')
          OR (lifecycle='upload-pending' AND (publication_put_may_still_complete=false OR publication_lease_expires_at <= $1))
          OR (lifecycle='active' AND expires_at <= $1)
          OR EXISTS (SELECT 1 FROM object_publication_generations generation
            WHERE generation.object_reference_id=object_references.id
              AND generation.publication_generation<>object_references.publication_generation
              AND generation.deleted_at IS NULL
              AND (generation.delete_outcome='outcome-uncertain' OR generation.delete_confirmed_at IS NOT NULL
                OR generation.publication_put_may_still_complete=false OR generation.publication_lease_expires_at <= $1))
          ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [input.now, input.batchSize],
      );
      const objects = pendingObjects.rows.map(objectRow);
      if (!input.dryRun && objects.length > 0) {
        await client.query(
          `UPDATE object_references SET lifecycle=CASE
             WHEN lifecycle='upload-pending' THEN 'tombstone-pending'
             WHEN lifecycle='active' AND expires_at <= $2 THEN 'delete-pending'
             ELSE lifecycle END
           WHERE id = ANY($1::bigint[]) AND lifecycle IN ('active','upload-pending')`,
          [objects.map((record) => record.id), input.now],
        );
      }
      const idempotency = await this.deleteExpired(client, "idempotency_records", input);
      const quota = await this.deleteExpired(client, "quota_windows", input);
      if (input.dryRun) await client.query("ROLLBACK"); else await client.query("COMMIT");
      return {
        expiredSessionIds: sessions, expiredShareIds: shares, expiredObjectIds: objects.map((record) => record.id),
        pendingObjectReferences: objects.map((record) => {
          if (input.dryRun || record.lifecycle === "delete-pending" || record.lifecycle === "tombstone-pending") return record;
          if (record.lifecycle === "upload-pending") return { ...record, lifecycle: "tombstone-pending" as const };
          if (record.lifecycle === "active" && record.expiresAt !== undefined && record.expiresAt <= input.now) {
            return { ...record, lifecycle: "delete-pending" as const };
          }
          return record;
        }),
        removedIdempotencyCount: idempotency, removedQuotaCount: quota,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  private async cleanupIds(client: Queryable, table: string, predicate: string, input: { readonly now: string; readonly batchSize: number; readonly dryRun: boolean }, update: string): Promise<readonly PrivateRowId[]> {
    const selected = await client.query(`SELECT id FROM ${table} WHERE ${predicate} ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`, [input.now, input.batchSize]);
    const ids = selected.rows.map((row) => id(row.id));
    if (!input.dryRun && ids.length > 0) await client.query(`UPDATE ${table} SET ${update} WHERE id = ANY($2::bigint[])`, [input.now, ids]);
    return ids;
  }
  private async deleteExpired(client: Queryable, table: string, input: { readonly now: string; readonly batchSize: number; readonly dryRun: boolean }): Promise<number> {
    if (input.dryRun) {
      const selected = await client.query(`SELECT 1 FROM ${table} WHERE expires_at <= $1 ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED`, [input.now, input.batchSize]);
      return selected.rows.length;
    }
    const deleted = await client.query(
      `WITH selected AS (
         SELECT ctid FROM ${table} WHERE expires_at <= $1 ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED
       ) DELETE FROM ${table} target USING selected WHERE target.ctid=selected.ctid RETURNING 1`,
      [input.now, input.batchSize],
    );
    return deleted.rows.length;
  }
}
