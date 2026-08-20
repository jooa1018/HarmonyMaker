import { compareCanonicalValues, semanticDigest, type BinaryDigest, type SemanticDigest } from "../digest/canonical";
import type { MusicXmlSourceTargetSelector, RightsMetadata } from "../source/model";
import type { BasisPoints } from "../rates";
import type { EvidenceGranularity, VendorEvidenceBundle } from "./foundation";
import type { InputSourceKind } from "./input";
import { hasExactKeys, isPlainRecord } from "../validation";

export interface OmrVendorCapabilities {
  readonly vendorId: string;
  readonly vendorDisplayName: string;
  readonly supportedMimeTypes: readonly string[];
  /** Actual bytes transferred to the provider after server canonicalization. */
  readonly transferMimeType: "image/png";
  readonly maxPages: number;
  readonly evidenceGranularity: EvidenceGranularity;
  readonly supportsDeletion: boolean;
  readonly retentionDisclosure: boolean;
  readonly supportsIdempotency: boolean;
  readonly supportsInteractiveInput: boolean;
  readonly canDeleteImmediately: boolean;
  readonly retentionPolicyReference: string;
  readonly externalTransfer: true;
  readonly estimatedCreditPerPage?: number;
}

export interface OmrProviderPreflight {
  readonly capabilities: OmrVendorCapabilities;
  readonly capabilitySnapshotDigest: SemanticDigest;
}

export type VendorExportTargetSelector = MusicXmlSourceTargetSelector;

export interface VendorExportEvidenceMapping {
  readonly vendorTargetId: string;
  readonly target: VendorExportTargetSelector;
}

export interface VendorNormalizationMappingArtifact {
  readonly version: "vendor-export-target-map-v2";
  readonly vendorResultDigest: BinaryDigest;
  readonly providerBundleDigest: SemanticDigest;
  readonly mappings: readonly VendorExportEvidenceMapping[];
  readonly artifactDigest: SemanticDigest;
}

export async function computeVendorNormalizationMappingDigest(
  artifact: Omit<VendorNormalizationMappingArtifact, "artifactDigest">,
): Promise<SemanticDigest> {
  return semanticDigest({
    projectionSchema: "hm-vendor-export-target-map-v2",
    version: artifact.version,
    vendorResultDigest: artifact.vendorResultDigest,
    providerBundleDigest: artifact.providerBundleDigest,
    mappings: [...artifact.mappings].sort(compareCanonicalValues),
  });
}

