import "server-only";

import { binaryDigest, semanticDigest } from "../../domain/digest/canonical";
import { computeProviderBundleDigest } from "../../domain/omr/foundation";
import type { ImageQualityReport } from "../../domain/omr/image-quality";
import type { InputSourceKind } from "../../domain/omr/input";
import {
  CORE_OMR_QUOTA_DEFAULTS, MAX_OMR_CREDIT_ESTIMATE, MAX_OMR_DAILY_CREDIT_CEILING,
  OMR_VENDOR_ADAPTER_CONTRACT_VERSION, OMR_VENDOR_CREATE_DEFINITIVE_REJECTION,
  VENDOR_INPUT_REQUEST_LIMITS, canonicalizeVendorCapabilities,
  validateVendorCapabilities, validateVendorInputRequest, validateVendorNormalizationMappingArtifact, vendorCallOutcome,
  type CanonicalOmrCreateRequest,
  type OmrApplicationService, type OmrDeleteResult, type OmrJobHandle,
  type OmrPageUpload, type OmrProviderResult, type OmrPublicStatus,
  type OmrQuotaConfig, type OmrVendorAdapter, type VendorDeleteResult,
  type VendorInputRequest, type VendorInputResponse, type VendorJobId,
} from "../../domain/omr/contracts";
import { validateRights } from "../../domain/source/model";
import type { PrivateRowId } from "../persistence/store";
import {
  decryptAeadV1, encryptAeadV1, generateOpaqueToken, keyedTokenHash, timingSafeHashEquals,
} from "../security/crypto-core";
import type { OwnedObjectStore } from "../storage/owned-object-store";
import type { OwnedObjectRead } from "../storage/owned-object-store";
import {
  creditStateAfterHandleDeactivation, publicStatusFromRecord,
  type DurableOmrJobRecord, type DurableOmrProviderDeleteOperation, type OmrPageRecord, type OmrStore,
} from "./store";
import { asOmrProviderContractError, classifyOmrProviderFailure, type OmrProviderFailureOrigin } from "./provider-failure";

const HANDLE_VERSION = "v1";
const HANDLE_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const CREATE_LEASE_MS = 5 * 60 * 1_000;
const OPERATION_LEASE_MS = 5 * 60 * 1_000;
const DELETE_RETRY_MS = 60 * 1_000;
const CLEANUP_LEASE_MS = 5 * 60 * 1_000;
const RETRY_BACKOFF_MS = Object.freeze([60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "deleted", "expired"]);
const STATUS_OBSERVATION_STATES = Object.freeze(["queued", "processing", "needs-input", "sync-retry-pending"] as const);
const RESULT_CAPTURE_STATES = Object.freeze(["queued", "processing", "needs-input", "sync-retry-pending", "capture-retry-pending"] as const);
const BINDING_UNAVAILABLE_DELETE_MESSAGE_KO = "생성 시점 인식 제공자 binding을 현재 사용할 수 없어 Vendor 삭제를 재시도합니다.";
const CREATE_OUTCOME_UNCERTAIN_CODE = "OMR_VENDOR_CREATE_OUTCOME_UNCERTAIN";
const CREATE_OUTCOME_UNCERTAIN_MESSAGE_KO = "Vendor 생성 결과가 아직 확정되지 않아 외부 삭제 완료를 확인할 수 없습니다.";
const CREATE_RECONCILIATION_PERSIST_CODE = "OMR_VENDOR_CREATE_RECONCILIATION_PENDING";

const GRANULARITY_RANK = Object.freeze({ none: 0, page: 1, staff: 2, measure: 3, symbol: 4 });
export const PROVIDER_CAPTURE_LIMITS = Object.freeze({
  musicXmlBytes: 4_000_000,
  evidenceItems: 20_000,
  frames: 2_000,
  transforms: 8_000,
  mappings: 20_000,
  stringLength: 4_096,
  visitedValues: 250_000,
});

export function assertBoundedProviderValue(value: unknown): void {
  const stack: unknown[] = [value];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    visited += 1;
    if (visited > PROVIDER_CAPTURE_LIMITS.visitedValues) throw new RangeError("OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED");
    if (typeof current === "string" && current.length > PROVIDER_CAPTURE_LIMITS.stringLength) throw new RangeError("OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED");
    if (Array.isArray(current)) stack.push(...current);
    else if (current && typeof current === "object") stack.push(...Object.values(current));
  }
}

export function validateEvidenceCaptureLimits(evidence: Awaited<ReturnType<OmrVendorAdapter["getEvidence"]>>): void {
  if (evidence.evidence.length > PROVIDER_CAPTURE_LIMITS.evidenceItems
    || evidence.frames.length > PROVIDER_CAPTURE_LIMITS.frames
    || evidence.transforms.length > PROVIDER_CAPTURE_LIMITS.transforms) throw new RangeError("OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED");
  assertBoundedProviderValue(evidence);
  const ranks = evidence.evidence.map((item) => GRANULARITY_RANK[item.granularity]);
  if (ranks.some((rank) => rank === 0) || Math.max(0, ...ranks) !== GRANULARITY_RANK[evidence.granularity]) {
    throw new RangeError("OMR_PROVIDER_CAPABILITY_MISSING");
  }
}

export function validateNormalizationMappingCaptureLimits(
  mapping: Awaited<ReturnType<OmrVendorAdapter["getNormalizationMapping"]>>,
): void {
  if (mapping.mappings.length > PROVIDER_CAPTURE_LIMITS.mappings) throw new RangeError("OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED");
  assertBoundedProviderValue(mapping);
}

export interface OmrPageInspection {
  readonly bytes: Uint8Array;
  readonly digest: Awaited<ReturnType<typeof binaryDigest>>;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly quality: ImageQualityReport;
}

export interface OmrApplicationPageUpload extends OmrPageUpload {
  readonly warnAcknowledged?: boolean;
  readonly duplicateConfirmed?: boolean;
}

export interface OmrApplicationActor {
  readonly sessionId: PrivateRowId;
  readonly ipOwnerHash: string;
}

export interface OmrApplicationDependencies {
  readonly store: OmrStore;
  readonly objects: OwnedObjectStore;
  readonly adapter: OmrVendorAdapter;
  readonly providerBindingId?: string;
  readonly providerVendorId?: string;
  readonly adapterContractVersion?: string;
  readonly resolveAdapter?: (providerBindingId: string, adapterContractVersion: string, vendorId: string) => OmrVendorAdapter | undefined;
  readonly handleHmacKey: Uint8Array;
  readonly vendorJobEncryptionKey: Uint8Array;
  readonly quota: OmrQuotaConfig;
  readonly actor: OmrApplicationActor;
  readonly inspectPage: (input: { readonly bytes: Uint8Array; readonly mimeType: string; readonly pageIndex: number }) => Promise<OmrPageInspection>;
  readonly now?: () => Date;
}

export interface OmrCleanupItemFailure {
  readonly jobId: PrivateRowId;
  readonly code: string;
}

export interface OmrCleanupBatchSummary {
  readonly attemptedJobs: number;
  readonly completedJobs: number;
  readonly failedJobs: number;
  readonly results: readonly { readonly jobId: PrivateRowId; readonly result: OmrDeleteResult }[];
  readonly failures: readonly OmrCleanupItemFailure[];
}

function cleanupItemFailureCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_:-]{1,127}$/u.test(error.message)
    ? error.message
    : "OMR_CLEANUP_ITEM_FAILED";
}

type ExistingJobAdapterResolution =
  | { readonly status: "available"; readonly adapter: OmrVendorAdapter }
  | { readonly status: "binding-unavailable"; readonly code: "OMR_PROVIDER_BINDING_UNAVAILABLE" };

function sanitizeVendorFailure(): { readonly code: string; readonly messageKo: string } {
  return { code: "OMR_VENDOR_OPERATION_FAILED", messageKo: "악보 인식 서비스 작업을 완료하지 못했습니다." };
}

function inputResponseValid(request: VendorInputRequest, response: VendorInputResponse): boolean {
  if (request.kind !== response.kind || request.requestId !== response.requestId) return false;
  if (request.kind === "select-instrument" && response.kind === "select-instrument") return request.choices.includes(response.choice);
  if (request.kind === "confirm-page-order" && response.kind === "confirm-page-order") {
    return response.pageIndices.length === request.pageIndices.length
      && new Set(response.pageIndices).size === response.pageIndices.length
      && [...response.pageIndices].sort((a, b) => a - b).every((value, index) => value === [...request.pageIndices].sort((a, b) => a - b)[index]);
  }
  if (request.kind === "vendor-specific" && response.kind === "vendor-specific") {
    try {
      const entries = Object.entries(response.payload);
      const encoder = new TextEncoder();
      return request.schemaId === response.schemaId
        && entries.length <= VENDOR_INPUT_REQUEST_LIMITS.payloadEntries
        && encoder.encode(JSON.stringify(response.payload)).byteLength <= VENDOR_INPUT_REQUEST_LIMITS.payloadBytes
        && entries.every(([key, value]) => key.length > 0
          && encoder.encode(key).byteLength <= VENDOR_INPUT_REQUEST_LIMITS.payloadKeyLength
          && (typeof value === "boolean"
            || (typeof value === "number" && Number.isSafeInteger(value))
            || (typeof value === "string"
              && encoder.encode(value).byteLength <= VENDOR_INPUT_REQUEST_LIMITS.payloadStringLength)));
    } catch { return false; }
  }
  return false;
}

export function omrQuotaConfig(dailyGlobalCreditCeiling: number): OmrQuotaConfig {
  if (!Number.isSafeInteger(dailyGlobalCreditCeiling) || dailyGlobalCreditCeiling <= 0
    || dailyGlobalCreditCeiling > MAX_OMR_DAILY_CREDIT_CEILING) throw new RangeError("OMR_DAILY_GLOBAL_CREDIT_CEILING_INVALID");
  return { ...CORE_OMR_QUOTA_DEFAULTS, dailyGlobalCreditCeiling };
}

export class DurableOmrApplicationService implements OmrApplicationService {
  private readonly now: () => Date;

  constructor(private readonly dependencies: OmrApplicationDependencies) {
    if (dependencies.handleHmacKey.byteLength < 32 || dependencies.vendorJobEncryptionKey.byteLength !== 32) throw new RangeError("OMR_SECRET_CONFIGURATION_INVALID");
    this.now = dependencies.now ?? (() => new Date());
  }

