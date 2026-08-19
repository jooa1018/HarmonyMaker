import "server-only";

import type { Pool, PoolClient } from "pg";

import type {
  AbuseReportInput, CleanupResult, DurableShareRecord, GovernanceStore,
  IdempotencyClaim, ObjectReferenceRecord, PrivateRowId, QuotaConsumption, SessionRecord,
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
function objectRow(row: Record<string, unknown>): ObjectReferenceRecord {
  return {
    id: id(row.id as string), ownerSessionId: id(row.owner_session_id as string),
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
  async createAbuseReport(input: AbuseReportInput): Promise<void> {
    await this.database.query(
      "INSERT INTO abuse_reports (reporter_session_id,share_record_id,opaque_reference_hash,category,detail,created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [input.reporterSessionId ?? null, input.shareRecordId ?? null, input.opaqueReferenceHash, input.category, input.detail ?? null, input.createdAt],
    );
  }
  async createAudit(input: { readonly eventKind: string; readonly shareRecordId?: PrivateRowId; readonly objectReferenceId?: PrivateRowId; readonly outcome: string; readonly createdAt: string }): Promise<void> {
    await this.database.query("INSERT INTO audit_events (event_kind,share_record_id,object_reference_id,outcome,created_at) VALUES ($1,$2,$3,$4,$5)", [input.eventKind, input.shareRecordId ?? null, input.objectReferenceId ?? null, input.outcome, input.createdAt]);
  }
  async createObjectReference(input: Omit<ObjectReferenceRecord, "id">): Promise<ObjectReferenceRecord> {
    const result = await this.database.query(
      `INSERT INTO object_references (owner_session_id,object_key,content_type,byte_size,binary_digest,lifecycle,created_at,expires_at,deleted_at,publication_token,publication_lease_expires_at,publication_generation,publication_put_may_still_complete,publication_predecessor_token,publication_predecessor_generation,publication_delete_confirmed_at,publication_cleanup_token,publication_cleanup_lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [input.ownerSessionId, input.objectKey, input.contentType, input.byteSize, input.binaryDigest, input.lifecycle, input.createdAt, input.expiresAt ?? null, input.deletedAt ?? null,
        input.publicationToken ?? null, input.publicationLeaseExpiresAt ?? null, input.publicationGeneration ?? 0, input.publicationPutMayStillComplete ?? false,
        input.publicationPredecessorToken ?? null, input.publicationPredecessorGeneration ?? null, input.publicationDeleteConfirmedAt ?? null,
        input.publicationCleanupToken ?? null, input.publicationCleanupLeaseExpiresAt ?? null],
    );
    return objectRow(result.rows[0]);
  }
  async findObjectReference(objectId: PrivateRowId, ownerSessionId: PrivateRowId): Promise<ObjectReferenceRecord | undefined> {
    const result = await this.database.query("SELECT * FROM object_references WHERE id=$1 AND owner_session_id=$2", [objectId, ownerSessionId]);
    return result.rows[0] ? objectRow(result.rows[0]) : undefined;
  }
  async findObjectReferenceByKey(objectKey: string, ownerSessionId: PrivateRowId): Promise<ObjectReferenceRecord | undefined> {
    const result = await this.database.query("SELECT * FROM object_references WHERE object_key=$1 AND owner_session_id=$2", [objectKey, ownerSessionId]);
    return result.rows[0] ? objectRow(result.rows[0]) : undefined;
  }
  async completeObjectPublication(input: Parameters<GovernanceStore["completeObjectPublication"]>[0]): Promise<"active" | "delete-required" | "superseded"> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT * FROM object_references WHERE id=$1 AND owner_session_id=$2 FOR UPDATE", [input.id, input.ownerSessionId]);
      const row = selected.rows[0];
      if (!row) { await client.query("COMMIT"); return "superseded"; }
      const current = row.publication_token === input.publicationToken && Number(row.publication_generation) === input.publicationGeneration;
      const predecessor = row.publication_predecessor_token === input.publicationToken && Number(row.publication_predecessor_generation) === input.publicationGeneration;
      if (row.lifecycle === "active") {
        if (predecessor) await client.query("UPDATE object_references SET publication_predecessor_token=NULL,publication_predecessor_generation=NULL WHERE id=$1", [input.id]);
        await client.query("COMMIT");
        return "active";
      }
      if (predecessor) {
        await client.query("UPDATE object_references SET publication_predecessor_token=NULL,publication_predecessor_generation=NULL WHERE id=$1", [input.id]);
        await client.query("COMMIT");
        return row.lifecycle === "tombstone-pending" ? "delete-required" : "superseded";
      }
      if (!current) { await client.query("COMMIT"); return "superseded"; }
      if (row.lifecycle === "tombstone-pending") {
        await client.query("UPDATE object_references SET publication_put_may_still_complete=false,publication_lease_expires_at=NULL WHERE id=$1", [input.id]);
        await client.query("COMMIT");
        return "delete-required";
      }
      if (row.lifecycle !== "upload-pending") { await client.query("COMMIT"); return "superseded"; }
      await client.query(
        `UPDATE object_references SET lifecycle='active',publication_token=NULL,publication_lease_expires_at=NULL,
         publication_put_may_still_complete=false,publication_delete_confirmed_at=NULL,
         publication_cleanup_token=NULL,publication_cleanup_lease_expires_at=NULL WHERE id=$1`,
        [input.id],
      );
      await client.query("COMMIT");
      return "active";
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async beginObjectPublicationAttempt(input: Parameters<GovernanceStore["beginObjectPublicationAttempt"]>[0]): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE object_references SET publication_put_may_still_complete=true,publication_lease_expires_at=$5
       WHERE id=$1 AND owner_session_id=$2 AND lifecycle='upload-pending' AND publication_token=$3
         AND publication_generation=$4 AND publication_put_may_still_complete=false`,
      [input.id, input.ownerSessionId, input.publicationToken, input.publicationGeneration, input.publicationLeaseExpiresAt],
    );
    return (result.rowCount ?? 0) === 1;
  }
  async restartObjectPublication(input: Parameters<GovernanceStore["restartObjectPublication"]>[0]): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE object_references
       SET lifecycle='upload-pending',publication_token=$7,publication_lease_expires_at=$8,
         publication_generation=publication_generation+1,publication_put_may_still_complete=true,
         publication_predecessor_token=CASE WHEN lifecycle='tombstone-pending' THEN publication_token ELSE NULL END,
         publication_predecessor_generation=CASE WHEN lifecycle='tombstone-pending' THEN publication_generation ELSE NULL END,
         publication_delete_confirmed_at=NULL,publication_cleanup_token=NULL,publication_cleanup_lease_expires_at=NULL,deleted_at=NULL
       WHERE id=$1 AND owner_session_id=$2
         AND (lifecycle='deleted' OR (lifecycle='tombstone-pending' AND publication_delete_confirmed_at IS NOT NULL
           AND publication_put_may_still_complete=true AND publication_predecessor_token IS NULL AND publication_cleanup_token IS NULL))
         AND object_key=$3 AND content_type=$4 AND byte_size=$5 AND binary_digest=$6`,
      [input.id, input.ownerSessionId, input.objectKey, input.contentType, input.byteSize, input.binaryDigest, input.publicationToken, input.publicationLeaseExpiresAt],
    );
    return (result.rowCount ?? 0) === 1;
  }
  async settleObjectPublicationPut(input: Parameters<GovernanceStore["settleObjectPublicationPut"]>[0]): Promise<"active" | "delete-required" | "settled" | "superseded"> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query("SELECT lifecycle,publication_token,publication_generation,publication_predecessor_token,publication_predecessor_generation FROM object_references WHERE id=$1 AND owner_session_id=$2 FOR UPDATE", [input.id, input.ownerSessionId]);
      const row = selected.rows[0];
      if (!row) { await client.query("COMMIT"); return "superseded"; }
      const current = row.publication_token === input.publicationToken && Number(row.publication_generation) === input.publicationGeneration;
      const predecessor = row.publication_predecessor_token === input.publicationToken && Number(row.publication_predecessor_generation) === input.publicationGeneration;
      if (row.lifecycle === "active") {
        if (predecessor) await client.query("UPDATE object_references SET publication_predecessor_token=NULL,publication_predecessor_generation=NULL WHERE id=$1", [input.id]);
        await client.query("COMMIT"); return "active";
      }
      if (!current && !predecessor) { await client.query("COMMIT"); return "superseded"; }
      if (current) await client.query("UPDATE object_references SET publication_put_may_still_complete=false,publication_lease_expires_at=NULL WHERE id=$1", [input.id]);
      else await client.query("UPDATE object_references SET publication_predecessor_token=NULL,publication_predecessor_generation=NULL WHERE id=$1", [input.id]);
      await client.query("COMMIT");
      return row.lifecycle === "tombstone-pending" ? "delete-required" : "settled";
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async claimObjectPublicationCleanup(input: Parameters<GovernanceStore["claimObjectPublicationCleanup"]>[0]): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE object_references SET lifecycle='tombstone-pending',publication_cleanup_token=$5,publication_cleanup_lease_expires_at=$6
       WHERE id=$1 AND owner_session_id=$2 AND object_key=$3 AND publication_generation=$4
         AND (lifecycle IN ('upload-pending','tombstone-pending') OR (lifecycle='active' AND publication_predecessor_token IS NOT NULL))
         AND (publication_cleanup_token IS NULL OR publication_cleanup_lease_expires_at <= $7)`,
      [input.id, input.ownerSessionId, input.objectKey, input.publicationGeneration, input.publicationCleanupToken, input.publicationCleanupLeaseExpiresAt, input.now],
    );
    return (result.rowCount ?? 0) === 1;
  }
  async completeObjectPublicationCleanup(input: Parameters<GovernanceStore["completeObjectPublicationCleanup"]>[0]): Promise<"deleted" | "tombstone" | "superseded"> {
    const result = await this.database.query(
      `UPDATE object_references SET
         lifecycle=CASE WHEN publication_put_may_still_complete=false AND publication_predecessor_token IS NULL THEN 'deleted' ELSE 'tombstone-pending' END,
         deleted_at=CASE WHEN publication_put_may_still_complete=false AND publication_predecessor_token IS NULL THEN COALESCE(deleted_at,$6::timestamptz) ELSE deleted_at END,
         publication_token=CASE WHEN publication_put_may_still_complete=false AND publication_predecessor_token IS NULL THEN NULL ELSE publication_token END,
         publication_lease_expires_at=CASE WHEN publication_put_may_still_complete=false AND publication_predecessor_token IS NULL THEN NULL ELSE publication_lease_expires_at END,
         publication_delete_confirmed_at=$6,publication_cleanup_token=NULL,publication_cleanup_lease_expires_at=NULL
       WHERE id=$1 AND owner_session_id=$2 AND object_key=$3 AND publication_generation=$4
         AND lifecycle='tombstone-pending' AND publication_cleanup_token=$5 RETURNING lifecycle`,
      [input.id, input.ownerSessionId, input.objectKey, input.publicationGeneration, input.publicationCleanupToken, input.at],
    );
    if (result.rowCount !== 1) return "superseded";
    return result.rows[0].lifecycle === "deleted" ? "deleted" : "tombstone";
  }
  async releaseObjectPublicationCleanup(input: Parameters<GovernanceStore["releaseObjectPublicationCleanup"]>[0]): Promise<void> {
    await this.database.query(
      `UPDATE object_references SET publication_cleanup_token=NULL,publication_cleanup_lease_expires_at=NULL
       WHERE id=$1 AND owner_session_id=$2 AND publication_generation=$3 AND publication_cleanup_token=$4`,
      [input.id, input.ownerSessionId, input.publicationGeneration, input.publicationCleanupToken],
    );
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
          OR (lifecycle='active' AND expires_at <= $1) ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [input.now, input.batchSize],
      );
      const objects = pendingObjects.rows.map(objectRow);
      if (!input.dryRun && objects.length > 0) {
        await client.query(
          `UPDATE object_references SET lifecycle=CASE
             WHEN lifecycle='upload-pending' OR (lifecycle='active' AND publication_predecessor_token IS NOT NULL) THEN 'tombstone-pending'
             ELSE 'delete-pending' END
           WHERE id = ANY($1::bigint[]) AND lifecycle IN ('active','upload-pending')`,
          [objects.map((record) => record.id)],
        );
      }
      const idempotency = await this.deleteExpired(client, "idempotency_records", input);
      const quota = await this.deleteExpired(client, "quota_windows", input);
      if (input.dryRun) await client.query("ROLLBACK"); else await client.query("COMMIT");
      return {
        expiredSessionIds: sessions, expiredShareIds: shares, expiredObjectIds: objects.map((record) => record.id),
        pendingObjectReferences: objects.map((record) => {
          if (input.dryRun || record.lifecycle === "delete-pending" || record.lifecycle === "tombstone-pending") return record;
          return { ...record, lifecycle: record.lifecycle === "upload-pending" || record.publicationPredecessorToken !== undefined ? "tombstone-pending" as const : "delete-pending" as const };
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
