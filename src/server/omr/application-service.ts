import "server-only";

import { binaryDigest, semanticDigest } from "../../domain/digest/canonical";
import { computeProviderBundleDigest } from "../../domain/omr/foundation";
import type { ImageQualityReport } from "../../domain/omr/image-quality";
import type { InputSourceKind } from "../../domain/omr/input";
import {
  CORE_OMR_QUOTA_DEFAULTS, OMR_VENDOR_ADAPTER_CONTRACT_VERSION, canonicalizeVendorCapabilities,
  validateVendorCapabilities, validateVendorNormalizationMappingArtifact, vendorCallOutcome,
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
  publicStatusFromRecord, type DurableOmrJobRecord, type OmrPageRecord, type OmrStore,
} from "./store";

const HANDLE_VERSION = "v1";
const HANDLE_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const CREATE_LEASE_MS = 5 * 60 * 1_000;
const OPERATION_LEASE_MS = 5 * 60 * 1_000;
const DELETE_RETRY_MS = 60 * 1_000;
const CLEANUP_LEASE_MS = 5 * 60 * 1_000;
const RETRY_BACKOFF_MS = Object.freeze([60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000]);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "deleted", "expired"]);

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
  readonly adapterContractVersion?: string;
  readonly resolveAdapter?: (providerBindingId: string, adapterContractVersion: string) => OmrVendorAdapter | undefined;
  readonly handleHmacKey: Uint8Array;
  readonly vendorJobEncryptionKey: Uint8Array;
  readonly quota: OmrQuotaConfig;
  readonly actor: OmrApplicationActor;
  readonly inspectPage: (input: { readonly bytes: Uint8Array; readonly mimeType: string; readonly pageIndex: number }) => Promise<OmrPageInspection>;
  readonly now?: () => Date;
}

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
    return request.schemaId === response.schemaId && Object.keys(response.payload).length <= 32
      && JSON.stringify(response.payload).length <= 8_192;
  }
  return false;
}