  private issueHandle(now: Date): OmrJobHandle {
    const nonce = generateOpaqueToken(32);
    const expires = Math.floor((now.getTime() + HANDLE_LIFETIME_MS) / 1_000);
    const payload = `${HANDLE_VERSION}.${nonce}.${expires}`;
    const signature = keyedTokenHash(payload, this.dependencies.handleHmacKey, "omr-handle-signature-v1");
    return `${payload}.${signature}` as OmrJobHandle;
  }

  private handleHash(handle: OmrJobHandle, now: Date): string {
    const match = /^v1\.([A-Za-z0-9_-]{43})\.(\d{10,12})\.([a-f0-9]{64})$/u.exec(handle);
    if (!match) throw new RangeError("OMR_JOB_UNAVAILABLE");
    const payload = `${HANDLE_VERSION}.${match[1]}.${match[2]}`;
    const expected = keyedTokenHash(payload, this.dependencies.handleHmacKey, "omr-handle-signature-v1");
    if (!timingSafeHashEquals(expected, match[3]) || Number(match[2]) * 1_000 <= now.getTime()) throw new RangeError("OMR_JOB_UNAVAILABLE");
    return keyedTokenHash(handle, this.dependencies.handleHmacKey, "omr-handle-verifier-v1");
  }

  private async owned(handle: OmrJobHandle): Promise<DurableOmrJobRecord> {
    const now = this.now();
    const record = await this.dependencies.store.findOwnedByHandleHash(this.handleHash(handle, now), this.dependencies.actor.sessionId);
    if (!record || record.handleExpiresAt <= now.toISOString()) throw new RangeError("OMR_JOB_UNAVAILABLE");
    return record;
  }

