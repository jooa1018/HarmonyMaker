import type {
  AbuseReportInput, CleanupResult, DurableShareRecord, GovernanceStore,
  IdempotencyClaim, ObjectReferenceRecord, PrivateRowId, QuotaConsumption, SessionRecord,
} from "./store";

interface IdempotencyState {
  readonly requestDigest: string;
  readonly claimCreatedAt: string;
  readonly expiresAt: string;
  readonly claimExpiresAt: string;
  response?: unknown;
}

/** Explicit deterministic test adapter. Production composition never imports this module. */
export class MemoryGovernanceStore implements GovernanceStore {
  private sequence = 0;
  readonly sessions = new Map<PrivateRowId, SessionRecord>();
  readonly shares = new Map<PrivateRowId, DurableShareRecord>();
  readonly reports: AbuseReportInput[] = [];
  readonly audits: Array<Readonly<Record<string, unknown>>> = [];
  readonly objects = new Map<PrivateRowId, ObjectReferenceRecord>();
  private readonly quota = new Map<string, { used: number; expiresAt: string }>();
  private readonly idempotency = new Map<string, IdempotencyState>();
  failNextIdempotentShareCommit = false;

  idempotencyResponses(): readonly unknown[] { return [...this.idempotency.values()].flatMap((record) => record.response === undefined ? [] : [structuredClone(record.response)]); }

  private id(): PrivateRowId {
    this.sequence += 1;
    return String(this.sequence) as PrivateRowId;
  }

