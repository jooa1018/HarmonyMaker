import type { AeadEnvelopeV1 } from "../security/crypto-core";
import type { PrivateRowId } from "../persistence/store";
import type { BinaryDigest, SemanticDigest } from "../../domain/digest/canonical";
import type { RightsMetadata } from "../../domain/source/model";
import type { ImageQualityReport } from "../../domain/omr/image-quality";
import type {
  OmrPublicStatus, OmrQuotaConfig, OmrVendorCapabilities, RetentionInfo,
  VendorDeleteResult, VendorInputRequest, VendorInputResponse,
} from "../../domain/omr/contracts";
import type { InputSourceKind } from "../../domain/omr/input";
import type { VendorEvidenceBundle } from "../../domain/omr/foundation";

export type OmrLifecycleState =
  | "created" | "uploading" | "queued" | "processing" | "needs-input"
  | "completed" | "failed" | "cancelled" | "delete-pending" | "deleted" | "expired";

const LEGAL_OMR_TRANSITIONS: Readonly<Record<OmrLifecycleState, readonly OmrLifecycleState[]>> = Object.freeze({
  created: ["uploading", "failed", "cancelled", "delete-pending", "expired"],
  uploading: ["queued", "failed", "cancelled", "delete-pending", "expired"],
  queued: ["processing", "needs-input", "completed", "failed", "cancelled", "delete-pending", "expired"],
  processing: ["needs-input", "completed", "failed", "cancelled", "delete-pending", "expired"],
  "needs-input": ["processing", "completed", "failed", "cancelled", "delete-pending", "expired"],
  completed: ["delete-pending", "expired"],
  failed: ["delete-pending", "expired"],
  cancelled: ["delete-pending", "expired"],
  "delete-pending": ["deleted"],
  deleted: [],
  expired: ["delete-pending"],
});

export function isLegalOmrTransition(from: OmrLifecycleState, to: OmrLifecycleState): boolean {
  return from === to || LEGAL_OMR_TRANSITIONS[from].includes(to);
}

export interface OmrPageRecord {
  readonly pageIndex: number;
  readonly pageDigest: BinaryDigest;
  readonly mimeType: string;
  readonly idempotencyKeyHash: string;
  readonly width: number;
  readonly height: number;
  readonly quality: ImageQualityReport;
  readonly warnAcknowledged: boolean;
  readonly duplicateConfirmed: boolean;
  readonly uploadState: "pending" | "uploaded" | "failed";
  readonly retryCount: number;
  readonly objectReferenceId?: PrivateRowId;
}

export interface DurableOmrJobRecord {
  readonly id: PrivateRowId;
  readonly ownerSessionId: PrivateRowId;
  readonly ipOwnerHash: string;
  readonly publicHandleHash: string;
  readonly publicHandleReplayEnvelope: AeadEnvelopeV1;
  readonly handleExpiresAt: string;
  readonly sourceKind: InputSourceKind;
  readonly pageCount: number;
  readonly state: OmrLifecycleState;
  readonly rights: RightsMetadata;
  readonly providerTransferConsent: true;
  readonly providerConsentRecordedAt: string;
  readonly capabilities: OmrVendorCapabilities;
  readonly vendorCreateIdempotencyKey: string;
  readonly vendorCreateLeaseExpiresAt: string;
  readonly vendorJobIdEnvelope?: AeadEnvelopeV1;
  readonly creditEstimate: number;
  readonly creditState: "reserved" | "settled" | "released";
  readonly pages: readonly OmrPageRecord[];
  readonly progressBp?: number;
  readonly currentInputRequest?: VendorInputRequest;
  readonly acceptedInput?: VendorInputResponse;
  readonly resultObjectReferenceId?: PrivateRowId;
  readonly vendorResultDigest?: BinaryDigest;
  readonly evidence?: VendorEvidenceBundle;
  readonly retentionInfo?: RetentionInfo;
  readonly vendorDeleteResult?: VendorDeleteResult;
  readonly publicFailureCode?: string;
  readonly publicFailureMessageKo?: string;
  readonly handleActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly deletedAt?: string;
}

