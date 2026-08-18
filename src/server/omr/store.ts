import type { AeadEnvelopeV1 } from "../security/crypto-core";
import type { PrivateRowId } from "../persistence/store";
import type { BinaryDigest, SemanticDigest } from "../../domain/digest/canonical";
import type { RightsMetadata } from "../../domain/source/model";
import type { ImageQualityReport } from "../../domain/omr/image-quality";
import type {
  CanonicalOmrCreateRequest, OmrPublicStatus, OmrQuotaConfig, OmrVendorCapabilities, RetentionInfo,
  VendorDeleteResult, VendorInputRequest, VendorInputResponse, VendorNormalizationMappingArtifact,
} from "../../domain/omr/contracts";
import type { InputSourceKind } from "../../domain/omr/input";
import type { VendorEvidenceBundle } from "../../domain/omr/foundation";

export type OmrLifecycleState =
  | "created" | "uploading" | "queued" | "processing" | "needs-input"
  | "sync-retry-pending" | "capture-retry-pending"
  | "completed" | "failed" | "cancel-pending" | "cancel-failed" | "cancelled"
  | "reconciliation-required" | "delete-pending" | "deleted" | "expired";

export type OmrOperationKind = "start" | "submit-input" | "cancel";

export type VendorCreateOutcomeState =
  | "not-attempted"
  | "definitive-no-job"
  | "outcome-uncertain"
  | "confirmed";

const LEGAL_OMR_TRANSITIONS: Readonly<Record<OmrLifecycleState, readonly OmrLifecycleState[]>> = Object.freeze({
  created: ["uploading", "failed", "cancel-pending", "reconciliation-required", "delete-pending", "expired"],
  uploading: ["queued", "failed", "cancel-pending", "reconciliation-required", "delete-pending", "expired"],
  queued: ["processing", "needs-input", "completed", "failed", "sync-retry-pending", "capture-retry-pending", "cancel-pending", "reconciliation-required", "delete-pending", "expired"],
  processing: ["needs-input", "completed", "failed", "sync-retry-pending", "capture-retry-pending", "cancel-pending", "reconciliation-required", "delete-pending", "expired"],
  "needs-input": ["processing", "completed", "failed", "sync-retry-pending", "capture-retry-pending", "cancel-pending", "reconciliation-required", "delete-pending", "expired"],
  "sync-retry-pending": ["queued", "processing", "needs-input", "completed", "capture-retry-pending", "failed", "cancelled", "reconciliation-required", "cancel-pending", "delete-pending", "expired"],
  "capture-retry-pending": ["completed", "failed", "reconciliation-required", "cancel-pending", "delete-pending", "expired"],
  completed: ["delete-pending", "expired"],
  failed: ["delete-pending", "expired"],
  "cancel-pending": ["cancelled", "cancel-failed", "reconciliation-required", "delete-pending", "expired"],
  "cancel-failed": ["cancel-pending", "reconciliation-required", "delete-pending", "expired"],
  cancelled: ["delete-pending", "expired"],
  "reconciliation-required": ["delete-pending", "expired"],
  "delete-pending": ["deleted"],
  deleted: [],
  expired: ["delete-pending"],
});

export function isLegalOmrTransition(from: OmrLifecycleState, to: OmrLifecycleState): boolean {
  return from === to || LEGAL_OMR_TRANSITIONS[from].includes(to);
}

export const ACTIVE_OMR_LIFECYCLE_STATES: readonly OmrLifecycleState[] = Object.freeze([
  "created", "uploading", "queued", "processing", "needs-input",
  "sync-retry-pending", "capture-retry-pending", "cancel-pending", "cancel-failed", "reconciliation-required",
]);

export const VENDOR_CLEANUP_EXPOSURE_STATES: readonly OmrLifecycleState[] = Object.freeze([
  "delete-pending", "expired",
]);

type VendorExposureRecord = Pick<DurableOmrJobRecord, "state" | "vendorCreateOutcomeState" | "vendorDeleteState">;

/**
 * v0 concurrency authority: ordinary active work counts, all historically
 * uncertain creates count, and confirmed effects count while cleanup is
 * operationally unresolved. Completed-but-retained results do not count until
 * deletion/expiry enters cleanup.
 */
export function hasActiveOmrVendorExposure(job: VendorExposureRecord): boolean {
  return ACTIVE_OMR_LIFECYCLE_STATES.includes(job.state)
    || job.vendorCreateOutcomeState === "outcome-uncertain"
    || (job.vendorCreateOutcomeState === "confirmed"
      && VENDOR_CLEANUP_EXPOSURE_STATES.includes(job.state)
      && job.vendorDeleteState !== "deleted");
}

