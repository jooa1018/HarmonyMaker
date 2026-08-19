import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { binaryDigest } from "../../domain/digest/canonical";
import type { OmrVendorStatus } from "../../domain/omr/contracts";
import { basisPoints } from "../../domain/rates";
import type { PrivateRowId } from "../persistence/store";
import { MemoryGovernanceStore } from "../persistence/memory-store.test-adapter";
import { MemoryOwnedObjectStore } from "../storage/memory-owned-object-store.test-adapter";
import { DurableOmrApplicationService, omrQuotaConfig } from "./application-service";
import { MemoryOmrCreateRecoveryRegistry, withCrossSessionOmrCreateRecovery } from "./cross-session-create-recovery";
import { ReferenceOmrVendorAdapter, type ReferenceOmrFixture } from "./reference-adapter";
import { MemoryOmrStore } from "./store";

const musicXml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><rest/><duration>4</duration></note></measure></part></score-partwise>`;
const rights = { basis: "self-authored" as const, allowedUses: ["provider-transfer", "generation"] as const };

async function setup() {
  const pageBytes = new TextEncoder().encode("cross-session-page");
  const pageDigest = await binaryDigest(pageBytes);
  const fixture: ReferenceOmrFixture = {
    id: "cross-session",
    orderedPageDigests: [pageDigest],
    statusScript: [{ kind: "created" } as OmrVendorStatus],
    musicXml,
    evidence: { granularity: "page", frames: [], transforms: [], evidence: [] },
    retentionInfo: { canDeleteImmediately: true, policyReference: "test" },
  };
  const adapter = new ReferenceOmrVendorAdapter([fixture]);
  const baseStore = new MemoryOmrStore();
  const recovery = new MemoryOmrCreateRecoveryRegistry();
  const store = withCrossSessionOmrCreateRecovery(baseStore, recovery);
  const governance = new MemoryGovernanceStore();
  const objects = new MemoryOwnedObjectStore(governance);
  const now = () => new Date("2026-01-01T00:00:00.000Z");
  const service = (sessionId: string) => new DurableOmrApplicationService({
    store,
    objects,
    adapter,
    handleHmacKey: new Uint8Array(32).fill(1),
    vendorJobEncryptionKey: new Uint8Array(32).fill(2),
    quota: { ...omrQuotaConfig(100), maxConcurrentJobsPerSession: 10, maxConcurrentJobsPerIp: 10 },
    actor: { sessionId: sessionId as PrivateRowId, ipOwnerHash: `ip:${sessionId}` },
    inspectPage: async ({ bytes, mimeType }) => ({
      bytes: Uint8Array.from(bytes),
      digest: await binaryDigest(bytes),
      mimeType,
      width: 100,
      height: 100,
      quality: {
        blurBp: basisPoints(0), perspectiveBp: basisPoints(0), glareBp: basisPoints(0), cropRiskBp: basisPoints(0),
        estimatedStaffSpacePixels: 20, status: "pass" as const, reasons: [],
      },
    }),
    now,
  });
  const create = async (target: DurableOmrApplicationService, key: string, sourceKind: "camera-photo" | "scanned-pdf" = "camera-photo") => {
    const preflight = await target.getProviderPreflight();
    return target.createJob({
      sessionId: "browser-session-label",
      pageCount: 1,
      pages: [{ pageIndex: 0, pageDigest, mimeType: "image/png" }],
      sourceKind,
      rights,
      providerTransferConsent: true,
      idempotencyKey: key,
      consentCapabilitySnapshotDigest: preflight.capabilitySnapshotDigest,
    });
  };
  return { adapter, baseStore, service, create };
}

describe("cross-session OMR create recovery", () => {
  it("recovers the exact one job and handle after an anonymous session replacement", async () => {
    const h = await setup();
    const first = h.service("session:1");
    const replacement = h.service("session:2");
    const handle = await h.create(first, "cross-session-create-key");

    await expect(h.create(replacement, "cross-session-create-key")).resolves.toBe(handle);
    expect(h.adapter.callCounts.create).toBe(1);
    expect(h.baseStore.listJobs()).toHaveLength(1);
    await expect(replacement.synchronizeStatus(handle)).resolves.toEqual({ kind: "created" });
  });

  it("rejects a different request digest presented with the recovered K", async () => {
    const h = await setup();
    await h.create(h.service("session:1"), "cross-session-conflict-key");
    await expect(h.create(h.service("session:2"), "cross-session-conflict-key", "scanned-pdf"))
      .rejects.toThrow("OMR_IDEMPOTENCY_CONFLICT");
    expect(h.adapter.callCounts.create).toBe(1);
    expect(h.baseStore.listJobs()).toHaveLength(1);
  });

  it("serializes concurrent first claims across sessions and converges on one provider effect", async () => {
    const h = await setup();
    const one = h.service("session:1");
    const two = h.service("session:2");
    const results = await Promise.allSettled([
      h.create(one, "cross-session-race-key"),
      h.create(two, "cross-session-race-key"),
    ]);
    const fulfilled = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const rejected = results.flatMap((result) => result.status === "rejected" ? [String(result.reason)] : []);
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(rejected.every((message) => message.includes("OMR_IDEMPOTENCY_PENDING"))).toBe(true);

    const replay = await h.create(two, "cross-session-race-key");
    expect(new Set([...fulfilled, replay]).size).toBe(1);
    expect(h.adapter.callCounts.create).toBe(1);
    expect(h.baseStore.listJobs()).toHaveLength(1);
  });
});
