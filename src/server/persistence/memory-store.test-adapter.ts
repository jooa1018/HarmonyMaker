import type {
  AbuseReportInput, CleanupResult, DurableShareRecord, GovernanceStore,
  IdempotencyClaim, ObjectReferenceRecord, PrivateRowId, QuotaConsumption, SessionRecord,
} from "./store";

interface IdempotencyState {
  readonly requestDigest: string;
  readonly expiresAt: string;
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
    readonly requestDigest: string; readonly createdAt: string; readonly expiresAt: string;
  }): Promise<IdempotencyClaim> {
    const key = `${input.sessionId}:${input.operation}:${input.keyHash}`;
    const found = this.idempotency.get(key);
    if (found) {
      if (found.requestDigest !== input.requestDigest) return { status: "conflict" };
      return found.response === undefined ? { status: "pending" } : { status: "replay", response: found.response };
    }
    this.idempotency.set(key, { requestDigest: input.requestDigest, expiresAt: input.expiresAt });
    return { status: "claimed" };
  }

  async completeIdempotency(input: { readonly sessionId: PrivateRowId; readonly operation: string; readonly keyHash: string; readonly response: unknown }): Promise<void> {
    const key = `${input.sessionId}:${input.operation}:${input.keyHash}`;
    const found = this.idempotency.get(key);
    if (!found) throw new Error("IDEMPOTENCY_NOT_CLAIMED");
    found.response = structuredClone(input.response);
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

  async transitionObjectReference(input: { readonly id: PrivateRowId; readonly ownerSessionId: PrivateRowId; readonly lifecycle: ObjectReferenceRecord["lifecycle"]; readonly at: string }): Promise<void> {
    const record = await this.findObjectReference(input.id, input.ownerSessionId);
    if (record) this.objects.set(record.id, { ...record, lifecycle: input.lifecycle, ...(input.lifecycle === "deleted" ? { deletedAt: input.at } : {}) });
  }

  async cleanup(input: { readonly now: string; readonly batchSize: number; readonly dryRun: boolean }): Promise<CleanupResult> {
    const expiredSessionIds = [...this.sessions.values()].filter((record) => record.expiresAt <= input.now).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, input.batchSize).map((record) => record.id);
    const expiredShareIds = [...this.shares.values()].filter((record) => record.lifecycle === "active" && record.expiresAt <= input.now).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, input.batchSize).map((record) => record.id);
    const expiredObjectIds = [...this.objects.values()].filter((record) => record.lifecycle === "active" && record.expiresAt !== undefined && record.expiresAt <= input.now).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, input.batchSize).map((record) => record.id);
    const expiredIdempotency = [...this.idempotency.entries()].filter(([, record]) => record.expiresAt <= input.now).slice(0, input.batchSize);
    const expiredQuota = [...this.quota.entries()].filter(([, record]) => record.expiresAt <= input.now).slice(0, input.batchSize);
    if (!input.dryRun) {
      expiredSessionIds.forEach((id) => this.sessions.delete(id));
      expiredShareIds.forEach((id) => { const record = this.shares.get(id); if (record) this.shares.set(id, { ...record, lifecycle: "expired", deletedAt: input.now }); });
      expiredObjectIds.forEach((id) => { const record = this.objects.get(id); if (record) this.objects.set(id, { ...record, lifecycle: "expired" }); });
      expiredIdempotency.forEach(([key]) => this.idempotency.delete(key));
      expiredQuota.forEach(([key]) => this.quota.delete(key));
    }
    return { expiredSessionIds, expiredShareIds, expiredObjectIds, removedIdempotencyCount: expiredIdempotency.length, removedQuotaCount: expiredQuota.length };
  }
}