export type OmrCreateClaim =
  | { readonly status: "claimed" | "resume"; readonly job: DurableOmrJobRecord }
  | { readonly status: "replay"; readonly handleReplayEnvelope: AeadEnvelopeV1 }
  | { readonly status: "pending" | "conflict" | "quota-denied" | "credit-denied" };

export type OmrPageClaim =
  | { readonly status: "claimed"; readonly page: OmrPageRecord }
  | { readonly status: "replay" }
  | { readonly status: "pending" | "conflict" | "retry-exhausted" };

export interface OmrStore {
  claimCreate(input: {
    readonly ownerSessionId: PrivateRowId;
    readonly ipOwnerHash: string;
    readonly idempotencyKeyHash: string;
    readonly requestDigest: SemanticDigest;
    readonly record: Omit<DurableOmrJobRecord, "id">;
    readonly quota: OmrQuotaConfig;
    readonly now: string;
  }): Promise<OmrCreateClaim>;
  completeVendorCreation(jobId: PrivateRowId, vendorJobIdEnvelope: AeadEnvelopeV1, now: string): Promise<void>;
  failVendorCreation(jobId: PrivateRowId, code: string, messageKo: string, now: string): Promise<void>;
  findOwnedByHandleHash(handleHash: string, ownerSessionId: PrivateRowId, includeInactive?: boolean): Promise<DurableOmrJobRecord | undefined>;
  claimPage(jobId: PrivateRowId, page: OmrPageRecord, maxRetries: number, now: string): Promise<OmrPageClaim>;
  completePage(jobId: PrivateRowId, pageIndex: number, objectReferenceId: PrivateRowId, now: string): Promise<void>;
  failPage(jobId: PrivateRowId, pageIndex: number, now: string): Promise<void>;
  transition(jobId: PrivateRowId, update: Partial<DurableOmrJobRecord>, now: string): Promise<void>;
  markHandleDeleted(jobId: PrivateRowId, now: string): Promise<void>;
  recordAudit(jobId: PrivateRowId | undefined, eventKind: string, outcome: string, now: string): Promise<void>;
  claimExpired(now: string, limit: number): Promise<readonly DurableOmrJobRecord[]>;
}

interface IdempotencyEntry { readonly requestDigest: SemanticDigest; readonly jobId: PrivateRowId; complete: boolean }

/** Deterministic durable-memory adapter for unit and reference E2E tests only. */
export class MemoryOmrStore implements OmrStore {
  private sequence = 0;
  private gate = Promise.resolve();
  private readonly jobs = new Map<PrivateRowId, DurableOmrJobRecord>();
  private readonly idempotency = new Map<string, IdempotencyEntry>();
  private readonly audits: Array<{ readonly jobId?: PrivateRowId; readonly eventKind: string; readonly outcome: string; readonly createdAt: string }> = [];