export function creditStateAfterHandleDeactivation(
  job: Pick<DurableOmrJobRecord, "creditState" | "state" | "vendorCreateOutcomeState" | "vendorDeleteState">,
): DurableOmrJobRecord["creditState"] {
  if (job.creditState === "settled") return "settled";
  if (job.creditState === "reserved" && hasActiveOmrVendorExposure(job)) return "reserved";
  return "released";
}

type CreateReplayUsabilityRecord = Pick<DurableOmrJobRecord, "handleActive" | "handleExpiresAt" | "state">;

/** Public create replay is valid only while the persisted handle remains lookup-usable. */
export function isCreateReplayUsable(job: CreateReplayUsabilityRecord, now: string): boolean {
  return job.handleActive
    && job.handleExpiresAt > now
    && job.state !== "expired"
    && job.state !== "delete-pending"
    && job.state !== "deleted";
}

export function utcAccountingWindow(now: string): { readonly dayStartUtc: string; readonly nextDayStartUtc: string } {
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new RangeError("OMR_ACCOUNTING_TIME_INVALID");
  const dayStartMs = Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());
  return {
    dayStartUtc: new Date(dayStartMs).toISOString(),
    nextDayStartUtc: new Date(dayStartMs + 24 * 60 * 60 * 1_000).toISOString(),
  };
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
  readonly uploadState: "pending" | "uploaded" | "failed" | "reconciliation-required";
  readonly retryCount: number;
  readonly uploadLeaseToken?: string;
  readonly uploadLeaseExpiresAt?: string;
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
  readonly canonicalCreateRequest: CanonicalOmrCreateRequest;
  readonly state: OmrLifecycleState;
  readonly rights: RightsMetadata;
  readonly providerTransferConsent: true;
  readonly providerConsentRecordedAt: string;
  readonly capabilities: OmrVendorCapabilities;
  readonly capabilitySnapshotDigest: SemanticDigest;
  readonly providerBindingId: string;
  readonly adapterContractVersion: string;
  readonly vendorCreateIdempotencyKey: string;
  readonly vendorCreateLeaseExpiresAt: string;
  readonly vendorCreateOutcomeState: VendorCreateOutcomeState;
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
  readonly normalizationMapping?: VendorNormalizationMappingArtifact;
  readonly retentionInfo?: RetentionInfo;
  readonly vendorDeleteResult?: VendorDeleteResult;
  readonly vendorDeleteState: "not-started" | "pending" | "deleted" | "not-supported" | "failed";
  readonly localDeleteState: "not-started" | "pending" | "deleted" | "failed";
  readonly vendorDeleteNextAttemptAt?: string;
  readonly localDeleteNextAttemptAt?: string;
  readonly operationKind?: OmrOperationKind;
  readonly operationRequestDigest?: SemanticDigest;
  readonly operationLeaseToken?: string;
  readonly operationLeaseExpiresAt?: string;
  readonly resultCaptureLeaseToken?: string;
  readonly resultCaptureLeaseExpiresAt?: string;
  readonly cleanupLeaseToken?: string;
  readonly cleanupLeaseExpiresAt?: string;
  readonly reconciliationKind?: "create" | "page-upload" | "sync" | "capture" | OmrOperationKind;
  readonly retryKind?: "sync" | "capture";
  readonly retryAttempt?: number;
  readonly retryNextAttemptAt?: string;
  readonly retryLastFailureCode?: string;
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
  | { readonly status: "replay-unavailable" }
  | { readonly status: "rejected"; readonly code: string; readonly messageKo: string }
  | { readonly status: "pending" | "conflict" | "quota-denied" | "credit-denied" };

export type OmrCreateInspection = OmrCreateClaim | { readonly status: "missing" };

export type OmrPageClaim =
  | { readonly status: "claimed"; readonly page: OmrPageRecord }
  | { readonly status: "replay" }
  | { readonly status: "pending" | "conflict" | "retry-exhausted" | "reconciliation-required" | "duplicate-confirmation-required" };

export type OmrOperationClaim =
  | { readonly status: "claimed" | "resume"; readonly job: DurableOmrJobRecord }
  | { readonly status: "pending" | "invalid" | "request-conflict" | "reconciliation-required" };

export type OmrResultCaptureClaim =
  | { readonly status: "claimed"; readonly job: DurableOmrJobRecord }
  | { readonly status: "pending" | "invalid" | "replay" };