export async function validateVendorNormalizationMappingArtifact(artifact: VendorNormalizationMappingArtifact): Promise<void> {
  if (!isPlainRecord(artifact) || !hasExactKeys(artifact, ["version", "vendorResultDigest", "providerBundleDigest", "mappings", "artifactDigest"])
    || artifact.version !== "vendor-export-target-map-v2" || !/^[0-9a-f]{64}$/u.test(artifact.vendorResultDigest)
    || !/^[0-9a-f]{64}$/u.test(artifact.providerBundleDigest) || !Array.isArray(artifact.mappings)) throw new RangeError("OMR_EVIDENCE_TARGET_UNMAPPED");
  const vendorTargetIds = artifact.mappings.map((mapping) => mapping.vendorTargetId);
  if (new Set(vendorTargetIds).size !== vendorTargetIds.length || artifact.mappings.some((mapping) => {
    if (!isPlainRecord(mapping) || !hasExactKeys(mapping, ["vendorTargetId", "target"]) || !isPlainRecord(mapping.target)
      || typeof mapping.vendorTargetId !== "string" || mapping.vendorTargetId.length === 0 || mapping.vendorTargetId.length > 256
      || typeof mapping.target.musicXmlPartOrdinal !== "number" || !Number.isSafeInteger(mapping.target.musicXmlPartOrdinal) || mapping.target.musicXmlPartOrdinal < 0
      || typeof mapping.target.measureOrdinal !== "number" || !Number.isSafeInteger(mapping.target.measureOrdinal) || mapping.target.measureOrdinal < 0) return true;
    if (mapping.target.kind === "voice-event") return !hasExactKeys(mapping.target, ["kind", "musicXmlPartOrdinal", "musicXmlStaffNumber", "musicXmlVoiceKey", "measureOrdinal", "eventOrdinal"])
      || typeof mapping.target.musicXmlStaffNumber !== "number" || !Number.isSafeInteger(mapping.target.musicXmlStaffNumber)
      || mapping.target.musicXmlStaffNumber < 1 || typeof mapping.target.musicXmlVoiceKey !== "string"
      || mapping.target.musicXmlVoiceKey.length === 0 || mapping.target.musicXmlVoiceKey.length > 128
      || typeof mapping.target.eventOrdinal !== "number" || !Number.isSafeInteger(mapping.target.eventOrdinal) || mapping.target.eventOrdinal < 0;
    if (mapping.target.kind === "chord-event" || mapping.target.kind === "section-text") return !hasExactKeys(mapping.target, ["kind", "musicXmlPartOrdinal", "measureOrdinal", "eventOrdinal"])
      || typeof mapping.target.eventOrdinal !== "number" || !Number.isSafeInteger(mapping.target.eventOrdinal) || mapping.target.eventOrdinal < 0;
    return !["measure", "measure-start", "measure-end"].includes(String(mapping.target.kind))
      || !hasExactKeys(mapping.target, ["kind", "musicXmlPartOrdinal", "measureOrdinal"]);
  })) throw new RangeError("OMR_EVIDENCE_TARGET_UNMAPPED");
  if (await computeVendorNormalizationMappingDigest({ version: artifact.version, vendorResultDigest: artifact.vendorResultDigest, providerBundleDigest: artifact.providerBundleDigest, mappings: artifact.mappings }) !== artifact.artifactDigest) throw new RangeError("OMR_EVIDENCE_TARGET_UNMAPPED");
}

export class OmrVendorCallError extends Error {
  constructor(
    message: string,
    readonly outcome: "definitive-rejection" | "outcome-uncertain",
  ) { super(message); this.name = "OmrVendorCallError"; }
}

export function vendorCallOutcome(error: unknown): OmrVendorCallError["outcome"] {
  return error instanceof OmrVendorCallError ? error.outcome : "outcome-uncertain";
}

export type VendorInputRequest =
  | { readonly kind: "select-instrument"; readonly requestId: string; readonly choices: readonly string[] }
  | { readonly kind: "confirm-page-order"; readonly requestId: string; readonly pageIndices: readonly number[] }
  | { readonly kind: "vendor-specific"; readonly requestId: string; readonly schemaId: string; readonly payload: Readonly<Record<string, string | number | boolean>> };

export type VendorInputResponse =
  | { readonly kind: "select-instrument"; readonly requestId: string; readonly choice: string }
  | { readonly kind: "confirm-page-order"; readonly requestId: string; readonly pageIndices: readonly number[] }
  | { readonly kind: "vendor-specific"; readonly requestId: string; readonly schemaId: string; readonly payload: Readonly<Record<string, string | number | boolean>> };

export const VENDOR_INPUT_REQUEST_LIMITS = Object.freeze({
  requestIdLength: 128,
  choices: 64,
  choiceLength: 128,
  schemaIdLength: 128,
  payloadEntries: 32,
  payloadKeyLength: 128,
  payloadStringLength: 4_096,
  payloadBytes: 8_192,
});

function boundedVendorRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
    && value.length <= VENDOR_INPUT_REQUEST_LIMITS.requestIdLength
    && new TextEncoder().encode(value).byteLength <= VENDOR_INPUT_REQUEST_LIMITS.requestIdLength;
}

function boundedUtf8(value: unknown, maxBytes: number, allowEmpty = false): value is string {
  return typeof value === "string" && (allowEmpty || value.length > 0)
    && value.length <= maxBytes && new TextEncoder().encode(value).byteLength <= maxBytes;
}

