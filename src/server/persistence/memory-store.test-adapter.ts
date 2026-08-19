import type {
  AbuseReportInput, AbuseReportRecord, AbuseReportResolution, AbuseReportStatus, CleanupResult, DurableShareRecord, GovernanceStore,
  IdempotencyClaim, IdempotencyRecoveryLookup, ObjectPublicationGenerationRecord, ObjectReferenceRecord, PrivateRowId, QuotaConsumption, SessionRecord,
} from "./store";

interface IdempotencyState {
  readonly sessionId: PrivateRowId;
  readonly operation: string;
  readonly keyHash: string;
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
  readonly reports: AbuseReportRecord[] = [];
  readonly audits: Array<Readonly<Record<string, unknown>>> = [];
  readonly objects = new Map<PrivateRowId, ObjectReferenceRecord>();
  readonly objectPublicationGenerations = new Map<string, ObjectPublicationGenerationRecord>();
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
        this.idempotency.set(key, { sessionId: input.sessionId, operation: input.operation, keyHash: input.keyHash, requestDigest: input.requestDigest, expiresAt: input.expiresAt, claimExpiresAt: input.claimExpiresAt, claimCreatedAt: input.createdAt });
        return { status: "claimed", claimCreatedAt: input.createdAt };
      }
      return found.response === undefined ? { status: "pending" } : { status: "replay", response: found.response };
    }
    this.idempotency.set(key, { sessionId: input.sessionId, operation: input.operation, keyHash: input.keyHash, requestDigest: input.requestDigest, expiresAt: input.expiresAt, claimExpiresAt: input.claimExpiresAt, claimCreatedAt: input.createdAt });
    return { status: "claimed", claimCreatedAt: input.createdAt };
  }

  async recoverIdempotency(input: { readonly operation: string; readonly keyHash: string; readonly requestDigest: string; readonly now: string }): Promise<IdempotencyRecoveryLookup> {
    const matches = [...this.idempotency.values()].filter((record) => record.operation === input.operation && record.keyHash === input.keyHash);
    if (matches.length === 0) return { status: "missing" };
    if (matches.length !== 1) return { status: "ambiguous" };
    const found = matches[0];
    if (found.requestDigest !== input.requestDigest) return { status: "conflict" };
    if (found.response !== undefined) return found.expiresAt <= input.now ? { status: "expired" } : { status: "replay", response: structuredClone(found.response) };
    if (found.claimExpiresAt > input.now) return { status: "pending" };
    const key = `${found.sessionId}:${found.operation}:${found.keyHash}`;
    if (this.idempotency.get(key) === found) this.idempotency.delete(key);
    return { status: "retired-no-effect" };
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

  async createAbuseReport(input: AbuseReportInput): Promise<AbuseReportRecord> {
    const record: AbuseReportRecord = { ...structuredClone(input), id: this.id(), status: "pending", updatedAt: input.createdAt };
    this.reports.push(record);
    return structuredClone(record);
  }
  async listAbuseReports(input: { readonly status?: AbuseReportStatus; readonly limit: number }): Promise<readonly AbuseReportRecord[]> {
    return this.reports.filter((record) => input.status === undefined || record.status === input.status)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || Number(left.id) - Number(right.id))
      .slice(0, input.limit).map((record) => structuredClone(record));
  }
  async claimAbuseReport(input: { readonly id: PrivateRowId; readonly moderatorId: string; readonly claimToken: string; readonly now: string; readonly claimExpiresAt: string }): Promise<AbuseReportRecord | undefined> {
    const index = this.reports.findIndex((record) => record.id === input.id);
    const current = this.reports[index];
    if (!current || (current.status !== "pending" && !(current.status === "claimed" && (current.claimExpiresAt ?? input.now) <= input.now))) return undefined;
    const claimed: AbuseReportRecord = {
      ...current, status: "claimed", claimToken: input.claimToken, claimExpiresAt: input.claimExpiresAt,
      claimedBy: input.moderatorId, updatedAt: input.now,
    };
    this.reports[index] = claimed;
    this.audits.push({ eventKind: "share-moderation-claim", ...(claimed.shareRecordId ? { shareRecordId: claimed.shareRecordId } : {}), abuseReportId: claimed.id, outcome: input.moderatorId, createdAt: input.now });
    return structuredClone(claimed);
  }
  async resolveAbuseReport(input: { readonly id: PrivateRowId; readonly claimToken: string; readonly resolution: AbuseReportResolution; readonly now: string }): Promise<AbuseReportRecord | undefined> {
    const index = this.reports.findIndex((record) => record.id === input.id);
    const current = this.reports[index];
    if (!current || current.status !== "claimed" || current.claimToken !== input.claimToken || (current.claimExpiresAt ?? input.now) <= input.now) return undefined;
    if (input.resolution === "takedown" && current.shareRecordId) {
      const share = this.shares.get(current.shareRecordId);
      if (share?.lifecycle === "active") this.shares.set(share.id, { ...share, lifecycle: "disabled", disabledAt: input.now });
    }
    const resolved: AbuseReportRecord = {
      ...current, status: "resolved", claimToken: undefined, claimExpiresAt: undefined,
      resolution: input.resolution, resolvedAt: input.now, updatedAt: input.now,
    };
    this.reports[index] = resolved;
    this.audits.push({ eventKind: "share-moderation-resolve", ...(resolved.shareRecordId ? { shareRecordId: resolved.shareRecordId } : {}), abuseReportId: resolved.id, outcome: input.resolution, createdAt: input.now });
    return structuredClone(resolved);
  }
  async createAudit(input: Readonly<Record<string, unknown>> & { readonly eventKind: string; readonly outcome: string; readonly createdAt: string }): Promise<void> { this.audits.push(structuredClone(input)); }

  async createObjectReference(input: Omit<ObjectReferenceRecord, "id">): Promise<ObjectReferenceRecord> {
    if ([...this.objects.values()].some((record) => record.logicalPublicationKey === input.logicalPublicationKey || record.objectKey === input.objectKey)) {
      throw new Error("PERSISTENCE_CONFLICT");
    }
    const record = { ...input, id: this.id() };
    this.objects.set(record.id, record);
    if (input.publicationToken && input.publicationGeneration !== undefined) {
      this.objectPublicationGenerations.set(this.objectPublicationGenerationKey(record.id, input.publicationGeneration), {
        objectReferenceId: record.id,
        publicationGeneration: input.publicationGeneration,
        physicalObjectKey: input.objectKey,
        publicationToken: input.publicationToken,
        publicationPutMayStillComplete: input.publicationPutMayStillComplete ?? false,
        ...(input.publicationLeaseExpiresAt ? { publicationLeaseExpiresAt: input.publicationLeaseExpiresAt } : {}),
        deleteOutcome: "not-started",
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      });
    }
    return record;
  }

  async findObjectReference(id: PrivateRowId, ownerSessionId: PrivateRowId): Promise<ObjectReferenceRecord | undefined> {
    const record = this.objects.get(id);
    return record?.ownerSessionId === ownerSessionId ? record : undefined;
  }

  private objectPublicationGenerationKey(id: PrivateRowId, publicationGeneration: number): string {
    return `${id}:${publicationGeneration}`;
  }

  async findObjectReferenceByKey(objectKey: string, ownerSessionId: PrivateRowId): Promise<ObjectReferenceRecord | undefined> {
    return [...this.objects.values()].find((record) => record.objectKey === objectKey && record.ownerSessionId === ownerSessionId);
  }

  async findObjectReferenceByLogicalKey(logicalPublicationKey: string, ownerSessionId: PrivateRowId): Promise<ObjectReferenceRecord | undefined> {
    return [...this.objects.values()].find((record) => record.logicalPublicationKey === logicalPublicationKey && record.ownerSessionId === ownerSessionId);
  }

  async findObjectPublicationGeneration(input: Parameters<GovernanceStore["findObjectPublicationGeneration"]>[0]): Promise<ObjectPublicationGenerationRecord | undefined> {
    const reference = await this.findObjectReference(input.id, input.ownerSessionId);
    if (!reference) return undefined;
    return this.objectPublicationGenerations.get(this.objectPublicationGenerationKey(input.id, input.publicationGeneration));
  }

  async listObjectPublicationGenerations(input: Parameters<GovernanceStore["listObjectPublicationGenerations"]>[0]): Promise<readonly ObjectPublicationGenerationRecord[]> {
    const reference = await this.findObjectReference(input.id, input.ownerSessionId);
    if (!reference) return [];
    return [...this.objectPublicationGenerations.values()]
      .filter((generation) => generation.objectReferenceId === input.id)
      .sort((left, right) => left.publicationGeneration - right.publicationGeneration);
  }

  private exactGeneration(record: ObjectReferenceRecord, publicationToken: string, publicationGeneration: number, objectKey: string): ObjectPublicationGenerationRecord | undefined {
    const generation = this.objectPublicationGenerations.get(this.objectPublicationGenerationKey(record.id, publicationGeneration));
    return generation?.publicationToken === publicationToken && generation.physicalObjectKey === objectKey ? generation : undefined;
  }

  async completeObjectPublication(input: Parameters<GovernanceStore["completeObjectPublication"]>[0]): Promise<"active" | "delete-required" | "superseded"> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    if (!record) return "superseded";
    const generation = this.exactGeneration(record, input.publicationToken, input.publicationGeneration, input.objectKey);
    if (!generation) return "superseded";
    this.objectPublicationGenerations.set(this.objectPublicationGenerationKey(record.id, input.publicationGeneration), {
      ...generation,
      publicationPutMayStillComplete: false,
      publicationLeaseExpiresAt: undefined,
      deleteOutcome: "not-started",
      deleteConfirmedAt: undefined,
      deletedAt: undefined,
      updatedAt: input.at,
    });
    const current = record.publicationGeneration === input.publicationGeneration;
    const predecessor = record.publicationPredecessorGeneration === input.publicationGeneration
      && record.publicationPredecessorToken === input.publicationToken;
    const withoutPredecessor = predecessor ? { publicationPredecessorToken: undefined, publicationPredecessorGeneration: undefined } : {};
    if (!current) {
      this.objects.set(record.id, { ...record, ...withoutPredecessor });
      return "delete-required";
    }
    if (record.lifecycle !== "upload-pending" && record.lifecycle !== "active") {
      this.objects.set(record.id, {
        ...record,
        ...withoutPredecessor,
        publicationPutMayStillComplete: false,
        publicationLeaseExpiresAt: undefined,
        publicationDeleteConfirmedAt: undefined,
      });
      return "delete-required";
    }
    if (record.lifecycle === "active") return "active";
    this.objects.set(record.id, {
      ...record,
      ...withoutPredecessor,
      lifecycle: "active",
      objectKey: generation.physicalObjectKey,
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
    const generation = record ? this.exactGeneration(record, input.publicationToken, input.publicationGeneration, record.objectKey) : undefined;
    if (!record || !generation || record.lifecycle !== "upload-pending" || record.publicationToken !== input.publicationToken
      || record.publicationGeneration !== input.publicationGeneration || generation.publicationPutMayStillComplete) return false;
    this.objectPublicationGenerations.set(this.objectPublicationGenerationKey(record.id, input.publicationGeneration), {
      ...generation,
      publicationPutMayStillComplete: true,
      publicationLeaseExpiresAt: input.publicationLeaseExpiresAt,
      updatedAt: input.at,
    });
    this.objects.set(record.id, { ...record, publicationPutMayStillComplete: true, publicationLeaseExpiresAt: input.publicationLeaseExpiresAt });
    return true;
  }

  async restartObjectPublication(input: Parameters<GovernanceStore["restartObjectPublication"]>[0]): Promise<boolean> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    const currentGeneration = record?.publicationGeneration === undefined ? undefined
      : this.objectPublicationGenerations.get(this.objectPublicationGenerationKey(record.id, record.publicationGeneration));
    const predecessorTracked = record?.publicationPredecessorGeneration === undefined || this.objectPublicationGenerations.has(
      this.objectPublicationGenerationKey(record.id, record.publicationPredecessorGeneration),
    );
    const restartableTombstone = record?.lifecycle === "tombstone-pending"
      && currentGeneration?.deleteConfirmedAt !== undefined
      && currentGeneration.publicationPutMayStillComplete
      && predecessorTracked
      && currentGeneration.cleanupToken === undefined;
    if (!record || (record.lifecycle !== "deleted" && !restartableTombstone) || record.logicalPublicationKey !== input.logicalPublicationKey || record.contentType !== input.contentType
      || record.byteSize !== input.byteSize || record.binaryDigest !== input.binaryDigest) return false;
    if ([...this.objectPublicationGenerations.values()].some((generation) => generation.physicalObjectKey === input.objectKey)) return false;
    const publicationGeneration = (record.publicationGeneration ?? 0) + 1;
    this.objectPublicationGenerations.set(this.objectPublicationGenerationKey(record.id, publicationGeneration), {
      objectReferenceId: record.id,
      publicationGeneration,
      physicalObjectKey: input.objectKey,
      publicationToken: input.publicationToken,
      publicationPutMayStillComplete: true,
      publicationLeaseExpiresAt: input.publicationLeaseExpiresAt,
      deleteOutcome: "not-started",
      createdAt: input.at,
      updatedAt: input.at,
    });
    this.objects.set(record.id, {
      ...record,
      lifecycle: "upload-pending",
      objectKey: input.objectKey,
      publicationToken: input.publicationToken,
      publicationLeaseExpiresAt: input.publicationLeaseExpiresAt,
      publicationGeneration,
      publicationPutMayStillComplete: true,
      ...(restartableTombstone ? {
        publicationPredecessorToken: currentGeneration?.publicationToken,
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
    if (!record) return "superseded";
    const generation = this.exactGeneration(record, input.publicationToken, input.publicationGeneration, input.objectKey);
    if (!generation) return "superseded";
    this.objectPublicationGenerations.set(this.objectPublicationGenerationKey(record.id, input.publicationGeneration), {
      ...generation,
      publicationPutMayStillComplete: false,
      publicationLeaseExpiresAt: undefined,
      ...(input.materialized ? { deleteOutcome: "not-started" as const, deleteConfirmedAt: undefined, deletedAt: undefined } : {}),
      updatedAt: input.at,
    });
    const current = record.publicationGeneration === input.publicationGeneration;
    const predecessor = record.publicationPredecessorGeneration === input.publicationGeneration
      && record.publicationPredecessorToken === input.publicationToken;
    const updated = {
      ...record,
      ...(current ? { publicationPutMayStillComplete: false, publicationLeaseExpiresAt: undefined } : {}),
      ...(predecessor ? { publicationPredecessorToken: undefined, publicationPredecessorGeneration: undefined } : {}),
      ...(current && input.materialized ? { publicationDeleteConfirmedAt: undefined } : {}),
    };
    this.objects.set(record.id, updated);
    if (!current) return "delete-required";
    if (record.lifecycle === "active") return "active";
    return record.lifecycle === "tombstone-pending" || record.lifecycle === "delete-pending" || record.lifecycle === "deleted"
      ? "delete-required" : "settled";
  }

  async claimObjectPublicationCleanup(input: Parameters<GovernanceStore["claimObjectPublicationCleanup"]>[0]): Promise<boolean> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    const generation = record ? this.objectPublicationGenerations.get(this.objectPublicationGenerationKey(record.id, input.publicationGeneration)) : undefined;
    if (!record || !generation || generation.physicalObjectKey !== input.objectKey || generation.deletedAt !== undefined
      || (generation.cleanupToken !== undefined && (generation.cleanupLeaseExpiresAt ?? input.now) > input.now)) return false;
    this.objectPublicationGenerations.set(this.objectPublicationGenerationKey(record.id, input.publicationGeneration), {
      ...generation,
      cleanupToken: input.publicationCleanupToken,
      cleanupLeaseExpiresAt: input.publicationCleanupLeaseExpiresAt,
      updatedAt: input.now,
    });
    if (record.publicationGeneration === input.publicationGeneration && record.lifecycle === "upload-pending") {
      this.objects.set(record.id, {
        ...record,
        lifecycle: "tombstone-pending",
        publicationCleanupToken: input.publicationCleanupToken,
        publicationCleanupLeaseExpiresAt: input.publicationCleanupLeaseExpiresAt,
      });
    }
    return true;
  }

  async completeObjectPublicationCleanup(input: Parameters<GovernanceStore["completeObjectPublicationCleanup"]>[0]): Promise<"reference-deleted" | "generation-deleted" | "tombstone" | "superseded"> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    const generation = record ? this.objectPublicationGenerations.get(this.objectPublicationGenerationKey(record.id, input.publicationGeneration)) : undefined;
    if (!record || !generation || generation.physicalObjectKey !== input.objectKey || generation.cleanupToken !== input.publicationCleanupToken) return "superseded";
    const generationTerminal = !generation.publicationPutMayStillComplete;
    this.objectPublicationGenerations.set(this.objectPublicationGenerationKey(record.id, input.publicationGeneration), {
      ...generation,
      deleteOutcome: "acknowledged",
      deleteConfirmedAt: input.at,
      cleanupToken: undefined,
      cleanupLeaseExpiresAt: undefined,
      ...(generationTerminal ? { deletedAt: input.at } : { deletedAt: undefined }),
      updatedAt: input.at,
    });
    const current = record.publicationGeneration === input.publicationGeneration;
    const anyPending = [...this.objectPublicationGenerations.values()].some((candidate) => candidate.objectReferenceId === record.id
      && candidate.deletedAt === undefined);
    const referenceTerminal = generationTerminal && record.lifecycle !== "active" && !anyPending;
    if (referenceTerminal) {
      this.objects.set(record.id, {
      ...record,
      lifecycle: "deleted",
      publicationToken: undefined,
      publicationLeaseExpiresAt: undefined,
      publicationPutMayStillComplete: false,
      publicationDeleteConfirmedAt: input.at,
      publicationCleanupToken: undefined,
      publicationCleanupLeaseExpiresAt: undefined,
      deletedAt: input.at,
      });
      return "reference-deleted";
    }
    if (!current) {
      if (generationTerminal && record.publicationPredecessorGeneration === input.publicationGeneration) {
        this.objects.set(record.id, { ...record, publicationPredecessorToken: undefined, publicationPredecessorGeneration: undefined });
      }
      return generationTerminal ? "generation-deleted" : "tombstone";
    }
    this.objects.set(record.id, {
      ...record,
      publicationDeleteConfirmedAt: input.at,
      publicationCleanupToken: undefined,
      publicationCleanupLeaseExpiresAt: undefined,
    });
    return generationTerminal ? "generation-deleted" : "tombstone";
  }

  async markObjectPublicationDeleteUncertain(input: Parameters<GovernanceStore["markObjectPublicationDeleteUncertain"]>[0]): Promise<boolean> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    const generation = record ? this.objectPublicationGenerations.get(this.objectPublicationGenerationKey(record.id, input.publicationGeneration)) : undefined;
    if (!record || !generation || generation.physicalObjectKey !== input.objectKey || generation.cleanupToken !== input.publicationCleanupToken) return false;
    this.objectPublicationGenerations.set(this.objectPublicationGenerationKey(record.id, input.publicationGeneration), {
      ...generation,
      deleteOutcome: "outcome-uncertain",
      cleanupToken: undefined,
      cleanupLeaseExpiresAt: undefined,
      updatedAt: input.at,
    });
    if (record.publicationGeneration === input.publicationGeneration && record.publicationCleanupToken === input.publicationCleanupToken) {
      this.objects.set(record.id, { ...record, publicationCleanupToken: undefined, publicationCleanupLeaseExpiresAt: undefined });
    }
    return true;
  }

  async releaseObjectPublicationCleanup(input: Parameters<GovernanceStore["releaseObjectPublicationCleanup"]>[0]): Promise<void> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    const generation = record ? this.objectPublicationGenerations.get(this.objectPublicationGenerationKey(record.id, input.publicationGeneration)) : undefined;
    if (record && generation?.cleanupToken === input.publicationCleanupToken) {
      this.objectPublicationGenerations.set(this.objectPublicationGenerationKey(record.id, input.publicationGeneration), {
        ...generation,
        cleanupToken: undefined,
        cleanupLeaseExpiresAt: undefined,
      });
    }
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
    const hasDueOldGeneration = (record: ObjectReferenceRecord): boolean => [...this.objectPublicationGenerations.values()].some((generation) =>
      generation.objectReferenceId === record.id
      && generation.publicationGeneration !== record.publicationGeneration
      && generation.deletedAt === undefined
      && (generation.deleteOutcome === "outcome-uncertain"
        || generation.deleteConfirmedAt !== undefined
        || !generation.publicationPutMayStillComplete
        || (generation.publicationLeaseExpiresAt !== undefined && generation.publicationLeaseExpiresAt <= input.now)));
    const pendingObjectReferences = [...this.objects.values()].filter((record) => record.lifecycle === "delete-pending" || record.lifecycle === "tombstone-pending"
      || (record.lifecycle === "upload-pending" && (record.publicationPutMayStillComplete === false
        || (record.publicationLeaseExpiresAt !== undefined && record.publicationLeaseExpiresAt <= input.now)))
      || (record.lifecycle === "active" && record.expiresAt !== undefined && record.expiresAt <= input.now)
      || hasDueOldGeneration(record)).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, input.batchSize);
    const expiredObjectIds = pendingObjectReferences.map((record) => record.id);
    const expiredIdempotency = [...this.idempotency.entries()].filter(([, record]) => record.expiresAt <= input.now).slice(0, input.batchSize);
    const expiredQuota = [...this.quota.entries()].filter(([, record]) => record.expiresAt <= input.now).slice(0, input.batchSize);
    if (!input.dryRun) {
      expiredSessionIds.forEach((id) => this.sessions.delete(id));
      expiredShareIds.forEach((id) => { const record = this.shares.get(id); if (record) this.shares.set(id, { ...record, lifecycle: "expired", deletedAt: input.now }); });
      expiredObjectIds.forEach((id) => {
        const record = this.objects.get(id);
        if (record?.lifecycle === "upload-pending") {
          this.objects.set(id, { ...record, lifecycle: "tombstone-pending" });
        } else if (record?.lifecycle === "active" && record.expiresAt !== undefined && record.expiresAt <= input.now) {
          this.objects.set(id, { ...record, lifecycle: "delete-pending" });
        }
      });
      expiredIdempotency.forEach(([key]) => this.idempotency.delete(key));
      expiredQuota.forEach(([key]) => this.quota.delete(key));
    }
    return {
      expiredSessionIds, expiredShareIds, expiredObjectIds,
      pendingObjectReferences: pendingObjectReferences.map((record) => {
        if (input.dryRun || record.lifecycle === "delete-pending" || record.lifecycle === "tombstone-pending") return record;
        if (record.lifecycle === "upload-pending") return { ...record, lifecycle: "tombstone-pending" as const };
        if (record.lifecycle === "active" && record.expiresAt !== undefined && record.expiresAt <= input.now) {
          return { ...record, lifecycle: "delete-pending" as const };
        }
        return record;
      }),
      removedIdempotencyCount: expiredIdempotency.length, removedQuotaCount: expiredQuota.length,
    };
  }
}