export function omrQuotaConfig(dailyGlobalCreditCeiling: number): OmrQuotaConfig {
  if (!Number.isSafeInteger(dailyGlobalCreditCeiling) || dailyGlobalCreditCeiling <= 0) throw new RangeError("OMR_DAILY_GLOBAL_CREDIT_CEILING_INVALID");
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
    const resolved = this.dependencies.resolveAdapter?.(job.providerBindingId, job.adapterContractVersion);
    if (resolved) return resolved;
    const currentBindingId = this.dependencies.providerBindingId ?? job.capabilities.vendorId;
    const currentContractVersion = this.dependencies.adapterContractVersion ?? OMR_VENDOR_ADAPTER_CONTRACT_VERSION;
    if (job.providerBindingId === currentBindingId && job.adapterContractVersion === currentContractVersion) return this.dependencies.adapter;
    throw new RangeError("OMR_PROVIDER_BINDING_UNAVAILABLE");
  }

  private async transitionUnlessSuperseded(jobId: PrivateRowId, update: Partial<DurableOmrJobRecord>, now: string): Promise<boolean> {
    try { await this.dependencies.store.transition(jobId, update, now); return true; }
    catch (error) {
      if (error instanceof RangeError && error.message === "OMR_STATE_TRANSITION_INVALID") return false;
      throw error;
    }
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
      if (!Number.isSafeInteger(creditEstimate) || creditEstimate <= 0) throw new RangeError("OMR_CREDIT_ESTIMATE_INVALID");
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
        vendorCreateIdempotencyKey, vendorCreateLeaseExpiresAt,
        creditEstimate, creditState: "reserved", pages: [], handleActive: true,
        vendorDeleteState: "not-started", localDeleteState: "not-started",
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
      };
      claim = await this.dependencies.store.claimCreate({ ownerSessionId: this.dependencies.actor.sessionId, ipOwnerHash: this.dependencies.actor.ipOwnerHash, idempotencyKeyHash, requestDigest, record, quota: this.dependencies.quota, now: now.toISOString() });
    } else {
      claim = existing;
    }
    if (claim.status === "replay") return new TextDecoder().decode(decryptAeadV1(claim.handleReplayEnvelope, this.dependencies.vendorJobEncryptionKey)) as OmrJobHandle;
    if (claim.status === "rejected") throw new RangeError(claim.code);
    if (claim.status === "pending") throw new RangeError("OMR_IDEMPOTENCY_PENDING");
    if (claim.status === "conflict") throw new RangeError("OMR_IDEMPOTENCY_CONFLICT");
    if (claim.status === "quota-denied") {
      await this.dependencies.store.recordAudit(undefined, "create-denied", "quota", now.toISOString());
      throw new RangeError("OMR_QUOTA_EXCEEDED");
    }
    if (claim.status === "credit-denied") {
      await this.dependencies.store.recordAudit(undefined, "create-denied", "global-credit", now.toISOString());
      throw new RangeError("OMR_GLOBAL_CREDIT_CEILING_EXCEEDED");
    }
    if (claim.status !== "claimed" && claim.status !== "resume") throw new RangeError("OMR_CREATE_STATE_INVALID");
    const claimedJob = claim.job;
    if (claim.status === "resume" && !claimedJob.capabilities.supportsIdempotency) {
      await this.dependencies.store.transition(claimedJob.id, { state: "reconciliation-required", reconciliationKind: "create", publicFailureCode: "OMR_JOB_RECONCILIATION_REQUIRED", publicFailureMessageKo: "인식 작업 생성 상태를 확인해야 합니다." }, now.toISOString());
      throw new RangeError("OMR_JOB_RECONCILIATION_REQUIRED");
    }
    let vendorJobId: VendorJobId;
    const adapter = this.adapterFor(claimedJob);
    try {
      vendorJobId = await adapter.createVendorJob({ pageCount: claimedJob.canonicalCreateRequest.pageCount, idempotencyKey: claimedJob.vendorCreateIdempotencyKey });
    } catch (error) {
      const outcome = vendorCallOutcome(error);
      if (outcome === "definitive-rejection") {
        await this.dependencies.store.failVendorCreation(claimedJob.id, "OMR_VENDOR_OPERATION_FAILED", sanitizeVendorFailure().messageKo, now.toISOString());
        await this.dependencies.store.recordAudit(claimedJob.id, "job-create-failed", "definitive-vendor-rejection", now.toISOString());
        throw new RangeError("OMR_VENDOR_OPERATION_FAILED");
      }
      if (!claimedJob.capabilities.supportsIdempotency) await this.dependencies.store.transition(claimedJob.id, { state: "reconciliation-required", reconciliationKind: "create", publicFailureCode: "OMR_JOB_RECONCILIATION_REQUIRED", publicFailureMessageKo: "인식 작업 생성 상태를 확인해야 합니다." }, now.toISOString());
      await this.dependencies.store.recordAudit(claimedJob.id, "job-create-uncertain", claimedJob.capabilities.supportsIdempotency ? "resumable" : "reconciliation-required", now.toISOString());
      throw new RangeError(claimedJob.capabilities.supportsIdempotency ? "OMR_IDEMPOTENCY_PENDING" : "OMR_JOB_RECONCILIATION_REQUIRED");
    }
    try {
      const envelope = encryptAeadV1(new TextEncoder().encode(vendorJobId), this.dependencies.vendorJobEncryptionKey, { associatedDataVersion: "omr-vendor-job-id-v1" });
      await this.dependencies.store.completeVendorCreation(claimedJob.id, envelope, now.toISOString());
      await this.dependencies.store.recordAudit(claimedJob.id, "job-created", claim.status, now.toISOString());
      return claim.status === "resume"
        ? new TextDecoder().decode(decryptAeadV1(claimedJob.publicHandleReplayEnvelope, this.dependencies.vendorJobEncryptionKey)) as OmrJobHandle
        : handle;
    } catch {
      if (!claimedJob.capabilities.supportsIdempotency) await this.dependencies.store.transition(claimedJob.id, {
        state: "reconciliation-required", reconciliationKind: "create",
        publicFailureCode: "OMR_JOB_RECONCILIATION_REQUIRED", publicFailureMessageKo: "인식 작업 생성 상태를 확인해야 합니다.",
      }, now.toISOString()).catch(() => undefined);
      await this.dependencies.store.recordAudit(claimedJob.id, "job-create-persist-pending", claimedJob.capabilities.supportsIdempotency ? "retry-after-lease" : "reconciliation-required", now.toISOString());
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
    try {
      const object = await this.dependencies.objects.put({ ownerSessionId: job.ownerSessionId, bytes: inspected.bytes, contentType: inspected.mimeType, expiresAt: job.handleExpiresAt });
      objectReferenceId = object.id;
      await this.adapterFor(job).uploadPage(this.vendorJobId(job), { pageIndex: page.pageIndex, pageDigest: inspected.digest, mimeType: inspected.mimeType, idempotencyKey: idempotencyKeyHash, bytes: new Blob([inspected.bytes.slice().buffer as ArrayBuffer], { type: inspected.mimeType }) });
      vendorEffectCompleted = true;
      const applied = await this.dependencies.store.completePage(job.id, page.pageIndex, leaseToken, object.id, now.toISOString());
      if (!applied) {
        await this.dependencies.objects.delete(object.id, job.ownerSessionId, now);
        objectReferenceId = undefined;
        await this.dependencies.store.recordAudit(job.id, "page-upload-superseded", String(page.pageIndex), now.toISOString());
        return;
      }
      await this.dependencies.store.recordAudit(job.id, "page-uploaded", String(page.pageIndex), now.toISOString());
    } catch {
      if (objectReferenceId) await this.dependencies.objects.delete(objectReferenceId, job.ownerSessionId, now).catch(() => undefined);
      if (!vendorEffectCompleted) {
        const outcome = job.capabilities.supportsIdempotency ? "failed" : "reconciliation-required";
        await this.dependencies.store.failPage(job.id, page.pageIndex, leaseToken, outcome, now.toISOString());
        await this.dependencies.store.recordAudit(job.id, "page-upload-failed", `${page.pageIndex}:${outcome}`, now.toISOString());
        throw new RangeError(outcome === "reconciliation-required" ? "OMR_JOB_RECONCILIATION_REQUIRED" : "OMR_PAGE_UPLOAD_FAILED");
      }
      if (!job.capabilities.supportsIdempotency) {
        await this.dependencies.store.failPage(job.id, page.pageIndex, leaseToken, "reconciliation-required", now.toISOString());
      }
      await this.dependencies.store.recordAudit(job.id, "page-upload-persist-pending", String(page.pageIndex), now.toISOString());
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
      await this.dependencies.store.recordAudit(job.id, "job-started", applied ? "queued" : "superseded", now.toISOString());
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

  private async captureCompleted(job: DurableOmrJobRecord, now: Date): Promise<void> {
    const leaseToken = generateOpaqueToken(24);
    const claim = await this.dependencies.store.claimResultCapture({ jobId: job.id, leaseToken, leaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS).toISOString(), now: now.toISOString() });
    if (claim.status === "pending" || claim.status === "replay") return;
    if (claim.status !== "claimed") throw new RangeError("OMR_RESULT_UNAVAILABLE");
    const claimedJob = claim.job;
    let resultObjectId: PrivateRowId | undefined;
    try {
      const vendorJobId = this.vendorJobId(claimedJob);
      const adapter = this.adapterFor(claimedJob);
      const rawMusicXml = await adapter.exportMusicXml(vendorJobId);
      const rawBytes = new TextEncoder().encode(rawMusicXml);
      if (rawBytes.byteLength > PROVIDER_CAPTURE_LIMITS.musicXmlBytes) throw new RangeError("OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED");
      const vendorResultDigest = await binaryDigest(rawBytes);
      const evidence = await adapter.getEvidence(vendorJobId);
      validateEvidenceCaptureLimits(evidence);
      const normalizationMapping = await adapter.getNormalizationMapping(vendorJobId);
      validateNormalizationMappingCaptureLimits(normalizationMapping);
      await validateVendorNormalizationMappingArtifact(normalizationMapping);
      const recomputed = await computeProviderBundleDigest(evidence);
      if (recomputed !== evidence.providerBundleDigest
        || normalizationMapping.vendorResultDigest !== vendorResultDigest
        || normalizationMapping.providerBundleDigest !== evidence.providerBundleDigest
        || GRANULARITY_RANK[evidence.granularity] < GRANULARITY_RANK[job.capabilities.evidenceGranularity]
        || evidence.evidence.length === 0) throw new RangeError("OMR_PROVIDER_CAPABILITY_MISSING");
      this.validateEvidencePageBindings(claimedJob, evidence);
      const retentionInfo = await adapter.getRetentionInfo(vendorJobId);
      assertBoundedProviderValue(retentionInfo);
      const resultObject = await this.dependencies.objects.put({ ownerSessionId: job.ownerSessionId, bytes: rawBytes, contentType: "application/vnd.recordare.musicxml+xml", expiresAt: job.handleExpiresAt });
      resultObjectId = resultObject.id;
      if (!await this.dependencies.store.completeResultCapture({ jobId: job.id, leaseToken, update: { state: "completed", creditState: "settled", progressBp: 10_000, resultObjectReferenceId: resultObject.id, vendorResultDigest, evidence, normalizationMapping, retentionInfo, completedAt: now.toISOString(), currentInputRequest: undefined, ...this.clearRetry() }, now: now.toISOString() })) {
        await this.dependencies.objects.delete(resultObject.id, job.ownerSessionId, now).catch(() => undefined);
        await this.dependencies.store.recordAudit(job.id, "job-complete-superseded", "newer-state-preserved", now.toISOString());
        return;
      }
      await this.dependencies.store.recordAudit(job.id, "job-completed", "result-and-evidence-durable", now.toISOString());
    } catch (error) {
      if (resultObjectId) await this.dependencies.objects.delete(resultObjectId, job.ownerSessionId, now).catch(() => undefined);
      const code = error instanceof RangeError && (error.message === "OMR_PROVIDER_CAPABILITY_MISSING" || error.message === "OMR_RESULT_INTEGRITY_FAILED" || error.message === "OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED")
        ? error.message
        : "OMR_VENDOR_OPERATION_FAILED";
      await this.dependencies.store.releaseResultCapture(job.id, leaseToken, now.toISOString());
      if (error instanceof RangeError && error.message === "OMR_PROVIDER_BINDING_UNAVAILABLE") {
        await this.transitionUnlessSuperseded(job.id, { state: "reconciliation-required", reconciliationKind: "capture", publicFailureCode: error.message, publicFailureMessageKo: "생성 시점 제공자 binding을 사용할 수 없습니다." }, now.toISOString());
        await this.dependencies.store.recordAudit(job.id, "job-reconciliation-required", error.message, now.toISOString());
      } else if (code !== "OMR_VENDOR_OPERATION_FAILED") {
        await this.transitionUnlessSuperseded(job.id, {
          state: "failed", creditState: "released", publicFailureCode: code,
          publicFailureMessageKo: code === "OMR_RESULT_INTEGRITY_FAILED"
            ? "인식 결과가 업로드한 페이지 또는 결과 digest와 일치하지 않습니다."
            : "인식 결과가 제공자 계약 또는 안전 한도와 일치하지 않습니다.",
        }, now.toISOString());
        await this.dependencies.store.recordAudit(job.id, "job-failed", code, now.toISOString());
      } else {
        await this.transitionUnlessSuperseded(job.id, this.retryUpdate(claimedJob, "capture", code, now), now.toISOString());
        await this.dependencies.store.recordAudit(job.id, "job-capture-retry", code, now.toISOString());
      }
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
    let status;
    try { status = await this.adapterFor(job).getVendorStatus(this.vendorJobId(job)); }
    catch (error) {
      const update = error instanceof RangeError && error.message === "OMR_PROVIDER_BINDING_UNAVAILABLE"
        ? { state: "reconciliation-required" as const, reconciliationKind: "sync" as const, publicFailureCode: error.message, publicFailureMessageKo: "생성 시점 제공자 binding을 사용할 수 없습니다." }
        : this.retryUpdate(job, "sync", "OMR_VENDOR_STATUS_TRANSIENT", now);
      await this.transitionUnlessSuperseded(job.id, update, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, update.state === "reconciliation-required" ? "job-reconciliation-required" : "job-sync-retry", "OMR_VENDOR_STATUS_TRANSIENT", now.toISOString());
      return publicStatusFromRecord(await this.owned(handle));
    }
    if (status.kind === "unknown") {
      await this.transitionUnlessSuperseded(job.id, { state: "failed", creditState: "released", publicFailureCode: "OMR_VENDOR_STATUS_UNKNOWN", publicFailureMessageKo: "인식 작업 상태를 확인할 수 없습니다." }, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, "job-failed", "unknown-vendor-status", now.toISOString());
    } else if (status.kind === "failed") {
      const failure = sanitizeVendorFailure();
      await this.transitionUnlessSuperseded(job.id, { state: "failed", creditState: "released", publicFailureCode: failure.code, publicFailureMessageKo: failure.messageKo }, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, "job-failed", failure.code, now.toISOString());
    } else if (status.kind === "cancelled") {
      await this.transitionUnlessSuperseded(job.id, { state: "cancelled", creditState: "released" }, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, "job-cancelled", "vendor-status", now.toISOString());
    } else if (status.kind === "processing") {
      if (status.progressBp !== undefined && (!Number.isSafeInteger(status.progressBp) || status.progressBp < 0 || status.progressBp > 10_000)) {
        await this.transitionUnlessSuperseded(job.id, { state: "failed", creditState: "released", publicFailureCode: "OMR_VENDOR_STATUS_UNKNOWN", publicFailureMessageKo: "인식 작업 상태를 확인할 수 없습니다." }, now.toISOString());
        await this.dependencies.store.recordAudit(job.id, "job-failed", "invalid-vendor-progress", now.toISOString());
      } else await this.transitionUnlessSuperseded(job.id, { state: "processing", ...(status.progressBp === undefined ? {} : { progressBp: status.progressBp }), ...this.clearRetry() }, now.toISOString());
    } else if (status.kind === "needs-input") {
      await this.transitionUnlessSuperseded(job.id, { state: "needs-input", currentInputRequest: status.request, ...(job.currentInputRequest?.requestId === status.request.requestId ? {} : { acceptedInput: undefined }), ...this.clearRetry() }, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, "needs-input", status.request.kind, now.toISOString());
    } else if (status.kind === "completed") {
      await this.captureCompleted(job, now);
    } else if (status.kind === "queued") {
      await this.transitionUnlessSuperseded(job.id, { state: "queued", ...this.clearRetry() }, now.toISOString());
    }
    job = await this.owned(handle);
    return publicStatusFromRecord(job);
  }

  async submitInput(handle: OmrJobHandle, input: VendorInputResponse): Promise<void> {
    const now = this.now();
    const job = await this.owned(handle);
    if (job.acceptedInput) {
      if (JSON.stringify(job.acceptedInput) === JSON.stringify(input)) return;
      throw new RangeError("OMR_VENDOR_INPUT_CONFLICT");
    }
    if (job.state !== "needs-input" || !job.currentInputRequest || !inputResponseValid(job.currentInputRequest, input)) throw new RangeError("OMR_VENDOR_INPUT_INVALID");
    const adapter = this.adapterFor(job);
    if (!job.capabilities.supportsInteractiveInput || !adapter.submitVendorInput) throw new RangeError("OMR_PROVIDER_CAPABILITY_MISSING");
    const leaseToken = generateOpaqueToken(24);
    const inputDigest = await semanticDigest({ projectionSchema: "hm-omr-vendor-input-v1", input });
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
      const applied = await this.dependencies.store.completeOperation({ jobId: job.id, kind: "submit-input", leaseToken, update: { state: "processing", acceptedInput: structuredClone(input), currentInputRequest: undefined }, now: now.toISOString() });
      await this.dependencies.store.recordAudit(job.id, "input-accepted", applied ? input.kind : "superseded", now.toISOString());
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
    const claim = await this.dependencies.store.claimOperation({ jobId: job.id, kind: "cancel", operationRequestDigest, expectedStates: ["created", "uploading", "queued", "processing", "needs-input", "cancel-failed"], leaseToken, leaseExpiresAt: new Date(now.getTime() + OPERATION_LEASE_MS).toISOString(), supportsIdempotency: job.capabilities.supportsIdempotency, now: now.toISOString() });
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
      await this.dependencies.store.recordAudit(job.id, "job-cancelled", applied ? "application-request" : "superseded", now.toISOString());
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

  private async deleteRecord(job: DurableOmrJobRecord, now: Date, cleanupLeaseToken?: string): Promise<OmrDeleteResult> {
    if (job.state === "deleted" && job.vendorDeleteResult) return { localHandleDeleted: true, vendor: structuredClone(job.vendorDeleteResult) };
    if (job.handleActive) await this.dependencies.store.markHandleDeleted(job.id, now.toISOString());
    else if (job.state === "expired") await this.dependencies.store.transition(job.id, { state: "delete-pending" }, now.toISOString());
    let vendor: VendorDeleteResult = job.vendorDeleteResult ?? { status: "failed", code: "OMR_VENDOR_DELETE_PENDING", message: "Vendor 삭제 확인을 기다리고 있습니다." };
    let retentionInfo = job.retentionInfo;
    let vendorDeleteState = job.vendorDeleteState;
    let vendorDeleteNextAttemptAt = job.vendorDeleteNextAttemptAt;
    const vendorDue = !vendorDeleteNextAttemptAt || vendorDeleteNextAttemptAt <= now.toISOString();
    if (vendorDeleteState !== "deleted" && vendorDue) {
      try {
        vendor = job.vendorJobIdEnvelope
          ? await this.adapterFor(job).deleteVendorJob(this.vendorJobId(job), { idempotencyKey: keyedTokenHash(`${job.id}:delete`, this.dependencies.handleHmacKey, "omr-delete-v1") })
          : { status: "deleted" };
        if (vendor.status === "deleted") { vendorDeleteState = "deleted"; vendorDeleteNextAttemptAt = undefined; }
        else if (vendor.status === "not-supported") {
          retentionInfo = vendor.retentionInfo;
          vendorDeleteState = "not-supported";
          vendorDeleteNextAttemptAt = vendor.retentionInfo.vendorDeletesAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString();
        } else {
          retentionInfo = job.vendorJobIdEnvelope ? await this.adapterFor(job).getRetentionInfo(this.vendorJobId(job)).catch(() => retentionInfo) : retentionInfo;
          vendor = { status: "failed", code: "OMR_VENDOR_DELETE_FAILED", message: "Vendor 삭제 확인이 완료되지 않았습니다." };
          vendorDeleteState = "failed";
          vendorDeleteNextAttemptAt = new Date(now.getTime() + DELETE_RETRY_MS).toISOString();
        }
      } catch {
        retentionInfo = job.vendorJobIdEnvelope ? await this.adapterFor(job).getRetentionInfo(this.vendorJobId(job)).catch(() => retentionInfo) : retentionInfo;
        vendor = { status: "failed", code: "OMR_VENDOR_DELETE_FAILED", message: "Vendor 삭제 확인이 완료되지 않았습니다." };
        vendorDeleteState = "failed";
        vendorDeleteNextAttemptAt = new Date(now.getTime() + DELETE_RETRY_MS).toISOString();
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
    const update = {
      state, vendorDeleteResult: vendor, vendorDeleteState, localDeleteState,
      vendorDeleteNextAttemptAt, localDeleteNextAttemptAt,
      ...(retentionInfo ? { retentionInfo } : {}),
      ...(state === "deleted" ? { vendorJobIdEnvelope: undefined } : {}),
      ...(localDeleteState === "deleted" ? { resultObjectReferenceId: undefined, evidence: undefined, normalizationMapping: undefined } : {}),
      publicFailureCode: state === "delete-pending" ? "OMR_RETENTION_PENDING" : undefined,
      publicFailureMessageKo: state === "delete-pending" ? "외부 보존 또는 로컬 정리를 계속 확인하고 있습니다." : undefined,
    } satisfies Partial<DurableOmrJobRecord>;
    const applied = cleanupLeaseToken
      ? await this.dependencies.store.completeCleanup({ jobId: job.id, leaseToken: cleanupLeaseToken, update, now: now.toISOString() })
      : (await this.dependencies.store.transition(job.id, update, now.toISOString()), true);
    if (!applied) await this.dependencies.store.recordAudit(job.id, "job-delete-superseded", "cleanup-fence-lost", now.toISOString());
    await this.dependencies.store.recordAudit(job.id, "job-delete", `${vendorDeleteState}:${localDeleteState}`, now.toISOString());
    return { localHandleDeleted: true, vendor };
  }

  async delete(handle: OmrJobHandle): Promise<OmrDeleteResult> {
    const now = this.now();
    const job = await this.dependencies.store.findOwnedByHandleHash(this.handleHash(handle, now), this.dependencies.actor.sessionId, true);
    if (!job) throw new RangeError("OMR_JOB_UNAVAILABLE");
    return this.deleteRecord(job, now);
  }

  async cleanupExpiredJobs(limit = 50): Promise<readonly { readonly jobId: PrivateRowId; readonly result: OmrDeleteResult }[]> {
    const now = this.now();
    const leaseToken = generateOpaqueToken(24);
    const expired = await this.dependencies.store.claimCleanup({ now: now.toISOString(), limit, leaseToken, leaseExpiresAt: new Date(now.getTime() + CLEANUP_LEASE_MS).toISOString() });
    const results: Array<{ readonly jobId: PrivateRowId; readonly result: OmrDeleteResult }> = [];
    for (const job of expired) {
      try { results.push({ jobId: job.id, result: await this.deleteRecord(job, now, leaseToken) }); }
      catch {
        await this.dependencies.store.recordAudit(job.id, "job-delete", "cleanup-isolated-failure", now.toISOString());
      }
    }
    return results;
  }
}