  async createSession(input: Omit<SessionRecord, "id">): Promise<SessionRecord> {
    if ([...this.sessions.values()].some((record) => record.tokenHash === input.tokenHash)) throw new Error("PERSISTENCE_CONFLICT");
    const record = { ...input, id: this.id() };
    this.sessions.set(record.id, record);
    return record;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | undefined> {
    return [...this.sessions.values()].find((record) => record.tokenHash === tokenHash);
  }

  async revokeSession(id: PrivateRowId, revokedAt: string): Promise<void> {
    const record = this.sessions.get(id);
    if (record) this.sessions.set(id, { ...record, revokedAt });
  }

  async consumeQuota(input: QuotaConsumption): Promise<boolean> {
    const key = `${input.ownerKind}:${input.ownerHash}:${input.policyKey}:${input.windowStartedAt}`;
    const current = this.quota.get(key);
    const used = current?.used ?? 0;
    if (used >= input.limit) return false;
    this.quota.set(key, { used: used + 1, expiresAt: input.expiresAt });
    return true;
  }

  async claimIdempotency(input: {
    readonly sessionId: PrivateRowId; readonly operation: string; readonly keyHash: string;
    readonly requestDigest: string; readonly createdAt: string; readonly claimExpiresAt: string; readonly expiresAt: string;
  }): Promise<IdempotencyClaim> {
    const key = `${input.sessionId}:${input.operation}:${input.keyHash}`;
    const found = this.idempotency.get(key);
    if (found) {
      if (found.requestDigest !== input.requestDigest) return { status: "conflict" };
      if (found.response === undefined && found.claimExpiresAt <= input.createdAt) {
        this.idempotency.set(key, { requestDigest: input.requestDigest, expiresAt: input.expiresAt, claimExpiresAt: input.claimExpiresAt, claimCreatedAt: input.createdAt });
        return { status: "claimed", claimCreatedAt: input.createdAt };
      }
      return found.response === undefined ? { status: "pending" } : { status: "replay", response: found.response };
    }
    this.idempotency.set(key, { requestDigest: input.requestDigest, expiresAt: input.expiresAt, claimExpiresAt: input.claimExpiresAt, claimCreatedAt: input.createdAt });
    return { status: "claimed", claimCreatedAt: input.createdAt };
  }

  async completeIdempotency(input: { readonly sessionId: PrivateRowId; readonly operation: string; readonly keyHash: string; readonly response: unknown }): Promise<void> {
    const key = `${input.sessionId}:${input.operation}:${input.keyHash}`;
    const found = this.idempotency.get(key);
    if (!found) throw new Error("IDEMPOTENCY_NOT_CLAIMED");
    found.response = structuredClone(input.response);
  }

  async completeIdempotentShareCreation(input: { readonly sessionId: PrivateRowId; readonly operation: string; readonly keyHash: string; readonly requestDigest: string; readonly claimCreatedAt: string; readonly replayEnvelope: DurableShareRecord["encryptedPayload"]; readonly share?: Omit<DurableShareRecord, "id"> }): Promise<void> {
    const key = `${input.sessionId}:${input.operation}:${input.keyHash}`;
    const found = this.idempotency.get(key);
    if (!found || found.requestDigest !== input.requestDigest || found.response !== undefined || found.claimCreatedAt !== input.claimCreatedAt) throw new Error("IDEMPOTENCY_NOT_CLAIMED");
    if (input.share && [...this.shares.values()].some((record) => record.tokenHash === input.share!.tokenHash)) throw new Error("PERSISTENCE_CONFLICT");
    const stagedShare = input.share ? { ...structuredClone(input.share), id: this.id() } as DurableShareRecord : undefined;
    if (this.failNextIdempotentShareCommit) {
      this.failNextIdempotentShareCommit = false;
      throw new Error("SIMULATED_CRASH_AFTER_EFFECT_BEFORE_COMMIT");
    }
    if (stagedShare) this.shares.set(stagedShare.id, stagedShare);
    found.response = structuredClone(input.replayEnvelope);
  }

  async releaseIdempotency(input: { readonly sessionId: PrivateRowId; readonly operation: string; readonly keyHash: string; readonly claimCreatedAt?: string }): Promise<void> {
    const key = `${input.sessionId}:${input.operation}:${input.keyHash}`;
    const found = this.idempotency.get(key);
    if (found && found.response === undefined && (input.claimCreatedAt === undefined || found.claimCreatedAt === input.claimCreatedAt)) this.idempotency.delete(key);
  }

  async createShare(input: Omit<DurableShareRecord, "id">): Promise<DurableShareRecord> {
    if ([...this.shares.values()].some((record) => record.tokenHash === input.tokenHash)) throw new Error("PERSISTENCE_CONFLICT");
    const record = { ...structuredClone(input), id: this.id() } as DurableShareRecord;
    this.shares.set(record.id, record);
    return record;
  }

  async findShareByTokenHash(tokenHash: string): Promise<DurableShareRecord | undefined> {
    return [...this.shares.values()].find((record) => record.tokenHash === tokenHash);
  }

  async transitionShare(input: { readonly id: PrivateRowId; readonly lifecycle: "disabled" | "deleted" | "expired"; readonly at: string }): Promise<void> {
    const record = this.shares.get(input.id);
    if (!record || record.lifecycle !== "active") return;
    this.shares.set(input.id, {
      ...record,
      lifecycle: input.lifecycle,
      ...(input.lifecycle === "disabled" ? { disabledAt: input.at } : { deletedAt: input.at }),
    });
  }

  async createAbuseReport(input: AbuseReportInput): Promise<void> { this.reports.push(structuredClone(input)); }
  async createAudit(input: Readonly<Record<string, unknown>> & { readonly eventKind: string; readonly outcome: string; readonly createdAt: string }): Promise<void> { this.audits.push(structuredClone(input)); }

  async createObjectReference(input: Omit<ObjectReferenceRecord, "id">): Promise<ObjectReferenceRecord> {
    const record = { ...input, id: this.id() };
    this.objects.set(record.id, record);
    return record;
  }

  async findObjectReference(id: PrivateRowId, ownerSessionId: PrivateRowId): Promise<ObjectReferenceRecord | undefined> {
    const record = this.objects.get(id);
    return record?.ownerSessionId === ownerSessionId ? record : undefined;
  }

  async findObjectReferenceByKey(objectKey: string, ownerSessionId: PrivateRowId): Promise<ObjectReferenceRecord | undefined> {
    return [...this.objects.values()].find((record) => record.objectKey === objectKey && record.ownerSessionId === ownerSessionId);
  }

  private publicationAuthority(record: ObjectReferenceRecord, publicationToken: string, publicationGeneration: number): "current" | "predecessor" | undefined {
    if (record.publicationToken === publicationToken && record.publicationGeneration === publicationGeneration) return "current";
    if (record.publicationPredecessorToken === publicationToken && record.publicationPredecessorGeneration === publicationGeneration) return "predecessor";
    return undefined;
  }

  async completeObjectPublication(input: Parameters<GovernanceStore["completeObjectPublication"]>[0]): Promise<"active" | "delete-required" | "superseded"> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    if (!record || record.objectKey !== input.objectKey) return "superseded";
    const authority = this.publicationAuthority(record, input.publicationToken, input.publicationGeneration);
    if (record.lifecycle === "active") {
      if (authority === "predecessor") this.objects.set(record.id, { ...record, publicationPredecessorToken: undefined, publicationPredecessorGeneration: undefined });
      return "active";
    }
    if (authority === "predecessor") {
      this.objects.set(record.id, { ...record, publicationPredecessorToken: undefined, publicationPredecessorGeneration: undefined });
      return record.lifecycle === "tombstone-pending" ? "delete-required" : "superseded";
    }
    if (authority !== "current") return "superseded";
    if (record.lifecycle === "tombstone-pending") {
      this.objects.set(record.id, { ...record, publicationPutMayStillComplete: false, publicationLeaseExpiresAt: undefined });
      return "delete-required";
    }
    if (record.lifecycle !== "upload-pending") return "superseded";
    this.objects.set(record.id, {
      ...record,
      lifecycle: "active",
      publicationToken: undefined,
      publicationLeaseExpiresAt: undefined,
      publicationPutMayStillComplete: false,
      publicationDeleteConfirmedAt: undefined,
      publicationCleanupToken: undefined,
      publicationCleanupLeaseExpiresAt: undefined,
    });
    return "active";
  }

