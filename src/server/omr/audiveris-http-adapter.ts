import "server-only";

import { binaryDigest, type BinaryDigest } from "../../domain/digest/canonical";
import {
  computeVendorNormalizationMappingDigest,
  OmrVendorCallError,
  validateVendorCapabilities,
  type OmrPageUpload,
  type OmrVendorAdapter,
  type OmrVendorCapabilities,
  type RetentionInfo,
  type VendorDeleteResult,
  type VendorJobId,
  type VendorNormalizationMappingArtifact,
  type VendorOmrStatus,
} from "../../domain/omr/contracts";
import {
  computeProviderBundleDigest,
  EVIDENCE_COORDINATE_SCALE,
  type CoordinateMicrounit,
  type VendorEvidenceBundle,
} from "../../domain/omr/foundation";
import { hasExactKeys, isPlainRecord } from "../../domain/validation";

export interface AudiverisHttpAdapterConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly requestTimeoutMs: number;
}

type HttpPolicy = "read" | "mutating";

interface AudiverisPageMetadata {
  readonly pageIndex: number;
  readonly pageDigest: BinaryDigest;
  readonly widthPixels: number;
  readonly heightPixels: number;
}

const MAX_JSON_BYTES = 64 * 1024;
const MAX_ERROR_BYTES = 4 * 1024;
const MAX_MUSICXML_BYTES = 4 * 1024 * 1024;

function canonicalBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new RangeError("OMR_AUDIVERIS_BASE_URL_INVALID");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  return parsed.toString().replace(/\/$/u, "");
}

function safeMessage(value: unknown): string {
  if (isPlainRecord(value) && typeof value.detail === "string") return value.detail.slice(0, 512);
  if (isPlainRecord(value) && typeof value.message === "string") return value.message.slice(0, 512);
  return "Audiveris provider request failed";
}

