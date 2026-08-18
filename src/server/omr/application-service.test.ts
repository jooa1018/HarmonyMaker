import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

import { binaryDigest, semanticDigest, type BinaryDigest, type SemanticDigest } from "../../domain/digest/canonical";
import { computeVendorNormalizationMappingDigest, OMR_VENDOR_ADAPTER_CONTRACT_VERSION, OmrVendorCallError } from "../../domain/omr/contracts";
import { coordinateMicrounit } from "../../domain/omr/foundation";
import { referenceOmrPageBytes } from "../../domain/omr/reference-fixture-data";
import { basisPoints } from "../../domain/rates";
import type { PrivateRowId } from "../persistence/store";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import { MemoryOwnedObjectStore } from "../storage/memory-owned-object-store.test-adapter";
import {
  PROVIDER_CAPTURE_LIMITS, DurableOmrApplicationService, assertBoundedProviderValue,
  omrQuotaConfig, validateEvidenceCaptureLimits, validateNormalizationMappingCaptureLimits,
} from "./application-service";
import { decodeOmrImagePage } from "./page-decoder";
import { ReferenceOmrVendorAdapter, type ReferenceOmrFixture } from "./reference-adapter";
import { MemoryOmrStore, type OmrStore } from "./store";

const musicXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;

async function harness(statusScript: ReferenceOmrFixture["statusScript"] = [{ kind: "queued" }, { kind: "processing", progressBp: basisPoints(5000) }, { kind: "completed" }]) {
  const pageBytes = new TextEncoder().encode("reference-page-fixture");
  const pageDigest = await binaryDigest(pageBytes);
  const fixture: ReferenceOmrFixture = {
    id: "complete", orderedPageDigests: [pageDigest], statusScript, musicXml,
    evidence: {
      granularity: "page",
      frames: [{ id: "frame:page", pageIndex: 0, coordinateSpace: "normalized-original", widthPixels: 100, heightPixels: 120, imageDigest: pageDigest }],
      transforms: [],
      evidence: [{ id: "evidence:page", granularity: "page", box: { frameId: "frame:page", xMu: coordinateMicrounit(0), yMu: coordinateMicrounit(0), widthMu: coordinateMicrounit(1_000_000), heightMu: coordinateMicrounit(1_000_000) }, vendorId: "hm-reference" }],
    },
    retentionInfo: { canDeleteImmediately: true, policyReference: "reference-fixture-only" },
  };
  const adapter = new ReferenceOmrVendorAdapter([fixture]);
  const governance = new MemoryGovernanceStore();
  const objects = new MemoryOwnedObjectStore(governance);
  const store = new MemoryOmrStore();
  let clock = new Date("2026-01-01T00:00:00.000Z");
  const inspectPage = async (input: { readonly bytes: Uint8Array; readonly mimeType: string }) => ({
    bytes: Uint8Array.from(input.bytes), digest: await binaryDigest(input.bytes), mimeType: input.mimeType,
    width: 100, height: 120,
    quality: { blurBp: basisPoints(100), perspectiveBp: basisPoints(100), glareBp: basisPoints(100), cropRiskBp: basisPoints(100), estimatedStaffSpacePixels: 20, status: "pass" as const, reasons: [] },
  });
  const dependencies = {
    store, objects, adapter, handleHmacKey: new Uint8Array(32).fill(1), vendorJobEncryptionKey: new Uint8Array(32).fill(2),
    quota: omrQuotaConfig(100), actor: { sessionId: "session:1" as PrivateRowId, ipOwnerHash: "ip:hmac:1" },
    inspectPage, now: () => new Date(clock),
  };
  const service = new DurableOmrApplicationService(dependencies);
  return { pageBytes, pageDigest, fixture, adapter, store, objects, service, dependencies, advance(ms: number) { clock = new Date(clock.getTime() + ms); } };
}

const rights = { basis: "self-authored" as const, allowedUses: ["provider-transfer", "generation"] as const };

async function createConsentedJob(service: DurableOmrApplicationService, request: Omit<Parameters<DurableOmrApplicationService["createJob"]>[0], "consentCapabilitySnapshotDigest" | "pages"> & { readonly pages?: Parameters<DurableOmrApplicationService["createJob"]>[0]["pages"] }) {
  const preflight = await service.getProviderPreflight();
  const pageDigest = await binaryDigest(new TextEncoder().encode("reference-page-fixture"));
  const pages = request.pages ?? Array.from({ length: request.pageCount }, (_, pageIndex) => ({ pageIndex, pageDigest, mimeType: "image/png" as const }));
  return service.createJob({ ...request, pages, consentCapabilitySnapshotDigest: preflight.capabilitySnapshotDigest });
}

async function createStartedJob(h: Awaited<ReturnType<typeof harness>>, idempotencyKey: string) {
  const handle = await createConsentedJob(h.service, {
    sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights,
    providerTransferConsent: true, idempotencyKey,
  });
  await h.service.uploadPage(handle, {
    pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: `${idempotencyKey}-upload`,
    bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]),
  });
  await h.service.start(handle);
  return handle;
}