/** Runtime codec for untrusted provider status payloads. */
export function validateVendorInputRequest(value: unknown, pageCount: number): VendorInputRequest {
  if (!isPlainRecord(value) || !boundedVendorRequestId(value.requestId)
    || !Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
  }
  if (value.kind === "select-instrument") {
    if (!hasExactKeys(value, ["kind", "requestId", "choices"])
      || !Array.isArray(value.choices) || value.choices.length < 1
      || value.choices.length > VENDOR_INPUT_REQUEST_LIMITS.choices
      || value.choices.some((choice) => !boundedUtf8(choice, VENDOR_INPUT_REQUEST_LIMITS.choiceLength))
      || new Set(value.choices).size !== value.choices.length) {
      throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
    }
    return { kind: value.kind, requestId: value.requestId, choices: [...value.choices] as string[] };
  }
  if (value.kind === "confirm-page-order") {
    if (!hasExactKeys(value, ["kind", "requestId", "pageIndices"])
      || !Array.isArray(value.pageIndices) || value.pageIndices.length !== pageCount
      || value.pageIndices.some((pageIndex) => !Number.isSafeInteger(pageIndex)
        || Number(pageIndex) < 0 || Number(pageIndex) >= pageCount)
      || new Set(value.pageIndices).size !== pageCount) {
      throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
    }
    return { kind: value.kind, requestId: value.requestId, pageIndices: [...value.pageIndices] as number[] };
  }
  if (value.kind === "vendor-specific") {
    if (!hasExactKeys(value, ["kind", "requestId", "schemaId", "payload"])
      || !boundedUtf8(value.schemaId, VENDOR_INPUT_REQUEST_LIMITS.schemaIdLength)
      || !isPlainRecord(value.payload)) throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
    const entries = Object.entries(value.payload);
    if (entries.length > VENDOR_INPUT_REQUEST_LIMITS.payloadEntries
      || entries.some(([key, item]) => !boundedUtf8(key, VENDOR_INPUT_REQUEST_LIMITS.payloadKeyLength)
        || !["string", "number", "boolean"].includes(typeof item)
        || (typeof item === "string" && !boundedUtf8(item, VENDOR_INPUT_REQUEST_LIMITS.payloadStringLength, true))
        || (typeof item === "number" && !Number.isSafeInteger(item)))
      || new TextEncoder().encode(JSON.stringify(value.payload)).byteLength > VENDOR_INPUT_REQUEST_LIMITS.payloadBytes) {
      throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
    }
    return {
      kind: value.kind,
      requestId: value.requestId,
      schemaId: value.schemaId,
      payload: structuredClone(value.payload) as Readonly<Record<string, string | number | boolean>>,
    };
  }
  throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
}

export type VendorOmrStatus =
  | { readonly kind: "created" }
  | { readonly kind: "queued" }
  | { readonly kind: "processing"; readonly progressBp?: BasisPoints }
  | { readonly kind: "needs-input"; readonly request: VendorInputRequest }
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly code: string; readonly message: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "unknown"; readonly rawStatus: string };

export type VendorJobId = string & { readonly __brand: "VendorJobId" };

export interface OmrPageUpload {
  readonly pageIndex: number;
  readonly pageDigest: BinaryDigest;
  readonly mimeType: string;
  readonly idempotencyKey: string;
  readonly bytes: Blob;
}

export interface RetentionInfo {
  readonly vendorDeletesAt?: string;
  readonly canDeleteImmediately: boolean;
  readonly policyReference?: string;
}

export type VendorDeleteResult =
  | { readonly status: "deleted" }
  | { readonly status: "not-supported"; readonly retentionInfo: RetentionInfo }
  | { readonly status: "failed"; readonly code: string; readonly message: string };

export type OmrDeleteResult = {
  readonly localHandleDeleted: boolean;
  readonly vendor: VendorDeleteResult;
} & (
  | { readonly cleanupState: "resolved" }
  | { readonly cleanupState: "pending"; readonly nextAttemptAt?: string }
);

