import "server-only";

import { binaryDigest, semanticDigest } from "../../domain/digest/canonical";
import { computeProviderBundleDigest } from "../../domain/omr/foundation";
import type { ImageQualityReport } from "../../domain/omr/image-quality";
import type { InputSourceKind } from "../../domain/omr/input";
import {
  CORE_OMR_QUOTA_DEFAULTS, validateVendorCapabilities,
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
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "deleted", "expired"]);

const GRANULARITY_RANK = Object.freeze({ none: 0, page: 1, staff: 2, measure: 3, symbol: 4 });

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

  async createJob(request: Parameters<OmrApplicationService["createJob"]>[0]): Promise<OmrJobHandle> {
    const now = this.now();
    if (request.sessionId !== this.dependencies.actor.sessionId || request.providerTransferConsent !== true
      || !validateRights(request.rights) || !request.rights.allowedUses.includes("provider-transfer")) throw new RangeError("RIGHTS_PROVIDER_TRANSFER_NOT_CONFIRMED");
    const capabilities = await this.dependencies.adapter.getCapabilities();
    validateVendorCapabilities(capabilities);
    const effectivePageCap = Math.min(capabilities.maxPages, this.dependencies.quota.maxPagesPerJob);
    if (!Number.isSafeInteger(request.pageCount) || request.pageCount < 1 || request.pageCount > effectivePageCap) throw new RangeError("OMR_PAGE_LIMIT_EXCEEDED");
    if (capabilities.estimatedCreditPerPage === undefined) throw new RangeError("OMR_CREDIT_ESTIMATE_REQUIRED");
    const creditEstimate = capabilities.estimatedCreditPerPage * request.pageCount;
    if (!Number.isSafeInteger(creditEstimate) || creditEstimate <= 0) throw new RangeError("OMR_CREDIT_ESTIMATE_INVALID");
    const handle = this.issueHandle(now);
    const handleHash = keyedTokenHash(handle, this.dependencies.handleHmacKey, "omr-handle-verifier-v1");
    const replayEnvelope = encryptAeadV1(new TextEncoder().encode(handle), this.dependencies.vendorJobEncryptionKey, { associatedDataVersion: "omr-handle-replay-v1" });
    const idempotencyKeyHash = keyedTokenHash(request.idempotencyKey, this.dependencies.handleHmacKey, "omr-create-idempotency-v1");
    const vendorCreateIdempotencyKey = keyedTokenHash(request.idempotencyKey, this.dependencies.handleHmacKey, "omr-vendor-create-v1");
    const sourceKind: InputSourceKind = request.sourceKind;
    const requestDigest = await semanticDigest({ projectionSchema: "hm-omr-create-request-v1", sourceKind, pageCount: request.pageCount, rights: request.rights, providerTransferConsent: true, vendorId: capabilities.vendorId, capabilities });
    const record: Omit<DurableOmrJobRecord, "id"> = {
      ownerSessionId: this.dependencies.actor.sessionId, ipOwnerHash: this.dependencies.actor.ipOwnerHash,
      publicHandleHash: handleHash, publicHandleReplayEnvelope: replayEnvelope,
      handleExpiresAt: new Date(now.getTime() + HANDLE_LIFETIME_MS).toISOString(), sourceKind,
      pageCount: request.pageCount, state: "created", rights: structuredClone(request.rights),
      providerTransferConsent: true, providerConsentRecordedAt: now.toISOString(), capabilities: structuredClone(capabilities),
      vendorCreateIdempotencyKey, vendorCreateLeaseExpiresAt: new Date(now.getTime() + CREATE_LEASE_MS).toISOString(),
      creditEstimate, creditState: "reserved", pages: [], handleActive: true,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    const claim = await this.dependencies.store.claimCreate({ ownerSessionId: this.dependencies.actor.sessionId, ipOwnerHash: this.dependencies.actor.ipOwnerHash, idempotencyKeyHash, requestDigest, record, quota: this.dependencies.quota, now: now.toISOString() });
    if (claim.status === "replay") return new TextDecoder().decode(decryptAeadV1(claim.handleReplayEnvelope, this.dependencies.vendorJobEncryptionKey)) as OmrJobHandle;
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
    if (claim.status === "resume" && !capabilities.supportsIdempotency) {
      await this.dependencies.store.failVendorCreation(claimedJob.id, "OMR_JOB_RECONCILIATION_REQUIRED", "인식 작업 생성 상태를 확인해야 합니다.", now.toISOString());
      throw new RangeError("OMR_JOB_RECONCILIATION_REQUIRED");
    }
    let vendorJobId: VendorJobId;
    try {
      vendorJobId = await this.dependencies.adapter.createVendorJob({ pageCount: request.pageCount, idempotencyKey: claimedJob.vendorCreateIdempotencyKey });
    } catch {
      await this.dependencies.store.failVendorCreation(claimedJob.id, "OMR_VENDOR_OPERATION_FAILED", sanitizeVendorFailure().messageKo, now.toISOString());
      await this.dependencies.store.recordAudit(claimedJob.id, "job-create-failed", "vendor-call", now.toISOString());
      throw new RangeError("OMR_VENDOR_OPERATION_FAILED");
    }
    try {
      const envelope = encryptAeadV1(new TextEncoder().encode(vendorJobId), this.dependencies.vendorJobEncryptionKey, { associatedDataVersion: "omr-vendor-job-id-v1" });
      await this.dependencies.store.completeVendorCreation(claimedJob.id, envelope, now.toISOString());
      await this.dependencies.store.recordAudit(claimedJob.id, "job-created", claim.status, now.toISOString());
      return claim.status === "resume"
        ? new TextDecoder().decode(decryptAeadV1(claimedJob.publicHandleReplayEnvelope, this.dependencies.vendorJobEncryptionKey)) as OmrJobHandle
        : handle;
    } catch {
      await this.dependencies.store.recordAudit(claimedJob.id, "job-create-persist-pending", capabilities.supportsIdempotency ? "retry-after-lease" : "reconciliation-required", now.toISOString());
      throw new RangeError(capabilities.supportsIdempotency ? "OMR_IDEMPOTENCY_PENDING" : "OMR_JOB_RECONCILIATION_REQUIRED");
    }
  }

  async uploadPage(handle: OmrJobHandle, page: OmrApplicationPageUpload): Promise<void> {
    const now = this.now();
    const job = await this.owned(handle);
    if (!Number.isSafeInteger(page.pageIndex) || page.pageIndex < 0 || page.pageIndex >= job.pageCount
      || !["created", "uploading"].includes(job.state)) throw new RangeError("OMR_PAGE_UPLOAD_NOT_ALLOWED");
    if (!job.capabilities.supportedMimeTypes.includes(page.mimeType)) throw new RangeError("OMR_INPUT_FORMAT_UNSUPPORTED");
    const rawBytes = new Uint8Array(await page.bytes.arrayBuffer());
    const recomputedInputDigest = await binaryDigest(rawBytes);
    if (recomputedInputDigest !== page.pageDigest) throw new RangeError("OMR_PAGE_DIGEST_MISMATCH");
    const inspected = await this.dependencies.inspectPage({ bytes: rawBytes, mimeType: page.mimeType, pageIndex: page.pageIndex });
    if (inspected.quality.status === "retake") throw new RangeError("OMR_IMAGE_RETAKE_REQUIRED");
    if (inspected.quality.status === "warn" && page.warnAcknowledged !== true) throw new RangeError("OMR_IMAGE_WARNING_ACK_REQUIRED");
    const duplicate = job.pages.find((candidate) => candidate.pageIndex !== page.pageIndex && candidate.pageDigest === inspected.digest);
    if (duplicate && page.duplicateConfirmed !== true) throw new RangeError("OMR_DUPLICATE_PAGE_CONFIRMATION_REQUIRED");
    const idempotencyKeyHash = keyedTokenHash(page.idempotencyKey, this.dependencies.handleHmacKey, "omr-page-idempotency-v1");
    const pageRecord: OmrPageRecord = {
      pageIndex: page.pageIndex, pageDigest: inspected.digest, mimeType: inspected.mimeType,
      idempotencyKeyHash, width: inspected.width, height: inspected.height, quality: inspected.quality,
      warnAcknowledged: inspected.quality.status !== "warn" || page.warnAcknowledged === true,
      duplicateConfirmed: !duplicate || page.duplicateConfirmed === true,
      uploadState: "pending", retryCount: 0,
    };
    const claim = await this.dependencies.store.claimPage(job.id, pageRecord, this.dependencies.quota.maxRetriesPerPage, now.toISOString());
    if (claim.status === "replay") return;
    if (claim.status !== "claimed") throw new RangeError(claim.status === "conflict" ? "OMR_PAGE_UPLOAD_CONFLICT" : claim.status === "pending" ? "OMR_PAGE_UPLOAD_PENDING" : "OMR_PAGE_RETRY_EXHAUSTED");
    let objectReferenceId: PrivateRowId | undefined;
    try {
      const object = await this.dependencies.objects.put({ ownerSessionId: job.ownerSessionId, bytes: inspected.bytes, contentType: inspected.mimeType, expiresAt: job.handleExpiresAt });
      objectReferenceId = object.id;
      await this.dependencies.adapter.uploadPage(this.vendorJobId(job), { pageIndex: page.pageIndex, pageDigest: inspected.digest, mimeType: inspected.mimeType, idempotencyKey: idempotencyKeyHash, bytes: new Blob([inspected.bytes.slice().buffer as ArrayBuffer], { type: inspected.mimeType }) });
      await this.dependencies.store.completePage(job.id, page.pageIndex, object.id, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, "page-uploaded", String(page.pageIndex), now.toISOString());
    } catch {
      if (objectReferenceId) await this.dependencies.objects.delete(objectReferenceId, job.ownerSessionId, now).catch(() => undefined);
      await this.dependencies.store.failPage(job.id, page.pageIndex, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, "page-upload-failed", String(page.pageIndex), now.toISOString());
      throw new RangeError("OMR_PAGE_UPLOAD_FAILED");
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
    try {
      await this.dependencies.adapter.startVendorJob(this.vendorJobId(job));
      await this.dependencies.store.transition(job.id, { state: "queued", startedAt: now.toISOString() }, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, "job-started", "queued", now.toISOString());
    } catch { throw new RangeError("OMR_VENDOR_OPERATION_FAILED"); }
  }

  private async captureCompleted(job: DurableOmrJobRecord, now: Date): Promise<void> {
    const vendorJobId = this.vendorJobId(job);
    let resultObjectId: PrivateRowId | undefined;
    try {
      const rawMusicXml = await this.dependencies.adapter.exportMusicXml(vendorJobId);
      const rawBytes = new TextEncoder().encode(rawMusicXml);
      const vendorResultDigest = await binaryDigest(rawBytes);
      const evidence = await this.dependencies.adapter.getEvidence(vendorJobId);
      const recomputed = await computeProviderBundleDigest(evidence);
      if (recomputed !== evidence.providerBundleDigest
        || GRANULARITY_RANK[evidence.granularity] < GRANULARITY_RANK[job.capabilities.evidenceGranularity]
        || evidence.evidence.length === 0) throw new RangeError("OMR_PROVIDER_CAPABILITY_MISSING");
      const retentionInfo = await this.dependencies.adapter.getRetentionInfo(vendorJobId);
      const resultObject = await this.dependencies.objects.put({ ownerSessionId: job.ownerSessionId, bytes: rawBytes, contentType: "application/vnd.recordare.musicxml+xml", expiresAt: job.handleExpiresAt });
      resultObjectId = resultObject.id;
      await this.dependencies.store.transition(job.id, { state: "completed", creditState: "settled", progressBp: 10_000, resultObjectReferenceId: resultObject.id, vendorResultDigest, evidence, retentionInfo, completedAt: now.toISOString(), currentInputRequest: undefined }, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, "job-completed", "result-and-evidence-durable", now.toISOString());
    } catch (error) {
      if (resultObjectId) await this.dependencies.objects.delete(resultObjectId, job.ownerSessionId, now).catch(() => undefined);
      const code = error instanceof RangeError && error.message === "OMR_PROVIDER_CAPABILITY_MISSING" ? error.message : "OMR_VENDOR_OPERATION_FAILED";
      await this.dependencies.store.transition(job.id, { state: "failed", creditState: "released", publicFailureCode: code, publicFailureMessageKo: code === "OMR_PROVIDER_CAPABILITY_MISSING" ? "인식 결과 증거가 제공자 계약과 일치하지 않습니다." : sanitizeVendorFailure().messageKo }, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, "job-failed", code, now.toISOString());
    }
  }

  async getStatus(handle: OmrJobHandle): Promise<OmrPublicStatus> {
    const now = this.now();
    let job = await this.owned(handle);
    if (!["queued", "processing", "needs-input"].includes(job.state)) return publicStatusFromRecord(job);
    let status;
    try { status = await this.dependencies.adapter.getVendorStatus(this.vendorJobId(job)); }
    catch { status = { kind: "failed", code: "VENDOR_FAILURE", message: "vendor failure" } as const; }
    if (status.kind === "unknown") {
      await this.dependencies.store.transition(job.id, { state: "failed", creditState: "released", publicFailureCode: "OMR_VENDOR_STATUS_UNKNOWN", publicFailureMessageKo: "인식 작업 상태를 확인할 수 없습니다." }, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, "job-failed", "unknown-vendor-status", now.toISOString());
    } else if (status.kind === "failed") {
      const failure = sanitizeVendorFailure();
      await this.dependencies.store.transition(job.id, { state: "failed", creditState: "released", publicFailureCode: failure.code, publicFailureMessageKo: failure.messageKo }, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, "job-failed", failure.code, now.toISOString());
    } else if (status.kind === "cancelled") {
      await this.dependencies.store.transition(job.id, { state: "cancelled", creditState: "released" }, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, "job-cancelled", "vendor-status", now.toISOString());
    } else if (status.kind === "processing") {
      if (status.progressBp !== undefined && (!Number.isSafeInteger(status.progressBp) || status.progressBp < 0 || status.progressBp > 10_000)) {
        await this.dependencies.store.transition(job.id, { state: "failed", creditState: "released", publicFailureCode: "OMR_VENDOR_STATUS_UNKNOWN", publicFailureMessageKo: "인식 작업 상태를 확인할 수 없습니다." }, now.toISOString());
        await this.dependencies.store.recordAudit(job.id, "job-failed", "invalid-vendor-progress", now.toISOString());
      } else await this.dependencies.store.transition(job.id, { state: "processing", ...(status.progressBp === undefined ? {} : { progressBp: status.progressBp }) }, now.toISOString());
    } else if (status.kind === "needs-input") {
      await this.dependencies.store.transition(job.id, { state: "needs-input", currentInputRequest: status.request }, now.toISOString());
      await this.dependencies.store.recordAudit(job.id, "needs-input", status.request.kind, now.toISOString());
    } else if (status.kind === "completed") {
      await this.captureCompleted(job, now);
    } else if (status.kind === "queued") {
      await this.dependencies.store.transition(job.id, { state: "queued" }, now.toISOString());
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
    if (!job.capabilities.supportsInteractiveInput || !this.dependencies.adapter.submitVendorInput) throw new RangeError("OMR_PROVIDER_CAPABILITY_MISSING");
    await this.dependencies.adapter.submitVendorInput(this.vendorJobId(job), input);
    await this.dependencies.store.transition(job.id, { state: "processing", acceptedInput: structuredClone(input), currentInputRequest: undefined }, now.toISOString());
    await this.dependencies.store.recordAudit(job.id, "input-accepted", input.kind, now.toISOString());
  }

  async exportResult(handle: OmrJobHandle): Promise<OmrProviderResult> {
    const job = await this.owned(handle);
    if (job.state !== "completed" || !job.resultObjectReferenceId || !job.vendorResultDigest || !job.evidence || !job.retentionInfo) throw new RangeError("OMR_RESULT_UNAVAILABLE");
    const result = await this.dependencies.objects.get(job.resultObjectReferenceId, job.ownerSessionId);
    if (result.binaryDigest !== job.vendorResultDigest) throw new RangeError("OMR_RESULT_INTEGRITY_FAILED");
    return { vendorId: job.capabilities.vendorId, vendorResultDigest: job.vendorResultDigest, rawMusicXml: new TextDecoder("utf-8", { fatal: true }).decode(result.bytes), evidence: structuredClone(job.evidence), retentionInfo: structuredClone(job.retentionInfo) };
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
    if (job.vendorJobIdEnvelope) await this.dependencies.adapter.cancelVendorJob(this.vendorJobId(job)).catch(() => undefined);
    await this.dependencies.store.transition(job.id, { state: "cancelled", creditState: "released" }, now.toISOString());
    await this.dependencies.store.recordAudit(job.id, "job-cancelled", "application-request", now.toISOString());
  }

  private async deleteRecord(job: DurableOmrJobRecord, now: Date): Promise<OmrDeleteResult> {
    if (job.state === "deleted" && job.vendorDeleteResult) return { localHandleDeleted: true, vendor: structuredClone(job.vendorDeleteResult) };
    if (job.handleActive) await this.dependencies.store.markHandleDeleted(job.id, now.toISOString());
    else if (job.state === "expired") await this.dependencies.store.transition(job.id, { state: "delete-pending" }, now.toISOString());
    let vendor: VendorDeleteResult;
    let retentionInfo = job.retentionInfo;
    try {
      vendor = job.vendorJobIdEnvelope ? await this.dependencies.adapter.deleteVendorJob(this.vendorJobId(job)) : { status: "deleted" };
      if (vendor.status === "not-supported") retentionInfo = vendor.retentionInfo;
      else if (vendor.status === "failed") {
        retentionInfo = await this.dependencies.adapter.getRetentionInfo(this.vendorJobId(job)).catch(() => retentionInfo);
        vendor = { status: "failed", code: "OMR_VENDOR_DELETE_FAILED", message: "Vendor 삭제 확인이 완료되지 않았습니다." };
      }
    } catch {
      retentionInfo = job.vendorJobIdEnvelope ? await this.dependencies.adapter.getRetentionInfo(this.vendorJobId(job)).catch(() => retentionInfo) : retentionInfo;
      vendor = { status: "failed", code: "OMR_VENDOR_DELETE_FAILED", message: "Vendor 삭제 확인이 완료되지 않았습니다." };
    }
    let localCleanupComplete = true;
    for (const objectId of [...job.pages.flatMap((page) => page.objectReferenceId ? [page.objectReferenceId] : []), ...(job.resultObjectReferenceId ? [job.resultObjectReferenceId] : [])]) {
      try { await this.dependencies.objects.delete(objectId, job.ownerSessionId, now); } catch { localCleanupComplete = false; }
    }
    const state = vendor.status === "deleted" && localCleanupComplete ? "deleted" : "delete-pending";
    await this.dependencies.store.transition(job.id, {
      state, vendorDeleteResult: vendor, ...(retentionInfo ? { retentionInfo } : {}),
      ...(state === "deleted" ? { vendorJobIdEnvelope: undefined } : {}),
      ...(localCleanupComplete ? { resultObjectReferenceId: undefined, evidence: undefined } : {}),
      publicFailureCode: state === "delete-pending" ? "OMR_RETENTION_PENDING" : undefined,
      publicFailureMessageKo: state === "delete-pending" ? "외부 보존 또는 로컬 정리를 계속 확인하고 있습니다." : undefined,
    }, now.toISOString());
    await this.dependencies.store.recordAudit(job.id, "job-delete", `${vendor.status}:${localCleanupComplete ? "local-deleted" : "local-pending"}`, now.toISOString());
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
    const expired = await this.dependencies.store.claimExpired(now.toISOString(), limit);
    const results: Array<{ readonly jobId: PrivateRowId; readonly result: OmrDeleteResult }> = [];
    for (const job of expired) results.push({ jobId: job.id, result: await this.deleteRecord(job, now) });
    return results;
  }
}