describe("durable provider-neutral OMR application lifecycle", () => {
  it("creates the Vendor job exactly once, uploads idempotently, completes with evidence, and deletes truthfully", async () => {
    const h = await harness();
    const request = { sessionId: "session:1", pageCount: 1, rights, providerTransferConsent: true as const, idempotencyKey: "create-key-0001", sourceKind: "camera-photo" as const };
    const handle = await createConsentedJob(h.service, request);
    expect(await createConsentedJob(h.service, request)).toBe(handle);
    expect(h.adapter.callCounts.create).toBe(1);
    const upload = { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "upload-key-0001", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer], { type: "image/png" }) };
    await h.service.uploadPage(handle, upload);
    await h.service.uploadPage(handle, upload);
    expect(h.adapter.callCounts.upload).toBe(1);
    await h.service.start(handle);
    expect(await h.service.synchronizeStatus(handle)).toEqual({ kind: "queued" });
    expect(await h.service.synchronizeStatus(handle)).toEqual({ kind: "processing", progressBp: 5000 });
    expect(await h.service.synchronizeStatus(handle)).toEqual({ kind: "completed" });
    const result = await h.service.exportResult(handle);
    expect(result.rawMusicXml).toBe(musicXml);
    expect(result.evidence.evidence).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("reference-job:");
    await expect(h.service.delete(handle)).resolves.toEqual({ localHandleDeleted: true, vendor: { status: "deleted" } });
    await expect(h.service.delete(handle)).resolves.toEqual({ localHandleDeleted: true, vendor: { status: "deleted" } });
    expect(h.adapter.callCounts.delete).toBe(1);
    expect(h.store.listJobs()[0].vendorJobIdEnvelope).toBeUndefined();
    await expect(h.service.synchronizeStatus(handle)).rejects.toThrow("OMR_JOB_UNAVAILABLE");
  });

  it("recovers the post-Vendor/pre-persist crash window without creating a second Vendor job", async () => {
    const h = await harness();
    let failPersistenceOnce = true;
    const unstableStore = new Proxy(h.store, {
      get(target, property, receiver) {
        if (property === "completeVendorCreation") return async (...args: Parameters<OmrStore["completeVendorCreation"]>) => {
          if (failPersistenceOnce) { failPersistenceOnce = false; throw new Error("simulated persistence interruption"); }
          return target.completeVendorCreation(...args);
        };
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as OmrStore;
    const service = new DurableOmrApplicationService({ ...h.dependencies, store: unstableStore });
    const request = { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo" as const, rights, providerTransferConsent: true as const, idempotencyKey: "crash-window-key" };
    await expect(createConsentedJob(service, request)).rejects.toThrow("OMR_IDEMPOTENCY_PENDING");
    expect(h.adapter.callCounts.create).toBe(1);
    expect(h.store.listJobs()).toHaveLength(1);
    expect(h.store.listJobs()[0]).toMatchObject({ vendorCreateOutcomeState: "outcome-uncertain", creditState: "reserved" });
    expect(h.store.listJobs()[0].vendorJobIdEnvelope).toBeUndefined();
    h.advance(5 * 60 * 1_000 + 1);
    const recoveredHandle = await createConsentedJob(service, request);
    expect(h.adapter.callCounts.create).toBe(1);
    expect(h.store.listJobs()[0]).toMatchObject({ vendorCreateOutcomeState: "confirmed", vendorJobIdEnvelope: expect.any(Object) });
    expect(await service.synchronizeStatus(recoveredHandle)).toEqual({ kind: "created" });
  });

  it("enforces owner, handle authentication, exact concurrency quota, and digest conflicts", async () => {
    const h = await harness();
    const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "create-key-0001" });
    await expect(createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "create-key-0002" })).rejects.toThrow("OMR_QUOTA_EXCEEDED");
    const foreign = new DurableOmrApplicationService({ ...h.dependencies, actor: { sessionId: "session:2" as PrivateRowId, ipOwnerHash: "ip:hmac:2" } });
    await expect(foreign.synchronizeStatus(handle)).rejects.toThrow("OMR_JOB_UNAVAILABLE");
    const tamperedHandle = `${handle.slice(0, -1)}${handle.endsWith("0") ? "1" : "0"}`;
    await expect(h.service.synchronizeStatus(tamperedHandle as never)).rejects.toThrow("OMR_JOB_UNAVAILABLE");
    const wrong = "f".repeat(64) as BinaryDigest;
    await expect(h.service.uploadPage(handle, { pageIndex: 0, pageDigest: wrong, mimeType: "image/png", idempotencyKey: "upload-key-0001", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) })).rejects.toThrow("OMR_PAGE_UPLOAD_CONFLICT");
  });

  it("persists and validates needs-input before resuming processing", async () => {
    const h = await harness([
      { kind: "queued" },
      { kind: "needs-input", request: { kind: "select-instrument", requestId: "request:1", choices: ["voice", "piano"] } },
      { kind: "processing", progressBp: basisPoints(8000) },
      { kind: "completed" },
    ]);
    const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "create-key-0001" });
    await h.service.uploadPage(handle, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "upload-key-0001", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) });
    await h.service.start(handle);
    await h.service.synchronizeStatus(handle);
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "needs-input" });
    await expect(h.service.submitInput(handle, { kind: "select-instrument", requestId: "request:1", choice: "drums" })).rejects.toThrow("OMR_VENDOR_INPUT_INVALID");
    await h.service.submitInput(handle, { kind: "select-instrument", requestId: "request:1", choice: "voice" });
    await h.service.submitInput(handle, { kind: "select-instrument", requestId: "request:1", choice: "voice" });
    await expect(h.service.submitInput(handle, { kind: "select-instrument", requestId: "request:1", choice: "piano" })).rejects.toThrow("OMR_VENDOR_INPUT_CONFLICT");
    expect(h.adapter.callCounts.input).toBe(1);
    expect(await h.service.synchronizeStatus(handle)).toEqual({ kind: "processing", progressBp: 8000 });
  });

  it("validates confirm-page-order input as the exact expected set", async () => {
    const h = await harness([{ kind: "needs-input", request: { kind: "confirm-page-order", requestId: "order:1", pageIndices: [0] } }, { kind: "completed" }]);
    const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "order-key-1" });
    await h.service.uploadPage(handle, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "upload-key-1", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) });
    await h.service.start(handle); expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "needs-input" });
    await expect(h.service.submitInput(handle, { kind: "confirm-page-order", requestId: "order:1", pageIndices: [1] })).rejects.toThrow("OMR_VENDOR_INPUT_INVALID");
    await h.service.submitInput(handle, { kind: "confirm-page-order", requestId: "order:1", pageIndices: [0] });
    expect(await h.service.synchronizeStatus(handle)).toEqual({ kind: "completed" });
  });

  it("blocks retake and unacknowledged warning pages before Vendor transfer", async () => {
    const h = await harness();
    const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "create-key-0001" });
    const retake = new DurableOmrApplicationService({ ...h.dependencies, inspectPage: async ({ bytes, mimeType }) => ({ bytes, digest: await binaryDigest(bytes), mimeType, width: 10, height: 10, quality: { blurBp: basisPoints(9000), perspectiveBp: basisPoints(0), glareBp: basisPoints(0), cropRiskBp: basisPoints(0), status: "retake", reasons: ["OMR_QUALITY_BLUR_SEVERE"] } }) });
    await expect(retake.uploadPage(handle, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "upload-key-0001", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) })).rejects.toThrow("OMR_IMAGE_RETAKE_REQUIRED");
    expect(h.adapter.callCounts.upload).toBe(0);
    const warning = new DurableOmrApplicationService({ ...h.dependencies, inspectPage: async ({ bytes, mimeType }) => ({ bytes, digest: await binaryDigest(bytes), mimeType, width: 100, height: 120, quality: { blurBp: basisPoints(6000), perspectiveBp: basisPoints(0), glareBp: basisPoints(0), cropRiskBp: basisPoints(0), status: "warn", reasons: ["OMR_QUALITY_BLUR_WARNING"] } }) });
    await expect(warning.uploadPage(handle, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "upload-key-0001", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) })).rejects.toThrow("OMR_IMAGE_WARNING_ACK_REQUIRED");
    await expect(warning.uploadPage(handle, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "upload-key-0001", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]), warnAcknowledged: true })).resolves.toBeUndefined();
  });

  it("fences start, page conflicts, duplicate pages, and retry exhaustion", async () => {
    const h = await harness();
    const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "page-fence-key" });
    await expect(h.service.start(handle)).rejects.toThrow("OMR_PAGES_INCOMPLETE");
    await h.service.uploadPage(handle, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "page-upload-key", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) });
    const changedBytes = new TextEncoder().encode("changed-page"); const changedDigest = await binaryDigest(changedBytes);
    await expect(h.service.uploadPage(handle, { pageIndex: 0, pageDigest: changedDigest, mimeType: "image/png", idempotencyKey: "page-upload-key-2", bytes: new Blob([changedBytes.slice().buffer as ArrayBuffer]) })).rejects.toThrow("OMR_PAGE_UPLOAD_CONFLICT");

    const duplicate = await harness();
    const duplicateFixture = { ...duplicate.fixture, orderedPageDigests: [duplicate.pageDigest, duplicate.pageDigest] };
    const duplicateAdapter = new ReferenceOmrVendorAdapter([duplicateFixture]);
    const duplicateService = new DurableOmrApplicationService({ ...duplicate.dependencies, adapter: duplicateAdapter });
    const duplicateHandle = await createConsentedJob(duplicateService, { sessionId: "session:1", pageCount: 2, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "duplicate-key" });
    const duplicateBlob = () => new Blob([duplicate.pageBytes.slice().buffer as ArrayBuffer]);
    await duplicateService.uploadPage(duplicateHandle, { pageIndex: 0, pageDigest: duplicate.pageDigest, mimeType: "image/png", idempotencyKey: "duplicate-upload-0", bytes: duplicateBlob() });
    await expect(duplicateService.uploadPage(duplicateHandle, { pageIndex: 1, pageDigest: duplicate.pageDigest, mimeType: "image/png", idempotencyKey: "duplicate-upload-1", bytes: duplicateBlob() })).rejects.toThrow("OMR_DUPLICATE_PAGE_CONFIRMATION_REQUIRED");
    await duplicateService.uploadPage(duplicateHandle, { pageIndex: 1, pageDigest: duplicate.pageDigest, mimeType: "image/png", idempotencyKey: "duplicate-upload-1", bytes: duplicateBlob(), duplicateConfirmed: true });

    const retry = await harness();
    vi.spyOn(retry.adapter, "uploadPage").mockRejectedValue(new Error("reference transport failure"));
    const retryHandle = await createConsentedJob(retry.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "retry-key" });
    const retryUpload = { pageIndex: 0, pageDigest: retry.pageDigest, mimeType: "image/png", idempotencyKey: "retry-upload", bytes: new Blob([retry.pageBytes.slice().buffer as ArrayBuffer]) } as const;
    await expect(retry.service.uploadPage(retryHandle, retryUpload)).rejects.toThrow("OMR_PAGE_UPLOAD_FAILED");
    await expect(retry.service.uploadPage(retryHandle, retryUpload)).rejects.toThrow("OMR_PAGE_UPLOAD_FAILED");
    await expect(retry.service.uploadPage(retryHandle, retryUpload)).rejects.toThrow("OMR_PAGE_UPLOAD_FAILED");
    await expect(retry.service.uploadPage(retryHandle, retryUpload)).rejects.toThrow("OMR_PAGE_RETRY_EXHAUSTED");
    expect(retry.adapter.uploadPage).toHaveBeenCalledTimes(3);
  });

  it("checks PNG transfer capability, canonicalizes JPEG input, and detects canonical duplicates", async () => {
    const jpeg = Uint8Array.from(await sharp(referenceOmrPageBytes()).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer());
    if (jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9) throw new Error("fixture JPEG lacks EOI marker");
    const comment = new TextEncoder().encode("HarmonyMaker canonical duplicate fixture");
    const commentSegment = Uint8Array.from([0xff, 0xfe, (comment.length + 2) >> 8, (comment.length + 2) & 0xff, ...comment]);
    const jpegWithComment = Uint8Array.from([...jpeg.slice(0, -2), ...commentSegment, 0xff, 0xd9]);
    const rawDigest0 = await binaryDigest(jpeg);
    const rawDigest1 = await binaryDigest(jpegWithComment);
    expect(rawDigest0).not.toBe(rawDigest1);
    const decoded0 = await decodeOmrImagePage({ bytes: jpeg, declaredMimeType: "image/jpeg", pageIndex: 0 });
    const decoded1 = await decodeOmrImagePage({ bytes: jpegWithComment, declaredMimeType: "image/jpeg", pageIndex: 1 });
    expect(decoded1.pageDigest).toBe(decoded0.pageDigest);

    const base = await harness();
    const fixture = { ...base.fixture, orderedPageDigests: [decoded0.pageDigest, decoded1.pageDigest] };
    const jpegOnlyAdapter = new ReferenceOmrVendorAdapter([fixture], { supportedMimeTypes: ["image/jpeg"] });
    const jpegOnlyService = new DurableOmrApplicationService({ ...base.dependencies, adapter: jpegOnlyAdapter });
    await expect(jpegOnlyService.getProviderPreflight()).rejects.toThrow("OMR_PROVIDER_CAPABILITY_MISSING");

    const adapter = new ReferenceOmrVendorAdapter([fixture], { supportedMimeTypes: ["image/png"] });
    const uploadSpy = vi.spyOn(adapter, "uploadPage");
    const service = new DurableOmrApplicationService({
      ...base.dependencies,
      adapter,
      inspectPage: async ({ bytes, mimeType, pageIndex }) => {
        if (mimeType !== "image/jpeg") throw new RangeError("OMR_INPUT_FORMAT_UNSUPPORTED");
        const decoded = await decodeOmrImagePage({ bytes, declaredMimeType: mimeType, pageIndex });
        return { bytes: decoded.bytes, digest: decoded.pageDigest, mimeType: decoded.mimeType, width: decoded.width, height: decoded.height, quality: decoded.quality };
      },
    });
    const pages = [
      { pageIndex: 0, pageDigest: rawDigest0, mimeType: "image/jpeg" as const },
      { pageIndex: 1, pageDigest: rawDigest1, mimeType: "image/jpeg" as const },
    ];
    const handle = await createConsentedJob(service, { sessionId: "session:1", pageCount: 2, pages, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "canonical-jpeg-duplicate" });
    await service.uploadPage(handle, { ...pages[0], idempotencyKey: "canonical-jpeg-upload-0", bytes: new Blob([jpeg.slice().buffer as ArrayBuffer], { type: "image/jpeg" }) });
    const second = { ...pages[1], idempotencyKey: "canonical-jpeg-upload-1", bytes: new Blob([jpegWithComment.slice().buffer as ArrayBuffer], { type: "image/jpeg" }) };
    await expect(service.uploadPage(handle, second)).rejects.toThrow("OMR_DUPLICATE_PAGE_CONFIRMATION_REQUIRED");
    await expect(service.uploadPage(handle, { ...second, duplicateConfirmed: true })).resolves.toBeUndefined();
    expect(base.store.listJobs()[0].pages.map((page) => page.pageDigest)).toEqual([decoded0.pageDigest, decoded1.pageDigest]);
    expect(uploadSpy.mock.calls.map((call) => ({ mimeType: call[1].mimeType, blobType: call[1].bytes.type }))).toEqual([
      { mimeType: "image/png", blobType: "image/png" },
      { mimeType: "image/png", blobType: "image/png" },
    ]);
  });

  it("transactionally fences concurrent canonical duplicate uploads on different page indices", async () => {
    const h = await harness();
    const fixture = { ...h.fixture, orderedPageDigests: [h.pageDigest, h.pageDigest] };
    const adapter = new ReferenceOmrVendorAdapter([fixture]);
    const service = new DurableOmrApplicationService({ ...h.dependencies, adapter });
    const handle = await createConsentedJob(service, { sessionId: "session:1", pageCount: 2, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "concurrent-duplicate" });
    const attempts = await Promise.allSettled([0, 1].map((pageIndex) => service.uploadPage(handle, {
      pageIndex, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: `concurrent-duplicate-${pageIndex}`,
      bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer], { type: "image/png" }),
    })));
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: "OMR_DUPLICATE_PAGE_CONFIRMATION_REQUIRED" }) });
    expect(adapter.callCounts.upload).toBe(1);
    expect(h.store.listJobs()[0].pages).toHaveLength(1);
  });

  it("recovers post-Vendor page persistence failure through the stable page idempotency key", async () => {
    const h = await harness();
    let failPagePersistenceOnce = true;
    const unstableStore = new Proxy(h.store, {
      get(target, property, receiver) {
        if (property === "completePage") return async (...args: Parameters<OmrStore["completePage"]>) => {
          if (failPagePersistenceOnce) { failPagePersistenceOnce = false; throw new Error("simulated page persistence interruption"); }
          return target.completePage(...args);
        };
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as OmrStore;
    const service = new DurableOmrApplicationService({ ...h.dependencies, store: unstableStore });
    const handle = await createConsentedJob(service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "page-crash-key" });
    const upload = { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "page-crash-upload", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) } as const;
    await expect(service.uploadPage(handle, upload)).rejects.toThrow("OMR_PAGE_UPLOAD_PENDING");
    await expect(service.uploadPage(handle, upload)).rejects.toThrow("OMR_PAGE_UPLOAD_PENDING");
    h.advance(5 * 60 * 1_000 + 1);
    await expect(service.uploadPage(handle, upload)).resolves.toBeUndefined();
    expect(h.adapter.callCounts.upload).toBe(1);
  });

  it("atomically enforces concurrent session/IP, hourly, and global-credit limits before Vendor creation", async () => {
    const sessionHarness = await harness();
    const sessionAttempts = await Promise.allSettled(["concurrent-key-1", "concurrent-key-2"].map((idempotencyKey) => createConsentedJob(sessionHarness.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey })));
    expect(sessionAttempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(sessionAttempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(sessionHarness.adapter.callCounts.create).toBe(1);
    expect(sessionHarness.store.listAudits()).toEqual(expect.arrayContaining([expect.objectContaining({ eventKind: "create-denied", outcome: "quota" })]));

    const ipHarness = await harness();
    const services = ["session:1", "session:2", "session:3"].map((sessionId) => new DurableOmrApplicationService({ ...ipHarness.dependencies, actor: { sessionId: sessionId as PrivateRowId, ipOwnerHash: "ip:hmac:shared" } }));
    const ipAttempts = await Promise.allSettled(services.map((service, index) => createConsentedJob(service, { sessionId: `session:${index + 1}`, pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: `ip-key-000${index}` })));
    expect(ipAttempts.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(ipAttempts.filter((result) => result.status === "rejected")).toHaveLength(1);

    const hourly = await harness();
    for (let index = 0; index < 3; index += 1) {
      const handle = await createConsentedJob(hourly.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: `hourly-key-${index}` });
      await hourly.service.cancel(handle);
    }
    await expect(createConsentedJob(hourly.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "hourly-key-3" })).rejects.toThrow("OMR_QUOTA_EXCEEDED");

    const credit = await harness();
    const creditService = new DurableOmrApplicationService({ ...credit.dependencies, quota: omrQuotaConfig(1) });
    await expect(createConsentedJob(creditService, { sessionId: "session:1", pageCount: 2, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "credit-key-1" })).rejects.toThrow("OMR_GLOBAL_CREDIT_CEILING_EXCEEDED");
    expect(credit.adapter.callCounts.create).toBe(0);
  });

  it("expires authenticated handles and makes cancellation idempotent", async () => {
    const h = await harness();
    const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "expiry-key-1" });
    await h.service.cancel(handle); await h.service.cancel(handle);
    expect(h.adapter.callCounts.cancel).toBe(1);
    h.advance(24 * 60 * 60 * 1_000 + 1);
    await expect(h.service.synchronizeStatus(handle)).rejects.toThrow("OMR_JOB_UNAVAILABLE");
  });

  it("claims expired jobs into the same truthful cleanup lifecycle", async () => {
    const h = await harness();
    const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "cleanup-expiry-key" });
    h.advance(24 * 60 * 60 * 1_000 + 1);
    await expect(h.service.cleanupExpiredJobs()).resolves.toEqual([{ jobId: "1", result: { localHandleDeleted: true, vendor: { status: "deleted" } } }]);
    expect(h.store.listJobs()[0]).toMatchObject({ state: "deleted", handleActive: false, creditState: "released" });
    await expect(h.service.synchronizeStatus(handle)).rejects.toThrow("OMR_JOB_UNAVAILABLE");
  });

  it("binds informed transfer consent to the exact provider capability snapshot", async () => {
    const h = await harness();
    const consented = await h.service.getProviderPreflight();
    vi.spyOn(h.adapter, "getCapabilities").mockResolvedValue({ ...consented.capabilities, vendorDisplayName: "Changed provider disclosure" });
    await expect(h.service.createJob({ sessionId: "session:1", pageCount: 1, pages: [{ pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png" }], sourceKind: "camera-photo", rights, providerTransferConsent: true, consentCapabilitySnapshotDigest: consented.capabilitySnapshotDigest, idempotencyKey: "stale-consent-key" })).rejects.toThrow("OMR_PROVIDER_CONSENT_STALE");
    expect(h.adapter.callCounts.create).toBe(0);
  });

  it("binds old jobs and response-loss replay to Provider A across an active Provider B rotation", async () => {
    const h = await harness([{ kind: "completed" }]);
    const fixtureFor = (vendorId: string): ReferenceOmrFixture => ({
      ...h.fixture,
      evidence: { ...h.fixture.evidence, evidence: h.fixture.evidence.evidence.map((item) => ({ ...item, vendorId })) },
    });
    const adapterA = new ReferenceOmrVendorAdapter([fixtureFor("provider-a")], { vendorId: "provider-a", vendorDisplayName: "Provider A" });
    const adapterB = new ReferenceOmrVendorAdapter([fixtureFor("provider-b")], { vendorId: "provider-b", vendorDisplayName: "Provider B" });
    const registry = new Map([
      ["binding:a", adapterA],
      ["binding:b", adapterB],
    ]);
    const resolveAdapter = (bindingId: string, contractVersion: string) => contractVersion === OMR_VENDOR_ADAPTER_CONTRACT_VERSION ? registry.get(bindingId) : undefined;
    const serviceA = new DurableOmrApplicationService({ ...h.dependencies, adapter: adapterA, providerBindingId: "binding:a", adapterContractVersion: OMR_VENDOR_ADAPTER_CONTRACT_VERSION, resolveAdapter });
    const preflightA = await serviceA.getProviderPreflight();
    const exactA = {
      sessionId: "session:1", pageCount: 1, pages: [{ pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png" as const }],
      sourceKind: "camera-photo" as const, rights, providerTransferConsent: true as const,
      consentCapabilitySnapshotDigest: preflightA.capabilitySnapshotDigest, idempotencyKey: "provider-a-job",
    };
    const handleA = await serviceA.createJob(exactA);
    const providerBPreflight = vi.spyOn(adapterB, "getCapabilities");
    const rotated = new DurableOmrApplicationService({ ...h.dependencies, adapter: adapterB, providerBindingId: "binding:b", adapterContractVersion: OMR_VENDOR_ADAPTER_CONTRACT_VERSION, resolveAdapter });
    expect(await rotated.createJob(exactA)).toBe(handleA);
    expect(providerBPreflight).not.toHaveBeenCalled();
    await rotated.uploadPage(handleA, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "provider-a-upload", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) });
    await rotated.start(handleA);
    expect(await rotated.synchronizeStatus(handleA)).toEqual({ kind: "completed" });
    expect((await rotated.exportResult(handleA)).vendorId).toBe("provider-a");
    expect(adapterA.callCounts).toMatchObject({ upload: 1, start: 1, status: 1, export: 1, evidence: 1, mapping: 1, retention: 1 });
    expect(adapterB.callCounts).toMatchObject({ create: 0, upload: 0, start: 0, status: 0, export: 0 });
    await rotated.delete(handleA);
    expect(adapterA.callCounts.delete).toBe(1);

    const preflightB = await rotated.getProviderPreflight();
    const handleB = await rotated.createJob({ ...exactA, consentCapabilitySnapshotDigest: preflightB.capabilitySnapshotDigest, idempotencyKey: "provider-b-job" });
    expect(handleB).not.toBe(handleA);
    expect(adapterB.callCounts.create).toBe(1);
    expect(h.store.listJobs().map((job) => ({ binding: job.providerBindingId, contract: job.adapterContractVersion }))).toEqual([
      { binding: "binding:a", contract: OMR_VENDOR_ADAPTER_CONTRACT_VERSION },
      { binding: "binding:b", contract: OMR_VENDOR_ADAPTER_CONTRACT_VERSION },
    ]);
  });

  it("canonicalizes set-like capability fields before consent snapshot hashing", async () => {
    const h = await harness();
    const capabilities = await h.adapter.getCapabilities();
    const spy = vi.spyOn(h.adapter, "getCapabilities")
      .mockResolvedValueOnce({ ...capabilities, supportedMimeTypes: ["image/png", "image/jpeg"] })
      .mockResolvedValueOnce({ ...capabilities, supportedMimeTypes: ["image/jpeg", "image/png"] });
    const first = await h.service.getProviderPreflight();
    const second = await h.service.getProviderPreflight();
    expect(first.capabilities.supportedMimeTypes).toEqual(["image/jpeg", "image/png"]);
    expect(second.capabilities.supportedMimeTypes).toEqual(first.capabilities.supportedMimeTypes);
    expect(second.capabilitySnapshotDigest).toBe(first.capabilitySnapshotDigest);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("durably retries transient status, result reads, retention, and local result persistence", async () => {
    const stages = ["status", "export", "evidence", "mapping", "retention", "object-put"] as const;
    for (const stage of stages) {
      const h = await harness([{ kind: "completed" }]);
      const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: `transient-${stage}` });
      await h.service.uploadPage(handle, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: `transient-${stage}-upload`, bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) });
      await h.service.start(handle);
      if (stage === "status") vi.spyOn(h.adapter, "getVendorStatus").mockRejectedValueOnce(new Error("temporary status transport"));
      if (stage === "export") vi.spyOn(h.adapter, "exportMusicXml").mockRejectedValueOnce(new Error("temporary export transport"));
      if (stage === "evidence") vi.spyOn(h.adapter, "getEvidence").mockRejectedValueOnce(new Error("temporary evidence transport"));
      if (stage === "mapping") vi.spyOn(h.adapter, "getNormalizationMapping").mockRejectedValueOnce(new Error("temporary mapping transport"));
      if (stage === "retention") vi.spyOn(h.adapter, "getRetentionInfo").mockRejectedValueOnce(new Error("temporary retention transport"));
      if (stage === "object-put") {
        const originalPut = h.objects.put.bind(h.objects);
        vi.spyOn(h.objects, "put").mockImplementationOnce(async () => { throw new Error("temporary object storage transport"); }).mockImplementation(originalPut);
      }
      const pending = await h.service.synchronizeStatus(handle);
      expect(pending).toMatchObject({ kind: "retry-pending", operation: stage === "status" ? "sync" : "capture", attempt: 1 });
      expect(h.store.listJobs()[0]).toMatchObject({ creditState: "reserved", providerBindingId: "hm-reference", retryAttempt: 1 });
      h.advance(60_001);
      expect(await h.service.synchronizeStatus(handle)).toEqual({ kind: "completed" });
      expect(h.store.listJobs()[0]).toMatchObject({ state: "completed", creditState: "settled", providerBindingId: "hm-reference", retryAttempt: undefined });
    }
  });

  it("bounds transient retries without releasing credit or discarding provider binding", async () => {
    const h = await harness([{ kind: "completed" }]);
    const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "capture-retry-exhaustion" });
    await h.service.uploadPage(handle, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "capture-retry-exhaustion-upload", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) });
    await h.service.start(handle);
    vi.spyOn(h.adapter, "exportMusicXml").mockRejectedValue(new Error("persistent temporary transport"));
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "retry-pending", attempt: 1 });
    for (const delay of [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]) {
      h.advance(delay + 1);
      await h.service.synchronizeStatus(handle);
    }
    expect(await h.service.getStatus(handle)).toMatchObject({ kind: "retry-pending", operation: "capture", attempt: 5 });
    h.advance(12 * 60 * 60_000 + 1);
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "reconciliation-required", code: "OMR_JOB_RECONCILIATION_REQUIRED" });
    expect(h.store.listJobs()[0]).toMatchObject({ state: "reconciliation-required", reconciliationKind: "capture", creditState: "reserved", providerBindingId: "hm-reference", vendorJobIdEnvelope: expect.any(Object) });
  });

  it("treats a malformed normalization mapping as terminal without a second capture", async () => {
    const h = await harness([{ kind: "completed" }]);
    const handle = await createStartedJob(h, "malformed-normalization-mapping");
    const original = h.adapter.getNormalizationMapping.bind(h.adapter);
    const mapping = vi.spyOn(h.adapter, "getNormalizationMapping").mockImplementation(async (vendorJobId) => {
      const artifact = await original(vendorJobId);
      return {
        ...artifact,
        mappings: [{ vendorTargetId: "", target: { kind: "measure", musicXmlPartOrdinal: 0, measureOrdinal: 0 } }],
      };
    });
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "failed", code: "OMR_EVIDENCE_TARGET_UNMAPPED" });
    expect(h.store.listJobs()[0]).toMatchObject({ state: "failed", creditState: "released", retryKind: undefined, retryAttempt: undefined });
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "failed", code: "OMR_EVIDENCE_TARGET_UNMAPPED" });
    expect(mapping).toHaveBeenCalledTimes(1);
  });

  it("treats an invalid normalization mapping digest as terminal without retry", async () => {
    const h = await harness([{ kind: "completed" }]);
    const handle = await createStartedJob(h, "invalid-normalization-mapping-digest");
    const original = h.adapter.getNormalizationMapping.bind(h.adapter);
    const mapping = vi.spyOn(h.adapter, "getNormalizationMapping").mockImplementation(async (vendorJobId) => ({
      ...await original(vendorJobId), artifactDigest: "f".repeat(64) as SemanticDigest,
    }));
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "failed", code: "OMR_EVIDENCE_TARGET_UNMAPPED" });
    expect(h.store.listJobs()[0]).toMatchObject({ state: "failed", creditState: "released", retryKind: undefined, retryAttempt: undefined });
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "failed" });
    expect(mapping).toHaveBeenCalledTimes(1);
  });

  it("treats a malformed evidence graph as a terminal codec failure without retry", async () => {
    const h = await harness([{ kind: "completed" }]);
    const handle = await createStartedJob(h, "malformed-evidence-graph");
    const original = h.adapter.getEvidence.bind(h.adapter);
    const evidence = vi.spyOn(h.adapter, "getEvidence").mockImplementation(async (vendorJobId) => {
      const bundle = await original(vendorJobId);
      return {
        ...bundle,
        evidence: bundle.evidence.map((item) => ({ ...item, box: { ...item.box, frameId: "frame:missing" } })),
      };
    });
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "failed", code: "OMR_EVIDENCE_CODEC_FAILED" });
    expect(h.store.listJobs()[0]).toMatchObject({ state: "failed", creditState: "released", retryKind: undefined, retryAttempt: undefined });
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "failed" });
    expect(evidence).toHaveBeenCalledTimes(1);
  });

  it("treats a valid mapping with a mismatched result binding as terminal integrity failure", async () => {
    const h = await harness([{ kind: "completed" }]);
    const handle = await createStartedJob(h, "mapping-result-integrity-mismatch");
    const original = h.adapter.getNormalizationMapping.bind(h.adapter);
    const mapping = vi.spyOn(h.adapter, "getNormalizationMapping").mockImplementation(async (vendorJobId) => {
      const artifact = await original(vendorJobId);
      const mismatched = { ...artifact, vendorResultDigest: "f".repeat(64) as BinaryDigest };
      return { ...mismatched, artifactDigest: await computeVendorNormalizationMappingDigest(mismatched) };
    });
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "failed", code: "OMR_RESULT_INTEGRITY_FAILED" });
    expect(h.store.listJobs()[0]).toMatchObject({ state: "failed", creditState: "released", retryKind: undefined, retryAttempt: undefined });
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "failed" });
    expect(mapping).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit Vendor failed status terminal and clears retry metadata", async () => {
    const h = await harness([{ kind: "failed", code: "PROVIDER_TERMINAL", message: "provider rejected the score" }]);
    const handle = await createStartedJob(h, "explicit-vendor-terminal-status");
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "failed", code: "OMR_VENDOR_OPERATION_FAILED" });
    expect(h.store.listJobs()[0]).toMatchObject({ state: "failed", creditState: "released", retryKind: undefined, retryAttempt: undefined });
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "failed" });
    expect(h.adapter.callCounts.status).toBe(1);
  });

  it("rejects oversized provider captures and inconsistent item granularity before authority or storage", async () => {
    const h = await harness([{ kind: "completed" }]);
    const evidence = h.fixture.evidence;
    expect(() => validateEvidenceCaptureLimits({ ...evidence, evidence: Array.from({ length: PROVIDER_CAPTURE_LIMITS.evidenceItems + 1 }, () => evidence.evidence[0]) } as never)).toThrow("OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED");
    expect(() => validateEvidenceCaptureLimits({ ...evidence, frames: Array.from({ length: PROVIDER_CAPTURE_LIMITS.frames + 1 }, () => evidence.frames[0]) } as never)).toThrow("OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED");
    expect(() => validateEvidenceCaptureLimits({ ...evidence, transforms: Array.from({ length: PROVIDER_CAPTURE_LIMITS.transforms + 1 }, () => ({ id: "transform:x" })) } as never)).toThrow("OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED");
    expect(() => validateEvidenceCaptureLimits({ ...evidence, granularity: "symbol" } as never)).toThrow("OMR_PROVIDER_CAPABILITY_MISSING");
    expect(() => validateNormalizationMappingCaptureLimits({ mappings: Array.from({ length: PROVIDER_CAPTURE_LIMITS.mappings + 1 }, () => ({})) } as never)).toThrow("OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED");
    expect(() => assertBoundedProviderValue({ value: "x".repeat(PROVIDER_CAPTURE_LIMITS.stringLength + 1) })).toThrow("OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED");

    const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "oversized-result" });
    await h.service.uploadPage(handle, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "oversized-result-upload", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) });
    await h.service.start(handle);
    const exportResult = vi.spyOn(h.adapter, "exportMusicXml").mockResolvedValue("x".repeat(PROVIDER_CAPTURE_LIMITS.musicXmlBytes + 1));
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "failed", code: "OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED" });
    expect(h.adapter.callCounts.evidence).toBe(0);
    expect(h.store.listJobs()[0]).toMatchObject({ state: "failed", creditState: "released", retryKind: undefined, retryAttempt: undefined });
    expect(h.store.listJobs()[0].resultObjectReferenceId).toBeUndefined();
    expect(await h.service.synchronizeStatus(handle)).toMatchObject({ kind: "failed", code: "OMR_PROVIDER_PAYLOAD_LIMIT_EXCEEDED" });
    expect(exportResult).toHaveBeenCalledTimes(1);
  });

  it("persists cancel failure and recovers every idempotent post-effect crash window through fencing", async () => {
    const failed = await harness();
    const failedHandle = await createConsentedJob(failed.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "cancel-failure-key" });
    const cancelSpy = vi.spyOn(failed.adapter, "cancelVendorJob").mockRejectedValueOnce(new Error("vendor cancel unavailable"));
    await expect(failed.service.cancel(failedHandle)).rejects.toThrow("OMR_VENDOR_CANCEL_FAILED");
    expect(await failed.service.synchronizeStatus(failedHandle)).toMatchObject({ kind: "cancel-failed", code: "OMR_VENDOR_CANCEL_FAILED" });
    cancelSpy.mockRestore();
    await expect(failed.service.cancel(failedHandle)).resolves.toBeUndefined();
    expect(await failed.service.synchronizeStatus(failedHandle)).toEqual({ kind: "cancelled" });

    const cancelCrash = await harness();
    let failCancelPersist = true;
    const cancelStore = new Proxy(cancelCrash.store, {
      get(target, property, receiver) {
        if (property === "completeOperation") return async (input: Parameters<OmrStore["completeOperation"]>[0]) => {
          if (input.kind === "cancel" && failCancelPersist) { failCancelPersist = false; throw new Error("cancel post-effect crash"); }
          return target.completeOperation(input);
        };
        const value = Reflect.get(target, property, receiver) as unknown; return typeof value === "function" ? value.bind(target) : value;
      },
    }) as OmrStore;
    const cancelService = new DurableOmrApplicationService({ ...cancelCrash.dependencies, store: cancelStore });
    const cancelHandle = await createConsentedJob(cancelService, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "cancel-crash-key" });
    await expect(cancelService.cancel(cancelHandle)).rejects.toThrow("OMR_CANCEL_PENDING");
    await expect(cancelService.cancel(cancelHandle)).rejects.toThrow("OMR_CANCEL_PENDING");
    cancelCrash.advance(5 * 60 * 1_000 + 1);
    await expect(cancelService.cancel(cancelHandle)).resolves.toBeUndefined();
    expect(cancelCrash.adapter.callCounts.cancel).toBe(1);

    const startCrash = await harness([{ kind: "completed" }]);
    let failStartPersist = true;
    const startStore = new Proxy(startCrash.store, {
      get(target, property, receiver) {
        if (property === "completeOperation") return async (input: Parameters<OmrStore["completeOperation"]>[0]) => {
          if (input.kind === "start" && failStartPersist) { failStartPersist = false; throw new Error("start post-effect crash"); }
          return target.completeOperation(input);
        };
        const value = Reflect.get(target, property, receiver) as unknown; return typeof value === "function" ? value.bind(target) : value;
      },
    }) as OmrStore;
    const startService = new DurableOmrApplicationService({ ...startCrash.dependencies, store: startStore });
    const startHandle = await createConsentedJob(startService, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "start-crash-key" });
    await startService.uploadPage(startHandle, { pageIndex: 0, pageDigest: startCrash.pageDigest, mimeType: "image/png", idempotencyKey: "start-crash-upload", bytes: new Blob([startCrash.pageBytes.slice().buffer as ArrayBuffer]) });
    await expect(startService.start(startHandle)).rejects.toThrow("OMR_OPERATION_PENDING");
    await expect(startService.start(startHandle)).rejects.toThrow("OMR_OPERATION_PENDING");
    startCrash.advance(5 * 60 * 1_000 + 1);
    await expect(startService.start(startHandle)).resolves.toBeUndefined();
    expect(startCrash.adapter.callCounts.start).toBe(1);

    const inputCrash = await harness([{ kind: "needs-input", request: { kind: "select-instrument", requestId: "instrument-crash", choices: ["Voice"] } }, { kind: "completed" }]);
    let failInputPersist = true;
    const inputStore = new Proxy(inputCrash.store, {
      get(target, property, receiver) {
        if (property === "completeOperation") return async (input: Parameters<OmrStore["completeOperation"]>[0]) => {
          if (input.kind === "submit-input" && failInputPersist) { failInputPersist = false; throw new Error("input post-effect crash"); }
          return target.completeOperation(input);
        };
        const value = Reflect.get(target, property, receiver) as unknown; return typeof value === "function" ? value.bind(target) : value;
      },
    }) as OmrStore;
    const inputService = new DurableOmrApplicationService({ ...inputCrash.dependencies, store: inputStore });
    const inputHandle = await createConsentedJob(inputService, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "input-crash-key" });
    await inputService.uploadPage(inputHandle, { pageIndex: 0, pageDigest: inputCrash.pageDigest, mimeType: "image/png", idempotencyKey: "input-crash-upload", bytes: new Blob([inputCrash.pageBytes.slice().buffer as ArrayBuffer]) });
    await inputService.start(inputHandle); expect(await inputService.synchronizeStatus(inputHandle)).toMatchObject({ kind: "needs-input" });
    const input = { kind: "select-instrument" as const, requestId: "instrument-crash", choice: "Voice" };
    await expect(inputService.submitInput(inputHandle, input)).rejects.toThrow("OMR_OPERATION_PENDING");
    await expect(inputService.submitInput(inputHandle, input)).rejects.toThrow("OMR_OPERATION_PENDING");
    inputCrash.advance(5 * 60 * 1_000 + 1);
    await expect(inputService.submitInput(inputHandle, input)).resolves.toBeUndefined();
    expect(inputCrash.adapter.callCounts.input).toBe(1);
  });

  it("moves non-idempotent uncertain effects directly to reconciliation instead of replaying", async () => {
    const h = await harness();
    const adapter = new ReferenceOmrVendorAdapter([h.fixture], { supportsIdempotency: false });
    let failCancelPersist = true;
    const store = new Proxy(h.store, {
      get(target, property, receiver) {
        if (property === "completeOperation") return async (input: Parameters<OmrStore["completeOperation"]>[0]) => {
          if (input.kind === "cancel" && failCancelPersist) { failCancelPersist = false; throw new Error("cancel post-effect crash"); }
          return target.completeOperation(input);
        };
        const value = Reflect.get(target, property, receiver) as unknown; return typeof value === "function" ? value.bind(target) : value;
      },
    }) as OmrStore;
    const service = new DurableOmrApplicationService({ ...h.dependencies, store, adapter });
    const handle = await createConsentedJob(service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "non-idempotent-cancel" });
    await expect(service.cancel(handle)).rejects.toThrow("OMR_JOB_RECONCILIATION_REQUIRED");
    expect(h.store.listJobs()[0]).toMatchObject({ state: "reconciliation-required", reconciliationKind: "cancel" });
    expect(adapter.callCounts.cancel).toBe(1);

    const createCrash = await harness();
    const createAdapter = new ReferenceOmrVendorAdapter([createCrash.fixture], { supportsIdempotency: false });
    const createStore = new Proxy(createCrash.store, {
      get(target, property, receiver) {
        if (property === "completeVendorCreation") return async () => { throw new Error("create post-effect crash"); };
        const value = Reflect.get(target, property, receiver) as unknown; return typeof value === "function" ? value.bind(target) : value;
      },
    }) as OmrStore;
    const createService = new DurableOmrApplicationService({ ...createCrash.dependencies, store: createStore, adapter: createAdapter });
    await expect(createConsentedJob(createService, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "non-idempotent-create" })).rejects.toThrow("OMR_JOB_RECONCILIATION_REQUIRED");
    expect(createCrash.store.listJobs()[0]).toMatchObject({ state: "reconciliation-required", reconciliationKind: "create" });
    expect(createAdapter.callCounts.create).toBe(1);
    await expect(createConsentedJob(createService, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "reconciliation-session-quota" })).rejects.toThrow("OMR_QUOTA_EXCEEDED");

    const sharedIpService2 = new DurableOmrApplicationService({ ...createCrash.dependencies, store: createCrash.store, adapter: createCrash.adapter, actor: { sessionId: "session:2" as PrivateRowId, ipOwnerHash: "ip:hmac:1" } });
    await expect(createConsentedJob(sharedIpService2, { sessionId: "session:2", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "reconciliation-ip-second" })).resolves.toMatch(/^v1\./u);
    const sharedIpService3 = new DurableOmrApplicationService({ ...createCrash.dependencies, store: createCrash.store, adapter: createCrash.adapter, actor: { sessionId: "session:3" as PrivateRowId, ipOwnerHash: "ip:hmac:1" } });
    await expect(createConsentedJob(sharedIpService3, { sessionId: "session:3", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "reconciliation-ip-third" })).rejects.toThrow("OMR_QUOTA_EXCEEDED");

    const creditService = new DurableOmrApplicationService({ ...createCrash.dependencies, store: createCrash.store, adapter: createCrash.adapter, quota: omrQuotaConfig(1), actor: { sessionId: "session:credit" as PrivateRowId, ipOwnerHash: "ip:hmac:credit" } });
    await expect(createConsentedJob(creditService, { sessionId: "session:credit", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "reconciliation-credit" })).rejects.toThrow("OMR_GLOBAL_CREDIT_CEILING_EXCEEDED");
    expect(createCrash.store.listJobs()[0]).toMatchObject({ creditState: "reserved", creditEstimate: 1 });
  });

  it("keeps non-idempotent post-create persistence uncertainty, local cleanup, and credit exposure durable through expiry", async () => {
    const h = await harness();
    const adapter = new ReferenceOmrVendorAdapter([h.fixture], { supportsIdempotency: false });
    const createSpy = vi.spyOn(adapter, "createVendorJob");
    const deleteSpy = vi.spyOn(adapter, "deleteVendorJob");
    const retentionSpy = vi.spyOn(adapter, "getRetentionInfo");
    const unstableStore = new Proxy(h.store, {
      get(target, property, receiver) {
        if (property === "completeVendorCreation") return async () => { throw new Error("post-effect create persistence failure"); };
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as OmrStore;
    const service = new DurableOmrApplicationService({ ...h.dependencies, store: unstableStore, adapter });
    await expect(createConsentedJob(service, {
      sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights,
      providerTransferConsent: true, idempotencyKey: "non-idempotent-expiry-uncertainty",
    })).rejects.toThrow("OMR_JOB_RECONCILIATION_REQUIRED");
    expect(createSpy).toHaveBeenCalledTimes(1);
    const localObject = await h.objects.put({
      ownerSessionId: "session:1" as PrivateRowId,
      bytes: new TextEncoder().encode("uncertain-local-page"), contentType: "image/png",
    });
    const uncertain = h.store.listJobs()[0];
    await h.store.transition(uncertain.id, { pages: [{
      pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKeyHash: "local-page-key",
      width: 100, height: 120,
      quality: { blurBp: basisPoints(100), perspectiveBp: basisPoints(100), glareBp: basisPoints(100), cropRiskBp: basisPoints(100), estimatedStaffSpacePixels: 20, status: "pass", reasons: [] },
      warnAcknowledged: false, duplicateConfirmed: false, uploadState: "uploaded", retryCount: 0,
      objectReferenceId: localObject.id,
    }] }, uncertain.updatedAt);
    expect(h.store.listJobs()[0]).toMatchObject({
      state: "reconciliation-required", reconciliationKind: "create",
      vendorCreateOutcomeState: "outcome-uncertain", creditState: "reserved",
    });
    expect(h.store.listJobs()[0].vendorJobIdEnvelope).toBeUndefined();

    h.advance(24 * 60 * 60 * 1_000 + 1);
    await expect(service.cleanupExpiredJobs()).resolves.toEqual([{
      jobId: "1", result: { localHandleDeleted: true, vendor: expect.objectContaining({ status: "failed", code: "OMR_VENDOR_CREATE_OUTCOME_UNCERTAIN" }) },
    }]);
    expect(createSpy).toHaveBeenCalledTimes(1); expect(deleteSpy).not.toHaveBeenCalled(); expect(retentionSpy).not.toHaveBeenCalled();
    const pending = h.store.listJobs()[0];
    expect(pending).toMatchObject({
      state: "delete-pending", vendorCreateOutcomeState: "outcome-uncertain",
      vendorDeleteState: "failed", localDeleteState: "deleted", creditState: "reserved",
      publicFailureCode: "OMR_VENDOR_CREATE_OUTCOME_UNCERTAIN",
      cleanupLeaseToken: undefined, cleanupLeaseExpiresAt: undefined,
    });
    expect(pending.vendorJobIdEnvelope).toBeUndefined();
    expect(pending.vendorCreateIdempotencyKey).toBe(uncertain.vendorCreateIdempotencyKey);
    expect(pending.vendorDeleteNextAttemptAt).toBeDefined();
    await expect(h.objects.get(localObject.id, uncertain.ownerSessionId)).rejects.toThrow("OBJECT_UNAVAILABLE");

    const creditService = new DurableOmrApplicationService({
      ...h.dependencies, store: h.store, adapter, quota: omrQuotaConfig(1),
      actor: { sessionId: "session:credit-after-expiry" as PrivateRowId, ipOwnerHash: "ip:hmac:credit-after-expiry" },
    });
    await expect(createConsentedJob(creditService, {
      sessionId: "session:credit-after-expiry", pageCount: 1, sourceKind: "camera-photo", rights,
      providerTransferConsent: true, idempotencyKey: "credit-after-uncertain-expiry",
    })).rejects.toThrow("OMR_GLOBAL_CREDIT_CEILING_EXCEEDED");
  });

  it("retries Vendor and local object deletion independently for mixed delete-pending siblings", async () => {
    const h = await harness();
    const originalVendorDelete = h.adapter.deleteVendorJob.bind(h.adapter);
    let failVendorOnce = true;
    vi.spyOn(h.adapter, "deleteVendorJob").mockImplementation(async (...args) => {
      if (failVendorOnce) { failVendorOnce = false; throw new Error("vendor delete transient"); }
      return originalVendorDelete(...args);
    });
    const retentionSpy = vi.spyOn(h.adapter, "getRetentionInfo");
    const first = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "mixed-delete-first" });
    await h.service.uploadPage(first, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "mixed-delete-upload-first", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) });
    expect((await h.service.delete(first)).vendor.status).toBe("failed");

    const second = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "mixed-delete-second" });
    await h.service.uploadPage(second, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "mixed-delete-upload-second", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) });
    const originalObjectDelete = h.objects.delete.bind(h.objects);
    let failObjectOnce = true;
    vi.spyOn(h.objects, "delete").mockImplementation(async (...args) => {
      if (failObjectOnce) { failObjectOnce = false; throw new Error("S3 delete transient"); }
      return originalObjectDelete(...args);
    });
    expect((await h.service.delete(second)).vendor.status).toBe("deleted");
    expect(h.store.listJobs().map((job) => ({ state: job.state, vendor: job.vendorDeleteState, local: job.localDeleteState }))).toEqual([
      { state: "delete-pending", vendor: "failed", local: "deleted" },
      { state: "delete-pending", vendor: "deleted", local: "failed" },
    ]);
    expect(retentionSpy).toHaveBeenCalledTimes(1);
    const [vendorPending, localPending] = h.store.listJobs();
    expect(vendorPending).toMatchObject({ vendorDeleteNextAttemptAt: expect.any(String), localDeleteNextAttemptAt: undefined, vendorJobIdEnvelope: expect.any(Object) });
    expect(localPending).toMatchObject({ vendorDeleteNextAttemptAt: undefined, localDeleteNextAttemptAt: expect.any(String), vendorJobIdEnvelope: expect.any(Object) });
    h.advance(60 * 1_000 + 1);
    const cleanup = await h.service.cleanupExpiredJobs();
    expect(cleanup).toHaveLength(2);
    expect(h.store.listJobs().map((job) => job.state)).toEqual(["deleted", "deleted"]);
    expect(h.store.listJobs().map((job) => job.vendorJobIdEnvelope)).toEqual([undefined, undefined]);
  });

  it("fails safely on unknown status, evidence downgrade, and missing evidence", async () => {
    const unknown = await harness([{ kind: "unknown", rawStatus: "vendor-secret-status" }]);
    const unknownHandle = await createConsentedJob(unknown.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "unknown-key-1" });
    await unknown.service.uploadPage(unknownHandle, { pageIndex: 0, pageDigest: unknown.pageDigest, mimeType: "image/png", idempotencyKey: "upload-key-1", bytes: new Blob([unknown.pageBytes.slice().buffer as ArrayBuffer]) });
    await unknown.service.start(unknownHandle);
    expect(await unknown.service.synchronizeStatus(unknownHandle)).toEqual({ kind: "failed", code: "OMR_VENDOR_STATUS_UNKNOWN", messageKo: "인식 작업 상태를 확인할 수 없습니다." });

    const downgraded = await harness([{ kind: "completed" }]);
    const measureAdapter = new ReferenceOmrVendorAdapter([downgraded.fixture], { vendorId: "hm-reference", supportedMimeTypes: ["image/png"], maxPages: 12, evidenceGranularity: "measure", supportsDeletion: true, retentionDisclosure: true, supportsIdempotency: true, supportsInteractiveInput: true, estimatedCreditPerPage: 1 });
    const measureService = new DurableOmrApplicationService({ ...downgraded.dependencies, adapter: measureAdapter });
    const measureHandle = await createConsentedJob(measureService, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "measure-key-1" });
    await measureService.uploadPage(measureHandle, { pageIndex: 0, pageDigest: downgraded.pageDigest, mimeType: "image/png", idempotencyKey: "upload-key-1", bytes: new Blob([downgraded.pageBytes.slice().buffer as ArrayBuffer]) });
    await measureService.start(measureHandle);
    expect(await measureService.synchronizeStatus(measureHandle)).toMatchObject({ kind: "failed", code: "OMR_PROVIDER_CAPABILITY_MISSING" });

    const missingFixture = { ...downgraded.fixture, evidence: { ...downgraded.fixture.evidence, evidence: [] } };
    const missingAdapter = new ReferenceOmrVendorAdapter([missingFixture]);
    const missing = await harness([{ kind: "completed" }]);
    const missingService = new DurableOmrApplicationService({ ...missing.dependencies, adapter: missingAdapter });
    const missingHandle = await createConsentedJob(missingService, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "missing-key-1" });
    await missingService.uploadPage(missingHandle, { pageIndex: 0, pageDigest: missing.pageDigest, mimeType: "image/png", idempotencyKey: "upload-key-1", bytes: new Blob([missing.pageBytes.slice().buffer as ArrayBuffer]) });
    await missingService.start(missingHandle);
    expect(await missingService.synchronizeStatus(missingHandle)).toMatchObject({ kind: "failed", code: "OMR_PROVIDER_CAPABILITY_MISSING" });
  });

  it("preserves truthful unsupported and failed Vendor retention outcomes", async () => {
    const base = await harness([{ kind: "completed" }]);
    const runDelete = async (adapter: ReferenceOmrVendorAdapter, key: string) => {
      const service = new DurableOmrApplicationService({ ...base.dependencies, adapter });
      const handle = await createConsentedJob(service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: key });
      await service.uploadPage(handle, { pageIndex: 0, pageDigest: base.pageDigest, mimeType: "image/png", idempotencyKey: `${key}-upload`, bytes: new Blob([base.pageBytes.slice().buffer as ArrayBuffer]) });
      await service.start(handle); await service.synchronizeStatus(handle);
      return service.delete(handle);
    };
    const unsupported = new ReferenceOmrVendorAdapter([base.fixture], { vendorId: "hm-reference", supportedMimeTypes: ["image/png"], maxPages: 12, evidenceGranularity: "page", supportsDeletion: false, retentionDisclosure: true, supportsIdempotency: true, supportsInteractiveInput: true, estimatedCreditPerPage: 1 });
    await expect(runDelete(unsupported, "unsupported-delete-key")).resolves.toMatchObject({ localHandleDeleted: true, vendor: { status: "not-supported", retentionInfo: { policyReference: "reference-fixture-only" } } });
    const failed = new ReferenceOmrVendorAdapter([{ ...base.fixture, deleteResult: { status: "failed", code: "RAW_VENDOR_CODE", message: "raw vendor details" } }]);
    await expect(runDelete(failed, "failed-delete-key")).resolves.toEqual({ localHandleDeleted: true, vendor: { status: "failed", code: "OMR_VENDOR_DELETE_FAILED", message: "Vendor 삭제 확인이 완료되지 않았습니다." } });
  });

  it("follows up not-supported Vendor deletion at the disclosed vendorDeletesAt after handle removal", async () => {
    const h = await harness([{ kind: "completed" }]);
    const vendorDeletesAt = "2026-01-01T00:02:00.000Z";
    const fixture = { ...h.fixture, retentionInfo: { canDeleteImmediately: false, policyReference: "scheduled-delete-policy", vendorDeletesAt } };
    const adapter = new ReferenceOmrVendorAdapter([fixture], { supportsDeletion: false });
    const service = new DurableOmrApplicationService({ ...h.dependencies, adapter });
    const handle = await createConsentedJob(service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "scheduled-delete-key" });
    await service.uploadPage(handle, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "scheduled-delete-upload", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) });
    await service.start(handle); expect(await service.synchronizeStatus(handle)).toEqual({ kind: "completed" });
    await expect(service.delete(handle)).resolves.toMatchObject({ localHandleDeleted: true, vendor: { status: "not-supported", retentionInfo: { vendorDeletesAt } } });
    expect(adapter.callCounts.delete).toBe(1);
    h.advance(60 * 1_000);
    await expect(service.cleanupExpiredJobs()).resolves.toEqual([]);
    h.advance(60 * 1_000 + 1);
    await expect(service.cleanupExpiredJobs()).resolves.toHaveLength(1);
    expect(adapter.callCounts.delete).toBe(2);
    expect(h.store.listJobs()[0]).toMatchObject({ state: "delete-pending", handleActive: false, vendorDeleteState: "not-supported", localDeleteState: "deleted", retentionInfo: { vendorDeletesAt } });
  });

  it("replays the exact canonical create request after lost responses and distinguishes uncertain from definitive outcomes", async () => {
    const h = await harness();
    const stableRights = { basis: "user-confirmed-rights" as const, allowedUses: ["provider-transfer", "generation"] as const, confirmedAt: "2026-01-01T00:00:00.000Z" };
    const request = { sessionId: "session:1", pageCount: 1, pages: [{ pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png" as const }], sourceKind: "camera-photo" as const, rights: stableRights, providerTransferConsent: true as const, idempotencyKey: "lost-http-response" };
    const preflight = await h.service.getProviderPreflight();
    const exact = { ...request, consentCapabilitySnapshotDigest: preflight.capabilitySnapshotDigest };
    const lostResponseHandle = await h.service.createJob(exact);
    expect(await h.service.createJob(exact)).toBe(lostResponseHandle);
    expect(h.store.listJobs()[0].canonicalCreateRequest).toEqual({
      pageCount: request.pageCount, pages: request.pages, sourceKind: request.sourceKind,
      rights: request.rights, providerTransferConsent: true,
      consentCapabilitySnapshotDigest: preflight.capabilitySnapshotDigest,
      idempotencyKey: request.idempotencyKey,
    });
    await expect(h.service.createJob({ ...exact, rights: { ...stableRights, confirmedAt: "2026-01-01T00:00:01.000Z" } })).rejects.toThrow("OMR_IDEMPOTENCY_CONFLICT");
    expect(h.adapter.callCounts.create).toBe(1);

    const responseLoss = await harness();
    const originalCreate = responseLoss.adapter.createVendorJob.bind(responseLoss.adapter);
    let loseVendorResponse = true;
    vi.spyOn(responseLoss.adapter, "createVendorJob").mockImplementation(async (input) => {
      const vendorJobId = await originalCreate(input);
      if (loseVendorResponse) { loseVendorResponse = false; throw new OmrVendorCallError("lost vendor response", "outcome-uncertain"); }
      return vendorJobId;
    });
    const responseLossService = new DurableOmrApplicationService({ ...responseLoss.dependencies, adapter: responseLoss.adapter });
    const responseLossRequest = { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo" as const, rights, providerTransferConsent: true as const, idempotencyKey: "vendor-response-loss" };
    await expect(createConsentedJob(responseLossService, responseLossRequest)).rejects.toThrow("OMR_IDEMPOTENCY_PENDING");
    responseLoss.advance(5 * 60 * 1_000 + 1);
    await expect(createConsentedJob(responseLossService, responseLossRequest)).resolves.toMatch(/^v1\./u);
    expect(responseLoss.adapter.callCounts.create).toBe(1);

    const nonIdempotent = await harness();
    const nonIdempotentAdapter = new ReferenceOmrVendorAdapter([nonIdempotent.fixture], { supportsIdempotency: false });
    const originalNonIdempotentCreate = nonIdempotentAdapter.createVendorJob.bind(nonIdempotentAdapter);
    vi.spyOn(nonIdempotentAdapter, "createVendorJob").mockImplementation(async (input) => {
      await originalNonIdempotentCreate(input);
      throw new OmrVendorCallError("transport ended after request transmission", "outcome-uncertain");
    });
    const nonIdempotentService = new DurableOmrApplicationService({ ...nonIdempotent.dependencies, adapter: nonIdempotentAdapter });
    const nonIdempotentRequest = { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo" as const, rights, providerTransferConsent: true as const, idempotencyKey: "non-idempotent-uncertain-create" };
    await expect(createConsentedJob(nonIdempotentService, nonIdempotentRequest)).rejects.toThrow("OMR_JOB_RECONCILIATION_REQUIRED");
    nonIdempotent.advance(5 * 60 * 1_000 + 1);
    await expect(createConsentedJob(nonIdempotentService, nonIdempotentRequest)).rejects.toThrow("OMR_JOB_RECONCILIATION_REQUIRED");
    expect(nonIdempotentAdapter.callCounts.create).toBe(1);

    const definitive = await harness();
    let definitiveCalls = 0;
    vi.spyOn(definitive.adapter, "createVendorJob").mockImplementation(async () => { definitiveCalls += 1; throw new OmrVendorCallError("rejected", "definitive-rejection"); });
    const definitiveService = new DurableOmrApplicationService({ ...definitive.dependencies, adapter: definitive.adapter });
    const definitiveRequest = { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo" as const, rights, providerTransferConsent: true as const, idempotencyKey: "definitive-rejection" };
    await expect(createConsentedJob(definitiveService, definitiveRequest)).rejects.toThrow("OMR_VENDOR_OPERATION_FAILED");
    expect(definitive.store.listJobs()[0]).toMatchObject({
      state: "failed", vendorCreateOutcomeState: "definitive-no-job",
      creditState: "released",
    });
    expect(definitive.store.listJobs()[0].vendorJobIdEnvelope).toBeUndefined();
    definitive.advance(5 * 60 * 1_000 + 1);
    await expect(createConsentedJob(definitiveService, definitiveRequest)).rejects.toThrow("OMR_VENDOR_OPERATION_FAILED");
    expect(definitiveCalls).toBe(1);
    definitive.advance(24 * 60 * 60 * 1_000);
    await expect(definitiveService.cleanupExpiredJobs()).resolves.toEqual([{
      jobId: "1", result: { localHandleDeleted: true, vendor: { status: "deleted" } },
    }]);
    expect(definitive.adapter.callCounts.delete).toBe(0);
    expect(definitive.store.listJobs()[0]).toMatchObject({
      state: "deleted", vendorCreateOutcomeState: "definitive-no-job", vendorDeleteState: "deleted",
      localDeleteState: "deleted", creditState: "released", vendorJobIdEnvelope: undefined,
      cleanupLeaseToken: undefined, cleanupLeaseExpiresAt: undefined,
    });
  });

  it("keeps status reads side-effect free and fences concurrent result capture, page completion, and cleanup", async () => {
    const resultHarness = await harness([{ kind: "completed" }]);
    const resultHandle = await createConsentedJob(resultHarness.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "concurrent-result" });
    await resultHarness.service.uploadPage(resultHandle, { pageIndex: 0, pageDigest: resultHarness.pageDigest, mimeType: "image/png", idempotencyKey: "concurrent-result-page", bytes: new Blob([resultHarness.pageBytes.slice().buffer as ArrayBuffer]) });
    await resultHarness.service.start(resultHandle);
    expect(await resultHarness.service.getStatus(resultHandle)).toEqual({ kind: "queued" });
    expect(resultHarness.adapter.callCounts.status).toBe(0);
    await Promise.all([resultHarness.service.synchronizeStatus(resultHandle), resultHarness.service.synchronizeStatus(resultHandle)]);
    expect(await resultHarness.service.getStatus(resultHandle)).toEqual({ kind: "completed" });
    expect(resultHarness.adapter.callCounts.export).toBe(1);
    expect(resultHarness.adapter.callCounts.evidence).toBe(1);
    expect(resultHarness.adapter.callCounts.mapping).toBe(1);

    const race = await harness();
    let releaseCompletion!: () => void;
    let completionEntered!: () => void;
    const entered = new Promise<void>((resolve) => { completionEntered = resolve; });
    const gate = new Promise<void>((resolve) => { releaseCompletion = resolve; });
    const raceStore = new Proxy(race.store, {
      get(target, property, receiver) {
        if (property === "completePage") return async (...args: Parameters<OmrStore["completePage"]>) => { completionEntered(); await gate; return target.completePage(...args); };
        const value = Reflect.get(target, property, receiver) as unknown; return typeof value === "function" ? value.bind(target) : value;
      },
    }) as OmrStore;
    const raceService = new DurableOmrApplicationService({ ...race.dependencies, store: raceStore });
    const raceHandle = await createConsentedJob(raceService, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "page-delete-race" });
    const uploading = raceService.uploadPage(raceHandle, { pageIndex: 0, pageDigest: race.pageDigest, mimeType: "image/png", idempotencyKey: "page-delete-race-upload", bytes: new Blob([race.pageBytes.slice().buffer as ArrayBuffer]) });
    await entered;
    await raceService.delete(raceHandle);
    releaseCompletion();
    await uploading;
    expect(race.store.listJobs()[0]).toMatchObject({ state: "deleted", resultObjectReferenceId: undefined });
    expect(race.objects.buffers.size).toBe(0);

    const cleanup = await harness();
    await createConsentedJob(cleanup.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "two-cleanup-workers" });
    cleanup.advance(24 * 60 * 60 * 1_000 + 1);
    const workers = await Promise.all([cleanup.service.cleanupExpiredJobs(), cleanup.service.cleanupExpiredJobs()]);
    expect(workers.flat()).toHaveLength(1);
    expect(cleanup.store.listJobs()[0].cleanupLeaseToken).toBeUndefined();
  });

  it("binds submit-input resume to the exact operation request digest", async () => {
    const h = await harness([{ kind: "needs-input", request: { kind: "select-instrument", requestId: "digest-input", choices: ["Voice", "Piano"] } }]);
    const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "input-digest-job" });
    await h.service.uploadPage(handle, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "input-digest-page", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) });
    await h.service.start(handle); await h.service.synchronizeStatus(handle);
    const job = h.store.listJobs()[0];
    const firstInput = { kind: "select-instrument" as const, requestId: "digest-input", choice: "Voice" };
    const digest = await semanticDigest({ projectionSchema: "hm-omr-vendor-input-v1", input: firstInput });
    await h.store.claimOperation({ jobId: job.id, kind: "submit-input", operationRequestDigest: digest, expectedStates: ["needs-input"], leaseToken: "abandoned-input", leaseExpiresAt: "2026-01-01T00:00:01.000Z", supportsIdempotency: true, now: "2026-01-01T00:00:00.000Z" });
    h.advance(1_001);
    await expect(h.service.submitInput(handle, { ...firstInput, choice: "Piano" })).rejects.toThrow("OMR_VENDOR_INPUT_CONFLICT");
    expect(h.adapter.callCounts.input).toBe(0);
  });

  it("rejects stale frame page/digest bindings before making a result authoritative", async () => {
    const h = await harness([{ kind: "completed" }]);
    const staleFixture: ReferenceOmrFixture = {
      ...h.fixture,
      id: "stale-frame-binding",
      evidence: {
        ...h.fixture.evidence,
        frames: h.fixture.evidence.frames.map((frame) => ({ ...frame, pageIndex: 1, imageDigest: "f".repeat(64) as typeof frame.imageDigest })),
      },
    };
    const adapter = new ReferenceOmrVendorAdapter([staleFixture]);
    const service = new DurableOmrApplicationService({ ...h.dependencies, adapter });
    const handle = await createConsentedJob(service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "stale-frame-binding" });
    await service.uploadPage(handle, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "stale-frame-page", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) });
    await service.start(handle);
    await expect(service.synchronizeStatus(handle)).resolves.toEqual(expect.objectContaining({ kind: "failed", code: "OMR_RESULT_INTEGRITY_FAILED" }));
    expect(h.store.listJobs()[0]).toMatchObject({ state: "failed" });
    expect(h.store.listJobs()[0]).not.toHaveProperty("resultObjectReferenceId");
  });
});
