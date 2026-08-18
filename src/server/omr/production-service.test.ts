import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { binaryDigest } from "../../domain/digest/canonical";
import { OMR_VENDOR_ADAPTER_CONTRACT_VERSION, OmrVendorCallError } from "../../domain/omr/contracts";
import { coordinateMicrounit } from "../../domain/omr/foundation";
import { basisPoints } from "../../domain/rates";
import type { PrivateRowId } from "../persistence/store";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import { MemoryOwnedObjectStore } from "../storage/memory-owned-object-store.test-adapter";
import { omrQuotaConfig } from "./application-service";
import { ReferenceOmrVendorAdapter, type ReferenceOmrFixture } from "./reference-adapter";
import {
  createProductionOmrApplicationService,
  createProductionOmrProviderRegistry,
  type ProductionOmrProviderRegistration,
  type ProductionOmrProviderRegistry,
} from "./production-service";
import { MemoryOmrStore } from "./store";

const rights = { basis: "self-authored" as const, allowedUses: ["provider-transfer", "generation"] as const };
const musicXml = "<?xml version=\"1.0\"?><score-partwise version=\"4.0\"><part-list/></score-partwise>";

describe("production OMR provider composition", () => {
  let clock: Date;

  beforeEach(() => { clock = new Date("2026-01-01T00:00:00.000Z"); });

  async function setup() {
    const pageBytes = new TextEncoder().encode("production-provider-rotation-page");
    const pageDigest = await binaryDigest(pageBytes);
    const fixtureFor = (vendorId: string): ReferenceOmrFixture => ({
      id: `fixture:${vendorId}`,
      orderedPageDigests: [pageDigest],
      statusScript: [{ kind: "completed" }],
      musicXml,
      evidence: {
        granularity: "page",
        frames: [{ id: "frame:page", pageIndex: 0, coordinateSpace: "normalized-original", widthPixels: 100, heightPixels: 120, imageDigest: pageDigest }],
        transforms: [],
        evidence: [{
          id: "evidence:page", granularity: "page", vendorId,
          box: { frameId: "frame:page", xMu: coordinateMicrounit(0), yMu: coordinateMicrounit(0), widthMu: coordinateMicrounit(1_000_000), heightMu: coordinateMicrounit(1_000_000) },
        }],
      },
      retentionInfo: { canDeleteImmediately: true, policyReference: `${vendorId}-retention` },
    });
    const adapterA = new ReferenceOmrVendorAdapter([fixtureFor("provider-a")], { vendorId: "provider-a", vendorDisplayName: "Provider A" });
    const adapterB = new ReferenceOmrVendorAdapter([fixtureFor("provider-b")], { vendorId: "provider-b", vendorDisplayName: "Provider B" });
    const registrationA: ProductionOmrProviderRegistration = {
      providerId: "provider-a", configurationGeneration: "config-generation-1",
      adapterContractVersion: OMR_VENDOR_ADAPTER_CONTRACT_VERSION, adapter: adapterA,
    };
    const registrationB: ProductionOmrProviderRegistration = {
      providerId: "provider-b", configurationGeneration: "config-generation-2",
      adapterContractVersion: OMR_VENDOR_ADAPTER_CONTRACT_VERSION, adapter: adapterB,
    };
    const store = new MemoryOmrStore();
    const objects = new MemoryOwnedObjectStore(new MemoryGovernanceStore());
    const common = {
      store, objects,
      handleHmacKey: new Uint8Array(32).fill(1), vendorJobEncryptionKey: new Uint8Array(32).fill(2),
      quota: omrQuotaConfig(100), actor: { sessionId: "session:1" as PrivateRowId, ipOwnerHash: "ip:hmac:1" },
      inspectPage: async (input: { readonly bytes: Uint8Array; readonly mimeType: string }) => ({
        bytes: Uint8Array.from(input.bytes), digest: await binaryDigest(input.bytes), mimeType: input.mimeType,
        width: 100, height: 120,
        quality: { blurBp: basisPoints(100), perspectiveBp: basisPoints(100), glareBp: basisPoints(100), cropRiskBp: basisPoints(100), estimatedStaffSpacePixels: 20, status: "pass" as const, reasons: [] },
      }),
      now: () => new Date(clock),
    };
    const serviceFor = (providers: ProductionOmrProviderRegistry) => createProductionOmrApplicationService({ ...common, providers });
    const createRequest = async (providers: ProductionOmrProviderRegistry, idempotencyKey: string) => {
      const service = serviceFor(providers);
      const preflight = await service.getProviderPreflight();
      return {
        service,
        request: {
          sessionId: "session:1", pageCount: 1,
          pages: [{ pageIndex: 0, pageDigest, mimeType: "image/png" as const }],
          sourceKind: "camera-photo" as const, rights, providerTransferConsent: true as const,
          consentCapabilitySnapshotDigest: preflight.capabilitySnapshotDigest, idempotencyKey,
        },
      };
    };
    return {
      pageBytes, pageDigest, adapterA, adapterB, registrationA, registrationB, store, objects, serviceFor, createRequest,
      advance(ms: number) { clock = new Date(clock.getTime() + ms); },
    };
  }

  async function createCompletedJob(h: Awaited<ReturnType<typeof setup>>, providers: ProductionOmrProviderRegistry, idempotencyKey: string) {
    const prepared = await h.createRequest(providers, idempotencyKey);
    const handle = await prepared.service.createJob(prepared.request);
    await prepared.service.uploadPage(handle, {
      pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: `${idempotencyKey}-upload`,
      bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer], { type: "image/png" }),
    });
    await prepared.service.start(handle);
    expect(await prepared.service.synchronizeStatus(handle)).toEqual({ kind: "completed" });
    return handle;
  }

  it("keeps old Provider A jobs on A after Provider B becomes active", async () => {
    const h = await setup();
    const generation1 = await createProductionOmrProviderRegistry({ active: h.registrationA });
    const generation2 = await createProductionOmrProviderRegistry({ active: h.registrationB, historical: [h.registrationA] });
    const changedConfiguration = await createProductionOmrProviderRegistry({
      active: { ...h.registrationA, configurationGeneration: "config-generation-2" },
    });
    expect(generation1.active.bindingId).not.toBe("configured-real");
    expect(changedConfiguration.active.bindingId).not.toBe(generation1.active.bindingId);

    let vendorJobIdA: string | undefined;
    const originalCreateA = h.adapterA.createVendorJob.bind(h.adapterA);
    vi.spyOn(h.adapterA, "createVendorJob").mockImplementation(async (request) => {
      const id = await originalCreateA(request); vendorJobIdA = id; return id;
    });
    const bCapabilities = vi.spyOn(h.adapterB, "getCapabilities");
    const bUpload = vi.spyOn(h.adapterB, "uploadPage");
    const bStart = vi.spyOn(h.adapterB, "startVendorJob");
    const bStatus = vi.spyOn(h.adapterB, "getVendorStatus");
    const bExport = vi.spyOn(h.adapterB, "exportMusicXml");
    const bEvidence = vi.spyOn(h.adapterB, "getEvidence");
    const bMapping = vi.spyOn(h.adapterB, "getNormalizationMapping");
    const bRetention = vi.spyOn(h.adapterB, "getRetentionInfo");
    const bDelete = vi.spyOn(h.adapterB, "deleteVendorJob");

    const preparedA = await h.createRequest(generation1, "production-provider-a-job");
    const handleA = await preparedA.service.createJob(preparedA.request);
    expect(h.store.listJobs()[0].providerBindingId).toBe(generation1.active.bindingId);

    const rotated = h.serviceFor(generation2);
    expect(await rotated.createJob(preparedA.request)).toBe(handleA);
    expect(bCapabilities).not.toHaveBeenCalled();
    await rotated.uploadPage(handleA, {
      pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "production-provider-a-upload",
      bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer], { type: "image/png" }),
    });
    await rotated.start(handleA);
    expect(await rotated.synchronizeStatus(handleA)).toEqual({ kind: "completed" });
    expect((await rotated.exportResult(handleA)).vendorId).toBe("provider-a");
    await rotated.delete(handleA);
    expect(h.adapterA.callCounts).toMatchObject({ create: 1, upload: 1, start: 1, status: 1, export: 1, evidence: 1, mapping: 1, retention: 1, delete: 1 });

    const bVendorCalls = [bUpload, bStart, bStatus, bExport, bEvidence, bMapping, bRetention, bDelete]
      .flatMap((spy) => spy.mock.calls.map((call) => call[0]));
    expect(bVendorCalls.filter((vendorJobId) => vendorJobId === vendorJobIdA)).toHaveLength(0);

    const preparedB = await h.createRequest(generation2, "production-provider-b-job");
    const handleB = await preparedB.service.createJob(preparedB.request);
    expect(handleB).not.toBe(handleA);
    expect(h.adapterB.callCounts.create).toBe(1);
    expect(h.store.listJobs().map((job) => job.providerBindingId)).toEqual([generation1.active.bindingId, generation2.active.bindingId]);
  });

  it("fails closed without calling active B when an old A binding is unavailable", async () => {
    const h = await setup();
    const generation1 = await createProductionOmrProviderRegistry({ active: h.registrationA });
    const generation3 = await createProductionOmrProviderRegistry({ active: h.registrationB });
    const prepared = await h.createRequest(generation1, "unavailable-provider-a-binding");
    const handle = await prepared.service.createJob(prepared.request);
    await prepared.service.uploadPage(handle, {
      pageIndex: 0, pageDigest: h.pageDigest, mimeType: "image/png", idempotencyKey: "unavailable-provider-a-upload",
      bytes: new Blob([h.pageBytes.slice().buffer as ArrayBuffer], { type: "image/png" }),
    });
    await prepared.service.start(handle);
    const activeBStatus = vi.spyOn(h.adapterB, "getVendorStatus");
    expect(await h.serviceFor(generation3).synchronizeStatus(handle)).toMatchObject({
      kind: "reconciliation-required", code: "OMR_JOB_RECONCILIATION_REQUIRED",
    });
    expect(h.store.listJobs()[0]).toMatchObject({
      state: "reconciliation-required", reconciliationKind: "sync", publicFailureCode: "OMR_PROVIDER_BINDING_UNAVAILABLE",
    });
    expect(activeBStatus).not.toHaveBeenCalled();
  });

  it("replays a response-lost A create before any new active-B preflight or create", async () => {
    const h = await setup();
    const generation1 = await createProductionOmrProviderRegistry({ active: h.registrationA });
    const generation2 = await createProductionOmrProviderRegistry({ active: h.registrationB, historical: [h.registrationA] });
    const prepared = await h.createRequest(generation1, "provider-a-response-loss");
    const originalCreate = h.adapterA.createVendorJob.bind(h.adapterA);
    let loseFirstResponse = true;
    vi.spyOn(h.adapterA, "createVendorJob").mockImplementation(async (request) => {
      const id = await originalCreate(request);
      if (loseFirstResponse) { loseFirstResponse = false; throw new OmrVendorCallError("response lost", "outcome-uncertain"); }
      return id;
    });
    await expect(prepared.service.createJob(prepared.request)).rejects.toThrow("OMR_IDEMPOTENCY_PENDING");
    clock = new Date(clock.getTime() + 5 * 60 * 1_000 + 1);
    const bCapabilities = vi.spyOn(h.adapterB, "getCapabilities");
    const bCreate = vi.spyOn(h.adapterB, "createVendorJob");
    const replayed = await h.serviceFor(generation2).createJob(prepared.request);
    expect(replayed).toMatch(/^v1\./u);
    expect(bCapabilities).not.toHaveBeenCalled();
    expect(bCreate).not.toHaveBeenCalled();
    expect(h.adapterA.callCounts.create).toBe(1);
    expect(h.store.listJobs()[0]).toMatchObject({ providerBindingId: generation1.active.bindingId, state: "created" });
  });

  it("reconciles an idempotent response-lost A create during expiry cleanup before deleting the same A job", async () => {
    const h = await setup();
    const generation1 = await createProductionOmrProviderRegistry({ active: h.registrationA });
    const generation2 = await createProductionOmrProviderRegistry({ active: h.registrationB, historical: [h.registrationA] });
    const prepared = await h.createRequest(generation1, "provider-a-expiry-reconciliation");
    const originalCreate = h.adapterA.createVendorJob.bind(h.adapterA);
    const observedIds: string[] = [];
    let loseFirstResponse = true;
    const aCreate = vi.spyOn(h.adapterA, "createVendorJob").mockImplementation(async (request) => {
      const id = await originalCreate(request); observedIds.push(id);
      if (loseFirstResponse) { loseFirstResponse = false; throw new OmrVendorCallError("response lost", "outcome-uncertain"); }
      return id;
    });
    const persistRecoveredId = vi.spyOn(h.store, "completeVendorCreation");
    const aDelete = vi.spyOn(h.adapterA, "deleteVendorJob");
    const bCapabilities = vi.spyOn(h.adapterB, "getCapabilities");
    const bCreate = vi.spyOn(h.adapterB, "createVendorJob");
    const bDelete = vi.spyOn(h.adapterB, "deleteVendorJob");
    const bRetention = vi.spyOn(h.adapterB, "getRetentionInfo");

    await expect(prepared.service.createJob(prepared.request)).rejects.toThrow("OMR_IDEMPOTENCY_PENDING");
    const uncertain = h.store.listJobs()[0];
    expect(uncertain).toMatchObject({
      vendorCreateOutcomeState: "outcome-uncertain",
      creditState: "reserved", providerBindingId: generation1.active.bindingId,
    });
    expect(uncertain.vendorJobIdEnvelope).toBeUndefined();
    h.advance(24 * 60 * 60 * 1_000 + 1);

    await expect(h.serviceFor(generation2).cleanupExpiredJobs()).resolves.toEqual([{
      jobId: "1", result: { localHandleDeleted: true, vendor: { status: "deleted" } },
    }]);
    expect(aCreate).toHaveBeenCalledTimes(2);
    expect(aCreate.mock.calls[1][0]).toEqual(aCreate.mock.calls[0][0]);
    expect(observedIds).toHaveLength(2); expect(observedIds[1]).toBe(observedIds[0]);
    expect(h.adapterA.callCounts.create).toBe(1);
    expect(persistRecoveredId).toHaveBeenCalledTimes(1);
    expect(aDelete).toHaveBeenCalledTimes(1); expect(aDelete.mock.calls[0][0]).toBe(observedIds[0]);
    expect(bCapabilities).not.toHaveBeenCalled(); expect(bCreate).not.toHaveBeenCalled();
    expect(bDelete).not.toHaveBeenCalled(); expect(bRetention).not.toHaveBeenCalled();
    expect(h.store.listJobs()[0]).toMatchObject({
      state: "deleted", vendorCreateOutcomeState: "confirmed", vendorDeleteState: "deleted",
      localDeleteState: "deleted", vendorJobIdEnvelope: undefined, creditState: "released",
      cleanupLeaseToken: undefined, cleanupLeaseExpiresAt: undefined,
    });
  });

  it("keeps an unavailable idempotent A create uncertain through expiry and reconciles only after exact A restoration", async () => {
    const h = await setup();
    const generation1 = await createProductionOmrProviderRegistry({ active: h.registrationA });
    const generation2 = await createProductionOmrProviderRegistry({ active: h.registrationB });
    const generation3 = await createProductionOmrProviderRegistry({ active: h.registrationB, historical: [h.registrationA] });
    const prepared = await h.createRequest(generation1, "provider-a-unavailable-expiry-reconciliation");
    const originalCreate = h.adapterA.createVendorJob.bind(h.adapterA);
    let loseFirstResponse = true;
    const aCreate = vi.spyOn(h.adapterA, "createVendorJob").mockImplementation(async (request) => {
      const id = await originalCreate(request);
      if (loseFirstResponse) { loseFirstResponse = false; throw new OmrVendorCallError("response lost", "outcome-uncertain"); }
      return id;
    });
    const aDelete = vi.spyOn(h.adapterA, "deleteVendorJob");
    const bCapabilities = vi.spyOn(h.adapterB, "getCapabilities");
    const bCreate = vi.spyOn(h.adapterB, "createVendorJob");
    const bDelete = vi.spyOn(h.adapterB, "deleteVendorJob");
    const bRetention = vi.spyOn(h.adapterB, "getRetentionInfo");

    await expect(prepared.service.createJob(prepared.request)).rejects.toThrow("OMR_IDEMPOTENCY_PENDING");
    const createKey = h.store.listJobs()[0].vendorCreateIdempotencyKey;
    h.advance(24 * 60 * 60 * 1_000 + 1);
    await expect(h.serviceFor(generation2).cleanupExpiredJobs()).resolves.toHaveLength(1);
    expect(aCreate).toHaveBeenCalledTimes(1); expect(aDelete).not.toHaveBeenCalled();
    expect(bCapabilities).not.toHaveBeenCalled(); expect(bCreate).not.toHaveBeenCalled();
    expect(bDelete).not.toHaveBeenCalled(); expect(bRetention).not.toHaveBeenCalled();
    const pending = h.store.listJobs()[0];
    expect(pending).toMatchObject({
      state: "delete-pending", vendorCreateOutcomeState: "outcome-uncertain",
      vendorDeleteState: "failed", localDeleteState: "deleted", creditState: "reserved",
      providerBindingId: generation1.active.bindingId, adapterContractVersion: OMR_VENDOR_ADAPTER_CONTRACT_VERSION,
      vendorCreateIdempotencyKey: createKey,
      publicFailureCode: "OMR_PROVIDER_BINDING_UNAVAILABLE",
      cleanupLeaseToken: undefined, cleanupLeaseExpiresAt: undefined,
    });
    expect(pending.vendorJobIdEnvelope).toBeUndefined();
    expect(pending.vendorDeleteNextAttemptAt).toBeDefined();

    h.advance(60_001);
    await expect(h.serviceFor(generation3).cleanupExpiredJobs()).resolves.toHaveLength(1);
    expect(aCreate).toHaveBeenCalledTimes(2); expect(aCreate.mock.calls[1][0].idempotencyKey).toBe(createKey);
    expect(aDelete).toHaveBeenCalledTimes(1);
    expect(bCreate).not.toHaveBeenCalled(); expect(bDelete).not.toHaveBeenCalled(); expect(bRetention).not.toHaveBeenCalled();
    expect(h.store.listJobs()[0]).toMatchObject({
      state: "deleted", vendorCreateOutcomeState: "confirmed", vendorDeleteState: "deleted",
      localDeleteState: "deleted", creditState: "released", vendorJobIdEnvelope: undefined,
      cleanupLeaseToken: undefined, cleanupLeaseExpiresAt: undefined,
    });
  });

  it("keeps local cleanup and Vendor retry durable when user delete cannot resolve historical A", async () => {
    const h = await setup();
    const generation1 = await createProductionOmrProviderRegistry({ active: h.registrationA });
    const generation2 = await createProductionOmrProviderRegistry({ active: h.registrationB });
    const generation3 = await createProductionOmrProviderRegistry({ active: h.registrationB, historical: [h.registrationA] });
    let vendorJobIdA: string | undefined;
    const originalCreateA = h.adapterA.createVendorJob.bind(h.adapterA);
    vi.spyOn(h.adapterA, "createVendorJob").mockImplementation(async (request) => {
      const id = await originalCreateA(request); vendorJobIdA = id; return id;
    });
    const aDelete = vi.spyOn(h.adapterA, "deleteVendorJob");
    const bDelete = vi.spyOn(h.adapterB, "deleteVendorJob");
    const bRetention = vi.spyOn(h.adapterB, "getRetentionInfo");
    const handle = await createCompletedJob(h, generation1, "unavailable-a-user-delete");
    const before = h.store.listJobs()[0];
    const pageObjectId = before.pages[0].objectReferenceId;
    const resultObjectId = before.resultObjectReferenceId;
    expect(pageObjectId).toBeDefined(); expect(resultObjectId).toBeDefined();
    await expect(h.objects.get(pageObjectId!, before.ownerSessionId)).resolves.toBeDefined();
    await expect(h.objects.get(resultObjectId!, before.ownerSessionId)).resolves.toBeDefined();

    await expect(h.serviceFor(generation2).delete(handle)).resolves.toMatchObject({
      localHandleDeleted: true,
      vendor: { status: "failed", code: "OMR_PROVIDER_BINDING_UNAVAILABLE" },
    });
    expect(bDelete).not.toHaveBeenCalled(); expect(bRetention).not.toHaveBeenCalled();
    expect(aDelete).not.toHaveBeenCalled();
    const pending = h.store.listJobs()[0];
    expect(pending).toMatchObject({
      state: "delete-pending", handleActive: false,
      vendorDeleteState: "failed", localDeleteState: "deleted",
      vendorDeleteResult: { status: "failed", code: "OMR_PROVIDER_BINDING_UNAVAILABLE" },
      publicFailureCode: "OMR_PROVIDER_BINDING_UNAVAILABLE",
      providerBindingId: generation1.active.bindingId,
      adapterContractVersion: OMR_VENDOR_ADAPTER_CONTRACT_VERSION,
      vendorJobIdEnvelope: expect.any(Object),
      resultObjectReferenceId: undefined, evidence: undefined, normalizationMapping: undefined,
    });
    expect(pending.vendorDeleteNextAttemptAt).toBeDefined();
    await expect(h.objects.get(pageObjectId!, before.ownerSessionId)).rejects.toThrow("OBJECT_UNAVAILABLE");
    await expect(h.objects.get(resultObjectId!, before.ownerSessionId)).rejects.toThrow("OBJECT_UNAVAILABLE");

    h.advance(60_001);
    await expect(h.serviceFor(generation3).cleanupExpiredJobs()).resolves.toHaveLength(1);
    expect(aDelete).toHaveBeenCalledTimes(1);
    expect(aDelete.mock.calls[0][0]).toBe(vendorJobIdA);
    expect(bDelete).not.toHaveBeenCalled(); expect(bRetention).not.toHaveBeenCalled();
    expect(h.store.listJobs()[0]).toMatchObject({
      state: "deleted", vendorDeleteState: "deleted", localDeleteState: "deleted",
      vendorJobIdEnvelope: undefined, cleanupLeaseToken: undefined, cleanupLeaseExpiresAt: undefined,
    });
  });

  it("completes cleanup leases and local deletion when expired-job historical A is unavailable", async () => {
    const h = await setup();
    const generation1 = await createProductionOmrProviderRegistry({ active: h.registrationA });
    const generation2 = await createProductionOmrProviderRegistry({ active: h.registrationB });
    const bDelete = vi.spyOn(h.adapterB, "deleteVendorJob");
    const bRetention = vi.spyOn(h.adapterB, "getRetentionInfo");
    await createCompletedJob(h, generation1, "unavailable-a-expired-cleanup");
    const before = h.store.listJobs()[0];
    const pageObjectId = before.pages[0].objectReferenceId;
    const resultObjectId = before.resultObjectReferenceId;
    expect(pageObjectId).toBeDefined(); expect(resultObjectId).toBeDefined();
    h.advance(24 * 60 * 60 * 1_000 + 1);

    await expect(h.serviceFor(generation2).cleanupExpiredJobs()).resolves.toEqual([{
      jobId: "1",
      result: { localHandleDeleted: true, vendor: expect.objectContaining({ status: "failed", code: "OMR_PROVIDER_BINDING_UNAVAILABLE" }) },
    }]);
    expect(bDelete).not.toHaveBeenCalled(); expect(bRetention).not.toHaveBeenCalled();
    const pending = h.store.listJobs()[0];
    expect(pending).toMatchObject({
      state: "delete-pending", handleActive: false,
      vendorDeleteState: "failed", localDeleteState: "deleted",
      vendorDeleteResult: { status: "failed", code: "OMR_PROVIDER_BINDING_UNAVAILABLE" },
      publicFailureCode: "OMR_PROVIDER_BINDING_UNAVAILABLE",
      providerBindingId: generation1.active.bindingId,
      vendorJobIdEnvelope: expect.any(Object),
      cleanupLeaseToken: undefined, cleanupLeaseExpiresAt: undefined,
    });
    expect(pending.vendorDeleteNextAttemptAt).toBeDefined();
    await expect(h.objects.get(pageObjectId!, before.ownerSessionId)).rejects.toThrow("OBJECT_UNAVAILABLE");
    await expect(h.objects.get(resultObjectId!, before.ownerSessionId)).rejects.toThrow("OBJECT_UNAVAILABLE");
  });

  it("uses the same historical A adapter for transient delete retention and retry", async () => {
    const h = await setup();
    const generation1 = await createProductionOmrProviderRegistry({ active: h.registrationA });
    const generation2 = await createProductionOmrProviderRegistry({ active: h.registrationB, historical: [h.registrationA] });
    let vendorJobIdA: string | undefined;
    const originalCreateA = h.adapterA.createVendorJob.bind(h.adapterA);
    vi.spyOn(h.adapterA, "createVendorJob").mockImplementation(async (request) => {
      const id = await originalCreateA(request); vendorJobIdA = id; return id;
    });
    const originalDeleteA = h.adapterA.deleteVendorJob.bind(h.adapterA);
    const aDelete = vi.spyOn(h.adapterA, "deleteVendorJob")
      .mockRejectedValueOnce(new Error("temporary Provider A deletion failure"))
      .mockImplementation(originalDeleteA);
    const aRetention = vi.spyOn(h.adapterA, "getRetentionInfo");
    const bDelete = vi.spyOn(h.adapterB, "deleteVendorJob");
    const bRetention = vi.spyOn(h.adapterB, "getRetentionInfo");
    const handle = await createCompletedJob(h, generation1, "historical-a-delete-retry");
    const rotated = h.serviceFor(generation2);
    const retentionCallsBeforeDelete = aRetention.mock.calls.length;

    await expect(rotated.delete(handle)).resolves.toMatchObject({ localHandleDeleted: true, vendor: { status: "failed", code: "OMR_VENDOR_DELETE_FAILED" } });
    expect(aDelete).toHaveBeenCalledTimes(1); expect(aDelete.mock.calls[0][0]).toBe(vendorJobIdA);
    expect(aRetention).toHaveBeenCalledTimes(retentionCallsBeforeDelete + 1);
    expect(aRetention.mock.calls.at(-1)?.[0]).toBe(vendorJobIdA);
    expect(bDelete).not.toHaveBeenCalled(); expect(bRetention).not.toHaveBeenCalled();
    expect(h.store.listJobs()[0]).toMatchObject({
      state: "delete-pending", vendorDeleteState: "failed", localDeleteState: "deleted",
      vendorJobIdEnvelope: expect.any(Object), providerBindingId: generation1.active.bindingId,
    });

    h.advance(60_001);
    await expect(rotated.cleanupExpiredJobs()).resolves.toHaveLength(1);
    expect(aDelete).toHaveBeenCalledTimes(2); expect(aDelete.mock.calls[1][0]).toBe(vendorJobIdA);
    expect(bDelete).not.toHaveBeenCalled(); expect(bRetention).not.toHaveBeenCalled();
    expect(h.store.listJobs()[0]).toMatchObject({ state: "deleted", vendorJobIdEnvelope: undefined });
  });
});
