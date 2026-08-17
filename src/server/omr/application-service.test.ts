import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { binaryDigest, type BinaryDigest } from "../../domain/digest/canonical";
import { coordinateMicrounit } from "../../domain/omr/foundation";
import { basisPoints } from "../../domain/rates";
import type { PrivateRowId } from "../persistence/store";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import { MemoryOwnedObjectStore } from "../storage/memory-owned-object-store.test-adapter";
import { DurableOmrApplicationService, omrQuotaConfig } from "./application-service";
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

async function createConsentedJob(service: DurableOmrApplicationService, request: Omit<Parameters<DurableOmrApplicationService["createJob"]>[0], "consentCapabilitySnapshotDigest">) {
  const preflight = await service.getProviderPreflight();
  return service.createJob({ ...request, consentCapabilitySnapshotDigest: preflight.capabilitySnapshotDigest });
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
    expect(await h.service.getStatus(handle)).toEqual({ kind: "queued" });
    expect(await h.service.getStatus(handle)).toEqual({ kind: "processing", progressBp: 5000 });
    expect(await h.service.getStatus(handle)).toEqual({ kind: "completed" });
    const result = await h.service.exportResult(handle);
    expect(result.rawMusicXml).toBe(musicXml);
    expect(result.evidence.evidence).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("reference-job:");
    await expect(h.service.delete(handle)).resolves.toEqual({ localHandleDeleted: true, vendor: { status: "deleted" } });
    await expect(h.service.delete(handle)).resolves.toEqual({ localHandleDeleted: true, vendor: { status: "deleted" } });
    expect(h.adapter.callCounts.delete).toBe(1);
    expect(h.store.listJobs()[0].vendorJobIdEnvelope).toBeUndefined();
    await expect(h.service.getStatus(handle)).rejects.toThrow("OMR_JOB_UNAVAILABLE");
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
    h.advance(5 * 60 * 1_000 + 1);
    const recoveredHandle = await createConsentedJob(service, request);
    expect(h.adapter.callCounts.create).toBe(1);
    expect(await service.getStatus(recoveredHandle)).toEqual({ kind: "created" });
  });

  it("enforces owner, handle authentication, exact concurrency quota, and digest conflicts", async () => {
    const h = await harness();
    const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "create-key-0001" });
    await expect(createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "create-key-0002" })).rejects.toThrow("OMR_QUOTA_EXCEEDED");
    const foreign = new DurableOmrApplicationService({ ...h.dependencies, actor: { sessionId: "session:2" as PrivateRowId, ipOwnerHash: "ip:hmac:2" } });
    await expect(foreign.getStatus(handle)).rejects.toThrow("OMR_JOB_UNAVAILABLE");
    const tamperedHandle = `${handle.slice(0, -1)}${handle.endsWith("0") ? "1" : "0"}`;
    await expect(h.service.getStatus(tamperedHandle as never)).rejects.toThrow("OMR_JOB_UNAVAILABLE");
    const wrong = "f".repeat(64) as BinaryDigest;
    await expect(h.service.uploadPage(handle, { pageIndex: 0, pageDigest: wrong, mimeType: "image/png", idempotencyKey: "upload-key-0001", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) })).rejects.toThrow("OMR_PAGE_DIGEST_MISMATCH");
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
    await h.service.getStatus(handle);
    expect(await h.service.getStatus(handle)).toMatchObject({ kind: "needs-input" });
    await expect(h.service.submitInput(handle, { kind: "select-instrument", requestId: "request:1", choice: "drums" })).rejects.toThrow("OMR_VENDOR_INPUT_INVALID");
    await h.service.submitInput(handle, { kind: "select-instrument", requestId: "request:1", choice: "voice" });
    await h.service.submitInput(handle, { kind: "select-instrument", requestId: "request:1", choice: "voice" });
    await expect(h.service.submitInput(handle, { kind: "select-instrument", requestId: "request:1", choice: "piano" })).rejects.toThrow("OMR_VENDOR_INPUT_CONFLICT");
    expect(h.adapter.callCounts.input).toBe(1);
    expect(await h.service.getStatus(handle)).toEqual({ kind: "processing", progressBp: 8000 });
  });

  it("validates confirm-page-order input as the exact expected set", async () => {
    const h = await harness([{ kind: "needs-input", request: { kind: "confirm-page-order", requestId: "order:1", pageIndices: [0] } }, { kind: "completed" }]);
    const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "order-key-1" });
    await h.service.uploadPage(handle, { pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "upload-key-1", bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer]) });
    await h.service.start(handle); expect(await h.service.getStatus(handle)).toMatchObject({ kind: "needs-input" });
    await expect(h.service.submitInput(handle, { kind: "confirm-page-order", requestId: "order:1", pageIndices: [1] })).rejects.toThrow("OMR_VENDOR_INPUT_INVALID");
    await h.service.submitInput(handle, { kind: "confirm-page-order", requestId: "order:1", pageIndices: [0] });
    expect(await h.service.getStatus(handle)).toEqual({ kind: "completed" });
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
    await expect(h.service.getStatus(handle)).rejects.toThrow("OMR_JOB_UNAVAILABLE");
  });

  it("claims expired jobs into the same truthful cleanup lifecycle", async () => {
    const h = await harness();
    const handle = await createConsentedJob(h.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "cleanup-expiry-key" });
    h.advance(24 * 60 * 60 * 1_000 + 1);
    await expect(h.service.cleanupExpiredJobs()).resolves.toEqual([{ jobId: "1", result: { localHandleDeleted: true, vendor: { status: "deleted" } } }]);
    expect(h.store.listJobs()[0]).toMatchObject({ state: "deleted", handleActive: false, creditState: "released" });
    await expect(h.service.getStatus(handle)).rejects.toThrow("OMR_JOB_UNAVAILABLE");
  });

  it("binds informed transfer consent to the exact provider capability snapshot", async () => {
    const h = await harness();
    const consented = await h.service.getProviderPreflight();
    vi.spyOn(h.adapter, "getCapabilities").mockResolvedValue({ ...consented.capabilities, vendorDisplayName: "Changed provider disclosure" });
    await expect(h.service.createJob({ sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, consentCapabilitySnapshotDigest: consented.capabilitySnapshotDigest, idempotencyKey: "stale-consent-key" })).rejects.toThrow("OMR_PROVIDER_CONSENT_STALE");
    expect(h.adapter.callCounts.create).toBe(0);
  });

  it("persists cancel failure and recovers every idempotent post-effect crash window through fencing", async () => {
    const failed = await harness();
    const failedHandle = await createConsentedJob(failed.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "cancel-failure-key" });
    const cancelSpy = vi.spyOn(failed.adapter, "cancelVendorJob").mockRejectedValueOnce(new Error("vendor cancel unavailable"));
    await expect(failed.service.cancel(failedHandle)).rejects.toThrow("OMR_VENDOR_CANCEL_FAILED");
    expect(await failed.service.getStatus(failedHandle)).toMatchObject({ kind: "cancel-failed", code: "OMR_VENDOR_CANCEL_FAILED" });
    cancelSpy.mockRestore();
    await expect(failed.service.cancel(failedHandle)).resolves.toBeUndefined();
    expect(await failed.service.getStatus(failedHandle)).toEqual({ kind: "cancelled" });

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
    await inputService.start(inputHandle); expect(await inputService.getStatus(inputHandle)).toMatchObject({ kind: "needs-input" });
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
  });

  it("retries Vendor and local object deletion independently for mixed delete-pending siblings", async () => {
    const h = await harness();
    const originalVendorDelete = h.adapter.deleteVendorJob.bind(h.adapter);
    let failVendorOnce = true;
    vi.spyOn(h.adapter, "deleteVendorJob").mockImplementation(async (...args) => {
      if (failVendorOnce) { failVendorOnce = false; throw new Error("vendor delete transient"); }
      return originalVendorDelete(...args);
    });
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
    h.advance(60 * 1_000 + 1);
    const cleanup = await h.service.cleanupExpiredJobs();
    expect(cleanup).toHaveLength(2);
    expect(h.store.listJobs().map((job) => job.state)).toEqual(["deleted", "deleted"]);
  });

  it("fails safely on unknown status, evidence downgrade, and missing evidence", async () => {
    const unknown = await harness([{ kind: "unknown", rawStatus: "vendor-secret-status" }]);
    const unknownHandle = await createConsentedJob(unknown.service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "unknown-key-1" });
    await unknown.service.uploadPage(unknownHandle, { pageIndex: 0, pageDigest: unknown.pageDigest, mimeType: "image/png", idempotencyKey: "upload-key-1", bytes: new Blob([unknown.pageBytes.slice().buffer as ArrayBuffer]) });
    await unknown.service.start(unknownHandle);
    expect(await unknown.service.getStatus(unknownHandle)).toEqual({ kind: "failed", code: "OMR_VENDOR_STATUS_UNKNOWN", messageKo: "인식 작업 상태를 확인할 수 없습니다." });

    const downgraded = await harness([{ kind: "completed" }]);
    const measureAdapter = new ReferenceOmrVendorAdapter([downgraded.fixture], { vendorId: "hm-reference", supportedMimeTypes: ["image/png"], maxPages: 12, evidenceGranularity: "measure", supportsDeletion: true, retentionDisclosure: true, supportsIdempotency: true, supportsInteractiveInput: true, estimatedCreditPerPage: 1 });
    const measureService = new DurableOmrApplicationService({ ...downgraded.dependencies, adapter: measureAdapter });
    const measureHandle = await createConsentedJob(measureService, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "measure-key-1" });
    await measureService.uploadPage(measureHandle, { pageIndex: 0, pageDigest: downgraded.pageDigest, mimeType: "image/png", idempotencyKey: "upload-key-1", bytes: new Blob([downgraded.pageBytes.slice().buffer as ArrayBuffer]) });
    await measureService.start(measureHandle);
    expect(await measureService.getStatus(measureHandle)).toMatchObject({ kind: "failed", code: "OMR_PROVIDER_CAPABILITY_MISSING" });

    const missingFixture = { ...downgraded.fixture, evidence: { ...downgraded.fixture.evidence, evidence: [] } };
    const missingAdapter = new ReferenceOmrVendorAdapter([missingFixture]);
    const missing = await harness([{ kind: "completed" }]);
    const missingService = new DurableOmrApplicationService({ ...missing.dependencies, adapter: missingAdapter });
    const missingHandle = await createConsentedJob(missingService, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: "missing-key-1" });
    await missingService.uploadPage(missingHandle, { pageIndex: 0, pageDigest: missing.pageDigest, mimeType: "image/png", idempotencyKey: "upload-key-1", bytes: new Blob([missing.pageBytes.slice().buffer as ArrayBuffer]) });
    await missingService.start(missingHandle);
    expect(await missingService.getStatus(missingHandle)).toMatchObject({ kind: "failed", code: "OMR_PROVIDER_CAPABILITY_MISSING" });
  });

  it("preserves truthful unsupported and failed Vendor retention outcomes", async () => {
    const base = await harness([{ kind: "completed" }]);
    const runDelete = async (adapter: ReferenceOmrVendorAdapter, key: string) => {
      const service = new DurableOmrApplicationService({ ...base.dependencies, adapter });
      const handle = await createConsentedJob(service, { sessionId: "session:1", pageCount: 1, sourceKind: "camera-photo", rights, providerTransferConsent: true, idempotencyKey: key });
      await service.uploadPage(handle, { pageIndex: 0, pageDigest: base.pageDigest, mimeType: "image/png", idempotencyKey: `${key}-upload`, bytes: new Blob([base.pageBytes.slice().buffer as ArrayBuffer]) });
      await service.start(handle); await service.getStatus(handle);
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
    await service.start(handle); expect(await service.getStatus(handle)).toEqual({ kind: "completed" });
    await expect(service.delete(handle)).resolves.toMatchObject({ localHandleDeleted: true, vendor: { status: "not-supported", retentionInfo: { vendorDeletesAt } } });
    expect(adapter.callCounts.delete).toBe(1);
    h.advance(60 * 1_000);
    await expect(service.cleanupExpiredJobs()).resolves.toEqual([]);
    h.advance(60 * 1_000 + 1);
    await expect(service.cleanupExpiredJobs()).resolves.toHaveLength(1);
    expect(adapter.callCounts.delete).toBe(2);
    expect(h.store.listJobs()[0]).toMatchObject({ state: "delete-pending", handleActive: false, vendorDeleteState: "not-supported", localDeleteState: "deleted", retentionInfo: { vendorDeletesAt } });
  });
});