  async beginObjectPublicationAttempt(input: Parameters<GovernanceStore["beginObjectPublicationAttempt"]>[0]): Promise<boolean> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    if (!record || record.lifecycle !== "upload-pending" || record.publicationToken !== input.publicationToken
      || record.publicationGeneration !== input.publicationGeneration || record.publicationPutMayStillComplete !== false) return false;
    this.objects.set(record.id, { ...record, publicationPutMayStillComplete: true, publicationLeaseExpiresAt: input.publicationLeaseExpiresAt });
    return true;
  }

  async restartObjectPublication(input: Parameters<GovernanceStore["restartObjectPublication"]>[0]): Promise<boolean> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    const restartableTombstone = record?.lifecycle === "tombstone-pending"
      && record.publicationDeleteConfirmedAt !== undefined
      && record.publicationPutMayStillComplete === true
      && record.publicationPredecessorToken === undefined
      && record.publicationCleanupToken === undefined;
    if (!record || (record.lifecycle !== "deleted" && !restartableTombstone) || record.objectKey !== input.objectKey || record.contentType !== input.contentType
      || record.byteSize !== input.byteSize || record.binaryDigest !== input.binaryDigest) return false;
    this.objects.set(record.id, {
      ...record,
      lifecycle: "upload-pending",
      publicationToken: input.publicationToken,
      publicationLeaseExpiresAt: input.publicationLeaseExpiresAt,
      publicationGeneration: (record.publicationGeneration ?? 0) + 1,
      publicationPutMayStillComplete: true,
      ...(restartableTombstone ? {
        publicationPredecessorToken: record.publicationToken,
        publicationPredecessorGeneration: record.publicationGeneration,
      } : { publicationPredecessorToken: undefined, publicationPredecessorGeneration: undefined }),
      publicationDeleteConfirmedAt: undefined,
      publicationCleanupToken: undefined,
      publicationCleanupLeaseExpiresAt: undefined,
      deletedAt: undefined,
    });
    return true;
  }

  async settleObjectPublicationPut(input: Parameters<GovernanceStore["settleObjectPublicationPut"]>[0]): Promise<"active" | "delete-required" | "settled" | "superseded"> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    if (!record || record.objectKey !== input.objectKey) return "superseded";
    const authority = this.publicationAuthority(record, input.publicationToken, input.publicationGeneration);
    if (record.lifecycle === "active") {
      if (authority === "predecessor") this.objects.set(record.id, { ...record, publicationPredecessorToken: undefined, publicationPredecessorGeneration: undefined });
      return "active";
    }
    if (!authority) return "superseded";
    const settled = authority === "current"
      ? { ...record, publicationPutMayStillComplete: false, publicationLeaseExpiresAt: undefined }
      : { ...record, publicationPredecessorToken: undefined, publicationPredecessorGeneration: undefined };
    this.objects.set(record.id, settled);
    return record.lifecycle === "tombstone-pending" ? "delete-required" : "settled";
  }

  async claimObjectPublicationCleanup(input: Parameters<GovernanceStore["claimObjectPublicationCleanup"]>[0]): Promise<boolean> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    if (!record || record.objectKey !== input.objectKey || record.publicationGeneration !== input.publicationGeneration
      || !["upload-pending", "tombstone-pending", "active"].includes(record.lifecycle)
      || (record.lifecycle === "active" && record.publicationPredecessorToken === undefined)
      || (record.publicationCleanupToken !== undefined && (record.publicationCleanupLeaseExpiresAt ?? input.now) > input.now)) return false;
    this.objects.set(record.id, {
      ...record,
      lifecycle: "tombstone-pending",
      publicationCleanupToken: input.publicationCleanupToken,
      publicationCleanupLeaseExpiresAt: input.publicationCleanupLeaseExpiresAt,
    });
    return true;
  }

  async completeObjectPublicationCleanup(input: Parameters<GovernanceStore["completeObjectPublicationCleanup"]>[0]): Promise<"deleted" | "tombstone" | "superseded"> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    if (!record || record.lifecycle !== "tombstone-pending" || record.objectKey !== input.objectKey
      || record.publicationGeneration !== input.publicationGeneration || record.publicationCleanupToken !== input.publicationCleanupToken) return "superseded";
    const terminal = record.publicationPutMayStillComplete === false && record.publicationPredecessorToken === undefined;
    this.objects.set(record.id, terminal ? {
      ...record,
      lifecycle: "deleted",
      publicationToken: undefined,
      publicationLeaseExpiresAt: undefined,
      publicationPutMayStillComplete: false,
      publicationPredecessorToken: undefined,
      publicationPredecessorGeneration: undefined,
      publicationDeleteConfirmedAt: input.at,
      publicationCleanupToken: undefined,
      publicationCleanupLeaseExpiresAt: undefined,
      deletedAt: input.at,
    } : {
      ...record,
      publicationDeleteConfirmedAt: input.at,
      publicationCleanupToken: undefined,
      publicationCleanupLeaseExpiresAt: undefined,
    });
    return terminal ? "deleted" : "tombstone";
  }

  async releaseObjectPublicationCleanup(input: Parameters<GovernanceStore["releaseObjectPublicationCleanup"]>[0]): Promise<void> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    if (record?.publicationGeneration === input.publicationGeneration && record.publicationCleanupToken === input.publicationCleanupToken) {
      this.objects.set(record.id, { ...record, publicationCleanupToken: undefined, publicationCleanupLeaseExpiresAt: undefined });
    }
  }

  async transitionObjectReference(input: { readonly id: PrivateRowId; readonly ownerSessionId: PrivateRowId; readonly lifecycle: ObjectReferenceRecord["lifecycle"]; readonly at: string }): Promise<void> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    if (record) this.objects.set(record.id, { ...record, lifecycle: input.lifecycle, ...(input.lifecycle === "deleted" ? { deletedAt: input.at, publicationToken: undefined, publicationLeaseExpiresAt: undefined } : {}) });
  }

  async cleanup(input: { readonly now: string; readonly batchSize: number; readonly dryRun: boolean }): Promise<CleanupResult> {
    const expiredSessionIds = [...this.sessions.values()].filter((record) => record.expiresAt <= input.now).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, input.batchSize).map((record) => record.id);
    const expiredShareIds = [...this.shares.values()].filter((record) => record.lifecycle === "active" && record.expiresAt <= input.now).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, input.batchSize).map((record) => record.id);
    const pendingObjectReferences = [...this.objects.values()].filter((record) => record.lifecycle === "delete-pending" || record.lifecycle === "tombstone-pending"
      || (record.lifecycle === "upload-pending" && (record.publicationPutMayStillComplete === false
        || (record.publicationLeaseExpiresAt !== undefined && record.publicationLeaseExpiresAt <= input.now)))
      || (record.lifecycle === "active" && record.expiresAt !== undefined && record.expiresAt <= input.now)).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, input.batchSize);
    const expiredObjectIds = pendingObjectReferences.map((record) => record.id);
    const expiredIdempotency = [...this.idempotency.entries()].filter(([, record]) => record.expiresAt <= input.now).slice(0, input.batchSize);
    const expiredQuota = [...this.quota.entries()].filter(([, record]) => record.expiresAt <= input.now).slice(0, input.batchSize);
    if (!input.dryRun) {
      expiredSessionIds.forEach((id) => this.sessions.delete(id));
      expiredShareIds.forEach((id) => { const record = this.shares.get(id); if (record) this.shares.set(id, { ...record, lifecycle: "expired", deletedAt: input.now }); });
      expiredObjectIds.forEach((id) => {
        const record = this.objects.get(id);
        if (record?.lifecycle === "upload-pending" || (record?.lifecycle === "active" && record.publicationPredecessorToken !== undefined)) {
          this.objects.set(id, { ...record, lifecycle: "tombstone-pending" });
        } else if (record?.lifecycle === "active") this.objects.set(id, { ...record, lifecycle: "delete-pending" });
      });
      expiredIdempotency.forEach(([key]) => this.idempotency.delete(key));
      expiredQuota.forEach(([key]) => this.quota.delete(key));
    }
    return {
      expiredSessionIds, expiredShareIds, expiredObjectIds,
      pendingObjectReferences: pendingObjectReferences.map((record) => {
        if (input.dryRun || record.lifecycle === "delete-pending" || record.lifecycle === "tombstone-pending") return record;
        return { ...record, lifecycle: record.lifecycle === "upload-pending" || record.publicationPredecessorToken !== undefined ? "tombstone-pending" as const : "delete-pending" as const };
      }),
      removedIdempotencyCount: expiredIdempotency.length, removedQuotaCount: expiredQuota.length,
    };
  }
}
