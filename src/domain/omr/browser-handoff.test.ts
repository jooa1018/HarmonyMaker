import { describe, expect, it } from "vitest";

import { binaryDigest } from "../digest/canonical";
import {
  evaluateOmrHandoffRecovery, OMR_HANDOFF_MAX_RECOVERY_ATTEMPTS, OMR_HANDOFF_TTL_MS,
  validateOmrHandoffPageBinding,
} from "./browser-handoff";

describe("IndexedDB OMR handoff recovery policy", () => {
  it("keeps a bounded handoff recoverable until TTL or the third failed recovery", () => {
    const created = Date.parse("2026-01-01T00:00:00.000Z");
    const expiresAt = new Date(created + OMR_HANDOFF_TTL_MS).toISOString();
    expect(evaluateOmrHandoffRecovery(expiresAt, 0, "2026-01-01T00:00:01.000Z")).toBe("available");
    expect(evaluateOmrHandoffRecovery(expiresAt, OMR_HANDOFF_MAX_RECOVERY_ATTEMPTS - 1, "2026-01-01T00:29:59.999Z")).toBe("available");
    expect(evaluateOmrHandoffRecovery(expiresAt, OMR_HANDOFF_MAX_RECOVERY_ATTEMPTS, "2026-01-01T00:29:59.999Z")).toBe("attempts-exhausted");
    expect(evaluateOmrHandoffRecovery(expiresAt, 0, expiresAt)).toBe("expired");
    expect(() => evaluateOmrHandoffRecovery("invalid", 0, expiresAt)).toThrow("OMR_HANDOFF_RECORD_INVALID");
  });

  it("separates raw Blob integrity from canonical evidence binding when JPEG normalization changes the digest", async () => {
    const rawBytes = new TextEncoder().encode("raw-jpeg-byte-identity");
    const rawDigest = await binaryDigest(rawBytes);
    const canonicalPageDigest = "b".repeat(64) as typeof rawDigest;
    expect(rawDigest).not.toBe(canonicalPageDigest);
    const page = {
      pageIndex: 0,
      rawDigest,
      canonicalPageDigest,
      mimeType: "image/jpeg" as const,
      blob: new Blob([rawBytes], { type: "image/jpeg" }),
    };
    const result = {
      vendorId: "provider",
      vendorResultDigest: "c".repeat(64) as typeof rawDigest,
      rawMusicXml: "<score-partwise/>",
      evidence: {
        granularity: "page" as const,
        frames: [{ id: "frame:0", pageIndex: 0, coordinateSpace: "normalized-original" as const, widthPixels: 100, heightPixels: 120, imageDigest: canonicalPageDigest }],
        transforms: [], evidence: [], providerBundleDigest: "d".repeat(64) as never,
      },
      normalizationMapping: {} as never,
      retentionInfo: { canDeleteImmediately: true },
    };
    await expect(validateOmrHandoffPageBinding([page], result)).resolves.toBe(true);
    await expect(validateOmrHandoffPageBinding([page], {
      ...result,
      evidence: { ...result.evidence, frames: [{ ...result.evidence.frames[0], imageDigest: rawDigest }] },
    })).resolves.toBe(false);
    await expect(validateOmrHandoffPageBinding([{ ...page, pageIndex: 1 }], result)).resolves.toBe(false);
    await expect(validateOmrHandoffPageBinding([{ ...page, blob: new Blob([Uint8Array.of(1)], { type: "image/jpeg" }) }], result)).resolves.toBe(false);
  });

  it("does not invent an every-page evidence coverage requirement", async () => {
    const bytesA = Uint8Array.of(1, 2, 3);
    const bytesB = Uint8Array.of(4, 5, 6);
    const rawA = await binaryDigest(bytesA); const rawB = await binaryDigest(bytesB);
    const canonicalA = "a".repeat(64) as typeof rawA; const canonicalB = "b".repeat(64) as typeof rawB;
    const result = {
      vendorId: "provider", vendorResultDigest: "c".repeat(64) as typeof rawA, rawMusicXml: "<score-partwise/>",
      evidence: { granularity: "page" as const, frames: [{ id: "frame:0", pageIndex: 0, coordinateSpace: "normalized-original" as const, widthPixels: 1, heightPixels: 1, imageDigest: canonicalA }], transforms: [], evidence: [], providerBundleDigest: "d".repeat(64) as never },
      normalizationMapping: {} as never, retentionInfo: { canDeleteImmediately: true },
    };
    await expect(validateOmrHandoffPageBinding([
      { pageIndex: 0, rawDigest: rawA, canonicalPageDigest: canonicalA, mimeType: "image/png", blob: new Blob([bytesA], { type: "image/png" }) },
      { pageIndex: 1, rawDigest: rawB, canonicalPageDigest: canonicalB, mimeType: "image/png", blob: new Blob([bytesB], { type: "image/png" }) },
    ], result)).resolves.toBe(true);
  });
});