export interface OmrStore {
  inspectCreate(input: { readonly ownerSessionId: PrivateRowId; readonly idempotencyKeyHash: string; readonly requestDigest: SemanticDigest; readonly vendorCreateLeaseExpiresAt: string; readonly now: string }): Promise<OmrCreateInspection>;
  claimCreate(input: {
    readonly ownerSessionId: PrivateRowId;
    readonly ipOwnerHash: string;
    readonly idempotencyKeyHash: string;
    readonly requestDigest: SemanticDigest;
    readonly record: Omit<DurableOmrJobRecord, "id">;
    readonly quota: OmrQuotaConfig;
    readonly now: string;
  }): Promise<OmrCreateClaim>;
  beginVendorCreation(input: {
    readonly jobId: PrivateRowId;
    readonly expectedState: OmrLifecycleState;
    readonly expectedOutcomeState: "not-attempted" | "outcome-uncertain";
    readonly expectedVendorCreateLeaseExpiresAt: string;
    readonly now: string;
  }): Promise<void>;
  completeVendorCreation(input: {
    readonly jobId: PrivateRowId;
    readonly vendorJobIdEnvelope: AeadEnvelopeV1;
    readonly expectedState: OmrLifecycleState;
    readonly expectedVendorCreateLeaseExpiresAt?: string;
    readonly cleanupLeaseToken?: string;
    readonly completionMode: "public-handle-recovery" | "cleanup-reconciliation";
    readonly now: string;
  }): Promise<void>;
  markVendorCreationUnresolved(input: {
    readonly jobId: PrivateRowId;
    readonly expectedState: OmrLifecycleState;
    readonly expectedVendorCreateLeaseExpiresAt: string;
    readonly code: string;
    readonly messageKo: string;
    readonly now: string;
  }): Promise<void>;
  failVendorCreation(input: {
    readonly jobId: PrivateRowId;
    readonly expectedVendorCreateLeaseExpiresAt: string;
    readonly code: string;
    readonly messageKo: string;
    readonly now: string;
  }): Promise<void>;
  findOwnedByHandleHash(handleHash: string, ownerSessionId: PrivateRowId, includeInactive?: boolean): Promise<DurableOmrJobRecord | undefined>;
  claimPage(jobId: PrivateRowId, page: OmrPageRecord, maxRetries: number, leaseToken: string, leaseExpiresAt: string, supportsIdempotency: boolean, now: string): Promise<OmrPageClaim>;
  completePage(jobId: PrivateRowId, pageIndex: number, leaseToken: string, objectReferenceId: PrivateRowId, now: string): Promise<boolean>;
  failPage(jobId: PrivateRowId, pageIndex: number, leaseToken: string, outcome: "failed" | "reconciliation-required", now: string): Promise<void>;
  claimOperation(input: { readonly jobId: PrivateRowId; readonly kind: OmrOperationKind; readonly operationRequestDigest: SemanticDigest; readonly expectedStates: readonly OmrLifecycleState[]; readonly leaseToken: string; readonly leaseExpiresAt: string; readonly supportsIdempotency: boolean; readonly now: string }): Promise<OmrOperationClaim>;
  completeOperation(input: { readonly jobId: PrivateRowId; readonly kind: OmrOperationKind; readonly leaseToken: string; readonly update: Partial<DurableOmrJobRecord>; readonly now: string }): Promise<boolean>;
  failOperation(input: { readonly jobId: PrivateRowId; readonly kind: OmrOperationKind; readonly leaseToken: string; readonly update: Partial<DurableOmrJobRecord>; readonly now: string }): Promise<boolean>;
  claimResultCapture(input: { readonly jobId: PrivateRowId; readonly leaseToken: string; readonly leaseExpiresAt: string; readonly now: string }): Promise<OmrResultCaptureClaim>;
  completeResultCapture(input: { readonly jobId: PrivateRowId; readonly leaseToken: string; readonly update: Partial<DurableOmrJobRecord>; readonly now: string }): Promise<boolean>;
  releaseResultCapture(jobId: PrivateRowId, leaseToken: string, now: string): Promise<void>;
  transition(jobId: PrivateRowId, update: Partial<DurableOmrJobRecord>, now: string): Promise<void>;
  markHandleDeleted(jobId: PrivateRowId, now: string): Promise<void>;
  recordAudit(jobId: PrivateRowId | undefined, eventKind: string, outcome: string, now: string): Promise<void>;
  claimCleanup(input: { readonly now: string; readonly limit: number; readonly leaseToken: string; readonly leaseExpiresAt: string }): Promise<readonly DurableOmrJobRecord[]>;
  completeCleanup(input: { readonly jobId: PrivateRowId; readonly leaseToken: string; readonly update: Partial<DurableOmrJobRecord>; readonly now: string }): Promise<boolean>;
}