  private async atomic<T>(operation: () => T | Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.gate;
    this.gate = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private clone(record: DurableOmrJobRecord): DurableOmrJobRecord { return structuredClone(record); }
  private id(): PrivateRowId { this.sequence += 1; return String(this.sequence) as PrivateRowId; }

  async claimCreate(input: Parameters<OmrStore["claimCreate"]>[0]): Promise<OmrCreateClaim> {
    return this.atomic(() => {
      const idempotencyKey = `${input.ownerSessionId}:${input.idempotencyKeyHash}`;
      const prior = this.idempotency.get(idempotencyKey);
      if (prior) {
        if (prior.requestDigest !== input.requestDigest) return { status: "conflict" };
        const job = this.jobs.get(prior.jobId)!;
        if (prior.complete) return { status: "replay", handleReplayEnvelope: structuredClone(job.publicHandleReplayEnvelope) };
        if (job.vendorCreateLeaseExpiresAt <= input.now) return { status: "resume", job: this.clone(job) };
        return { status: "pending" };
      }
      const activeStates = new Set<OmrLifecycleState>(["created", "uploading", "queued", "processing", "needs-input"]);
      const active = [...this.jobs.values()].filter((job) => activeStates.has(job.state));
      if (active.filter((job) => job.ownerSessionId === input.ownerSessionId).length >= input.quota.maxConcurrentJobsPerSession
        || active.filter((job) => job.ipOwnerHash === input.ipOwnerHash).length >= input.quota.maxConcurrentJobsPerIp) return { status: "quota-denied" };
      const hourStart = new Date(new Date(input.now).getTime() - 60 * 60 * 1_000).toISOString();
      if ([...this.jobs.values()].filter((job) => job.ownerSessionId === input.ownerSessionId && job.createdAt > hourStart).length >= input.quota.maxJobsPerSessionPerHour
        || [...this.jobs.values()].filter((job) => job.ipOwnerHash === input.ipOwnerHash && job.createdAt > hourStart).length >= input.quota.maxJobsPerIpPerHour) return { status: "quota-denied" };
      const day = input.now.slice(0, 10);
      const reserved = [...this.jobs.values()].filter((job) => job.createdAt.startsWith(day) && job.creditState !== "released")
        .reduce((sum, job) => sum + job.creditEstimate, 0);
      if (reserved + input.record.creditEstimate > input.quota.dailyGlobalCreditCeiling) return { status: "credit-denied" };
      const record = { ...structuredClone(input.record), id: this.id() } as DurableOmrJobRecord;
      this.jobs.set(record.id, record);
      this.idempotency.set(idempotencyKey, { requestDigest: input.requestDigest, jobId: record.id, complete: false });
      return { status: "claimed", job: this.clone(record) };
    });
  }

  async completeVendorCreation(jobId: PrivateRowId, vendorJobIdEnvelope: AeadEnvelopeV1, now: string): Promise<void> {
    await this.atomic(() => {
      const job = this.jobs.get(jobId);
      if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      const updated = { ...job, vendorJobIdEnvelope: structuredClone(vendorJobIdEnvelope), updatedAt: now };
      this.jobs.set(jobId, updated);
      const entry = [...this.idempotency.values()].find((value) => value.jobId === jobId);
      if (entry) entry.complete = true;
    });
  }

  async failVendorCreation(jobId: PrivateRowId, code: string, messageKo: string, now: string): Promise<void> {
    await this.transition(jobId, { state: "failed", creditState: "released", publicFailureCode: code, publicFailureMessageKo: messageKo }, now);
  }

  async findOwnedByHandleHash(handleHash: string, ownerSessionId: PrivateRowId, includeInactive = false): Promise<DurableOmrJobRecord | undefined> {
    const found = [...this.jobs.values()].find((job) => job.publicHandleHash === handleHash && job.ownerSessionId === ownerSessionId && (job.handleActive || includeInactive));
    return found ? this.clone(found) : undefined;
  }

  async claimPage(jobId: PrivateRowId, page: OmrPageRecord, maxRetries: number, now: string): Promise<OmrPageClaim> {
    return this.atomic(() => {
      const job = this.jobs.get(jobId);
      if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      const prior = job.pages.find((candidate) => candidate.pageIndex === page.pageIndex);
      if (prior) {
        if (prior.pageDigest !== page.pageDigest || prior.idempotencyKeyHash !== page.idempotencyKeyHash) return { status: "conflict" };
        if (prior.uploadState === "uploaded") return { status: "replay" };
        if (prior.uploadState === "pending") return { status: "pending" };
        if (prior.retryCount >= maxRetries) return { status: "retry-exhausted" };
      }
      const claimed = { ...page, retryCount: prior?.retryCount ?? 0, uploadState: "pending" as const };
      const pages = [...job.pages.filter((candidate) => candidate.pageIndex !== page.pageIndex), claimed].sort((a, b) => a.pageIndex - b.pageIndex);
      this.jobs.set(jobId, { ...job, pages, state: "uploading", updatedAt: now });
      return { status: "claimed", page: structuredClone(claimed) };
    });
  }

  async completePage(jobId: PrivateRowId, pageIndex: number, objectReferenceId: PrivateRowId, now: string): Promise<void> {
    await this.atomic(() => {
      const job = this.jobs.get(jobId); const page = job?.pages.find((candidate) => candidate.pageIndex === pageIndex);
      if (!job || !page) throw new RangeError("OMR_PAGE_UNAVAILABLE");
      this.jobs.set(jobId, { ...job, pages: job.pages.map((candidate) => candidate.pageIndex === pageIndex ? { ...candidate, objectReferenceId, uploadState: "uploaded" } : candidate), updatedAt: now });
    });
  }

  async failPage(jobId: PrivateRowId, pageIndex: number, now: string): Promise<void> {
    await this.atomic(() => {
      const job = this.jobs.get(jobId); if (!job) return;
      this.jobs.set(jobId, { ...job, pages: job.pages.map((page) => page.pageIndex === pageIndex ? { ...page, uploadState: "failed", retryCount: page.retryCount + 1 } : page), updatedAt: now });
    });
  }

  async transition(jobId: PrivateRowId, update: Partial<DurableOmrJobRecord>, now: string): Promise<void> {
    await this.atomic(() => {
      const job = this.jobs.get(jobId); if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      if (update.state !== undefined && !isLegalOmrTransition(job.state, update.state)) throw new RangeError("OMR_STATE_TRANSITION_INVALID");
      this.jobs.set(jobId, { ...job, ...structuredClone(update), id: job.id, ownerSessionId: job.ownerSessionId, updatedAt: now });
    });
  }

  async markHandleDeleted(jobId: PrivateRowId, now: string): Promise<void> { await this.transition(jobId, { handleActive: false, state: "delete-pending", deletedAt: now, creditState: "released" }, now); }
  async recordAudit(jobId: PrivateRowId | undefined, eventKind: string, outcome: string, now: string): Promise<void> {
    await this.atomic(() => { this.audits.push({ ...(jobId ? { jobId } : {}), eventKind, outcome, createdAt: now }); });
  }
  async claimExpired(now: string, limit: number): Promise<readonly DurableOmrJobRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new RangeError("OMR_CLEANUP_LIMIT_INVALID");
    return this.atomic(() => {
      const selected = [...this.jobs.values()].filter((job) => job.handleActive && job.handleExpiresAt <= now && !["delete-pending", "deleted", "expired"].includes(job.state)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
      for (const job of selected) this.jobs.set(job.id, { ...job, state: "expired", handleActive: false, creditState: "released", updatedAt: now });
      return selected.map((job) => this.clone({ ...job, state: "expired", handleActive: false, creditState: "released", updatedAt: now }));
    });
  }
  listJobs(): readonly DurableOmrJobRecord[] { return [...this.jobs.values()].map((record) => this.clone(record)); }
  listAudits(): readonly { readonly jobId?: PrivateRowId; readonly eventKind: string; readonly outcome: string; readonly createdAt: string }[] { return structuredClone(this.audits); }
}

export function publicStatusFromRecord(job: DurableOmrJobRecord): OmrPublicStatus {
  if (job.state === "uploading") return { kind: "uploading", uploadedPages: job.pages.filter((page) => page.uploadState === "uploaded").length, totalPages: job.pageCount };
  if (job.state === "processing") return { kind: "processing", ...(job.progressBp === undefined ? {} : { progressBp: job.progressBp as never }) };
  if (job.state === "needs-input" && job.currentInputRequest) return { kind: "needs-input", inputRequest: job.currentInputRequest };
  if (job.state === "failed" || job.state === "expired" || job.state === "delete-pending" || job.state === "deleted") return { kind: "failed", code: job.publicFailureCode ?? "OMR_JOB_UNAVAILABLE", messageKo: job.publicFailureMessageKo ?? "OMR 작업을 사용할 수 없습니다." };
  if (job.state === "cancelled") return { kind: "cancelled" };
  if (job.state === "queued") return { kind: "queued" };
  if (job.state === "completed") return { kind: "completed" };
  return { kind: "created" };
}