export interface OmrVendorAdapter {
  getCapabilities(): Promise<OmrVendorCapabilities>;
  createVendorJob(request: { readonly pageCount: number; readonly idempotencyKey: string }): Promise<VendorJobId>;
  uploadPage(vendorJobId: VendorJobId, page: OmrPageUpload): Promise<void>;
  startVendorJob(vendorJobId: VendorJobId, operation: { readonly idempotencyKey: string }): Promise<void>;
  getVendorStatus(vendorJobId: VendorJobId): Promise<VendorOmrStatus>;
  submitVendorInput?(vendorJobId: VendorJobId, input: VendorInputResponse, operation: { readonly idempotencyKey: string }): Promise<void>;
  exportMusicXml(vendorJobId: VendorJobId): Promise<string>;
  getEvidence(vendorJobId: VendorJobId): Promise<VendorEvidenceBundle>;
  getNormalizationMapping(vendorJobId: VendorJobId): Promise<VendorNormalizationMappingArtifact>;
  cancelVendorJob(vendorJobId: VendorJobId, operation: { readonly idempotencyKey: string }): Promise<void>;
  deleteVendorJob(vendorJobId: VendorJobId, operation: { readonly idempotencyKey: string }): Promise<VendorDeleteResult>;
  getRetentionInfo(vendorJobId: VendorJobId): Promise<RetentionInfo>;
}

export type OmrJobHandle = string & { readonly __brand: "OmrJobHandle" };

export interface CanonicalOmrCreatePage {
  readonly pageIndex: number;
  readonly pageDigest: BinaryDigest;
  readonly mimeType: "image/png" | "image/jpeg";
}

export interface CanonicalOmrCreateRequest {
  readonly pageCount: number;
  readonly pages: readonly CanonicalOmrCreatePage[];
  readonly sourceKind: Exclude<InputSourceKind, "musicxml" | "mxl">;
  readonly rights: RightsMetadata;
  readonly providerTransferConsent: true;
  readonly consentCapabilitySnapshotDigest: SemanticDigest;
  readonly idempotencyKey: string;
}

export interface OmrProviderResult {
  readonly vendorId: string;
  readonly vendorResultDigest: BinaryDigest;
  readonly rawMusicXml: string;
  readonly evidence: VendorEvidenceBundle;
  readonly normalizationMapping: VendorNormalizationMappingArtifact;
  readonly retentionInfo: RetentionInfo;
}

export type OmrPublicStatus =
  | { readonly kind: "created" }
  | { readonly kind: "uploading"; readonly uploadedPages: number; readonly totalPages: number }
  | { readonly kind: "queued" }
  | { readonly kind: "processing"; readonly progressBp?: BasisPoints }
  | { readonly kind: "needs-input"; readonly inputRequest: VendorInputRequest }
  | { readonly kind: "completed" }
  | { readonly kind: "failed"; readonly code: string; readonly messageKo: string }
  | { readonly kind: "cancel-pending"; readonly messageKo: string }
  | { readonly kind: "cancel-failed"; readonly code: string; readonly messageKo: string }
  | { readonly kind: "reconciliation-required"; readonly code: string; readonly messageKo: string }
  | { readonly kind: "retry-pending"; readonly operation: "sync" | "capture"; readonly attempt: number; readonly nextAttemptAt: string; readonly messageKo: string }
  | { readonly kind: "cancelled" };