interface IdempotencyEntry { readonly requestDigest: SemanticDigest; readonly jobId: PrivateRowId; complete: boolean; failure?: { readonly code: string; readonly messageKo: string } }

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

  async inspectCreate(input: Parameters<OmrStore["inspectCreate"]>[0]): Promise<OmrCreateInspection> {
    return this.atomic(() => {
      const prior = this.idempotency.get(`${input.ownerSessionId}:${input.idempotencyKeyHash}`);
      if (!prior) return { status: "missing" };
      if (prior.requestDigest !== input.requestDigest) return { status: "conflict" };
      const job = this.jobs.get(prior.jobId)!;
      if (prior.complete) return prior.failure
        ? { status: "rejected", ...prior.failure }
        : isCreateReplayUsable(job, input.now)
          ? { status: "replay", handleReplayEnvelope: structuredClone(job.publicHandleReplayEnvelope) }
          : { status: "replay-unavailable" };
      if (!job.handleActive || (job.state !== "created"
        && !(job.state === "reconciliation-required" && job.reconciliationKind === "create"))) return { status: "pending" };
      if (job.vendorCreateLeaseExpiresAt > input.now) return { status: "pending" };
      const resumed = { ...job, vendorCreateLeaseExpiresAt: input.vendorCreateLeaseExpiresAt, updatedAt: input.now };
      this.jobs.set(job.id, resumed);
      return { status: "resume", job: this.clone(resumed) };
    });
  }

  async claimCreate(input: Parameters<OmrStore["claimCreate"]>[0]): Promise<OmrCreateClaim> {
    return this.atomic(() => {
      const idempotencyKey = `${input.ownerSessionId}:${input.idempotencyKeyHash}`;
      const prior = this.idempotency.get(idempotencyKey);
      if (prior) {
        if (prior.requestDigest !== input.requestDigest) return { status: "conflict" };
        const job = this.jobs.get(prior.jobId)!;
        if (prior.complete) return prior.failure
          ? { status: "rejected", ...prior.failure }
          : isCreateReplayUsable(job, input.now)
            ? { status: "replay", handleReplayEnvelope: structuredClone(job.publicHandleReplayEnvelope) }
            : { status: "replay-unavailable" };
        if (!job.handleActive || (job.state !== "created"
          && !(job.state === "reconciliation-required" && job.reconciliationKind === "create"))) return { status: "pending" };
        if (job.vendorCreateLeaseExpiresAt <= input.now) {
          const resumed = { ...job, vendorCreateLeaseExpiresAt: input.record.vendorCreateLeaseExpiresAt, updatedAt: input.now };
          this.jobs.set(job.id, resumed);
          return { status: "resume", job: this.clone(resumed) };
        }
        return { status: "pending" };
      }
      const active = [...this.jobs.values()].filter(hasActiveOmrVendorExposure);
      if (active.filter((job) => job.ownerSessionId === input.ownerSessionId).length >= input.quota.maxConcurrentJobsPerSession
        || active.filter((job) => job.ipOwnerHash === input.ipOwnerHash).length >= input.quota.maxConcurrentJobsPerIp) return { status: "quota-denied" };
      const hourStart = new Date(new Date(input.now).getTime() - 60 * 60 * 1_000).toISOString();
      if ([...this.jobs.values()].filter((job) => job.ownerSessionId === input.ownerSessionId && job.createdAt > hourStart).length >= input.quota.maxJobsPerSessionPerHour
        || [...this.jobs.values()].filter((job) => job.ipOwnerHash === input.ipOwnerHash && job.createdAt > hourStart).length >= input.quota.maxJobsPerIpPerHour) return { status: "quota-denied" };
      const { dayStartUtc, nextDayStartUtc } = utcAccountingWindow(input.now);
      const reserved = [...this.jobs.values()].filter((job) => job.creditState === "reserved"
        || (job.creditState === "settled" && job.createdAt >= dayStartUtc && job.createdAt < nextDayStartUtc))
        .reduce((sum, job) => sum + job.creditEstimate, 0);
      if (reserved + input.record.creditEstimate > input.quota.dailyGlobalCreditCeiling) return { status: "credit-denied" };
      const record = { ...structuredClone(input.record), id: this.id() } as DurableOmrJobRecord;
      this.jobs.set(record.id, record);
      this.idempotency.set(idempotencyKey, { requestDigest: input.requestDigest, jobId: record.id, complete: false });
      return { status: "claimed", job: this.clone(record) };
    });
  }

  async beginVendorCreation(input: Parameters<OmrStore["beginVendorCreation"]>[0]): Promise<void> {
    await this.atomic(() => {
      const job = this.jobs.get(input.jobId);
      if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      if (!job.handleActive || job.state !== input.expectedState
        || (job.state === "reconciliation-required" && job.reconciliationKind !== "create")
        || job.vendorCreateOutcomeState !== input.expectedOutcomeState
        || job.vendorCreateLeaseExpiresAt !== input.expectedVendorCreateLeaseExpiresAt
        || job.vendorJobIdEnvelope !== undefined || job.cleanupLeaseToken !== undefined) {
        throw new RangeError("OMR_CREATE_COMPLETION_SUPERSEDED");
      }
      this.jobs.set(job.id, { ...job, vendorCreateOutcomeState: "outcome-uncertain", updatedAt: input.now });
    });
  }

  async completeVendorCreation(input: Parameters<OmrStore["completeVendorCreation"]>[0]): Promise<void> {
    await this.atomic(() => {
      const job = this.jobs.get(input.jobId);
      if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      const entry = [...this.idempotency.values()].find((value) => value.jobId === input.jobId);
      const publicRecovery = input.completionMode === "public-handle-recovery";
      const modeMatches = publicRecovery
        ? job.handleActive
          && (job.state === "created" || (job.state === "reconciliation-required" && job.reconciliationKind === "create"))
          && job.cleanupLeaseToken === undefined
          && input.cleanupLeaseToken === undefined
          && input.expectedVendorCreateLeaseExpiresAt !== undefined
          && job.vendorCreateLeaseExpiresAt === input.expectedVendorCreateLeaseExpiresAt
        : !job.handleActive
          && job.state === "delete-pending"
          && (input.cleanupLeaseToken === undefined
            ? job.cleanupLeaseToken === undefined
              && input.expectedVendorCreateLeaseExpiresAt !== undefined
              && job.vendorCreateLeaseExpiresAt === input.expectedVendorCreateLeaseExpiresAt
            : job.cleanupLeaseToken === input.cleanupLeaseToken);
      const fenceMatches = job.state === input.expectedState
        && job.vendorCreateOutcomeState === "outcome-uncertain"
        && job.vendorJobIdEnvelope === undefined
        && entry !== undefined
        && !entry.complete
        && modeMatches;
      if (!fenceMatches) throw new RangeError("OMR_CREATE_COMPLETION_SUPERSEDED");
      const updated = publicRecovery
        ? {
          ...job, state: "created" as const, vendorCreateOutcomeState: "confirmed" as const,
          vendorJobIdEnvelope: structuredClone(input.vendorJobIdEnvelope), reconciliationKind: undefined,
          publicFailureCode: undefined, publicFailureMessageKo: undefined, updatedAt: input.now,
        }
        : {
          ...job, vendorCreateOutcomeState: "confirmed" as const,
          vendorJobIdEnvelope: structuredClone(input.vendorJobIdEnvelope), updatedAt: input.now,
        };
      this.jobs.set(input.jobId, updated);
      entry.complete = true;
      entry.failure = undefined;
    });
  }

  async markVendorCreationUnresolved(input: Parameters<OmrStore["markVendorCreationUnresolved"]>[0]): Promise<void> {
    await this.atomic(() => {
      const job = this.jobs.get(input.jobId);
      if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      const entry = [...this.idempotency.values()].find((value) => value.jobId === input.jobId);
      const resumableState = job.state === "created"
        || (job.state === "reconciliation-required" && job.reconciliationKind === "create");
      if (!job.handleActive || job.state !== input.expectedState || !resumableState
        || job.vendorCreateOutcomeState !== "outcome-uncertain"
        || job.vendorCreateLeaseExpiresAt !== input.expectedVendorCreateLeaseExpiresAt
        || job.vendorJobIdEnvelope !== undefined || job.cleanupLeaseToken !== undefined
        || entry === undefined || entry.complete) {
        throw new RangeError("OMR_CREATE_COMPLETION_SUPERSEDED");
      }
      this.jobs.set(input.jobId, {
        ...job, state: "reconciliation-required", reconciliationKind: "create",
        publicFailureCode: input.code, publicFailureMessageKo: input.messageKo, updatedAt: input.now,
      });
    });
  }

  async failVendorCreation(input: Parameters<OmrStore["failVendorCreation"]>[0]): Promise<void> {
    await this.atomic(() => {
      const job = this.jobs.get(input.jobId); if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      if (job.state !== "created" || job.vendorCreateOutcomeState !== "outcome-uncertain"
        || job.vendorCreateLeaseExpiresAt !== input.expectedVendorCreateLeaseExpiresAt
        || job.vendorJobIdEnvelope !== undefined || job.cleanupLeaseToken !== undefined) {
        throw new RangeError("OMR_CREATE_COMPLETION_SUPERSEDED");
      }
      this.jobs.set(input.jobId, { ...job, state: "failed", vendorCreateOutcomeState: "definitive-no-job", creditState: "released", publicFailureCode: input.code, publicFailureMessageKo: input.messageKo, updatedAt: input.now });
      const entry = [...this.idempotency.values()].find((value) => value.jobId === input.jobId);
      if (entry) { entry.complete = true; entry.failure = { code: input.code, messageKo: input.messageKo }; }
    });
  }

  async findOwnedByHandleHash(handleHash: string, ownerSessionId: PrivateRowId, includeInactive = false): Promise<DurableOmrJobRecord | undefined> {
    const found = [...this.jobs.values()].find((job) => job.publicHandleHash === handleHash && job.ownerSessionId === ownerSessionId && (job.handleActive || includeInactive));
    return found ? this.clone(found) : undefined;
  }

  async claimPage(jobId: PrivateRowId, page: OmrPageRecord, maxRetries: number, leaseToken: string, leaseExpiresAt: string, supportsIdempotency: boolean, now: string): Promise<OmrPageClaim> {
    return this.atomic(() => {
      const job = this.jobs.get(jobId);
      if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      if (!["created", "uploading"].includes(job.state)) return { status: "conflict" };
      const prior = job.pages.find((candidate) => candidate.pageIndex === page.pageIndex);
      const duplicate = job.pages.find((candidate) => candidate.pageIndex !== page.pageIndex && candidate.pageDigest === page.pageDigest);
      if (duplicate && page.duplicateConfirmed !== true) return { status: "duplicate-confirmation-required" };
      if (prior) {
        if (prior.pageDigest !== page.pageDigest || prior.idempotencyKeyHash !== page.idempotencyKeyHash) return { status: "conflict" };
        if (prior.uploadState === "uploaded") return { status: "replay" };
        if (prior.uploadState === "reconciliation-required") return { status: "reconciliation-required" };
        if (prior.uploadState === "pending" && (prior.uploadLeaseExpiresAt ?? "") > now) return { status: "pending" };
        if (prior.uploadState === "pending" && !supportsIdempotency) {
          const pages = job.pages.map((candidate) => candidate.pageIndex === page.pageIndex ? { ...candidate, uploadState: "reconciliation-required" as const, uploadLeaseToken: undefined, uploadLeaseExpiresAt: undefined } : candidate);
          this.jobs.set(jobId, { ...job, pages, state: "reconciliation-required", reconciliationKind: "page-upload", updatedAt: now });
          return { status: "reconciliation-required" };
        }
        if (prior.uploadState === "failed" && prior.retryCount >= maxRetries) return { status: "retry-exhausted" };
      }
      const retryCount = prior?.uploadState === "failed" ? prior.retryCount + 1 : prior?.retryCount ?? 0;
      const claimed = { ...page, retryCount, uploadState: "pending" as const, uploadLeaseToken: leaseToken, uploadLeaseExpiresAt: leaseExpiresAt };
      const pages = [...job.pages.filter((candidate) => candidate.pageIndex !== page.pageIndex), claimed].sort((a, b) => a.pageIndex - b.pageIndex);
      this.jobs.set(jobId, { ...job, pages, state: "uploading", updatedAt: now });
      return { status: "claimed", page: structuredClone(claimed) };
    });
  }

  async completePage(jobId: PrivateRowId, pageIndex: number, leaseToken: string, objectReferenceId: PrivateRowId, now: string): Promise<boolean> {
    return this.atomic(() => {
      const job = this.jobs.get(jobId); const page = job?.pages.find((candidate) => candidate.pageIndex === pageIndex);
      if (!job || !["created", "uploading"].includes(job.state) || !page || page.uploadState !== "pending" || page.uploadLeaseToken !== leaseToken) return false;
      this.jobs.set(jobId, { ...job, pages: job.pages.map((candidate) => candidate.pageIndex === pageIndex ? { ...candidate, objectReferenceId, uploadState: "uploaded", uploadLeaseToken: undefined, uploadLeaseExpiresAt: undefined } : candidate), updatedAt: now });
      return true;
    });
  }

  async failPage(jobId: PrivateRowId, pageIndex: number, leaseToken: string, outcome: "failed" | "reconciliation-required", now: string): Promise<void> {
    await this.atomic(() => {
      const job = this.jobs.get(jobId); if (!job) return;
      const page = job.pages.find((candidate) => candidate.pageIndex === pageIndex);
      if (!page || page.uploadLeaseToken !== leaseToken) return;
      this.jobs.set(jobId, {
        ...job,
        pages: job.pages.map((candidate) => candidate.pageIndex === pageIndex ? { ...candidate, uploadState: outcome, uploadLeaseToken: undefined, uploadLeaseExpiresAt: undefined } : candidate),
        ...(outcome === "reconciliation-required" && ["created", "uploading"].includes(job.state) ? { state: "reconciliation-required" as const, reconciliationKind: "page-upload" as const } : {}),
        updatedAt: now,
      });
    });
  }

  async claimOperation(input: Parameters<OmrStore["claimOperation"]>[0]): Promise<OmrOperationClaim> {
    return this.atomic(() => {
      const job = this.jobs.get(input.jobId);
      if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      if (job.operationKind) {
        if ((job.operationLeaseExpiresAt ?? "") > input.now) return { status: "pending" };
        if (job.operationRequestDigest !== input.operationRequestDigest) return { status: "request-conflict" };
        if (job.operationKind !== input.kind || !input.supportsIdempotency) {
          this.jobs.set(job.id, { ...job, state: "reconciliation-required", reconciliationKind: job.operationKind, operationKind: undefined, operationRequestDigest: undefined, operationLeaseToken: undefined, operationLeaseExpiresAt: undefined, updatedAt: input.now });
          return { status: "reconciliation-required" };
        }
      } else if (!input.expectedStates.includes(job.state)) return { status: "invalid" };
      const resumed = Boolean(job.operationKind);
      const nextState = input.kind === "cancel" ? "cancel-pending" as const : job.state;
      const updated = { ...job, state: nextState, operationKind: input.kind, operationRequestDigest: input.operationRequestDigest, operationLeaseToken: input.leaseToken, operationLeaseExpiresAt: input.leaseExpiresAt, updatedAt: input.now };
      this.jobs.set(job.id, updated);
      return { status: resumed ? "resume" : "claimed", job: this.clone(updated) };
    });
  }

  async completeOperation(input: Parameters<OmrStore["completeOperation"]>[0]): Promise<boolean> {
    return this.atomic(() => {
      const job = this.jobs.get(input.jobId);
      if (!job || job.operationKind !== input.kind || job.operationLeaseToken !== input.leaseToken) return false;
      if (input.update.state !== undefined && !isLegalOmrTransition(job.state, input.update.state)) throw new RangeError("OMR_STATE_TRANSITION_INVALID");
      this.jobs.set(job.id, { ...job, ...structuredClone(input.update), id: job.id, ownerSessionId: job.ownerSessionId, operationKind: undefined, operationRequestDigest: undefined, operationLeaseToken: undefined, operationLeaseExpiresAt: undefined, updatedAt: input.now });
      return true;
    });
  }

  async failOperation(input: Parameters<OmrStore["failOperation"]>[0]): Promise<boolean> {
    return this.completeOperation(input);
  }

  async claimResultCapture(input: Parameters<OmrStore["claimResultCapture"]>[0]): Promise<OmrResultCaptureClaim> {
    return this.atomic(() => {
      const job = this.jobs.get(input.jobId); if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      if (job.state === "completed") return { status: "replay" };
      if (!["queued", "processing", "needs-input", "sync-retry-pending", "capture-retry-pending"].includes(job.state)) return { status: "invalid" };
      if (job.resultCaptureLeaseToken && (job.resultCaptureLeaseExpiresAt ?? "") > input.now) return { status: "pending" };
      const updated = { ...job, resultCaptureLeaseToken: input.leaseToken, resultCaptureLeaseExpiresAt: input.leaseExpiresAt, updatedAt: input.now };
      this.jobs.set(job.id, updated);
      return { status: "claimed", job: this.clone(updated) };
    });
  }

  async completeResultCapture(input: Parameters<OmrStore["completeResultCapture"]>[0]): Promise<boolean> {
    return this.atomic(() => {
      const job = this.jobs.get(input.jobId);
      if (!job || job.resultCaptureLeaseToken !== input.leaseToken || !["queued", "processing", "needs-input", "sync-retry-pending", "capture-retry-pending"].includes(job.state)) return false;
      if (input.update.state !== undefined && !isLegalOmrTransition(job.state, input.update.state)) throw new RangeError("OMR_STATE_TRANSITION_INVALID");
      this.jobs.set(job.id, { ...job, ...structuredClone(input.update), id: job.id, ownerSessionId: job.ownerSessionId, resultCaptureLeaseToken: undefined, resultCaptureLeaseExpiresAt: undefined, updatedAt: input.now });
      return true;
    });
  }

  async releaseResultCapture(jobId: PrivateRowId, leaseToken: string, now: string): Promise<void> {
    await this.atomic(() => { const job = this.jobs.get(jobId); if (job?.resultCaptureLeaseToken === leaseToken) this.jobs.set(job.id, { ...job, resultCaptureLeaseToken: undefined, resultCaptureLeaseExpiresAt: undefined, updatedAt: now }); });
  }

  async transition(jobId: PrivateRowId, update: Partial<DurableOmrJobRecord>, now: string): Promise<void> {
    await this.atomic(() => {
      const job = this.jobs.get(jobId); if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      if (update.state !== undefined && !isLegalOmrTransition(job.state, update.state)) throw new RangeError("OMR_STATE_TRANSITION_INVALID");
      this.jobs.set(jobId, { ...job, ...structuredClone(update), id: job.id, ownerSessionId: job.ownerSessionId, updatedAt: now });
    });
  }

  async markHandleDeleted(jobId: PrivateRowId, now: string): Promise<void> {
    await this.atomic(() => {
      const job = this.jobs.get(jobId);
      if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
      if (!isLegalOmrTransition(job.state, "delete-pending")) throw new RangeError("OMR_STATE_TRANSITION_INVALID");
      const creditState = creditStateAfterHandleDeactivation({ ...job, state: "delete-pending" });
      this.jobs.set(jobId, { ...job, handleActive: false, state: "delete-pending", deletedAt: now, creditState, updatedAt: now });
    });
  }
  async recordAudit(jobId: PrivateRowId | undefined, eventKind: string, outcome: string, now: string): Promise<void> {
    await this.atomic(() => { this.audits.push({ ...(jobId ? { jobId } : {}), eventKind, outcome, createdAt: now }); });
  }
  async claimCleanup(input: Parameters<OmrStore["claimCleanup"]>[0]): Promise<readonly DurableOmrJobRecord[]> {
    const { now, limit } = input;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new RangeError("OMR_CLEANUP_LIMIT_INVALID");
    return this.atomic(() => {
      const selected = [...this.jobs.values()].filter((job) => job.state !== "deleted" && (!job.cleanupLeaseToken || (job.cleanupLeaseExpiresAt ?? "") <= now) && (
        (job.handleActive && job.handleExpiresAt <= now)
        || job.state === "expired"
        || (job.state === "delete-pending" && (
          (job.vendorDeleteState !== "deleted" && (job.vendorDeleteNextAttemptAt ?? now) <= now)
          || (job.localDeleteState !== "deleted" && (job.localDeleteNextAttemptAt ?? now) <= now)
        ))
      )).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
      return selected.map((job) => {
        const base = job.state === "delete-pending"
          ? job
          : { ...job, state: "expired" as const, handleActive: false, updatedAt: now };
        const creditState = creditStateAfterHandleDeactivation(base);
        const updated = { ...base, creditState, cleanupLeaseToken: input.leaseToken, cleanupLeaseExpiresAt: input.leaseExpiresAt };
        this.jobs.set(job.id, updated);
        return this.clone(updated);
      });
    });
  }
  async completeCleanup(input: Parameters<OmrStore["completeCleanup"]>[0]): Promise<boolean> {
    return this.atomic(() => {
      const job = this.jobs.get(input.jobId); if (!job || job.cleanupLeaseToken !== input.leaseToken) return false;
      if (input.update.state !== undefined && !isLegalOmrTransition(job.state, input.update.state)) throw new RangeError("OMR_STATE_TRANSITION_INVALID");
      this.jobs.set(job.id, { ...job, ...structuredClone(input.update), id: job.id, ownerSessionId: job.ownerSessionId, cleanupLeaseToken: undefined, cleanupLeaseExpiresAt: undefined, updatedAt: input.now });
      return true;
    });
  }
  listJobs(): readonly DurableOmrJobRecord[] { return [...this.jobs.values()].map((record) => this.clone(record)); }
  listAudits(): readonly { readonly jobId?: PrivateRowId; readonly eventKind: string; readonly outcome: string; readonly createdAt: string }[] { return structuredClone(this.audits); }
}

