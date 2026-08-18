import "server-only";

import { binaryDigest, type BinaryDigest } from "../../domain/digest/canonical";
import { computeProviderBundleDigest, type VendorEvidenceBundle } from "../../domain/omr/foundation";
import type {
  OmrPageUpload, OmrVendorAdapter, OmrVendorCapabilities, RetentionInfo,
  VendorDeleteResult, VendorExportEvidenceMapping, VendorInputResponse, VendorJobId, VendorNormalizationMappingArtifact, VendorOmrStatus,
} from "../../domain/omr/contracts";
import { computeVendorNormalizationMappingDigest } from "../../domain/omr/contracts";

export interface ReferenceOmrFixture {
  readonly id: string;
  readonly orderedPageDigests: readonly BinaryDigest[];
  readonly statusScript: readonly VendorOmrStatus[];
  readonly musicXml: string;
  readonly evidence: Omit<VendorEvidenceBundle, "providerBundleDigest"> | VendorEvidenceBundle;
  readonly normalizationMappings?: readonly VendorExportEvidenceMapping[];
  readonly retentionInfo: RetentionInfo;
  readonly deleteResult?: VendorDeleteResult;
}

interface ReferenceJob {
  readonly id: VendorJobId;
  readonly pageCount: number;
  readonly pages: Map<number, { readonly digest: BinaryDigest; readonly key: string }>;
  readonly operationKeys: Map<"start" | "input" | "cancel", string>;
  fixture?: ReferenceOmrFixture;
  statusIndex: number;
  started: boolean;
  cancelled: boolean;
  deleted: boolean;
  input?: VendorInputResponse;
}

export class ReferenceOmrVendorAdapter implements OmrVendorAdapter {
  readonly callCounts = { create: 0, upload: 0, start: 0, status: 0, input: 0, export: 0, evidence: 0, mapping: 0, cancel: 0, delete: 0, retention: 0 };
  private sequence = 0;
  private readonly jobs = new Map<VendorJobId, ReferenceJob>();
  private readonly createIdempotency = new Map<string, VendorJobId>();
  private readonly fixtures: readonly ReferenceOmrFixture[];
  private readonly capabilities: OmrVendorCapabilities;

  constructor(fixtures: readonly ReferenceOmrFixture[], capabilities: Partial<OmrVendorCapabilities> = {}) {
    const supportsDeletion = capabilities.supportsDeletion ?? true;
    this.capabilities = {
    vendorId: "hm-reference", vendorDisplayName: "HarmonyMaker deterministic reference adapter", supportedMimeTypes: ["image/png"], transferMimeType: "image/png", maxPages: 12,
    evidenceGranularity: "page", retentionDisclosure: true,
    supportsIdempotency: true, supportsInteractiveInput: true,
    retentionPolicyReference: "in-repository-reference-fixture", externalTransfer: true, estimatedCreditPerPage: 1,
    ...capabilities,
    supportsDeletion,
    canDeleteImmediately: capabilities.canDeleteImmediately ?? supportsDeletion,
    };
    this.fixtures = fixtures.map((fixture) => ({ ...fixture, orderedPageDigests: [...fixture.orderedPageDigests], statusScript: [...fixture.statusScript] }));
  }

  async getCapabilities(): Promise<OmrVendorCapabilities> { return { ...this.capabilities, supportedMimeTypes: [...this.capabilities.supportedMimeTypes] }; }

  async createVendorJob(request: { readonly pageCount: number; readonly idempotencyKey: string }): Promise<VendorJobId> {
    const replay = this.createIdempotency.get(request.idempotencyKey);
    if (replay) return replay;
    this.callCounts.create += 1;
    this.sequence += 1;
    const id = `reference-job:${this.sequence}` as VendorJobId;
    this.jobs.set(id, { id, pageCount: request.pageCount, pages: new Map(), operationKeys: new Map(), statusIndex: 0, started: false, cancelled: false, deleted: false });
    this.createIdempotency.set(request.idempotencyKey, id);
    return id;
  }

  private job(id: VendorJobId): ReferenceJob {
    const job = this.jobs.get(id);
    if (!job || job.deleted) throw new RangeError("REFERENCE_JOB_UNAVAILABLE");
    return job;
  }

  async uploadPage(vendorJobId: VendorJobId, page: OmrPageUpload): Promise<void> {
    const job = this.job(vendorJobId);
    const prior = job.pages.get(page.pageIndex);
    if (prior) {
      if (prior.digest === page.pageDigest && prior.key === page.idempotencyKey) return;
      throw new RangeError("OMR_PAGE_UPLOAD_CONFLICT");
    }
    if (page.pageIndex < 0 || page.pageIndex >= job.pageCount) throw new RangeError("OMR_PAGE_INDEX_INVALID");
    this.callCounts.upload += 1;
    job.pages.set(page.pageIndex, { digest: page.pageDigest, key: page.idempotencyKey });
  }

  async startVendorJob(vendorJobId: VendorJobId, operation: { readonly idempotencyKey: string }): Promise<void> {
    const job = this.job(vendorJobId);
    const prior = job.operationKeys.get("start");
    if (prior) { if (prior !== operation.idempotencyKey) throw new RangeError("OMR_REFERENCE_IDEMPOTENCY_CONFLICT"); return; }
    if (job.pages.size !== job.pageCount) throw new RangeError("OMR_PAGES_INCOMPLETE");
    const ordered = Array.from({ length: job.pageCount }, (_, index) => job.pages.get(index)?.digest);
    job.fixture = this.fixtures.find((fixture) => fixture.orderedPageDigests.every((digest, index) => digest === ordered[index]));
    if (!job.fixture) throw new RangeError("OMR_REFERENCE_FIXTURE_UNSUPPORTED");
    job.operationKeys.set("start", operation.idempotencyKey);
    this.callCounts.start += 1;
    job.started = true;
  }

