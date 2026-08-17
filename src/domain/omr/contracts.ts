import type { BinaryDigest } from "../digest/canonical";
import type { RightsMetadata } from "../source/model";
import type { BasisPoints } from "../rates";
import type { EvidenceGranularity, VendorEvidenceBundle } from "./foundation";
import type { InputSourceKind } from "./input";

export interface OmrVendorCapabilities {
  readonly vendorId: string;
  readonly supportedMimeTypes: readonly string[];
  readonly maxPages: number;
  readonly evidenceGranularity: EvidenceGranularity;
  readonly supportsDeletion: boolean;
  readonly retentionDisclosure: boolean;
  readonly supportsIdempotency: boolean;
  readonly supportsInteractiveInput: boolean;
  readonly estimatedCreditPerPage?: number;
}

export type VendorInputRequest =
  | { readonly kind: "select-instrument"; readonly requestId: string; readonly choices: readonly string[] }
  | { readonly kind: "confirm-page-order"; readonly requestId: string; readonly pageIndices: readonly number[] }
  | { readonly kind: "vendor-specific"; readonly requestId: string; readonly schemaId: string; readonly payload: Readonly<Record<string, string | number | boolean>> };

export type VendorInputResponse =
  | { readonly kind: "select-instrument"; readonly requestId: string; readonly choice: string }
  | { readonly kind: "confirm-page-order"; readonly requestId: string; readonly pageIndices: readonly number[] }
  | { readonly kind: "vendor-specific"; readonly requestId: string; readonly schemaId: string; readonly payload: Readonly<Record<string, string | number | boolean>> };

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
};

export interface OmrVendorAdapter {
  getCapabilities(): Promise<OmrVendorCapabilities>;
  createVendorJob(request: { readonly pageCount: number; readonly idempotencyKey: string }): Promise<VendorJobId>;
  uploadPage(vendorJobId: VendorJobId, page: OmrPageUpload): Promise<void>;
  startVendorJob(vendorJobId: VendorJobId): Promise<void>;
  getVendorStatus(vendorJobId: VendorJobId): Promise<VendorOmrStatus>;
  submitVendorInput?(vendorJobId: VendorJobId, input: VendorInputResponse): Promise<void>;
  exportMusicXml(vendorJobId: VendorJobId): Promise<string>;
  getEvidence(vendorJobId: VendorJobId): Promise<VendorEvidenceBundle>;
  cancelVendorJob(vendorJobId: VendorJobId): Promise<void>;
  deleteVendorJob(vendorJobId: VendorJobId): Promise<VendorDeleteResult>;
  getRetentionInfo(vendorJobId: VendorJobId): Promise<RetentionInfo>;
}

export type OmrJobHandle = string & { readonly __brand: "OmrJobHandle" };

export interface OmrProviderResult {
  readonly vendorId: string;
  readonly vendorResultDigest: BinaryDigest;
  readonly rawMusicXml: string;
  readonly evidence: VendorEvidenceBundle;
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
  | { readonly kind: "cancelled" };

export interface OmrApplicationService {
  createJob(request: {
    readonly sessionId: string;
    readonly pageCount: number;
    readonly sourceKind: Exclude<InputSourceKind, "musicxml" | "mxl">;
    readonly rights: RightsMetadata;
    readonly providerTransferConsent: true;
    readonly idempotencyKey: string;
  }): Promise<OmrJobHandle>;
  uploadPage(handle: OmrJobHandle, page: OmrPageUpload): Promise<void>;
  start(handle: OmrJobHandle): Promise<void>;
  getStatus(handle: OmrJobHandle): Promise<OmrPublicStatus>;
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

export function validateVendorCapabilities(capabilities: OmrVendorCapabilities): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/u.test(capabilities.vendorId)
    || !Number.isSafeInteger(capabilities.maxPages) || capabilities.maxPages < 1
    || capabilities.evidenceGranularity === "none"
    || !capabilities.retentionDisclosure
    || capabilities.supportedMimeTypes.length === 0
    || new Set(capabilities.supportedMimeTypes).size !== capabilities.supportedMimeTypes.length
    || (capabilities.estimatedCreditPerPage !== undefined
      && (!Number.isSafeInteger(capabilities.estimatedCreditPerPage) || capabilities.estimatedCreditPerPage <= 0))) {
    throw new RangeError("OMR_PROVIDER_CAPABILITY_MISSING");
  }
}