export function publicStatusFromRecord(job: DurableOmrJobRecord): OmrPublicStatus {
  if (job.state === "uploading") return { kind: "uploading", uploadedPages: job.pages.filter((page) => page.uploadState === "uploaded").length, totalPages: job.pageCount };
  if (job.state === "processing") return { kind: "processing", ...(job.progressBp === undefined ? {} : { progressBp: job.progressBp as never }) };
  if (job.state === "needs-input" && job.currentInputRequest) return { kind: "needs-input", inputRequest: job.currentInputRequest };
  if (job.state === "cancel-pending") return { kind: "cancel-pending", messageKo: "제공자 취소 확인을 기다리고 있습니다." };
  if (job.state === "cancel-failed") return { kind: "cancel-failed", code: job.publicFailureCode ?? "OMR_VENDOR_CANCEL_FAILED", messageKo: job.publicFailureMessageKo ?? "제공자 취소 요청이 완료되지 않았습니다." };
  if (job.state === "reconciliation-required") return { kind: "reconciliation-required", code: "OMR_JOB_RECONCILIATION_REQUIRED", messageKo: job.publicFailureMessageKo ?? "제공자 작업 상태를 확인해야 합니다." };
  if ((job.state === "sync-retry-pending" || job.state === "capture-retry-pending") && job.retryNextAttemptAt && job.retryAttempt) return { kind: "retry-pending", operation: job.state === "sync-retry-pending" ? "sync" : "capture", attempt: job.retryAttempt, nextAttemptAt: job.retryNextAttemptAt, messageKo: "일시적 오류로 안전하게 재시도할 예정입니다." };
  if (job.state === "failed" || job.state === "expired" || job.state === "delete-pending" || job.state === "deleted") return { kind: "failed", code: job.publicFailureCode ?? "OMR_JOB_UNAVAILABLE", messageKo: job.publicFailureMessageKo ?? "OMR 작업을 사용할 수 없습니다." };
  if (job.state === "cancelled") return { kind: "cancelled" };
  if (job.state === "queued") return { kind: "queued" };
  if (job.state === "completed") return { kind: "completed" };
  return { kind: "created" };
}
