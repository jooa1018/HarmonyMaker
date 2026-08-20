import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SemanticDigest } from "../../domain/digest/canonical";
import type { OmrQuotaConfig } from "../../domain/omr/contracts";
import type { PrivateRowId } from "../persistence/store";
import { MemoryOmrStore, type DurableOmrJobRecord } from "./store";

const replayEnvelope = {
  version: 1 as const,
  algorithm: "aes-256-gcm" as const,
  associatedDataVersion: "cleanup-fairness-test",
  ciphertext: "ciphertext",
  nonce: "AAAAAAAAAAAAAAAA",
  authenticationTag: "AAAAAAAAAAAAAAAAAAAAAA",
};
const quota: OmrQuotaConfig = {
  maxConcurrentJobsPerSession: 100,
  maxConcurrentJobsPerIp: 100,
  maxJobsPerSessionPerHour: 100,
  maxJobsPerIpPerHour: 100,
  dailyGlobalCreditCeiling: 1_000,
  maxPagesPerJob: 12,
  maxRetriesPerPage: 3,
};

function record(ownerSessionId: PrivateRowId, key: string): Omit<DurableOmrJobRecord, "id"> {
  const capabilitySnapshotDigest = "a".repeat(64) as SemanticDigest;
  return {
    ownerSessionId,
    ipOwnerHash: "ip:cleanup-fairness",
    publicHandleHash: `handle:${key}`,
    publicHandleReplayEnvelope: replayEnvelope,
    handleExpiresAt: "2026-01-01T00:00:00.000Z",
    sourceKind: "camera-photo",
    pageCount: 1,
    canonicalCreateRequest: {
      pageCount: 1,
      pages: [{ pageIndex: 0, pageDigest: "b".repeat(64) as never, mimeType: "image/png" }],
      sourceKind: "camera-photo",
      rights: { basis: "self-authored", allowedUses: ["provider-transfer"] },
      providerTransferConsent: true,
      consentCapabilitySnapshotDigest: capabilitySnapshotDigest,
      idempotencyKey: key,
    },
    state: "created",
    rights: { basis: "self-authored", allowedUses: ["provider-transfer"] },
    providerTransferConsent: true,
    providerConsentRecordedAt: "2025-12-31T00:00:00.000Z",
    capabilities: {
      vendorId: "cleanup-fairness-provider",
      vendorDisplayName: "Cleanup fairness provider",
      supportedMimeTypes: ["image/png"],
      transferMimeType: "image/png",
      maxPages: 12,
      evidenceGranularity: "page",
      retentionDisclosure: true,
      supportsIdempotency: false,
      supportsInteractiveInput: false,
      supportsDeletion: true,
      canDeleteImmediately: true,
      retentionPolicyReference: "test-only",
      externalTransfer: true,
      estimatedCreditPerPage: 1,
    },
    capabilitySnapshotDigest,
    providerBindingId: "cleanup-fairness-provider",
    adapterContractVersion: "omr-vendor-adapter-v1",
    vendorCreateIdempotencyKey: `vendor:${key}`,
    vendorCreateLeaseExpiresAt: "2026-01-01T00:05:00.000Z",
    vendorCreateOutcomeState: "not-attempted",
    creditEstimate: 1,
    creditState: "reserved",
    pages: [],
    vendorDeleteState: "not-started",
    localDeleteState: "not-started",
    handleActive: true,
    createdAt: "2025-12-31T00:00:00.000Z",
    updatedAt: "2025-12-31T00:00:00.000Z",
  };
}

async function seed(store: MemoryOmrStore, count: number): Promise<readonly PrivateRowId[]> {
  const ownerSessionId = "session:cleanup-fairness" as PrivateRowId;
  const ids: PrivateRowId[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = `cleanup-fairness-${index}`;
    const claimed = await store.claimCreate({
      ownerSessionId,
      ipOwnerHash: "ip:cleanup-fairness",
      idempotencyKeyHash: `hash:${key}`,
      requestDigest: String(index).padStart(64, "0") as SemanticDigest,
      record: record(ownerSessionId, key),
      quota,
      now: "2025-12-31T00:00:00.000Z",
    });
    if (claimed.status !== "claimed") throw new Error(`SEED_FAILED:${claimed.status}`);
    ids.push(claimed.job.id);
  }
  return ids;
}

describe("Memory OMR cleanup fairness", () => {
  it("moves an attempted persistent prefix behind every unattempted due row", async () => {
    const store = new MemoryOmrStore();
    const allIds = await seed(store, 50);
    const first = await store.claimCleanup({
      now: "2026-01-02T00:00:00.000Z",
      limit: 25,
      leaseToken: "lease:first",
      leaseExpiresAt: "2026-01-02T00:01:00.000Z",
    });
    const second = await store.claimCleanup({
      now: "2026-01-02T00:02:00.000Z",
      limit: 25,
      leaseToken: "lease:second",
      leaseExpiresAt: "2026-01-02T00:03:00.000Z",
    });

    const firstIds = new Set(first.map((job) => job.id));
    const secondIds = new Set(second.map((job) => job.id));
    expect(first).toHaveLength(25);
    expect(second).toHaveLength(25);
    expect([...secondIds].some((jobId) => firstIds.has(jobId))).toBe(false);
    expect(new Set([...firstIds, ...secondIds])).toEqual(new Set(allIds));
    expect(first.every((job) => job.cleanupLastAttemptAt === "2026-01-02T00:00:00.000Z")).toBe(true);
    expect(second.every((job) => job.cleanupLastAttemptAt === "2026-01-02T00:02:00.000Z")).toBe(true);
  });
});
