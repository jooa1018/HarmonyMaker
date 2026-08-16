import type { AeadEnvelopeV1 } from "../security/crypto-core";

export type PrivateRowId = string & { readonly __brand: "PrivateRowId" };

export interface SessionRecord {
  readonly id: PrivateRowId;
  readonly tokenHash: string;
  readonly csrfNonce: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
}

export type ShareLifecycle = "active" | "disabled" | "deleted" | "expired";
export interface DurableShareRecord {
  readonly id: PrivateRowId;
  readonly ownerSessionId: PrivateRowId;
  readonly tokenHash: string;
  readonly deleteSecretVerifier: string;
  readonly payloadDigest: string;
  readonly encryptedPayload: AeadEnvelopeV1;
  readonly plaintextSize: number;
  readonly rightsBasis: string;
  readonly lifecycle: ShareLifecycle;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly disabledAt?: string;
  readonly deletedAt?: string;
}

export interface QuotaConsumption {
  readonly ownerKind: "session" | "ip-hmac";
  readonly ownerHash: string;
  readonly policyKey: string;
  readonly windowStartedAt: string;
  readonly expiresAt: string;
  readonly limit: number;
}

export type IdempotencyClaim =
  | { readonly status: "claimed" }
  | { readonly status: "replay"; readonly response: unknown }
  | { readonly status: "pending" }
  | { readonly status: "conflict" };

export interface AbuseReportInput {
  readonly reporterSessionId?: PrivateRowId;
  readonly shareRecordId?: PrivateRowId;
  readonly opaqueReferenceHash: string;
  readonly category: string;
  readonly detail?: string;
  readonly createdAt: string;
}

export interface ObjectReferenceRecord {
  readonly id: PrivateRowId;
  readonly ownerSessionId: PrivateRowId;
  readonly objectKey: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly binaryDigest: string;
  readonly lifecycle: "active" | "delete-pending" | "deleted" | "expired";
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly deletedAt?: string;
}

export interface CleanupResult {
  readonly expiredSessionIds: readonly PrivateRowId[];
  readonly expiredShareIds: readonly PrivateRowId[];
  readonly expiredObjectIds: readonly PrivateRowId[];
  readonly pendingObjectReferences: readonly ObjectReferenceRecord[];
  readonly removedIdempotencyCount: number;
  readonly removedQuotaCount: number;
}

export interface GovernanceStore {
  createSession(input: Omit<SessionRecord, "id">): Promise<SessionRecord>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined>;
  revokeSession(id: PrivateRowId, revokedAt: string): Promise<void>;
  consumeQuota(input: QuotaConsumption): Promise<boolean>;
  claimIdempotency(input: {
    readonly sessionId: PrivateRowId;
    readonly operation: string;
    readonly keyHash: string;
    readonly requestDigest: string;
    readonly createdAt: string;
    readonly claimExpiresAt: string;
    readonly expiresAt: string;
  }): Promise<IdempotencyClaim>;
  completeIdempotency(input: {
    readonly sessionId: PrivateRowId;
    readonly operation: string;
    readonly keyHash: string;
    readonly response: unknown;
  }): Promise<void>;
  releaseIdempotency(input: {
    readonly sessionId: PrivateRowId;
    readonly operation: string;
    readonly keyHash: string;
  }): Promise<void>;
  createShare(input: Omit<DurableShareRecord, "id">): Promise<DurableShareRecord>;
  findShareByTokenHash(tokenHash: string): Promise<DurableShareRecord | undefined>;
  transitionShare(input: {
    readonly id: PrivateRowId;
    readonly lifecycle: Exclude<ShareLifecycle, "active">;
    readonly at: string;
  }): Promise<void>;
  createAbuseReport(input: AbuseReportInput): Promise<void>;
  createAudit(input: {
    readonly eventKind: string;
    readonly shareRecordId?: PrivateRowId;
    readonly objectReferenceId?: PrivateRowId;
    readonly outcome: string;
    readonly createdAt: string;
  }): Promise<void>;
  createObjectReference(input: Omit<ObjectReferenceRecord, "id">): Promise<ObjectReferenceRecord>;
  findObjectReference(id: PrivateRowId, ownerSessionId: PrivateRowId): Promise<ObjectReferenceRecord | undefined>;
  transitionObjectReference(input: {
    readonly id: PrivateRowId;
    readonly ownerSessionId: PrivateRowId;
    readonly lifecycle: ObjectReferenceRecord["lifecycle"];
    readonly at: string;
  }): Promise<void>;
  cleanup(input: { readonly now: string; readonly batchSize: number; readonly dryRun: boolean }): Promise<CleanupResult>;
}