  async getVendorStatus(vendorJobId: VendorJobId): Promise<VendorOmrStatus> {
    const job = this.job(vendorJobId);
    this.callCounts.status += 1;
    if (job.cancelled) return { kind: "cancelled" };
    if (!job.started) return { kind: "created" };
    const script = job.fixture?.statusScript ?? [{ kind: "failed", code: "FIXTURE_MISSING", message: "fixture missing" } as const];
    const status = script[Math.min(job.statusIndex, script.length - 1)];
    if (status.kind !== "needs-input" || job.input) job.statusIndex = Math.min(job.statusIndex + 1, script.length - 1);
    return structuredClone(status);
  }

  async submitVendorInput(vendorJobId: VendorJobId, input: VendorInputResponse, operation: { readonly idempotencyKey: string }): Promise<void> {
    const job = this.job(vendorJobId);
    const prior = job.operationKeys.get("input");
    if (prior) { if (prior !== operation.idempotencyKey) throw new RangeError("OMR_REFERENCE_IDEMPOTENCY_CONFLICT"); return; }
    const status = job.fixture?.statusScript[Math.min(job.statusIndex, (job.fixture?.statusScript.length ?? 1) - 1)];
    if (status?.kind !== "needs-input" || status.request.requestId !== input.requestId || status.request.kind !== input.kind) throw new RangeError("OMR_VENDOR_INPUT_INVALID");
    if (job.input) {
      if (JSON.stringify(job.input) === JSON.stringify(input)) return;
      throw new RangeError("OMR_VENDOR_INPUT_CONFLICT");
    }
    job.operationKeys.set("input", operation.idempotencyKey);
    this.callCounts.input += 1;
    job.input = structuredClone(input);
    job.statusIndex = Math.min(job.statusIndex + 1, (job.fixture?.statusScript.length ?? 1) - 1);
  }

  async exportMusicXml(vendorJobId: VendorJobId): Promise<string> {
    this.callCounts.export += 1;
    const job = this.job(vendorJobId);
    if (!job.fixture) throw new RangeError("OMR_REFERENCE_FIXTURE_UNSUPPORTED");
    return job.fixture.musicXml;
  }

  async getEvidence(vendorJobId: VendorJobId): Promise<VendorEvidenceBundle> {
    this.callCounts.evidence += 1;
    const job = this.job(vendorJobId);
    if (!job.fixture) throw new RangeError("OMR_REFERENCE_FIXTURE_UNSUPPORTED");
    const evidence = job.fixture.evidence;
    const providerBundleDigest = "providerBundleDigest" in evidence
      ? evidence.providerBundleDigest
      : await computeProviderBundleDigest(evidence);
    return structuredClone({ ...evidence, providerBundleDigest } as VendorEvidenceBundle);
  }

  async getNormalizationMapping(vendorJobId: VendorJobId): Promise<VendorNormalizationMappingArtifact> {
    this.callCounts.mapping += 1;
    const job = this.job(vendorJobId);
    if (!job.fixture) throw new RangeError("OMR_REFERENCE_FIXTURE_UNSUPPORTED");
    const evidence = job.fixture.evidence;
    const providerBundleDigest = "providerBundleDigest" in evidence ? evidence.providerBundleDigest : await computeProviderBundleDigest(evidence);
    const artifact = { version: "vendor-export-target-map-v2" as const, vendorResultDigest: await binaryDigest(new TextEncoder().encode(job.fixture.musicXml)), providerBundleDigest, mappings: job.fixture.normalizationMappings ?? [] };
    return structuredClone({ ...artifact, artifactDigest: await computeVendorNormalizationMappingDigest(artifact) });
  }

  async cancelVendorJob(vendorJobId: VendorJobId, operation: { readonly idempotencyKey: string }): Promise<void> {
    const job = this.job(vendorJobId);
    const prior = job.operationKeys.get("cancel");
    if (prior) { if (prior !== operation.idempotencyKey) throw new RangeError("OMR_REFERENCE_IDEMPOTENCY_CONFLICT"); return; }
    job.operationKeys.set("cancel", operation.idempotencyKey); this.callCounts.cancel += 1; job.cancelled = true;
  }

  async deleteVendorJob(vendorJobId: VendorJobId, operation: { readonly idempotencyKey: string }): Promise<VendorDeleteResult> {
    if (!operation.idempotencyKey) throw new RangeError("OMR_REFERENCE_IDEMPOTENCY_KEY_REQUIRED");
    const job = this.job(vendorJobId);
    this.callCounts.delete += 1;
    const result = job.fixture?.deleteResult ?? (this.capabilities.supportsDeletion
      ? { status: "deleted" as const }
      : { status: "not-supported" as const, retentionInfo: await this.getRetentionInfo(vendorJobId) });
    if (result.status === "deleted") job.deleted = true;
    return structuredClone(result);
  }

  async getRetentionInfo(vendorJobId: VendorJobId): Promise<RetentionInfo> {
    this.callCounts.retention += 1;
    const job = this.job(vendorJobId);
    const retention = job.fixture?.retentionInfo ?? { canDeleteImmediately: this.capabilities.supportsDeletion, policyReference: "reference-fixture-only" };
    return structuredClone({ ...retention, canDeleteImmediately: retention.canDeleteImmediately && this.capabilities.supportsDeletion });
  }
}