function isLowerHexDigest(value: unknown): value is BinaryDigest {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function integer(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

export class AudiverisHttpOmrAdapter implements OmrVendorAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly musicXmlCache = new Map<VendorJobId, Promise<string>>();
  private readonly metadataCache = new Map<VendorJobId, Promise<readonly AudiverisPageMetadata[]>>();

  constructor(config: AudiverisHttpAdapterConfig) {
    this.baseUrl = canonicalBaseUrl(config.baseUrl);
    if (config.apiKey.length < 32 || config.apiKey.length > 512) throw new RangeError("OMR_AUDIVERIS_API_KEY_INVALID");
    if (!Number.isSafeInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1_000 || config.requestTimeoutMs > 300_000) {
      throw new RangeError("OMR_AUDIVERIS_TIMEOUT_INVALID");
    }
    this.apiKey = config.apiKey;
    this.timeoutMs = config.requestTimeoutMs;
  }

  private memoize<T>(
    cache: Map<VendorJobId, Promise<T>>,
    vendorJobId: VendorJobId,
    loader: () => Promise<T>,
  ): Promise<T> {
    const current = cache.get(vendorJobId);
    if (current) return current;
    const pending = loader();
    cache.set(vendorJobId, pending);
    void pending.catch(() => {
      if (cache.get(vendorJobId) === pending) cache.delete(vendorJobId);
    });
    return pending;
  }

  private clearCaptureCache(vendorJobId: VendorJobId): void {
    this.musicXmlCache.delete(vendorJobId);
    this.metadataCache.delete(vendorJobId);
  }

  private async request(path: string, init: RequestInit, policy: HttpPolicy): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("provider request timed out")), this.timeoutMs);
    try {
      let response: Response;
      try {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${this.apiKey}`);
        response = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          cache: "no-store",
          signal: controller.signal,
          headers,
        });
      } catch (error) {
        if (policy === "mutating") {
          throw new OmrVendorCallError(error instanceof Error ? error.message : "provider transport failed", "outcome-uncertain");
        }
        throw error;
      }
      if (response.ok) return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const decoded = bytes.byteLength <= MAX_ERROR_BYTES
        ? (() => {
            try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
            catch { return undefined; }
          })()
        : undefined;
      const message = `${response.status}:${safeMessage(decoded)}`;
      if (policy === "mutating") {
        const outcome = response.status >= 500 || [408, 425, 429].includes(response.status)
          ? "outcome-uncertain"
          : "definitive-rejection";
        throw new OmrVendorCallError(message, outcome);
      }
      if (response.status >= 400 && response.status < 500) throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async json(path: string, init: RequestInit = {}, policy: HttpPolicy = "read"): Promise<unknown> {
    const response = await this.request(path, init, policy);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_JSON_BYTES) throw new RangeError("OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED");
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch (error) {
      throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID", { cause: error });
    }
  }

  async getCapabilities(): Promise<OmrVendorCapabilities> {
    const value = await this.json("/v1/capabilities");
    if (!isPlainRecord(value) || !hasExactKeys(value, [
      "vendorId", "vendorDisplayName", "supportedMimeTypes", "transferMimeType", "maxPages", "evidenceGranularity",
      "supportsDeletion", "retentionDisclosure", "supportsIdempotency", "supportsInteractiveInput", "canDeleteImmediately",
      "retentionPolicyReference", "externalTransfer", "estimatedCreditPerPage",
    ]) || !Array.isArray(value.supportedMimeTypes)) throw new RangeError("OMR_PROVIDER_CAPABILITY_MISSING");
    const capabilities = structuredClone(value) as unknown as OmrVendorCapabilities;
    validateVendorCapabilities(capabilities);
    if (capabilities.vendorId !== "audiveris" || capabilities.supportsInteractiveInput) {
      throw new RangeError("OMR_PROVIDER_CAPABILITY_MISSING");
    }
    return capabilities;
  }

  async createVendorJob(request: { readonly pageCount: number; readonly idempotencyKey: string }): Promise<VendorJobId> {
    const value = await this.json("/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }, "mutating");
    if (!isPlainRecord(value) || !hasExactKeys(value, ["jobId"])
      || typeof value.jobId !== "string" || !/^[0-9a-f-]{36}$/u.test(value.jobId)) {
      throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
    }
    return value.jobId as VendorJobId;
  }

  async uploadPage(vendorJobId: VendorJobId, page: OmrPageUpload): Promise<void> {
    await this.request(`/v1/jobs/${encodeURIComponent(vendorJobId)}/pages/${page.pageIndex}`, {
      method: "PUT",
      headers: {
        "Content-Type": "image/png",
        "Idempotency-Key": page.idempotencyKey,
        "X-Page-Digest": page.pageDigest,
      },
      body: page.bytes,
    }, "mutating");
  }

  async startVendorJob(vendorJobId: VendorJobId, operation: { readonly idempotencyKey: string }): Promise<void> {
    this.clearCaptureCache(vendorJobId);
    await this.request(`/v1/jobs/${encodeURIComponent(vendorJobId)}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation),
    }, "mutating");
  }

  async getVendorStatus(vendorJobId: VendorJobId): Promise<VendorOmrStatus> {
    const value = await this.json(`/v1/jobs/${encodeURIComponent(vendorJobId)}/status`);
    if (!isPlainRecord(value) || typeof value.kind !== "string") throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
    if (["created", "queued", "completed", "cancelled"].includes(value.kind)
      && hasExactKeys(value, ["kind"])) return { kind: value.kind } as VendorOmrStatus;
    if (value.kind === "processing" && hasExactKeys(value, ["kind"], ["progressBp"])
      && (value.progressBp === undefined || integer(value.progressBp, 0, 10_000))) {
      return value.progressBp === undefined ? { kind: "processing" } : { kind: "processing", progressBp: value.progressBp as never };
    }
    if (value.kind === "failed" && hasExactKeys(value, ["kind", "code", "message"])
      && typeof value.code === "string" && value.code.length > 0 && value.code.length <= 128
      && typeof value.message === "string" && value.message.length > 0 && value.message.length <= 4_096) {
      return { kind: "failed", code: value.code, message: value.message };
    }
    if (value.kind === "unknown" && hasExactKeys(value, ["kind", "rawStatus"])
      && typeof value.rawStatus === "string" && value.rawStatus.length > 0 && value.rawStatus.length <= 512) {
      return { kind: "unknown", rawStatus: value.rawStatus };
    }
    throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
  }

  async exportMusicXml(vendorJobId: VendorJobId): Promise<string> {
    return this.memoize(this.musicXmlCache, vendorJobId, async () => {
      const response = await this.request(`/v1/jobs/${encodeURIComponent(vendorJobId)}/result`, {}, "read");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_MUSICXML_BYTES) throw new RangeError("OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED");
      let value: string;
      try { value = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch (error) { throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID", { cause: error }); }
      if (!value.includes("<score-partwise") && !value.includes("<score-timewise")) throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
      return value;
    });
  }

  private async metadata(vendorJobId: VendorJobId): Promise<readonly AudiverisPageMetadata[]> {
    return this.memoize(this.metadataCache, vendorJobId, async () => {
      const value = await this.json(`/v1/jobs/${encodeURIComponent(vendorJobId)}/metadata`);
      if (!isPlainRecord(value) || !hasExactKeys(value, ["pages"]) || !Array.isArray(value.pages)) {
        throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
      }
      const pages = value.pages.map((page) => {
        if (!isPlainRecord(page) || !hasExactKeys(page, ["pageIndex", "pageDigest", "widthPixels", "heightPixels"])
          || !integer(page.pageIndex, 0, 99) || !isLowerHexDigest(page.pageDigest)
          || !integer(page.widthPixels, 1, 100_000) || !integer(page.heightPixels, 1, 100_000)) {
          throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
        }
        return {
          pageIndex: page.pageIndex as number,
          pageDigest: page.pageDigest,
          widthPixels: page.widthPixels as number,
          heightPixels: page.heightPixels as number,
        };
      }).sort((left, right) => left.pageIndex - right.pageIndex);
      if (pages.some((page, index) => page.pageIndex !== index)) throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
      return pages;
    });
  }

  async getEvidence(vendorJobId: VendorJobId): Promise<VendorEvidenceBundle> {
    const pages = await this.metadata(vendorJobId);
    if (pages.length === 0) throw new RangeError("OMR_EVIDENCE_CODEC_FAILED:frame");
    const frames = pages.map((page) => ({
      id: `audiveris:frame:${page.pageIndex}`,
      pageIndex: page.pageIndex,
      coordinateSpace: "original-pixels" as const,
      widthPixels: page.widthPixels,
      heightPixels: page.heightPixels,
      imageDigest: page.pageDigest,
    }));
    const evidence = pages.map((page) => ({
      id: `audiveris:evidence:page:${page.pageIndex}`,
      granularity: "page" as const,
      box: {
        frameId: `audiveris:frame:${page.pageIndex}`,
        xMu: 0 as CoordinateMicrounit,
        yMu: 0 as CoordinateMicrounit,
        widthMu: (page.widthPixels * EVIDENCE_COORDINATE_SCALE) as CoordinateMicrounit,
        heightMu: (page.heightPixels * EVIDENCE_COORDINATE_SCALE) as CoordinateMicrounit,
      },
      vendorId: "audiveris",
    }));
    const bundle = { granularity: "page" as const, frames, transforms: [], evidence };
    return { ...bundle, providerBundleDigest: await computeProviderBundleDigest(bundle) };
  }

  async getNormalizationMapping(vendorJobId: VendorJobId): Promise<VendorNormalizationMappingArtifact> {
    try {
      const [musicXml, evidence] = await Promise.all([this.exportMusicXml(vendorJobId), this.getEvidence(vendorJobId)]);
      const artifact = {
        version: "vendor-export-target-map-v2" as const,
        vendorResultDigest: await binaryDigest(new TextEncoder().encode(musicXml)),
        providerBundleDigest: evidence.providerBundleDigest,
        mappings: [],
      };
      return { ...artifact, artifactDigest: await computeVendorNormalizationMappingDigest(artifact) };
    } finally {
      this.clearCaptureCache(vendorJobId);
    }
  }

  async cancelVendorJob(vendorJobId: VendorJobId, operation: { readonly idempotencyKey: string }): Promise<void> {
    try {
      await this.request(`/v1/jobs/${encodeURIComponent(vendorJobId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation),
      }, "mutating");
    } finally {
      this.clearCaptureCache(vendorJobId);
    }
  }

  async deleteVendorJob(vendorJobId: VendorJobId, operation: { readonly idempotencyKey: string }): Promise<VendorDeleteResult> {
    try {
      const value = await this.json(`/v1/jobs/${encodeURIComponent(vendorJobId)}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": operation.idempotencyKey },
      }, "mutating");
      if (isPlainRecord(value) && hasExactKeys(value, ["status"]) && value.status === "deleted") return { status: "deleted" };
      if (isPlainRecord(value) && hasExactKeys(value, ["status", "code", "message"])
        && value.status === "failed" && typeof value.code === "string" && typeof value.message === "string") {
        return { status: "failed", code: value.code, message: value.message };
      }
      throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
    } finally {
      this.clearCaptureCache(vendorJobId);
    }
  }

  async getRetentionInfo(vendorJobId: VendorJobId): Promise<RetentionInfo> {
    const value = await this.json(`/v1/jobs/${encodeURIComponent(vendorJobId)}/retention`);
    if (!isPlainRecord(value) || !hasExactKeys(value, ["canDeleteImmediately"], ["vendorDeletesAt", "policyReference"])
      || typeof value.canDeleteImmediately !== "boolean"
      || (value.vendorDeletesAt !== undefined && (typeof value.vendorDeletesAt !== "string" || Number.isNaN(Date.parse(value.vendorDeletesAt))))
      || (value.policyReference !== undefined && (typeof value.policyReference !== "string" || value.policyReference.length === 0 || value.policyReference.length > 512))) {
      throw new RangeError("OMR_PROVIDER_CONTRACT_INVALID");
    }
    return {
      canDeleteImmediately: value.canDeleteImmediately,
      ...(value.vendorDeletesAt === undefined ? {} : { vendorDeletesAt: value.vendorDeletesAt }),
      ...(value.policyReference === undefined ? {} : { policyReference: value.policyReference }),
    };
  }

}