  private vendorJobId(job: DurableOmrJobRecord): VendorJobId {
    if (!job.vendorJobIdEnvelope) throw new RangeError("OMR_JOB_RECONCILIATION_REQUIRED");
    const bytes = decryptAeadV1(job.vendorJobIdEnvelope, this.dependencies.vendorJobEncryptionKey);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes) as VendorJobId;
  }

  private adapterFor(job: DurableOmrJobRecord): OmrVendorAdapter {
    const resolved = this.dependencies.resolveAdapter?.(job.providerBindingId, job.adapterContractVersion, job.capabilities.vendorId);
    if (resolved) return resolved;
    const currentBindingId = this.dependencies.providerBindingId ?? job.capabilities.vendorId;
    const currentContractVersion = this.dependencies.adapterContractVersion ?? OMR_VENDOR_ADAPTER_CONTRACT_VERSION;
    if (job.providerBindingId === currentBindingId && job.adapterContractVersion === currentContractVersion) return this.dependencies.adapter;
    throw new RangeError("OMR_PROVIDER_BINDING_UNAVAILABLE");
  }

  private resolveExistingJobAdapter(job: DurableOmrJobRecord): ExistingJobAdapterResolution {
    try { return { status: "available", adapter: this.adapterFor(job) }; }
    catch (error) {
      if (error instanceof RangeError && error.message === "OMR_PROVIDER_BINDING_UNAVAILABLE") {
        return { status: "binding-unavailable", code: "OMR_PROVIDER_BINDING_UNAVAILABLE" };
      }
      throw error;
    }
  }

  private async recordAuditBestEffort(jobId: PrivateRowId | undefined, eventKind: string, outcome: string, now: string): Promise<void> {
    try { await this.dependencies.store.recordAudit(jobId, eventKind, outcome, now); }
    catch { console.error("OMR_AUDIT_WRITE_FAILED", { eventKind }); }
  }

  private retryUpdate(job: DurableOmrJobRecord, kind: "sync" | "capture", code: string, now: Date): Partial<DurableOmrJobRecord> {
    const attempt = job.retryKind === kind ? (job.retryAttempt ?? 0) + 1 : 1;
    if (attempt > RETRY_BACKOFF_MS.length) return {
      state: "reconciliation-required",
      reconciliationKind: kind,
      retryKind: undefined,
      retryAttempt: undefined,
      retryNextAttemptAt: undefined,
      retryLastFailureCode: undefined,
      publicFailureCode: "OMR_RETRY_EXHAUSTED",
      publicFailureMessageKo: "일시적 오류 재시도 한도를 넘어 제공자 상태 확인이 필요합니다.",
    };
    return {
      state: kind === "sync" ? "sync-retry-pending" : "capture-retry-pending",
      retryKind: kind,
      retryAttempt: attempt,
      retryNextAttemptAt: new Date(now.getTime() + RETRY_BACKOFF_MS[attempt - 1]).toISOString(),
      retryLastFailureCode: code,
      publicFailureCode: undefined,
      publicFailureMessageKo: undefined,
    };
  }

  private clearRetry(): Partial<DurableOmrJobRecord> {
    return { retryKind: undefined, retryAttempt: undefined, retryNextAttemptAt: undefined, retryLastFailureCode: undefined };
  }

  async getProviderPreflight() {
    const capabilities = canonicalizeVendorCapabilities(await this.dependencies.adapter.getCapabilities());
    validateVendorCapabilities(capabilities);
    if (this.dependencies.providerVendorId && capabilities.vendorId !== this.dependencies.providerVendorId) {
      throw new RangeError("OMR_PROVIDER_BINDING_INVALID");
    }
    return { capabilities: structuredClone(capabilities), capabilitySnapshotDigest: await semanticDigest({ projectionSchema: "hm-omr-capability-snapshot-v1", capabilities }) };
  }

  async preflightPage(page: Pick<OmrPageUpload, "pageIndex" | "pageDigest" | "mimeType" | "bytes">) {
    if (!Number.isSafeInteger(page.pageIndex) || page.pageIndex < 0) throw new RangeError("OMR_PAGE_INDEX_INVALID");
    const rawBytes = new Uint8Array(await page.bytes.arrayBuffer());
    if (await binaryDigest(rawBytes) !== page.pageDigest) throw new RangeError("OMR_PAGE_DIGEST_MISMATCH");
    const inspected = await this.dependencies.inspectPage({ bytes: rawBytes, mimeType: page.mimeType, pageIndex: page.pageIndex });
    return { digest: inspected.digest, width: inspected.width, height: inspected.height, quality: inspected.quality };
  }

  async createJob(request: Parameters<OmrApplicationService["createJob"]>[0]): Promise<OmrJobHandle> {
    const now = this.now();
    if (request.sessionId !== this.dependencies.actor.sessionId || request.providerTransferConsent !== true
      || !validateRights(request.rights) || !request.rights.allowedUses.includes("provider-transfer")) throw new RangeError("RIGHTS_PROVIDER_TRANSFER_NOT_CONFIRMED");
    if (!Number.isSafeInteger(request.pageCount) || request.pageCount < 1 || request.pageCount > this.dependencies.quota.maxPagesPerJob) throw new RangeError("OMR_PAGE_LIMIT_EXCEEDED");
    if (!Array.isArray(request.pages) || request.pages.length !== request.pageCount
      || request.pages.some((page, index) => page.pageIndex !== index || !/^[0-9a-f]{64}$/u.test(page.pageDigest)
        || (page.mimeType !== "image/png" && page.mimeType !== "image/jpeg"))) throw new RangeError("OMR_REQUEST_INVALID");
    const handle = this.issueHandle(now);
    const handleHash = keyedTokenHash(handle, this.dependencies.handleHmacKey, "omr-handle-verifier-v1");
    const replayEnvelope = encryptAeadV1(new TextEncoder().encode(handle), this.dependencies.vendorJobEncryptionKey, { associatedDataVersion: "omr-handle-replay-v1" });
    const idempotencyKeyHash = keyedTokenHash(request.idempotencyKey, this.dependencies.handleHmacKey, "omr-create-idempotency-v1");
    const vendorCreateIdempotencyKey = keyedTokenHash(request.idempotencyKey, this.dependencies.handleHmacKey, "omr-vendor-create-v1");
    const sourceKind: InputSourceKind = request.sourceKind;
    const canonicalCreateRequest: CanonicalOmrCreateRequest = {
      pageCount: request.pageCount, pages: request.pages.map((page) => ({ ...page })), sourceKind,
      rights: structuredClone(request.rights), providerTransferConsent: true,
      consentCapabilitySnapshotDigest: request.consentCapabilitySnapshotDigest,
      idempotencyKey: request.idempotencyKey,
    };
    const requestDigest = await semanticDigest({ projectionSchema: "hm-omr-create-request-v2", canonicalCreateRequest });
    const vendorCreateLeaseExpiresAt = new Date(now.getTime() + CREATE_LEASE_MS).toISOString();
    const existing = await this.dependencies.store.inspectCreate({
      ownerSessionId: this.dependencies.actor.sessionId,
      idempotencyKeyHash,
      requestDigest,
      vendorCreateLeaseExpiresAt,
      now: now.toISOString(),
    });
    let claim: Awaited<ReturnType<OmrStore["claimCreate"]>>;
    if (existing.status === "missing") {
      const preflight = await this.getProviderPreflight();
      const capabilities = preflight.capabilities;
      if (request.consentCapabilitySnapshotDigest !== preflight.capabilitySnapshotDigest) throw new RangeError("OMR_PROVIDER_CONSENT_STALE");
      if (request.pageCount > Math.min(capabilities.maxPages, this.dependencies.quota.maxPagesPerJob)) throw new RangeError("OMR_PAGE_LIMIT_EXCEEDED");
      if (capabilities.estimatedCreditPerPage === undefined) throw new RangeError("OMR_CREDIT_ESTIMATE_REQUIRED");
      const creditEstimate = capabilities.estimatedCreditPerPage * request.pageCount;
      if (!Number.isSafeInteger(creditEstimate) || creditEstimate <= 0 || creditEstimate > MAX_OMR_CREDIT_ESTIMATE) throw new RangeError("OMR_CREDIT_ESTIMATE_INVALID");
      const providerBindingId = this.dependencies.providerBindingId ?? capabilities.vendorId;
      const adapterContractVersion = this.dependencies.adapterContractVersion ?? OMR_VENDOR_ADAPTER_CONTRACT_VERSION;
      if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(providerBindingId) || adapterContractVersion.length < 1 || adapterContractVersion.length > 128) throw new RangeError("OMR_PROVIDER_BINDING_INVALID");
      const record: Omit<DurableOmrJobRecord, "id"> = {
        ownerSessionId: this.dependencies.actor.sessionId, ipOwnerHash: this.dependencies.actor.ipOwnerHash,
        publicHandleHash: handleHash, publicHandleReplayEnvelope: replayEnvelope,
        handleExpiresAt: new Date(now.getTime() + HANDLE_LIFETIME_MS).toISOString(), sourceKind,
        pageCount: request.pageCount, canonicalCreateRequest, state: "created", rights: structuredClone(request.rights),
        providerTransferConsent: true, providerConsentRecordedAt: now.toISOString(), capabilities: structuredClone(capabilities), capabilitySnapshotDigest: preflight.capabilitySnapshotDigest,
        providerBindingId, adapterContractVersion,
        vendorCreateIdempotencyKey, vendorCreateLeaseExpiresAt, vendorCreateOutcomeState: "not-attempted",
        creditEstimate, creditState: "reserved", pages: [], handleActive: true,
        vendorDeleteState: "not-started", localDeleteState: "not-started",
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
      };
      claim = await this.dependencies.store.claimCreate({ ownerSessionId: this.dependencies.actor.sessionId, ipOwnerHash: this.dependencies.actor.ipOwnerHash, idempotencyKeyHash, requestDigest, record, quota: this.dependencies.quota, now: now.toISOString() });
    } else {
      claim = existing;
    }
    if (claim.status === "replay") return new TextDecoder().decode(decryptAeadV1(claim.handleReplayEnvelope, this.dependencies.vendorJobEncryptionKey)) as OmrJobHandle;
    if (claim.status === "replay-unavailable") throw new RangeError("OMR_CREATE_REPLAY_UNAVAILABLE");
    if (claim.status === "rejected") throw new RangeError(claim.code);
    if (claim.status === "pending") throw new RangeError("OMR_IDEMPOTENCY_PENDING");
    if (claim.status === "conflict") throw new RangeError("OMR_IDEMPOTENCY_CONFLICT");
    if (claim.status === "quota-denied") {
      await this.recordAuditBestEffort(undefined, "create-denied", "quota", now.toISOString());
      throw new RangeError("OMR_QUOTA_EXCEEDED");
    }
    if (claim.status === "credit-denied") {
      await this.recordAuditBestEffort(undefined, "create-denied", "global-credit", now.toISOString());
      throw new RangeError("OMR_GLOBAL_CREDIT_CEILING_EXCEEDED");
    }
    if (claim.status !== "claimed" && claim.status !== "resume") throw new RangeError("OMR_CREATE_STATE_INVALID");
    const claimedJob = claim.job;
    if (claim.status === "resume" && !claimedJob.capabilities.supportsIdempotency) {
      try {
        await this.dependencies.store.markVendorCreationUnresolved({
          jobId: claimedJob.id, expectedState: claimedJob.state,
          expectedVendorCreateLeaseExpiresAt: claimedJob.vendorCreateLeaseExpiresAt,
          code: "OMR_JOB_RECONCILIATION_REQUIRED", messageKo: "인식 작업 생성 상태를 확인해야 합니다.", now: now.toISOString(),
        });
      } catch {
        await this.recordAuditBestEffort(claimedJob.id, "job-create-superseded", "non-idempotent-resume-fence", now.toISOString());
      }
      throw new RangeError("OMR_JOB_RECONCILIATION_REQUIRED");
    }
    let vendorJobId: VendorJobId;
    const adapter = this.adapterFor(claimedJob);
    try {
      await this.dependencies.store.beginVendorCreation({
        jobId: claimedJob.id, expectedState: claimedJob.state,
        expectedOutcomeState: claimedJob.vendorCreateOutcomeState === "not-attempted" ? "not-attempted" : "outcome-uncertain",
        expectedVendorCreateLeaseExpiresAt: claimedJob.vendorCreateLeaseExpiresAt, now: now.toISOString(),
      });
    } catch {
      await this.recordAuditBestEffort(claimedJob.id, "job-create-superseded", "create-lease-or-state-fence", now.toISOString());
      throw new RangeError(claimedJob.capabilities.supportsIdempotency ? "OMR_IDEMPOTENCY_PENDING" : "OMR_JOB_RECONCILIATION_REQUIRED");
    }
    try {
      vendorJobId = await adapter.createVendorJob({ pageCount: claimedJob.canonicalCreateRequest.pageCount, idempotencyKey: claimedJob.vendorCreateIdempotencyKey });
    } catch (error) {
      const outcome = vendorCallOutcome(error);
      if (outcome === "definitive-rejection" && claimedJob.vendorCreateOutcomeState === "not-attempted") {
        try {
          await this.dependencies.store.failVendorCreation({
            jobId: claimedJob.id, expectedVendorCreateLeaseExpiresAt: claimedJob.vendorCreateLeaseExpiresAt,
            code: OMR_VENDOR_CREATE_DEFINITIVE_REJECTION, messageKo: sanitizeVendorFailure().messageKo, now: now.toISOString(),
          });
        } catch {
          await this.recordAuditBestEffort(claimedJob.id, "job-create-superseded", "definitive-rejection-fence", now.toISOString());
          throw new RangeError("OMR_IDEMPOTENCY_PENDING");
        }
        await this.recordAuditBestEffort(claimedJob.id, "job-create-failed", "definitive-vendor-rejection", now.toISOString());
        throw new RangeError(OMR_VENDOR_CREATE_DEFINITIVE_REJECTION);
      }
      if (!claimedJob.capabilities.supportsIdempotency || outcome === "definitive-rejection") {
        try {
          await this.dependencies.store.markVendorCreationUnresolved({
            jobId: claimedJob.id, expectedState: claimedJob.state,
            expectedVendorCreateLeaseExpiresAt: claimedJob.vendorCreateLeaseExpiresAt,
            code: outcome === "definitive-rejection" ? CREATE_OUTCOME_UNCERTAIN_CODE : "OMR_JOB_RECONCILIATION_REQUIRED",
            messageKo: outcome === "definitive-rejection" ? CREATE_OUTCOME_UNCERTAIN_MESSAGE_KO : "인식 작업 생성 상태를 확인해야 합니다.",
            now: now.toISOString(),
          });
        } catch {
          await this.recordAuditBestEffort(claimedJob.id, "job-create-superseded", "unresolved-create-fence", now.toISOString());
          throw new RangeError(claimedJob.capabilities.supportsIdempotency ? "OMR_IDEMPOTENCY_PENDING" : "OMR_JOB_RECONCILIATION_REQUIRED");
        }
      }
      await this.recordAuditBestEffort(claimedJob.id, "job-create-uncertain", claimedJob.capabilities.supportsIdempotency ? "resumable" : "reconciliation-required", now.toISOString());
      throw new RangeError(outcome === "definitive-rejection"
        ? CREATE_OUTCOME_UNCERTAIN_CODE
        : claimedJob.capabilities.supportsIdempotency ? "OMR_IDEMPOTENCY_PENDING" : "OMR_JOB_RECONCILIATION_REQUIRED");
    }
    try {
      const envelope = encryptAeadV1(new TextEncoder().encode(vendorJobId), this.dependencies.vendorJobEncryptionKey, { associatedDataVersion: "omr-vendor-job-id-v1" });
      await this.dependencies.store.completeVendorCreation({
        jobId: claimedJob.id, vendorJobIdEnvelope: envelope, expectedState: claimedJob.state,
        expectedVendorCreateLeaseExpiresAt: claimedJob.vendorCreateLeaseExpiresAt,
        completionMode: "public-handle-recovery", now: now.toISOString(),
      });
      await this.recordAuditBestEffort(claimedJob.id, "job-created", claim.status, now.toISOString());
      return claim.status === "resume"
        ? new TextDecoder().decode(decryptAeadV1(claimedJob.publicHandleReplayEnvelope, this.dependencies.vendorJobEncryptionKey)) as OmrJobHandle
        : handle;
    } catch {
      if (!claimedJob.capabilities.supportsIdempotency) await this.dependencies.store.markVendorCreationUnresolved({
        jobId: claimedJob.id, expectedState: claimedJob.state,
        expectedVendorCreateLeaseExpiresAt: claimedJob.vendorCreateLeaseExpiresAt,
        code: "OMR_JOB_RECONCILIATION_REQUIRED", messageKo: "인식 작업 생성 상태를 확인해야 합니다.", now: now.toISOString(),
      }).catch(() => undefined);
      await this.recordAuditBestEffort(claimedJob.id, "job-create-persist-pending", claimedJob.capabilities.supportsIdempotency ? "retry-after-lease" : "reconciliation-required", now.toISOString());
      throw new RangeError(claimedJob.capabilities.supportsIdempotency ? "OMR_IDEMPOTENCY_PENDING" : "OMR_JOB_RECONCILIATION_REQUIRED");
    }
  }

  async uploadPage(handle: OmrJobHandle, page: OmrApplicationPageUpload): Promise<void> {
    const now = this.now();
    const job = await this.owned(handle);
    if (!Number.isSafeInteger(page.pageIndex) || page.pageIndex < 0 || page.pageIndex >= job.pageCount
      || !["created", "uploading"].includes(job.state)) throw new RangeError("OMR_PAGE_UPLOAD_NOT_ALLOWED");
    const declaredPage = job.canonicalCreateRequest.pages[page.pageIndex];
    if (!declaredPage || declaredPage.pageDigest !== page.pageDigest || declaredPage.mimeType !== page.mimeType) throw new RangeError("OMR_PAGE_UPLOAD_CONFLICT");
    const rawBytes = new Uint8Array(await page.bytes.arrayBuffer());
    const recomputedInputDigest = await binaryDigest(rawBytes);
    if (recomputedInputDigest !== page.pageDigest) throw new RangeError("OMR_PAGE_DIGEST_MISMATCH");
    const inspected = await this.dependencies.inspectPage({ bytes: rawBytes, mimeType: page.mimeType, pageIndex: page.pageIndex });
    if (inspected.mimeType !== job.capabilities.transferMimeType || !job.capabilities.supportedMimeTypes.includes(inspected.mimeType)) throw new RangeError("OMR_INPUT_FORMAT_UNSUPPORTED");
    if (inspected.quality.status === "retake") throw new RangeError("OMR_IMAGE_RETAKE_REQUIRED");
    if (inspected.quality.status === "warn" && page.warnAcknowledged !== true) throw new RangeError("OMR_IMAGE_WARNING_ACK_REQUIRED");
    const duplicate = job.pages.find((candidate) => candidate.pageIndex !== page.pageIndex && candidate.pageDigest === inspected.digest);
    if (duplicate && page.duplicateConfirmed !== true) throw new RangeError("OMR_DUPLICATE_PAGE_CONFIRMATION_REQUIRED");
    // Historical binding availability is a pre-dispatch prerequisite, not an
    // upload attempt. Resolve it before claiming a page so the retry counter
    // and upload lease remain untouched while the exact adapter is absent.
    const uploadAdapter = this.adapterFor(job);
    const uploadVendorJobId = this.vendorJobId(job);
    const idempotencyKeyHash = keyedTokenHash(page.idempotencyKey, this.dependencies.handleHmacKey, "omr-page-idempotency-v1");
    const pageRecord: OmrPageRecord = {
      pageIndex: page.pageIndex, pageDigest: inspected.digest, mimeType: inspected.mimeType,
      idempotencyKeyHash, width: inspected.width, height: inspected.height, quality: inspected.quality,
      warnAcknowledged: inspected.quality.status !== "warn" || page.warnAcknowledged === true,
      // Only an explicit caller acknowledgement may authorize a duplicate.
      // The store rechecks the digest under its job lock, so a stale service
      // snapshot can never manufacture acknowledgement during a race.
      duplicateConfirmed: page.duplicateConfirmed === true,
      uploadState: "pending", retryCount: 0,
    };
    const leaseToken = generateOpaqueToken(24);
    const claim = await this.dependencies.store.claimPage(
      job.id,
      pageRecord,
      this.dependencies.quota.maxRetriesPerPage,
      leaseToken,
      new Date(now.getTime() + OPERATION_LEASE_MS).toISOString(),
      job.capabilities.supportsIdempotency,
      now.toISOString(),
    );
    if (claim.status === "replay") return;
    if (claim.status !== "claimed") throw new RangeError(claim.status === "conflict" ? "OMR_PAGE_UPLOAD_CONFLICT" : claim.status === "pending" ? "OMR_PAGE_UPLOAD_PENDING" : claim.status === "reconciliation-required" ? "OMR_JOB_RECONCILIATION_REQUIRED" : claim.status === "duplicate-confirmation-required" ? "OMR_DUPLICATE_PAGE_CONFIRMATION_REQUIRED" : "OMR_PAGE_RETRY_EXHAUSTED");
    let objectReferenceId: PrivateRowId | undefined;
    let vendorEffectCompleted = false;
    let completionAuthorityUnknown = false;
    try {
      const object = await this.dependencies.objects.put({ ownerSessionId: job.ownerSessionId, publicationId: `omr-page:${job.id}:${page.pageIndex}:${leaseToken}`, bytes: inspected.bytes, contentType: inspected.mimeType, expiresAt: job.handleExpiresAt });
      objectReferenceId = object.id;
      await uploadAdapter.uploadPage(uploadVendorJobId, { pageIndex: page.pageIndex, pageDigest: inspected.digest, mimeType: inspected.mimeType, idempotencyKey: idempotencyKeyHash, bytes: new Blob([inspected.bytes.slice().buffer as ArrayBuffer], { type: inspected.mimeType }) });
      vendorEffectCompleted = true;
      let applied: boolean;
      try {
        applied = await this.dependencies.store.completePage(job.id, page.pageIndex, leaseToken, object.id, now.toISOString());
      } catch (completionError) {
        const inspection = await this.dependencies.store.inspectPageCompletion({
          jobId: job.id, pageIndex: page.pageIndex, leaseToken,
          pageDigest: inspected.digest, idempotencyKeyHash, objectReferenceId: object.id,
        }).catch(() => ({ status: "unknown" as const }));
        if (inspection.status === "committed-exact") {
          await this.recordAuditBestEffort(job.id, "page-uploaded", `${page.pageIndex}:commit-ack-recovered`, now.toISOString());
          return;
        }
        if (inspection.status === "superseded") {
          await this.dependencies.objects.delete(object.id, job.ownerSessionId, now).catch(() => undefined);
          objectReferenceId = undefined;
          await this.recordAuditBestEffort(job.id, "page-upload-superseded", `${page.pageIndex}:commit-ack`, now.toISOString());
          return;
        }
        if (inspection.status === "unknown") completionAuthorityUnknown = true;
        throw completionError;
      }
      if (!applied) {
        await this.dependencies.objects.delete(object.id, job.ownerSessionId, now);
        objectReferenceId = undefined;
        await this.recordAuditBestEffort(job.id, "page-upload-superseded", String(page.pageIndex), now.toISOString());
        return;
      }
      await this.recordAuditBestEffort(job.id, "page-uploaded", String(page.pageIndex), now.toISOString());
    } catch {
      if (completionAuthorityUnknown) {
        await this.recordAuditBestEffort(job.id, "page-upload-commit-inspection-pending", String(page.pageIndex), now.toISOString());
        throw new RangeError("OMR_PAGE_UPLOAD_PENDING");
      }
      if (objectReferenceId) await this.dependencies.objects.delete(objectReferenceId, job.ownerSessionId, now).catch(() => undefined);
      if (!vendorEffectCompleted) {
        const outcome = job.capabilities.supportsIdempotency ? "failed" : "reconciliation-required";
        await this.dependencies.store.failPage(job.id, page.pageIndex, leaseToken, outcome, now.toISOString());
        await this.recordAuditBestEffort(job.id, "page-upload-failed", `${page.pageIndex}:${outcome}`, now.toISOString());
        throw new RangeError(outcome === "reconciliation-required" ? "OMR_JOB_RECONCILIATION_REQUIRED" : "OMR_PAGE_UPLOAD_FAILED");
      }
      if (!job.capabilities.supportsIdempotency) {
        await this.dependencies.store.failPage(job.id, page.pageIndex, leaseToken, "reconciliation-required", now.toISOString());
      }
      await this.recordAuditBestEffort(job.id, "page-upload-persist-pending", String(page.pageIndex), now.toISOString());
      throw new RangeError(job.capabilities.supportsIdempotency ? "OMR_PAGE_UPLOAD_PENDING" : "OMR_JOB_RECONCILIATION_REQUIRED");
    }
  }

  async start(handle: OmrJobHandle): Promise<void> {
    const now = this.now();
    const job = await this.owned(handle);
    if (job.state === "queued" || job.state === "processing" || job.state === "needs-input" || job.state === "completed") return;
    if (!job.vendorJobIdEnvelope || !["created", "uploading"].includes(job.state)
      || job.pages.length !== job.pageCount
      || job.pages.some((page) => page.uploadState !== "uploaded" || page.quality.status === "retake" || (page.quality.status === "warn" && !page.warnAcknowledged))
      || job.pages.some((page, index) => page.pageIndex !== index)) throw new RangeError("OMR_PAGES_INCOMPLETE");
    const leaseToken = generateOpaqueToken(24);
    const operationRequestDigest = await semanticDigest({ projectionSchema: "hm-omr-operation-request-v1", jobId: job.id, kind: "start" });
    const claim = await this.dependencies.store.claimOperation({ jobId: job.id, kind: "start", operationRequestDigest, expectedStates: ["created", "uploading"], leaseToken, leaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS).toISOString(), supportsIdempotency: job.capabilities.supportsIdempotency, now: now.toISOString() });
    if (claim.status === "pending") throw new RangeError("OMR_OPERATION_PENDING");
    if (claim.status === "reconciliation-required") throw new RangeError("OMR_JOB_RECONCILIATION_REQUIRED");
    if (claim.status === "invalid" || claim.status === "request-conflict") throw new RangeError("OMR_PAGES_INCOMPLETE");
    const idempotencyKey = keyedTokenHash(`${job.id}:start`, this.dependencies.handleHmacKey, "omr-operation-v1");
    let vendorEffectCompleted = false;
    try {
      await this.adapterFor(job).startVendorJob(this.vendorJobId(job), { idempotencyKey });
      vendorEffectCompleted = true;
      const applied = await this.dependencies.store.completeOperation({ jobId: job.id, kind: "start", leaseToken, update: { state: "queued", startedAt: now.toISOString() }, now: now.toISOString() });
      await this.recordAuditBestEffort(job.id, "job-started", applied ? "queued" : "superseded", now.toISOString());
    } catch {
      if (!vendorEffectCompleted || !job.capabilities.supportsIdempotency) await this.dependencies.store.failOperation({ jobId: job.id, kind: "start", leaseToken, update: job.capabilities.supportsIdempotency ? { state: job.state } : { state: "reconciliation-required", reconciliationKind: "start" }, now: now.toISOString() });
      throw new RangeError(vendorEffectCompleted && job.capabilities.supportsIdempotency ? "OMR_OPERATION_PENDING" : job.capabilities.supportsIdempotency ? "OMR_VENDOR_OPERATION_FAILED" : "OMR_JOB_RECONCILIATION_REQUIRED");
    }
  }

  private validateEvidencePageBindings(job: DurableOmrJobRecord, evidence: Awaited<ReturnType<OmrVendorAdapter["getEvidence"]>>): void {
    const pages = new Map(job.pages.filter((page) => page.uploadState === "uploaded").map((page) => [page.pageIndex, page]));
    const frames = new Map(evidence.frames.map((frame) => [frame.id, frame]));
    const transforms = evidence.transforms;
    const reachesBoundOriginal = (frameId: string, visited = new Set<string>()): boolean => {
      const frame = frames.get(frameId); if (!frame || visited.has(frameId)) return false;
      if (frame.coordinateSpace !== "processed-pixels") return pages.get(frame.pageIndex)?.pageDigest === frame.imageDigest;
      const next = new Set(visited).add(frameId);
      return transforms.filter((transform) => transform.sourceFrameId === frameId).some((transform) => reachesBoundOriginal(transform.targetFrameId, next));
    };
    if (evidence.frames.some((frame) => frame.coordinateSpace !== "processed-pixels"
      ? pages.get(frame.pageIndex)?.pageDigest !== frame.imageDigest
      : !reachesBoundOriginal(frame.id))) throw new RangeError("OMR_RESULT_INTEGRITY_FAILED");
  }

  private async captureCompleted(job: DurableOmrJobRecord, now: Date, statusObservationLeaseToken?: string): Promise<void> {
    const leaseToken = generateOpaqueToken(24);
    const claim = await this.dependencies.store.claimResultCapture({
      jobId: job.id,
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS).toISOString(),
      ...(statusObservationLeaseToken ? { statusObservationLeaseToken } : {}),
      now: now.toISOString(),
    });
    if (claim.status === "pending" || claim.status === "replay") return;
    if (claim.status !== "claimed") throw new RangeError("OMR_RESULT_UNAVAILABLE");
    const claimedJob = claim.job;
    let resultObjectId: PrivateRowId | undefined;
    let failureOrigin: OmrProviderFailureOrigin = "provider";
    try {
      const vendorJobId = this.vendorJobId(claimedJob);
      const adapter = this.adapterFor(claimedJob);
      const rawMusicXml = await adapter.exportMusicXml(vendorJobId);
      const rawBytes = new TextEncoder().encode(rawMusicXml);
      if (rawBytes.byteLength > PROVIDER_CAPTURE_LIMITS.musicXmlBytes) throw new RangeError("OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED");
      const vendorResultDigest = await binaryDigest(rawBytes);
      const evidence = await adapter.getEvidence(vendorJobId);
      const normalizationMapping = await adapter.getNormalizationMapping(vendorJobId);
      try {
        validateEvidenceCaptureLimits(evidence);
        validateNormalizationMappingCaptureLimits(normalizationMapping);
        await validateVendorNormalizationMappingArtifact(normalizationMapping);
        const recomputed = await computeProviderBundleDigest(evidence);
        if (recomputed !== evidence.providerBundleDigest
          || normalizationMapping.vendorResultDigest !== vendorResultDigest
          || normalizationMapping.providerBundleDigest !== evidence.providerBundleDigest) {
          throw new RangeError("OMR_RESULT_INTEGRITY_FAILED");
        }
        if (GRANULARITY_RANK[evidence.granularity] < GRANULARITY_RANK[job.capabilities.evidenceGranularity]
          || evidence.evidence.length === 0) throw new RangeError("OMR_PROVIDER_CAPABILITY_MISSING");
        this.validateEvidencePageBindings(claimedJob, evidence);
      } catch (error) {
        throw asOmrProviderContractError(error);
      }
      const retentionInfo = await adapter.getRetentionInfo(vendorJobId);
      try { assertBoundedProviderValue(retentionInfo); }
      catch (error) { throw asOmrProviderContractError(error); }
      failureOrigin = "local";
      const resultObject = await this.dependencies.objects.put({ ownerSessionId: job.ownerSessionId, publicationId: `omr-result:${job.id}:${leaseToken}`, bytes: rawBytes, contentType: "application/vnd.recordare.musicxml+xml", expiresAt: job.handleExpiresAt });
      resultObjectId = resultObject.id;
      const completionInput = { jobId: job.id, leaseToken, update: { state: "completed" as const, creditState: "settled" as const, progressBp: 10_000, resultObjectReferenceId: resultObject.id, vendorResultDigest, evidence, normalizationMapping, retentionInfo, completedAt: now.toISOString(), currentInputRequest: undefined, ...this.clearRetry() }, now: now.toISOString() };
      let applied: boolean;
      try {
        applied = await this.dependencies.store.completeResultCapture(completionInput);
      } catch (completionError) {
        const inspection = await this.dependencies.store.inspectResultCompletion({
          jobId: job.id, leaseToken, objectReferenceId: resultObject.id, vendorResultDigest,
          providerBundleDigest: evidence.providerBundleDigest,
          normalizationMappingArtifactDigest: normalizationMapping.artifactDigest,
        }).catch(() => ({ status: "unknown" as const }));
        if (inspection.status === "committed-exact") {
          await this.recordAuditBestEffort(job.id, "job-completed", "commit-ack-recovered", now.toISOString());
          return;
        }
        if (inspection.status === "superseded") {
          await this.dependencies.objects.delete(resultObject.id, job.ownerSessionId, now).catch(() => undefined);
          resultObjectId = undefined;
          await this.recordAuditBestEffort(job.id, "job-complete-superseded", "commit-ack-newer-state-preserved", now.toISOString());
          return;
        }
        if (inspection.status === "unknown") {
          await this.recordAuditBestEffort(job.id, "job-complete-commit-inspection-pending", "object-preserved", now.toISOString());
          return;
        }
        throw completionError;
      }
      if (!applied) {
        await this.dependencies.objects.delete(resultObject.id, job.ownerSessionId, now).catch(() => undefined);
        await this.recordAuditBestEffort(job.id, "job-complete-superseded", "newer-state-preserved", now.toISOString());
        return;
      }
      await this.recordAuditBestEffort(job.id, "job-completed", "result-and-evidence-durable", now.toISOString());
    } catch (error) {
      if (resultObjectId) await this.dependencies.objects.delete(resultObjectId, job.ownerSessionId, now).catch(() => undefined);
      const failure = classifyOmrProviderFailure(error, failureOrigin);
      let update: Partial<DurableOmrJobRecord>;
      let eventKind: string;
      if (failure.failureClass === "binding-unavailable") {
        update = { state: "reconciliation-required", reconciliationKind: "capture", publicFailureCode: failure.code, publicFailureMessageKo: "생성 시점 제공자 binding을 사용할 수 없습니다." };
        eventKind = "job-reconciliation-required";
      } else if (failure.failureClass === "contract-integrity" || failure.failureClass === "vendor-terminal") {
        update = {
          state: "failed", creditState: "released", ...this.clearRetry(), publicFailureCode: failure.code,
          publicFailureMessageKo: failure.code === "OMR_RESULT_INTEGRITY_FAILED"
            ? "인식 결과가 업로드한 페이지 또는 결과 digest와 일치하지 않습니다."
            : "인식 결과가 제공자 계약 또는 안전 한도와 일치하지 않습니다.",
        };
        eventKind = "job-failed";
      } else {
        update = this.retryUpdate(claimedJob, "capture", failure.code, now);
        eventKind = "job-capture-retry";
      }
      const applied = await this.dependencies.store.failResultCapture({
        jobId: job.id,
        leaseToken,
        expectedStates: RESULT_CAPTURE_STATES,
        update,
        now: now.toISOString(),
      });
      await this.recordAuditBestEffort(job.id, applied ? eventKind : "job-capture-failure-superseded", `${failure.failureClass}:${failure.code}`, now.toISOString());
    }
  }

  async getStatus(handle: OmrJobHandle): Promise<OmrPublicStatus> {
    return publicStatusFromRecord(await this.owned(handle));
  }

  async synchronizeStatus(handle: OmrJobHandle): Promise<OmrPublicStatus> {
    const now = this.now();
    let job = await this.owned(handle);
    if (!["queued", "processing", "needs-input", "sync-retry-pending", "capture-retry-pending"].includes(job.state)) return publicStatusFromRecord(job);
    if (job.retryNextAttemptAt && job.retryNextAttemptAt > now.toISOString()) return publicStatusFromRecord(job);
    if (job.state === "capture-retry-pending") {
      await this.captureCompleted(job, now);
      return publicStatusFromRecord(await this.owned(handle));
    }
    const observationLeaseToken = generateOpaqueToken(24);
    const observation = await this.dependencies.store.claimStatusObservation({
      jobId: job.id,
      leaseToken: observationLeaseToken,
      leaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS).toISOString(),
      now: now.toISOString(),
    });
    if (observation.status !== "claimed") return publicStatusFromRecord(await this.owned(handle));
    job = observation.job;
    let status;
    try { status = await this.adapterFor(job).getVendorStatus(this.vendorJobId(job)); }
    catch (error) {
      const failure = classifyOmrProviderFailure(error, "provider");
      const update = failure.failureClass === "binding-unavailable"
        ? { state: "reconciliation-required" as const, reconciliationKind: "sync" as const, publicFailureCode: failure.code, publicFailureMessageKo: "생성 시점 제공자 binding을 사용할 수 없습니다." }
        : failure.failureClass === "contract-integrity" || failure.failureClass === "vendor-terminal"
          ? { state: "failed" as const, creditState: "released" as const, ...this.clearRetry(), publicFailureCode: failure.code, publicFailureMessageKo: "제공자 상태 응답이 제공자 계약과 일치하지 않습니다." }
          : this.retryUpdate(job, "sync", "OMR_VENDOR_STATUS_TRANSIENT", now);
      const applied = await this.dependencies.store.completeStatusObservation({ jobId: job.id, leaseToken: observationLeaseToken, expectedStates: STATUS_OBSERVATION_STATES, update, now: now.toISOString() });
      await this.recordAuditBestEffort(job.id, applied ? (update.state === "reconciliation-required" ? "job-reconciliation-required" : update.state === "failed" ? "job-failed" : "job-sync-retry") : "job-status-superseded", `${failure.failureClass}:${failure.code}`, now.toISOString());
      return publicStatusFromRecord(await this.owned(handle));
    }
    if (status.kind === "unknown") {
      await this.dependencies.store.completeStatusObservation({ jobId: job.id, leaseToken: observationLeaseToken, expectedStates: STATUS_OBSERVATION_STATES, update: { state: "failed", creditState: "released", ...this.clearRetry(), publicFailureCode: "OMR_VENDOR_STATUS_UNKNOWN", publicFailureMessageKo: "인식 작업 상태를 확인할 수 없습니다." }, now: now.toISOString() });
      await this.recordAuditBestEffort(job.id, "job-failed", "unknown-vendor-status", now.toISOString());
    } else if (status.kind === "failed") {
      const failure = sanitizeVendorFailure();
      await this.dependencies.store.completeStatusObservation({ jobId: job.id, leaseToken: observationLeaseToken, expectedStates: STATUS_OBSERVATION_STATES, update: { state: "failed", creditState: "released", ...this.clearRetry(), publicFailureCode: failure.code, publicFailureMessageKo: failure.messageKo }, now: now.toISOString() });
      await this.recordAuditBestEffort(job.id, "job-failed", failure.code, now.toISOString());
    } else if (status.kind === "cancelled") {
      await this.dependencies.store.completeStatusObservation({ jobId: job.id, leaseToken: observationLeaseToken, expectedStates: STATUS_OBSERVATION_STATES, update: { state: "cancelled", creditState: "released", ...this.clearRetry() }, now: now.toISOString() });
      await this.recordAuditBestEffort(job.id, "job-cancelled", "vendor-status", now.toISOString());
    } else if (status.kind === "processing") {
      if (status.progressBp !== undefined && (!Number.isSafeInteger(status.progressBp) || status.progressBp < 0 || status.progressBp > 10_000)) {
        await this.dependencies.store.completeStatusObservation({ jobId: job.id, leaseToken: observationLeaseToken, expectedStates: STATUS_OBSERVATION_STATES, update: { state: "failed", creditState: "released", ...this.clearRetry(), publicFailureCode: "OMR_VENDOR_STATUS_UNKNOWN", publicFailureMessageKo: "인식 작업 상태를 확인할 수 없습니다." }, now: now.toISOString() });
        await this.recordAuditBestEffort(job.id, "job-failed", "invalid-vendor-progress", now.toISOString());
      } else await this.dependencies.store.completeStatusObservation({ jobId: job.id, leaseToken: observationLeaseToken, expectedStates: STATUS_OBSERVATION_STATES, update: { state: "processing", ...(status.progressBp === undefined ? {} : { progressBp: status.progressBp }), ...this.clearRetry() }, now: now.toISOString() });
    } else if (status.kind === "needs-input") {
      try {
        const request = validateVendorInputRequest(status.request, job.pageCount);
        await this.dependencies.store.completeStatusObservation({ jobId: job.id, leaseToken: observationLeaseToken, expectedStates: STATUS_OBSERVATION_STATES, update: { state: "needs-input", currentInputRequest: request, ...(job.currentInputRequest?.requestId === request.requestId ? {} : { acceptedInput: undefined, acceptedInputDigest: undefined }), ...this.clearRetry() }, now: now.toISOString() });
        await this.recordAuditBestEffort(job.id, "needs-input", request.kind, now.toISOString());
      } catch {
        await this.dependencies.store.completeStatusObservation({
          jobId: job.id,
          leaseToken: observationLeaseToken,
          expectedStates: STATUS_OBSERVATION_STATES,
          update: {
            state: "failed", creditState: "released", ...this.clearRetry(),
            publicFailureCode: "OMR_PROVIDER_CONTRACT_INVALID",
            publicFailureMessageKo: "제공자 추가 입력 요청이 계약 또는 안전 한도와 일치하지 않습니다.",
          },
          now: now.toISOString(),
        });
        await this.recordAuditBestEffort(job.id, "job-failed", "invalid-needs-input-request", now.toISOString());
      }
    } else if (status.kind === "completed") {
      await this.captureCompleted(job, now, observationLeaseToken);
    } else if (status.kind === "created") {
      const state = job.state === "processing" || job.state === "needs-input" ? job.state : "queued";
      await this.dependencies.store.completeStatusObservation({ jobId: job.id, leaseToken: observationLeaseToken, expectedStates: STATUS_OBSERVATION_STATES, update: { state, ...this.clearRetry() }, now: now.toISOString() });
      await this.recordAuditBestEffort(job.id, "job-status", "provider-created", now.toISOString());
    } else if (status.kind === "queued") {
      const state = job.state === "processing" || job.state === "needs-input" ? job.state : "queued";
      await this.dependencies.store.completeStatusObservation({ jobId: job.id, leaseToken: observationLeaseToken, expectedStates: STATUS_OBSERVATION_STATES, update: { state, ...this.clearRetry() }, now: now.toISOString() });
    }
    job = await this.owned(handle);
    return publicStatusFromRecord(job);
  }

  async submitInput(handle: OmrJobHandle, input: VendorInputResponse): Promise<void> {
    const now = this.now();
    const job = await this.owned(handle);
    const inputDigest = await semanticDigest({ projectionSchema: "hm-omr-vendor-input-v1", input });
    if (job.acceptedInput) {
      const acceptedDigest = job.acceptedInputDigest
        ?? await semanticDigest({ projectionSchema: "hm-omr-vendor-input-v1", input: job.acceptedInput });
      if (acceptedDigest === inputDigest) return;
      throw new RangeError("OMR_VENDOR_INPUT_CONFLICT");
    }
    if (job.state !== "needs-input" || !job.currentInputRequest || !inputResponseValid(job.currentInputRequest, input)) throw new RangeError("OMR_VENDOR_INPUT_INVALID");
    const adapter = this.adapterFor(job);
    if (!job.capabilities.supportsInteractiveInput || !adapter.submitVendorInput) throw new RangeError("OMR_PROVIDER_CAPABILITY_MISSING");
    const leaseToken = generateOpaqueToken(24);
    const claim = await this.dependencies.store.claimOperation({ jobId: job.id, kind: "submit-input", operationRequestDigest: inputDigest, expectedStates: ["needs-input"], leaseToken, leaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS).toISOString(), supportsIdempotency: job.capabilities.supportsIdempotency, now: now.toISOString() });
    if (claim.status === "pending") throw new RangeError("OMR_OPERATION_PENDING");
    if (claim.status === "reconciliation-required") throw new RangeError("OMR_JOB_RECONCILIATION_REQUIRED");
    if (claim.status === "request-conflict") throw new RangeError("OMR_VENDOR_INPUT_CONFLICT");
    if (claim.status === "invalid") throw new RangeError("OMR_VENDOR_INPUT_INVALID");
    const idempotencyKey = keyedTokenHash(`${job.id}:${inputDigest}`, this.dependencies.handleHmacKey, "omr-operation-v1");
    let vendorEffectCompleted = false;
    try {
      await adapter.submitVendorInput(this.vendorJobId(job), input, { idempotencyKey });
      vendorEffectCompleted = true;
      const applied = await this.dependencies.store.completeOperation({ jobId: job.id, kind: "submit-input", leaseToken, update: { state: "processing", acceptedInput: structuredClone(input), acceptedInputDigest: inputDigest, currentInputRequest: undefined }, now: now.toISOString() });
      await this.recordAuditBestEffort(job.id, "input-accepted", applied ? input.kind : "superseded", now.toISOString());
    } catch {
      if (!vendorEffectCompleted || !job.capabilities.supportsIdempotency) await this.dependencies.store.failOperation({ jobId: job.id, kind: "submit-input", leaseToken, update: job.capabilities.supportsIdempotency ? { state: "needs-input" } : { state: "reconciliation-required", reconciliationKind: "submit-input" }, now: now.toISOString() });
      throw new RangeError(vendorEffectCompleted && job.capabilities.supportsIdempotency ? "OMR_OPERATION_PENDING" : job.capabilities.supportsIdempotency ? "OMR_VENDOR_OPERATION_FAILED" : "OMR_JOB_RECONCILIATION_REQUIRED");
    }
  }

  async exportResult(handle: OmrJobHandle): Promise<OmrProviderResult> {
    const job = await this.owned(handle);
    if (job.state !== "completed" || !job.resultObjectReferenceId || !job.vendorResultDigest || !job.evidence || !job.normalizationMapping || !job.retentionInfo) throw new RangeError("OMR_RESULT_UNAVAILABLE");
    const result = await this.dependencies.objects.get(job.resultObjectReferenceId, job.ownerSessionId);
    if (result.binaryDigest !== job.vendorResultDigest) throw new RangeError("OMR_RESULT_INTEGRITY_FAILED");
    return { vendorId: job.capabilities.vendorId, vendorResultDigest: job.vendorResultDigest, rawMusicXml: new TextDecoder("utf-8", { fatal: true }).decode(result.bytes), evidence: structuredClone(job.evidence), normalizationMapping: structuredClone(job.normalizationMapping), retentionInfo: structuredClone(job.retentionInfo) };
  }

  async getPageImage(handle: OmrJobHandle, pageIndex: number): Promise<OwnedObjectRead> {
    const job = await this.owned(handle);
    const page = job.pages.find((candidate) => candidate.pageIndex === pageIndex && candidate.uploadState === "uploaded");
    if (!page?.objectReferenceId) throw new RangeError("OMR_PAGE_UNAVAILABLE");
    return this.dependencies.objects.get(page.objectReferenceId, job.ownerSessionId);
  }

  async cancel(handle: OmrJobHandle): Promise<void> {
    const now = this.now(); const job = await this.owned(handle);
    if (job.state === "cancelled") return;
    if (TERMINAL_STATES.has(job.state)) throw new RangeError("OMR_CANCEL_NOT_ALLOWED");
    const leaseToken = generateOpaqueToken(24);
    const operationRequestDigest = await semanticDigest({ projectionSchema: "hm-omr-operation-request-v1", jobId: job.id, kind: "cancel" });
    const claim = await this.dependencies.store.claimOperation({ jobId: job.id, kind: "cancel", operationRequestDigest, expectedStates: ["created", "uploading", "queued", "processing", "needs-input", "sync-retry-pending", "capture-retry-pending", "cancel-failed"], leaseToken, leaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS).toISOString(), supportsIdempotency: job.capabilities.supportsIdempotency, now: now.toISOString() });
    if (claim.status === "pending") throw new RangeError("OMR_CANCEL_PENDING");
    if (claim.status === "reconciliation-required") throw new RangeError("OMR_JOB_RECONCILIATION_REQUIRED");
    if (claim.status === "invalid" || claim.status === "request-conflict") throw new RangeError("OMR_CANCEL_NOT_ALLOWED");
    const idempotencyKey = keyedTokenHash(`${job.id}:cancel`, this.dependencies.handleHmacKey, "omr-operation-v1");
    let vendorEffectCompleted = !job.vendorJobIdEnvelope;
    try {
      if (job.vendorJobIdEnvelope) {
        await this.adapterFor(job).cancelVendorJob(this.vendorJobId(job), { idempotencyKey });
        vendorEffectCompleted = true;
      }
      const applied = await this.dependencies.store.completeOperation({ jobId: job.id, kind: "cancel", leaseToken, update: { state: "cancelled", creditState: "released", publicFailureCode: undefined, publicFailureMessageKo: undefined }, now: now.toISOString() });
      await this.recordAuditBestEffort(job.id, "job-cancelled", applied ? "application-request" : "superseded", now.toISOString());
    } catch {
      if (!vendorEffectCompleted || !job.capabilities.supportsIdempotency) {
        const update = job.capabilities.supportsIdempotency
          ? { state: "cancel-failed" as const, publicFailureCode: "OMR_VENDOR_CANCEL_FAILED", publicFailureMessageKo: "제공자 취소 요청이 완료되지 않았습니다." }
          : { state: "reconciliation-required" as const, reconciliationKind: "cancel" as const, publicFailureCode: "OMR_JOB_RECONCILIATION_REQUIRED", publicFailureMessageKo: "제공자 취소 상태를 확인해야 합니다." };
        await this.dependencies.store.failOperation({ jobId: job.id, kind: "cancel", leaseToken, update, now: now.toISOString() });
      }
      throw new RangeError(!job.capabilities.supportsIdempotency ? "OMR_JOB_RECONCILIATION_REQUIRED" : vendorEffectCompleted ? "OMR_CANCEL_PENDING" : "OMR_VENDOR_CANCEL_FAILED");
    }
  }

  private providerDeleteAdapter(operation: DurableOmrProviderDeleteOperation): ExistingJobAdapterResolution {
    const resolved = this.dependencies.resolveAdapter?.(
      operation.providerBindingId,
      operation.adapterContractVersion,
      operation.vendorId,
    );
    if (resolved) return { status: "available", adapter: resolved };
    const currentBindingId = this.dependencies.providerBindingId ?? operation.vendorId;
    const currentContractVersion = this.dependencies.adapterContractVersion ?? OMR_VENDOR_ADAPTER_CONTRACT_VERSION;
    return operation.providerBindingId === currentBindingId
      && operation.adapterContractVersion === currentContractVersion
      ? { status: "available", adapter: this.dependencies.adapter }
      : { status: "binding-unavailable", code: "OMR_PROVIDER_BINDING_UNAVAILABLE" };
  }

  private providerDeleteVendorJobId(operation: DurableOmrProviderDeleteOperation): VendorJobId {
    const bytes = decryptAeadV1(operation.vendorJobIdEnvelope, this.dependencies.vendorJobEncryptionKey);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes) as VendorJobId;
  }

  private providerDeleteSummary(operation: DurableOmrProviderDeleteOperation, now: Date): {
    readonly vendor: VendorDeleteResult;
    readonly state: DurableOmrJobRecord["vendorDeleteState"];
    readonly nextAttemptAt?: string;
  } {
    if (operation.dispatchOutcome === "acknowledged-deleted") {
      return { vendor: { status: "deleted" }, state: "deleted" };
    }
    if (operation.dispatchOutcome === "acknowledged-not-supported"
      && operation.result?.status === "not-supported") {
      const expiresAt = operation.result.retentionInfo.vendorDeletesAt;
      if (expiresAt && expiresAt <= now.toISOString()) {
        return { vendor: { status: "deleted" }, state: "deleted" };
      }
      return {
        vendor: structuredClone(operation.result),
        state: "not-supported",
        nextAttemptAt: expiresAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
      };
    }
    const reconciliation = operation.reconciliationRequired
      || (operation.dispatchOutcome === "outcome-uncertain" && !operation.supportsIdempotency);
    const activelyClaimed = Boolean(operation.claimToken)
      && (operation.claimLeaseExpiresAt ?? "") > now.toISOString();
    return {
      vendor: operation.result?.status === "failed"
        ? structuredClone(operation.result)
        : {
          status: "failed",
          code: reconciliation ? "OMR_VENDOR_DELETE_OUTCOME_UNCERTAIN" : "OMR_VENDOR_DELETE_PENDING",
          message: reconciliation
            ? "Vendor 삭제 결과가 불확실하며 안전한 자동 재호출 권한이 없습니다."
            : "Vendor 삭제 확인을 기다리고 있습니다.",
        },
      state: activelyClaimed ? "pending" : "failed",
      nextAttemptAt: operation.nextAttemptAt ?? operation.claimLeaseExpiresAt,
    };
  }

  private async executeProviderDelete(job: DurableOmrJobRecord, now: Date): Promise<{
    readonly vendor: VendorDeleteResult;
    readonly state: DurableOmrJobRecord["vendorDeleteState"];
    readonly nextAttemptAt?: string;
    readonly retentionInfo?: import("../../domain/omr/contracts").RetentionInfo;
  }> {
    if (!job.vendorJobIdEnvelope) {
      return {
        vendor: { status: "failed", code: "OMR_VENDOR_JOB_ID_UNAVAILABLE", message: "확정된 Vendor 작업 식별자를 사용할 수 없어 외부 삭제를 확인할 수 없습니다." },
        state: "failed",
        nextAttemptAt: new Date(now.getTime() + DELETE_RETRY_MS).toISOString(),
      };
    }
    const operationGeneration = 1;
    const operationId = `omr-provider-delete:${keyedTokenHash(`${job.id}:${operationGeneration}:${job.providerBindingId}:${job.adapterContractVersion}`, this.dependencies.handleHmacKey, "omr-provider-delete-operation-v1")}`;
    const idempotencyKey = keyedTokenHash(`${job.id}:${operationGeneration}`, this.dependencies.handleHmacKey, "omr-provider-delete-idempotency-v1");
    const claimToken = generateOpaqueToken(24);
    const claim = await this.dependencies.store.claimProviderDelete({
      jobId: job.id,
      operationId,
      operationGeneration,
      providerBindingId: job.providerBindingId,
      adapterContractVersion: job.adapterContractVersion,
      vendorId: job.capabilities.vendorId,
      vendorJobIdEnvelope: job.vendorJobIdEnvelope,
      idempotencyKey,
      supportsDeletion: job.capabilities.supportsDeletion,
      supportsIdempotency: job.capabilities.supportsIdempotency,
      claimToken,
      claimLeaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS).toISOString(),
      now: now.toISOString(),
    });
    if (claim.status !== "claimed") return this.providerDeleteSummary(claim.operation, now);
    const operation = claim.operation;
    const resolution = this.providerDeleteAdapter(operation);
    if (resolution.status === "binding-unavailable") {
      const result = { status: "failed", code: resolution.code, message: BINDING_UNAVAILABLE_DELETE_MESSAGE_KO } as const;
      const completedAt = this.now();
      await this.dependencies.store.completeProviderDelete({
        jobId: job.id, operationId, operationGeneration, claimToken,
        dispatchOutcome: operation.dispatchOutcome,
        result,
        nextAttemptAt: new Date(now.getTime() + DELETE_RETRY_MS).toISOString(),
        reconciliationRequired: operation.reconciliationRequired,
        now: completedAt.toISOString(),
      });
      const persisted = await this.dependencies.store.getProviderDeleteOperation(job.id);
      return this.providerDeleteSummary(persisted ?? { ...operation, result, claimToken: undefined, claimLeaseExpiresAt: undefined }, now);
    }
    const vendorJobId = this.providerDeleteVendorJobId(operation);
    let observedRetentionInfo = job.retentionInfo;
    if (!operation.supportsDeletion) {
      let retentionInfo = job.retentionInfo;
      try { retentionInfo = await resolution.adapter.getRetentionInfo(vendorJobId); } catch { /* retry the safe read later */ }
      const result: VendorDeleteResult = retentionInfo
        ? { status: "not-supported", retentionInfo }
        : { status: "failed", code: "OMR_VENDOR_RETENTION_UNAVAILABLE", message: "Vendor 보존 정보를 확인하지 못했습니다." };
      const dispatchOutcome = result.status === "not-supported" ? "acknowledged-not-supported" : "not-dispatched";
      const nextAttemptAt = result.status === "not-supported"
        ? undefined
        : new Date(now.getTime() + DELETE_RETRY_MS).toISOString();
      const completedAt = this.now();
      await this.dependencies.store.completeProviderDelete({
        jobId: job.id, operationId, operationGeneration, claimToken, dispatchOutcome, result,
        ...(nextAttemptAt ? { nextAttemptAt } : {}), reconciliationRequired: false, now: completedAt.toISOString(),
      });
      const persisted = await this.dependencies.store.getProviderDeleteOperation(job.id);
      return { ...this.providerDeleteSummary(persisted ?? { ...operation, dispatchOutcome, result, claimToken: undefined, claimLeaseExpiresAt: undefined }, now), ...(retentionInfo ? { retentionInfo } : {}) };
    }
    const begun = await this.dependencies.store.beginProviderDeleteDispatch({
      jobId: job.id, operationId, operationGeneration, claimToken, now: now.toISOString(),
    });
    if (!begun) {
      const persisted = await this.dependencies.store.getProviderDeleteOperation(job.id);
      return persisted ? this.providerDeleteSummary(persisted, now) : {
        vendor: { status: "failed", code: "OMR_VENDOR_DELETE_PENDING", message: "Vendor 삭제 확인을 기다리고 있습니다." },
        state: "pending",
      };
    }
    try {
      const raw = await resolution.adapter.deleteVendorJob(vendorJobId, { idempotencyKey: operation.idempotencyKey });
      const result: VendorDeleteResult = raw.status === "failed"
        ? { status: "failed", code: "OMR_VENDOR_DELETE_FAILED", message: "Vendor 삭제 확인이 완료되지 않았습니다." }
        : raw;
      if (raw.status === "not-supported") observedRetentionInfo = raw.retentionInfo;
      else if (raw.status === "failed") observedRetentionInfo = await resolution.adapter.getRetentionInfo(vendorJobId).catch(() => observedRetentionInfo);
      const dispatchOutcome = result.status === "deleted"
        ? "acknowledged-deleted"
        : result.status === "not-supported"
          ? "acknowledged-not-supported"
          : "acknowledged-failed";
      const nextAttemptAt = result.status === "failed" ? new Date(now.getTime() + DELETE_RETRY_MS).toISOString() : undefined;
      const completedAt = this.now();
      await this.dependencies.store.completeProviderDelete({
        jobId: job.id, operationId, operationGeneration, claimToken, dispatchOutcome, result,
        ...(nextAttemptAt ? { nextAttemptAt } : {}), reconciliationRequired: false, now: completedAt.toISOString(),
      });
    } catch (error) {
      observedRetentionInfo = await resolution.adapter.getRetentionInfo(vendorJobId).catch(() => observedRetentionInfo);
      const uncertain = vendorCallOutcome(error) === "outcome-uncertain";
      const reconciliationRequired = uncertain && !operation.supportsIdempotency;
      const result = {
        status: "failed",
        code: reconciliationRequired ? "OMR_VENDOR_DELETE_OUTCOME_UNCERTAIN" : "OMR_VENDOR_DELETE_FAILED",
        message: reconciliationRequired
          ? "Vendor 삭제 결과가 불확실하며 안전한 자동 재호출 권한이 없습니다."
          : "Vendor 삭제 확인이 완료되지 않았습니다.",
      } as const;
      const completedAt = this.now();
      await this.dependencies.store.completeProviderDelete({
        jobId: job.id, operationId, operationGeneration, claimToken,
        dispatchOutcome: uncertain ? "outcome-uncertain" : "acknowledged-failed",
        result,
        nextAttemptAt: new Date(now.getTime() + (reconciliationRequired ? RETRY_BACKOFF_MS.at(-1)! : DELETE_RETRY_MS)).toISOString(),
        reconciliationRequired,
        now: completedAt.toISOString(),
      });
    }
    const persisted = await this.dependencies.store.getProviderDeleteOperation(job.id);
    const summary: {
      readonly vendor: VendorDeleteResult;
      readonly state: DurableOmrJobRecord["vendorDeleteState"];
      readonly nextAttemptAt?: string;
    } = persisted ? this.providerDeleteSummary(persisted, now) : {
      vendor: { status: "failed", code: "OMR_VENDOR_DELETE_PENDING", message: "Vendor 삭제 확인을 기다리고 있습니다." },
      state: "pending",
    };
    return { ...summary, ...(summary.vendor.status === "not-supported"
      ? { retentionInfo: summary.vendor.retentionInfo }
      : observedRetentionInfo ? { retentionInfo: observedRetentionInfo } : {}) };
  }

  private async deleteRecord(job: DurableOmrJobRecord, now: Date, cleanupLeaseToken?: string): Promise<OmrDeleteResult> {
    if (job.state === "deleted" && job.vendorDeleteResult) {
      return { localHandleDeleted: true, vendor: structuredClone(job.vendorDeleteResult), cleanupState: "resolved" };
    }
    await this.dependencies.store.markHandleDeleted(job.id, now.toISOString());
    job = await this.dependencies.store.findOwnedByHandleHash(job.publicHandleHash, job.ownerSessionId, true) ?? job;
    let vendor: VendorDeleteResult = job.vendorDeleteResult ?? { status: "failed", code: "OMR_VENDOR_DELETE_PENDING", message: "Vendor 삭제 확인을 기다리고 있습니다." };
    let retentionInfo = job.retentionInfo;
    let vendorDeleteState = job.vendorDeleteState;
    let vendorDeleteNextAttemptAt = job.vendorDeleteNextAttemptAt;
    let vendorCreateOutcomeState = job.vendorCreateOutcomeState;
    const vendorDue = !vendorDeleteNextAttemptAt || vendorDeleteNextAttemptAt <= now.toISOString();
    if (vendorDeleteState !== "deleted" && vendorDue) {
      const failVendorResolution = (code: string, message: string) => {
        vendor = { status: "failed", code, message };
        vendorDeleteState = "failed";
        vendorDeleteNextAttemptAt = new Date(now.getTime() + DELETE_RETRY_MS).toISOString();
      };
      if (vendorCreateOutcomeState === "outcome-uncertain") {
        if (!job.capabilities.supportsIdempotency) {
          failVendorResolution(CREATE_OUTCOME_UNCERTAIN_CODE, CREATE_OUTCOME_UNCERTAIN_MESSAGE_KO);
        } else {
          const resolution = this.resolveExistingJobAdapter(job);
          if (resolution.status === "binding-unavailable") {
            failVendorResolution(resolution.code, "Vendor 생성 결과가 불확실하고 생성 시점 제공자 binding을 사용할 수 없어 외부 삭제를 확인할 수 없습니다.");
          } else {
            try {
              const vendorJobId = await resolution.adapter.createVendorJob({
                pageCount: job.canonicalCreateRequest.pageCount,
                idempotencyKey: job.vendorCreateIdempotencyKey,
              });
              const envelope = encryptAeadV1(new TextEncoder().encode(vendorJobId), this.dependencies.vendorJobEncryptionKey, { associatedDataVersion: "omr-vendor-job-id-v1" });
              try {
                await this.dependencies.store.completeVendorCreation({
                  jobId: job.id, vendorJobIdEnvelope: envelope, expectedState: "delete-pending",
                  completionMode: "cleanup-reconciliation",
                  ...(cleanupLeaseToken ? { cleanupLeaseToken } : { expectedVendorCreateLeaseExpiresAt: job.vendorCreateLeaseExpiresAt }),
                  now: now.toISOString(),
                });
                job = await this.dependencies.store.findOwnedByHandleHash(job.publicHandleHash, job.ownerSessionId, true) ?? job;
                vendorCreateOutcomeState = job.vendorCreateOutcomeState;
              } catch {
                const persisted = await this.dependencies.store.findOwnedByHandleHash(job.publicHandleHash, job.ownerSessionId, true).catch(() => undefined);
                if (persisted?.vendorCreateOutcomeState === "confirmed" && persisted.vendorJobIdEnvelope) {
                  job = persisted;
                  vendorCreateOutcomeState = "confirmed";
                } else failVendorResolution(CREATE_RECONCILIATION_PERSIST_CODE, "복구한 Vendor 작업 식별자를 안전하게 저장하지 못해 외부 삭제를 재시도합니다.");
              }
            } catch {
              failVendorResolution(CREATE_OUTCOME_UNCERTAIN_CODE, CREATE_OUTCOME_UNCERTAIN_MESSAGE_KO);
            }
          }
        }
      }
      if (vendorCreateOutcomeState === "not-attempted" || vendorCreateOutcomeState === "definitive-no-job") {
        vendor = { status: "deleted" };
        vendorDeleteState = "deleted";
        vendorDeleteNextAttemptAt = undefined;
      } else if (vendorCreateOutcomeState === "confirmed") {
        const providerDelete = await this.executeProviderDelete(job, now);
        vendor = providerDelete.vendor;
        vendorDeleteState = providerDelete.state;
        vendorDeleteNextAttemptAt = providerDelete.nextAttemptAt;
        retentionInfo = providerDelete.retentionInfo ?? (vendor.status === "not-supported" ? vendor.retentionInfo : retentionInfo);
      }
    }
    let localDeleteState = job.localDeleteState;
    let localDeleteNextAttemptAt = job.localDeleteNextAttemptAt;
    if (localDeleteState !== "deleted" && (!localDeleteNextAttemptAt || localDeleteNextAttemptAt <= now.toISOString())) {
      let localCleanupComplete = true;
      for (const objectId of [...job.pages.flatMap((page) => page.objectReferenceId ? [page.objectReferenceId] : []), ...(job.resultObjectReferenceId ? [job.resultObjectReferenceId] : [])]) {
        try { await this.dependencies.objects.delete(objectId, job.ownerSessionId, now); } catch { localCleanupComplete = false; }
      }
      localDeleteState = localCleanupComplete ? "deleted" : "failed";
      localDeleteNextAttemptAt = localCleanupComplete ? undefined : new Date(now.getTime() + DELETE_RETRY_MS).toISOString();
    }
    const state = vendorDeleteState === "deleted" && localDeleteState === "deleted" ? "deleted" : "delete-pending";
    const explicitPendingCode = vendor.status === "failed" && [
      "OMR_PROVIDER_BINDING_UNAVAILABLE", CREATE_OUTCOME_UNCERTAIN_CODE,
      CREATE_RECONCILIATION_PERSIST_CODE, "OMR_VENDOR_JOB_ID_UNAVAILABLE",
      "OMR_VENDOR_DELETE_OUTCOME_UNCERTAIN", "OMR_VENDOR_DELETE_FAILED", "OMR_VENDOR_DELETE_PENDING",
    ].includes(vendor.code) ? vendor.code : undefined;
    const creditState = creditStateAfterHandleDeactivation({
      ...job, state, vendorCreateOutcomeState, vendorDeleteState,
    });
    const update = {
      state, vendorCreateOutcomeState, vendorDeleteResult: vendor, vendorDeleteState, localDeleteState, creditState,
      vendorDeleteNextAttemptAt, localDeleteNextAttemptAt,
      ...(retentionInfo ? { retentionInfo } : {}),
      ...(state === "deleted" ? { vendorJobIdEnvelope: undefined } : {}),
      ...(localDeleteState === "deleted" ? { resultObjectReferenceId: undefined, evidence: undefined, normalizationMapping: undefined } : {}),
      publicFailureCode: state === "delete-pending"
        ? explicitPendingCode ?? "OMR_RETENTION_PENDING"
        : undefined,
      publicFailureMessageKo: state === "delete-pending"
        ? explicitPendingCode && vendor.status === "failed" ? vendor.message : "외부 보존 또는 로컬 정리를 계속 확인하고 있습니다."
        : undefined,
    } satisfies Partial<DurableOmrJobRecord>;
    const providerDeleteOperation = await this.dependencies.store.getProviderDeleteOperation(job.id);
    const finalized = await this.dependencies.store.finalizeJobDelete({
      jobId: job.id,
      ...(cleanupLeaseToken ? { cleanupLeaseToken } : {}),
      ...(providerDeleteOperation ? {
        providerDeleteAuthority: {
          operationId: providerDeleteOperation.operationId,
          operationGeneration: providerDeleteOperation.operationGeneration,
        },
      } : {}),
      update,
      now: now.toISOString(),
    });
    if (finalized.status === "superseded") {
      await this.recordAuditBestEffort(job.id, "job-delete-superseded", "aggregate-fence-lost", now.toISOString());
    }
    const persisted = finalized.job;
    const persistedVendor: VendorDeleteResult = persisted.vendorDeleteResult
      ?? (persisted.vendorDeleteState === "deleted"
        ? { status: "deleted" }
        : finalized.status === "applied"
          ? vendor
          : { status: "failed", code: "OMR_VENDOR_DELETE_PENDING", message: "Vendor 삭제 확인을 기다리고 있습니다." });
    await this.recordAuditBestEffort(job.id, "job-delete", `${persisted.vendorDeleteState}:${persisted.localDeleteState}`, now.toISOString());
    if (persisted.state === "deleted") {
      return { localHandleDeleted: true, vendor: structuredClone(persistedVendor), cleanupState: "resolved" };
    }
    const nextAttemptAt = [persisted.vendorDeleteNextAttemptAt, persisted.localDeleteNextAttemptAt]
      .filter((candidate): candidate is string => candidate !== undefined)
      .sort()[0];
    return {
      localHandleDeleted: true,
      vendor: structuredClone(persistedVendor),
      cleanupState: "pending",
      ...(nextAttemptAt ? { nextAttemptAt } : {}),
    };
  }

  async delete(handle: OmrJobHandle): Promise<OmrDeleteResult> {
    const now = this.now();
    const job = await this.dependencies.store.findOwnedByHandleHash(this.handleHash(handle, now), this.dependencies.actor.sessionId, true);
    if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
    return this.deleteRecord(job, now);
  }

  async cleanupExpiredJobsForScheduler(limit = 50): Promise<OmrCleanupBatchSummary> {
    const now = this.now();
    const leaseToken = generateOpaqueToken(24);
    const expired = await this.dependencies.store.claimCleanup({ now: now.toISOString(), limit, leaseToken, leaseExpiresAt: new Date(now.getTime() + CLEANUP_LEASE_MS).toISOString() });
    const results: Array<{ readonly jobId: PrivateRowId; readonly result: OmrDeleteResult }> = [];
    const failures: OmrCleanupItemFailure[] = [];
    for (const job of expired) {
      try { results.push({ jobId: job.id, result: await this.deleteRecord(job, now, leaseToken) }); }
      catch (error) {
        failures.push({ jobId: job.id, code: cleanupItemFailureCode(error) });
        await this.recordAuditBestEffort(job.id, "job-delete", "cleanup-isolated-failure", now.toISOString());
      }
    }
    return { attemptedJobs: expired.length, completedJobs: results.length, failedJobs: failures.length, results, failures };
  }

  async cleanupExpiredJobs(limit = 50): Promise<readonly { readonly jobId: PrivateRowId; readonly result: OmrDeleteResult }[]> {
    return (await this.cleanupExpiredJobsForScheduler(limit)).results;
  }
}