export interface OmrApplicationService {
  getProviderPreflight(): Promise<OmrProviderPreflight>;
  createJob(request: {
    readonly sessionId: string;
    readonly pageCount: number;
    readonly pages: readonly CanonicalOmrCreatePage[];
    readonly sourceKind: Exclude<InputSourceKind, "musicxml" | "mxl">;
    readonly rights: RightsMetadata;
    readonly providerTransferConsent: true;
    readonly consentCapabilitySnapshotDigest: SemanticDigest;
    readonly idempotencyKey: string;
  }): Promise<OmrJobHandle>;
  uploadPage(handle: OmrJobHandle, page: OmrPageUpload): Promise<void>;
  start(handle: OmrJobHandle): Promise<void>;
  getStatus(handle: OmrJobHandle): Promise<OmrPublicStatus>;
  synchronizeStatus(handle: OmrJobHandle): Promise<OmrPublicStatus>;
  preflightPage(page: Pick<OmrPageUpload, "pageIndex" | "pageDigest" | "mimeType" | "bytes">): Promise<{ readonly digest: BinaryDigest; readonly width: number; readonly height: number; readonly quality: import("./image-quality").ImageQualityReport }>;
  submitInput(handle: OmrJobHandle, input: VendorInputResponse): Promise<void>;
  exportResult(handle: OmrJobHandle): Promise<OmrProviderResult>;
  cancel(handle: OmrJobHandle): Promise<void>;
  delete(handle: OmrJobHandle): Promise<OmrDeleteResult>;
}

export interface OmrQuotaConfig {
  readonly maxPagesPerJob: number;
  readonly maxConcurrentJobsPerSession: number;
  readonly maxConcurrentJobsPerIp: number;
  readonly maxJobsPerSessionPerHour: number;
  readonly maxJobsPerIpPerHour: number;
  readonly maxRetriesPerPage: number;
  readonly dailyGlobalCreditCeiling: number;
}

export const CORE_OMR_QUOTA_DEFAULTS = Object.freeze({
  maxPagesPerJob: 12,
  maxConcurrentJobsPerSession: 1,
  maxConcurrentJobsPerIp: 2,
  maxJobsPerSessionPerHour: 3,
  maxJobsPerIpPerHour: 5,
  maxRetriesPerPage: 2,
} as const);

export const OMR_VENDOR_ADAPTER_CONTRACT_VERSION = "omr-vendor-adapter-v1" as const;
export const OMR_VENDOR_CREATE_DEFINITIVE_REJECTION = "OMR_VENDOR_CREATE_DEFINITIVE_REJECTION" as const;
export const MAX_OMR_CREDIT_ESTIMATE = 2_147_483_647;
export const MAX_OMR_DAILY_CREDIT_CEILING = Number.MAX_SAFE_INTEGER;
export const MAX_OMR_CREDIT_AGGREGATE = Number.MAX_SAFE_INTEGER;

export function canonicalizeVendorCapabilities(capabilities: OmrVendorCapabilities): OmrVendorCapabilities {
  return { ...capabilities, supportedMimeTypes: [...new Set(capabilities.supportedMimeTypes)].sort() };
}

export function validateVendorCapabilities(capabilities: OmrVendorCapabilities): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/u.test(capabilities.vendorId)
    || typeof capabilities.vendorDisplayName !== "string" || capabilities.vendorDisplayName.trim().length === 0 || capabilities.vendorDisplayName.length > 128
    || !Number.isSafeInteger(capabilities.maxPages) || capabilities.maxPages < 1
    || capabilities.evidenceGranularity === "none"
    || !capabilities.retentionDisclosure
    || capabilities.externalTransfer !== true
    || typeof capabilities.canDeleteImmediately !== "boolean"
    || (capabilities.canDeleteImmediately && !capabilities.supportsDeletion)
    || typeof capabilities.retentionPolicyReference !== "string" || capabilities.retentionPolicyReference.trim().length === 0 || capabilities.retentionPolicyReference.length > 512
    || capabilities.supportedMimeTypes.length === 0
    || capabilities.transferMimeType !== "image/png"
    || !capabilities.supportedMimeTypes.includes(capabilities.transferMimeType)
    || new Set(capabilities.supportedMimeTypes).size !== capabilities.supportedMimeTypes.length
    || (capabilities.estimatedCreditPerPage !== undefined
      && (!Number.isSafeInteger(capabilities.estimatedCreditPerPage) || capabilities.estimatedCreditPerPage <= 0
        || capabilities.estimatedCreditPerPage > MAX_OMR_CREDIT_ESTIMATE))) {
    throw new RangeError("OMR_PROVIDER_CAPABILITY_MISSING");
  }
}
